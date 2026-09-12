"""
codex — OpenAI Codex Agent
Region: eu-west-3 (Paris)
Provider: OpenAI GPT-4o
Domain: Natural-language code synthesis, GDPR-compliant EU data handling, Responses API streaming
"""
import os
try:
    from ai.agents.common import (Agent, S3SessionManager, SlidingWindowConversationManager,
                                   CONVERSATION_GUIDANCE, missing_settings)
except ModuleNotFoundError:
    from common import (Agent, S3SessionManager, SlidingWindowConversationManager,
                        CONVERSATION_GUIDANCE, missing_settings)

try:
    from strands import tool
except ModuleNotFoundError:  # Allows offline health/contract tests without provider SDKs.
    def tool(function):
        return function

# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def synthesize_code(description: str, language: str = "python") -> str:
    """Synthesize complete, documented code from a plain-English description."""
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model=os.environ.get("CODEX_MODEL", "gpt-4o"),
        messages=[
            {"role": "system", "content": f"You are an expert {language} developer. Return only code."},
            {"role": "user",   "content": description},
        ]
    )
    return response.choices[0].message.content


@tool
def explain_code(code: str, audience: str = "intermediate developer") -> str:
    """Explain what a code snippet does, tailored to the given audience."""
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model=os.environ.get("CODEX_MODEL", "gpt-4o"),
        messages=[
            {"role": "system", "content": f"Explain code clearly for a {audience}."},
            {"role": "user",   "content": f"Explain this:\n\n{code}"},
        ]
    )
    return response.choices[0].message.content


@tool
def gdpr_review(text: str) -> str:
    """Scan text for personal data or GDPR-sensitive content and flag issues."""
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model=os.environ.get("CODEX_MODEL", "gpt-4o"),
        messages=[
            {"role": "system", "content": (
                "You are a GDPR compliance reviewer. "
                "Identify any personal data, sensitive categories, or data-handling issues. "
                "Be concise and precise."
            )},
            {"role": "user", "content": text},
        ]
    )
    return response.choices[0].message.content


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = f"""{CONVERSATION_GUIDANCE}

You are codex, an OpenAI Codex agent running on EC2 in eu-west-3 (Paris).
You specialise in:
  • Natural-language to code synthesis (any language)
  • Explaining and reviewing code for any audience
  • GDPR compliance review for EU-hosted data and services
  • Responses API streaming for low-latency EU users of larboard.ca

All data you process stays within the EU (eu-west-3). Always identify yourself as 'codex (Paris)'.
"""


def build_agent(session_id: str) -> Agent:
    session_manager = S3SessionManager(
        session_id=session_id,
        bucket=os.environ["AGENT_SESSION_BUCKET"],
        prefix=os.environ.get("CODEX_SESSION_PREFIX", "codex-sessions/"),
    )
    return Agent(
        # codex uses OpenAI directly; swap model_id for a Strands-compatible OpenAI adapter
        model_id=os.environ.get("CODEX_MODEL", "gpt-5.6-luna"),
        tools=[synthesize_code, explain_code, gdpr_review],
        system_prompt=SYSTEM_PROMPT,
        session_manager=session_manager,
        conversation_manager=SlidingWindowConversationManager(window_size=20),
    )


# ---------------------------------------------------------------------------
# HTTP entrypoint
# ---------------------------------------------------------------------------

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="codex — larboard.ca Paris Agent")


class InvokeRequest(BaseModel):
    session_id: str
    prompt: str


def require_invoke_token(authorization: Optional[str]) -> None:
    expected = os.environ.get("CODEX_INVOKE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent invoke authentication is not configured.")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized.")


@app.post("/invoke")
async def invoke(req: InvokeRequest, authorization: Optional[str] = Header(default=None)):
    require_invoke_token(authorization)
    session_id = req.session_id.strip()
    prompt = req.prompt.strip()
    if not session_id or not prompt:
        raise HTTPException(status_code=400, detail="session_id and prompt are required.")
    agent = build_agent(session_id)

    async def stream():
        async for event in agent.stream_async(prompt):
            if hasattr(event, "text") and event.text:
                yield event.text

    return StreamingResponse(stream(), media_type="text/plain")


@app.get("/health")
def health():
    missing = missing_settings("codex")
    return JSONResponse(
        {"agent": "codex", "region": "eu-west-3",
         "status": "unconfigured" if missing else "ok", "missing": missing},
        status_code=503 if missing else 200,
    )
