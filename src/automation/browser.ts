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
import { SELECTORS } from '../config/selectors.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { inspectHint, resolveCdpEndpoint } from './cdp-endpoint.js';
import { findFocusedPage, findMatchingUrlPage, urlsMatch } from './tab-bind.js';

export class BrowserManager {
  private context: BrowserContext | null = null;
  /** Only set when attached via CDP — closing disconnects without killing Chrome. */
  private cdpBrowser: Browser | null = null;
  private relaunching = false;
  private hasAdoptedDesignatedTab = false;
  private readonly ownedPages = new WeakSet<Page>();
  private readonly adoptedPages = new WeakSet<Page>();

  constructor(private readonly config: AppConfig) {}

  get isCdp(): boolean {
    return this.config.isAttach;
  }

  get isAttach(): boolean {
    return this.config.isAttach;
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

  async newPage(opts?: { forceNew?: boolean }): Promise<Page> {
    const ctx = this.getContext();

    const canAdopt =
      this.isAttach &&
      this.config.cdpReuseTabs &&
      !opts?.forceNew &&
      !this.hasAdoptedDesignatedTab;

    if (canAdopt) {
      const adopted = await this.bindDesignatedTab();
      if (adopted) {
        this.hasAdoptedDesignatedTab = true;
        this.adoptedPages.add(adopted);
        this.context = adopted.context();
        logger.info(
          { bind: this.config.cdpAttachTab },
          this.config.cdpAttachTab === 'url'
            ? 'Bound opted-in Chatbot URL tab'
            : 'Bound focused tab',
        );
        await this.prepareAttachedPage(adopted);
        await this.ensureChatReady(adopted);
        return adopted;
      }
      if (this.config.cdpAttachTab === 'url') {
        throw new AppError(
          'BROWSER_UNAVAILABLE',
          'No open tab matches CHATBOT_URL. Focus that tab or open it, then retry. Other tabs are not inspected.',
          503,
        );
      }
      throw new AppError(
        'BROWSER_UNAVAILABLE',
        'No focused tab. Bring the ChatGPT-like tab to the front, then retry. Other tabs are not inspected.',
        503,
      );
    }

    const page = await ctx.newPage();
    this.ownedPages.add(page);
    if (this.isAttach) await this.prepareAttachedPage(page);
    await this.preparePage(page);
    return page;
  }

  async preparePage(page: Page): Promise<void> {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await this.ensureChatReady(page);
  }

  /**
   * CDP attach applies Playwright viewport emulation that makes clicks miss
   * in a real Chrome window (overlays “intercept pointer events”).
   */
  private async prepareAttachedPage(page: Page): Promise<void> {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    try {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.clearDeviceMetricsOverride');
      await session.detach().catch(() => undefined);
    } catch {
      /* not all targets support this */
    }
  }

  /** Open a page at an arbitrary URL (tests / recover). Does not require composer. */
  async newBlankPage(): Promise<Page> {
    const page = await this.getContext().newPage();
    this.ownedPages.add(page);
    return page;
  }

  async close(): Promise<void> {
    const ctx = this.context;
    const cdp = this.cdpBrowser;
    this.context = null;
    this.cdpBrowser = null;
    this.hasAdoptedDesignatedTab = false;

    if (cdp) {
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
    if (this.config.isAttach) {
      const cdpUrl = this.config.cdpUrl;
      if (!cdpUrl) {
        throw new AppError(
          'BROWSER_UNAVAILABLE',
          'CDP_URL is required when BROWSER_MODE=attach',
          503,
        );
      }
      await this.connectCdp(cdpUrl);
      return;
    }
    await this.launchPersistent();
  }

  private async connectCdp(cdpUrl: string): Promise<void> {
    logger.info({ cdp: cdpUrl }, 'Connecting to existing browser over CDP');
    const deadline = Date.now() + this.config.cdpConnectTimeoutMs;
    let lastErr: unknown;
    let browser: Browser | undefined;

    while (!browser) {
      const remaining = Math.max(1_000, deadline - Date.now());
      try {
        const endpoint = resolveCdpEndpoint(cdpUrl);
        browser = await chromium.connectOverCDP(endpoint, { timeout: remaining });
      } catch (err) {
        lastErr = err;
        if (Date.now() >= deadline) break;
        logger.warn({ cdp: cdpUrl }, `CDP connect retry. ${inspectHint(cdpUrl)}`);
        await sleep(2_000);
      }
    }

    if (!browser) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'timeout');
      throw new AppError(
        'BROWSER_UNAVAILABLE',
        `CDP connect failed (${cdpUrl}). ${inspectHint(cdpUrl)} ${msg}`,
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
      this.hasAdoptedDesignatedTab = false;
    });

    logger.info('Attached to CDP browser');
  }

  /** True if this page was an already-open tab we bound, not a tab we created. */
  wasAdopted(page: Page): boolean {
    return this.adoptedPages.has(page);
  }

  private async launchPersistent(): Promise<void> {
    const chatbotUrl = this.config.chatbotUrl;
    if (!chatbotUrl) {
      throw new AppError('BROWSER_UNAVAILABLE', 'CHATBOT_URL is required to launch a browser', 503);
    }

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
    this.ownedPages.add(keep);
    for (const p of context.pages()) {
      if (p !== keep && !p.isClosed()) {
        await p.close().catch(() => undefined);
      }
    }
    try {
      await keep.goto(chatbotUrl, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      logger.warn(
        { err },
        'Could not open Chatbot URL on launch — window stays open; retries on first request',
      );
    }
  }

  private pagesInBrowser(): Page[] {
    if (this.cdpBrowser) {
      return this.cdpBrowser.contexts().flatMap((c) => c.pages().filter((p) => !p.isClosed()));
    }
    return this.getContext().pages().filter((p) => !p.isClosed());
  }

  private async bindDesignatedTab(): Promise<Page | null> {
    const pages = this.pagesInBrowser();
    if (this.config.cdpAttachTab === 'url') {
      const target = this.config.chatbotUrl;
      if (!target) return null;
      return findMatchingUrlPage(pages, target);
    }
    return findFocusedPage(pages, (page) =>
      page.evaluate(() => document.hasFocus()).catch(() => false),
    );
  }

  private canNavigate(page: Page): boolean {
    const chatbotUrl = this.config.chatbotUrl;
    if (!chatbotUrl) return false;
    if (this.ownedPages.has(page)) return true;
    if (this.adoptedPages.has(page) && urlsMatch(page.url(), chatbotUrl)) return true;
    return false;
  }

  private async ensureChatReady(page: Page): Promise<void> {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

    const composerVisible = await page
      .locator(SELECTORS.promptTextarea)
      .isVisible()
      .catch(() => false);

    if (!composerVisible && this.canNavigate(page)) {
      const chatbotUrl = this.config.chatbotUrl;
      if (!chatbotUrl) {
        /* unreachable: canNavigate requires chatbotUrl */
      } else {
        try {
          await page.goto(chatbotUrl, { waitUntil: 'domcontentloaded' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_/i.test(msg)) {
            throw new AppError('BROWSER_UNAVAILABLE', `Cannot reach Chatbot URL: ${msg}`, 503);
          }
          throw err;
        }
      }
    }

    try {
      await page
        .locator(SELECTORS.promptTextarea)
        .waitFor({ state: 'visible', timeout: this.config.navigationTimeoutMs });
    } catch {
      throw new AppError(
        'SELECTOR_NOT_FOUND',
        'Chat composer (#prompt-textarea) not found on the designated tab — is it the chat UI / are you logged in? Other tabs were not inspected.',
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
