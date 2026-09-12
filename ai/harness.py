"""Single entrypoint for the Larboard Python peer-agent fleet.

The harness owns fleet selection and process startup. Each peer keeps its own
tools, model, region, and session prefix, while sharing the same HTTP contract.
Provider SDKs are imported by the selected peer, so listing or validating the
fleet remains useful on a clean machine.
"""
from __future__ import annotations

import argparse
import importlib
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentSpec:
    agent_id: str
    region: str
    module: str
    endpoint: str


AGENTS = {
    "agy": AgentSpec("agy", "us-west-2", "ai.agents.agy.main", "https://agy.larboard.ca/invoke"),
    "kiro": AgentSpec("kiro", "ca-central-1", "ai.agents.kiro.main", "https://kiro.larboard.ca/invoke"),
    "codex": AgentSpec("codex", "eu-west-3", "ai.agents.codex.main", "https://codex.larboard.ca/invoke"),
}


def get_agent(agent_id: str):
    """Import and return the FastAPI app for one registered agent."""
    try:
        spec = AGENTS[agent_id]
    except KeyError as exc:
        valid = ", ".join(sorted(AGENTS))
        raise ValueError(f"Unknown agent {agent_id!r}; choose one of: {valid}") from exc
    return importlib.import_module(spec.module)


def get_app(agent_id: str):
    """Return a peer app, using the Worker gateway when configured."""
    module = get_agent(agent_id)
    if os.environ.get("CLOUDFLARE_WORKER_URL", "").strip():
        from ai.agents.common import create_gateway_app
        return create_gateway_app(agent_id)
    return module.app


def validate_fleet() -> list[str]:
    """Return configuration errors without importing provider SDKs."""
    errors = []
    regions = [spec.region for spec in AGENTS.values()]
    endpoints = [spec.endpoint for spec in AGENTS.values()]
    if len(regions) != len(set(regions)):
        errors.append("each agent must have a unique AWS region")
    if len(endpoints) != len(set(endpoints)):
        errors.append("each agent must have a unique endpoint")
    for agent_id, spec in AGENTS.items():
        if agent_id != spec.agent_id:
            errors.append(f"registry key {agent_id!r} does not match its agent id")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one Larboard Python peer agent")
    parser.add_argument("agent", choices=sorted(AGENTS), nargs="?", help="peer to run")
    parser.add_argument("--list", action="store_true", help="list registered peers")
    parser.add_argument("--validate", action="store_true", help="validate fleet registry")
    parser.add_argument("--host", default=os.getenv("AGENT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("AGENT_PORT", "8080")))
    args = parser.parse_args(argv)

    if args.list:
        for spec in AGENTS.values():
            print(f"{spec.agent_id}\t{spec.region}\t{spec.endpoint}")
        return 0
    errors = validate_fleet()
    if args.validate:
        if errors:
            for error in errors:
                print(f"ERROR: {error}")
            return 1
        print(f"Fleet valid: {len(AGENTS)} agents")
        return 0
    if not args.agent:
        parser.error("an agent is required unless --list or --validate is used")
    if errors:
        raise SystemExit("Invalid fleet: " + "; ".join(errors))

    import uvicorn
    uvicorn.run(get_app(args.agent), host=args.host, port=args.port, workers=1, access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
