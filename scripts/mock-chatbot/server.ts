import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.MOCK_PORT || 4173);
const host = '127.0.0.1';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendFile(res: http.ServerResponse, filePath: string, status = 200) {
  const ext = path.extname(filePath);
  const body = fs.readFileSync(filePath);
  res.writeHead(status, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  const cookies = parseCookies(req.headers.cookie);

  if (req.method === 'GET' && url.pathname === '/auth/login') {
    sendFile(res, path.join(publicDir, 'login.html'));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/auth/login') {
    await readBody(req);
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': 'mock_session=1; Path=/; HttpOnly; SameSite=Lax',
    });
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname.startsWith('/c/')) {
    if (!cookies.mock_session && process.env.MOCK_REQUIRE_AUTH === '1') {
      res.writeHead(302, { Location: '/auth/login' });
      res.end();
      return;
    }
    sendFile(res, path.join(publicDir, 'index.html'));
    return;
  }

  const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safe);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  sendFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`Mock chatbot listening on http://${host}:${port}`);
});
