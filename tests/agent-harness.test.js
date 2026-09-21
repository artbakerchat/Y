import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentHarness } from '../src/agent-harness.js';
import { AGENT_PROFILES } from '../src/agents.js';
import { CONVERSATION_POLICY } from '../agentcore/conversation-policy.js';

const end = (text = 'A useful response.') => ({ stopReason: 'end_turn', output: { message: { role: 'assistant', content: [{ text }] } } });
const use = (name, input = {}) => ({ stopReason: 'tool_use', output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'call-1', name, input } }] } } });

for (const profile of Object.values(AGENT_PROFILES)) {
  test(`${profile.id}: role, history, tools, and configured model reach transport`, async () => {
    const run = createAgentHarness({ modelId: 'test-model', converse: async (input) => {
      assert.equal(input.modelId, 'test-model');
      assert.ok(input.system[0].text.startsWith(CONVERSATION_POLICY));
      assert.ok(input.system[0].text.includes(profile.systemPrompt));
      assert.deepEqual(input.toolConfig.tools.map(({ toolSpec }) => toolSpec.name).sort(), [...profile.toolNames].sort());
      assert.equal(input.messages[0].content[0].text, 'Earlier context');
      return end();
    } });
    const result = await run({ agentId: profile.id, prompt: 'Help me', history: [{ role: 'user', content: 'Earlier context' }] });
    assert.equal(result.answer, 'A useful response.');
  });
}

test('specialist delegation runs lookup and returns to parent', async () => {
  const responses = [use('consult_word_specialist', { word: 'anchor' }), use('look_up_word_details', { word: 'anchor' }), end('Anchor suggests stability.'), end('Use anchor for stability.')];
  const run = createAgentHarness({ modelId: 'test', converse: async (input) => {
    assert.ok(input.system[0].text.startsWith(CONVERSATION_POLICY));
    return responses.shift();
  } });
  const result = await run({ prompt: 'Explain anchor.' });
  assert.equal(result.answer, 'Use anchor for stability.');
  assert.deepEqual(result.trace.map(({ agentId, name }) => [agentId, name]), [['word-specialist', 'look_up_word_details'], ['forge', 'consult_word_specialist']]);
  assert.deepEqual(result.usage, { modelCalls: 4, toolCalls: 2 });
});

test('all nine roles have an executable path', async () => {
  assert.equal(Object.keys(AGENT_PROFILES).length, 9);
  const run = createAgentHarness({ modelId: 'test', converse: async () => end() });
  assert.equal((await run({ agentId: 'word-specialist', prompt: 'anchor' })).agentId, 'word-specialist');
});

test('unknown and unapproved tools are returned as errors', async () => {
  let calls = 0;
  const run = createAgentHarness({ modelId: 'test', converse: async (input) => {
    if (!calls++) return use('run_shell', { command: 'anything' });
    assert.equal(input.messages.at(-1).content[0].toolResult.status, 'error');
    return end();
  } });
  assert.equal((await run({ prompt: 'Help' })).trace[0].status, 'error');
});

test('tool loops stop at the total profile budget', async () => {
  let calls = 0;
  const run = createAgentHarness({ modelId: 'test', converse: async () => { calls++; return use('get_palette'); } });
  await assert.rejects(run({ prompt: 'Help' }), /budget exhausted/);
  assert.equal(calls, 4);
});

test('incomplete output fails and complete output is not cut at 52 words', async () => {
  const bad = createAgentHarness({ modelId: 'test', converse: async () => ({ ...end(), stopReason: 'max_tokens' }) });
  await assert.rejects(bad({ prompt: 'Help' }), /Incomplete response/);
  const long = createAgentHarness({ modelId: 'test', converse: async () => end('word '.repeat(70)) });
  assert.equal((await long({ prompt: 'Help' })).answer.split(/\s+/).length, 70);
});

test('transport receives a cancellation signal', async () => {
  const run = createAgentHarness({ modelId: 'test', converse: async (_, options) => {
    assert.ok(options.abortSignal instanceof AbortSignal);
    return end();
  } });
  await run({ prompt: 'Help' });
});

test('internal analysis is removed before counting response words', async () => {
  const run = createAgentHarness({ modelId: 'test', converse: async () => end(`<thinking>${'private '.repeat(70)}</thinking>Here is the answer.`) });
  assert.equal((await run({ prompt: 'Help' })).answer, 'Here is the answer.');
});

test('invented operational facts cannot produce successful matches', async () => {
  const responses = [use('match_food_bank_shifts', { volunteers: [{ name: 'Invented person', availability: ['Monday'] }], shifts: [{ slot: 'Monday' }] }), end('Please provide shift details.')];
  const run = createAgentHarness({ modelId: 'test', converse: async () => responses.shift() });
  const result = await run({ agentId: 'food-bank', prompt: 'We have two volunteers but no confirmed shifts.' });
  assert.equal(result.trace[0].status, 'error');
});

test('supplied operational records remain usable', async () => {
  const input = { volunteers: [{ name: 'Sam', availability: ['Monday'] }], shifts: [{ slot: 'Monday' }] };
  const responses = [use('match_food_bank_shifts', input), end('Sam is a proposed match, pending confirmation.')];
  const run = createAgentHarness({ modelId: 'test', converse: async () => responses.shift() });
  const result = await run({ agentId: 'food-bank', prompt: JSON.stringify(input) });
  assert.equal(result.trace[0].status, 'success');
});
