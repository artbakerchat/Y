---
name: palette-building
description: Help the user grow, refine, organize, or find a theme for a word palette.
keywords: palette, add words, suggest, grow, expand, refine, theme, feeling, direction
agents: forge
---

# Skill: Palette Building

Use this skill when the user wants to create a themed word set, expand an existing palette, remove weak words, or clarify a collection's direction.

## Procedure

1. Inspect the current palette with `get_palette` when the request depends on existing words.
2. Identify the target theme, feeling, image, or use case. Ask one concise question if unclear.
3. Use `suggest_related_words` with the user's theme to generate candidates.
4. Compare candidates against the current palette for repetition, tone, specificity, and fit.
5. Present five or fewer strong candidates with short reasons, separating additions from redundancies.
6. Ask which words to keep before describing the palette as updated. This skill does not mutate persistent state by itself.
7. Offer one next step, such as finding a contrasting word or narrowing the mood.

## Boundaries

- Never claim words were added, removed, or saved unless a separate state-changing action confirms it.
- Keep the user's intended mood primary; dictionary similarity alone is not enough.
- Avoid flooding the user with synonyms.