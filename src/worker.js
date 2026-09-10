const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const HTML_ROUTES = {
  '/': 'index.html',
  '/pinball': 'pinball.html',
  '/prompt': 'prompt.html',
  '/pricing': 'pricing.html',
  '/printer': 'printer.html',
};

const LEGACY_HTML_ASSETS = {
  '/index.html': 'index.html',
  '/pinball.html': 'pinball.html',
  '/prompt.html': 'prompt.html',
  '/pricing.html': 'pricing.html',
  '/printer.html': 'printer.html',
};

const CANONICAL_HTML_ROUTES = {
  '/index.html': '/',
  '/pinball.html': '/pinball',
  '/prompt.html': '/prompt',
  '/pricing.html': '/pricing',
  '/printer.html': '/printer',
};

const encoder = new TextEncoder();
const STATE_TTL_MS = 48 * 60 * 60 * 1000;
const DAILY_REQUEST_LIMIT = 20;
const MAX_REQUEST_WORDS = 52;
const MAX_WORD_CHARACTERS = 16;
const REDIRECT_RATE_PERIOD_SECONDS = 60;
const DEFAULT_PALETTE = ['anchor','pinnacle','summit','twilight','static','ocean','wander','spark','gravity','money','book','Glimmer','compass','voyage','solitude','prism','nectar','blossom','fossil','zenith','vortex','mirage','starlight','ember','cyclone','glacier','radiance','labyrinth','aurora','thistle','apple','Nebula','crisp','whisper','avalanche','horizon','velvet','mosaic','thunder','marble','cascade','echo','lantern','silver','standard','puzzle','orbit','shadow','flicker','autumn','rhythm','canvas'];
const emptyState = () => ({ palette: [...DEFAULT_PALETTE], promptWords: [], messages: [], pendingPrompt: '', printer: { note: '', images: [null, null, null] }, rate: { day: new Date().toISOString().slice(0, 10), count: 0 }, expiresAt: Date.now() + STATE_TTL_MS });
function cleanState(value) { return { palette: Array.isArray(value?.palette) ? value.palette.filter((word) => typeof word === 'string').map((word) => word.trim()).filter((word) => word && word.length <= MAX_WORD_CHARACTERS).slice(0, 52) : [...DEFAULT_PALETTE], promptWords: Array.isArray(value?.promptWords) ? value.promptWords.filter((word) => typeof word === 'string' && word.length <= MAX_WORD_CHARACTERS).slice(0, 52) : [], messages: Array.isArray(value?.messages) ? value.messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-100) : [], pendingPrompt: typeof value?.pendingPrompt === 'string' ? value.pendingPrompt.slice(0, 4000) : '', printer: { note: typeof value?.printer?.note === 'string' ? value.printer.note : '', images: Array.isArray(value?.printer?.images) ? value.printer.images.slice(0, 3).map((image) => image && typeof image.src === 'string' ? { src: image.src, uploadedAt: Number(image.uploadedAt) || Date.now() } : null) : [null, null, null] }, rate: { day: typeof value?.rate?.day === 'string' ? value.rate.day : new Date().toISOString().slice(0, 10), count: Number.isFinite(Number(value?.rate?.count)) ? Math.max(0, Number(value.rate.count)) : 0 }, expiresAt: Number(value?.expiresAt) || Date.now() + STATE_TTL_MS }; }
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

function requestWordCount(message) {
  return message.trim() ? message.trim().split(/\s+/).length : 0;
}

