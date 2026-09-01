import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { isCdpEndpoint } from '../src/config/cdp-channels.js';

describe('loadConfig', () => {
  const base = {
    API_KEY: 'k1',
    CHATBOT_URL: 'http://127.0.0.1:4173',
  };

  it('defaults MAX_PAGES to 1 and RATE_LIMIT_RPM to 10', () => {
    const cfg = loadConfig(base);
    expect(cfg.maxPages).toBe(1);
    expect(cfg.rateLimitRpm).toBe(10);
    expect(cfg.apiKeys).toEqual(['k1']);
    expect(cfg.browserMode).toBe('launch');
    expect(cfg.isAttach).toBe(false);
    expect(cfg.cdpAttachTab).toBe('focused');
  });

  it('prefers API_KEYS over API_KEY', () => {
    const cfg = loadConfig({ ...base, API_KEYS: 'a,b', MAX_PAGES: '2' });
    expect(cfg.apiKeys).toEqual(['a', 'b']);
  });

  it('rejects more keys than MAX_PAGES', () => {
    expect(() => loadConfig({ ...base, API_KEYS: 'a,b', MAX_PAGES: '1' })).toThrow(
      /MAX_PAGES/,
    );
  });

  it('rejects more than 3 keys', () => {
    expect(() =>
      loadConfig({ ...base, API_KEYS: 'a,b,c,d', MAX_PAGES: '3' }),
    ).toThrow(/At most 3/);
  });

  it('accepts any Chatbot URL string without host checks', () => {
    const cfg = loadConfig({ ...base, CHATBOT_URL: 'https://chatgpt.com/' });
    expect(cfg.chatbotUrl).toBe('https://chatgpt.com/');
  });

  it('rejects non-loopback HOST', () => {
    expect(() => loadConfig({ ...base, HOST: '0.0.0.0' })).toThrow(/loopback/);
  });

  it('accepts CDP_URL channel names chrome and msedge', () => {
    const chrome = loadConfig({ ...base, CDP_URL: 'chrome' });
    expect(chrome.cdpUrl).toBe('chrome');
    expect(chrome.isAttach).toBe(true);
    const edge = loadConfig({ ...base, CDP_URL: 'msedge' });
    expect(edge.cdpUrl).toBe('msedge');
  });

  it('accepts CDP_URL http and ws endpoints', () => {
    const http = loadConfig({ ...base, CDP_URL: 'http://127.0.0.1:9222' });
    expect(http.cdpUrl).toBe('http://127.0.0.1:9222');
    const ws = loadConfig({
      ...base,
      CDP_URL: 'ws://127.0.0.1:9222/devtools/browser/abc',
    });
    expect(ws.cdpUrl).toMatch(/^ws:/);
  });

  it('rejects invalid CDP_URL', () => {
    expect(() => loadConfig({ ...base, CDP_URL: 'firefox' })).toThrow(/CDP_URL/);
    expect(() => loadConfig({ ...base, CDP_URL: 'not a url' })).toThrow(/CDP_URL/);
  });

  it('rejects BROWSER_MODE=attach without CDP_URL', () => {
    expect(() =>
      loadConfig({ ...base, BROWSER_MODE: 'attach' }),
    ).toThrow(/CDP_URL is required/);
  });

  it('allows attach + focused without CHATBOT_URL', () => {
    const cfg = loadConfig({
      API_KEY: 'k1',
      BROWSER_MODE: 'attach',
      CDP_URL: 'chrome',
    });
    expect(cfg.chatbotUrl).toBeUndefined();
    expect(cfg.cdpAttachTab).toBe('focused');
    expect(cfg.browserMode).toBe('attach');
    expect(cfg.isAttach).toBe(true);
  });

  it('requires CHATBOT_URL when CDP_ATTACH_TAB=url', () => {
    expect(() =>
      loadConfig({
        API_KEY: 'k1',
        BROWSER_MODE: 'attach',
        CDP_URL: 'chrome',
        CDP_ATTACH_TAB: 'url',
      }),
    ).toThrow(/CHATBOT_URL is required when CDP_ATTACH_TAB=url/);
  });

  it('accepts attach + url when CHATBOT_URL is set', () => {
    const cfg = loadConfig({
      API_KEY: 'k1',
      BROWSER_MODE: 'attach',
      CDP_URL: 'chrome',
      CDP_ATTACH_TAB: 'url',
      CHATBOT_URL: 'http://127.0.0.1:4173',
    });
    expect(cfg.cdpAttachTab).toBe('url');
    expect(cfg.chatbotUrl).toBe('http://127.0.0.1:4173');
  });

  it('allows GENERATION_TIMEOUT_MS=0 (wait forever)', () => {
    const cfg = loadConfig({ ...base, GENERATION_TIMEOUT_MS: '0', FIRST_TOKEN_TIMEOUT_MS: '0' });
    expect(cfg.generationTimeoutMs).toBe(0);
    expect(cfg.firstTokenTimeoutMs).toBe(0);
  });
});

describe('isCdpEndpoint', () => {
  it('accepts channels and loopback URLs', () => {
    expect(isCdpEndpoint('chrome')).toBe(true);
    expect(isCdpEndpoint('msedge-dev')).toBe(true);
    expect(isCdpEndpoint('http://127.0.0.1:9222')).toBe(true);
    expect(isCdpEndpoint('safari')).toBe(false);
  });
});
