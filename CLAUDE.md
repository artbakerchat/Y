# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

**Development:**
- `npm install` — Install dependencies
- `npm run build` — Build React frontend to `site/dist/`
- `npm run dev` — Start Node.js server (port 3000)
- `npm run check` — Validate syntax, profiles, skills, and conversation policy
- `npm test` — Run tests with Node's test runner

**Code Quality:**
- `npm run validate-skills` — Check Markdown skill files for valid frontmatter and structure
- `npm run validate-profiles` — Ensure profiles.js matches Python bundle
- `npm run validate-conversation-policy` — Ensure policy text is synchronized across runtimes

**Full Local Dev Flow:**
```bash
npm install
npm run build
npm run dev
# Open http://localhost:3000
```

## Architecture

### Core System: Larboard Multi-Agent Platform

This is **Larboard**, a multi-agent system enforcing a shared conversational policy across different specialist agents. Every agent response must follow the 10-rule conversational policy in `agentcore/conversation-policy.js`.

**Key principle:** Policy is enforced at runtime. Agent personas, training data, and feedback can only refine behavior *within* the policy contract—they cannot amend it. Policy changes require explicit review (see AGENTS.md).

### Bee Chat Frontend

The user-facing interface in `site/` is a React + Vite app:
- **App.tsx** — Single chat UI component with message history, loading states, and error handling
- **main.tsx** — React entry point
- **Vite config** — Proxies `/api/*` requests to the backend during dev
- **Build output** — Compiled to `site/dist/` and served by the Node.js server

### Backend Architecture

**Server (server.mjs):**
- HTTP server handling static files and API routes
- Session management with file-based storage (`.data/sessions/`)
- Session cookie extraction and UUID validation
- 48-hour TTL on session files with automatic expiration
- CORS headers enabled for development

**Session Flow:**
1. Client sends POST to `/api/chat` with `{ message, history }`
2. Server loads session from disk using session ID from cookie
3. Chat handler calls AWS Bedrock Nova model with full message history
4. Response is appended to session, session saved with new expiry
5. Client receives response and session cookie is set

**API Endpoints:**
- `POST /api/chat` — Send message, get response from Nova model
- `GET /api/messages` — Fetch all cross-session messages (global message board)
- `POST /api/messages` — Post a message to the global message board (visible to all sessions)
- `GET /` — Serve React app (index.html)
- `GET /*` — Serve compiled assets from `site/dist/`

### Agent Infrastructure

The AgentCore runtime defaults to a local-style single-agent request path:
`prompt + session history -> shared policy -> one simple Forge agent -> response`.
The existing profile/tool/skill path is retained as an explicit opt-in by sending
`mode: "advanced"` to the runtime. The Worker selects this mode only when the
`FORGE_ADVANCED_MODE` environment setting is exactly `true`.

**Profiles (agentcore/profiles.js):**
- Registry of agent personas (forge, food-bank, nonprofit-helpdesk, mutual-aid, civic-knowledge, bob-dylan, santa-claus, orange-doctor-candidatus, word-specialist)
- Each profile defines: system prompt, allowed tools, skill names, rate limits, specialist tools
- Profiles must be kept in sync across JavaScript (profiles.js) and Python (app/ForgeAgent/profiles.json)

**Conversation Policy (agentcore/conversation-policy.js):**
- 10 core rules governing all agents (answer actual requests, distinguish facts from assumptions, describe actions honestly, etc.)
- The policy is wrapped by `withConversationPolicy()` helper that combines it with runtime guidance
- Python and JavaScript bundles must stay synchronized (validated by `npm run check`)

### Validation & Testing

**Validation Scripts** (`scripts/validate-*.js`):
- `validate-skills.js` — Checks Markdown skill files for required frontmatter (name, description, type) and correct formatting
- `validate-profiles.js` — Compares JavaScript profiles.js with Python profiles.json to catch drift before deployment
- `validate-conversation-policy.js` — Ensures conversation_policy.json (Python) matches conversation-policy.js (JavaScript)

**Evaluation Framework** (extensive evaluation suite):
- `evaluate-agents.js` — Quick smoke test of all profiles
- `evaluate-simple.js` — Real inference over simple questions (arithmetic, plain language, memory, etc.)
- `evaluate-specialized.js` — Specialized agent behavior tests with held-out test cases
- Reports compare model versions and track quality metrics