function hasOversizedWord(message) {
  return message.trim().split(/\s+/).some((word) => word.length > MAX_WORD_CHARACTERS);
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

async function invokeAgentCore(message, palette, history, env, request) {
  const region = env.AWS_REGION || 'ca-central-1';
  const runtimeArn = env.AGENTCORE_RUNTIME_ARN;
  const host = env.AGENTCORE_RUNTIME_HOST || `bedrock-agentcore.${region}.amazonaws.com`;
  const encodedArn = encodeURIComponent(runtimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;
  const query = 'qualifier=DEFAULT';
  const body = JSON.stringify({ prompt: message, palette });
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

// ---------------------------------------------------------------------------
// LOW-LEVEL BEDROCK CONVERSE
// Shared by the agent loop, post-response steering check, and word specialist.
// Accepts a full messages array and optional toolConfig.
// ---------------------------------------------------------------------------
async function bedrockConverse(env, { system, messages, toolConfig, maxTokens = 700, temperature = 0.5 }) {
  const region = env.AWS_REGION || 'ca-central-1';
  const modelId = env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0';
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);

  const payload = { system, messages, inferenceConfig: { maxTokens, temperature } };
  if (toolConfig) payload.toolConfig = toolConfig;

  const body = JSON.stringify(payload);
  const payloadHash = await sha256Hex(body);
  const encodedModel = encodeURIComponent(modelId);
  const requestUri = `/model/${encodedModel}/converse`;
  const canonicalUri = `/model/${encodedModel.replaceAll('%', '%25')}/converse`;
  const sessionToken = env.AWS_SESSION_TOKEN?.trim();
  const canonicalHeaderLines = [
    'content-type:application/json',
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ];
  if (sessionToken) canonicalHeaderLines.push(`x-amz-security-token:${sessionToken}`);
  const canonicalHeaders = `${canonicalHeaderLines.join('\n')}\n`;
  const signedHeaders = sessionToken
    ? 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    : 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/bedrock/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const signatureBytes = await hmac(await signingKey(env.AWS_SECRET_ACCESS_KEY, date, region, 'bedrock'), stringToSign);
  const signature = [...signatureBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  return response.json();
}

// ---------------------------------------------------------------------------
// MODULE 1: TOOLS
// Plain JS functions the agent can invoke via Bedrock toolConfig.
// Each entry: spec (Bedrock tool spec) + fn (local implementation).
// ---------------------------------------------------------------------------
function buildTools(palette) {
  return [
    {
      spec: {
        name: 'get_palette',
        description: 'Return the current word palette so the agent can reason about it.',
        inputSchema: { json: { type: 'object', properties: {}, required: [] } },
      },
      fn: async () => palette.length
        ? `Current palette (${palette.length} words): ${palette.join(', ')}`
        : 'The palette is empty.',
    },
    {
      spec: {
        name: 'search_palette',
        description: 'Search the palette for words matching a substring.',
        inputSchema: {
          json: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Substring to search for' } },
            required: ['query'],
          },
        },
      },
      fn: async ({ query }) => {
        const q = (query || '').toLowerCase();
        const matches = palette.filter((w) => w.toLowerCase().includes(q));
        return matches.length
          ? `Found ${matches.length} match(es): ${matches.join(', ')}`
          : `No palette words match "${query}".`;
      },
    },
    {
      spec: {
        name: 'suggest_related_words',
        description: 'Suggest thematically related words that could be added to the palette.',
        inputSchema: {
          json: {
            type: 'object',
            properties: { theme: { type: 'string', description: 'The theme or concept to base suggestions on' } },
            required: ['theme'],
          },
        },
      },
      fn: async ({ theme }) => {
        const banks = {
          nature: ['glacier', 'canopy', 'driftwood', 'mesa', 'shoreline'],
          light:  ['prism', 'glimmer', 'radiance', 'flicker', 'beacon'],
          motion: ['cascade', 'vortex', 'drift', 'surge', 'current'],
          time:   ['epoch', 'solstice', 'twilight', 'meridian', 'cycle'],
        };
        const key = Object.keys(banks).find((k) => theme.toLowerCase().includes(k));
        const words = key ? banks[key] : ['horizon', 'ember', 'mosaic', 'compass', 'echo'];
        return `Suggested words for theme "${theme}": ${words.join(', ')}`;
      },
    },
    {
      // Module 6: this tool delegates to a second Bedrock call (word specialist).
      spec: {
        name: 'consult_word_specialist',
        description: 'Delegate to a specialist agent for deep word-craft advice: etymology, connotation, or poetic use of a word.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              word:   { type: 'string', description: 'The word to analyse' },
              aspect: { type: 'string', description: 'Focus area: etymology | connotation | poetic_use' },
            },
            required: ['word'],
          },
        },
      },
      fn: null, // dispatched via invokeWordSpecialist — see agent loop below
    },
  ];
}

