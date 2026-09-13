# Forge / Larboard

Forge is a small full-stack AI conversation workspace. The browser provides the interface; model requests are handled server-side so AWS credentials never reach the client.

The application provides eight focused agents plus language-specialist support through a single conversation workspace.

## Agent harness and deployment

The Node server now uses `src/agent-harness.js` for all eight profiles, with a separate nested language specialist. It passes conversation history and the configured model to Bedrock, restricts tools by profile, enforces tool/model budgets and timeouts, removes internal analysis from final responses, and caps answers at 52 words. Operational tool input values are checked against user-supplied text; this rejects unsupported facts but is not a complete semantic fact checker.

Run `npm run test:harness` for deterministic harness checks and `npm run eval:agents` for nine live Bedrock smoke cases with JSON response/trace output. Live checks incur model usage and do not establish that the agents are perfect or that every answer is accurate.

The [September 12 quality evaluation](evaluations/2026-09-12/REPORT.md) records 15 questions across all nine roles, follow-up conversations, and repository retests. The Canadian model remains the default. Changes include retained specialist history, response formatting, a finite arithmetic tool, source-aware word notes, selective profile-authorized skill loading in Python, and one bounded retry for an empty final answer. Model answers still need review; successful execution does not establish factual quality.

Run `npm run eval:quality -- live .data/evaluations/new-live.json` for the public-site evaluation (eight public agents plus the local internal specialist), or use `python` instead of `live` for the local AgentCore entrypoint with real Bedrock calls. The Python mode requires `.venv`. Use a new output file for each code/model version; existing records are resumed, not rerun. Follow-ups: `npm run eval:quality -- live .data/evaluations/new-followups.json --followups .data/evaluations/new-live.json`. These commands incur inference charges and create synthetic test sessions.

An explicit, higher-cost global-routing model option is documented in [quality.env.example](deploy/agentcore/quality.env.example). It does not change Canadian defaults. Compare it using `--model=global.anthropic.claude-sonnet-4-6`; use `--agents=forge` or `--questions=draft,arithmetic` for a smaller run. Confirm the runtime execution role can invoke the chosen inference profile before deployment. No deployment is performed by these evaluation commands.

The selected deployment target is **Amazon Bedrock AgentCore**. See [AgentCore deployment instructions](deploy/agentcore/README.md) for the Python harness, direct-code packaging, deployment, and live evaluations. The Canadian default is `ca.amazon.nova-lite-v1:0`. The [EC2 files](deploy/ec2/README.md) remain an optional alternative. The Worker retains its separate implementation.

## Offline checks

Run `npm test` for deterministic tests and `npm run check` for Worker and local-server syntax checks. Both use Node.js 22+ and require no AWS credentials.

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
- **Daily rate-limit enforcement** — an agent pre-loaded at `count=100` receives a `429` response and Bedrock is never called.
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

Local and EC2 chat use [`server.mjs`](server.mjs) with the shared Node agent harness, profile tools, nested language specialist, bounded model calls, and conversation history. Its controls are tested independently from the Worker.

### AgentCore path

