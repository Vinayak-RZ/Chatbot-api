export const CDP_CHANNELS = [
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'msedge',
  'msedge-beta',
  'msedge-dev',
  'msedge-canary',
] as const;

export type CdpChannel = (typeof CDP_CHANNELS)[number];

export function isCdpChannel(v: string): v is CdpChannel {
  return (CDP_CHANNELS as readonly string[]).includes(v);
}

export function isCdpEndpoint(v: string): boolean {
  if (isCdpChannel(v)) return true;
  try {
    const u = new URL(v);
    return (
      u.protocol === 'http:' ||
      u.protocol === 'https:' ||
      u.protocol === 'ws:' ||
      u.protocol === 'wss:'
    );
  } catch {
    return false;
  }
}
