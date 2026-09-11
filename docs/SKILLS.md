# Markdown Skills

Skills are Markdown files that inject procedures into the Forge agent loop at
runtime. The Worker loads the matching skill based on keywords in the user's
message and passes the procedure to the model as context before it generates
a response.

## Directory layout

```text
skills/
  word-exploration/
    SKILL.md          ← canonical layout: one sub-directory per skill
  palette-building/
    SKILL.md
  my-new-skill/
    SKILL.md
```

Skills can also sit directly under `skills/` as `skills/my-skill.md`; in that
case the file name (without `.md`) is treated as the skill name and must be
kebab-case.

## Frontmatter

Every skill file must begin with a YAML frontmatter block delimited by `---`.
The following four fields are required:

| Field         | Type                    | Description |
|---------------|-------------------------|-------------|
| `name`        | kebab-case string       | Unique identifier for the skill. For `SKILL.md` files it must match the directory name. |
| `description` | string (≤ 300 chars)    | One-sentence description shown in skill listings. |
| `keywords`    | comma-separated string  | Trigger words that cause this skill to be loaded. |
| `agents`      | `*` or agent ID(s)      | Which agent profiles may use this skill. `*` means all profiles. |

### Minimal example

```yaml
---
name: research-workflow
description: A procedure for investigating questions carefully.
keywords: research, investigate, sources, evidence
agents: researcher
---
```

### Targeting multiple agents

```yaml
---
name: tone-guide
description: Adjust the tone and register of a draft.
keywords: tone, formal, casual, rewrite
agents: forge, researcher
---
```

### Available to all agents

```yaml
---
name: safety-reminders
description: Reminds the agent of accuracy and uncertainty constraints.
keywords: accurate, uncertain, verify
agents: *
---
```

## Body

After the closing `---`, write the procedure in standard Markdown.

Requirements:
- Must contain at least one heading (e.g., `# Skill: Research Workflow`).
- Must be at least 20 characters long.
- Must not contain raw HTML tags — use Markdown syntax throughout.
- Code fences (` ``` `) must be closed (an even number of ` ``` ` markers).

Recommended structure:

```markdown
---
name: research-workflow
description: A procedure for investigating questions carefully.
keywords: research, investigate, sources, evidence
agents: researcher
---

# Skill: Research Workflow

Use this skill when the user asks to investigate a question or find sources.

## Procedure

1. Clarify the question before searching.
2. Search approved sources only.
3. Separate evidence from interpretation.
4. Flag uncertainty rather than presenting a guess as fact.
5. Summarize findings concisely.

## Boundaries

- Do not cite sources you have not seen.
- Keep summaries factual and concise.
```

## Validation rules

`scripts/validate-skills.js` enforces these rules before any skill is deployed:

| Rule | Detail |
|------|--------|
| Frontmatter block exists | File must start with `---` and have a matching closing `---`. |
| No unclosed frontmatter | The opening `---` must have a corresponding closing `---`. |
| All required fields present | `name`, `description`, `keywords`, `agents` must all be set and non-empty. |
| `name` is kebab-case | Only lowercase letters, digits, and hyphens. No underscores or spaces. |
| `name` matches directory | For `SKILL.md` files, `name` must equal the parent directory name. |
| `keywords` non-empty | At least one keyword after splitting on commas. |
| `agents` valid format | Must be `*` or one or more comma-separated agent IDs (`[a-z][a-z0-9-]*`). |
| Field length limits | `name` ≤ 80 chars, `description` ≤ 300 chars, `keywords` ≤ 500 chars, `agents` ≤ 200 chars. |
| Body has a heading | At least one `#` heading in the body. |
| Body is long enough | Body content must be ≥ 20 characters. |
| Code fences balanced | Even number of ` ``` ` markers (no unclosed fence). |
| No raw HTML | Raw HTML tags are not allowed in the body. |
| File/directory name kebab-case | The `.md` file name (or parent directory for `SKILL.md`) must be kebab-case. |

## Examples of valid skills

### Valid — minimal

```markdown
---
name: quick-tip
description: Give a concise tip on the requested topic.
keywords: tip, quick, hint
agents: forge
---

# Quick Tip

Provide one clear, actionable tip. Keep it under three sentences.
```

### Valid — multiple agents

```markdown
---
name: citation-check
description: Verify that claims are supported by cited sources.
keywords: citation, source, verify, evidence
agents: forge, researcher
---

# Citation Check

## Procedure

1. Identify every factual claim in the response.
2. Check whether each claim is supported by a source the agent has seen.
3. Flag any unsupported claim as uncertain.
```

### Valid — global skill

```markdown
---
name: accuracy-reminder
description: Remind the agent to flag uncertainty and avoid invented facts.
keywords: accurate, hallucination, verify, uncertain
agents: *
---

# Accuracy Reminder

Always flag statements that are uncertain or unverified. Use phrases such as
"I'm not certain" rather than presenting guesses as facts.
```

## Examples of invalid skills

### Invalid — missing `name` field

```markdown
---
description: Explore a word's meaning.
keywords: meaning, definition
agents: forge
---

# Word Exploration
…
```

Error: `Missing required frontmatter field: "name"`

### Invalid — `name` not kebab-case

```markdown
---
name: Word Exploration
description: Explore a word's meaning.
keywords: meaning, definition
agents: forge
---
```

Error: `frontmatter "name" value "Word Exploration" is not kebab-case`

### Invalid — no closing frontmatter delimiter

```markdown
---
name: broken-skill
description: This skill has an unclosed frontmatter block.
keywords: broken
agents: forge

# Body starts here without a closing ---
```

Error: `Frontmatter block is not closed — missing closing ---`

### Invalid — YAML list syntax

```markdown
---
name: list-example
description: Uses unsupported YAML list syntax.
keywords:
  - research
  - investigate
agents: forge
---
```

Error: `Frontmatter line 5: YAML list items are not supported — use a comma-separated string`

Correct form: `keywords: research, investigate`

### Invalid — no heading in body

```markdown
---
name: no-heading
description: A skill without any headings.
keywords: test
agents: forge
---

Just some text without a heading above it.
```

Error: `Skill body has no headings`

### Invalid — `agents` value malformed

```markdown
---
name: bad-agents
description: Agents field uses an invalid value.
keywords: test
agents: ALL_AGENTS
---

# Test
Some content here.
```

Error: `frontmatter "agents" value "ALL_AGENTS" is invalid`

## Running validation locally

```bash
# Validate all skills in the skills/ directory
npm run validate-skills

# Validate a specific directory
node scripts/validate-skills.js skills/word-exploration

# Validate multiple directories
node scripts/validate-skills.js skills/ app/ForgeAgent/skills/
```

Validation also runs automatically as part of `npm run check` and in GitHub
Actions before any deployment to Cloudflare R2.

## Deploying a new skill

1. Create a directory under `skills/` with a kebab-case name.
2. Add a `SKILL.md` file following the format above.
3. Run `npm run validate-skills` locally to confirm the file passes all checks.
4. Commit and push to `main`.
5. The GitHub Actions deploy workflow validates skills again, then uploads every
   `skills/*.md` file to the `skills/` prefix in the R2 bucket before deploying
   the Worker.