### Data Storage

- **Sessions**: `.data/sessions/{sessionId}.json` — Conversation history with expiry timestamp
- **Global Messages**: `.data/global-messages.json` — Cross-session message board, visible to all sessions
- **Evaluation Results**: `.data/evaluations/` — Timestamped test runs for quality tracking
- **Deployment State**: `.data/agentcore-deployment.json` — AWS runtime ARN and credentials (not tracked in git)

## Key Files & Responsibilities

| File | Purpose |
|------|---------|
| `server.mjs` | HTTP server, session routing, static file serving |
| `api/chat.js` | AWS Bedrock Nova integration, message formatting |
| `site/src/App.tsx` | React chat UI component |
| `agentcore/conversation-policy.js` | Canonical 10-rule conversational policy (keep Python bundle in sync) |
| `agentcore/profiles.js` | Agent registry (keep Python bundle in sync) |
| `package.json` | npm scripts for build, validate, test, check |
| `AGENTS.md` | Policy governance and agent deployment rules |

## Important Constraints

1. **Conversation Policy is Immutable**: The policy in `conversation-policy.js` cannot be amended by training examples or feedback. Only explicit, reviewed policy changes apply. See AGENTS.md for the governance process.

2. **Keep Python & JavaScript in Sync**: 
   - `agentcore/profiles.js` ↔ `app/ForgeAgent/profiles.json`
   - `agentcore/conversation-policy.js` ↔ `app/ForgeAgent/conversation_policy.json`
   - Run `npm run check` before deployment to catch drift.

3. **Session Expiry**: Sessions expire after 48 hours (`sessionTtlMs = 48 * 60 * 60 * 1000`). Expired sessions return empty history.

4. **Cross-Session Messaging**: Sessions can communicate via a shared global message board. Session files are isolated by UUID, but a global message store at `.data/global-messages.json` allows any session to read/post cross-session messages. Session data is kept on disk only—no in-memory cache.

5. **No Manual Policy Overrides**: Code cannot claim "the policy does not apply" or override a policy rule with a runtime flag or environment variable. Policy violations must be fixed through explicit reviewed changes.

## Common Workflows

### Adding a New Agent Profile

1. Add entry to `agentcore/profiles.js` with id, name, description, systemPrompt, toolNames, skillNames, limits
2. Update `app/ForgeAgent/profiles.json` with matching entry
3. Run `npm run validate-profiles` to verify they stay in sync
4. Add test cases to `scripts/simple-questions.js` or `scripts/specialized-questions.js`
5. Run evaluation: `npm run evaluate-agents` or full test suite

### Making a Policy Change

1. **Critical**: Treat as a governance decision, not a code fix
2. Edit `agentcore/conversation-policy.js` (10-rule CONVERSATION_POLICY constant)
3. Update Python bundle `app/ForgeAgent/conversation_policy.json` with same text
4. Run `npm run validate-conversation-policy` to confirm sync
5. Document the change in a commit message with explicit reasoning
6. See AGENTS.md for full review process

### Testing Message Flow End-to-End

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Test with curl
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","history":[]}'
```

### Debugging Session Issues

1. Check session file: `cat .data/sessions/{sessionId}.json`
2. Verify expiry time is in future: `node -e "console.log(new Date(Date.now() + 48*60*60*1000))"`
3. Check browser cookie: DevTools → Application → Cookies → `larboard_session`
4. Session cookie validation regex: `/^[a-f0-9-]{36}$/` (UUID format)

## AWS & Bedrock Configuration

**Environment Variables:**
- `AWS_REGION` — AWS region (default: `ca-central-1`)
- `BEDROCK_MODEL_ID` — Nova model ID (default: `ca.amazon.nova-lite-v1:0`)
- `PORT` — Server port (default: `3000`)

**AWS Credentials:**
Configure locally via `~/.aws/credentials` or environment variables. The server reads credentials from the runtime environment.

## Deployment Notes

- Frontend is compiled to `site/dist/` and served as static files by the Node.js server
- Session data persists on disk—migrations from `.data/sessions/` must preserve the JSON format
- The server is a single-threaded Node.js process; session writes are sequential
- Deployment platforms (Vercel, Railway, Render, App Runner) need `AWS_REGION` and `BEDROCK_MODEL_ID` set as secrets
