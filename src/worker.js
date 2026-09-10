const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const HTML_ROUTES = {
  '/': 'index.html',
  '/guide': 'guide.html',
  '/pinball': 'pinball.html',
  '/prompt': 'prompt.html',
  '/pricing': 'pricing.html',
};

const LEGACY_HTML_ASSETS = {
  '/index.html': 'index.html',
  '/guide.html': 'guide.html',
  '/pinball.html': 'pinball.html',
  '/prompt.html': 'prompt.html',
  '/pricing.html': 'pricing.html',
};

const encoder = new TextEncoder();
const STATE_TTL_MS = 48 * 60 * 60 * 1000;
const DAILY_REQUEST_LIMIT = 20;
const REDIRECT_RATE_PERIOD_SECONDS = 60;
const DEFAULT_PALETTE = ['anchor','pinnacle','summit','twilight','static','ocean','wander','spark','gravity','money','book','Glimmer','compass','voyage','solitude','prism','nectar','blossom','fossil','zenith','vortex','mirage','starlight','ember','cyclone','glacier','radiance','labyrinth','aurora','thistle','apple','Nebula','crisp','whisper','avalanche','horizon','velvet','mosaic','thunder','marble','cascade','echo','lantern','silver','standard','puzzle','orbit','shadow','flicker','autumn','rhythm','canvas'];
const emptyState = () => ({ palette: [...DEFAULT_PALETTE], promptWords: [], messages: [], pendingPrompt: '', printer: { note: '', images: [null, null, null] }, rate: { day: new Date().toISOString().slice(0, 10), count: 0 }, expiresAt: Date.now() + STATE_TTL_MS });
function cleanState(value) { return { palette: Array.isArray(value?.palette) ? value.palette.filter((word) => typeof word === 'string').map((word) => word.trim()).filter(Boolean).slice(0, 52) : [...DEFAULT_PALETTE], promptWords: Array.isArray(value?.promptWords) ? value.promptWords.filter((word) => typeof word === 'string').slice(0, 52) : [], messages: Array.isArray(value?.messages) ? value.messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-100) : [], pendingPrompt: typeof value?.pendingPrompt === 'string' ? value.pendingPrompt.slice(0, 4000) : '', printer: { note: typeof value?.printer?.note === 'string' ? value.printer.note : '', images: Array.isArray(value?.printer?.images) ? value.printer.images.slice(0, 3).map((image) => image && typeof image.src === 'string' ? { src: image.src, uploadedAt: Number(image.uploadedAt) || Date.now() } : null) : [null, null, null] }, rate: { day: typeof value?.rate?.day === 'string' ? value.rate.day : new Date().toISOString().slice(0, 10), count: Number.isFinite(Number(value?.rate?.count)) ? Math.max(0, Number(value.rate.count)) : 0 }, expiresAt: Number(value?.expiresAt) || Date.now() + STATE_TTL_MS }; }
function sessionIdFrom(request) { const match = request.headers.get('cookie')?.match(/(?:^|;\s*)larboard_session=([^;]+)/); return match?.[1] || crypto.randomUUID(); }
async function loadState(bucket, sessionId) { const key = `sessions/${sessionId}.json`; const object = await bucket.get(key); if (!object) return emptyState(); try { const raw = await object.json(); if (!Number.isFinite(Number(raw.expiresAt)) || Number(raw.expiresAt) <= Date.now()) { await bucket.delete(key); return emptyState(); } return cleanState(raw); } catch { await bucket.delete(key); return emptyState(); } }
async function saveState(bucket, sessionId, state) { const clean = cleanState(state); await bucket.put(`sessions/${sessionId}.json`, JSON.stringify({ ...clean, expiresAt: Number(state.expiresAt) || clean.expiresAt }), { httpMetadata: { contentType: 'application/json' } }); }
async function purgeExpiredState(bucket) { let cursor; do { const listed = await bucket.list({ prefix: 'sessions/', cursor, limit: 1000 }); await Promise.all(listed.objects.map(async (object) => { try { const stateObject = await bucket.get(object.key); const state = await stateObject.json(); if (!Number.isFinite(Number(state.expiresAt)) || Number(state.expiresAt) <= Date.now()) await bucket.delete(object.key); } catch { await bucket.delete(object.key); } })); cursor = listed.truncated ? listed.cursor : undefined; } while (cursor); }
function stateResponse(body, sessionId) { return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax` } }); }
async function allowLegacyAlias(request, env) {
  if (!env.REDIRECT_RATE_LIMITER) return true;
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await env.REDIRECT_RATE_LIMITER.limit({ key: `legacy-alias:${clientIp}` });
  return success;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'strict-transport-security': 'max-age=31536000; includeSubDomains' },
  });
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clarificationQuestion(message) {
  return 'Before I reason about that, what outcome would be most useful to you?';
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
}

async function signingKey(secret, date, region, service) {
  const dateKey = await hmac(encoder.encode(`AWS4${secret}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

async function invokeAgentCore(message, palette, env, request) {
  const region = env.AWS_REGION || 'ca-central-1';
  const runtimeArn = env.AGENTCORE_RUNTIME_ARN;
  const host = env.AGENTCORE_RUNTIME_HOST || `bedrock-agentcore.${region}.amazonaws.com`;
  const encodedArn = encodeURIComponent(runtimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;
  const query = 'qualifier=DEFAULT';
  const body = JSON.stringify({ prompt: message, palette, toolPolicy: { source: 'word_palette_only', allowedTools: ['lookup_word_palette'] } });
  const payloadHash = await sha256Hex(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const sessionId = request.headers.get('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id') || crypto.randomUUID();
  const sessionToken = env.AWS_SESSION_TOKEN?.trim();
  const canonicalHeaderLines = [`content-type:application/json`, `host:${host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`, `x-amzn-bedrock-agentcore-runtime-session-id:${sessionId}`];
  if (sessionToken) canonicalHeaderLines.push(`x-amz-security-token:${sessionToken}`);
  const signedHeaders = sessionToken ? 'content-type;host;x-amz-content-sha256;x-amz-date;x-amzn-bedrock-agentcore-runtime-session-id;x-amz-security-token' : 'content-type;host;x-amz-content-sha256;x-amz-date;x-amzn-bedrock-agentcore-runtime-session-id';
  const canonicalRequest = ['POST', path.replaceAll('%', '%25'), query, `${canonicalHeaderLines.join('\n')}\n`, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/bedrock-agentcore/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const signatureBytes = await hmac(await signingKey(env.AWS_SECRET_ACCESS_KEY, date, region, 'bedrock-agentcore'), stringToSign);
  const signature = [...signatureBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}${path}?${query}`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amzn-bedrock-agentcore-runtime-session-id': sessionId,
      ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    },
    body,
  });
  if (!response.ok) throw new Error(`AgentCore request failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  const result = await response.json();
  const answer = result.output?.message?.content?.map((part) => part.text || '').join('') || result.output || result.response || result.text || 'AgentCore returned an empty response.';
  return { answer: typeof answer === 'string' ? answer : JSON.stringify(answer), agent: true, runtime: 'agentcore' };
}

async function askBedrock(message, palette, env) {
  const region = env.AWS_REGION || 'ca-central-1';
  const modelId = env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0';
  const service = 'bedrock';
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const body = JSON.stringify({
    system: [{ text: `You are Larboard. The user’s word palette is: ${palette.length ? palette.join(', ') : '(empty)'}. Use only listed palette words as source data. If the user asks for a question using the palette, create a different, original question—not a repetition, quotation, or close paraphrase of the user’s wording. Base the question on the overall theme, relationships, or combined imagery of the palette rather than on one isolated word. Output exactly one natural-sounding, grammatically complete question and nothing else. Include relevant palette words naturally, and use synonyms or related expressions when they help make the question distinct. Function words needed for grammar are allowed. Do not invent palette entries or add a preamble.` }],
    messages: [{ role: 'user', content: [{ text: message }] }],
    inferenceConfig: { maxTokens: 700, temperature: 0.5 },
  });
  const payloadHash = await sha256Hex(body);
  const encodedModel = encodeURIComponent(modelId);
  const requestUri = `/model/${encodedModel}/converse`;
  const canonicalUri = `/model/${encodedModel.replaceAll('%', '%25')}/converse`;
  const sessionToken = env.AWS_SESSION_TOKEN?.trim();
  const canonicalHeaderLines = [`content-type:application/json`, `host:${host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`];
  if (sessionToken) canonicalHeaderLines.push(`x-amz-security-token:${sessionToken}`);
  const canonicalHeaders = `${canonicalHeaderLines.join('\n')}\n`;
  const signedHeaders = sessionToken ? 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token' : 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const signatureBytes = await hmac(await signingKey(env.AWS_SECRET_ACCESS_KEY, date, region, service), stringToSign);
  const signature = [...signatureBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}${requestUri}`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    },
    body,
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Bedrock request failed (${response.status}): ${details.slice(0, 240)}`);
  }
  const result = await response.json();
  const answer = result.output?.message?.content?.map((part) => part.text || '').join('') || 'The model returned an empty response.';
  return { answer, agent: false };
}

async function serveAsset(request, env) {
  const url = new URL(request.url);
  const originalPathname = url.pathname;
  if (LEGACY_HTML_ASSETS[originalPathname] && !await allowLegacyAlias(request, env)) {
    return new Response('Too many legacy URL requests. Please try again in a minute.', { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': String(REDIRECT_RATE_PERIOD_SECONDS) } });
  }
  const key = HTML_ROUTES[originalPathname] || LEGACY_HTML_ASSETS[originalPathname] || originalPathname.slice(1);
  if (!key || !/^\/[a-zA-Z0-9._/-]+$/.test(`/${key}`) || key.includes('..')) return new Response('Not found.', { status: 404 });
  const object = await env.ASSETS.get(key);
  if (!object) return new Response('Not found.', { status: 404 });
  const headers = new Headers({ 'cache-control': key.endsWith('.html') ? 'no-store' : 'public, max-age=3600', 'strict-transport-security': 'max-age=31536000; includeSubDomains' });
  const extension = key.slice(key.lastIndexOf('.'));
  headers.set('content-type', CONTENT_TYPES[extension] || object.httpMetadata?.contentType || 'application/octet-stream');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async scheduled(controller, env) {
    await purgeExpiredState(env.ASSETS);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, region: env.AWS_REGION || 'ca-central-1', model: env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0' });
      }
      const sessionId = sessionIdFrom(request);
      if (url.pathname === '/api/state' && request.method === 'GET') return stateResponse(await loadState(env.ASSETS, sessionId), sessionId);
      if (url.pathname === '/api/state' && request.method === 'POST') { const current = await loadState(env.ASSETS, sessionId); const next = cleanState({ ...current, ...(await request.json()) }); await saveState(env.ASSETS, sessionId, next); return stateResponse(next, sessionId); }
      if (url.pathname === '/api/ask' && request.method === 'POST') {
        const body = await request.json();
        const message = typeof body?.prompt === 'string' ? body.prompt.trim() : typeof body?.message === 'string' ? body.message.trim() : '';
        if (!message) return json({ error: 'Message is required.' }, 400);
        if (message.length > 4000) return json({ error: 'Message is too long.' }, 413);
        const state = await loadState(env.ASSETS, sessionId);
        const pendingPrompt = state.pendingPrompt;
        if (pendingPrompt && env.MODEL_REQUESTS_ENABLED !== 'true' && !env.AGENTCORE_RUNTIME_ARN) return json({ error: 'Model requests are temporarily disabled.' }, 503);
        if (pendingPrompt && (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)) return json({ error: 'Bedrock credentials are not configured.' }, 503);
        const today = new Date().toISOString().slice(0, 10);
        if (state.rate.day !== today) state.rate = { day: today, count: 0 };
        if (state.rate.count >= DAILY_REQUEST_LIMIT) return new Response(JSON.stringify({ error: 'Daily request limit reached. Please try again tomorrow.', limit: DAILY_REQUEST_LIMIT }), { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, 'retry-after': String(86400 - Math.floor((Date.now() - new Date(`${today}T00:00:00Z`).getTime()) / 1000)) } });
        const answer = pendingPrompt ? (env.AGENTCORE_RUNTIME_ARN ? await invokeAgentCore(`Original request: ${pendingPrompt}\n\nUser clarification: ${message}`, state.palette, env, request) : await askBedrock(`Original request: ${pendingPrompt}\n\nUser clarification: ${message}`, state.palette, env)) : { answer: clarificationQuestion(message), agent: Boolean(env.AGENTCORE_RUNTIME_ARN), clarification: true };
        state.pendingPrompt = answer.clarification ? message : '';
        state.rate.count += 1;
        state.messages = [...state.messages, { role: 'user', content: message, createdAt: new Date().toISOString() }, { role: 'assistant', content: answer.answer, createdAt: new Date().toISOString() }];
        await saveState(env.ASSETS, sessionId, state);
        return stateResponse(answer, sessionId);
      }
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      return await serveAsset(request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: error instanceof Error ? error.message : 'Worker error', path: url.pathname }));
      return json({ error: 'Runtime error. Check the Worker logs.' }, 500);
    }
  },
};
