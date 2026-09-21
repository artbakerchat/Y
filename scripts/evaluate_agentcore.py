"""Exercise the real Python AgentCore entrypoint; --runtime-arn tests deployment."""
import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))

CASES = [
    ("forge", "Help plan a neighbourhood cleanup."),
    ("food-bank", "We have two volunteers but no confirmed shifts. What should we check?"),
    ("nonprofit-helpdesk", "Draft a short volunteer welcome note."),
    ("mutual-aid", "How can I request groceries without sharing my home address publicly?"),
    ("civic-knowledge", "How do I find my local council meeting schedule?"),
    ("bob-dylan", "Explain how folk songs tell stories."),
    ("santa-claus", "Can I have a present?"),
    ("orange-doctor-candidatus", "I feel stuck starting a project. Give one small next step."),
    ("word-specialist", "anchor"),
]


async def evaluate(runtime_arn=None):
    import main
    import boto3
    client = boto3.client("bedrock-agentcore", region_name=os.getenv("AWS_REGION", "ca-central-1")) if runtime_arn else None
    failures = 0
    for profile_id, prompt in CASES:
        try:
            payload = {"mode": "advanced", "agent_id": profile_id, "prompt": prompt, "palette": ["anchor", "apple", "horizon"]}
            session_id = str(uuid.uuid4())
            if client:
                response = client.invoke_agent_runtime(agentRuntimeArn=runtime_arn, runtimeSessionId=session_id, payload=json.dumps(payload).encode())
                raw = response["response"].read().decode()
                events = [json.loads(line.removeprefix("data: ")) for line in raw.splitlines() if line.startswith("data: ")]
                if not events:
                    raise ValueError(f"Unexpected runtime response: {raw[:250]}")
            else:
                events = [event async for event in main.invoke(payload, SimpleNamespace(session_id=session_id))]
            answer = "".join(event.get("event", {}).get("contentBlockDelta", {}).get("delta", {}).get("text", "") for event in events)
            if not answer or len(answer.split()) > 52 or "<thinking>" in answer:
                raise ValueError("Invalid answer contract")
            if profile_id == "santa-claus" and "apple" not in answer.lower():
                raise ValueError("Missing apple prerequisite")
            if profile_id == "bob-dylan" and not answer.startswith("hi y’all!"):
                raise ValueError("Missing first-turn greeting")
            print(json.dumps({"agent_id": profile_id, "status": "pass", "answer": answer}), flush=True)
        except Exception as error:
            failures += 1
            print(json.dumps({"agent_id": profile_id, "status": "fail", "error": str(error)}), flush=True)
    print(json.dumps({"cases": len(CASES), "failures": failures, "target": "deployed" if client else "local Python entrypoint"}))
    return bool(failures)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-arn")
    args = parser.parse_args()
    sys.exit(asyncio.run(evaluate(args.runtime_arn)))
