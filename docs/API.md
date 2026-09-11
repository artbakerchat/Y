# Forge API Reference

The full machine-readable specification is in [openapi.yaml](openapi.yaml)
(OpenAPI 3.0). This document is a human-readable summary with curl examples.

## Base URLs

| Environment | Base URL |
|---|---|
| Local dev (`server.mjs`) | `http://localhost:3000` |
| Cloudflare Worker | `https://<your-worker-domain>` |

---

## Session

All mutable endpoints use a session cookie named `larboard_session`. On the
first request the server assigns a UUID and returns it via `Set-Cookie`.
Subsequent requests that carry the cookie continue the same session. Sessions
expire 48 hours after the last save.

You don't need to manage the cookie manually in a browser — it is set
automatically. When using curl, save and replay the cookie with `-c` / `-b`.

---

## Input constraints (POST /api/ask)

| Constraint | Limit | Error code |
|---|---|---|
| Prompt characters | ≤ 4 000 | 413 |
| Prompt words | ≤ 52 | 413 |
| Characters per word | ≤ 16 | 413 |
| Model requests per day | ≤ 8 | 429 |

---

## Endpoints

### GET /api/health

Reports liveness, region, and model configuration. No authentication required.
The Cloudflare Worker also includes the list of available agent profiles.

```bash
curl http://localhost:3000/api/health
```

Response (local server):

```json
{
  "ok": true,
  "region": "ca-central-1",
  "model": "amazon.nova-micro-v1:0"
}
```

Response (Cloudflare Worker — includes `agents`):

```json
{
  "ok": true,
  "region": "ca-central-1",
  "model": "ca.amazon.nova-lite-v1:0",
  "agents": [
    {
      "id": "forge",
      "name": "Forge",
      "description": "A focused word specialist and conversation partner."
    }
  ]
}
```

---

### GET /api/agents

Returns the list of registered agent profiles. **Cloudflare Worker only** —
the local server returns 404 for this endpoint. The same data is in the
`agents` field of `GET /api/health`.

```bash
curl https://example.workers.dev/api/agents
```

Response:

```json
[
  {
    "id": "forge",
    "name": "Forge",
    "description": "A focused word specialist and conversation partner."
  }
]
```

---

### GET /api/state

Loads the full workspace state for the current session. Creates a new session
if no cookie is present. Pass `?context=<id>` to pre-load a palette template
on a brand-new session.

```bash
# New session, default palette
curl -c cookies.txt http://localhost:3000/api/state

# New session, volunteering palette
curl -c cookies.txt 'http://localhost:3000/api/state?context=volunteering'

# Existing session
curl -b cookies.txt http://localhost:3000/api/state
```

Available `context` values: `volunteering`, `teaching`, `library`,
`foodbank`, `contracting`, `content_creator`, `researcher`, `household`,
`wellness`, `default`.

Response shape (abbreviated):

```json
{
  "agentId": "forge",
  "paletteId": "default",
  "paletteStory": "This palette is for general word exploration and creative writing.",
  "palette": ["anchor", "aurora", "cascade", "echo", "ember"],
  "promptWords": [],
  "messages": [],
  "pendingPrompt": "",
  "printer": { "note": "", "images": [null, null, null] },
  "rate": { "day": "2026-09-11", "count": 0 },
  "expiresAt": 1757808000000
}
```

---

### POST /api/state

Merges supplied fields into the current session and persists the result.
Unrecognised fields are silently dropped. The response returns the full
cleaned state after the merge.

```bash
# Update the palette
curl -b cookies.txt -c cookies.txt \
  -X POST http://localhost:3000/api/state \
  -H 'Content-Type: application/json' \
  -d '{"palette": ["aurora", "solitude", "labyrinth", "whisper", "vortex"]}'

# Save a printer note
curl -b cookies.txt -c cookies.txt \
  -X POST http://localhost:3000/api/state \
  -H 'Content-Type: application/json' \
  -d '{"printer": {"note": "Workshop draft", "images": [null, null, null]}}'
```

Write constraints enforced on save:
- `palette` words are trimmed and capped at 52; in the Worker each word must
  be ≤ 16 characters.
- `promptWords` capped at 52.
- `messages` capped at the last 100 turns.
- `pendingPrompt` truncated to 4 000 characters.
- `printer.images` capped at 3 slots.

---

### POST /api/ask

Sends a prompt to the AI agent. Returns the agent's response, updates
conversation history, and increments the daily request counter.

The `prompt` field is preferred; `message` is accepted as an alias.

```bash
# Simple question
curl -b cookies.txt -c cookies.txt \
  -X POST http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "What does aurora mean poetically?"}'

# Specify an agent (Worker only)
curl -b cookies.txt -c cookies.txt \
  -X POST https://example.workers.dev/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Suggest words related to light.", "agent": "forge"}'

# Using the x-agent-id header instead
curl -b cookies.txt -c cookies.txt \
  -X POST https://example.workers.dev/api/ask \
  -H 'Content-Type: application/json' \
  -H 'x-agent-id: forge' \
  -d '{"prompt": "Find words that feel like solitude."}'
```

Response (local server — simple Bedrock fallback):

```json
{
  "answer": "Aurora carries a sense of luminous beauty and renewal…",
  "agent": false
}
```

