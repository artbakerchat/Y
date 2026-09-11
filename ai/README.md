# Larboard peer agent fleet

This directory contains three independently hosted specialist agents. The
Cloudflare Worker is the public router; the EC2 services are private backends.

## Shared service contract

Each service exposes:

```http
POST /invoke
Authorization: Bearer <agent-specific-token>
Content-Type: application/json

{"session_id":"browser-session-id","prompt":"..."}
```

The response is a streamed `text/plain` body. `GET /health` is intentionally
unauthenticated and returns the agent name, region, and status.

Configure one token on each host:

```text
AGY_INVOKE_TOKEN=...
KIRO_INVOKE_TOKEN=...
CODEX_INVOKE_TOKEN=...
```

The Worker should store the corresponding tokens as secrets and send them only
to the selected peer endpoint. Do not put tokens in the browser or commit them
to `agents.yaml`.

## Peer roles

- `agy`: code generation, GCP tooling, and peer review delegation.
- `kiro`: AWS, S3, Bedrock, and AgentCore operations.
- `codex`: code synthesis, explanation, and GDPR review.

`agents.yaml` is routing metadata, not a credential file. It defines the HTTPS
invoke endpoints and the session-storage ownership for each peer.

## Local service example

Run each service from its own directory with the required provider dependencies:

```bash
uvicorn main:app --host 0.0.0.0 --port 8080
```

Production traffic should reach these services through authenticated HTTPS
(for example, Cloudflare Tunnel plus service tokens). The peer-to-peer tool in
`agy` uses the same `/invoke` contract and bearer-token authentication.
