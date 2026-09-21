// Real inference only. One isolated session per question; no canned responses.
import 'dotenv/config';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createAgentHarness } from '../src/agent-harness.js';
import registry from '../agentcore/profiles.js';
import { specializedQuestions } from './specialized-questions.js';
import { specializedHoldout } from './specialized-holdout.js';
const [target, output] = process.argv.slice(2);
if (!['live', 'python', 'node'].includes(target) || !output) throw Error('Usage: node scripts/evaluate-specialized.js live|python|node output.json');
const option = (name) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const model = process.env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0';
const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ca-central-1', maxAttempts: 2 });
const run = createAgentHarness({ modelId: model, converse: (input, options) => client.send(new ConverseCommand(input), options) });
const sourceFiles = target === 'python' ? ['app/ForgeAgent/main.py', 'app/ForgeAgent/answering.py', 'app/ForgeAgent/conversation_guidance.py', 'app/ForgeAgent/forge_specialists.py', 'app/ForgeAgent/forge_harness.py', 'app/ForgeAgent/profiles.json', 'app/ForgeAgent/community_tools.py', 'scripts/specialized-questions.js', 'scripts/specialized-holdout.js'] : ['src/agent-harness.js', 'src/task-guidance.js', 'src/answer-format.js', 'src/tool-controls.js', 'src/clean-answer.js', 'src/conversation-guidance.js', 'agentcore/profiles.js', 'tools/community-tools.js', 'tools/word-specialist-tool.js', 'scripts/specialized-questions.js', 'scripts/specialized-holdout.js'];
const sourceHash = createHash('sha256').update((await Promise.all(sourceFiles.map(file => readFile(file, 'utf8')))).join('\n')).digest('hex');
let records = [];
try { records = JSON.parse(await readFile(output, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (records.some(r => r.target !== target || r.model !== model || (target !== 'live' && r.sourceHash && r.sourceHash !== sourceHash))) throw Error('Use a new output file for a different target/model');
await mkdir(dirname(output), { recursive: true });
let saving = Promise.resolve();
function save() { const snapshot = JSON.stringify(records, null, 2) + '\n'; saving = saving.then(async () => { await writeFile(output + '.tmp', snapshot); await rename(output + '.tmp', output); }); return saving; }
async function ask(agentId, prompt, session, history) {
  if (target === 'python') return new Promise((resolve, reject) => {
    const child = spawn('.venv/bin/python', ['scripts/quality-python-case.py'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AWS_REGION: 'ca-central-1', AWS_DEFAULT_REGION: 'ca-central-1', BEDROCK_MODEL_ID: model } });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 110000);
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); if (code !== 0) return reject(Error(stderr.slice(-1200) || 'Python call timed out')); try { resolve(JSON.parse(stdout.trim().split('\n').at(-1))); } catch { reject(Error('Invalid Python result')); } });
    child.stdin.end(JSON.stringify({ agent_id: agentId, prompt, session, palette: [] }));
  });
  if (target === 'node' || agentId === 'word-specialist') return run({ agentId, prompt, history, palette: [] });
  const response = await fetch('https://larboard.ca/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `larboard_session=${session}` }, body: JSON.stringify({ agent: agentId, message: prompt }), signal: AbortSignal.timeout(95000) });
  const data = await response.json();
  if (!response.ok) throw Error(`HTTP ${response.status}: ${data.error}`);
  return data;
}
const agents = [...Object.keys(registry.profiles), 'word-specialist'].filter(id => !option('agents') || option('agents').split(',').includes(id));
if (!agents.length) throw Error('No matching agents');

const queue = agents.flatMap(agentId => (option('suite') === 'holdout' ? specializedHoldout.filter(q => q.agentId === agentId) : specializedQuestions[agentId]).filter(q => !option('questions') || option('questions').split(',').includes(q.id)).map(question => ({ agentId, question })));
if (!queue.length) throw Error('No matching questions');
const expected = queue.length;
const checkpointKeys = new Set();
for (const r of records) {
  const key = `${r.agentId}/${r.id}`;
  if (checkpointKeys.has(key)) throw Error('Duplicate checkpoint case');
  checkpointKeys.add(key);
  const entry = queue.find(q => q.agentId === r.agentId && q.question.id === r.id);
  if (!entry || entry.question.prompt !== r.prompt || entry.question.rubric !== r.rubric) throw Error('Checkpoint suite mismatch; use a new output file');
}
async function worker() {
  while (queue.length) {
    const { agentId, question } = queue.shift();
    if (records.some(r => r.agentId === agentId && r.id === question.id)) continue;
    const session = randomUUID();
    const start = Date.now();
    let result;
    try { result = await ask(agentId, question.prompt, session, []); }
    catch (error) { result = { error: error.message }; }
    records.push({ agentId, id: question.id, turn: 1, prompt: question.prompt, rubric: question.rubric,
      session, target, model, sourceHash,
      surface: target === 'live' && agentId !== 'word-specialist' ? 'larboard.ca' : target === 'python' ? 'local-python-agentcore' : 'local-node-bedrock',
      evaluatedAt: new Date().toISOString(), ...result, elapsedMs: Date.now() - start });
    await save();
    console.log(JSON.stringify({ count: records.length, agentId, id: question.id, error: result.error }));
  }
}
await Promise.all(Array.from({length: 4}, worker));
console.log(JSON.stringify({output, expected, total: records.length, errors: records.filter(r=>r.error).length}));
if (records.length !== expected || records.some(r => r.error)) process.exitCode = 1;
