"""
kiro — AWS Kiro Agent
Region: ca-central-1 (Montreal)
Provider: AWS Bedrock (Claude Sonnet)
Domain: AWS-native workflows, S3 session persistence, AgentCore deployment
"""
import os
from strands import Agent, tool
from strands.session import S3SessionManager
from strands.conversation import SlidingWindowConversationManager
from common import CONVERSATION_GUIDANCE
from strands.hooks import RateLimiterHook

# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def list_s3_buckets(prefix: str = "") -> str:
    """List S3 buckets, optionally filtered by prefix."""
    import boto3
    s3 = boto3.client("s3", region_name="ca-central-1")
    buckets = s3.list_buckets().get("Buckets", [])
    names = [b["Name"] for b in buckets if b["Name"].startswith(prefix)]
    return "\n".join(names) or "No buckets found."


@tool
def describe_ec2_instances(region: str = "ca-central-1") -> str:
    """Describe running EC2 instances in the given region."""
    import boto3
    ec2 = boto3.client("ec2", region_name=region)
    reservations = ec2.describe_instances(
        Filters=[{"Name": "instance-state-name", "Values": ["running"]}]
    ).get("Reservations", [])
    instances = [i for r in reservations for i in r["Instances"]]
    return "\n".join(
        f"{i['InstanceId']} ({i.get('InstanceType')}) — {region}"
        for i in instances
    ) or "No running instances."


@tool
def agentcore_deploy(agent_dir: str) -> str:
    """Trigger an AgentCore deployment for the given agent directory."""
    import subprocess
    result = subprocess.run(
        ["agentcore", "deploy"],
        cwd=agent_dir,
        capture_output=True, text=True
    )
    return result.stdout or result.stderr


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = f"""{CONVERSATION_GUIDANCE}

You are kiro, an AWS Kiro agent running on EC2 in ca-central-1 (Montreal).
You specialise in:
  • AWS-native workflows (EC2, S3, Bedrock, AgentCore)
  • Session persistence and conversation management via S3
  • Deploying and managing AgentCore runtimes
  • Canadian-region data residency and compliance

Always identify yourself as 'kiro (Montreal)' at the start of a session.
"""


def build_agent(session_id: str) -> Agent:
    session_manager = S3SessionManager(
        session_id=session_id,
        bucket=os.environ["FORGE_SESSION_BUCKET"],
        prefix=os.environ.get("FORGE_SESSION_PREFIX", "kiro-sessions/"),
    )
    return Agent(
        model_id=os.environ.get(
            "KIRO_MODEL",
            "ca.anthropic.claude-3-5-haiku-20241022-v1:0"
        ),
        tools=[list_s3_buckets, describe_ec2_instances, agentcore_deploy],
        hooks=[RateLimiterHook(max_calls=5)],
        system_prompt=SYSTEM_PROMPT,
        session_manager=session_manager,
        conversation_manager=SlidingWindowConversationManager(window_size=20),
    )


# ---------------------------------------------------------------------------
# HTTP entrypoint
# ---------------------------------------------------------------------------

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="kiro — larboard.ca Montreal Agent")


class InvokeRequest(BaseModel):
    session_id: str
    prompt: str


def require_invoke_token(authorization: Optional[str]) -> None:
    expected = os.environ.get("KIRO_INVOKE_TOKEN")
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
    return {"agent": "kiro", "region": "ca-central-1", "status": "ok"}
