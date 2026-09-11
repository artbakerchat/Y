import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolController } from '../src/tool-controls.js';
import { createPaletteTools } from '../tools/palette-tools.js';

const call = (controller, name, input = {}) => controller.execute({ toolUseId: 'test-id', name, input });
const create = () => createToolController({ tools: createPaletteTools(['glacier', 'prism']) });

test('suggestions require a successful palette inspection', async () => {
  const controller = create();
  assert.equal((await call(controller, 'suggest_related_words', { theme: 'nature' })).toolResult.status, 'error');
  assert.equal((await call(controller, 'get_palette')).toolResult.status, 'success');
  const result = await call(controller, 'suggest_related_words', { theme: 'nature' });
  assert.equal(result.toolResult.status, 'success');
  assert.match(result.toolResult.content[0].text, /canopy/);
  assert.deepEqual(controller.getLedger().map(({ status }) => status), ['blocked', 'success', 'success']);
});

test('failed inspection does not unlock suggestions; a successful search does', async () => {
  const controller = create();
  assert.equal((await call(controller, 'search_palette', { query: 42 })).toolResult.status, 'error');
  assert.equal((await call(controller, 'suggest_related_words', { theme: 'light' })).toolResult.status, 'error');
  await call(controller, 'search_palette', { query: 'prism' });
  assert.equal((await call(controller, 'suggest_related_words', { theme: 'light' })).toolResult.status, 'success');
});

test('limits are per tool, reset per invocation, and prevent execution', async () => {
  let executions = 0;
  const tools = [{ spec: { name: 'count' }, fn: () => ++executions }];
  const controller = createToolController({ tools, maxCallsPerTool: 1 });
  await call(controller, 'count');
  assert.equal((await call(controller, 'count')).toolResult.status, 'error');
  assert.equal(executions, 1);
  assert.deepEqual(controller.getCounts(), { count: 2 });
  await call(createToolController({ tools, maxCallsPerTool: 1 }), 'count');
  assert.equal(executions, 2);
});

test('specialist failures become model-readable errors with their tool ID', async () => {
  const controller = createToolController({ tools: [{
    spec: { name: 'consult_word_specialist' },
    fn: async () => { throw new Error('Specialist unavailable'); },
  }] });
  const { toolResult } = await call(controller, 'consult_word_specialist');
  assert.equal(toolResult.toolUseId, 'test-id');
  assert.equal(toolResult.status, 'error');
  assert.match(toolResult.content[0].text, /Specialist unavailable/);
  assert.deepEqual(controller.getLedger(), [{ name: 'consult_word_specialist', status: 'error' }]);
});

test('unknown and prototype-named tools are rejected and counted normally', async () => {
  const controller = create();
  for (const name of ['missing', '__proto__', 'constructor']) {
    assert.equal((await call(controller, name)).toolResult.status, 'error');
    assert.equal(controller.getCounts()[name], 1);
  }
});

test('callers cannot mutate the ledger to bypass prerequisites', async () => {
  const controller = create();
  await call(controller, 'suggest_related_words');
  const ledger = controller.getLedger();
  ledger[0].name = 'get_palette';
  ledger[0].status = 'success';
  assert.equal((await call(controller, 'suggest_related_words')).toolResult.status, 'error');
});

test('invalid limits fail immediately', () => {
  for (const maxCallsPerTool of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createToolController({ tools: [], maxCallsPerTool }), RangeError);
  }
});
