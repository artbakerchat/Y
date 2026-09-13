"""Expose Forge's existing AgentCore Runtime through the peer contract."""
from __future__ import annotations

import asyncio
import hmac
import json
import os

import boto3
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator


AGENT_ID = "forge"
REGION = os.environ.get("AWS_REGION", "ca-central-1")
app = FastAPI(title="Larboard Forge AgentCore peer")


class InvokeRequest(BaseModel):
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    prompt: str = Field(min_length=1, max_length=4000)

    @field_validator("prompt")
    @classmethod
    def nonempty_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value.strip()


def _runtime_arn() -> str:
    return os.environ.get("AGENTCORE_RUNTIME_ARN", "").strip()


def _token_ok(authorization: str | None) -> bool:
    expected = os.environ.get("FORGE_INVOKE_TOKEN", "")
    return bool(expected) and hmac.compare_digest(
        (authorization or "").encode(), f"Bearer {expected}".encode()
    )


def _chunks(response) -> list[bytes]:
    """Normalize AgentCore's boto3 event stream into text chunks."""
    chunks: list[bytes] = []
    body = response.get("response", response)
    iterator = body.iter_chunks() if hasattr(body, "iter_chunks") else body
    for event in iterator:
        if isinstance(event, dict):
            event = event.get("chunk", {}).get("bytes", b"")
        if isinstance(event, str):
            event = event.encode()
        if event:
            chunks.append(event)
    return chunks


def _invoke(req: InvokeRequest) -> list[bytes]:
    runtime_arn = _runtime_arn()
    if not runtime_arn:
        raise RuntimeError("AGENTCORE_RUNTIME_ARN is not configured")
    client = boto3.client("bedrock-agentcore", region_name=REGION)
    # AgentCore requires runtime session IDs of at least 33 characters.
    runtime_session_id = req.session_id if len(req.session_id) >= 33 else f"forge-peer-{req.session_id}".ljust(33, "-")
    response = client.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        runtimeSessionId=runtime_session_id,
        payload=json.dumps({"prompt": req.prompt, "agent_id": AGENT_ID}).encode(),
        qualifier="DEFAULT",
    )
    chunks = _chunks(response)
    if not chunks:
        raise RuntimeError("Forge AgentCore returned no response")
    return chunks


@app.get("/health")
def health():
    missing = [name for name, value in (
        ("AGENTCORE_RUNTIME_ARN", _runtime_arn()),
        ("FORGE_INVOKE_TOKEN", os.environ.get("FORGE_INVOKE_TOKEN", "")),
    ) if not value]
    return JSONResponse(
        {"agent": AGENT_ID, "region": REGION, "mode": "agentcore-runtime",
         "status": "ok" if not missing else "unconfigured", "missing": missing},
        status_code=200 if not missing else 503,
    )


@app.post("/invoke")
async def invoke(req: InvokeRequest, authorization: str | None = Header(default=None)):
    if not os.environ.get("FORGE_INVOKE_TOKEN"):
        raise HTTPException(503, "Forge invoke authentication is not configured.")
    if not _token_ok(authorization):
        raise HTTPException(401, "Unauthorized.")
    try:
        chunks = await asyncio.to_thread(_invoke, req)
    except Exception:
        raise HTTPException(502, "Forge AgentCore runtime could not complete the request.") from None
    return StreamingResponse(iter(chunks), media_type="text/plain", headers={
        "Cache-Control": "no-store", "X-Agent-Id": AGENT_ID,
        "X-Agent-Mode": "agentcore-runtime",
    })
