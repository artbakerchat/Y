import { createToolController } from './tool-controls.js';
import { buildTools as buildEditableTools } from '../tools/index.js';
import { specialistTools } from '../tools/word-specialist-tool.js';
import { getAgentProfile, inferAgentId, listAgentProfiles } from './agents.js';
import { getPaletteTemplate, detectPaletteContext } from './palettes.js';
import { CONVERSATION_GUIDANCE } from './conversation-guidance.js';
import { DEFAULT_APPLE_CONVERSATION } from './default-conversation.js';

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
  '/presentation': 'presentation.html',
};

const LEGACY_HTML_ASSETS = {
  '/index.html': 'index.html',
  '/pinball.html': 'pinball.html',
  '/prompt.html': 'prompt.html',
  '/pricing.html': 'pricing.html',
  '/printer.html': 'printer.html',
  '/presentation.html': 'presentation.html',
};

const CANONICAL_HTML_ROUTES = {
  '/index.html': '/',
  '/pinball.html': '/pinball',
  '/prompt.html': '/prompt',
  '/pricing.html': '/pricing',
  '/printer.html': '/printer',
  '/presentation.html': '/presentation',
};

const encoder = new TextEncoder();
const STATE_TTL_MS = 48 * 60 * 60 * 1000;
const DAILY_REQUEST_LIMIT = 8;
const MAX_REQUEST_WORDS = 52;
const MAX_WORD_CHARACTERS = 16;
const REDIRECT_RATE_PERIOD_SECONDS = 60;

// Entry points and legacy assets keep stable URLs, so browsers must check for
// a new deployment on every visit. Vite-generated files include a content hash
// and can remain cached for a long time without serving an old app shell.
const FINGERPRINTED_ASSET = /-[a-z0-9_-]{8,}(?=\.[a-z0-9]+$)/i;

// ---------------------------------------------------------------------------
// State schema versioning
//
// Bump STATE_SCHEMA_VERSION whenever a field is added, renamed, or removed.
// cleanState() must handle missing/unknown fields from older versions so that
// sessions stored before a deployment continue to work without a hard reset.
//
// Migration guide
// ---------------
// v1  (current)  Initial versioned schema.  Added schemaVersion field.
//               All sessions written before this version are treated as v0
//               and normalised by cleanState() as usual — no data loss.
//
// When bumping to v2 in the future:
//   1. Increment STATE_SCHEMA_VERSION.
//   2. Add a migration block inside cleanState() guarded by:
//        if (!value.schemaVersion || value.schemaVersion < 2) { … }
//   3. Document the change above.
// ---------------------------------------------------------------------------
const STATE_SCHEMA_VERSION = 1;

