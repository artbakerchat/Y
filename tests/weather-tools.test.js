import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherTool } from '../tools/weather-tools.js';

test('weather lookup delegates a location and date to the live web provider', async () => {
  let query;
  const tool = createWeatherTool(async (value) => {
    query = value;
    return 'weather evidence';
  });
  assert.equal(await tool.fn({ location: 'Vancouver, BC', date: 'tomorrow' }), 'weather evidence');
  assert.equal(query, 'Current weather and forecast for Vancouver, BC tomorrow');
});

test('weather lookup requires a location', async () => {
  const tool = createWeatherTool(async () => 'should not be called');
  assert.match(await tool.fn({}), /location is required/i);
});
