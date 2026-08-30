import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

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

  it('rejects chatgpt.com', () => {
    expect(() =>
      loadConfig({ ...base, CHATBOT_URL: 'https://chatgpt.com/' }),
    ).toThrow(/chatgpt\.com/);
  });
});
