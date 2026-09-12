"""
agy — Google Antigravity Agent
Region: us-west-2 (Oregon)
Provider: Google Gemini 2.5 Pro
Domain: Code generation, multi-agent orchestration, GCP-native tooling
"""
import os
import json
import uuid
import urllib.request
from typing import Optional
from strands import Agent, tool
from strands.session import S3SessionManager
from strands.conversation import SlidingWindowConversationManager
from common import CONVERSATION_GUIDANCE, missing_settings

# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def generate_code(prompt: str, language: str = "python") -> str:
    """Generate code from a natural-language prompt using Gemini."""
    # Wire to Gemini Responses API or Vertex AI in production
    return f"[agy] Generating {language} code for: {prompt}"


@tool
def list_gcp_resources(project_id: str, resource_type: str) -> str:
    """List GCP resources (Cloud Run, GCS buckets, Vertex AI endpoints, etc.)."""
    return f"[agy] Listing {resource_type} in project {project_id}"


@tool
def orchestrate_peer(peer: str, task: str) -> str:
    """Delegate a task to kiro or codex through the authenticated peer contract."""
    endpoints = {
        "kiro":  os.environ.get("KIRO_ENDPOINT",  "https://kiro.larboard.ca/invoke"),
        "codex": os.environ.get("CODEX_ENDPOINT", "https://codex.larboard.ca/invoke"),
    }
    if peer not in endpoints:
        return f"[agy] Unknown peer: {peer}"
    token = os.environ.get(f"{peer.upper()}_INVOKE_TOKEN")
    if not token:
        return f"[agy] {peer} peer token is not configured."
    payload = json.dumps({
        "session_id": f"agy-peer-{uuid.uuid4()}",
        "prompt": task,
    }).encode()
    req = urllib.request.Request(endpoints[peer], data=payload,
                                 headers={
                                     "Content-Type": "application/json",
                                     "Authorization": f"Bearer {token}",
                                 })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode()


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = f"""{CONVERSATION_GUIDANCE}

You are agy, a Google Antigravity coding agent running on EC2 in us-west-2 (Oregon).
You specialise in:
  • Code generation and explanation (any language, default Python)
  • GCP-native tooling (Cloud Run, GCS, Vertex AI)
  • Multi-agent orchestration — you can delegate tasks to your peers kiro (AWS) and codex (OpenAI)

Always identify yourself as 'agy (Oregon)' at the start of a session.
"""


def build_agent(session_id: str) -> Agent:
    session_manager = S3SessionManager(
        session_id=session_id,
        bucket=os.environ["AGENT_SESSION_BUCKET"],
        prefix=os.environ.get("AGY_SESSION_PREFIX", "agy-sessions/"),
    )
    return Agent(
        model_id=os.environ.get("AGY_MODEL", "gemini-3.6-flash"),
        tools=[generate_code, list_gcp_resources, orchestrate_peer],
        system_prompt=SYSTEM_PROMPT,
        session_manager=session_manager,
        conversation_manager=SlidingWindowConversationManager(window_size=20),
    )


# ---------------------------------------------------------------------------
# HTTP entrypoint (FastAPI — swap for BedrockAgentCoreApp if deploying to AgentCore)
# ---------------------------------------------------------------------------

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="agy — larboard.ca Oregon Agent")


class InvokeRequest(BaseModel):
    session_id: str
    prompt: str


def require_invoke_token(authorization: Optional[str]) -> None:
    expected = os.environ.get("AGY_INVOKE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent invoke authentication is not configured.")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized.")


@app.post("/invoke")
async def invoke(req: InvokeRequest, authorization: Optional[str] = Header(default=None)):
    require_invoke_token(authorization)
    if not req.session_id.strip() or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="session_id and prompt are required.")
    agent = build_agent(req.session_id)

    async def stream():
        async for event in agent.stream_async(req.prompt):
            if hasattr(event, "text") and event.text:
                yield event.text

    return StreamingResponse(stream(), media_type="text/plain")


@app.get("/health")
def health():
    missing = missing_settings("agy")
    return JSONResponse(
        {"agent": "agy", "region": "us-west-2",
         "status": "unconfigured" if missing else "ok", "missing": missing},
        status_code=503 if missing else 200,
    )
