"""Load this host's secret through its instance role, then run one peer."""
import json
import os

import boto3
import uvicorn

from ai.agents.common import REGIONS, missing_settings


def load_secret(agent_id: str) -> None:
    secret_arn = os.environ.get("AGENT_SECRET_ARN")
    if not secret_arn:
        return  # Local development can use environment variables directly.
    client = boto3.client("secretsmanager", region_name=os.environ["AWS_REGION"])
    values = json.loads(client.get_secret_value(SecretId=secret_arn)["SecretString"])
    allowed = {f"{agent_id.upper()}_INVOKE_TOKEN", f"{agent_id.upper()}_MODEL"}
    allowed |= {"agy": {"GOOGLE_API_KEY"}, "codex": {"OPENAI_API_KEY"}, "kiro": set()}[agent_id]
    if not isinstance(values, dict) or set(values) - allowed:
        raise ValueError("Secret contains unexpected configuration keys")
    for key, value in values.items():
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Invalid value for {key}")
        os.environ[key] = value


def main():
    agent_id = os.environ["AGENT_ID"]
    if agent_id not in REGIONS or os.environ["AWS_REGION"] != REGIONS[agent_id]:
        raise ValueError("Agent identity and region do not match the fleet registry")
    load_secret(agent_id)
    missing = missing_settings(agent_id)
    if missing:
        raise ValueError("Missing settings: " + ", ".join(missing))
    uvicorn.run(f"ai.agents.{agent_id}.main:app", host="127.0.0.1", port=8080,
                workers=1, access_log=False, limit_concurrency=16)


if __name__ == "__main__":
    main()
