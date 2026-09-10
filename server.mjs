import http from 'node:http';
import 'dotenv/config';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const region = process.env.AWS_REGION || 'ca-central-1';
const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-micro-v1:0';
const stateDir = join(root, '.data', 'sessions');
const stateTtlMs = 48 * 60 * 60 * 1000;
const dailyRequestLimit = 4;
const client = new BedrockRuntimeClient({ region });
const htmlRoutes = { '/': 'index.html', '/guide': 'guide.html', '/pinball': 'pinball.html', '/prompt': 'prompt.html', '/pricing': 'pricing.html' };
const legacyHtmlRoutes = { '/index.html': '/', '/guide.html': '/guide', '/pinball.html': '/pinball', '/prompt.html': '/prompt', '/pricing.html': '/pricing' };
let strands;
try { strands = await import('@strands-agents/sdk'); } catch { strands = null; }

const defaultPalette = ['anchor','pinnacle','summit','twilight','static','ocean','wander','spark','gravity','money','book','Glimmer','compass','voyage','solitude','prism','nectar','blossom','fossil','zenith','vortex','mirage','starlight','ember','cyclone','glacier','radiance','labyrinth','aurora','thistle','apple','Nebula','crisp','whisper','avalanche','horizon','velvet','mosaic','thunder','marble','cascade','echo','lantern','silver','standard','puzzle','orbit','shadow','flicker','autumn','rhythm','canvas'];
const emptyState = () => ({ palette: [...defaultPalette], promptWords: [], messages: [], printer: { note: '', images: [null, null, null] }, rate: { day: new Date().toISOString().slice(0, 10), count: 0 }, expiresAt: Date.now() + stateTtlMs });
function sessionIdFrom(req) { const match = (req.headers.cookie || '').match(/(?:^|;\s*)larboard_session=([^;]+)/); return match?.[1] || crypto.randomUUID(); }
function cleanState(value) { return { palette: Array.isArray(value?.palette) ? value.palette.filter((word) => typeof word === 'string').map((word) => word.trim()).filter(Boolean).slice(0, 52) : [...defaultPalette], promptWords: Array.isArray(value?.promptWords) ? value.promptWords.filter((word) => typeof word === 'string').slice(0, 52) : [], messages: Array.isArray(value?.messages) ? value.messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-100) : [], printer: { note: typeof value?.printer?.note === 'string' ? value.printer.note : '', images: Array.isArray(value?.printer?.images) ? value.printer.images.slice(0, 3).map((image) => image && typeof image.src === 'string' ? { src: image.src, uploadedAt: Number(image.uploadedAt) || Date.now() } : null) : [null, null, null] }, rate: { day: typeof value?.rate?.day === 'string' ? value.rate.day : new Date().toISOString().slice(0, 10), count: Number.isFinite(Number(value?.rate?.count)) ? Math.max(0, Number(value.rate.count)) : 0 }, expiresAt: Number(value?.expiresAt) || Date.now() + stateTtlMs }; }
async function loadState(sessionId) { try { const file = join(stateDir, `${sessionId}.json`); const raw = JSON.parse(await readFile(file, 'utf8')); if (!Number.isFinite(Number(raw.expiresAt)) || Number(raw.expiresAt) <= Date.now()) { await unlink(file).catch(() => {}); return emptyState(); } return cleanState(raw); } catch { return emptyState(); } }
async function saveState(sessionId, state) { await mkdir(stateDir, { recursive: true }); const clean = cleanState(state); await writeFile(join(stateDir, `${sessionId}.json`), JSON.stringify({ ...clean, expiresAt: Number(state.expiresAt) || clean.expiresAt }, null, 2)); }
async function purgeExpiredState() { try { const files = await readdir(stateDir); await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => { const path = join(stateDir, file); try { const state = JSON.parse(await readFile(path, 'utf8')); if (!Number.isFinite(Number(state.expiresAt)) || Number(state.expiresAt) <= Date.now()) await unlink(path); } catch {} })); } catch {} }
function sessionHeaders(sessionId) { return { 'Set-Cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; }

async function askWithBedrock(message, palette = []) {
  const paletteContext = palette.length ? ` The user’s current word palette is: ${palette.join(', ')}.` : ' The user’s word palette is empty.';
  const command = new ConverseCommand({ modelId, system: [{ text: `You are Forge. Use only the user’s word palette as source data. Do not use external facts, invent entries, or claim a word is in the palette unless it is listed.${paletteContext} If the user asks for a question using the palette, output exactly one natural-sounding, grammatically complete question and nothing else. Use one or more palette words naturally; function words needed for grammar are allowed. If the request cannot be answered from the palette, say so plainly.` }], messages: [{ role: 'user', content: [{ text: message }] }], inferenceConfig: { maxTokens: 700, temperature: 0.5 } });
  const response = await client.send(command);
  return response.output?.message?.content?.map((part) => part.text || '').join('') || 'The model returned an empty response.';
}

function createPaletteLookupTool(palette) {
  if (!strands?.tool) return null;
  return strands.tool({
    name: 'lookup_word_palette',
    description: 'Look up the user’s saved word palette. Use this when the user asks about their palette, saved words, or wants ideas grounded in those words.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A word or topic to find in the palette; use an empty string to list all words.' } }, required: ['query'] },
    callback: (input) => {
      const query = typeof input?.query === 'string' ? input.query.trim().toLowerCase() : '';
      const matches = palette.filter((word) => !query || word.toLowerCase().includes(query));
      return JSON.stringify({ query, matches, count: matches.length, source: 'user word palette' });
    },
  });
}

