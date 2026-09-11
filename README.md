# Forge / Larboard

Forge is a small full-stack AI conversation workspace. The browser provides the interface; model requests are handled server-side so AWS credentials never reach the client.

The application focuses on word exploration and palette building. [`modules/`](modules/) contains workshop guides, and [`centre/`](centre/) contains the customer-service reference notebooks and scripts. See [the workshop-to-Forge map](modules/README.md) for how their patterns apply to this application.

## Offline checks

Run `npm test` for deterministic tests and `npm run check` for Worker and local-server syntax checks. Both use Node.js 22+ and require no dependencies or AWS credentials. GitHub Actions also runs the existing Python evaluations with `python -m unittest discover -s evals -p 'test_*.py'`.

### Test suite

`npm test` runs all files matching `tests/*.test.js` with Node's built-in test runner. The suite currently includes:

| File | Tests | What it covers |
| --- | --- | --- |
| `tests/tool-controls.test.js` | 10 unit tests | Tool controller: prerequisites, per-tool limits, error boundaries, ledger immutability |
| `tests/integration.test.js` | 12 integration tests | Full Worker request cycle with mocked Bedrock and in-memory R2 |

#### Integration tests (`tests/integration.test.js`)

The integration tests invoke the Worker's `fetch()` handler directly — the same code path that runs in production. Bedrock Converse calls are intercepted by a mock that returns scripted fixture responses (tool-use turns followed by an end-turn), and R2 is replaced by an in-memory store. No AWS credentials or network access are required.

Critical paths covered:

- **Palette fetch → word suggestion flow** — the agent calls `get_palette`, then `suggest_related_words`, then produces a final text reply; the answer and saved session state are verified.
- **Empty palette** — `get_palette` returns the "palette is empty" message and the cycle completes without error.
- **Daily rate-limit enforcement** — a session pre-loaded at `count=8` receives a `429` response and Bedrock is never called.
- **Session state persistence** — two consecutive requests to the same session accumulate history and increment the rate counter correctly.
- **Agent profile isolation** — continuing with the same `forge` profile preserves conversation history.
- **Input validation** — oversized word counts, oversized individual words, and empty messages are all rejected before reaching Bedrock.
- **Expired session handling** — a stored session past its TTL is discarded and a fresh state is initialised.
- **Prerequisite enforcement in the full cycle** — a model that skips `get_palette` and calls `suggest_related_words` directly receives a blocked-tool error result; the cycle still completes.
- **Health and agents endpoints** — `GET /api/health` and `GET /api/agents` return the expected shapes.

#### Mock fixtures

Fixture helpers live at the top of `tests/integration.test.js`:

```js
bedrockToolUseResponse(toolName, toolInput, toolUseId)  // simulates a tool_use stop
bedrockEndTurnResponse(text)                            // simulates an end_turn stop
```

Pass an ordered array of these fixtures to `withMockFetch(responseQueue, fn)` — each Bedrock call consumes the next fixture from the queue. The in-memory R2 mock is created with `createMockBucket(initialObjects)` and exposes a `_store` Map for post-request assertions.

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

Full API documentation is in [`docs/API.md`](docs/API.md) with curl examples,
and the machine-readable OpenAPI 3.0 spec is in [`docs/openapi.yaml`](docs/openapi.yaml).

The runtime architecture is visualized in [`architecture.html`](architecture.html), a HyperFrames-compatible HTML composition showing the Worker, AgentCore, Python runtime, storage, and Good Neighbour roles.

The Good Neighbour launch post is drafted in [`docs/good-neighbour-agents.md`](docs/good-neighbour-agents.md).

- `GET /api/health` — reports runtime region and model configuration.
- `GET /api/state` — loads the browser session state.
- `POST /api/state` — saves palette and workspace state.
- `POST /api/ask` — sends a prompt to the configured agent path.
- `GET /api/agents` — lists available agent profiles (Cloudflare Worker only).

