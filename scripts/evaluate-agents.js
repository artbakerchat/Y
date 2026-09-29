import 'dotenv/config';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createAgentHarness } from '../src/agent-harness.js';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ca-central-1', maxAttempts: 2 });
const run = createAgentHarness({ modelId: process.env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0', converse: (input, options) => client.send(new ConverseCommand(input), options) });
const cases = [
  ['forge', 'Help plan a small neighbourhood cleanup.'],
  ['food-bank', 'We have two volunteers but no confirmed shifts. What should we check?'],
  ['nonprofit-helpdesk', 'Draft a short volunteer welcome note.'],
  ['mutual-aid', 'How can I request groceries without sharing my home address publicly?'],
  ['civic-knowledge', 'How do I find my local council meeting schedule?'],
  ['bob-dylan', 'Explain how folk songs tell stories.'],
  ['santa-claus', 'Can I have a present?'],
  ['orange-doctor-candidatus', 'I feel stuck starting a project. Give one small next step.'],
  ['word-specialist', 'anchor'],
];
let failures = 0;
for (const [agentId, prompt] of cases) {
  try {
    const result = await run({ agentId, prompt, palette: ['anchor', 'apple', 'horizon'] });
    if (!result.answer || result.answer.split(/\s+/).length > 52) throw new Error('Response contract failed');
    if (/<(?:thinking|think|analysis)\b/i.test(result.answer)) throw new Error('Internal analysis leaked');
    if (agentId === 'food-bank' && result.trace.some(({ name, status }) => name === 'match_food_bank_shifts' && status === 'success')) throw new Error('Matched shifts without supplied shift data');
    if (agentId === 'santa-claus' && !/apple/i.test(result.answer)) throw new Error('Missing apple prerequisite');
    if (agentId === 'bob-dylan' && !result.answer.startsWith('hi y’all!')) throw new Error('Missing profile greeting');
    console.log(JSON.stringify({ status: 'pass', prompt, ...result }));
  } catch (error) {
    failures++;
    console.log(JSON.stringify({ status: 'fail', agentId, error: error.message }));
  }
}
console.log(JSON.stringify({ cases: cases.length, failures, note: 'Smoke checks only. Review answers for factual accuracy and role quality.' }));
process.exitCode = failures ? 1 : 0;
