## Inspiration

Larboard was inspired by the idea that AI should feel like a thoughtful workspace—not a complicated system. It helps people turn unfinished thoughts into clearer language, useful questions, and practical next steps through calm, focused conversation.

## What it does

Larboard provides a conversational AI workspace called Forge. Users can build word palettes, explore meanings and connotations, receive related-word suggestions, use context-aware templates, and continue conversations across sessions.

## How we built it

We built a React-based interface served through a Cloudflare Worker. The Worker runs a Bedrock-powered JavaScript agent with tools, skills, steering, rate limits, specialist delegation, and R2 persistence. We also created a Python Strands AgentCore runtime with S3 and DynamoDB session support.

## Challenges we ran into

The main challenge was maintaining consistent behavior across JavaScript and Python runtimes. We also had to design safe tool controls, session expiration, profile handling, AWS request signing, skill loading, and deployment workflows without exposing credentials to the browser.

## Accomplishments that we're proud of

We created a working dual-runtime architecture with a polished conversational interface, deterministic tool limits, context-aware palettes, Markdown skills, specialist agents, persistent sessions, automated tests, and a path toward managed AgentCore deployment.

## What we learned

We learned that reliable agents need more than prompts. Clear tool boundaries, prerequisite checks, session management, guardrails, profile definitions, and offline tests make agent behavior more predictable, explainable, and easier to improve.

## What's next for Larboard

Larboard's Good Neighbour track empowers people by deploying specialized agents for local life. Key initiatives include automated food bank shift matching, micro-nonprofit helpdesks, mutual aid hubs and unified civic knowledge assistants. These tools strengthen community resilience, improve local organization, and ease the administrative burden on grassroots leaders.
