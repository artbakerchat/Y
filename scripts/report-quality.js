// Publish synthetic transcripts and explicit reviewer scores, never real user sessions.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const folder = 'evaluations/2026-09-12';
await mkdir(folder, { recursive: true });
const datasets = {
  baseline: '.data/evaluations/live-baseline.json',
  followups: '.data/evaluations/followups.json',
  revised_nova: '.data/evaluations/final-python.json',
  sonnet: '.data/evaluations/sonnet-quality.json',
  arithmetic: '.data/evaluations/calculator-check.json',
  heldout: '.data/evaluations/heldout.json',
  repair: '.data/evaluations/repair-check.json',
  dates: '.data/evaluations/date-recheck.json',
  final_canada: '.data/evaluations/final-canada.json',
  nova2_probe: '.data/evaluations/nova2-probe.json',
  sonnet_probe: '.data/evaluations/sonnet-probe.json',
};
const review = JSON.parse(await readFile(`${folder}/review.json`, 'utf8'));
const rows = [];
for (const [name, path] of Object.entries(datasets)) {
  const records = JSON.parse(await readFile(path, 'utf8'));
  const expected = { baseline: 135, followups: 27, revised_nova: 135, arithmetic: 9, heldout: 9, repair: 27, dates: 9, final_canada: 135 }[name];
  if (expected && records.length !== expected) throw new Error(`Incomplete ${name}: ${records.length}`);
  const published = records.map(({ session, ...record }) => {
    const assessment = review[name]?.[record.agentId];
    const index = review.questionOrder.indexOf(record.id);
    return { ...record, ...(assessment ? { reviewerScore: assessment[index] } : {}) };
  });
  await writeFile(`${folder}/${name}.json`, JSON.stringify(published, null, 2) + '\n');
  for (const agentId of [...new Set(records.map(r => r.agentId))]) {
    const subset = published.filter(r => r.agentId === agentId);
    rows.push({ dataset: name, agentId, questions: subset.length, errors: subset.filter(r => r.error).length,
      score: subset.every(r => Number.isInteger(r.reviewerScore)) ? subset.reduce((n, r) => n + r.reviewerScore, 0) : null });
  }
}
await writeFile(`${folder}/summary.json`, JSON.stringify(rows, null, 2) + '\n');
const baseline = rows.filter(row => row.dataset === 'baseline');
const final = rows.filter(row => row.dataset === 'final_canada');
if (final.some(row => row.score === null)) throw new Error('Review all final answers before publishing the report');
const total = (items, field) => items.reduce((sum, item) => sum + item[field], 0);
const original = JSON.parse(await readFile(datasets.baseline, 'utf8'));
const questionList = review.questionOrder.map((id, index) => `${index + 1}. ${original.find(row => row.id === id).prompt}`).join('\n');
const table = baseline.map(row => {
  const after = final.find(item => item.agentId === row.agentId);
  return `| ${row.agentId} | ${row.score}/30 | ${after.score}/30 | ${row.errors} → ${after.errors} |`;
}).join('\n');
const report = `# Larboard evaluation — September 12, 2026 (Vancouver)

Asked 15 questions across all nine roles: **135 baseline requests**, followed by **27 follow-up questions**. The baseline produced **121 answers and 14 failures**. After repository changes, a fresh 135-question Canadian-model run produced **${135 - total(final, 'errors')} answers and ${total(final, 'errors')} execution failures**. Execution success is separate from answer quality.

Canada-only ca.amazon.nova-lite-v1:0 remains the default, as requested. The stronger model is an explicit option only. **These changes are local and have not been deployed.** They change prompts, tools, and runtime behavior, not the hosted model's weights.

## Scope and scoring

The website exposes eight agents. Its ninth role, word-specialist, is internal. Baseline coverage was 120 requests to [larboard.ca](https://larboard.ca/) plus 15 direct requests through the original Node specialist harness. Follow-ups reused those scenario sessions: 24 website calls and three calls through the revised local specialist harness with the original history. Final validation used the real local Python AgentCore entrypoint and real Bedrock inference for all nine roles, not a production deployment.

Each initial question had isolated synthetic history. I reviewed every baseline and final answer: 0 = wrong, unusable or error; 1 = partly useful; 2 = adequate. These are subjective assistant ratings, not independent human review, repeated trials, or a population accuracy estimate. This live-versus-local comparison also includes network and deployment differences that may affect failure counts. The prompts were visible during improvement, so the main retest is a regression test. The separate unseen-number sharing check guards against fixing only one arithmetic example.

| Agent | Baseline quality | Final quality | Execution failures |
| --- | ---: | ---: | ---: |
${table}
| Total | ${total(baseline, 'score')}/270 | ${total(final, 'score')}/270 | ${total(baseline, 'errors')} → ${total(final, 'errors')} |

## The 15 questions

${questionList}

## What the conversations revealed

- The Food Bank agent initially said three apples each, ignoring the six reserved apples. Even its follow-up repeated three. The new arithmetic tool computes supplied numeric operations without evaluating code. All nine later returned 2.25; one specialist answer added a mistaken splitting comment. All nine separately answered eight oranges for (37 − 5) / 4.
- Several agents asked for a venue after being told it was unknown. Follow-ups sometimes corrected this, but others repeated the question or generated an unrelated volunteer welcome. Guidance and bounded repair now favor drafting with placeholders.
- Conflicting dates were repeatedly converted into a two-day event. Explicit instruction and an example using different dates improved the recheck; the specialist still produced two unconfirmed date fields in that recheck.
- Word origins included contradictory Latin claims and unsupported dates. A sourced entry now rejects the sincere/without-wax story. Missing reference data is explicitly labeled rather than treated as permission to invent.
- The direct specialist treated full questions as words and lost follow-up context. Both local runtimes now preserve direct questions and history.
- Reproduced service failures included tool-budget exhaustion and responses containing internal analysis with no public answer. Python now loads only relevant, profile-authorized skill instructions directly and permits one bounded repair, inside the existing deadline and call budget. Public output strips internal/wrapper tags; Node preserves requested line breaks.

Remaining weaknesses include occasional unnecessary refusals of harmless roleplay, generic or awkward advice, unsupported embellishments, and uneven adherence to tone or task details. Successful execution and calculator access do not establish that every answer is good. The raw failures and regressions are retained below.

## Model option and verification

[quality.env.example](../../deploy/agentcore/quality.env.example) offers Sonnet 4.6 explicitly. Small trials produced stronger drafts and formatting, but the expanded optional trial was stopped after 30 recorded cases, including a timeout during SDK retry. It was not a complete nine-agent comparison and is not an automatic fallback. Nova 2 Lite also received a six-case probe. Global profiles can route outside Canada; see [AWS routing documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) and [current pricing](https://aws.amazon.com/bedrock/pricing/).

Offline validation passed all eight JavaScript test files, 13 Python tests, skill/profile validation, syntax checks, and whitespace checks. The existing nine-role live Node smoke suite passed, but its assertions cover response contracts, not full semantic quality.

## Evidence and reproduction

[Baseline answers and ratings](baseline.json), [27 follow-ups](followups.json), [final Canadian answers and ratings](final_canada.json), [review rubric](review.json), [summary](summary.json), [arithmetic recheck](arithmetic.json), [unseen-number test](heldout.json), [format/draft recheck](repair.json), [date recheck](dates.json), [intermediate Canadian run](revised_nova.json), [partial Sonnet trial](sonnet.json), [Sonnet probe](sonnet_probe.json), [Nova 2 probe](nova2_probe.json).

Run npm run eval:quality -- python .data/evaluations/new-run.json for a new local Python run. Replace python with live for the public site plus local specialist. Use a new output file per code/model version; resuming retains old records. Use --suite=holdout for the additional sharing case. Global-model experiments can use --model=global.anthropic.claude-sonnet-4-6 --concurrency=1. These commands incur inference charges. No command deploys the application.

Factual reference checks: [sincere etymology](https://www.etymonline.com/word/sincere) and [Leonard Cohen's Hallelujah](https://www.leonardcohen.com/track/hallelujah).
`;
await writeFile(`${folder}/REPORT.md`, report.replaceAll('\\`', '`'));
console.log(JSON.stringify({ report: `${folder}/REPORT.md`, baselineScore: total(baseline, 'score'), finalScore: total(final, 'score'), maximum: 270, finalErrors: total(final, 'errors') }));
