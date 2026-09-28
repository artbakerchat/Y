// ---------------------------------------------------------------------------
// Bee device-connect + chat for the public website.
//
// No logins, no accounts: a visitor connects their Bee device (device flow)
// and gets the Y Bee agent. Identity is the Bee account id; the $5/week
// budget, rate limits, and the 3-strikes ban are all keyed to it.
//
// State lives in the ASSETS R2 bucket under bee/:
//   bee/session/<sid>.json      visitor session -> { account_id, ... }
//   bee/tokens/<account>.json   AES-GCM encrypted Bee token {iv, data}
//   bee/spend/<account>/<wk>.json { usd, chats }
//   bee/hourly/<account>/<h>.json { count }      per-account hourly rate limit
//   bee/strikes/<account>.json  { strikes, banned }
//   bee/accounts.json           [account ids] for the weekly strike job
//   bee/active/<sid>.json       concurrency marker { expires_at }
//   bee/last_strike_week.json   { week } strike-job watermark
//
// Worker secrets: BEE_TOKEN_KEY (base64, 32 random bytes), BEE_AGENT_RUNTIME_ARN,
// plus the existing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
// ---------------------------------------------------------------------------

const WEEK_BUDGET_USD = 5;
const NOVA_IN_PER_1M_USD = 0.06;
const NOVA_OUT_PER_1M_USD = 0.24;
const FALLBACK_TURN_USD = 0.002;
const CHAT_MIN_INTERVAL_MS = 3000;
const CHAT_HOURLY_LIMIT = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BEE_COOKIE = 'bee_session';
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

const te = new TextEncoder();
const td = new TextDecoder();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

// --- crypto helpers (mirrors worker.js) ------------------------------------

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? te.encode(value) : value);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, te.encode(value)));
}

async function signingKey(secret, date, region, service) {
  const dateKey = await hmac(te.encode(`AWS4${secret}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

function b64encode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// --- R2 helpers --------------------------------------------------------------

async function r2Get(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

async function r2Put(bucket, key, value) {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

async function r2Del(bucket, key) {
  await bucket.delete(key);
}

// --- token encryption --------------------------------------------------------

async function tokenKey(env) {
  const raw = (env.BEE_TOKEN_KEY || '').trim();
  if (!raw) throw new Error('BEE_TOKEN_KEY is not configured');
  const bytes = b64decode(raw);
  if (bytes.length !== 32) throw new Error('BEE_TOKEN_KEY must be 32 bytes, base64-encoded');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptToken(env, token) {
  const key = await tokenKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(token));
  return { iv: b64encode(iv), data: b64encode(new Uint8Array(ct)) };
}

async function decryptToken(env, sealed) {
  const key = await tokenKey(env);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(sealed.iv) },
    key,
    b64decode(sealed.data),
  );
  return td.decode(pt);
}

// --- AgentCore invocation ----------------------------------------------------

async function readBeeAgentResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Bee agent returned an empty body');
  const decoder = new TextDecoder();
  let size = 0;
  let raw = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Bee agent response exceeded size limit');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) throw new Error(`Bee agent request failed (${response.status})`);
  return JSON.parse(raw);
}

async function invokeBeeRuntime(env, agentcoreSessionId, payload, timeoutMs = 90000) {
  const region = env.AWS_REGION || 'ca-central-1';
  const runtimeArn = env.BEE_AGENT_RUNTIME_ARN;
  if (!runtimeArn) throw new Error('BEE_AGENT_RUNTIME_ARN is not configured');
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error('Bedrock credentials are not configured');
  const host = `bedrock-agentcore.${region}.amazonaws.com`;
  const encodedArn = encodeURIComponent(runtimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;
  const query = 'qualifier=DEFAULT';
  const body = JSON.stringify(payload);
  const payloadHash = await sha256Hex(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const sessionToken = env.AWS_SESSION_TOKEN?.trim();
  const headerLines = [
    'content-type:application/json',
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    `x-amzn-bedrock-agentcore-runtime-session-id:${agentcoreSessionId}`,
  ];
  if (sessionToken) headerLines.push(`x-amz-security-token:${sessionToken}`);
  headerLines.sort();
  const signedHeaders = headerLines.map((l) => l.slice(0, l.indexOf(':'))).join(';');
  const canonicalRequest = ['POST', path.replaceAll('%', '%25'), query, `${headerLines.join('\n')}\n`, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/bedrock-agentcore/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const sigBytes = await hmac(await signingKey(env.AWS_SECRET_ACCESS_KEY, date, region, 'bedrock-agentcore'), stringToSign);
  const signature = [...sigBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const response = await fetch(`https://${host}${path}?${query}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'content-type': 'application/json',
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amzn-bedrock-agentcore-runtime-session-id': agentcoreSessionId,
      ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    },
    body,
  });
  return readBeeAgentResponse(response);
}

