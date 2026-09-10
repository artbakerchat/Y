# Forge / Larboard

Forge is a small full-stack AI conversation workspace. The browser provides the interface; model requests are handled server-side so AWS credentials never reach the client.

The application is focused on word exploration and palette building rather than the customer-service scenario used by the workshop material in [`modules/`](modules/).

## Architecture

The repository has two agent execution paths:

```text
Browser
  |
  v
Cloudflare Worker (`src/worker.js`)
  |-- AGENTCORE_RUNTIME_ARN set --> Python AgentCore runtime (`app/ForgeAgent`)
  `-- otherwise ------------------> local JavaScript Bedrock agent loop
```

### Local JavaScript path

The Worker implements the agent loop directly with the Amazon Bedrock Converse API. It includes:

- palette tools for reading, searching, and expanding the user's word palette;
- markdown skills selected from message keywords, with R2 and inline fallbacks;
- a deterministic per-request tool-call limiter;
- pre-tool steering for palette suggestions;
- a best-effort post-response quality review;
- a word-craft specialist invoked as a second Bedrock call;
- session state stored in Cloudflare R2.

Basic local chat is also available through [`server.mjs`](server.mjs). That server prefers the Strands SDK when it is installed and otherwise uses a simpler Bedrock Converse fallback; it does not mirror every Worker-side tool and control.

### AgentCore path

When `AGENTCORE_RUNTIME_ARN` is configured, the Worker forwards requests to the Python runtime in [`app/ForgeAgent/main.py`](app/ForgeAgent/main.py). That runtime is intentionally simpler: it creates a Strands conversational agent, injects the current palette, restores message history, streams the response, and persists messages in DynamoDB. It does not currently reproduce the Worker's tools, hooks, skills, steering, or specialist implementation.

## Requirements

- Node.js 22 or newer for local development
- AWS credentials available through the normal AWS credential chain
- Amazon Bedrock access in the selected region
- Python 3.10+ only when building or deploying the AgentCore runtime

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open <http://localhost:3000>.

The `.env` file may define:

```env
AWS_REGION=ca-central-1
BEDROCK_MODEL_ID=amazon.nova-micro-v1:0
PORT=3000
```

The local Node server stores sessions under `.data/sessions/`. The deployed Worker stores web state in the configured R2 bucket.

## API overview

- `GET /api/health` — reports runtime region and model configuration.
- `GET /api/state` — loads the browser session state.
- `POST /api/state` — saves palette and workspace state.
- `POST /api/ask` — sends a prompt to the configured agent path.

Requests are bounded to 52 words, 16 characters per word, and 4,000 characters. Each session has a daily limit of 20 model requests.

## Cloudflare deployment

The production Worker is configured by [`wrangler.jsonc`](wrangler.jsonc). It uses:

- R2 for session state and optional skill files;
- a Cloudflare rate limiter for legacy URL redirects;
- Amazon Bedrock directly for the local Worker loop, or AgentCore when `AGENTCORE_RUNTIME_ARN` is present.

Set the required AWS credentials and runtime variables as encrypted Worker secrets or environment configuration. For AgentCore routing, configure `AGENTCORE_RUNTIME_ARN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, and `AWS_REGION`.

The Worker signs both AgentCore and Bedrock requests with AWS Signature Version 4.

## AgentCore runtime

The Python runtime is configured in [`agentcore/agentcore.json`](agentcore/agentcore.json), with code in [`app/ForgeAgent/`](app/ForgeAgent/). Its dependencies are declared in [`app/ForgeAgent/pyproject.toml`](app/ForgeAgent/pyproject.toml).

The runtime uses:

- S3 for palettes when `FORGE_PALETTE_BUCKET` is set;
- DynamoDB for conversation messages when `FORGE_SESSION_TABLE` is set;
- a 48-hour application-level expiry for both kinds of stored state.

The DynamoDB table must use `session_id` as its partition key. Configure DynamoDB TTL and S3 lifecycle policies separately if automatic physical cleanup is required.

## Workshop modules

The Markdown files in [`modules/`](modules/) are educational material. They describe a Python/Strands customer-service agent built progressively through tools, hooks, skills, steering, session managers, AgentCore deployment, optional multi-agent delegation, and evaluations.

They are reference material, not the exact implementation of Forge. The repository includes the shared mock customer-service tools, but it does not include the workshop's referenced notebooks, full steering handlers, skill directories, or evaluation suite.

| Workshop concept | Forge implementation |
| --- | --- |
| Agent loop | Manual Bedrock Converse loop in `src/worker.js` |
| Tools | Palette and word tools rather than customer/order tools |
| Hooks | JavaScript per-request tool-call limiter |
| Skills | Keyword-selected Markdown procedures |
| Steering | Palette prerequisite check and best-effort response review |
| Sessions | R2 in the Worker; S3/DynamoDB in the Python runtime |
| Multi-agent | Word specialist as a second Bedrock call |
| Evals | Not implemented yet |

## Repository layout

```text
src/worker.js          Cloudflare Worker and JavaScript agent loop
server.mjs             Local Node server
app/ForgeAgent/        Python AgentCore runtime
agentcore/             AgentCore configuration
site/                  React/Vite frontend source
modules/               Workshop guides and shared examples
```
