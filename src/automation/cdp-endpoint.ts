import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCdpChannel, type CdpChannel } from '../config/cdp-channels.js';

function localAppData(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

/** Well-known user-data dirs that contain DevToolsActivePort when remote debugging is on. */
export function userDataDirsForChannel(channel: CdpChannel): string[] {
  const home = os.homedir();
  const local = localAppData();
  const win: Record<CdpChannel, string> = {
    chrome: path.join(local, 'Google', 'Chrome', 'User Data'),
    'chrome-beta': path.join(local, 'Google', 'Chrome Beta', 'User Data'),
    'chrome-dev': path.join(local, 'Google', 'Chrome Dev', 'User Data'),
    'chrome-canary': path.join(local, 'Google', 'Chrome SxS', 'User Data'),
    msedge: path.join(local, 'Microsoft', 'Edge', 'User Data'),
    'msedge-beta': path.join(local, 'Microsoft', 'Edge Beta', 'User Data'),
    'msedge-dev': path.join(local, 'Microsoft', 'Edge Dev', 'User Data'),
    'msedge-canary': path.join(local, 'Microsoft', 'Edge SxS', 'User Data'),
  };
  const mac: Record<CdpChannel, string> = {
    chrome: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    'chrome-beta': path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Beta'),
    'chrome-dev': path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Dev'),
    'chrome-canary': path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    msedge: path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
    'msedge-beta': path.join(home, 'Library', 'Application Support', 'Microsoft Edge Beta'),
    'msedge-dev': path.join(home, 'Library', 'Application Support', 'Microsoft Edge Dev'),
    'msedge-canary': path.join(home, 'Library', 'Application Support', 'Microsoft Edge Canary'),
  };
  const linux: Record<CdpChannel, string> = {
    chrome: path.join(home, '.config', 'google-chrome'),
    'chrome-beta': path.join(home, '.config', 'google-chrome-beta'),
    'chrome-dev': path.join(home, '.config', 'google-chrome-unstable'),
    'chrome-canary': path.join(home, '.config', 'google-chrome-canary'),
    msedge: path.join(home, '.config', 'microsoft-edge'),
    'msedge-beta': path.join(home, '.config', 'microsoft-edge-beta'),
    'msedge-dev': path.join(home, '.config', 'microsoft-edge-dev'),
    'msedge-canary': path.join(home, '.config', 'microsoft-edge-canary'),
  };

  if (process.platform === 'win32') return [win[channel]];
  if (process.platform === 'darwin') return [mac[channel]];
  return [linux[channel]];
}

export function parseDevToolsActivePort(contents: string): string | null {
  const lines = contents
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const portLine = lines[0];
  if (portLine === undefined) return null;
  const port = parseInt(portLine, 10);
  if (Number.isNaN(port) || port <= 0) return null;
  const pathLine = lines[1];
  const wsPath = pathLine?.startsWith('/') ? pathLine : '/devtools/browser';
  return `ws://127.0.0.1:${port}${wsPath}`;
}

export function inspectHint(cdpUrl: string): string {
  const edge = cdpUrl.startsWith('msedge');
  const page = edge ? 'edge://inspect/#remote-debugging' : 'chrome://inspect/#remote-debugging';
  return `Enable remote debugging at ${page} and click Allow when prompted.`;
}

/**
 * Turn a channel name into a ws:// CDP endpoint via DevToolsActivePort.
 * http(s)/ws(s) values are returned unchanged.
 */
export function resolveCdpEndpoint(cdpUrl: string): string {
  if (!isCdpChannel(cdpUrl)) return cdpUrl;

  for (const dir of userDataDirsForChannel(cdpUrl)) {
    const file = path.join(dir, 'DevToolsActivePort');
    if (!existsSync(file)) continue;
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const endpoint = parseDevToolsActivePort(contents);
    if (endpoint) return endpoint;
  }

  throw new Error(`Could not connect to ${cdpUrl}: DevToolsActivePort not found. ${inspectHint(cdpUrl)}`);
}
