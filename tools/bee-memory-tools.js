// ---------------------------------------------------------------------------
// BEE MEMORY TOOLS (beeplex-backed)
//
// Thin Node wrappers around the vendored beeplex CLI (Y/beeplex/). Each tool
// spawns `python3 -m beeplex <command> --json` and returns the parsed JSON
// payload. Same subprocess pattern as api/music.js.
//
// NODE ONLY: these tools spawn subprocesses, so they are registered only on
// the Node.js server (see tools/index.js). The module itself is safe to
// import in the Cloudflare Worker — all Node-only work is lazy — but the
// tools are never added to the Worker's tool allow-list.
//
// Environment:
//   BEEPLEX_DATA_DIR  Folder for reports, diary and profile.
//                     Defaults to <Y>/beeplex-data (created on first use).
//   BEEPLEX_DEMO=1    Use sample memories instead of the real Bee device.
//   BEEPLEX_LLM=1     Allow beeplex to call an LLM for scoring. OFF by
//                     default in Y so no model call bypasses the policy
//                     wrapper; scoring falls back to deterministic.
// ---------------------------------------------------------------------------

// Top-level code must not touch Node-only APIs: this module is also bundled
// into the Cloudflare Worker, where import.meta.url is undefined and there
// is no process, fs, or child_process.
const isNodeRuntime =
  typeof process !== 'undefined' && !!process?.versions?.node;

function getEnv(name, fallback) {
  try {
    if (typeof process !== 'undefined' && process.env) {
      const value = process.env[name];
      return value === undefined ? fallback : value;
    }
  } catch {
    // Non-Node runtime: fall through to the fallback.
  }
  return fallback;
}

function getMetaUrl() {
  try {
    return import.meta.url;
  } catch {
    return undefined;
  }
}

let cachedNodeLibs = null;
async function nodeLibs() {
  if (!cachedNodeLibs) {
    const [childProcess, fs, path, url] = await Promise.all([
      import('child_process'),
      import('fs'),
      import('path'),
      import('url'),
    ]);
    cachedNodeLibs = {
      spawn: childProcess.spawn,
      mkdirSync: fs.mkdirSync,
      dirname: path.dirname,
      join: path.join,
      fileURLToPath: url.fileURLToPath,
    };
  }
  return cachedNodeLibs;
}

let cachedDirs = null;
async function runtimeDirs() {
  if (cachedDirs) return cachedDirs;
  const { mkdirSync, dirname, join, fileURLToPath } = await nodeLibs();
  const metaUrl = getMetaUrl();
  if (!metaUrl) {
    throw new Error('Bee memory tools are unavailable in this runtime.');
  }
  const here = dirname(fileURLToPath(metaUrl));
  const yRoot = join(here, '..');
  const dataDir = getEnv('BEEPLEX_DATA_DIR', join(yRoot, 'beeplex-data'));
  mkdirSync(dataDir, { recursive: true });
  cachedDirs = { beeplexDir: join(yRoot, 'beeplex'), dataDir };
  return cachedDirs;
}

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