When `AGENTCORE_RUNTIME_ARN` is configured, the Worker forwards requests to the Python runtime in [`app/ForgeAgent/main.py`](app/ForgeAgent/main.py). It runs the eight profiles with shared parent/specialist budgets, configured Bedrock models, profile-specific tools, bundled skills, palette steering, isolated history, and sanitized responses. Optional S3 or DynamoDB settings enable external session storage; otherwise history is temporary within the runtime session.

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
BEDROCK_MODEL_ID=ca.amazon.nova-lite-v1:0
PORT=3000
```

The local Node server stores sessions under `.data/sessions/`. The deployed Worker stores web state in the configured R2 bucket.

## API overview

The runtime architecture is represented by the Worker, AgentCore, Python runtime, storage, and Good Neighbour components described throughout this document.

- `GET /api/health` — reports runtime region and model configuration.
- `GET /api/state` — loads the browser session state.
- `POST /api/state` — saves palette and workspace state.
- `POST /api/ask` — sends a prompt to the configured agent path.
- `POST /api/feedback` — records an explicit rating and optional correction for a completed answer.
- `GET /api/feedback/export` — exports collected feedback for authenticated review (`x-feedback-admin-token`).
- `GET /api/agents` — lists available agent profiles (Cloudflare Worker only).

Requests are bounded to 52 words, 16 characters per word, and 4,000 characters. Each agent has a daily limit of 10 model requests per session.

## Context-aware palette loading

Forge detects the user's context on first visit and loads a relevant palette template for the agents and language tools.

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

### GitHub deployment checklist

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The workflow builds the React site, validates the Worker, uploads the static pages and `site/dist` assets to the `larboard-assets` R2 bucket, and deploys the Worker to the `larboard.ca` custom domain. The GitHub repository must contain these Actions secrets:

- `CLOUDFLARE_API_TOKEN` — a token allowed to deploy Workers and manage the configured R2 bucket;
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account that owns `larboard` and `larboard-assets`.

The Cloudflare workflow does not deploy the Python AgentCore runtime or modify its Worker secret. Deploy `app/ForgeAgent/` separately with the AgentCore tooling, then set `AGENTCORE_RUNTIME_ARN` once as a Worker secret with `wrangler secret put AGENTCORE_RUNTIME_ARN` or the Cloudflare dashboard. When that Worker secret is present, the Worker forwards chat requests to the Python runtime; when it is absent, the Worker uses its Cloudflare/Bedrock agent loop. The two paths do not compete for the website route: Cloudflare owns `larboard.ca`, and Python is an upstream chat runtime selected by the Worker.

Never commit the ARN value to the repository or add it as a GitHub Actions secret. The deploy workflow includes a guard against concrete AgentCore ARNs. The browser only calls the Worker; the Worker keeps the ARN and AWS signing credentials private while invoking AgentCore.

The workflow intentionally fails early when the required Cloudflare secrets are missing. It does not read, replace, or delete `AGENTCORE_RUNTIME_ARN`, so an ARN already stored in the Worker remains available after every repository deployment.

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

The Worker agent loop is profile-driven in [`src/agents.js`](src/agents.js), using [`agentcore/profiles.js`](agentcore/profiles.js) as the shared registry. Larboard's profiles include `forge` (general coordinator), `food-bank` (shift and pantry coordination), `nonprofit-helpdesk` (small-organization operations), `mutual-aid` (requests, offers, and safe follow-up), `civic-knowledge` (plain-language local services and public processes), `bob-dylan` (Music Expert), `santa-claus` (Santa Claus), and `orange-doctor-candidatus` (orange reframing). The existing `forge` profile is the default, so existing clients do not need to send an agent id.

To add another Worker agent:

1. Add a profile to `AGENT_PROFILES` in [`src/agents.js`](src/agents.js).
2. Add or register its tools in [`tools/`](tools/) and list their names in `toolNames`.
3. Add its Markdown procedures under [`skills/`](skills/) and include them in `skillNames` and `SKILL_INDEX` in [`src/worker.js`](src/worker.js).
4. Select it with `{ "agent": "your-agent-id", "message": "..." }` on `POST /api/ask`, or send the `x-agent-id` header. Available profiles are returned by `GET /api/agents`.
5. Add an API or UI test that verifies tool allow-listing, profile-specific instructions, and session isolation when changing agents.

The Worker records `agentId` in session state and clears conversation history when a session switches profiles. This prevents one agent from inheriting another agent's conversational assumptions while preserving the shared workspace palette.

When `AGENTCORE_RUNTIME_ARN` is configured, the Worker forwards `agent_id` to the Python runtime. The Python runtime resolves the same profile registry, system prompt, tool allow-list, and limits, with the bundled registry kept synchronized for deployment. Keep profile definitions synchronized across both paths, or choose one path as the source of truth.

Agent tools follow the same source-controlled workflow. Executable tools live as JavaScript modules in [`tools/`](tools/); edit an existing module or add one and register it in [`tools/index.js`](tools/index.js). Pushing to `main` bundles the updated tool code into the Worker deployment. Tool descriptions and input schemas are exposed to Bedrock, while implementations execute inside the Worker, so review new tools carefully before deployment.

## Feedback and improvement pipeline

The chat UI provides a helpful/not-helpful control below each completed answer. A submitted rating is linked to the exact user request and assistant response, then stored under `feedback/` in the Worker R2 bucket. The correction field is optional and limited to 2,000 characters. Feedback is not inserted into prompts automatically and cannot deploy code.

Set the Worker secret `FEEDBACK_ADMIN_TOKEN` to protect the review export, then retrieve records with:

```bash
curl -H "x-feedback-admin-token: $FEEDBACK_ADMIN_TOKEN" https://larboard.ca/api/feedback/export
```

Reviewers can turn repeated corrections into tested prompt, skill, or tool changes. Run the offline suites and deploy the resulting Worker/AgentCore artifact only after review. The export contains the submitted request and response, so treat it as sensitive operational data and restrict access accordingly.

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

## Repository layout

```text
src/worker.js          Cloudflare Worker and JavaScript agent loop
server.mjs             Local Node server
app/ForgeAgent/        Python AgentCore runtime
agentcore/             AgentCore configuration
site/                  React/Vite frontend source
skills/                Language and agent support skills
tools/                 Language-specialist and community tools
```


### Simple conversation evaluation

The [simple-question report](evaluations/2026-09-12-simple/REPORT.md) tests all eight public profiles plus the internal Word Specialist with 15 everyday questions. Each scenario keeps its own session across four user turns; reviewed weak live answers receive a targeted fifth turn. It includes typo correction, whole apples, short drafts, basic rhymes, pretend play, and remembering a name.

Run `npm run eval:simple -- live path/to/new-run.json` for the website plus the local Node specialist, or replace `live` with `python` or `node` for the local runtime using real Bedrock inference. Use a new output file after changing code. `--turns=1` runs the initial questions only; `--suite=holdout` runs new cup/pear scenarios. `--followups=evaluations/2026-09-12-simple/live-followup-prompts.json` adds the reviewed fifth turns to an existing run with its original sessions. Requests use synthetic data and incur inference charges; these commands do not deploy anything.

`node scripts/score-simple.js path/to/run.json path/to/screen.json` checks selected count, length, and output symptoms. These flags do not measure full answer quality. The report separates assistant-reviewed answers, execution failures, deployment surfaces, and remaining weaknesses.