Requests are bounded to 52 words, 16 characters per word, and 4,000 characters. Each session has a daily limit of 8 model requests.

## Context-aware palette loading

Forge detects the user's context on first visit and loads a relevant palette template. This aligns with the community-focused vision in [`builder-story.md`](builder-story.md).

### How it works

1. **First-time visitors**: When a new session is created, Forge detects context from:
   - URL parameters: `?context=volunteering`, `?context=teaching`, etc.
   - First message keywords: detecting "volunteer," "lesson," "food," "research," etc.

2. **Palette templates**: Each context has a pre-built palette of relevant words and a story explaining the palette's purpose:

   - **volunteering**: Coordinates volunteers, shifts, schedules, and team matching
   - **teaching**: Scaffolds lessons, assessments, and diverse learners
   - **library**: Manages patrons, collections, and community access
   - **foodbank**: Organizes donations, distributions, and food security
   - **contracting**: Handles compliance, deadlines, and documentation
   - **content_creator**: Designs lesson materials and learning progressions
   - **researcher**: Organizes papers, synthesizes findings, and manages research
   - **household**: Coordinates family calendars and shared responsibilities
   - **wellness**: Tracks habits, goals, and personal growth
   - **default**: General word exploration and creative writing

3. **Persistence**: The selected palette persists for 48 hours. Users can edit it at any time, and their edits are saved.

4. **Display**: The palette story appears on first load (or first revisit after 48h) as italicized text with a left border accent, explaining the palette's purpose and inviting customization.

### Using context detection

**URL parameters** (explicit):
```
http://localhost:3000/?context=volunteering
```

**First message keywords** (implicit):
- Type "I need help organizing volunteers" → loads volunteering palette
- Type "How do I scaffold this lesson?" → loads teaching palette
- Type "Managing a food drive" → loads foodbank palette

### Adding a new palette template

Edit [`src/palettes.js`](src/palettes.js) and add an entry to `PALETTE_TEMPLATES`:

```javascript
newcontext: {
  id: 'newcontext',
  name: 'Context Name',
  description: 'What this palette is for',
  tags: ['tag1', 'tag2'],
  words: ['word1', 'word2', /* ... up to 52 words ... */],
  story: 'This palette helps with...',
  context: { type: 'category', role: 'role', scale: 'scale' },
}
```

Then add keywords to `detectPaletteContext()` to trigger automatic detection:

```javascript
keywords.newcontext = ['keyword1', 'keyword2', 'keyword3'];
```

## Cloudflare deployment

The production Worker is configured by [`wrangler.jsonc`](wrangler.jsonc). It uses:

- R2 for session state and optional skill files;
- a Cloudflare rate limiter for legacy URL redirects;
- Amazon Bedrock directly for the local Worker loop, or AgentCore when `AGENTCORE_RUNTIME_ARN` is present.

The presentation is available at [`/presentation`](presentation.html) in local and Worker routing. The legacy `/presentation.html` path redirects to the canonical route.

