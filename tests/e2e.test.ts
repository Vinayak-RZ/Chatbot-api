import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { BrowserManager } from '../src/automation/browser.js';
import { SELECTORS } from '../src/config/selectors.js';
import { PagePool } from '../src/page-pool.js';
import { createApp } from '../src/server.js';

const MOCK_URL = process.env.MOCK_URL || 'http://127.0.0.1:4173';

describe('E2E against mock', () => {
  let pool: PagePool;
  let app: ReturnType<typeof createApp>;
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'chatbot-api-e2e-'));
    const config = loadConfig({
      API_KEYS: 'key-a,key-b',
      MAX_PAGES: '2',
      CHATBOT_URL: `${MOCK_URL}?delayMs=3000`,
      HEADLESS: 'true',
      USER_DATA_DIR: path.join(tmp, 'profile'),
      STORAGE_STATE_PATH: path.join(tmp, 'state.json'),
      RATE_LIMIT_RPM: '20',
      GENERATION_TIMEOUT_MS: '15000',
      FIRST_TOKEN_TIMEOUT_MS: '8000',
      ARTIFACTS_ON_ERROR: 'false',
    });
    const browser = new BrowserManager(config);
    pool = new PagePool(config, browser);
    await pool.start();
    app = createApp(config, pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('send returns assistant text different from prompt', async () => {
    const prompt = `unique-prompt-${Date.now()}`;
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'key-a')
      .send({ prompt });
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.response).toContain('Mock reply to:');
    expect(res.body.response).not.toBe(prompt);
  }, 60_000);

  it('same key continues the thread (first user message still present)', async () => {
    await request(app).post('/chat/new').set('x-api-key', 'key-a');
    const p1 = `continue-first-${Date.now()}`;
    await request(app).post('/chat/send').set('x-api-key', 'key-a').send({ prompt: p1 });
    const p2 = `continue-second-${Date.now()}`;
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'key-a')
      .send({ prompt: p2 });
    expect(res.status).toBe(200);
    expect(res.body.response).toContain(p2);

    const userCount = await pool.withPage('key-a', async (page) =>
      page.locator(SELECTORS.userMessage).count(),
    );
    expect(userCount).toBeGreaterThanOrEqual(2);

    const texts = await pool.withPage('key-a', async (page) =>
      page.locator(SELECTORS.userMessage).allInnerTexts(),
    );
    expect(texts.some((t) => t.includes(p1))).toBe(true);
  }, 120_000);

  it('POST /chat/new clears the thread', async () => {
    await request(app)
      .post('/chat/send')
      .set('x-api-key', 'key-a')
      .send({ prompt: `before-new-${Date.now()}` });
    const neu = await request(app).post('/chat/new').set('x-api-key', 'key-a');
    expect(neu.status).toBe(200);

    const userCount = await pool.withPage('key-a', async (page) =>
      page.locator(SELECTORS.userMessage).count(),
    );
    const asstCount = await pool.withPage('key-a', async (page) =>
      page.locator(SELECTORS.assistantMessage).count(),
    );
    expect(userCount).toBe(0);
    expect(asstCount).toBe(0);
  }, 60_000);

  it('two keys are isolated', async () => {
    const pA = `ISOLATION_A_${Date.now()}`;
    const pB = `ISOLATION_B_${Date.now()}`;
    const a = await request(app).post('/chat/send').set('x-api-key', 'key-a').send({ prompt: pA });
    const b = await request(app).post('/chat/send').set('x-api-key', 'key-b').send({ prompt: pB });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.response).toContain(pA);
    expect(b.body.response).toContain(pB);
    expect(b.body.response).not.toContain(pA);
    expect(a.body.response).not.toContain(pB);
  }, 120_000);

  it('parallel sends finish well under 6s for delayMs=3000', async () => {
    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/chat/send')
        .set('x-api-key', 'key-a')
        .send({ prompt: `parallel-a-${Date.now()}` }),
      request(app)
        .post('/chat/send')
        .set('x-api-key', 'key-b')
        .send({ prompt: `parallel-b-${Date.now()}` }),
    ]);
    const wall = Date.now() - t0;
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(wall).toBeLessThan(6000);
  }, 60_000);
});