Response (Worker — full agent loop):

```json
{
  "answer": "Aurora's Latin root means 'dawn'. Its connotation blends rarity with the sublime.",
  "agent": true,
  "toolCallCounts": {
    "consult_word_specialist": 1
  }
}
```

Response (Worker routing to AgentCore):

```json
{
  "answer": "Aurora (Latin: dawn) carries connotations of rare luminous beauty and renewal.",
  "agent": true,
  "runtime": "agentcore"
}
```

#### Error responses

| Status | Condition | Body |
|---|---|---|
| 400 | Empty or missing prompt | `{"error": "Message is required."}` |
| 400 | Unknown agent (Worker) | `{"error": "Unknown agent."}` |
| 413 | Prompt too long (> 4 000 chars) | `{"error": "Prompt is too long."}` |
| 413 | Too many words (> 52) | `{"error": "Requests are limited to 52 words."}` |
| 413 | Word too long (> 16 chars) | `{"error": "Each word is limited to 16 characters."}` |
| 429 | Daily limit reached | `{"error": "Daily request limit reached. Please try again tomorrow.", "limit": 8}` |
| 503 | Model requests disabled (Worker) | `{"error": "Model requests are temporarily disabled."}` |
| 503 | AWS credentials missing (Worker) | `{"error": "Bedrock credentials are not configured."}` |
| 500 | Unexpected runtime error | `{"error": "Runtime error. Check the server terminal."}` |

The 429 response also includes a `Retry-After` header (seconds until midnight
UTC).

---

## Agent tools

Tools are called by the AI model during a `POST /api/ask` turn and run
server-side. Clients never invoke them directly.

The `forge` profile allows up to **3 calls per tool per request**.

### get_palette

Returns the full palette for the current session.

Input: _(none)_

Output example:
```
Current palette (4 words): anchor, aurora, cascade, echo
```

### search_palette

Case-insensitive substring search over palette words.

Input:

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Substring to match against palette words |

Output example (query `"aur"`):
```
Found 1 match(es): aurora
```

### suggest_related_words

Suggests thematically related words using a built-in theme bank (nature,
light, motion, time). Returns a general set for unrecognised themes.

Input:

| Field | Type | Required | Description |
|---|---|---|---|
| `theme` | string | yes | Theme or concept to base suggestions on |

Output example (theme `"light"`):
```
Suggested words for theme "light": prism, glimmer, radiance, flicker, beacon
```

### consult_word_specialist

Delegates to the word-craft specialist sub-agent for deep linguistic analysis.
The specialist runs its own inner loop (up to 4 iterations) with two private
tools and returns a 3–6 sentence analysis. Requires AWS credentials; returns a
graceful message when credentials are absent.

Input:

| Field | Type | Required | Description |
|---|---|---|---|
| `word` | string | yes | Word to analyse |
| `aspect` | string | no | `etymology` \| `connotation` \| `poetic_use` (defaults to `connotation`) |

Output example (word `"aurora"`, aspect `"etymology"`):
```
Aurora derives from the Latin word for dawn and is cognate with the Greek eos.
It entered English as both a proper name (the goddess of dawn) and a common
noun for the polar light display. Its luminous, rare quality makes it a
favourite in elevated registers and lyric poetry.
```

### Specialist-internal tools

These are available only inside the specialist's own agent loop and are not
accessible to the main orchestrator.

#### look_up_word_details

Returns stored etymology, connotation, and register data from a built-in
dictionary (~15 palette-relevant words including anchor, aurora, cascade, echo,
ember, glacier, horizon, labyrinth, mirage, mosaic, nebula, prism, solitude,
vortex, whisper). Returns a "no stored details" notice for words outside the
dictionary.

Input:

| Field | Type | Required | Description |
|---|---|---|---|
| `word` | string | yes | Word to look up |

#### find_related_words_deep

Returns rare, literary vocabulary from a deep theme cluster. Covers: light,
dark, water, movement, silence, time, nature, mind, structure, decay. Defaults
to the "mind" cluster for unrecognised themes.

Input:

| Field | Type | Required | Description |
|---|---|---|---|
| `theme` | string | yes | Semantic field (e.g. `light`, `water`, `silence`, `decay`) |

Output example (theme `"light"`):
```
Deep vocabulary for theme "light": luminous, aureate, lambent, incandescent,
phosphorescent, crepuscular, scintilla
```

---

## Session state fields

| Field | Type | Description |
|---|---|---|
| `agentId` | string | Active agent profile (`"forge"`) |
| `paletteId` | string | Active palette template ID |
| `paletteStory` | string | Narrative description of the palette |
| `palette` | string[] (max 52) | Current word palette |
| `promptWords` | string[] (max 52) | Words selected for the next prompt |
| `messages` | object[] (max 100) | Conversation history |
| `pendingPrompt` | string (max 4 000) | Prompt awaiting clarification |
| `printer.note` | string | Freeform printer workspace note |
| `printer.images` | (object\|null)[] (max 3) | Image slots |
| `rate.day` | date string | Date the counter was last reset |
| `rate.count` | integer 0–8 | Model requests made today |
| `expiresAt` | integer (ms) | Epoch ms when the session expires |
