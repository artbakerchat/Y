import http from 'http';
import { readFile, mkdir, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import 'dotenv/config';
import { chat } from './api/chat.js';

const __dirname = import.meta.url.split('/').slice(0, -1).join('/').slice(7);
const port = Number(process.env.PORT || 3000);
const sessionsDir = join(__dirname, '.data', 'sessions');
const globalMessagesFile = join(__dirname, '.data', 'global-messages.json');
const sessionTtlMs = 48 * 60 * 60 * 1000;

await mkdir(sessionsDir, { recursive: true });

function getSessionId(req) {
  const match = (req.headers.cookie || '').match(/larboard_session=([^;]+)/);
  return /^[a-f0-9-]{36}$/.test(match?.[1] || '')
    ? match[1]
    : randomUUID();
}

async function loadSession(sessionId) {
  try {
    const file = join(sessionsDir, `${sessionId}.json`);
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.expiresAt && data.expiresAt <= Date.now()) {
      return { messages: [], expiresAt: Date.now() + sessionTtlMs };
    }
    return data;
  } catch {
    return { messages: [], expiresAt: Date.now() + sessionTtlMs };
  }
}

async function saveSession(sessionId, session) {
  const file = join(sessionsDir, `${sessionId}.json`);
  await writeFile(file, JSON.stringify(session, null, 2));
}

async function loadGlobalMessages() {
  try {
    const data = JSON.parse(await readFile(globalMessagesFile, 'utf8'));
    return data.messages || [];
  } catch {
    return [];
  }
}

async function saveGlobalMessages(messages) {
  await writeFile(globalMessagesFile, JSON.stringify({ messages }, null, 2));
}

async function addGlobalMessage(sessionId, content) {
  const messages = await loadGlobalMessages();
  messages.push({
    sessionId,
    content,
    timestamp: Date.now(),
  });
  await saveGlobalMessages(messages);
}

async function serveFile(filePath, res) {
  try {
    const content = await readFile(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

async function handleChatRequest(req, res, sessionId) {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { message, history } = JSON.parse(body);
      const session = await loadSession(sessionId);

      const result = await chat(message, session.messages);

      if (result.success) {
        session.messages.push({ role: 'user', content: message });
        session.messages.push({ role: 'assistant', content: result.content });
        session.expiresAt = Date.now() + sessionTtlMs;

        await saveSession(sessionId, session);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `larboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
        });
        res.end(JSON.stringify({ content: result.content }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
      }
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sessionId = getSessionId(req);

  if (req.url === '/' || req.url === '/index.html') {
    await serveFile(join(__dirname, 'site', 'dist', 'index.html'), res);
  } else if ((req.url.startsWith('/api/ask') || req.url.startsWith('/api/chat')) && req.method === 'POST') {
    await handleChatRequest(req, res, sessionId);
  } else if (req.url === '/api/messages' && req.method === 'GET') {
    const messages = await loadGlobalMessages();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
  } else if (req.url === '/api/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const { content } = JSON.parse(body);
        await addGlobalMessage(sessionId, content);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  } else if (req.url.startsWith('/')) {
    const filePath = join(__dirname, 'site', 'dist', req.url.slice(1));
    try {
      const content = await readFile(filePath);
      const contentType = req.url.endsWith('.js') ? 'application/javascript'
        : req.url.endsWith('.css') ? 'text/css'
        : req.url.endsWith('.json') ? 'application/json'
        : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Bee Chat server running at http://localhost:${port}`);
});
