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
  assert.equal(await readAgentCoreResponse(Response.json({ answer: 'Hello from the runtime.' })), 'Hello from the runtime.');
  assert.equal(await readAgentCoreResponse(Response.json({ response: { answer: 'Nested hello.' } })), 'Nested hello.');
});

test('AgentCore newline-delimited JSON stream is supported', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"event":{"contentBlockDelta":{"delta":{"text":"Hello "}}}}\n'));
      controller.enqueue(new TextEncoder().encode('{"event":{"contentBlockDelta":{"delta":{"text":"again."}}}}\n'));
      controller.close();
    },
  });
  assert.equal(await readAgentCoreResponse(new Response(stream)), 'Hello again.');
});

test('AgentCore upstream error events are surfaced', async () => {
  const data = 'data: {"error":"RuntimeClientError","error_type":"RuntimeError","message":"An error occurred during streaming"}\n\n';
  await assert.rejects(
    readAgentCoreResponse(new Response(data, { headers: { 'content-type': 'text/event-stream' } })),
    /AgentCore runtime error: An error occurred during streaming/,
  );
});

test('oversized and empty upstream answers fail', async () => {
  await assert.rejects(readAgentCoreResponse(new Response('x'.repeat(128 * 1024 + 1))), /size limit/);
  await assert.rejects(readAgentCoreResponse(Response.json({})), /no answer/);
});