Set the required AWS credentials and runtime variables as encrypted Worker secrets or environment configuration. For AgentCore routing, configure `AGENTCORE_RUNTIME_ARN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, and `AWS_REGION`.

The Worker signs both AgentCore and Bedrock requests with AWS Signature Version 4.

## Edit skills

The editable skill source files live in [`skills/`](skills/). Add a Markdown file with frontmatter, commit it, and push to `main`. The GitHub Actions workflow uploads every `skills/*.md` file to the `skills/` prefix in R2 before deploying the Worker.

```md
---
name: research-workflow
description: A procedure for investigating questions carefully.
keywords: research, investigate, sources, evidence
agents: researcher
---

# Research Workflow

1. Clarify the question.
2. Search the approved sources.
3. Separate evidence from interpretation.
4. Identify uncertainty.
5. Summarize the findings.
```

The Worker discovers Markdown skills from R2, matches the request against `keywords`, and loads the selected procedure. `agents: *` makes a skill available to every profile; `agents: researcher` restricts it to one profile. The Forge profile uses `skillNames: '*'`, so adding a valid Markdown skill does not require a JavaScript edit or a change to `SKILL_INDEX`.

R2 is checked before the Worker's inline fallback skills. This means the committed Markdown files become the production source of truth after the deployment workflow runs. Markdown skills can change procedures and response behavior, but they cannot create new tools or enforce security-critical rules; those still belong in [`tools/`](tools/) and Worker steering code.

## Add a customizable Worker agent

The Worker agent loop is profile-driven in [`src/agents.js`](src/agents.js), using [`agentcore/profiles.js`](agentcore/profiles.js) as the shared registry. Larboard's profiles include `forge` (general coordinator), `food-bank` (shift and pantry coordination), `nonprofit-helpdesk` (small-organization operations), `mutual-aid` (requests, offers, and safe follow-up), `civic-knowledge` (plain-language local services and public processes), `bob-dylan` (Music Expert), and `santa-claus` (Santa Claus). The existing `forge` profile is the default, so existing clients do not need to send an agent id.

To add another Worker agent:

1. Add a profile to `AGENT_PROFILES` in [`src/agents.js`](src/agents.js).
2. Add or register its tools in [`tools/`](tools/) and list their names in `toolNames`.
3. Add its Markdown procedures under [`skills/`](skills/) and include them in `skillNames` and `SKILL_INDEX` in [`src/worker.js`](src/worker.js).
4. Select it with `{ "agent": "your-agent-id", "message": "..." }` on `POST /api/ask`, or send the `x-agent-id` header. Available profiles are returned by `GET /api/agents`.
5. Add an API or UI test that verifies tool allow-listing, profile-specific instructions, and session isolation when changing agents.

The Worker records `agentId` in session state and clears conversation history when a session switches profiles. This prevents one agent from inheriting another agent's conversational assumptions while preserving the shared workspace palette.

When `AGENTCORE_RUNTIME_ARN` is configured, the Worker forwards `agent_id` to the Python runtime. The Python runtime resolves the same profile registry, system prompt, tool allow-list, and limits, with the bundled registry kept synchronized for deployment. Keep profile definitions synchronized across both paths, or choose one path as the source of truth.

Agent tools follow the same source-controlled workflow. Executable tools live as JavaScript modules in [`tools/`](tools/); edit an existing module or add one and register it in [`tools/index.js`](tools/index.js). Pushing to `main` bundles the updated tool code into the Worker deployment. Tool descriptions and input schemas are exposed to Bedrock, while implementations execute inside the Worker, so review new tools carefully before deployment.

## AgentCore runtime

The Python runtime is configured in [`agentcore/agentcore.json`](agentcore/agentcore.json), with code in [`app/ForgeAgent/`](app/ForgeAgent/). Its dependencies are declared in [`app/ForgeAgent/pyproject.toml`](app/ForgeAgent/pyproject.toml).

The runtime uses:

- S3 for palettes when `FORGE_PALETTE_BUCKET` is set;
- S3 session persistence when `FORGE_SESSION_BUCKET=forge-session` is set, using the `forge-sessions/` prefix;
- DynamoDB for conversation messages when `FORGE_SESSION_BUCKET` is not set and `FORGE_SESSION_TABLE` is configured;
- the bundled `app/ForgeAgent/skills/` directory when deployed through `agentcore.json`;
- a 48-hour application-level expiry for both kinds of stored state.

The DynamoDB table must use `session_id` as its partition key. Configure DynamoDB TTL and S3 lifecycle policies separately if automatic physical cleanup is required.

For the current AgentCore deployment, set these runtime environment variables through the AgentCore deployment configuration or console:

```text
FORGE_SESSION_BUCKET=forge-session
FORGE_SESSION_PREFIX=forge-sessions/
```

The runtime's IAM role must allow `s3:HeadBucket`, `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` for the bucket and its `forge-sessions/` objects.

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
