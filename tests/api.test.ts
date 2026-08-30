import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { AppError } from '../src/errors.js';
import { createApp } from '../src/server.js';
import type { PagePool } from '../src/page-pool.js';

function mockPool(overrides: Partial<PagePool> = {}): PagePool {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(async () => ({
      response: 'Mock reply to: hi',
      partial: false,
      durationMs: 10,
    })),
    newChat: vi.fn(async () => undefined),
    getHealth: vi.fn(() => ({ pagesBound: 0, maxPages: 1, keys: [] })),
    ...overrides,
  } as unknown as PagePool;
}

describe('API auth / validation / rate limit / queue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('health is open', async () => {
    const config = loadConfig({ API_KEY: 'secret', CHATBOT_URL: 'http://127.0.0.1:4173' });
    const app = createApp(config, mockPool());
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('rejects missing API key', async () => {
    const config = loadConfig({ API_KEY: 'secret', CHATBOT_URL: 'http://127.0.0.1:4173' });
    const app = createApp(config, mockPool());
    const res = await request(app).post('/chat/send').send({ prompt: 'hi' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong API key', async () => {
    const config = loadConfig({ API_KEY: 'secret', CHATBOT_URL: 'http://127.0.0.1:4173' });
    const app = createApp(config, mockPool());
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'nope')
      .send({ prompt: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects empty prompt', async () => {
    const config = loadConfig({ API_KEY: 'secret', CHATBOT_URL: 'http://127.0.0.1:4173' });
    const app = createApp(config, mockPool());
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'secret')
      .send({ prompt: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversize prompt', async () => {
    const config = loadConfig({
      API_KEY: 'secret',
      CHATBOT_URL: 'http://127.0.0.1:4173',
      MAX_PROMPT_CHARS: '10',
    });
    const app = createApp(config, mockPool());
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'secret')
      .send({ prompt: 'this is way too long for the limit' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns QUEUE_FULL from pool', async () => {
    const config = loadConfig({ API_KEY: 'secret', CHATBOT_URL: 'http://127.0.0.1:4173' });
    const pool = mockPool({
      send: vi.fn(async () => {
        throw new AppError('QUEUE_FULL', 'Page queue is full', 429);
      }),
    });
    const app = createApp(config, pool);
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'secret')
      .send({ prompt: 'hi' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('QUEUE_FULL');
  });

  it('rate limits after RATE_LIMIT_RPM', async () => {
    const config = loadConfig({
      API_KEY: 'secret',
      CHATBOT_URL: 'http://127.0.0.1:4173',
      RATE_LIMIT_RPM: '3',
    });
    const app = createApp(config, mockPool());
    for (let i = 0; i < 3; i++) {
      const ok = await request(app)
        .post('/chat/send')
        .set('x-api-key', 'secret')
        .send({ prompt: `hi-${i}` });
      expect(ok.status).toBe(200);
    }
    const limited = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'secret')
      .send({ prompt: 'overflow' });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });
});
