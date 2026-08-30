import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  chromium,
  type BrowserContext,
  type Page,
} from 'playwright';
import type { AppConfig } from '../config/env.js';
import { storageStateExists } from '../config/env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export class BrowserManager {
  private context: BrowserContext | null = null;
  private relaunching = false;

  constructor(private readonly config: AppConfig) {}

  async start(): Promise<void> {
    await this.launch();
  }

  getContext(): BrowserContext {
    if (!this.context) {
      throw new AppError('BROWSER_UNAVAILABLE', 'Browser context is not running', 503);
    }
    return this.context;
  }

  async newPage(): Promise<Page> {
    const ctx = this.getContext();
    const page = await ctx.newPage();
    await this.preparePage(page);
    return page;
  }

  async preparePage(page: Page): Promise<void> {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    try {
      await page.goto(this.config.chatbotUrl, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_/i.test(msg)) {
        throw new AppError(
          'BROWSER_UNAVAILABLE',
          `Cannot reach CHATBOT_URL (${this.config.chatbotUrl}): ${msg}`,
          503,
        );
      }
      throw err;
    }
    try {
      await page
        .locator('#prompt-textarea')
        .waitFor({ state: 'visible', timeout: this.config.navigationTimeoutMs });
    } catch {
      throw new AppError(
        'SELECTOR_NOT_FOUND',
        'Chat composer (#prompt-textarea) not found — is CHATBOT_URL the chat UI?',
        502,
      );
    }
  }

  /** Open a page at an arbitrary URL (tests / recover). Does not require composer. */
  async newBlankPage(): Promise<Page> {
    return this.getContext().newPage();
  }

  async close(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch (err) {
        logger.warn({ err }, 'Error closing browser context');
      }
    }
  }

  async relaunch(): Promise<void> {
    if (this.relaunching) return;
    this.relaunching = true;
    try {
      await this.close();
      await new Promise((r) => setTimeout(r, 500));
      await this.launch();
    } finally {
      this.relaunching = false;
    }
  }

  private async launch(): Promise<void> {
    mkdirSync(this.config.userDataDir, { recursive: true });
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: this.config.headless,
      viewport: { width: 1400, height: 900 },
      args: [],
    };
    if (this.config.browserChannel) {
      launchOptions.channel = this.config.browserChannel;
    }

    logger.info(
      { headless: this.config.headless, userDataDir: this.config.userDataDir },
      'Launching persistent Chromium context',
    );

    const context = await chromium.launchPersistentContext(this.config.userDataDir, launchOptions);
    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    if (storageStateExists(this.config)) {
      await this.applyStorageState(context);
    }

    context.on('close', () => {
      logger.warn('Browser context closed');
      this.context = null;
    });

    this.context = context;

    for (const p of context.pages()) {
      if (p.url() === 'about:blank') {
        await p.close().catch(() => undefined);
      }
    }
  }

  private async applyStorageState(context: BrowserContext): Promise<void> {
    try {
      const raw = readFileSync(this.config.storageStatePath, 'utf8');
      const state = JSON.parse(raw) as {
        cookies?: Parameters<BrowserContext['addCookies']>[0];
        origins?: Array<{
          origin: string;
          localStorage: Array<{ name: string; value: string }>;
        }>;
      };
      if (state.cookies?.length) {
        await context.addCookies(state.cookies);
      }
      if (state.origins?.length) {
        for (const origin of state.origins) {
          await context.addInitScript(
            ({ items }) => {
              for (const item of items) {
                localStorage.setItem(item.name, item.value);
              }
            },
            { items: origin.localStorage },
          );
        }
      }
      logger.info({ path: this.config.storageStatePath }, 'Applied storageState cookies');
    } catch (err) {
      logger.warn({ err }, 'Failed to apply storageState; continuing with profile only');
    }
  }
}

export function artifactsDir(requestId: string): string {
  const safe = requestId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || 'unknown';
  const dir = path.resolve('artifacts', safe);
  const root = path.resolve('artifacts');
  if (!dir.startsWith(root + path.sep) && dir !== root) {
    throw new AppError('VALIDATION_ERROR', 'Invalid requestId for artifacts', 400);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}
