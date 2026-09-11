---
name: word-exploration
description: Explore a word's meaning, origin, connotation, register, relationships, or poetic use in plain language.
keywords: meaning, definition, connotation, origin, etymology, explore, understand, nuance, poetic
agents: *
---

# Skill: Word Exploration

Use this skill when the user wants to understand a word, compare its nuance, trace its origin, or decide how it works in a sentence, title, or poem.

## Procedure

1. Identify the target word and the question behind it: meaning, origin, connotation, register, pronunciation, or use. Ask one concise question only when the target is ambiguous.
2. Use `consult_word_specialist` for etymology, connotation, or poetic-use analysis. Pass the target word and the most specific `aspect` available.
3. Explain the result in plain language. Separate established meaning from interpretation, and flag uncertainty rather than presenting a guess as fact.
4. Give one or two short examples that show the word in context. Explain what changes if a nearby alternative is used when that comparison helps.
5. Use `search_palette` when the user's palette is relevant, then connect the word to matching entries without forcing a connection.
6. End with one gentle, specific follow-up question, such as whether the user wants a warmer, sharper, older, or more poetic alternative.

## Boundaries

- Do not invent etymologies, citations, definitions, or usage claims.
- Keep examples concise and avoid implying that one interpretation is the only valid reading.
- Do not drift into broad brainstorming unless the user asks for it.
