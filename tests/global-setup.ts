/**
 * Start the mock chatbot if MOCK_URL is not already reachable.
 * Used by Vitest globalSetup so CI/local tests do not depend on a fragile shell Start-Process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK_URL = process.env.MOCK_URL || 'http://127.0.0.1:4173';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForUp(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await isUp(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Mock did not become ready at ${url}`);
}

export default async function globalSetup() {
  if (await isUp(MOCK_URL)) {
    return async () => undefined;
  }

  const port = Number(new URL(MOCK_URL).port || 4173);
  process.env.MOCK_PORT = String(port);

  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(root, 'scripts', 'mock-chatbot', 'server.ts');
  const child: ChildProcess = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: root,
    env: { ...process.env, MOCK_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let stderr = '';
  child.stderr?.on('data', (b: Buffer) => {
    stderr += b.toString();
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stderr += `\nmock exited with code ${code}`;
    }
  });

  try {
    await waitForUp(MOCK_URL);
  } catch (err) {
    child.kill('SIGTERM');
    throw new Error(`Failed to start mock: ${String(err)}\n${stderr}`);
  }

  return async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }
  };
}