function runBeeplex(command, args = []) {
  if (!isNodeRuntime) {
    return Promise.resolve({
      ok: false,
      error:
        'Bee memory tools run on the Node.js server only; they are not available in the Cloudflare Worker.',
    });
  }
  return (async () => {
    const { spawn } = await nodeLibs();
    const { beeplexDir, dataDir } = await runtimeDirs();
    const python = getEnv('BEEPLEX_PYTHON', 'python3');
    const timeoutMs = Number(getEnv('BEEPLEX_TIMEOUT_MS', '120000')) || 120000;
    return new Promise((resolve) => {
      const env = {
        ...process.env,
        BEEPLEX_DATA_DIR: dataDir,
        // Never inherit a stray LLM opt-in; deterministic unless explicitly set.
        ...(getEnv('BEEPLEX_LLM', '') === '1' ? {} : { BEEPLEX_LLM: '' }),
      };
      const child = spawn(python, ['-m', 'beeplex', command, '--json', ...args], {
        cwd: beeplexDir,
        env,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > MAX_STDOUT_BYTES) child.kill('SIGKILL');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `Failed to start beeplex: ${err.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ ok: false, error: `beeplex ${command} timed out after ${timeoutMs}ms` });
          return;
        }
        if (stdout.length > MAX_STDOUT_BYTES) {
          resolve({ ok: false, error: `beeplex ${command} output exceeded size limit` });
          return;
        }
        try {
          const payload = JSON.parse(stdout);
          resolve(code === 0
            ? { ok: true, data: payload }
            : { ok: false, error: stderr.trim().slice(-2000) || `beeplex ${command} exited with code ${code}` });
        } catch {
          resolve({ ok: false, error: `beeplex ${command} returned non-JSON output`, detail: (stderr || stdout).trim().slice(-2000) });
        }
      });
    });
  })().catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
}

const limitArg = (input, fallback) => {
  const n = Number(input?.limit ?? fallback);
  return ['--limit', String(Math.min(50, Math.max(1, Number.isFinite(n) ? n : fallback)))];
};

const tool = (name, description, properties, required, run) => ({
  spec: {
    name,
    description,
    inputSchema: { json: { type: 'object', properties, required, additionalProperties: false } },
  },
  fn: run,
});

export function createBeeMemoryTools() {
  return [
    tool(
      'bee_memory_status',
      'Check the Bee device connection and beeplex setup. Use to see whether live memories or sample data (demo mode) are in play.',
      {},
      [],
      () => runBeeplex('status'),
    ),
    tool(
      'bee_memory_context',
      "Catch up on recent Bee memories. Use for 'what did I talk about today/yesterday' questions. Period can be recent, today, or a specific date.",
      {
        period: { type: 'string', enum: ['recent', 'today', 'date'] },
        date_str: { type: 'string', description: 'Calendar date YYYY-MM-DD, required when period is date.' },
        limit: { type: 'number', description: 'Max items, 1-50. Default 10.' },
      },
      [],
      (input) => {
        const args = [...limitArg(input, 10)];
        if (input?.period) args.push('--period', input.period);
        if (input?.date_str) args.push('--date-str', input.date_str);
        return runBeeplex('context', args);
      },
    ),
    tool(
      'bee_memory_search',
      'Search the user\'s Bee memories for a topic or phrase. Use when they ask what was said about something specific.',
      {
        query: { type: 'string' },
        since: { type: 'string', description: 'First calendar day YYYY-MM-DD.' },
        until: { type: 'string', description: 'Last calendar day YYYY-MM-DD.' },
        limit: { type: 'number', description: 'Max items, 1-50. Default 10.' },
      },
      ['query'],
      (input) => {
        const args = [input.query, ...limitArg(input, 10)];
        if (input?.since) args.push('--since', input.since);
        if (input?.until) args.push('--until', input.until);
        return runBeeplex('search', args);
      },
    ),
    tool(
      'bee_conversations',
      'Browse recent Bee conversation summaries. Use read on a conversation id for the full transcript.',
      {
        limit: { type: 'number', description: 'Max items, 1-50. Default 5.' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous call for the next page.' },
      },
      [],
      (input) => {
        const args = [...limitArg(input, 5)];
        if (input?.cursor) args.push('--cursor', input.cursor);
        return runBeeplex('conversations', args);
      },
    ),
    tool(
      'bee_conversation_read',
      'Read a full Bee conversation transcript by id. Transcripts are long; prefer small limits.',
      {
        conversation_id: { type: 'string' },
        limit: { type: 'number', description: 'Max transcript items, 1-50. Default 10.' },
        offset: { type: 'number', description: 'Skip this many items first. Default 0.' },
      },
      ['conversation_id'],
      (input) => runBeeplex('read', [input.conversation_id, ...limitArg(input, 10), '--offset', String(Math.max(0, Number(input?.offset) || 0))]),
    ),
    tool(
      'bee_conversation_score',
      'Score recent conversations for engagement and forward motion (deterministic scoring unless BEEPLEX_LLM=1). Use when the user asks how a conversation went.',
      {
        limit: { type: 'number', description: 'Max items, 1-50. Default 5.' },
      },
      [],
      (input) => runBeeplex('score', [...limitArg(input, 5)]),
    ),
    tool(
      'bee_todos',
      'List commitments and action items the Bee device picked up from conversations.',
      {
        limit: { type: 'number', description: 'Max items, 1-50. Default 20.' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous call for the next page.' },
      },
      [],
      (input) => {
        const args = [...limitArg(input, 20)];
        if (input?.cursor) args.push('--cursor', input.cursor);
        return runBeeplex('todos', args);
      },
    ),
    tool(
      'bee_disagreement_view',
      "Compare the Bee device's own summaries and todos against beeplex's independent scores. Flagged disagreements are the interesting signal.",
      {
        limit: { type: 'number', description: 'Max items, 1-50. Default 10.' },
      },
      [],
      (input) => runBeeplex('disagree', [...limitArg(input, 10)]),
    ),
    tool(
      'bee_diary',
      "Write today's Bee diary entry (first-person, from today's conversations) into the data folder and return it.",
      {},
      [],
      () => runBeeplex('diary'),
    ),
    tool(
      'bee_profile',
      "Read the saved user profile built from conversation history. Set refresh to rebuild it from the latest data.",
      {
        refresh: { type: 'boolean', description: 'Rebuild the profile from the latest data.' },
        full: { type: 'boolean', description: 'Return the full profile text instead of the summary.' },
      },
      [],
      (input) => {
        const args = [];
        if (input?.refresh) args.push('--refresh');
        if (input?.full) args.push('--full');
        return runBeeplex('profile', args);
      },
    ),
    tool(
      'bee_report',
      'Generate Office reports (Word/Excel/PowerPoint) and a dashboard HTML from recent conversations into the data folder. Returns the file paths.',
      {
        limit: { type: 'number', description: 'Max conversations to include, 1-50. Default 10.' },
      },
      [],
      (input) => runBeeplex('report', [...limitArg(input, 10)]),
    ),
  ];
}
