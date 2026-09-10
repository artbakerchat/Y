import http from 'node:http';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const region = process.env.AWS_REGION || 'ca-central-1';
const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-micro-v1:0';
const client = new BedrockRuntimeClient({ region });
let strands;
try { strands = await import('@strands-agents/sdk'); } catch { strands = null; }

async function askWithBedrock(message) {
  const command = new ConverseCommand({ modelId, system: [{ text: 'You are Forge, a concise and practical product-building agent. Give useful next steps and be transparent when you are uncertain.' }], messages: [{ role: 'user', content: [{ text: message }] }], inferenceConfig: { maxTokens: 700, temperature: 0.5 } });
  const response = await client.send(command);
  return response.output?.message?.content?.map((part) => part.text || '').join('') || 'The model returned an empty response.';
}

async function ask(message) {
  if (strands?.Agent) {
    const agent = new strands.Agent({ systemPrompt: 'You are Forge, a concise and practical product-building agent.' });
    const result = await agent.invoke(message);
    return { answer: result.toString?.() || result.text || String(result), agent: true };
  }
  return { answer: await askWithBedrock(message), agent: false };
}

function send(res, status, body, type = 'application/json') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); }
async function body(req) { let data = ''; for await (const chunk of req) data += chunk; return JSON.parse(data || '{}'); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, region, model: modelId });
    if (req.method === 'POST' && req.url === '/api/ask') { const { message } = await body(req); if (typeof message !== 'string' || !message.trim()) return send(res, 400, { error: 'Message is required.' }); if (message.length > 4000) return send(res, 413, { error: 'Message is too long.' }); return send(res, 200, await ask(message.trim())); }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    const pathname = req.url.split('?')[0];
    const cleanPath = { '/index.html': '/', '/guide.html': '/guide', '/pinball.html': '/pinball', '/prompt.html': '/prompt', '/pricing.html': '/pricing' }[pathname];
    if (cleanPath) { res.writeHead(301, { Location: cleanPath }); return res.end(); }
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const requested = normalize(requestedPath).replace(/^[/\\]+/, '');
    const asset = extname(requested) ? requested : `${requested}.html`;
    if (requested.includes('..')) return send(res, 403, { error: 'Forbidden.' });
    const file = await readFile(join(root, asset)); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; send(res, 200, file, types[extname(asset)] || 'application/octet-stream');
  } catch (error) { console.error(error); send(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Runtime error. Check the server terminal.' }); }
});
server.listen(port, () => console.log(`Forge listening at http://localhost:${port}`));