const DEFAULT_PALETTE = ['anchor','pinnacle','summit','twilight','static','ocean','wander','spark','gravity','money','book','Glimmer','compass','voyage','solitude','prism','nectar','blossom','fossil','zenith','vortex','mirage','starlight','ember','cyclone','glacier','radiance','labyrinth','aurora','thistle','apple','Nebula','crisp','whisper','avalanche','horizon','velvet','mosaic','thunder','marble','cascade','echo','lantern','silver','standard','puzzle','orbit','shadow','flicker','autumn','rhythm','canvas'];
const emptyState = (paletteId = 'default', paletteStory = '') => {
  const template = getPaletteTemplate(paletteId);
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    agentId: 'forge',
    paletteId,
    paletteStory: paletteStory || template.story,
    palette: template.words.slice(0, 52),
    promptWords: [],
    messages: DEFAULT_APPLE_CONVERSATION,
    pendingPrompt: '',
    printer: { note: '', images: [null, null, null] },
    rate: { day: new Date().toISOString().slice(0, 10), count: 0 },
    expiresAt: Date.now() + STATE_TTL_MS,
  };
};
function cleanState(value) { return { schemaVersion: STATE_SCHEMA_VERSION, agentId: typeof value?.agentId === 'string' ? value.agentId : 'forge', paletteId: typeof value?.paletteId === 'string' ? value.paletteId : 'default', paletteStory: typeof value?.paletteStory === 'string' ? value.paletteStory : getPaletteTemplate(value?.paletteId || 'default').story, palette: Array.isArray(value?.palette) ? value.palette.filter((word) => typeof word === 'string').map((word) => word.trim()).filter((word) => word && word.length <= MAX_WORD_CHARACTERS).slice(0, 52) : getPaletteTemplate(value?.paletteId || 'default').words.slice(0, 52), promptWords: Array.isArray(value?.promptWords) ? value.promptWords.filter((word) => typeof word === 'string' && word.length <= MAX_WORD_CHARACTERS).slice(0, 52) : [], messages: Array.isArray(value?.messages) ? value.messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-100) : [], pendingPrompt: typeof value?.pendingPrompt === 'string' ? value.pendingPrompt.slice(0, 4000) : '', printer: { note: typeof value?.printer?.note === 'string' ? value.printer.note : '', images: Array.isArray(value?.printer?.images) ? value.printer.images.slice(0, 3).map((image) => image && typeof image.src === 'string' ? { src: image.src, uploadedAt: Number(image.uploadedAt) || Date.now() } : null) : [null, null, null] }, rate: { day: typeof value?.rate?.day === 'string' ? value.rate.day : new Date().toISOString().slice(0, 10), count: Number.isFinite(Number(value?.rate?.count)) ? Math.max(0, Number(value.rate.count)) : 0 }, expiresAt: Number(value?.expiresAt) || Date.now() + STATE_TTL_MS }; }
function sessionIdFrom(request) { const match = request.headers.get('cookie')?.match(/(?:^|;\s*)larboard_session=([^;]+)/); return match?.[1] || crypto.randomUUID(); }
async function loadState(bucket, sessionId, detectionHints = {}) { const key = `sessions/${sessionId}.json`; const object = await bucket.get(key); if (!object) { const paletteId = detectPaletteContext(detectionHints.message || '', detectionHints.params || {}); const template = getPaletteTemplate(paletteId); return emptyState(paletteId, template.story); } try { const raw = await object.json(); if (!Number.isFinite(Number(raw.expiresAt)) || Number(raw.expiresAt) <= Date.now()) { await bucket.delete(key); const paletteId = detectPaletteContext(detectionHints.message || '', detectionHints.params || {}); const template = getPaletteTemplate(paletteId); return emptyState(paletteId, template.story); } return cleanState(raw); } catch { const paletteId = detectPaletteContext(detectionHints.message || '', detectionHints.params || {}); const template = getPaletteTemplate(paletteId); return emptyState(paletteId, template.story); } }
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