describe('E2E delayMs=5000 completes', () => {
  let pool: PagePool;
  let app: ReturnType<typeof createApp>;
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'chatbot-api-5s-'));
    const config = loadConfig({
      API_KEY: 'key-5',
      MAX_PAGES: '1',
      CHATBOT_URL: `${MOCK_URL}?delayMs=5000`,
      HEADLESS: 'true',
      USER_DATA_DIR: path.join(tmp, 'profile'),
      STORAGE_STATE_PATH: path.join(tmp, 'state.json'),
      RATE_LIMIT_RPM: '20',
      GENERATION_TIMEOUT_MS: '15000',
      FIRST_TOKEN_TIMEOUT_MS: '8000',
      ARTIFACTS_ON_ERROR: 'false',
    });
    pool = new PagePool(config, new BrowserManager(config));
    await pool.start();
    app = createApp(config, pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 200 partial:false', async () => {
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'key-5')
      .send({ prompt: 'five-second-stream' });
    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.response).toContain('Mock reply to:');
  }, 60_000);
});

describe('E2E timeout partial', () => {
  let pool: PagePool;
  let app: ReturnType<typeof createApp>;
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'chatbot-api-timeout-'));
    const config = loadConfig({
      API_KEY: 'key-t',
      MAX_PAGES: '1',
      CHATBOT_URL: `${MOCK_URL}?delayMs=20000`,
      HEADLESS: 'true',
      USER_DATA_DIR: path.join(tmp, 'profile'),
      STORAGE_STATE_PATH: path.join(tmp, 'state.json'),
      RATE_LIMIT_RPM: '20',
      GENERATION_TIMEOUT_MS: '4000',
      FIRST_TOKEN_TIMEOUT_MS: '2000',
      ARTIFACTS_ON_ERROR: 'false',
    });
    pool = new PagePool(config, new BrowserManager(config));
    await pool.start();
    app = createApp(config, pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 504 partial:true and process stays up', async () => {
    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'key-t')
      .send({ prompt: 'slow-one' });
    expect(res.status).toBe(504);
    expect(res.body.partial).toBe(true);
    expect(typeof res.body.response).toBe('string');

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
  }, 60_000);
});

describe('E2E dummy page SELECTOR_NOT_FOUND', () => {
  let server: http.Server;
  let dummyUrl: string;
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'chatbot-api-dummy-'));
    const htmlPath = path.join(tmp, 'dummy.html');
    writeFileSync(htmlPath, '<!doctype html><html><body><h1>No composer</h1></body></html>');
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body><h1>No composer</h1></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    dummyUrl = `http://127.0.0.1:${addr.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    rmSync(tmp, { recursive: true, force: true });
  });

  it('fails with SELECTOR_NOT_FOUND and leaves no crash', async () => {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'chatbot-api-dummy-prof-'));
    const config = loadConfig({
      API_KEY: 'key-d',
      MAX_PAGES: '1',
      CHATBOT_URL: dummyUrl,
      HEADLESS: 'true',
      USER_DATA_DIR: profile,
      STORAGE_STATE_PATH: path.join(profile, 'state.json'),
      NAVIGATION_TIMEOUT_MS: '5000',
      ARTIFACTS_ON_ERROR: 'false',
    });
    const browser = new BrowserManager(config);
    const pool = new PagePool(config, browser);
    await pool.start();
    const app = createApp(config, pool);

    const res = await request(app)
      .post('/chat/send')
      .set('x-api-key', 'key-d')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SELECTOR_NOT_FOUND');

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);

    await pool.stop();
    rmSync(profile, { recursive: true, force: true });
  }, 60_000);
});
