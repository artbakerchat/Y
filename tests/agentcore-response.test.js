import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgentCoreResponse } from '../src/agentcore-response.js';

test('AgentCore SSE preserves split UTF-8 chunks and joins text events', async () => {
  const data = new TextEncoder().encode('data: {"event":{"contentBlockDelta":{"delta":{"text":"Hello café."}}}}\r\n\r\ndata: [DONE]\r\n\r\n');
  const stream = new ReadableStream({ start(controller) {
    for (const byte of data) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  assert.equal(await readAgentCoreResponse(new Response(stream)), 'Hello café.');
});

test('AgentCore JSON response remains supported', async () => {
  assert.equal(await readAgentCoreResponse(Response.json({ text: 'Hello.' })), 'Hello.');
});

test('oversized and empty upstream answers fail', async () => {
  await assert.rejects(readAgentCoreResponse(new Response('x'.repeat(128 * 1024 + 1))), /size limit/);
  await assert.rejects(readAgentCoreResponse(Response.json({})), /no answer/);
});
