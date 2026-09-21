import { readFile, writeFile } from 'node:fs/promises';
import registry from '../agentcore/profiles.js';
const dir = process.argv[2] || 'evaluations/2026-09-12-specialized';
const read = async name => JSON.parse(await readFile(`${dir}/${name}.json`, 'utf8'));
async function scored(name, expected) {
  const records = await read(name);
  const review = await read(`${name}-review`);
  if (records.length !== expected || review.records.length !== expected) throw Error(`Incomplete ${name}`);
  const keys = new Set();
  for (const row of review.records) {
    const key = `${row.agentId}/${row.id}`;
    if (keys.has(key) || ![0,1,2].includes(row.score)) throw Error('Invalid/duplicate review');
    keys.add(key);
    const transcript = records.find(r => r.agentId === row.agentId && r.id === row.id);
    if (!transcript || (transcript.error && row.score !== 0)) throw Error('Review/transcript mismatch');
  }
  return { records, review: review.records };
}
const before = await scored('node-before', 135);
const after = await scored('node-verified', 135);
const holdout = await scored('holdout-verified', 15);
const count = rows => ({ total: rows.length, pass: rows.filter(r => r.score === 2).length, partial: rows.filter(r => r.score === 1).length, fail: rows.filter(r => r.score === 0).length });
const agents = [...Object.entries(registry.profiles).map(([id,p])=>({id,name:p.name})), {id:'word-specialist',name:'Word Specialist (internal)'}];
const summary = { before: count(before.review), after: count(after.review), holdout: count(holdout.review), agents: agents.map(a => ({...a,before:count(before.review.filter(r=>r.agentId===a.id)),after:count(after.review.filter(r=>r.agentId===a.id))})) };
await writeFile(`${dir}/summary.json`, JSON.stringify(summary,null,2)+'\n');
const live = (await read('baseline')).filter(r=>r.surface === 'larboard.ca');
const lines = [
'# Larboard agent evaluation — 2026-09-12 (Vancouver)', '',
`Final local full passes increased from **${summary.before.pass}/135 (${(summary.before.pass/135*100).toFixed(1)}%) to ${summary.after.pass}/135 (${(summary.after.pass/135*100).toFixed(1)}%)**. The unchanged holdout suite had **${summary.holdout.pass}/15** full passes on its final run. These are manual, unblinded, single-run rubric scores, not estimated production reliability.`, '',
'## Scope and inventory', '',
'Inspected https://larboard.ca/, its public /api/health endpoint, the profile registry, UI source, Node harness, Python package, and community tools. Live health reported Amazon Nova Lite (`ca.amazon.nova-lite-v1:0`, ca-central-1). There are eight public agents and an internal Word Specialist, not nine distinct foundation models. No connected browser was available; visual interaction was not tested.', '',
'| Agent | ID | Local before, full passes | Local after, full passes |', '|---|---|---:|---:|',
...summary.agents.map(a=>`| ${a.name} | ${a.id} | ${a.before.pass}/15 | ${a.after.pass}/15 |`), '',
'## Evaluation design', '',
'[Question bank](questions.md): ten specialized questions per agent (90 total), plus the same five shared checks on arithmetic, drafting constraints, tool honesty, instruction injection, and plain language. Each agent receives 15 cases; a complete run has 135 isolated synthetic sessions. Each question includes an acceptance rubric fixed before baseline inference. The runner bounds concurrency at four, checkpoints atomically, records model/source hash/surface/timing/tool traces, validates resumed cases, and exits nonzero for request errors. No agent responses are canned.', '',
'Full pass = 2, partially meets = 1, fails or request error = 0. The reported pass rate counts only 2s. Scores and reasons are in [baseline review](node-before-review.json), [final review](node-verified-review.json), and [holdout review](holdout-verified-review.json). Questions, answers, rubrics, errors, and available tool traces remain in the matching transcript JSON files.', '',
`The live baseline made ${live.length} public requests, with ${live.filter(r=>r.error).length} HTTP 500 errors. Its additional 15 Word Specialist cases used the local Bedrock harness and are explicitly marked local. Do not describe those as live specialist endpoint tests. The baseline Node run had ${before.records.filter(r=>r.error).length} errors; the final Node run had ${after.records.filter(r=>r.error).length} error (Nonprofit board memo: tool-call budget exhausted).`, '',
'## Changes supported by the results', '',
'- Updated all eight role profiles, synchronized the Python profile bundle, and tightened shared instructions for placeholders, grounded counts, direct answers, privacy, and tool-action honesty.',
'- Added task-specific draft/metaphor instructions to the Node harness and one bounded repair attempt for requested line counts. This improved several draft cases but does not guarantee conformance.',
'- Corrected the Music Expert\'s recurring Hallelujah attribution using a stored [Leonard Cohen reference](https://www.leonardcohen.com/track/hallelujah). This targeted correction is development-set tuning, not evidence of broad music expertise. The separate Nobel-year rubric was checked against the [Nobel Foundation](https://www.nobelprize.org/uploads/2018/06/press-78.pdf).',
'- Fixed civic-source tools in JavaScript and Python: supplied verified flags and URL suffixes no longer produce independently verified/grounded results. The tools do not fetch URLs. Regression tests cover plausible and deceptive URLs.',
'- Unsupported JavaScript nonprofit template requests now tell the model to draft directly instead of silently returning a grant tracker.', '',
'## Limits and remaining failures', '',
`The final development run has ${summary.after.partial} partial answers and ${summary.after.fail} failures, including its one tool-budget error. Food Bank still asks for records when simple supplied facts suffice; several agents still ask for unknown draft details. Civic answers can overstate verification capabilities or legal conclusions even though the deterministic verification tool is fixed. Santa sometimes laughs in sadness-related replies. Some line-count repair attempts fail. Orange reframing remains uneven; its full-pass count did not improve.`, '',
'Four local development runs are preserved: node-before, node-after (first revision), node-final (second revision), and node-verified (final revision). An observed grant-count regression in node-final led to clearer tally guidance; node-verified returned the correct tally. These runs show variation, and improvements are not uniform across agents. No result was overwritten to hide a failure.', '',
'The 15 holdout questions were written after the initial edits and first run after the second revision. The final run reused the same questions after a development-set regression fix; it is therefore a transfer check, not an untouched blind benchmark. Its three non-passes were an unnecessary venue question, an unsupported authenticity claim, and a missing venue placeholder. No changes were selected from these final holdout answers.', '',
'The live HTTP 500 causes were not diagnosed from server logs and remain unresolved. Local source hashes do not prove the live deployment revision. The Python configuration/tool changes passed unit tests, but Python inference was not evaluated in this task. Node task-specific guidance and line repair apply only to the Node harness. No production deployment was performed.', '',
'## Validation and reproduction', '',
'Passed all 10 JavaScript test files, profile/skill validation, 20 Python unit tests, and git diff --check. New tests cover suite coverage/public input limits, line repair, nonprofit fallback, and civic verification in both runtimes.', '',
'```sh',
'npm run eval:specialized -- live evaluations/new-live.json',
'npm run eval:specialized -- node evaluations/new-node.json',
'npm run eval:specialized -- node evaluations/new-holdout.json --suite=holdout',
'node scripts/summarize-specialized.js',
'```', '',
'Live calls require network access; direct Node/Word Specialist calls require AWS credentials and incur normal inference charges. Use a new output filename for changed code. Existing records, including errors, are retained on resume. The sandbox-only network failure file is an environment diagnostic and is excluded from model-quality scoring.', '',
];
await writeFile(`${dir}/report.md`, lines.join('\n'));
console.log(JSON.stringify(summary,null,2));
