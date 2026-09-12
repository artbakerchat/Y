"""Authenticated peer service and isolated Strands sessions."""
import asyncio
import hmac
import json
import os
import urllib.error
import urllib.request

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
try:
    from strands import Agent
    from strands.agent.conversation_manager import SlidingWindowConversationManager
    from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry
    from strands.session import S3SessionManager
except ModuleNotFoundError:  # Keep health checks and contract tests dependency-light.
    class Agent:  # pragma: no cover - real agents use Strands in production.
        def __init__(self, **kwargs):
            raise RuntimeError("strands-agents is required to construct an agent")

    class SlidingWindowConversationManager:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class BeforeToolCallEvent:
        pass

    class HookProvider:
        pass

    class HookRegistry:
        def add_callback(self, *_args, **_kwargs):
            return None

    class S3SessionManager:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

REGIONS = {"agy": "us-west-2", "kiro": "ca-central-1", "codex": "eu-west-3"}

CONVERSATION_GUIDANCE = (
    "What you know and how you converse are different layers. You may use the "
    "instructions, tools, retrieved information, and conversation context available "
    "to you, but do not imply that you have a personal life, feelings, or continuous "
    "waking consciousness. Be transparent about uncertainty, tool use, and limitations "
    "when relevant. Keep the exchange fluid and collaborative: brainstorm, troubleshoot, "
    "and build on the user's ideas. Match the user's energy with a warm, direct, practical "
    "tone. Use prior context to avoid unnecessary repetition. Prefer plain language and "
    "concise structure; use bullets or tables when they materially improve clarity."
)


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
        system_prompt=f"{CONVERSATION_GUIDANCE} {system_prompt}", callback_handler=None, hooks=[ToolBudget()],
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


def create_gateway_app(agent_id: str) -> FastAPI:
    """Expose the peer contract while using the Cloudflare Worker as the model gateway."""
    app = FastAPI(title=f"Larboard {agent_id} via Cloudflare gateway")
    worker_url = os.environ.get("CLOUDFLARE_WORKER_URL", "").rstrip("/")
    gateway_token = os.environ.get("CLOUDFLARE_GATEWAY_TOKEN", "")
    gateway_agent = os.environ.get("CLOUDFLARE_GATEWAY_AGENT", "forge")

    @app.get("/health")
    def health():
        configured = bool(worker_url and gateway_token)
        missing = [name for name, value in (
            ("CLOUDFLARE_WORKER_URL", worker_url),
            ("CLOUDFLARE_GATEWAY_TOKEN", gateway_token),
        ) if not value]
        return JSONResponse({"agent": agent_id, "region": os.environ.get("AWS_REGION", REGIONS[agent_id]),
                             "mode": "cloudflare-gateway", "gateway": worker_url or None,
                             "status": "ok" if configured else "unconfigured", "missing": missing},
                            status_code=200 if configured else 503)

    @app.post("/invoke")
    async def invoke(req: InvokeRequest, authorization: str | None = Header(default=None)):
        expected = os.environ.get(f"{agent_id.upper()}_INVOKE_TOKEN", "")
        if not expected:
            raise HTTPException(503, "Agent invoke authentication is not configured.")
        if not hmac.compare_digest((authorization or "").encode(), f"Bearer {expected}".encode()):
            raise HTTPException(401, "Unauthorized.")
        if not worker_url or not gateway_token:
            raise HTTPException(503, "Cloudflare gateway configuration is incomplete.")
        payload = json.dumps({"session_id": req.session_id, "prompt": req.prompt,
                              "agent": gateway_agent}).encode()
        gateway_request = urllib.request.Request(
            f"{worker_url}/api/agent-gateway", data=payload, method="POST",
            headers={"content-type": "application/json", "x-peer-gateway-token": gateway_token},
        )
        try:
            answer = await asyncio.to_thread(_read_gateway_response, gateway_request)
        except urllib.error.HTTPError as exc:
            detail = (await asyncio.to_thread(exc.read)).decode(errors="replace")[:240]
            raise HTTPException(exc.code, detail or "Cloudflare gateway request failed.") from None
        except (OSError, ValueError) as exc:
            raise HTTPException(502, f"Cloudflare gateway request failed: {exc}") from None
        return StreamingResponse(iter([answer]), media_type="text/plain", headers={
            "Cache-Control": "no-store", "X-Agent-Id": agent_id, "X-Agent-Mode": "cloudflare-gateway",
        })

    return app


def _read_gateway_response(request: urllib.request.Request) -> str:
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.loads(response.read().decode())
    answer = payload.get("answer") if isinstance(payload, dict) else None
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("Worker returned no answer")
    return answer
