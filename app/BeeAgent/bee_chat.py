"""Chat action for the Y BeeAgent runtime.

Seeds the session's Bee config from the token the Worker passes in the
payload, then runs a Strands agent (Nova Lite) with the full beeplex tool
set. Per-invocation history comes from the Worker; the microVM itself is
the session's memory and dies with it.
"""

from __future__ import annotations

import base64
import os

from strands import Agent
from strands.models import BedrockModel

import bee_pairing
import bee_tools
from bee_tools import BEE_TOOLS

SYSTEM_PROMPT = """You are the Y Bee companion, a warm, sharp observer of the \
visitor's Bee memories. You are read-only: you never change anything in \
their Bee account, you only read and reflect.

How you work:
- Use your bee_* tools to look things up; don't guess from memory.
- beeplex scoring reads HOW people talk (engagement, forward motion, depth); \
Bee's own summaries say WHAT was said. When they disagree, say so -- the \
disagreement is the signal.
- Quote verbatim utterances when they carry the meaning; Bee's AI summaries \
may contain minor inaccuracies.
- When the visitor asks for a report or files, use bee_report and tell them \
the files are attached for download.
- Keep answers conversational and tight. No lectures, no filler.

Privacy: this conversation lives in this session only. Never mention \
budgets, tokens, sessions, or infrastructure."""


def _model():
    return BedrockModel(
        model_id=os.environ.get("BEDROCK_MODEL_ID", "ca.amazon.nova-lite-v1:0"),
        region_name=os.environ.get("AWS_REGION", "ca-central-1"),
        max_tokens=1500,
        temperature=0.3,
    )


def _history_block(history) -> str:
    if not history:
        return ""
    lines = []
    for turn in history[-12:]:
        role = turn.get("role", "user")
        text = str(turn.get("text", ""))[:2000]
        lines.append(f"{role}: {text}")
    return "\n".join(lines)


async def chat(bee_bin: str, env: dict, config_dir: str, payload: dict) -> dict:
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return {"ok": False, "error": "empty prompt"}

    bee_token = payload.get("bee_token") or ""
    if not bee_token:
        return {"ok": False, "error": "not connected: no Bee token"}

    login = bee_pairing.ensure_login(bee_bin, env, config_dir, bee_token)
    if not login.get("ok"):
        return login

    history = _history_block(payload.get("history"))
    full_prompt = f"Recent conversation:\n{history}\n\nVisitor: {prompt}" if history else prompt

    # Drain any attachments left by a previous invocation in this microVM.
    bee_tools.ATTACHMENTS.clear()

    try:
        agent = Agent(model=_model(), system_prompt=SYSTEM_PROMPT, tools=BEE_TOOLS)
        result = agent(full_prompt)
        content = result.message.get("content") or []
        answer = str(content[0].get("text", "")) if content else ""
    except Exception as exc:
        return {"ok": False, "error": f"chat failed: {type(exc).__name__}"}

    response: dict = {"ok": True, "answer": answer}
    # Token usage for the Worker's budget accounting. Strands exposes this
    # on result.metrics; degrade to zeros rather than fail the turn.
    try:
        metrics = getattr(result, "metrics", None)
        usage = getattr(metrics, "accumulated_usage", None) if metrics else None
        if isinstance(usage, dict):
            response["usage"] = {
                "input_tokens": int(usage.get("inputTokens") or 0),
                "output_tokens": int(usage.get("outputTokens") or 0),
            }
        else:
            response["usage"] = {"input_tokens": 0, "output_tokens": 0}
    except Exception:
        response["usage"] = {"input_tokens": 0, "output_tokens": 0}
    if bee_tools.ATTACHMENTS:
        # Strip to the download fields; the agent already saw names/sizes.
        response["files"] = [
            {"name": f["name"], "mime": f["mime"], "size": f["size"], "b64": f["b64"]}
            for f in bee_tools.ATTACHMENTS
        ]
        bee_tools.ATTACHMENTS.clear()
    return response
