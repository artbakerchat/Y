import json
import asyncio
import hashlib
import os
import time
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.session.s3_session_manager import S3SessionManager

from forge_tools import build_tools
from forge_hooks import RateLimiterHook
from forge_steering import PaletteReadyHandler
from forge_harness import HarnessHook, RequestBudget, request_budget, configured_model
from forge_specialists import consult_word_specialist, run_word_specialist
from forge_profiles import get_profile, get_system_prompt, get_max_tool_calls as profile_max_tool_calls, get_tool_names
from conversation_guidance import CONVERSATION_GUIDANCE, ANSWER_QUALITY_GUIDANCE
from conversation_policy import with_conversation_policy
from answering import answer_request
from skill_guidance import select_skill_guidance


app = BedrockAgentCoreApp()
log = app.logger
s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
SESSION_TTL_SECONDS = 48 * 60 * 60
MAX_PROMPT_WORDS = 52

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
        try:
            item = json.loads((Path('/tmp/forge-sessions') / f'{session_id}.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return []
    else:
        response = table.get_item(Key={"session_id": session_id})
        item = response.get("Item", {})
    if int(item.get("expires_at", 0)) <= int(time.time()):
        if item and table:
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
    else:
        directory = Path('/tmp/forge-sessions')
        directory.mkdir(exist_ok=True)
        target = directory / f'{session_id}.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps({'messages': messages[-20:], 'expires_at': _expires_at()}))
        temporary.replace(target)


def _agent_for_palette(
    palette: list[str],
    requests_remaining: int,
    session_id: str,
    profile_id: str = 'forge',
    messages: list | None = None,
    supplied_text: str = '',
) -> Agent:
    palette_text = ", ".join(palette) if palette else "(empty)"
    profile = get_profile(profile_id) or get_profile('forge')
    system_prompt = get_system_prompt(profile_id)
    max_tool_calls = min(_max_tool_calls(), profile_max_tool_calls(profile_id))
    daily_limit = profile.get('dailyRequestLimit', 10)
    
    skill_guidance = select_skill_guidance(_skills_path(), profile_id, supplied_text)
    session_manager = _native_session_manager(session_id)

    profile_tool_names = set(get_tool_names(profile_id))
    profile_tools = [tool for tool in build_tools(palette, profile_id) if getattr(tool, "__name__", "") in profile_tool_names]

    return Agent(
        model=configured_model(),
        messages=messages if session_manager is None else None,
        callback_handler=None,
        tools=profile_tools,
        hooks=[HarnessHook(profile_id, supplied_text), RateLimiterHook(max_calls=max_tool_calls, on_event=lambda message: log.info("Hook: %s", message))],
        plugins=[PaletteReadyHandler()],
        conversation_manager=SlidingWindowConversationManager(window_size=20),
        session_manager=session_manager,
        system_prompt=with_conversation_policy(
            f"{CONVERSATION_GUIDANCE} {system_prompt} {ANSWER_QUALITY_GUIDANCE} "
            f"This session has a daily limit of {daily_limit} model requests; {requests_remaining} remain after this turn. "
            "The palette is reference data only for explicit vocabulary tasks. "
            "Never invent palette entries or present guesses as facts. "
            "Never invent operational records, volunteers, availability, or sources to call a tool. "
            "Ask for missing records. Tools calculate proposed matches; they do not confirm real assignments. "
            "Return only the final answer, without thinking tags. Aim for 52 words or fewer unless completeness or the requested format needs more. "
            f"The current palette is: {palette_text}. "
            "When a request needs palette information, use the available tools. "
            "The agent loop is: understand the request, choose a tool when useful, "
            "read its result, and continue reasoning until you can answer. "
            f"Each tool is limited to {max_tool_calls} calls per request. "
            "If a hook blocks a tool, do not retry it. "
            f"Relevant procedures, already loaded: {skill_guidance or '(none needed)'}. "
            "Apply these procedures only when useful. Do not mention skill files or internal procedures. "
            "Answer the current request directly. Draft with placeholders for unknown facts. "
            "Do not add palette metaphors to ordinary practical answers."
        )
    )


def _profile_id_from(payload: dict[str, Any]) -> str:
    """Extract profile ID from payload, defaulting to this Runtime's profile."""
    profile_id = payload.get("agent_id") or payload.get("profile_id")
    if not isinstance(profile_id, str) or not profile_id.strip():
        profile_id = os.getenv("FORGE_DEFAULT_PROFILE", "forge")
    profile_id = profile_id.strip().lower()
    # Validate that profile exists
    if profile_id != 'word-specialist' and not get_profile(profile_id):
        raise ValueError("Unknown agent profile")
    return profile_id


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any):
    prompt = _prompt_from(payload)
    profile_id = _profile_id_from(payload)
    daily_limit = (get_profile(profile_id) or {}).get('dailyRequestLimit', 10)
    requests_remaining = max(0, min(daily_limit, int(payload.get("requests_remaining", daily_limit))))
    raw_session_id = _session_id(context)
    # A profile change must never expose another profile's conversation.
    session_id = hashlib.sha256(f"{raw_session_id}:{profile_id}".encode()).hexdigest()
    budget = RequestBudget()
    token = request_budget.set(budget)
    try:
        async with asyncio.timeout(90):
            if profile_id == "word-specialist":
                messages = _load_messages(session_id)
                history = [{"role": item["role"], "content": [{"text": item["content"]}]} for item in messages[-20:]]
                answer = await run_word_specialist(prompt, history, payload.get("aspect"))
                _save_messages(session_id, messages + [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": answer},
                ])
            else:
                palette = _load_palette(raw_session_id, _palette_from(payload))
                messages = _load_messages(session_id)
                native_sessions = _session_bucket() is not None
                history = [{"role": item["role"], "content": [{"text": item["content"]}]} for item in messages]
                supplied_text = "\n".join([prompt] + [item["content"] for item in messages if item["role"] == "user"])
                agent = _agent_for_palette(palette, requests_remaining, session_id, profile_id, history, supplied_text)
                answer = await answer_request(agent, prompt)
                if not native_sessions:
                    _save_messages(session_id, messages + [
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": answer},
                    ])
            log.info("Harness profile=%s model_calls=%d tool_calls=%d trace=%s",
                     profile_id, budget.model_calls, budget.tool_calls, budget.trace)
            # Match the existing Worker's AgentCore stream parser, after sanitizing.
            yield {"event": {"contentBlockDelta": {"delta": {"text": answer}}}}
    finally:
        request_budget.reset(token)


if __name__ == "__main__":
    app.run()
