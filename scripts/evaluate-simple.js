// Real inference only. Each question has an isolated session retained across turns.
import 'dotenv/config';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createAgentHarness } from '../src/agent-harness.js';
import registry from '../agentcore/profiles.js';
import { simpleQuestions, simpleHoldout } from './simple-questions.js';
const [target, output] = process.argv.slice(2);
if (!['live', 'python', 'node'].includes(target) || !output) throw Error('Usage: node scripts/evaluate-simple.js live|python|node output.json [--turns=4]');
const option = (name) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const followups = option('followups') ? JSON.parse(await readFile(option('followups'), 'utf8')) : null;
const turnLimit = Number(option('turns') || (followups ? 5 : 4));
if (![1,2,3,4,5].includes(turnLimit)) throw Error('Use 1–5 turns');
const model = process.env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0';
const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ca-central-1', maxAttempts: 2 });
const run = createAgentHarness({ modelId: model, converse: (input, options) => client.send(new ConverseCommand(input), options) });
const sourceFiles = target === 'python' ? ['app/ForgeAgent/main.py', 'app/ForgeAgent/answering.py', 'app/ForgeAgent/conversation_guidance.py', 'app/ForgeAgent/forge_specialists.py', 'app/ForgeAgent/forge_harness.py', 'app/ForgeAgent/profiles.json'] : ['src/agent-harness.js', 'src/answer-format.js', 'src/tool-controls.js', 'src/clean-answer.js', 'src/conversation-guidance.js', 'agentcore/profiles.js'];
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
    child.stdin.end(JSON.stringify({ mode: 'advanced', agent_id: agentId, prompt, session, palette: [] }));
  });
  if (target === 'node' || agentId === 'word-specialist') return run({ agentId, prompt, history, palette: [] });
  const response = await fetch('https://larboard.ca/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `larboard_session=${session}` }, body: JSON.stringify({ agent: agentId, message: prompt }), signal: AbortSignal.timeout(95000) });
  const data = await response.json();
  if (!response.ok) throw Error(`HTTP ${response.status}: ${data.error}`);
  return data;
}
const agents = [...Object.keys(registry.profiles), 'word-specialist'].filter(id => !option('agents') || option('agents').split(',').includes(id));
if (!agents.length) throw Error('No matching agents');
const questions = option('suite') === 'holdout' ? simpleHoldout : simpleQuestions;
const queue = agents.flatMap(agentId => questions.filter(q => !option('questions') || option('questions').split(',').includes(q.id)).map(question => ({ agentId, question })));
if (!queue.length) throw Error('No matching questions');
async function worker() {
  while (queue.length) {
    const { agentId, question } = queue.shift();
    const followup = followups?.find(item => item.agentId === agentId && item.id === question.id);
    if (followups && !followup) continue;
    const earlier = records.filter(r => r.agentId === agentId && r.id === question.id).sort((a,b) => a.turn-b.turn);
    const session = earlier[0]?.session || randomUUID();
    const history = [];
    for (let index = 0; index < turnLimit; index++) {
      const prompt = (index === 4 ? followup?.prompt : null) || question.turns[index] || 'Please check your last answer. Give a simple, correct answer.';
      const previous = earlier.find(r => r.turn === index + 1);
      if (previous) { if (previous.answer) history.push({ role: 'user', content: previous.prompt }, { role: 'assistant', content: previous.answer }); continue; }
      const start = Date.now(); let result;
      try { result = await ask(agentId, prompt, session, history); } catch (e) { result = { error: e.message }; }
      const record = { agentId, id: question.id, turn: index + 1, prompt, session, target, model, sourceHash, surface: target === 'live' && agentId !== 'word-specialist' ? 'larboard.ca' : target === 'python' ? 'local-python-agentcore' : 'local-node-bedrock', evaluatedAt: new Date().toISOString(), ...result, elapsedMs: Date.now()-start };
      records.push(record); await save();
      if (result.answer) history.push({ role: 'user', content: prompt }, { role: 'assistant', content: result.answer });
      console.log(JSON.stringify({ count: records.length, agentId, id: question.id, turn: index+1, answer: result.answer, error: result.error }));
    }
  }
}
await Promise.all(Array.from({length: 4}, worker));
console.log(JSON.stringify({output, total: records.length, errors: records.filter(r=>r.error).length}));
