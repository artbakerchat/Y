import { readFileSync } from 'node:fs';
import { CONVERSATION_POLICY } from '../agentcore/conversation-policy.js';

const bundled = JSON.parse(readFileSync(new URL('../app/ForgeAgent/conversation_policy.json', import.meta.url), 'utf8'));
if (bundled.text !== CONVERSATION_POLICY) {
  throw new Error('Python conversation_policy.json differs from the canonical agentcore/conversation-policy.js. Synchronize the bundle as part of the reviewed policy change.');
}
console.log('Conversational policy is synchronized across runtimes.');
