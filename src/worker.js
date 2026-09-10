const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const encoder = new TextEncoder();

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

async function askBedrock(message, env) {
  const region = env.AWS_REGION || 'ca-central-1';
  const modelId = env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0';
  const service = 'bedrock';
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const body = JSON.stringify({
    system: [{ text: 'You are Larboard, a concise and practical product-building agent. Give useful next steps and be transparent when uncertain. For neighborhoods, nonprofits, schools, libraries, food banks, and other local organizations, think group-first: optimize for collective benefit, low setup burden, privacy by default, accessibility, and clear human handoff. Be warm and respectful, especially when people may be under hardship. Do not invent local policies, schedules, or contact details; say what is unknown and suggest the right person or source to verify it.' }],
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
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const cleanPath = { '/index.html': '/', '/guide.html': '/guide', '/pinball.html': '/pinball', '/prompt.html': '/prompt', '/pricing.html': '/pricing' }[pathname];
  if (cleanPath) return Response.redirect(new URL(cleanPath, url), 301);
  if (pathname !== '/' && !pathname.includes('.')) pathname = `${pathname.replace(/\/+$/, '')}.html`;
  if (!/^\/[a-zA-Z0-9._/-]+$/.test(pathname) || pathname.includes('..')) return new Response('Not found.', { status: 404 });
  const key = pathname.slice(1);
  const object = await env.ASSETS.get(key);
  if (!object) return new Response('Not found.', { status: 404 });
  const headers = new Headers({ 'cache-control': key === 'index.html' ? 'no-cache' : 'public, max-age=3600', 'strict-transport-security': 'max-age=31536000; includeSubDomains' });
  const extension = key.slice(key.lastIndexOf('.'));
  headers.set('content-type', CONTENT_TYPES[extension] || object.httpMetadata?.contentType || 'application/octet-stream');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.protocol === 'http:') {
        url.protocol = 'https:';
        return Response.redirect(url, 301);
      }
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, region: env.AWS_REGION || 'ca-central-1', model: env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0' });
      }
      if (url.pathname === '/api/ask' && request.method === 'POST') {
        if (env.MODEL_REQUESTS_ENABLED !== 'true') return json({ error: 'Model requests are temporarily disabled.' }, 503);
        const body = await request.json();
        const message = typeof body?.message === 'string' ? body.message.trim() : '';
        if (!message) return json({ error: 'Message is required.' }, 400);
        if (message.length > 4000) return json({ error: 'Message is too long.' }, 413);
        if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return json({ error: 'Bedrock credentials are not configured.' }, 503);
        return json(await askBedrock(message, env));
      }
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      return await serveAsset(request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: error instanceof Error ? error.message : 'Worker error', path: url.pathname }));
      return json({ error: 'Runtime error. Check the Worker logs.' }, 500);
    }
  },
};
