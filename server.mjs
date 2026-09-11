import http from 'node:http';
import 'dotenv/config';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPaletteTemplate, detectPaletteContext } from './src/palettes.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const region = process.env.AWS_REGION || 'ca-central-1';
const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-micro-v1:0';
const stateDir = join(root, '.data', 'sessions');
const stateTtlMs = 48 * 60 * 60 * 1000;
const dailyRequestLimit = 8;
const maxRequestWords = 52;
const maxWordCharacters = 16;
const redirectRateLimit = 20;
const redirectRateWindowMs = 60 * 1000;
const redirectRateBuckets = new Map();
const client = new BedrockRuntimeClient({ region });
const htmlRoutes = { '/': 'index.html', '/pinball': 'pinball.html', '/prompt': 'prompt.html', '/pricing': 'pricing.html', '/printer': 'printer.html' };
const legacyHtmlAssets = { '/index.html': 'index.html', '/pinball.html': 'pinball.html', '/prompt.html': 'prompt.html', '/pricing.html': 'pricing.html', '/printer.html': 'printer.html' };
const canonicalHtmlRoutes = { '/index.html': '/', '/pinball.html': '/pinball', '/prompt.html': '/prompt', '/pricing.html': '/pricing', '/printer.html': '/printer' };
let strands;
try { strands = await import('@strands-agents/sdk'); } catch { strands = null; }