// ---------------------------------------------------------------------------
// MODULE 3: SKILLS
// Markdown procedures stored in R2 under skills/<name>.md.
// The skill index maps keywords to skill names; the loader falls back to
// inline text when R2 is unavailable so the mechanism always works.
// ---------------------------------------------------------------------------
const SKILL_INDEX = [
  { name: 'palette-building',   keywords: ['add', 'suggest', 'grow', 'expand', 'palette', 'word', 'theme'] },
  { name: 'word-exploration',   keywords: ['meaning', 'connotation', 'origin', 'etymology', 'explore', 'understand'] },
  { name: 'conversation-style', keywords: ['tone', 'style', 'voice', 'rewrite', 'formal', 'casual', 'poetic'] },
];

const INLINE_SKILLS = {
  'palette-building': [
    '# Skill: Palette Building',
    '1. Ask the user what theme or feeling they want to capture.',
    '2. Use suggest_related_words to generate candidates.',
    '3. Present the suggestions and invite the user to pick.',
    '4. Confirm which words to add and update the palette.',
    '5. Ask if they want to explore another theme.',
  ].join('\n'),
  'word-exploration': [
    '# Skill: Word Exploration',
    '1. Identify the word the user wants to explore.',
    '2. Use consult_word_specialist with the appropriate aspect.',
    '3. Share the findings in plain language.',
    '4. Relate the word back to the existing palette if relevant.',
    '5. Ask a gentle follow-up to deepen the conversation.',
  ].join('\n'),
  'conversation-style': [
    '# Skill: Conversation Style',
    '1. Ask the user what tone they are aiming for (formal / casual / poetic).',
    '2. Use search_palette to find words matching that tone.',
    '3. Suggest replacements or additions.',
    '4. Offer a short example sentence using their chosen words.',
    '5. Invite feedback and iterate.',
  ].join('\n'),
};

async function loadSkill(name, env) {
  if (env.ASSETS) {
    try {
      const obj = await env.ASSETS.get(`skills/${name}.md`);
      if (obj) return obj.text();
    } catch { /* fall through to inline */ }
  }
  return INLINE_SKILLS[name] || null;
}

