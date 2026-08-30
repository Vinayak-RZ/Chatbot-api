/**
 * Live tester for chatbot-api.
 *
 *   npm run try                  # interactive REPL
 *   npm run try -- "hello"       # one-shot prompt
 *   npm run try:ui               # tiny web UI on TRY_PORT (default 8790)
 *
 * Reads HOST/PORT/API_KEY(S) from the environment (via dotenv). Never prints the key.
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { config as loadDotenv } from 'dotenv';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localEnvPath = path.join(projectRoot, '.env');
if (!existsSync(localEnvPath)) {
  console.error('Missing local .env — copy .env.example to .env and edit it yourself.');
  process.exit(1);
}
loadDotenv({ path: localEnvPath, override: false, quiet: true });

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const baseUrl = (process.env.API_BASE_URL || `http://${host}:${port}`).replace(/\/$/, '');
const tryPort = Number(process.env.TRY_PORT || 8790);

function resolveApiKey(): string {
  const fromList = (process.env.API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const key = fromList[0] || process.env.API_KEY || process.env.TRY_API_KEY || '';
  if (!key) {
    throw new Error(
      'No API key in env. Set API_KEY or API_KEYS in your local .env (do not paste it into chat).',
    );
  }
  return key;
}

type SendResult = {
  ok?: boolean;
  partial?: boolean;
  response?: string;
  code?: string;
  error?: string;
  message?: string;
  durationMs?: number;
  requestId?: string;
};

async function health(): Promise<unknown> {
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`health ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function send(prompt: string, apiKey: string): Promise<SendResult> {
  const res = await fetch(`${baseUrl}/chat/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ prompt }),
  });
  const body = (await res.json().catch(() => ({}))) as SendResult;
  if (!res.ok && body.response === undefined) {
    throw new Error(`${res.status} ${body.code || body.error || body.message || JSON.stringify(body)}`);
  }
  return body;
}

async function newChat(apiKey: string): Promise<void> {
  const res = await fetch(`${baseUrl}/chat/new`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`new chat ${res.status}: ${JSON.stringify(body)}`);
}

function printResult(body: SendResult) {
  const label = body.partial ? 'PARTIAL' : body.ok === false ? 'FAIL' : 'OK';
  console.log(`\n[${label}] ${body.durationMs ?? '?'}ms  requestId=${body.requestId ?? '—'}`);
  console.log(body.response ?? '(no response field)');
  console.log('');
}

async function runRepl(apiKey: string, initial?: string) {
  console.log(`try-client → ${baseUrl}`);
  console.log('Commands: /health  /new  /quit   (or type a prompt)\n');

  try {
    const h = await health();
    console.log('health:', JSON.stringify(h));
  } catch (err) {
    console.error('API not reachable:', err instanceof Error ? err.message : err);
    console.error('Start the API first: npm run mock  &&  npm run dev\n');
  }

  if (initial?.trim()) {
    printResult(await send(initial.trim(), apiKey));
    return;
  }

  const rl = createInterface({ input, output });
  try {
    for (;;) {
      const line = (await rl.question('prompt> ')).trim();
      if (!line) continue;
      if (line === '/quit' || line === '/exit') break;
      if (line === '/health') {
        console.log(JSON.stringify(await health(), null, 2));
        continue;
      }
      if (line === '/new') {
        await newChat(apiKey);
        console.log('new chat ok\n');
        continue;
      }
      try {
        printResult(await send(line, apiKey));
      } catch (err) {
        console.error('error:', err instanceof Error ? err.message : err, '\n');
      }
    }
  } finally {
    rl.close();
  }
}

async function runUi(apiKey: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      const body = await health();
      res.json(body);
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/send', async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ ok: false, error: 'prompt required' });
      return;
    }
    try {
      const body = await send(prompt, apiKey);
      res.status(body.partial ? 504 : 200).json(body);
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/new', async (_req, res) => {
    try {
      await newChat(apiKey);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chatbot-api try client</title>
  <style>
    :root { color-scheme: dark; --bg:#0f1216; --panel:#171b22; --line:#2a3140; --text:#e8ecf1; --muted:#9aa3b2; --accent:#3d8bfd; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px/1.45 system-ui,sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 1.15rem; margin: 0 0 4px; }
    p.sub { margin: 0 0 16px; color: var(--muted); font-size: 0.9rem; }
    #log { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; min-height: 280px; max-height: 55vh; overflow: auto; padding: 14px; white-space: pre-wrap; }
    .meta { color: var(--muted); font-size: 0.8rem; margin-bottom: 6px; }
    form { display: flex; gap: 8px; margin-top: 12px; }
    textarea { flex: 1; min-height: 72px; resize: vertical; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font: inherit; }
    button { background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 0 16px; font-weight: 600; cursor: pointer; }
    button.secondary { background: transparent; color: var(--muted); border: 1px solid var(--line); }
    button:disabled { opacity: 0.5; cursor: wait; }
    .row { display: flex; gap: 8px; margin-top: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>Try client</h1>
    <p class="sub">Proxies to ${baseUrl} — API key stays on this machine, never shown here.</p>
    <div id="log"></div>
    <form id="f">
      <textarea id="prompt" placeholder="Type a prompt…" autofocus></textarea>
      <button type="submit" id="send">Send</button>
    </form>
    <div class="row">
      <button type="button" class="secondary" id="health">Health</button>
      <button type="button" class="secondary" id="newchat">New chat</button>
    </div>
  </main>
  <script>
    const log = document.getElementById('log');
    const form = document.getElementById('f');
    const promptEl = document.getElementById('prompt');
    const sendBtn = document.getElementById('send');

    function append(title, text) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = title;
      const body = document.createElement('div');
      body.textContent = text;
      log.append(meta, body, document.createElement('br'));
      log.scrollTop = log.scrollHeight;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = promptEl.value.trim();
      if (!prompt) return;
      sendBtn.disabled = true;
      append('you', prompt);
      promptEl.value = '';
      try {
        const res = await fetch('/api/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        const label = data.partial ? 'partial' : data.ok === false ? 'fail' : 'ok';
        append(label + ' · ' + (data.durationMs ?? '?') + 'ms', data.response || data.error || JSON.stringify(data));
      } catch (err) {
        append('error', String(err));
      } finally {
        sendBtn.disabled = false;
        promptEl.focus();
      }
    });

    document.getElementById('health').onclick = async () => {
      const res = await fetch('/api/health');
      append('health', JSON.stringify(await res.json(), null, 2));
    };
    document.getElementById('newchat').onclick = async () => {
      const res = await fetch('/api/new', { method: 'POST' });
      append('new chat', JSON.stringify(await res.json()));
    };
  </script>
</body>
</html>`);
  });

  await new Promise<void>((resolve) => {
    app.listen(tryPort, '127.0.0.1', () => resolve());
  });
  console.log(`try-ui http://127.0.0.1:${tryPort}  →  ${baseUrl}`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const ui = args.includes('--ui');
  const promptArgs = args.filter((a) => a !== '--ui');
  const apiKey = resolveApiKey();

  if (ui) {
    await runUi(apiKey);
    return;
  }
  await runRepl(apiKey, promptArgs.join(' ') || undefined);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