function cleanAssistantResponse(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const cleaned = text
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<analysis[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .trim();
  return cleaned || 'I’m here with you. What would you like to work through?';
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requestWordCount(message) {
  return message.trim() ? message.trim().split(/\s+/).length : 0;
}

function limitOutputWords(value) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  const words = text ? text.split(/\s+/) : [];
  return words.length > MAX_REQUEST_WORDS ? `${words.slice(0, MAX_REQUEST_WORDS).join(' ')}…` : text;
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

async function invokeAgentCore(message, palette, history, env, request, requestsRemaining, agentId = 'forge') {
  const region = env.AWS_REGION || 'ca-central-1';
  const runtimeArn = env.AGENTCORE_RUNTIME_ARN;
  const host = env.AGENTCORE_RUNTIME_HOST || `bedrock-agentcore.${region}.amazonaws.com`;
  const encodedArn = encodeURIComponent(runtimeArn);
  const path = `/runtimes/${encodedArn}/invocations`;
  const query = 'qualifier=DEFAULT';
  const body = JSON.stringify({ prompt: message, palette, requests_remaining: requestsRemaining, agent_id: agentId });
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
  return { answer: cleanAssistantResponse(typeof answer === 'string' ? answer : JSON.stringify(answer)), agent: true, runtime: 'agentcore' };
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
function legacyBuildTools(palette) {
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
// Markdown procedures are discovered from R2 under skills/<name>.md.
// Inline skills are retained for local development when R2 is unavailable.
// ---------------------------------------------------------------------------
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

const INLINE_SKILL_METADATA = {
  'palette-building': ['add', 'suggest', 'grow', 'expand', 'palette', 'word', 'theme'],
  'word-exploration': ['meaning', 'connotation', 'origin', 'etymology', 'explore', 'understand'],
  'conversation-style': ['tone', 'style', 'voice', 'rewrite', 'formal', 'casual', 'poetic'],
};

let remoteSkillCatalog;

function parseSkillDocument(key, source) {
  const fallbackName = key.split('/').pop().replace(/\.md$/i, '');
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const metadata = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const separator = line.indexOf(':');
      if (separator < 1) continue;
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (value.startsWith('[') && value.endsWith(']')) metadata[name] = value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
      else if (value) metadata[name] = value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return {
    name: metadata.name?.[0] || fallbackName,
    description: metadata.description?.join(', ') || '',
    keywords: metadata.keywords || INLINE_SKILL_METADATA[fallbackName] || [],
    agents: metadata.agents || '*',
    text: match ? source.slice(match[0].length).trim() : source.trim(),
  };
}

async function loadSkillCatalog(env) {
  if (!env.ASSETS) {
    return Object.entries(INLINE_SKILLS).map(([name, text]) => ({
      name,
      keywords: INLINE_SKILL_METADATA[name] || [],
      agents: '*',
      text,
    }));
  }
  if (!remoteSkillCatalog) {
    remoteSkillCatalog = (async () => {
      try {
        const listed = await env.ASSETS.list({ prefix: 'skills/' });
        const skills = await Promise.all(listed.objects
          .filter((object) => object.key.endsWith('.md'))
          .map(async (object) => {
            const source = await (await env.ASSETS.get(object.key))?.text();
            return source ? parseSkillDocument(object.key, source) : null;
          }));
        return skills.filter(Boolean);
      } catch {
        return [];
      }
    })();
  }
  const skills = await remoteSkillCatalog;
  return skills.length ? skills : Object.entries(INLINE_SKILLS).map(([name, text]) => ({
    name,
    keywords: INLINE_SKILL_METADATA[name] || [],
    agents: '*',
    text,
  }));
}

async function resolveSkill(message, env, profile) {
  const lower = message.toLowerCase();
  const skills = await loadSkillCatalog(env);
  for (const skill of skills) {
    const allowed = profile.skillNames === '*' || profile.skillNames.includes(skill.name);
    const assigned = skill.agents === '*' || skill.agents.includes('*') || skill.agents.includes(profile.id);
    if (allowed && assigned && skill.keywords.some((kw) => lower.includes(kw))) {
      return skill.text;
    }
  }
  return null;
}

async function steerPostResponse(answer, env) {
  // Skip when credentials are absent (local dev / preview mode).
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return answer;
  try {
    // First call: quality review.
    const reviewResult = await bedrockConverse(env, {
      system: [{ text: 'You are a quality reviewer for a conversational AI. Evaluate the reply. If it is clear, helpful, and on-topic reply with only: APPROVED. If it needs improvement reply with: REVISE: <one sentence of guidance>.' }],
      messages: [{ role: 'user', content: [{ text: `Reply to review:\n${answer}` }] }],
      maxTokens: 80,
      temperature: 0.0,
    });
    const verdict = reviewResult.output?.message?.content?.map((p) => p.text || '').join('').trim() || '';

    if (verdict.startsWith('REVISE:')) {
      const guidance = verdict.slice('REVISE:'.length).trim();
      console.log(JSON.stringify({ steering: 'post-response', verdict }));

      // Second call: revise the answer using the guidance.
      const reviseResult = await bedrockConverse(env, {
        system: [{ text: 'You are a helpful conversational AI. Rewrite the reply below, applying the improvement guidance. Keep the same subject matter and do not add new facts. Return only the improved reply, no preamble.' }],
        messages: [{
          role: 'user',
          content: [{ text: `Original reply:\n${answer}\n\nImprovement guidance: ${guidance}` }],
        }],
        maxTokens: 700,
        temperature: 0.4,
      });
      const revised = reviseResult.output?.message?.content?.map((p) => p.text || '').join('').trim();
      if (revised) return revised;
    }
  } catch { /* steering is best-effort; never block the response on its failure */ }
  return answer;
}

// ---------------------------------------------------------------------------
// MODULE 6: MULTI-AGENT
// The word specialist runs as a mini agent loop with its own tools and
// focused system prompt. It mirrors the module's agents-as-tools pattern:
// a sub-agent with narrow capabilities (look_up_word_details,
// find_related_words_deep) that the orchestrator calls like a function.
// The result is fed back into the main loop as a tool result.
// ---------------------------------------------------------------------------
async function invokeWordSpecialist({ word, aspect = 'connotation' }, env) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return `Word specialist unavailable (credentials not configured). Proceeding without specialist input on "${word}".`;
  }

  const focusMap = {
    etymology:   'Focus on the word\'s origin, historical evolution, and linguistic roots.',
    connotation: 'Focus on the emotional, cultural, and contextual connotations of the word.',
    poetic_use:  'Focus on how this word is used in poetry: its rhythm, imagery, and mood.',
  };
  const focus = focusMap[aspect] || focusMap.connotation;

  // Build toolConfig from the specialist's own tools (not the orchestrator's).
  const specialistToolConfig = {
    tools: specialistTools.map((t) => ({ toolSpec: t.spec })),
  };

  const specialistSystem = [
    { text: `You are a word-craft specialist with access to etymology and vocabulary tools. ${focus} Use your tools to look up concrete data before responding. Be concise (3–6 sentences). Return only the analysis, no preamble.` },
  ];

  const runningMessages = [
    { role: 'user', content: [{ text: `Analyse the word: ${word}` }] },
  ];

  const MAX_SPECIALIST_ITERATIONS = 4;
  let iterations = 0;

  try {
    while (iterations < MAX_SPECIALIST_ITERATIONS) {
      iterations += 1;

      const result = await bedrockConverse(env, {
        system: specialistSystem,
        messages: runningMessages,
        toolConfig: specialistToolConfig,
        maxTokens: 300,
        temperature: 0.4,
      });

      const assistantMessage = result.output?.message;
      const stopReason = result.stopReason;
      if (!assistantMessage) break;

      runningMessages.push(assistantMessage);

      if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
        return assistantMessage.content?.map((b) => b.text || '').join('') || `No analysis available for "${word}".`;
      }

      if (stopReason === 'tool_use') {
        const toolResultContents = [];

        for (const block of assistantMessage.content || []) {
          if (!block.toolUse) continue;
          const { toolUseId, name, input } = block.toolUse;
          const tool = specialistTools.find((t) => t.spec.name === name);
          let toolResult;
          if (tool?.fn) {
            try { toolResult = await tool.fn(input || {}); }
            catch (err) { toolResult = `Tool error: ${err.message?.slice(0, 120)}`; }
          } else {
            toolResult = `Unknown specialist tool: ${name}`;
          }
          toolResultContents.push({
            toolResult: { toolUseId, content: [{ text: String(toolResult) }] },
          });
        }

        runningMessages.push({ role: 'user', content: toolResultContents });
      } else {
        // Unexpected stop — return whatever text is available.
        return assistantMessage.content?.map((b) => b.text || '').join('') || `No analysis available for "${word}".`;
      }
    }
  } catch (err) {
    return `Specialist call failed: ${err.message?.slice(0, 120)}`;
  }

  return `Specialist reached iteration limit without completing analysis of "${word}".`;
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
async function askBedrock(message, palette, history, env, requestsRemaining, profile) {
  const availableTools = buildEditableTools(palette, profile.id);
  const tools = availableTools.filter((tool) => profile.toolNames.includes(tool.spec.name));
  const toolConfig = { tools: tools.map((t) => ({ toolSpec: t.spec })) };

  // Step 1: Skills - inject relevant procedure into system prompt.
  const skill = await resolveSkill(message, env, profile);
  const systemText = [
    CONVERSATION_GUIDANCE,
    `You are ${profile.name}. ${profile.systemPrompt}`,
    `This session has a daily limit of ${profile.dailyRequestLimit} model requests. ${requestsRemaining} requests remain after this turn. Be useful within the current turn and never imply that more requests are available than this limit.`,
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

  // Modules 2 + 3: per-invocation limits and successful-call workflow checks.
  // The specialist uses the same error boundary and ledger as local tools.
  const controlledTools = tools.map((tool) => profile.specialist && tool.spec.name === profile.specialist.spec.name
    ? { ...tool, fn: (input) => invokeWordSpecialist(input, env) }
    : tool);
  const controller = createToolController({
    tools: controlledTools,
    maxCallsPerTool: profile.maxToolCallsPerRequest,
  });

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
      return { answer: cleanAssistantResponse(finalAnswer), agent: true, toolCallCounts: controller.getCounts() };
    }

    if (stopReason === 'tool_use') {
      const toolResultContents = [];

      for (const block of assistantMessage.content || []) {
        if (!block.toolUse) continue;
        toolResultContents.push(await controller.execute(block.toolUse));
      }

      runningMessages.push({ role: 'user', content: toolResultContents });
    } else {
      // Unexpected stop reason - surface whatever text is available.
      const answer = assistantMessage.content?.map((b) => b.text || '').join('') || `Unexpected stop reason: ${stopReason}`;
      return { answer: cleanAssistantResponse(answer), agent: true };
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
    return new Response(null, { status: 301, headers: {
      location: `${url.origin}${CANONICAL_HTML_ROUTES[originalPathname]}${url.search}`,
      'cache-control': 'no-store, no-cache, must-revalidate',
    } });
  }
  const key = HTML_ROUTES[originalPathname] || LEGACY_HTML_ASSETS[originalPathname] || originalPathname.slice(1);
  if (!key || !/^\/[a-zA-Z0-9._/-]+$/.test(`/${key}`) || key.includes('..')) return new Response('Not found.', { status: 404 });
  const object = await env.ASSETS.get(key);
  if (!object) return new Response('Not found.', { status: 404 });
  const isHtml = key.endsWith('.html');
  const isFingerprinted = FINGERPRINTED_ASSET.test(key);
  const headers = new Headers({
    'cache-control': isHtml || !isFingerprinted
      ? 'no-store, no-cache, must-revalidate, proxy-revalidate'
      : 'public, max-age=31536000, immutable',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  });
  if (isHtml || !isFingerprinted) {
    headers.set('pragma', 'no-cache');
    headers.set('expires', '0');
  }
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
        return json({ ok: true, region: env.AWS_REGION || 'ca-central-1', model: env.BEDROCK_MODEL_ID || 'ca.amazon.nova-lite-v1:0', agents: listAgentProfiles() });
      }
      if (url.pathname === '/api/agents' && request.method === 'GET') return json(listAgentProfiles());
      const sessionId = sessionIdFrom(request);
      if (url.pathname === '/api/state' && request.method === 'GET') return stateResponse(await loadState(env.ASSETS, sessionId), sessionId);
      if (url.pathname === '/api/state' && request.method === 'POST') { const current = await loadState(env.ASSETS, sessionId); const next = cleanState({ ...current, ...(await request.json()) }); await saveState(env.ASSETS, sessionId, next); return stateResponse(next, sessionId); }
      if (url.pathname === '/api/ask' && request.method === 'POST') {
        const body = await request.json();
        const explicitAgentId = body?.agent || request.headers.get('x-agent-id');
        const message = typeof body?.prompt === 'string' ? body.prompt.trim() : typeof body?.message === 'string' ? body.message.trim() : '';
        if (!message) return json({ error: 'Message is required.' }, 400);
        if (message.length > 4000) return json({ error: 'Message is too long.' }, 413);
        if (requestWordCount(message) > MAX_REQUEST_WORDS) return json({ error: `Requests are limited to ${MAX_REQUEST_WORDS} words.` }, 413);
        if (hasOversizedWord(message)) return json({ error: `Each word is limited to ${MAX_WORD_CHARACTERS} characters.` }, 413);
        const state = await loadState(env.ASSETS, sessionId);
        const agentId = explicitAgentId || inferAgentId(message, state.agentId);
        const profile = getAgentProfile(agentId);
        if (!profile) return json({ error: 'Unknown agent.' }, 400);
        if (state.agentId !== profile.id) {
          state.agentId = profile.id;
          state.messages = [];
          state.pendingPrompt = '';
        }
        if (env.MODEL_REQUESTS_ENABLED !== 'true' && !env.AGENTCORE_RUNTIME_ARN) return json({ error: 'Model requests are temporarily disabled.' }, 503);
        if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return json({ error: 'Bedrock credentials are not configured.' }, 503);
        const today = new Date().toISOString().slice(0, 10);
        if (state.rate.day !== today) state.rate = { day: today, count: 0 };
        if (state.rate.count >= profile.dailyRequestLimit) return new Response(JSON.stringify({ error: 'Daily request limit reached. Please try again tomorrow.', limit: profile.dailyRequestLimit }), { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, 'retry-after': String(86400 - Math.floor((Date.now() - new Date(`${today}T00:00:00Z`).getTime()) / 1000)) } });

        // Route to AgentCore if configured, otherwise run the local agent loop.
        const answer = env.AGENTCORE_RUNTIME_ARN
          ? await invokeAgentCore(message, state.palette, state.messages, env, request, profile.dailyRequestLimit - state.rate.count - 1, profile.id)
          : await askBedrock(message, state.palette, state.messages, env, profile.dailyRequestLimit - state.rate.count - 1, profile);
        answer.answer = limitOutputWords(answer.answer);
        answer.agentId = profile.id;

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
