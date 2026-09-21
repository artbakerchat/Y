# Simple conversations with Larboard's nine roles

Evaluated September 12, 2026, Vancouver time (transcript timestamps use UTC). **Changes are in the repository and have not been deployed.** The Canadian model `ca.amazon.nova-lite-v1:0` remains unchanged.

The live website exposes eight public agents: Good Neighbour Coordinator (Forge), Food Bank Coordinator, Nonprofit Helpdesk, Mutual Aid Hub, Civic Knowledge Assistant, Bob Dylan (Music Expert), Santa Claus, and Orange Doctor Candidatus. The ninth is the internal Word Specialist. See the saved [live agent list](live-agents.json) and [health response](live-health.json). The extra tech-support demonstration function in the source is not a registered public profile or part of this nine-role evaluation.

The live HTML and endpoints were inspected directly. No browser was connected, so this is not a visual browser test. The public agents were tested through larboard.ca/api/ask. The internal specialist was tested through the local Node harness; each transcript labels its actual surface.

## Questions and conversations

Each of the following 15 questions was asked of all nine roles, with its own synthetic session. Each scenario has four user requests and four responses. The later requests ask for a correction, simpler wording, a shorter draft, or recall of previous facts. The complete question paths are in [simple-questions.js](../../scripts/simple-questions.js).

1. We have 2 apples. How many apples do we have?
2. We have 2 appels. How many do we have?
3. We have 5 apples for 2 people. Keep the apples whole. How many can each get?
4. We have 4 apples. Save 2. How many can we give away?
5. What does help mean?
6. Say this more simply: We provide food.
7. Write a short invite to share apples on Saturday.
8. Write a short thank-you to a neighbour.
9. My room is messy. What is one small thing I can do?
10. I need food. Write a short message asking for help.
11. Can you ask Sam to help me?
12. Is my library open now?
13. What rhymes with cat?
14. Can we pretend I give you an apple?
15. My name is Jo. I have 2 apples. What is my name?

That produced **540 initial and follow-up requests**, followed by **36 targeted fifth turns** on weak website answers: **576 baseline requests total**, of which 516 hit the website and 60 used the local internal-specialist harness. There were **7 execution failures**. Failures remain in the transcripts; subsequent turns may lack the facts from a failed request.

[Full live conversations](live-before.json) · [targeted fifth-turn prompts](live-followup-prompts.json)

## What changed

- **Structured tool results:** the JavaScript tool controller used String(value), which turned calculator result objects into “[object Object]”. Agents could not read the arithmetic and retried until their budget ran out. Tool results now preserve JSON objects. The fix also applies to structured operational tool results.
- **Plain answers:** shared Python/JavaScript guidance now favors one short sentence, number plus item for counts, obvious typo tolerance, and retaining corrections across turns. Whole-item requests use whole shares and leftovers; fractional answers are not blindly rounded.
- **Word Specialist:** removed the compulsory 3–6 sentences and the forced connotation focus for direct questions. Delegated etymology/connotation requests still retain their requested focus.
- **Explicit short formats:** a bounded additional attempt can repair an answer that exceeds a requested word limit. It retains conversation context and does not increase the existing request budgets. It is not a guarantee that the model will obey every format.
- **Drafts and action honesty:** instructions favor a ready-to-use draft, placeholders for unknown details, and a clear distinction between writing a message and actually contacting someone. Harmless pretend play is permitted without claiming a physical delivery.
- **Final Python recovery:** after the full retest exposed a token-limit exception and tool-planning text, Python now permits one recovery attempt with the same agent and request budget. It also recognizes mixed planning text and pseudo-tool calls as nonanswers.
- **Worker review:** the optional response reviewer now receives the current user request, and shared answer guidance is reinforced after role/skill instructions.

## Verification and measured results

The JavaScript probe recorded 7 failures in 72 requests, all on counting questions. After fixing structured results, all **72 apple turns** completed without errors. A separate **72-turn cup/pear test** used different objects and numbers, including a correction and whole-item leftovers; it also completed without errors. These two sets passed the count and format screening checks. The source question wording was not inserted into agent configuration.

[JavaScript probe](node-after.json) · [calculator-fix conversations](node-fixed.json) · [new cup/pear conversations](node-holdout.json)

For a more comparable prompt check, the same local Python AgentCore entrypoint and Canadian model answered all 135 initial questions before the changes and all 540 four-turn requests after them. Both used an empty palette. Website tests use website-managed palettes and a different deployed version, so website-versus-local differences are not presented as a controlled improvement estimate.

I reviewed the initial Python answers on a 0–2 scale: 0 = wrong or unusable, 1 = partly useful or unnecessarily complicated, 2 = useful and sufficiently simple. The score is an assistant judgment, not independent human review or a population accuracy estimate. The questions were visible during improvement.

| Agent | Before: initial answers | After: initial answers |
| --- | ---: | ---: |
| forge | 25/30 | 25/30 |
| food-bank | 21/30 | 22/30 |
| nonprofit-helpdesk | 22/30 | 25/30 |
| mutual-aid | 25/30 | 28/30 |
| civic-knowledge | 21/30 | 27/30 |
| bob-dylan | 24/30 | 25/30 |
| santa-claus | 26/30 | 28/30 |
| orange-doctor-candidatus | 26/30 | 26/30 |
| word-specialist | 24/30 | 26/30 |
| Total | 214/270 | 232/270 |

The revised four-turn Python run had **1 execution failure**. That run preceded the final recovery patch. A subsequent **108-request targeted retest** covered rhymes, thank-yous, and message drafts for all nine roles across four turns, with **1 execution failure**; see [final recovery retest](python-repair.json). The full 540-turn suite was not repeated after that last patch. The bounded retry does not guarantee recovery: the final Food Bank rhyme chain still failed on its initial question, then answered “Okay” to the one-word follow-up and “Cheerful cat okay” later. These are retained as failures of the experience, not counted as good answers just because they are short. Screening flags and semantic quality scores are separate: an unflagged answer is not necessarily correct.

[Python before](python-before.json) · [Python four-turn retest](python-after.json) · [review rubric and scores](review.json) · [summary](summary.json)

## Weak answers retained for follow-up

On the live site, Santa lost the running apple count and later gave the correct count after the facts were restated. Several agents substituted palette words such as “horizon” for a word that rhymes with “cat”; most accepted a correction, while Santa still offered “echo.” A food request became a poem about an ember, and some agents refused harmless pretend gifts or changed them into unrelated policy work. In the [fifth-turn review](fifth-turn-review.json), 14 of 36 targeted requests were met, 9 partly improved, and 13 still missed the target. One-sentence and ten-word requests were particularly uneven.

The revised Python run also contains regressions and unresolved weaknesses, including invented details in an invitation, unnecessary clarification, occasional tool-planning text, refusal of pretend play, and failures to preserve a draft or its requested format. These are retained rather than described as fixed. Shorter answers alone do not establish better answers.

## Reproduce

Run `npm run eval:simple -- live path/to/new-run.json`, replacing live with python or node for a local runtime. Each run makes real inference requests. Use a new file after changing code. Use `--turns=1` for initial questions only, `--suite=holdout` for cup/pear scenarios, or `--followups=path/to/prompts.json` to add reviewed fifth turns to saved sessions. No evaluation command deploys the site.

All 19 Python tests and the JavaScript suite passed. Offline tests cover structured result transport, bounded repair, retained context, and shared-guidance parity. The frontend type check and production build also passed. See the repository changes for the earlier service-status sign fix, which remains local as well.
