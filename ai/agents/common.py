"""Authenticated peer service and isolated Strands sessions."""
import asyncio
import hmac
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry
from strands.session import S3SessionManager

REGIONS = {"agy": "us-west-2", "kiro": "ca-central-1", "codex": "eu-west-3"}


class InvokeRequest(BaseModel):
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    prompt: str = Field(min_length=1, max_length=4000)

    @field_validator("prompt")
    @classmethod
    def nonempty_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value.strip()


class ToolBudget(HookProvider):
    def __init__(self):
        self.calls = 0

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool)

    def before_tool(self, event: BeforeToolCallEvent) -> None:
        self.calls += 1
        if self.calls > 5:
            event.cancel_tool = "Tool budget exhausted. Answer using existing results."


def missing_settings(agent_id: str) -> list[str]:
    required = [f"{agent_id.upper()}_INVOKE_TOKEN", f"{agent_id.upper()}_MODEL", "AGENT_SESSION_BUCKET"]
    if agent_id == "agy":
        required.append("GOOGLE_API_KEY")
    elif agent_id == "codex":
        required.append("OPENAI_API_KEY")
    return [key for key in required if not os.environ.get(key, "").strip()]


def build_peer(agent_id: str, session_id: str, system_prompt: str, tools: list) -> Agent:
    region = os.environ.get("AWS_REGION", REGIONS[agent_id])
    model_id = os.environ[f"{agent_id.upper()}_MODEL"]
    if agent_id == "agy":
        from strands.models.gemini import GeminiModel
        model = GeminiModel(model_id=model_id, client_args={"api_key": os.environ["GOOGLE_API_KEY"]},
                            params={"max_output_tokens": 2048})
    elif agent_id == "codex":
        from strands.models.openai_responses import OpenAIResponsesModel
        model = OpenAIResponsesModel(model_id=model_id,
                                    client_args={"api_key": os.environ["OPENAI_API_KEY"]},
                                    params={"store": False, "max_output_tokens": 2048})
    else:
        from strands.models import BedrockModel
        model = BedrockModel(model_id=model_id, region_name=region, max_tokens=2048)
    return Agent(
        name=agent_id, agent_id=agent_id, model=model, tools=tools,
        system_prompt=system_prompt, callback_handler=None, hooks=[ToolBudget()],
        session_manager=S3SessionManager(session_id=session_id,
            bucket=os.environ["AGENT_SESSION_BUCKET"], prefix=f"{agent_id}-sessions/", region_name=region),
        conversation_manager=SlidingWindowConversationManager(window_size=20),
    )


def create_app(agent_id: str, factory) -> FastAPI:
    app = FastAPI(title=f"Larboard {agent_id}")
    # One process per host: reject overlapping writes to the same S3 session.
    active_sessions: set[str] = set()

    @app.get("/health")
    def health():
        missing = missing_settings(agent_id)
        return JSONResponse({"agent": agent_id, "region": os.environ.get("AWS_REGION", REGIONS[agent_id]),
                             "status": "unconfigured" if missing else "ok", "missing": missing},
                            status_code=503 if missing else 200)

    @app.post("/invoke")
    async def invoke(req: InvokeRequest, authorization: str | None = Header(default=None)):
        expected = os.environ.get(f"{agent_id.upper()}_INVOKE_TOKEN", "")
        if not expected:
            raise HTTPException(503, "Agent invoke authentication is not configured.")
        if not hmac.compare_digest((authorization or "").encode(), f"Bearer {expected}".encode()):
            raise HTTPException(401, "Unauthorized.")
        if missing_settings(agent_id):
            raise HTTPException(503, "Agent configuration is incomplete.")
        if req.session_id in active_sessions:
            raise HTTPException(409, "This session already has a request in progress.")
        active_sessions.add(req.session_id)
        events = None
        try:
            agent = await asyncio.to_thread(factory, req.session_id)
            events = agent.stream_async(req.prompt)
            # Surface startup/provider failures before committing HTTP 200.
            async with asyncio.timeout(120):
                first = None
                async for event in events:
                    if event.get("data"):
                        first = event["data"]
                        break
                if first is None:
                    raise RuntimeError("Provider returned no text")
        except BaseException as exc:
            active_sessions.discard(req.session_id)
            if events is not None:
                await events.aclose()
            if isinstance(exc, asyncio.CancelledError):
                raise
            raise HTTPException(502, "Agent could not start a response. Check provider and S3 access.") from None

        async def stream():
            try:
                yield first
                async with asyncio.timeout(120):
                    async for event in events:
                        if event.get("data"):
                            yield event["data"]
            finally:
                try:
                    await events.aclose()
                finally:
                    active_sessions.discard(req.session_id)

        return StreamingResponse(stream(), media_type="text/plain", headers={
            "Cache-Control": "no-store", "X-Agent-Id": agent_id,
        })

    return app
