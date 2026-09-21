import { readFile } from 'node:fs/promises';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import worker from '../src/worker.js';

const baseUrl = process.argv[2];
let env;
if (!baseUrl) {
  const deployment = JSON.parse(await readFile('.data/agentcore-deployment.json', 'utf8'));
  const credentials = await new BedrockRuntimeClient({ region: deployment.region }).config.credentials();
  const state = new Map();
  env = { AWS_REGION: deployment.region, AGENTCORE_RUNTIME_ARN: deployment.agentRuntimeArn,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_SESSION_TOKEN: credentials.sessionToken,
    ASSETS: { get: async (key) => state.has(key) ? { json: async () => JSON.parse(state.get(key)) } : null,
      put: async (key, value) => state.set(key, value), delete: async (key) => state.delete(key) } };
}
let cookie = '';
async function ask(agent, prompt) {
  const request = new Request(`${baseUrl || 'https://larboard.test'}/api/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ agent, prompt }),
  });
  const response = baseUrl ? await fetch(request) : await worker.fetch(request, env);
  cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
  const result = await response.json();
  if (!response.ok || result.runtime !== 'agentcore') throw new Error(`AgentCore connection failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ agent, answer: result.answer, runtime: result.runtime }));
  return result.answer;
}
await ask('forge', 'Remember that my project code is cedar.');
const recall = await ask('forge', 'What project code did I give you?');
if (!/cedar/i.test(recall)) throw new Error('Conversation memory failed');
const isolated = await ask('food-bank', 'What project code did I give you?');
if (/cedar/i.test(isolated)) throw new Error('Profile isolation failed');
console.log('AgentCore connection, conversation memory, and profile isolation passed.');
