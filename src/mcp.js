// ---------------------------------------------------------------------------
// MCP server (Streamable HTTP, MCP spec 2025-11-25) for the Alexa+ hackathon
// track. Public endpoint: POST https://larboard.ca/mcp
//
// Auth mirrors the /api/agent-gateway pattern: MCP_WORKER_TOKEN env secret,
// supplied as an `Authorization: Bearer <token>` header or a `?token=`
// query param (the query form lets plain-URL MCP clients connect).
//
// Tools front the Bee AgentCore runtime through the existing bee.js flows,
// so the $5/week budget, per-account rate limits, and bans apply unchanged.
// MCP sessions are tracked in R2 under bee/mcp/<sid>.json and mapped onto
// the bee.js visitor-session records.
// ---------------------------------------------------------------------------

import { beeConnect, beeStatus, beeChat, beeDisconnect } from './bee.js';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const MCP_SERVER_NAME = 'larboard-bee-mcp';
const MCP_SERVER_VERSION = '1.0.0';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const te = new TextEncoder();
const td = new TextDecoder();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'mcp-session-id',
  'access-control-max-age': '86400',
};

// --- tiny helpers (self-contained; mirrors worker.js/bee.js) -----------------

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? te.encode(value) : value);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function secureTokenEqual(left, right) {
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  return a === b;
}

function newSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of bytes) s += alpha[b % alpha.length];
  return s;
}

async function r2GetJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

async function r2PutJson(bucket, key, value) {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

// --- JSON-RPC framing --------------------------------------------------------

function rpcResult(id, result, sessionId) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers });
}

function rpcError(id, code, message, sessionId, httpStatus = 200) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), { status: httpStatus, headers });
}

