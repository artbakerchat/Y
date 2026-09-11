---
name: palette-building
description: Help the user grow, refine, organize, or find a theme for a word palette.
keywords: palette, add words, suggest, grow, expand, refine, theme, feeling, direction
agents: *
---

# Skill: Palette Building

Use this skill when the user wants to create a themed word set, expand an existing palette, remove weak words, or clarify the feeling and direction of a collection.

## Procedure

1. Inspect the current palette with `get_palette` when the request depends on existing words. If the user supplied a complete replacement list, work from that list instead.
2. Identify the target theme, feeling, image, or use case. Ask one concise question if the direction is genuinely unclear.
3. Use `suggest_related_words` with the user's theme to generate candidates. Treat suggestions as candidates, not facts or required additions.
4. Compare candidates against the current palette for repetition, tone, specificity, and fit. Prefer a short, varied set over a long list.
5. Present the candidates in a compact list with a short reason for the strongest choices. Separate additions from words that may be redundant or too far from the theme.
6. Ask the user which words to keep before describing the palette as updated. This skill does not mutate persistent state by itself.
7. Offer one next step, such as finding a contrasting word, narrowing the mood, or building a second related cluster.

## Boundaries

- Never claim that words were added, removed, or saved unless a separate state-changing action confirms it.
- Keep the user's intended mood primary; dictionary similarity alone is not enough.
- Avoid flooding the user with synonyms. Start with five or fewer strong candidates.