const defaultPalette = ['anchor','pinnacle','summit','twilight','static','ocean','wander','spark','gravity','money','book','Glimmer','compass','voyage','solitude','prism','nectar','blossom','fossil','zenith','vortex','mirage','starlight','ember','cyclone','glacier','radiance','labyrinth','aurora','thistle','apple','Nebula','crisp','whisper','avalanche','horizon','velvet','mosaic','thunder','marble','cascade','echo','lantern','silver','standard','puzzle','orbit','shadow','flicker','autumn','rhythm','canvas'];
const emptyState = (paletteId = 'default', paletteStory = '') => {
  const template = getPaletteTemplate(paletteId);
  return {
    paletteId,
    paletteStory: paletteStory || template.story,
    palette: template.words.slice(0, 52),
    promptWords: [],
    messages: [],
    pendingPrompt: '',
    printer: { note: '', images: [null, null, null] },
    rate: { day: new Date().toISOString().slice(0, 10), count: 0 },
    expiresAt: Date.now() + stateTtlMs,
  };
};
function sessionIdFrom(req) { const match = (req.headers.cookie || '').match(/(?:^|;\s*)larboard_session=([^;]+)/); return match?.[1] || crypto.randomUUID(); }
function cleanState(value) { return { paletteId: typeof value?.paletteId === 'string' ? value.paletteId : 'default', paletteStory: typeof value?.paletteStory === 'string' ? value.paletteStory : getPaletteTemplate(value?.paletteId || 'default').story, palette: Array.isArray(value?.palette) ? value.palette.filter((word) => typeof word === 'string').map((word) => word.trim()).filter(Boolean).slice(0, 52) : getPaletteTemplate(value?.paletteId || 'default').words.slice(0, 52), promptWords: Array.isArray(value?.promptWords) ? value.promptWords.filter((word) => typeof word === 'string').slice(0, 52) : [], messages: Array.isArray(value?.messages) ? value.messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-100) : [], pendingPrompt: typeof value?.pendingPrompt === 'string' ? value.pendingPrompt.slice(0, 4000) : '', printer: { note: typeof value?.printer?.note === 'string' ? value.printer.note : '', images: Array.isArray(value?.printer?.images) ? value.printer.images.slice(0, 3).map((image) => image && typeof image.src === 'string' ? { src: image.src, uploadedAt: Number(image.uploadedAt) || Date.now() } : null) : [null, null, null] }, rate: { day: typeof value?.rate?.day === 'string' ? value.rate.day : new Date().toISOString().slice(0, 10), count: Number.isFinite(Number(value?.rate?.count)) ? Math.max(0, Number(value.rate.count)) : 0 }, expiresAt: Number(value?.expiresAt) || Date.now() + stateTtlMs }; }
async function loadState(sessionId, detectionHints = {}) { try { const file = join(stateDir, `${sessionId}.json`); const raw = JSON.parse(await readFile(file, 'utf8')); if (!Number.isFinite(Number(raw.expiresAt)) || Number(raw.expiresAt) <= Date.now()) { await unlink(file).catch(() => {}); const paletteId = detectPaletteContext(detectionHints.message || '', detectionHints.params || {}); const template = getPaletteTemplate(paletteId); return emptyState(paletteId, template.story); } return cleanState(raw); } catch { const paletteId = detectPaletteContext(detectionHints.message || '', detectionHints.params || {}); const template = getPaletteTemplate(paletteId); return emptyState(paletteId, template.story); } }
async function saveState(sessionId, state) { await mkdir(stateDir, { recursive: true }); const clean = cleanState(state); await writeFile(join(stateDir, `${sessionId}.json`), JSON.stringify({ ...clean, expiresAt: Number(state.expiresAt) || clean.expiresAt }, null, 2)); }
async function purgeExpiredState() { try { const files = await readdir(stateDir); await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => { const path = join(stateDir, file); try { const state = JSON.parse(await readFile(path, 'utf8')); if (!Number.isFinite(Number(state.expiresAt)) || Number(state.expiresAt) <= Date.now()) await unlink(path); } catch {} })); } catch {} }
function sessionHeaders(sessionId) { return { 'Set-Cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; }

async function askWithBedrock(message, palette = []) {
  const paletteContext = palette.length ? ` The user’s current word palette is: ${palette.join(', ')}.` : ' The user’s word palette is empty.';
  const command = new ConverseCommand({ modelId, system: [{ text: `You are Forge, a warm and easygoing conversation partner. Talk to the user like a thoughtful, helpful person. Use plain language, keep replies natural and concise, and ask a gentle follow-up when it would help. Use the user’s word palette as inspiration when relevant:${paletteContext} Never invent palette entries or present guesses as facts.` }], messages: [{ role: 'user', content: [{ text: message }] }], inferenceConfig: { maxTokens: 700, temperature: 0.5 } });
  const response = await client.send(command);
  return response.output?.message?.content?.map((part) => part.text || '').join('') || 'The model returned an empty response.';
}

async function ask(message, palette = [], pendingPrompt = '', requestsRemaining = dailyRequestLimit) {
  const specialistInstruction = `Answer as a focused word specialist: stay on the user's topic and help with meaning, nuance, connotation, etymology, tone, or precise/poetic word choice. Avoid generic life coaching or broad brainstorming. Ask at most one concise follow-up question when needed. This session allows at most ${dailyRequestLimit} model requests per day; stay useful within the current turn.\n\n`;
  message = specialistInstruction + message;
  if (pendingPrompt) {
    message = `Original request: ${pendingPrompt}\n\nUser clarification: ${message}`;
  }
  if (strands?.Agent) {
    const agent = new strands.Agent({
      systemPrompt: `You are Forge, a warm and easygoing conversation partner. Talk to the user like a thoughtful, helpful person. Use plain language, keep replies natural and concise, and ask a gentle follow-up when it would help. The user’s current word palette is: ${palette.length ? palette.join(', ') : '(empty)'}. Use palette words as inspiration when relevant, but never invent palette entries or present guesses as facts.`,
    });
    let result;
    try { result = await agent.invoke(message); } catch (error) { throw error; }
    return { answer: result.toString?.() || result.text || String(result), agent: true };
  }
  return { answer: await askWithBedrock(message, palette), agent: false };
}

function send(res, status, body, type = 'application/json') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); }
function allowLegacyAlias(req) {
  const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
  const key = clientIp;
  const now = Date.now();
  const bucket = redirectRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= redirectRateWindowMs) {
    redirectRateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= redirectRateLimit) return false;
  bucket.count += 1;
  return true;
}
async function body(req) { let data = ''; for await (const chunk of req) data += chunk; return JSON.parse(data || '{}'); }
function requestWordCount(message) { return message.trim() ? message.trim().split(/\s+/).length : 0; }
function hasOversizedWord(message) { return message.trim().split(/\s+/).some((word) => word.length > maxWordCharacters); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, region, model: modelId });
    const sessionId = sessionIdFrom(req);
    const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const detectionHints = { params: Object.fromEntries(urlParams) };
    if (req.method === 'GET' && req.url.startsWith('/api/state')) { const state = await loadState(sessionId, detectionHints); res.writeHead(200, sessionHeaders(sessionId)); return res.end(JSON.stringify(state)); }
    if (req.method === 'POST' && req.url === '/api/state') { const payload = await body(req); const state = await loadState(sessionId, detectionHints); const next = cleanState({ ...state, ...payload }); await saveState(sessionId, next); res.writeHead(200, sessionHeaders(sessionId)); return res.end(JSON.stringify(next)); }
    if (req.method === 'POST' && req.url === '/api/ask') { const payload = await body(req); const message = typeof payload?.prompt === 'string' ? payload.prompt : payload?.message; if (typeof message !== 'string' || !message.trim()) return send(res, 400, { error: 'Prompt is required.' }); if (message.length > 4000) return send(res, 413, { error: 'Prompt is too long.' }); if (requestWordCount(message) > maxRequestWords) return send(res, 413, { error: `Requests are limited to ${maxRequestWords} words.` }); if (hasOversizedWord(message)) return send(res, 413, { error: `Each word is limited to ${maxWordCharacters} characters.` }); detectionHints.message = message; const state = await loadState(sessionId, detectionHints); const today = new Date().toISOString().slice(0, 10); if (state.rate.day !== today) state.rate = { day: today, count: 0 }; if (state.rate.count >= dailyRequestLimit) { res.writeHead(429, { ...sessionHeaders(sessionId), 'Retry-After': String(86400 - Math.floor((Date.now() - new Date(`${today}T00:00:00Z`).getTime()) / 1000)) }); return res.end(JSON.stringify({ error: 'Daily request limit reached. Please try again tomorrow.', limit: dailyRequestLimit })); } const prompt = message.trim(); const pendingPrompt = state.pendingPrompt; const answer = await ask(prompt, state.palette, pendingPrompt); if (answer.clarification) state.pendingPrompt = prompt; else state.pendingPrompt = ''; state.rate.count += 1; state.messages = [...state.messages, { role: 'user', content: prompt, createdAt: new Date().toISOString() }, { role: 'assistant', content: answer.answer, createdAt: new Date().toISOString() }]; await saveState(sessionId, state); res.writeHead(200, sessionHeaders(sessionId)); return res.end(JSON.stringify(answer)); }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    const pathname = req.url.split('?')[0];
    if (legacyHtmlAssets[pathname] && !allowLegacyAlias(req)) { res.writeHead(429, { 'Cache-Control': 'no-store', 'Retry-After': '60' }); return res.end('Too many legacy URL requests. Please try again in a minute.'); }
    if (canonicalHtmlRoutes[pathname]) { res.writeHead(301, { Location: `${canonicalHtmlRoutes[pathname]}${req.url.slice(pathname.length)}`, 'Cache-Control': 'public, max-age=86400' }); return res.end(); }
    const requested = normalize(pathname).replace(/^[/\\]+/, '');
    const asset = htmlRoutes[pathname] || legacyHtmlAssets[pathname] || requested;
    if (requested.includes('..')) return send(res, 403, { error: 'Forbidden.' });
    const file = await readFile(join(root, asset)); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; send(res, 200, file, types[extname(asset)] || 'application/octet-stream');
  } catch (error) { console.error(error); send(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Runtime error. Check the server terminal.' }); }
});
server.listen(port, () => console.log(`Forge listening at http://localhost:${port}`));
setInterval(purgeExpiredState, 60 * 60 * 1000);
purgeExpiredState();