function toolText(text) {
  return { content: [{ type: 'text', text }] };
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

// --- tool definitions --------------------------------------------------------

const TOOLS = [
  {
    name: 'bee_pair',
    description:
      'Start Bee device pairing for the current session. Returns a pairing URL the user must open and approve in their Bee app, plus its expiry. Poll bee_pair_status until the status is approved.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bee_pair_status',
    description:
      'Check the Bee device pairing status for the current session: pending, approved, expired, banned, or unknown.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bee_chat',
    description:
      "Chat with the user's Bee agent, which can read their Bee conversation data and memories. Requires a completed Bee pairing first (bee_pair, then bee_pair_status until approved).",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: "The user's message to the Bee agent." },
        history: {
          type: 'array',
          description: 'Optional recent conversation turns (most recent last).',
          items: { type: 'object' },
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'bee_disconnect',
    description: 'Disconnect the Bee account for the current session and purge its stored credentials.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// --- tool execution (delegates to the bee.js flows) --------------------------

function internalRequest(path, method, beeSid, body) {
  return new Request(`https://internal${path}`, {
    method,
    headers: { cookie: `bee_session=${beeSid}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function beeSidFromSetCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/bee_session=([A-Za-z0-9_-]{1,128})/);
  return m ? m[1] : null;
}

async function callTool(name, args, mcpSid, env) {
  const bucket = env.ASSETS;
  const mapping = (await r2GetJson(bucket, `bee/mcp/${mcpSid}.json`)) || {};
  const beeSid = mapping.sid || mcpSid;

  switch (name) {
    case 'bee_pair': {
      const res = await beeConnect(internalRequest('/api/bee/connect', 'POST', beeSid), env);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pairing_url) return toolError(data.error || 'Could not start Bee pairing. Try again.');
      const newBeeSid = beeSidFromSetCookie(res);
      if (newBeeSid) await r2PutJson(bucket, `bee/mcp/${mcpSid}.json`, { ...mapping, sid: newBeeSid });
      return toolText(
        `Bee pairing started.\nPairing URL: ${data.pairing_url}\nExpires: ${data.expires_at}\n` +
          'The user must open this URL and approve it in their Bee app, then call bee_pair_status.',
      );
    }
    case 'bee_pair_status': {
      const res = await beeStatus(internalRequest('/api/bee/status', 'GET', beeSid), env);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toolError(data.error || 'Pairing check failed. Try again.');
      return toolText(
        `Bee pairing status: ${data.status}` + (data.expires_at ? `\nExpires: ${data.expires_at}` : ''),
      );
    }
    case 'bee_chat': {
      const message = typeof args?.message === 'string' ? args.message.trim() : '';
      if (!message) return toolError('message is required.');
      const history = Array.isArray(args?.history) ? args.history.slice(-12) : [];
      const res = await beeChat(internalRequest('/api/bee/chat', 'POST', beeSid, { message, history }), env);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toolError(data.error || 'The Bee agent did not respond. Try again.');
      let text = data.answer || '(no answer)';
      if (Array.isArray(data.files) && data.files.length) text += `\n\nFiles: ${data.files.join(', ')}`;
      return toolText(text);
    }
    case 'bee_disconnect': {
      await beeDisconnect(internalRequest('/api/bee/disconnect', 'POST', beeSid), env);
      await bucket.delete(`bee/mcp/${mcpSid}.json`).catch(() => {});
      return toolText('Bee account disconnected and credentials purged for this session.');
    }
    default:
      return null;
  }
}

// --- request handling --------------------------------------------------------

async function getSession(bucket, mcpSid) {
  if (!mcpSid || !/^[A-Za-z0-9]{24}$/.test(mcpSid)) return null;
  const s = await r2GetJson(bucket, `bee/mcp/${mcpSid}.json`);
  if (!s || Date.now() - (s.created_at || 0) > SESSION_TTL_MS) {
    if (s) await bucket.delete(`bee/mcp/${mcpSid}.json`).catch(() => {});
    return null;
  }
  return s;
}

export async function handleMcp(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS } });

  // --- auth (mirrors /api/agent-gateway) ---
  const configuredToken = (env.MCP_WORKER_TOKEN || '').trim();
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const suppliedToken = bearer || url.searchParams.get('token') || '';
  if (!configuredToken || !(await secureTokenEqual(suppliedToken, configuredToken))) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: configuredToken ? 401 : 503,
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
    });
  }
  if (env.GATEWAY_RATE_LIMITER) {
    const { success } = await env.GATEWAY_RATE_LIMITER.limit({ key: `mcp:${await sha256Hex(suppliedToken)}` });
    if (!success) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
        status: 429,
        headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
      });
    }
  }

  if (request.method === 'DELETE') {
    const sid = request.headers.get('mcp-session-id') || '';
    const session = await getSession(env.ASSETS, sid);
    if (!session) return rpcError(null, -32000, 'Unknown session.', null, 404);
    const beeSid = session.sid || sid;
    try {
      await beeDisconnect(internalRequest('/api/bee/disconnect', 'POST', beeSid), env);
    } catch {}
    await env.ASSETS.delete(`bee/mcp/${sid}.json`).catch(() => {});
    return new Response(null, { status: 202, headers: { ...CORS } });
  }

  if (request.method === 'GET') {
    // Server-initiated SSE streams are not offered; Streamable HTTP POST only.
    return new Response(JSON.stringify({ error: 'Use POST for MCP requests.' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
    });
  }

  if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405, headers: { ...CORS } });

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: invalid JSON.', null);
  }
  if (Array.isArray(body)) return rpcError(null, -32600, 'Batch requests are not supported.', null);
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body?.id ?? null, -32600, 'Invalid Request.', null);
  }
  const { id, method, params } = body;

  // Notifications: no response body.
  if (method.startsWith('notifications/')) return new Response(null, { status: 202, headers: { ...CORS } });

  if (method === 'initialize') {
    const sid = newSessionId();
    await r2PutJson(env.ASSETS, `bee/mcp/${sid}.json`, { sid, created_at: Date.now() });
    return rpcResult(
      id,
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      },
      sid,
    );
  }

  // Everything below requires a live session.
  const sessionId = request.headers.get('mcp-session-id') || '';
  const session = await getSession(env.ASSETS, sessionId);
  if (!session) return rpcError(id, -32000, 'Unknown or expired session. Send initialize first.', null, 404);

  if (method === 'ping') return rpcResult(id, {}, sessionId);

  if (method === 'tools/list') {
    const cursor = params?.cursor;
    if (cursor) return rpcError(id, -32602, 'Invalid params: pagination not supported.', sessionId);
    return rpcResult(id, { tools: TOOLS }, sessionId);
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${toolName}.`, sessionId);
    let outcome;
    try {
      outcome = await callTool(toolName, params?.arguments, sessionId, env);
    } catch (e) {
      return rpcResult(id, toolError(`Tool failed: ${e instanceof Error ? e.message : 'unknown error'}.`), sessionId);
    }
    if (!outcome) return rpcError(id, -32602, `Unknown tool: ${toolName}.`, sessionId);
    return rpcResult(id, outcome, sessionId);
  }

  return rpcError(id, -32601, `Method not found: ${method}.`, sessionId);
}