async function resolveSkill(message, env) {
  const lower = message.toLowerCase();
  for (const skill of SKILL_INDEX) {
    if (skill.keywords.some((kw) => lower.includes(kw))) {
      const text = await loadSkill(skill.name, env);
      if (text) return text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// MODULE 2: HOOKS
// Per-request tool-call rate limiter. A fresh counter is created for every
// invocation. beforeToolCall returns null to proceed, or a cancellation
// string to skip the tool and feed that message back to the model.
// ---------------------------------------------------------------------------
const MAX_TOOL_CALLS_PER_REQUEST = 3;

function createHooks() {
  const counts = {};
  return {
    beforeToolCall(toolName) {
      counts[toolName] = (counts[toolName] || 0) + 1;
      if (counts[toolName] > MAX_TOOL_CALLS_PER_REQUEST) {
        return `'${toolName}' has already been called ${MAX_TOOL_CALLS_PER_REQUEST} time(s) this request. Do not call it again.`;
      }
      return null;
    },
    getCounts() { return { ...counts }; },
  };
}

// ---------------------------------------------------------------------------
// MODULE 3: STEERING
// Two layers:
//   beforeTool — deterministic pre-tool validation (blocks tools until
//                prerequisites have run).
//   steerPostResponse — a lightweight second Bedrock call that checks the
//                       final answer for quality/tone before it is returned.
// ---------------------------------------------------------------------------
function createSteering(toolLog) {
  return {
    beforeTool(toolName) {
      // suggest_related_words requires the palette to have been inspected first.
      if (toolName === 'suggest_related_words') {
        const paletteChecked = toolLog.some((t) => t === 'get_palette' || t === 'search_palette');
        if (!paletteChecked) {
          return 'You must call get_palette or search_palette first to understand the existing palette before suggesting new words.';
        }
      }
      return null;
    },
  };
}

async function steerPostResponse(answer, env) {
  // Skip when credentials are absent (local dev / preview mode).
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return answer;
  try {
    const result = await bedrockConverse(env, {
      system: [{ text: 'You are a quality reviewer for a conversational AI. Evaluate the reply. If it is clear, helpful, and on-topic reply with only: APPROVED. If it needs improvement reply with: REVISE: <one sentence of guidance>.' }],
      messages: [{ role: 'user', content: [{ text: `Reply to review:\n${answer}` }] }],
      maxTokens: 80,
      temperature: 0.0,
    });
    const verdict = result.output?.message?.content?.map((p) => p.text || '').join('').trim() || '';
    if (verdict.startsWith('REVISE:')) {
      // Log the guidance for observability; do not block or alter the response.
      console.log(JSON.stringify({ steering: 'post-response', verdict }));
    }
  } catch { /* steering is best-effort; never block the response on its failure */ }
  return answer;
}

// ---------------------------------------------------------------------------
// MODULE 6: MULTI-AGENT
// The word specialist is a second independent Bedrock call with its own
// focused system prompt. It is invoked as a tool result and fed back into
// the main loop exactly like any other tool.
// ---------------------------------------------------------------------------
async function invokeWordSpecialist({ word, aspect = 'connotation' }, env) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return `Word specialist unavailable (credentials not configured). Proceeding without specialist input on "${word}".`;
  }
  const focusMap = {
    etymology:   'Explain the origin and historical evolution of the word.',
    connotation: 'Describe the emotional and cultural connotations of the word.',
    poetic_use:  'Explain how this word is used in poetry: rhythm, imagery, and mood.',
  };
  const focus = focusMap[aspect] || focusMap.connotation;
  try {
    const result = await bedrockConverse(env, {
      system: [{ text: `You are a word-craft specialist. ${focus} Be concise (3-5 sentences).` }],
      messages: [{ role: 'user', content: [{ text: `Analyse the word: ${word}` }] }],
      maxTokens: 200,
      temperature: 0.4,
    });
    return result.output?.message?.content?.map((p) => p.text || '').join('') || `No analysis available for "${word}".`;
  } catch (err) {
    return `Specialist call failed: ${err.message?.slice(0, 120)}`;
  }
}

// ---------------------------------------------------------------------------
// AGENT LOOP (Modules 1-6 combined)
//
// Step 1  Resolve skill -> inject into system prompt        (Module 3 Skills)
// Step 2  Build message list from stored history + new turn (Module 4 Session)
// Step 3  Call Bedrock with toolConfig                      (Module 1 Tools)
// Step 4  stopReason === 'tool_use':
//           a. Hook check (rate limit)                      (Module 2 Hooks)
//           b. Steering check (pre-tool validation)         (Module 3 Steering)
//           c. Dispatch tool or specialist agent            (Module 6 Multi-agent)
//           d. Append tool results, loop back to step 3
// Step 5  stopReason === 'end_turn':
//           Post-response steering check, return answer     (Module 3 Steering)
// ---------------------------------------------------------------------------
async function askBedrock(message, palette, history, env) {
  const tools = buildTools(palette);
  const toolConfig = { tools: tools.map((t) => ({ toolSpec: t.spec })) };

  // Step 1: Skills - inject relevant procedure into system prompt.
  const skill = await resolveSkill(message, env);
  const systemText = [
    'You are Forge, a warm and easygoing conversation partner. Use plain language, keep replies natural and concise, and ask a gentle follow-up when it would help.',
    `The user's word palette is: ${palette.length ? palette.join(', ') : '(empty)'}. Use palette words as inspiration when relevant, but never invent palette entries or present guesses as facts.`,
    skill ? `\n\nActive skill - follow these steps:\n${skill}` : '',
  ].filter(Boolean).join(' ');

  // Step 2: Session history - pass stored messages back to Bedrock.
  // Keep the last 20 turns to stay within context limits.
  const historyMessages = (history || [])
    .slice(-20)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: [{ text: m.content }] }));

  const runningMessages = [
    ...historyMessages,
    { role: 'user', content: [{ text: message }] },
  ];

  // Module 2: Hooks - fresh counter per request.
  const hooks = createHooks();

  // Module 3: Steering - track which tools have run this request.
  const toolLog = [];
  const steering = createSteering(toolLog);

  // Step 3+: Agent loop - iterate until end_turn or safety cap.
  const MAX_LOOP_ITERATIONS = 8;
  let iterations = 0;

  while (iterations < MAX_LOOP_ITERATIONS) {
    iterations += 1;

    const result = await bedrockConverse(env, {
      system: [{ text: systemText }],
      messages: runningMessages,
      toolConfig,
    });

    const assistantMessage = result.output?.message;
    const stopReason = result.stopReason;
    if (!assistantMessage) throw new Error('Bedrock returned no output message.');

    // Append the assistant turn to the running context.
    runningMessages.push(assistantMessage);

    if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
      const answer = assistantMessage.content?.map((b) => b.text || '').join('') || 'The model returned an empty response.';
      // Step 5: Post-response steering check.
      const finalAnswer = await steerPostResponse(answer, env);
      return { answer: finalAnswer, agent: true, toolCallCounts: hooks.getCounts() };
    }

    if (stopReason === 'tool_use') {
      const toolResultContents = [];

      for (const block of assistantMessage.content || []) {
        if (!block.toolUse) continue;
        const { toolUseId, name, input } = block.toolUse;
        let toolResult;

        // Step 4a: Hooks - rate limit check.
        const hookCancel = hooks.beforeToolCall(name);
        if (hookCancel) {
          toolResult = hookCancel;
        } else {
          // Step 4b: Steering - pre-tool validation.
          const steerGuide = steering.beforeTool(name);
          if (steerGuide) {
            toolResult = steerGuide;
          } else {
            toolLog.push(name);

            // Step 4c: Dispatch - multi-agent specialist or local tool fn.
            if (name === 'consult_word_specialist') {
              // Module 6: invoke the specialist agent (second Bedrock call).
              toolResult = await invokeWordSpecialist(input || {}, env);
            } else {
              const tool = tools.find((t) => t.spec.name === name);
              if (tool?.fn) {
                try { toolResult = await tool.fn(input || {}); }
                catch (err) { toolResult = `Tool error: ${err.message?.slice(0, 120)}`; }
              } else {
                toolResult = `Unknown tool: ${name}`;
              }
            }
          }
        }

        // Step 4d: Collect tool results to feed back into the loop.
        toolResultContents.push({
          toolResult: { toolUseId, content: [{ text: String(toolResult) }] },
        });
      }

      runningMessages.push({ role: 'user', content: toolResultContents });
    } else {
      // Unexpected stop reason - surface whatever text is available.
      const answer = assistantMessage.content?.map((b) => b.text || '').join('') || `Unexpected stop reason: ${stopReason}`;
      return { answer, agent: true };
    }
  }

  return { answer: 'The agent reached its iteration limit without completing the request.', agent: true };
}

