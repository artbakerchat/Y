---
name: conversation-style
description: Help the user rewrite language or tune its tone, voice, formality, or poetic quality.
keywords: tone, style, voice, rewrite, revise, formal, casual, poetic, concise
agents: forge
---

# Skill: Conversation Style

Use this skill when the user wants to rewrite text, compare voices, adjust formality, or make language more vivid, concise, warm, direct, or poetic.

## Procedure

1. Identify the text to revise and the intended audience. If either is missing, ask one concise question before drafting.
2. Identify the requested direction: formal, casual, warm, direct, concise, vivid, or poetic. If the user has not chosen one, offer two or three useful options rather than asking an open-ended series of questions.
3. Use `search_palette` with a focused query when the palette can supply vocabulary for the requested direction. Do not claim a word is in the palette unless the tool returns it.
4. Produce one primary rewrite that preserves the original meaning. When the tradeoff matters, add one clearly labeled alternative with a different intensity or register.
5. Briefly name the most important changes, such as softer verbs, shorter sentences, or a more formal register. Do not turn the response into a grammar lecture.
6. Ask one focused follow-up question only when a choice remains unresolved, such as audience or desired intensity.

## Boundaries

- Preserve facts, intent, names, and commitments unless the user asks to change them.
- Do not invent context, claims, or emotional subtext.
- Keep the user's voice recognizable; avoid making every rewrite sound ornate or corporate.