// --- sessions, weeks, money --------------------------------------------------

function beeSessionId(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)bee_session=([A-Za-z0-9_-]{1,128})/);
  return m ? m[1] : '';
}

function newBeeSessionId() {
  return b64encode(crypto.getRandomValues(new Uint8Array(24))).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 's';
}

function beeCookieHeader(sid, maxAgeSec) {
  return `${BEE_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function clearBeeCookieHeader() {
  return `${BEE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isoWeek(date = new Date()) {
  // ISO-8601 week: YYYY-Www
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4day = (jan4.getUTCDay() + 6) % 7;
  const week1monday = new Date(jan4);
  week1monday.setUTCDate(jan4.getUTCDate() - jan4day);
  const week = 1 + Math.round((d - week1monday) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13).replace(/[-:T]/g, '');
}

function chatCostUsd(usage) {
  const input = Number(usage?.input_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  const computed = (input / 1e6) * NOVA_IN_PER_1M_USD + (output / 1e6) * NOVA_OUT_PER_1M_USD;
  return computed > 0 ? computed : FALLBACK_TURN_USD;
}

async function isBanned(bucket, accountId) {
  const strikes = await r2Get(bucket, `bee/strikes/${accountId}.json`);
  return Boolean(strikes?.banned);
}

async function spendThisWeek(bucket, accountId) {
  return (await r2Get(bucket, `bee/spend/${accountId}/${isoWeek()}.json`)) || { usd: 0, chats: 0 };
}

// --- routes ------------------------------------------------------------------

async function beeConnect(request, env) {
  const bucket = env.ASSETS;
  const sid = newBeeSessionId();
  const pairSession = `bee-pair-${sid}`;
  let pairing;
  try {
    pairing = await invokeBeeRuntime(env, pairSession, { action: 'pair' }, 30000);
  } catch (e) {
    return json({ error: 'Could not start Bee pairing. Try again.' }, 502);
  }
  if (!pairing?.ok || !pairing.pairing_url) {
    return json({ error: 'Could not start Bee pairing. Try again.' }, 502);
  }
  await r2Put(bucket, `bee/session/${sid}.json`, {
    created_at: Date.now(),
    pair_session: pairSession,
    pair_request_id: pairing.request_id,
    pair_expires_at: pairing.expires_at,
    account_id: null,
  });
  return json(
    { pairing_url: pairing.pairing_url, expires_at: pairing.expires_at },
    200,
    { 'set-cookie': beeCookieHeader(sid, 86400) },
  );
}

async function beeStatus(request, env) {
  const bucket = env.ASSETS;
  const sid = beeSessionId(request);
  if (!sid) return json({ status: 'unknown' }, 404);
  const session = await r2Get(bucket, `bee/session/${sid}.json`);
  if (!session) return json({ status: 'unknown' }, 404);
  if (session.account_id) {
    if (await isBanned(bucket, session.account_id)) return json({ status: 'banned' }, 403);
    return json({ status: 'approved' });
  }
  let res;
  try {
    res = await invokeBeeRuntime(env, session.pair_session, { action: 'pair_status' }, 30000);
  } catch (e) {
    return json({ error: 'Pairing check failed. Try again.' }, 502);
  }
  if (!res?.ok) return json({ status: 'pending' });
  if (res.status === 'expired') return json({ status: 'expired' });
  if (res.status !== 'approved' || !res.bee_token) return json({ status: 'pending', expires_at: res.expires_at });

  // Approved: resolve the Bee account id, then store the token encrypted.
  let accountId = null;
  try {
    const who = await invokeBeeRuntime(env, session.pair_session, { action: 'whoami' }, 30000);
    if (who?.ok && who.account_id) accountId = String(who.account_id);
  } catch (e) {
    return json({ error: 'Could not read the Bee account. Try again.' }, 502);
  }
  if (!accountId) return json({ error: 'Could not read the Bee account. Try again.' }, 502);
  if (await isBanned(bucket, accountId)) {
    try { await invokeBeeRuntime(env, session.pair_session, { action: 'disconnect' }, 15000); } catch {}
    await r2Del(bucket, `bee/session/${sid}.json`);
    return json({ status: 'banned' }, 403);
  }
  try {
    await r2Put(bucket, `bee/tokens/${accountId}.json`, await encryptToken(env, res.bee_token));
  } catch (e) {
    return json({ error: 'Token storage is not configured.' }, 503);
  }
  const accounts = (await r2Get(bucket, 'bee/accounts.json')) || [];
  if (!accounts.includes(accountId)) {
    accounts.push(accountId);
    await r2Put(bucket, 'bee/accounts.json', accounts);
  }
  await r2Put(bucket, `bee/session/${sid}.json`, { ...session, account_id: accountId, connected_at: Date.now() });
  // Purge the pairing microVM's copy of the token now; it would idle out anyway.
  try { await invokeBeeRuntime(env, session.pair_session, { action: 'disconnect' }, 15000); } catch {}
  return json({ status: 'approved' });
}

async function beeChat(request, env) {
  const bucket = env.ASSETS;
  const sid = beeSessionId(request);
  if (!sid) return json({ error: 'Not connected.' }, 401);
  const session = await r2Get(bucket, `bee/session/${sid}.json`);
  const accountId = session?.account_id;
  if (!accountId) return json({ error: 'Not connected.' }, 401);
  if (await isBanned(bucket, accountId)) return json({ error: 'This Bee account is blocked.' }, 403);

  // $5/week budget, keyed to the Bee account.
  const spend = await spendThisWeek(bucket, accountId);
  if (spend.usd >= WEEK_BUDGET_USD) {
    return json({ error: 'Weekly budget reached. Try again next week.' }, 429);
  }

  // Per-session pace + per-account hourly cap.
  const now = Date.now();
  if (session.last_chat_at && now - session.last_chat_at < CHAT_MIN_INTERVAL_MS) {
    return json({ error: 'Slow down a little.' }, 429);
  }
  const hk = `bee/hourly/${accountId}/${hourKey()}.json`;
  const hourly = (await r2Get(bucket, hk)) || { count: 0 };
  if (hourly.count >= CHAT_HOURLY_LIMIT) return json({ error: 'Hourly limit reached.' }, 429);

  // Global concurrent-session cap.
  const maxSessions = Number(env.BEE_MAX_SESSIONS) || 20;
  const activeList = await bucket.list({ prefix: 'bee/active/' });
  let activeCount = 0;
  for (const obj of activeList.objects) {
    const marker = await r2Get(bucket, obj.key);
    if (marker && marker.expires_at > now) activeCount++;
  }
  const alreadyActive = await r2Get(bucket, `bee/active/${sid}.json`);
  if (!alreadyActive && activeCount >= maxSessions) {
    return json({ error: 'The service is busy right now. Try again shortly.' }, 429);
  }

  const sealed = await r2Get(bucket, `bee/tokens/${accountId}.json`);
  if (!sealed) return json({ error: 'Not connected.' }, 401);
  let beeToken;
  try {
    beeToken = await decryptToken(env, sealed);
  } catch (e) {
    return json({ error: 'Token storage is not configured.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return json({ error: 'Message is required.' }, 400);
  if (message.length > 4000) return json({ error: 'Message is too long.' }, 413);
  const history = Array.isArray(body?.history) ? body.history.slice(-12) : [];

  await r2Put(bucket, `bee/active/${sid}.json`, { expires_at: now + 10 * 60 * 1000 });
  let answer;
  try {
    answer = await invokeBeeRuntime(
      env,
      `bee-chat-${sid}`,
      { action: 'chat', prompt: message, bee_token: beeToken, history },
      100000,
    );
  } catch (e) {
    await r2Del(bucket, `bee/active/${sid}.json`);
    return json({ error: 'The Bee agent did not respond. Try again.' }, 502);
  }
  await r2Del(bucket, `bee/active/${sid}.json`);
  if (!answer?.ok) {
    return json({ error: answer?.error || 'The Bee agent failed.' }, 502);
  }

  const cost = chatCostUsd(answer.usage);
  await r2Put(bucket, `bee/spend/${accountId}/${isoWeek()}.json`, {
    usd: (spend.usd || 0) + cost,
    chats: (spend.chats || 0) + 1,
  });
  await r2Put(bucket, hk, { count: hourly.count + 1 });
  await r2Put(bucket, `bee/session/${sid}.json`, { ...session, last_chat_at: now });

  return json({ answer: answer.answer, files: answer.files || [] });
}

async function beeDisconnect(request, env) {
  const bucket = env.ASSETS;
  const sid = beeSessionId(request);
  if (sid) {
    const session = await r2Get(bucket, `bee/session/${sid}.json`);
    // Purge the chat microVM's copy of everything, then drop server state.
    // The Bee token itself is deleted: reconnecting starts over.
    try { await invokeBeeRuntime(env, `bee-chat-${sid}`, { action: 'disconnect' }, 15000); } catch {}
    if (session?.account_id) await r2Del(bucket, `bee/tokens/${session.account_id}.json`);
    await r2Del(bucket, `bee/session/${sid}.json`);
    await r2Del(bucket, `bee/active/${sid}.json`);
  }
  return json({ ok: true }, 200, { 'set-cookie': clearBeeCookieHeader() });
}

export async function handleBeeRoutes(request, env, url) {
  if (url.pathname === '/api/bee/connect' && request.method === 'POST') return beeConnect(request, env);
  if (url.pathname === '/api/bee/status' && request.method === 'GET') return beeStatus(request, env);
  if (url.pathname === '/api/bee/chat' && request.method === 'POST') return beeChat(request, env);
  if (url.pathname === '/api/bee/disconnect' && request.method === 'POST') return beeDisconnect(request, env);
  return null;
}

// --- scheduled maintenance (called from the Worker's cron) -------------------

export async function beeScheduled(env) {
  const bucket = env.ASSETS;
  const now = Date.now();
  // Expire stale visitor sessions and concurrency markers.
  const sessions = await bucket.list({ prefix: 'bee/session/' });
  for (const obj of sessions.objects) {
    const s = await r2Get(bucket, obj.key);
    if (s && now - (s.created_at || 0) > SESSION_TTL_MS) await r2Del(bucket, obj.key);
  }
  const active = await bucket.list({ prefix: 'bee/active/' });
  for (const obj of active.objects) {
    const m = await r2Get(bucket, obj.key);
    if (!m || m.expires_at <= now) await r2Del(bucket, obj.key);
  }
  // Weekly 3-strikes rollover.
  const week = isoWeek();
  const mark = await r2Get(bucket, 'bee/last_strike_week.json');
  if (mark?.week !== week) {
    const prevWeek = mark?.week;
    if (prevWeek) {
      const accounts = (await r2Get(bucket, 'bee/accounts.json')) || [];
      for (const accountId of accounts) {
        const strikes = (await r2Get(bucket, `bee/strikes/${accountId}.json`)) || { strikes: 0, banned: false };
        if (!strikes.banned) {
          const spend = await r2Get(bucket, `bee/spend/${accountId}/${prevWeek}.json`);
          if ((spend?.usd || 0) >= WEEK_BUDGET_USD - 1e-9) {
            strikes.strikes += 1;
            if (strikes.strikes >= 3) strikes.banned = true;
          } else {
            strikes.strikes = 0;
          }
          await r2Put(bucket, `bee/strikes/${accountId}.json`, strikes);
        }
      }
    }
    await r2Put(bucket, 'bee/last_strike_week.json', { week });
  }
}