async function serveAsset(request, env) {
  const url = new URL(request.url);
  const originalPathname = url.pathname;
  if (LEGACY_HTML_ASSETS[originalPathname] && !await allowLegacyAlias(request, env)) {
    return new Response('Too many legacy URL requests. Please try again in a minute.', { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': String(REDIRECT_RATE_PERIOD_SECONDS) } });
  }
  if (CANONICAL_HTML_ROUTES[originalPathname]) {
    return Response.redirect(`${url.origin}${CANONICAL_HTML_ROUTES[originalPathname]}${url.search}`, 301);
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
        if (requestWordCount(message) > MAX_REQUEST_WORDS) return json({ error: `Requests are limited to ${MAX_REQUEST_WORDS} words.` }, 413);
        if (hasOversizedWord(message)) return json({ error: `Each word is limited to ${MAX_WORD_CHARACTERS} characters.` }, 413);
        const state = await loadState(env.ASSETS, sessionId);
        if (env.MODEL_REQUESTS_ENABLED !== 'true' && !env.AGENTCORE_RUNTIME_ARN) return json({ error: 'Model requests are temporarily disabled.' }, 503);
        if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return json({ error: 'Bedrock credentials are not configured.' }, 503);
        const today = new Date().toISOString().slice(0, 10);
        if (state.rate.day !== today) state.rate = { day: today, count: 0 };
        if (state.rate.count >= DAILY_REQUEST_LIMIT) return new Response(JSON.stringify({ error: 'Daily request limit reached. Please try again tomorrow.', limit: DAILY_REQUEST_LIMIT }), { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, 'retry-after': String(86400 - Math.floor((Date.now() - new Date(`${today}T00:00:00Z`).getTime()) / 1000)) } });

        // Route to AgentCore if configured, otherwise run the local agent loop.
        const answer = env.AGENTCORE_RUNTIME_ARN
          ? await invokeAgentCore(message, state.palette, state.messages, env, request)
          : await askBedrock(message, state.palette, state.messages, env);

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
