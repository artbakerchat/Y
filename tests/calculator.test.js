import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../tools/calculator.js';

test('reserve before sharing, including fractional portions', () => {
  const remaining = calculate({ operation: 'subtract', left: 31, right: 7 }).result;
  assert.equal(calculate({ operation: 'divide', left: remaining, right: 5 }).result, 4.8);
});
test('reject invalid and non-finite arithmetic', () => {
  for (const input of [{ operation: 'divide', left: 1, right: 0 }, { operation: 'add', left: '1', right: 2 }, { operation: 'exec', left: 1, right: 2 }, { operation: 'multiply', left: 1e308, right: 1e308 }]) {
    assert.throws(() => calculate(input));
  }
});
