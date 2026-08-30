import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { AppError } from '../src/errors.js';
import { PagePool } from '../src/page-pool.js';
import type { BrowserManager } from '../src/automation/browser.js';
import type { ChatAutomation } from '../src/automation/chat.js';
import type { Page } from 'playwright';

function fakePage(): Page {
  return {
    isClosed: () => false,
    on: vi.fn(),
    close: vi.fn(async () => undefined),
  } as unknown as Page;
}

function fakeBrowser(): BrowserManager {
  return {
    start: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    relaunch: vi.fn(async () => undefined),
    newPage: vi.fn(async () => fakePage()),
  } as unknown as BrowserManager;
}

function fakeChat(overrides: Partial<ChatAutomation> = {}): ChatAutomation {
  return {
    ensureNewChat: vi.fn(async () => undefined),
    sendPrompt: vi.fn(async () => ({ response: 'ok', partial: false, durationMs: 1 })),
    recoverSoft: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ChatAutomation;
}

describe('PagePool unit', () => {
  it('binds one page per key', async () => {
    const config = loadConfig({
      API_KEYS: 'a,b',
      MAX_PAGES: '2',
      CHATBOT_URL: 'http://127.0.0.1:4173',
    });
    const browser = fakeBrowser();
    const pool = new PagePool(config, browser, fakeChat());

    await pool.send('a', 'hello', 'r1');
    await pool.send('b', 'world', 'r2');

    expect(pool.hasKey('a')).toBe(true);
    expect(pool.hasKey('b')).toBe(true);
    expect(pool.boundKeyCount).toBe(2);
    expect(browser.newPage).toHaveBeenCalledTimes(2);
  });

  it('first use calls ensureNewChat once; continue does not', async () => {
    const config = loadConfig({
      API_KEY: 'k',
      MAX_PAGES: '1',
      CHATBOT_URL: 'http://127.0.0.1:4173',
    });
    const chat = fakeChat();
    const pool = new PagePool(config, fakeBrowser(), chat);

    await pool.send('k', 'one', 'r1');
    await pool.send('k', 'two', 'r2');

    expect(chat.ensureNewChat).toHaveBeenCalledTimes(1);
    expect(chat.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('throws QUEUE_FULL when that key queue is saturated', async () => {
    const config = loadConfig({
      API_KEY: 'k',
      MAX_PAGES: '1',
      CHATBOT_URL: 'http://127.0.0.1:4173',
      QUEUE_MAX: '1',
    });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const chat = fakeChat({
      ensureNewChat: vi.fn(async () => undefined),
      sendPrompt: vi.fn(async () => {
        await gate;
        return { response: 'ok', partial: false, durationMs: 1 };
      }),
    });

    const pool = new PagePool(config, fakeBrowser(), chat);
    const first = pool.send('k', 'hold', 'r1');
    await new Promise((r) => setTimeout(r, 20));

    await expect(pool.send('k', 'overflow', 'r2')).rejects.toMatchObject({
      code: 'QUEUE_FULL',
    } satisfies Partial<AppError>);

    release();
    await first;
  });

  it('rejects unknown key', async () => {
    const config = loadConfig({
      API_KEY: 'only',
      MAX_PAGES: '1',
      CHATBOT_URL: 'http://127.0.0.1:4173',
    });
    const pool = new PagePool(config, fakeBrowser(), fakeChat());
    await expect(pool.send('nope', 'x', 'r')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    } satisfies Partial<AppError>);
  });
});
