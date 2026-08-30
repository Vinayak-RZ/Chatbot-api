import { BrowserManager } from './automation/browser.js';
import { ChatAutomation, type ChatResult } from './automation/chat.js';
import type { AppConfig } from './config/env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import PQueue from 'p-queue';
import type { Page } from 'playwright';

type Slot = {
  apiKey: string;
  page: Page;
  queue: PQueue;
  needsNewChat: boolean;
};

export class PagePool {
  private readonly slots = new Map<string, Slot>();
  private readonly chat: ChatAutomation;

  constructor(
    private readonly config: AppConfig,
    private readonly browser: BrowserManager,
    chat?: ChatAutomation,
  ) {
    this.chat = chat ?? new ChatAutomation(config);
  }

  async start(): Promise<void> {
    await this.browser.start();
  }

  async stop(): Promise<void> {
    if (!this.browser.isCdp) {
      for (const slot of this.slots.values()) {
        await slot.page.close().catch(() => undefined);
      }
    }
    this.slots.clear();
    await this.browser.close();
  }

  async send(apiKey: string, prompt: string, requestId: string): Promise<ChatResult> {
    const slot = await this.getOrCreateSlot(apiKey);
    return this.enqueue(slot, async () => {
      try {
        if (slot.needsNewChat) {
          await this.chat.ensureNewChat(slot.page);
          slot.needsNewChat = false;
        }
        const result = await this.chat.sendPrompt(slot.page, prompt, requestId);
        if (result.partial) {
          // Leave page reusable; soft recover happens next send
        }
        return result;
      } catch (err) {
        await this.recoverSlot(slot, requestId);
        throw err;
      }
    });
  }

  async newChat(apiKey: string, requestId: string): Promise<void> {
    const slot = await this.getOrCreateSlot(apiKey);
    await this.enqueue(slot, async () => {
      try {
        await this.chat.ensureNewChat(slot.page);
        slot.needsNewChat = false;
      } catch (err) {
        await this.recoverSlot(slot, requestId);
        throw err;
      }
    });
  }

  getHealth(): { pagesBound: number; maxPages: number; keys: string[] } {
    return {
      pagesBound: this.slots.size,
      maxPages: this.config.maxPages,
      keys: [...this.slots.keys()].map((k) => k.slice(0, 4) + '…'),
    };
  }

  /** Test/helper: number of bound keys. */
  get boundKeyCount(): number {
    return this.slots.size;
  }

  /** Test/helper: whether a key already has a slot. */
  hasKey(apiKey: string): boolean {
    return this.slots.has(apiKey);
  }

  /** Inspect DOM on a key's page (tests). */
  async withPage<T>(apiKey: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const slot = this.slots.get(apiKey);
    if (!slot) throw new AppError('BROWSER_UNAVAILABLE', 'No page bound for key', 503);
    return this.enqueue(slot, () => fn(slot.page));
  }

  private async getOrCreateSlot(apiKey: string): Promise<Slot> {
    const existing = this.slots.get(apiKey);
    if (existing) {
      if (existing.page.isClosed()) {
        this.slots.delete(apiKey);
      } else {
        return existing;
      }
    }

    if (this.slots.size >= this.config.maxPages) {
      // Should not happen if keys <= maxPages, but guard anyway
      throw new AppError(
        'BROWSER_UNAVAILABLE',
        `No free page slots (max ${this.config.maxPages})`,
        503,
      );
    }

    if (!this.config.apiKeys.includes(apiKey)) {
      throw new AppError('UNAUTHORIZED', 'Unknown API key', 401);
    }

    logger.info({ keyPrefix: apiKey.slice(0, 4) }, 'Binding new page for API key');
    const page = await this.browser.newPage();
    page.on('crash', () => {
      logger.error({ keyPrefix: apiKey.slice(0, 4) }, 'Page crashed');
      const slot = this.slots.get(apiKey);
      if (slot) slot.needsNewChat = true;
    });
    page.on('close', () => {
      logger.warn({ keyPrefix: apiKey.slice(0, 4) }, 'Page closed');
    });

    const slot: Slot = {
      apiKey,
      page,
      queue: new PQueue({ concurrency: 1 }),
      needsNewChat: true,
    };
    this.slots.set(apiKey, slot);
    return slot;
  }

  private enqueue<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
    const size = slot.queue.size + slot.queue.pending;
    if (size >= this.config.queueMax) {
      throw new AppError('QUEUE_FULL', 'Page queue is full', 429, {
        queueMax: this.config.queueMax,
      });
    }
    return slot.queue.add(fn) as Promise<T>;
  }

  private async recoverSlot(slot: Slot, requestId: string): Promise<void> {
    try {
      await this.chat.recoverSoft(slot.page);
      if (slot.page.isClosed()) {
        await this.replacePage(slot);
      }
    } catch (err) {
      logger.warn({ err, requestId }, 'Recover failed; replacing page');
      await this.replacePage(slot);
    }
  }

  private async replacePage(slot: Slot): Promise<void> {
    try {
      // Open the replacement before closing the old tab — closing the last page
      // would shut down a persistent Chromium context.
      const page = await this.browser.newPage();
      const old = slot.page;
      slot.page = page;
      slot.needsNewChat = true;
      if (!this.browser.isCdp && !old.isClosed()) {
        await old.close().catch(() => undefined);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to open replacement page; relaunching browser');
      this.slots.clear();
      await this.browser.relaunch();
      const page = await this.browser.newPage();
      slot.page = page;
      slot.needsNewChat = true;
      this.slots.set(slot.apiKey, slot);
    }
  }
}
