import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import type { AppConfig } from '../config/env.js';
import { storageStateExists } from '../config/env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export class BrowserManager {
  private context: BrowserContext | null = null;
  /** Only set when attached via CDP — closing disconnects without killing Chrome. */
  private cdpBrowser: Browser | null = null;
  private relaunching = false;

  constructor(private readonly config: AppConfig) {}

  get isCdp(): boolean {
    return Boolean(this.config.cdpUrl);
  }

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

    if (this.isCdp && this.config.cdpReuseTabs) {
      const adopted = await this.findReusablePage(ctx);
      if (adopted) {
        logger.info({ url: adopted.url() }, 'Reusing existing CDP tab for chatbot');
        await this.ensureChatReady(adopted, { navigateIfNeeded: true });
        return adopted;
      }
    }

    const page = await ctx.newPage();
    await this.preparePage(page);
    return page;
  }

  async preparePage(page: Page): Promise<void> {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await this.ensureChatReady(page, { navigateIfNeeded: true });
  }

  /** Open a page at an arbitrary URL (tests / recover). Does not require composer. */
  async newBlankPage(): Promise<Page> {
    return this.getContext().newPage();
  }

  async close(): Promise<void> {
    const ctx = this.context;
    const cdp = this.cdpBrowser;
    this.context = null;
    this.cdpBrowser = null;

    if (cdp) {
      // Disconnect Playwright from Chrome — do not close the user's browser.
      try {
        await cdp.close();
        logger.info('Disconnected from CDP browser (Chrome left running)');
      } catch (err) {
        logger.warn({ err }, 'Error disconnecting CDP browser');
      }
      return;
    }

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
    if (this.config.cdpUrl) {
      await this.connectCdp(this.config.cdpUrl);
      return;
    }
    await this.launchPersistent();
  }

  private async connectCdp(cdpUrl: string): Promise<void> {
    logger.info({ cdpUrl }, 'Connecting to existing browser over CDP');
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError(
        'BROWSER_UNAVAILABLE',
        `CDP connect failed (${cdpUrl}). Start Chrome with --remote-debugging-port=9222. ${msg}`,
        503,
      );
    }

    const contexts = browser.contexts();
    const context = contexts[0];
    if (!context) {
      await browser.close().catch(() => undefined);
      throw new AppError(
        'BROWSER_UNAVAILABLE',
        'CDP browser has no contexts — open at least one tab, then retry',
        503,
      );
    }

    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    this.cdpBrowser = browser;
    this.context = context;

    browser.on('disconnected', () => {
      logger.warn('CDP browser disconnected');
      this.context = null;
      this.cdpBrowser = null;
    });

    const pages = context.pages();
    logger.info(
      { tabs: pages.length, urls: pages.map((p) => p.url()).slice(0, 5) },
      'Attached to CDP browser',
    );
  }

  private async launchPersistent(): Promise<void> {
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

    // Chromium tears down launchPersistentContext when the last page closes.
    // Keep one tab and open the Chatbot URL so the headed window is useful immediately.
    let keep = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    for (const p of context.pages()) {
      if (p !== keep && !p.isClosed()) {
        await p.close().catch(() => undefined);
      }
    }
    try {
      await keep.goto(this.config.chatbotUrl, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      logger.warn(
        { err },
        'Could not open Chatbot URL on launch — window stays open; retries on first request',
      );
    }
  }

  private async findReusablePage(ctx: BrowserContext): Promise<Page | null> {
    let targetOrigin: string | null = null;
    try {
      targetOrigin = new URL(this.config.chatbotUrl).origin;
    } catch {
      /* Chatbot URL may be any string — skip origin matching */
    }
    const pages = ctx.pages().filter((p) => !p.isClosed());

    if (targetOrigin) {
      for (const page of pages) {
        try {
          const u = new URL(page.url());
          if (u.origin === targetOrigin) {
            return page;
          }
        } catch {
          /* ignore invalid urls */
        }
      }
    }

    for (const page of pages) {
      const hasComposer = await page
        .locator('#prompt-textarea')
        .isVisible()
        .catch(() => false);
      if (hasComposer) return page;
    }

    return null;
  }

  private async ensureChatReady(
    page: Page,
    opts: { navigateIfNeeded: boolean },
  ): Promise<void> {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    const composerVisible = await page
      .locator('#prompt-textarea')
      .isVisible()
      .catch(() => false);

    if (!composerVisible && opts.navigateIfNeeded) {
      try {
        await page.goto(this.config.chatbotUrl, { waitUntil: 'domcontentloaded' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_/i.test(msg)) {
          throw new AppError(
            'BROWSER_UNAVAILABLE',
            `Cannot reach Chatbot URL: ${msg}`,
            503,
          );
        }
        throw err;
      }
    }

    try {
      await page
        .locator('#prompt-textarea')
        .waitFor({ state: 'visible', timeout: this.config.navigationTimeoutMs });
    } catch {
      throw new AppError(
        'SELECTOR_NOT_FOUND',
        'Chat composer (#prompt-textarea) not found — is the Chatbot URL the chat UI / are you logged in?',
        502,
      );
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
