import json
import os
import time
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, AgentSkills
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.session.s3_session_manager import S3SessionManager

from forge_tools import build_tools
from forge_hooks import RateLimiterHook


app = BedrockAgentCoreApp()
log = app.logger
s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
SESSION_TTL_SECONDS = 48 * 60 * 60


def _prompt_from(payload: Any) -> str:
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt must be a non-empty string")
    return prompt.strip()[:4000]


def _palette_from(payload: dict[str, Any]) -> list[str]:
    palette = payload.get("palette", [])
    if not isinstance(palette, list):
        raise ValueError("palette must be an array of strings")
    return [word.strip() for word in palette if isinstance(word, str) and word.strip()][:52]


def _session_id(context: Any) -> str:
    return str(getattr(context, "session_id", None) or "default-session")


def _palette_bucket() -> str | None:
    return os.getenv("FORGE_PALETTE_BUCKET") or None


def _palette_key(session_id: str) -> str:
    prefix = os.getenv("FORGE_PALETTE_KEY_PREFIX", "palettes/").strip("/")
    return f"{prefix}/{session_id}.json" if prefix else f"{session_id}.json"


def _expires_at() -> int:
    return int(time.time()) + SESSION_TTL_SECONDS


def _max_tool_calls() -> int:
    try:
        return max(1, min(10, int(os.getenv("FORGE_MAX_TOOL_CALLS", "3"))))
    except ValueError:
        return 3


def _skills_path() -> str:
    """Resolve the skill library while allowing deployment-specific overrides."""
    configured_path = os.getenv("FORGE_SKILLS_PATH")
    if configured_path:
        return configured_path
    bundled_path = Path(__file__).resolve().parent / "skills"
    if bundled_path.is_dir():
        return str(bundled_path)
    return str(Path(__file__).resolve().parents[2] / "skills")


def _load_palette(session_id: str, requested: list[str]) -> list[str]:
    bucket = _palette_bucket()
    if requested:
        if bucket:
            s3.put_object(
                Bucket=bucket,
                Key=_palette_key(session_id),
                Body=json.dumps({"palette": requested, "expires_at": _expires_at()}).encode("utf-8"),
                ContentType="application/json",
            )
        return requested
    if not bucket:
        return []
    try:
        response = s3.get_object(Bucket=bucket, Key=_palette_key(session_id))
        stored = json.loads(response["Body"].read())
        if isinstance(stored, dict):
            if int(stored.get("expires_at", 0)) <= int(time.time()):
                s3.delete_object(Bucket=bucket, Key=_palette_key(session_id))
                return []
            stored = stored.get("palette", [])
        return [word for word in stored if isinstance(word, str) and word.strip()][:52]
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
            return []
        raise


def _session_table():
    table_name = os.getenv("FORGE_SESSION_TABLE")
    return dynamodb.Table(table_name) if table_name else None


def _session_bucket() -> str | None:
    return os.getenv("FORGE_SESSION_BUCKET") or None


def _session_prefix() -> str:
    return os.getenv("FORGE_SESSION_PREFIX", "forge-sessions/").strip("/")


def _native_session_manager(session_id: str) -> S3SessionManager | None:
    bucket = _session_bucket()
    if not bucket:
        return None
    return S3SessionManager(
        session_id=session_id,
        bucket=bucket,
        prefix=_session_prefix(),
        region_name=os.getenv("AWS_REGION"),
    )


def _load_messages(session_id: str) -> list[dict[str, str]]:
    table = _session_table()
    if not table:
        return []
    response = table.get_item(Key={"session_id": session_id})
    item = response.get("Item", {})
    if int(item.get("expires_at", 0)) <= int(time.time()):
        if item:
            table.delete_item(Key={"session_id": session_id})
        return []
    messages = item.get("messages", [])
    return [
        item for item in messages[-20:]
        if isinstance(item, dict) and item.get("role") in {"user", "assistant"}
        and isinstance(item.get("content"), str)
    ]


def _save_messages(session_id: str, messages: list[dict[str, str]]) -> None:
    table = _session_table()
    if table:
        table.put_item(Item={
            "session_id": session_id,
            "messages": messages[-20:],
            "updated_at": int(time.time()),
            "expires_at": _expires_at(),
        })


def _agent_for_palette(
    palette: list[str],
    requests_remaining: int,
    session_id: str,
) -> Agent:
    palette_text = ", ".join(palette) if palette else "(empty)"
    max_tool_calls = _max_tool_calls()
    skills_plugin = AgentSkills(skills=[_skills_path()])
    session_manager = _native_session_manager(session_id)

    return Agent(
        tools=build_tools(palette),
        hooks=[RateLimiterHook(max_calls=max_tool_calls, on_event=lambda message: log.info("Hook: %s", message))],
        plugins=[skills_plugin],
        conversation_manager=SlidingWindowConversationManager(window_size=20),
        session_manager=session_manager,
        system_prompt=(
            "You are Forge, a focused word specialist and conversation partner. "
            "Help the user explore meaning, nuance, connotation, etymology, tone, "
            "and poetic or precise word choice. Stay tightly on the user's topic; "
            "do not drift into generic life coaching or broad brainstorming. Use plain language, "
            "give concrete examples when useful, and ask at most one concise follow-up question when needed. "
            f"This session has a daily limit of 8 model requests; {requests_remaining} remain after this turn. "
            "Use the user's word palette as inspiration when relevant. "
            "Never invent palette entries or present guesses as facts. "
            f"The current palette is: {palette_text}. "
            "When a request needs palette information, use the available tools. "
            "The agent loop is: understand the request, choose a tool when useful, "
            "read its result, and continue reasoning until you can answer. "
            f"Each tool is limited to {max_tool_calls} calls per request. "
            "If a hook blocks a tool, do not retry it. "
            "Use the relevant markdown skill when the request matches its description; "
            "skills provide suggested procedures, while hooks provide hard limits. "
            "For device problems, connectivity, firmware, or troubleshooting, delegate "
            "to the tech_support_specialist tool and translate its findings into a clear "
            "customer-facing answer. Handle word and palette requests directly."
        )
    )


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any):
    prompt = _prompt_from(payload)
    requests_remaining = max(0, min(8, int(payload.get("requests_remaining", 8))))
    session_id = _session_id(context)
    palette = _load_palette(session_id, _palette_from(payload))
    messages = _load_messages(session_id)
    native_sessions = _session_bucket() is not None
    history = "\n".join(f"{item['role']}: {item['content']}" for item in messages)
    agent_prompt = prompt if native_sessions else (
        f"Conversation history:\n{history}\n\nCurrent request: {prompt}" if history else prompt
    )
    log.info("Invoking ForgeAgent with %d palette words and %d stored messages", len(palette), len(messages))
    agent = _agent_for_palette(palette, requests_remaining, session_id)

    events = []
    async for event in agent.stream_async(agent_prompt):
        if isinstance(event, dict) and "event" in event:
            events.append(event)

    answer = ""
    for event in events:
        delta = event.get("event", {}).get("contentBlockDelta", {}).get("delta", {})
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            answer += delta["text"]
    if not native_sessions:
        _save_messages(session_id, messages + [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": answer or "(empty response)"},
        ])
    for event in events:
        yield event


if __name__ == "__main__":
    app.run()
