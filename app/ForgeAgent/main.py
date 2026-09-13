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
from forge_steering import PaletteReadyHandler, ToneGuardrailHandler
from forge_profiles import get_profile, get_system_prompt, get_max_tool_calls as profile_max_tool_calls, get_tool_names
from conversation_guidance import CONVERSATION_GUIDANCE


app = BedrockAgentCoreApp()
log = app.logger
s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
SESSION_TTL_SECONDS = 48 * 60 * 60
MAX_PROMPT_WORDS = 52
MAX_RESPONSE_WORDS = 52

# ---------------------------------------------------------------------------
# State schema versioning
#
# Bump STATE_SCHEMA_VERSION whenever the DynamoDB/S3 session record shape
# changes (fields added, renamed, or removed).
#
# Migration guide
# ---------------
# v1  (current)  Initial versioned schema.  Added schemaVersion field to all
#               new session records.  Records written without this field are
#               treated as v0 and loaded without modification — no data loss.
#
# When bumping to v2 in the future:
#   1. Increment STATE_SCHEMA_VERSION.
#   2. Add a migration block in _load_messages():
#        if item.get("schemaVersion", 0) < 2:
#            # back-fill or transform fields here
#   3. Document the change above.
# ---------------------------------------------------------------------------
STATE_SCHEMA_VERSION = 1


def _prompt_from(payload: Any) -> str:
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt must be a non-empty string")
    prompt = prompt.strip()[:4000]
    if len(prompt.split()) > MAX_PROMPT_WORDS:
        raise ValueError(f"prompt must contain no more than {MAX_PROMPT_WORDS} words")
    return prompt


def _limit_output_words(value: str) -> str:
    """Keep direct AgentCore responses within the public response contract."""
    words = value.strip().split()
    if len(words) <= MAX_RESPONSE_WORDS:
        return value.strip()
    return " ".join(words[:MAX_RESPONSE_WORDS]) + "…"


def _bounded_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Trim streamed text deltas while preserving the AgentCore event shape."""
    emitted = ""
    bounded: list[dict[str, Any]] = []
    for event in events:
        current = event.get("event", {}) if isinstance(event, dict) else {}
        delta = current.get("contentBlockDelta", {}).get("delta", {})
        text = delta.get("text") if isinstance(delta, dict) else None
        if not isinstance(text, str):
            bounded.append(event)
            continue
        candidate = _limit_output_words(emitted + text)
        delta_text = candidate[len(emitted):] if candidate.startswith(emitted) else ""
        emitted = candidate
        copied = dict(event)
        copied_event = dict(current)
        copied_delta_block = dict(copied_event.get("contentBlockDelta", {}))
        copied_delta = dict(copied_delta_block.get("delta", {}))
        copied_delta["text"] = delta_text
        copied_delta_block["delta"] = copied_delta
        copied_event["contentBlockDelta"] = copied_delta_block
        copied["event"] = copied_event
        bounded.append(copied)
    return bounded


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
            "schemaVersion": STATE_SCHEMA_VERSION,
            "messages": messages[-20:],
            "updated_at": int(time.time()),
            "expires_at": _expires_at(),
        })


def _agent_for_palette(
    palette: list[str],
    requests_remaining: int,
    session_id: str,
    profile_id: str = 'forge',
) -> Agent:
    palette_text = ", ".join(palette) if palette else "(empty)"
    profile = get_profile(profile_id) or get_profile('forge')
    system_prompt = get_system_prompt(profile_id)
    max_tool_calls = min(_max_tool_calls(), profile_max_tool_calls(profile_id))
    daily_limit = profile.get('dailyRequestLimit', 8)
    
    skills_plugin = AgentSkills(skills=[_skills_path()])
    session_manager = _native_session_manager(session_id)

    profile_tool_names = set(get_tool_names(profile_id))
    profile_tools = [tool for tool in build_tools(palette, profile_id) if getattr(tool, "__name__", "") in profile_tool_names]

    return Agent(
        tools=profile_tools,
        hooks=[RateLimiterHook(max_calls=max_tool_calls, on_event=lambda message: log.info("Hook: %s", message))],
        plugins=[skills_plugin, PaletteReadyHandler(), ToneGuardrailHandler()],
        conversation_manager=SlidingWindowConversationManager(window_size=20),
        session_manager=session_manager,
        system_prompt=(
            f"{CONVERSATION_GUIDANCE} {system_prompt} "
            f"This session has a daily limit of {daily_limit} model requests; {requests_remaining} remain after this turn. "
            "Use the user's word palette as inspiration when relevant. "
            "Never invent palette entries or present guesses as facts. "
            f"The current palette is: {palette_text}. "
            "When a request needs palette information, use the available tools. "
            "The agent loop is: understand the request, choose a tool when useful, "
            "read its result, and continue reasoning until you can answer. "
            f"Each tool is limited to {max_tool_calls} calls per request. "
            "If a hook blocks a tool, do not retry it. "
            "Use the relevant markdown skill when the request matches its description; "
            "skills provide suggested procedures, while hooks provide hard limits."
        )
    )


def _profile_id_from(payload: dict[str, Any]) -> str:
    """Extract profile ID from payload, defaulting to this Runtime's profile."""
    profile_id = payload.get("agent_id") or payload.get("profile_id")
    if not isinstance(profile_id, str) or not profile_id.strip():
        profile_id = os.getenv("FORGE_DEFAULT_PROFILE", "forge")
    profile_id = profile_id.strip().lower()
    # Validate that profile exists
    if not get_profile(profile_id):
        log.warning(f"Unknown profile {profile_id}; falling back to forge")
        return 'forge'
    return profile_id


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any):
    prompt = _prompt_from(payload)
    profile_id = _profile_id_from(payload)
    requests_remaining = max(0, min(8, int(payload.get("requests_remaining", 8))))
    session_id = _session_id(context)
    palette = _load_palette(session_id, _palette_from(payload))
    messages = _load_messages(session_id)
    native_sessions = _session_bucket() is not None
    history = "\n".join(f"{item['role']}: {item['content']}" for item in messages)
    agent_prompt = prompt if native_sessions else (
        f"Conversation history:\n{history}\n\nCurrent request: {prompt}" if history else prompt
    )
    log.info("Invoking agent profile=%s with %d palette words and %d stored messages", profile_id, len(palette), len(messages))
    agent = _agent_for_palette(palette, requests_remaining, session_id, profile_id)

    events = []
    async for event in agent.stream_async(agent_prompt):
        if isinstance(event, dict) and "event" in event:
            events.append(event)

    answer = ""
    for event in events:
        delta = event.get("event", {}).get("contentBlockDelta", {}).get("delta", {})
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            answer += delta["text"]
    answer = _limit_output_words(answer or "(empty response)")
    events = _bounded_events(events)
    if not native_sessions:
        _save_messages(session_id, messages + [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": answer},
        ])
    for event in events:
        yield event


if __name__ == "__main__":
    app.run()
