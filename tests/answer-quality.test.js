import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswer } from '../src/clean-answer.js';
import { createAgentHarness } from '../src/agent-harness.js';

test('three requested lines survive sanitization', () => {
  assert.equal(cleanAnswer('<thinking>private</thinking><answer>1. A note.\n2. An email.\n3. A call.</answer>'), '1. A note.\n2. An email.\n3. A call.');
});

test('long answers stop at a complete sentence when possible', () => {
  const opening = 'This is a complete sentence with enough useful words.';
  assert.equal(cleanAnswer(opening + ' word'.repeat(60)), opening);
  assert.throws(() => cleanAnswer('<analysis>private</analysis>'), /no text/);
});

test('direct specialist receives full question and follow-up history', async () => {
  const prompt = 'Please explain which part of your earlier answer was supported by a source, and which part was your interpretation of the word.';
  const run = createAgentHarness({ modelId: 'test', converse: async (input) => {
    assert.equal(input.messages[0].content[0].text, 'Explain anchor.');
    assert.equal(input.messages.at(-1).content[0].text, prompt);
    return { stopReason: 'end_turn', output: { message: { role: 'assistant', content: [{ text: 'The connotation was interpretation.' }] } } };
  } });
  const result = await run({ agentId: 'word-specialist', prompt, history: [{ role: 'user', content: 'Explain anchor.' }, { role: 'assistant', content: 'It suggests stability.' }] });
  assert.equal(result.answer, 'The connotation was interpretation.');
});
