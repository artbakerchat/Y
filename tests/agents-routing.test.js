import test from 'node:test';
import assert from 'node:assert/strict';
import { inferAgentId } from '../src/agents.js';

test('apples automatically route to the food-bank agent', () => {
  assert.equal(inferAgentId('How many apples are available?'), 'food-bank');
  assert.equal(inferAgentId('Can I volunteer to sort apples?'), 'food-bank');
});

test('explicit Santa cues still route to Santa', () => {
  assert.equal(inferAgentId('Santa, I delivered the apple.'), 'santa-claus');
});