async function ask(message, palette = []) {
  if (strands?.Agent) {
    const paletteTool = createPaletteLookupTool(palette);
    const agent = new strands.Agent({
      systemPrompt: 'You are Forge. Use only the user’s word palette as source data. For every request that depends on saved words or the palette, call lookup_word_palette first and use only its returned data. Do not use external facts, invent entries, or claim a word is in the palette unless the tool returned it. If the user asks for a question using the palette, output exactly one natural-sounding, grammatically complete question and nothing else. Use one or more palette words naturally; function words needed for grammar are allowed. If the request cannot be answered from the palette, say so plainly.',
      ...(paletteTool ? { tools: [paletteTool] } : {}),
    });
    const result = await agent.invoke(message);
    return { answer: result.toString?.() || result.text || String(result), agent: true };
  }
  return { answer: await askWithBedrock(message, palette), agent: false };
}

function send(res, status, body, type = 'application/json') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); }
async function body(req) { let data = ''; for await (const chunk of req) data += chunk; return JSON.parse(data || '{}'); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, region, model: modelId });
    const sessionId = sessionIdFrom(req);
    if (req.method === 'GET' && req.url === '/api/state') { const state = await loadState(sessionId); res.writeHead(200, sessionHeaders(sessionId)); return res.end(JSON.stringify(state)); }
    if (req.method === 'POST' && req.url === '/api/state') { const payload = await body(req); const state = await loadState(sessionId); const next = cleanState({ ...state, ...payload }); await saveState(sessionId, next); res.writeHead(200, sessionHeaders(sessionId)); return res.end(JSON.stringify(next)); }
    if (req.method === 'POST' && req.url === '/api/ask') { const payload = await body(req); const message = typeof payload?.prompt === 'string' ? payload.prompt : payload?.message; if (typeof message !== 'string' || !message.trim()) return send(res, 400, { error: 'Prompt is required.' }); if (message.length > 4000) return send(res, 413, { error: 'Prompt is too long.' }); const state = await loadState(sessionId); const today = new Date().toISOString().slice(0, 10); if (state.rate.day !== today) state.rate = { day: today, count: 0 }; if (state.rate.count >= dailyRequestLimit) { res.writeHead(429, { ...sessionHeaders(sessionId), 'Retry-After': String(86400 - Math.floor((Date.now() - new Date(`${today}T00:00:00Z`).getTime()) / 1000)) }); return res.end(JSON.stringify({ error: 'Daily request limit reached. Please try again tomorrow.', limit: dailyRequestLimit })); } state.rate.count += 1; await saveState(sessionId, state); const answer = await ask(message.trim(), state.palette); state.messages = [...state.messages, { role: 'user', content: message.trim(), createdAt: new Date().toISOString() }, { role: 'assistant', content: answer.answer, createdAt: new Date().toISOString() }]; await saveState(sessionId, state); res.writeHead(200, sessionHeaders(sessionId)); return res.end(JSON.stringify(answer)); }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    const pathname = req.url.split('?')[0];
    const cleanPath = legacyHtmlRoutes[pathname];
    if (cleanPath) { res.writeHead(301, { Location: cleanPath }); return res.end(); }
    const requested = normalize(pathname).replace(/^[/\\]+/, '');
    const asset = htmlRoutes[pathname] || requested;
    if (requested.includes('..')) return send(res, 403, { error: 'Forbidden.' });
    const file = await readFile(join(root, asset)); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; send(res, 200, file, types[extname(asset)] || 'application/octet-stream');
  } catch (error) { console.error(error); send(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Runtime error. Check the server terminal.' }); }
});
server.listen(port, () => console.log(`Forge listening at http://localhost:${port}`));
setInterval(purgeExpiredState, 60 * 60 * 1000);
purgeExpiredState();
