import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedWordLimit } from '../src/answer-format.js';
import { createAgentHarness } from '../src/agent-harness.js';
import { simpleQuestions } from '../scripts/simple-questions.js';

test('explicit word limits are recognized without treating item counts as word limits', () => {
  assert.equal(requestedWordLimit('Make it ten words or fewer.'), 10);
  assert.equal(requestedWordLimit('Give me just one word.'), 1);
  assert.equal(requestedWordLimit('Write at most 7 words.'), 7);
  assert.equal(requestedWordLimit('We have 2 apples.'), null);
});

test('format repair keeps context and is bounded when the model ignores it', async () => {
  let calls = 0;
  const run = createAgentHarness({ modelId: 'test', converse: async input => {
    calls++;
    assert.equal(input.messages[0].content[0].text, 'What rhymes with cat?');
    return { stopReason:'end_turn', output:{ message:{role:'assistant', content:[{text:'Hat rhymes with cat.'}]}} };
  }});
  const result = await run({agentId:'forge',prompt:'Give me just one word.',history:[{role:'user',content:'What rhymes with cat?'},{role:'assistant',content:'Hat.'}]});
  assert.equal(calls,2);
  assert.equal(result.answer,'Hat rhymes with cat.');
});

test('simple evaluation questions fit public input limits', () => {
  assert.equal(simpleQuestions.length,15);
  for (const {turns} of simpleQuestions) for (const prompt of turns) {
    assert.equal(turns.length,4);
    assert.ok(prompt.split(/\s+/).length <= 52);
    assert.ok(prompt.split(/\s+/).every(word=>word.length <= 16));
  }
});
