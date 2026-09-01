import type { Locator, Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/env.js';
import { SELECTORS } from '../config/selectors.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { artifactsDir } from './browser.js';
import {
  cleanAssistantText,
  extractLastAssistantProbe,
  scrapeTimeoutHint,
  type ScrapeProbe,
} from './scrape-text.js';

export type ChatResult = {
  response: string;
  partial: boolean;
  durationMs: number;
  debug?: Record<string, unknown>;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export class ChatAutomation {
  constructor(private readonly config: AppConfig) {}

  async ensureNewChat(page: Page): Promise<void> {
    const newChat = page
      .locator(SELECTORS.createNewChat)
      .or(page.getByRole('link', { name: /new chat/i }))
      .or(page.locator(SELECTORS.legacyNewChat))
      .first();

    await page.keyboard.press('Escape').catch(() => undefined);

    try {
      await this.clickControl(newChat, 10_000);
    } catch {
      throw new AppError(
        'SELECTOR_NOT_FOUND',
        'Could not click New chat (element covered or intercepting overlay). Dismiss dialogs on that tab and retry, or POST /chat/new after the sidebar is clickable.',
        502,
      );
    }

    await page.locator(SELECTORS.userMessage).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    await page.locator(SELECTORS.assistantMessage).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    await page.locator(SELECTORS.promptTextarea).waitFor({ state: 'visible' });
  }

  /** Real Chrome often has overlays; CDP attach can also mismatch click coordinates. */
  private async clickControl(locator: Locator, timeoutMs: number): Promise<void> {
    try {
      await locator.click({ timeout: timeoutMs });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/intercepts pointer|Timeout|not visible/i.test(msg)) throw err;
    }
    await locator.click({ force: true, timeout: 3_000 }).catch(() => undefined);
    await locator.evaluate((el) => {
      if (el instanceof HTMLElement) el.click();
    });
  }

  async sendPrompt(page: Page, prompt: string, requestId: string): Promise<ChatResult> {
    const started = Date.now();
    let tracing = false;

    try {
      if (this.config.artifactsOnError) {
        await page.context().tracing.start({ screenshots: true, snapshots: true });
        tracing = true;
      }

      await this.recoverSoft(page);
      const baseline = await this.turnBaseline(page, prompt);
      logger.info(
        {
          requestId,
          baselineChars: baseline.text.length,
          baselineCopies: baseline.copies,
          baselineAssistants: baseline.assistants,
          baselineActionRows: baseline.actionRows,
          baselineSource: baseline.source,
        },
        'Scrape baseline before submit',
      );
      await this.insertPrompt(page, prompt);
      await this.submit(page);

      const wait = await this.waitForDone(page, baseline, prompt, requestId);
      const probe = await this.probeAssistant(page, prompt);
      const response = probe.text;

      if (!response) {
        const debug = this.debugSnapshot(wait, probe, baseline, Date.now() - started);
        const hint = scrapeTimeoutHint({
          source: probe.source,
          copyButtons: probe.copyButtons,
          assistantRoleNodes: probe.assistantRoleNodes,
          actionRows: probe.actionRows,
          scrapedChars: 0,
          textChanged: false,
          firstTokenSeen: wait.firstTokenSeen,
          stopVisible: wait.stopVisible,
        });
        logger.warn({ requestId, ...debug }, hint);
        throw new AppError('SELECTOR_NOT_FOUND', hint, 502, debug);
      }

      if (tracing) {
        await page.context().tracing.stop();
        tracing = false;
      }

      const result: ChatResult = {
        response,
        partial: wait.partial,
        durationMs: Date.now() - started,
      };
      if (wait.partial) {
        const debug = this.debugSnapshot(wait, probe, baseline, result.durationMs);
        const hint = scrapeTimeoutHint({
          source: probe.source,
          copyButtons: probe.copyButtons,
          assistantRoleNodes: probe.assistantRoleNodes,
          actionRows: probe.actionRows,
          scrapedChars: response.length,
          textChanged: response !== baseline.text,
          firstTokenSeen: wait.firstTokenSeen,
          stopVisible: wait.stopVisible,
        });
        logger.warn({ requestId, ...debug, hint }, 'Generation timed out');
        result.debug = { ...debug, hint };
      }

      return result;
    } catch (err) {
      if (this.config.artifactsOnError) {
        await this.captureArtifacts(page, requestId, tracing).catch(() => undefined);
        tracing = false;
      } else if (tracing) {
        await page.context().tracing.stop().catch(() => undefined);
      }
      throw err;
    }
  }

  async recoverSoft(page: Page): Promise<void> {
    const stop = page.locator(SELECTORS.stopButton);
    if (await stop.isVisible().catch(() => false)) {
      await stop.click().catch(() => undefined);
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    const composer = page.locator(SELECTORS.promptTextarea);
    if (await composer.isVisible().catch(() => false)) {
      await composer.click({ timeout: 5_000 }).catch(() => undefined);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
      await page.keyboard.press('Backspace').catch(() => undefined);
    }
  }

  async insertPrompt(page: Page, prompt: string): Promise<void> {
    const composer = page.locator(SELECTORS.promptTextarea);
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
    await composer.click();
    await composer.fill(prompt).catch(() => undefined);

    const send = page.locator(SELECTORS.sendButton);
    const ready = await send
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false);

    if (!ready || !(await send.isEnabled().catch(() => false))) {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.evaluate((text) => {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      }, prompt);
    }

    await send.waitFor({ state: 'visible', timeout: this.config.submitAckMs });
    if (!(await send.isEnabled())) {
      throw new AppError('SELECTOR_NOT_FOUND', 'Send button did not become enabled after insert', 502);
    }
  }

  async submit(page: Page): Promise<void> {
    const send = page.locator(SELECTORS.sendButton);
    if (await send.isVisible().catch(() => false)) {
      await send.click();
      return;
    }
    if (this.config.submitStrategy === 'auto') {
      await page.keyboard.press('Enter');
      return;
    }
    throw new AppError('SELECTOR_NOT_FOUND', 'Send button not found', 502);
  }

  private stopLocator(page: Page): Locator {
    return page.locator(SELECTORS.stopButton).or(page.getByRole('button', { name: /^stop( generating)?$/i }));
  }

  private async turnBaseline(
    page: Page,
    prompt: string,
  ): Promise<{
    text: string;
    copies: number;
    assistants: number;
    actionRows: number;
    source: ScrapeProbe['source'];
  }> {
    const probe = await this.probeAssistant(page, prompt);
    return {
      text: probe.text,
      copies: probe.copyButtons,
      assistants: probe.assistantRoleNodes,
      actionRows: probe.actionRows,
      source: probe.source,
    };
  }

  private get waitUnlimited(): boolean {
    return this.config.isAttach || this.config.generationTimeoutMs <= 0;
  }

  async waitForDone(
    page: Page,
    baseline: { text: string; copies: number; assistants: number; actionRows: number },
    prompt: string,
    requestId: string,
  ): Promise<{
    partial: boolean;
    firstTokenSeen: boolean;
    firstTokenMs: number | null;
    stopVisible: boolean;
    stablePolls: number;
  }> {
    const waitStarted = Date.now();
    const unlimited = this.waitUnlimited;
    const deadline = unlimited ? Number.POSITIVE_INFINITY : waitStarted + this.config.generationTimeoutMs;
    const firstTokenDeadline = unlimited
      ? Number.POSITIVE_INFINITY
      : waitStarted + this.config.firstTokenTimeoutMs;
    const stop = this.stopLocator(page);
    let firstTokenMs: number | null = null;
    let lastProgressLogAt = 0;

    if (unlimited) {
      logger.info(
        { requestId, attach: this.config.isAttach, generationTimeoutMs: this.config.generationTimeoutMs },
        'Waiting for assistant reply with no generation timeout',
      );
    }

    const snapshot = async () => {
      const probe = await this.probeAssistant(page, prompt).catch(() => null);
      const stopVisible = await stop.isVisible().catch(() => false);
      return { probe, stopVisible };
    };

    const hasProgress = async (): Promise<boolean> => {
      const { probe, stopVisible } = await snapshot();
      if (stopVisible) return true;
      if (!probe) return false;
      if (probe.copyButtons > baseline.copies) return true;
      if (probe.assistantRoleNodes > baseline.assistants) return true;
      if (probe.actionRows > baseline.actionRows) return true;
      return probe.text.length > 0 && probe.text !== baseline.text;
    };

    const logProgress = async (phase: string) => {
      const now = Date.now();
      if (lastProgressLogAt && now - lastProgressLogAt < 5000) return;
      lastProgressLogAt = now;
      const elapsedMs = now - waitStarted;
      const { probe, stopVisible } = await snapshot();
      logger.info(
        {
          requestId,
          phase,
          elapsedMs,
          firstTokenMs,
          scrapeSource: probe?.source ?? 'none',
          copyButtons: probe?.copyButtons ?? 0,
          assistantRoleNodes: probe?.assistantRoleNodes ?? 0,
          actionRows: probe?.actionRows ?? 0,
          scrapedChars: probe?.text.length ?? 0,
          baselineChars: baseline.text.length,
          textChanged: Boolean(probe && probe.text !== baseline.text),
          stopVisible,
          scrapedPreview: (probe?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        },
        'Still waiting for assistant reply to stabilize',
      );
    };

    while (Date.now() < firstTokenDeadline) {
      if (await hasProgress()) {
        firstTokenMs = Date.now() - waitStarted;
        logger.info({ requestId, firstTokenMs }, 'First token / new turn detected');
        break;
      }
      await logProgress('first-token');
      await sleep(200);
    }

    let stablePolls = 0;
    let lastText = '';
    let stopVisible = false;
    while (Date.now() < deadline) {
      stopVisible = await stop.isVisible().catch(() => false);
      const text = await this.scrapeAssistant(page, prompt).catch(() => '');

      if (!stopVisible && text.length > 0 && text !== baseline.text && text === lastText) {
        stablePolls += 1;
        if (stablePolls >= 3) {
          logger.info(
            {
              requestId,
              waitMs: Date.now() - waitStarted,
              firstTokenMs,
              scrapedChars: text.length,
              scrapedPreview: text.replace(/\s+/g, ' ').trim().slice(0, 80),
            },
            'Assistant reply stable',
          );
          return {
            partial: false,
            firstTokenSeen: firstTokenMs !== null || text !== baseline.text,
            firstTokenMs,
            stopVisible,
            stablePolls,
          };
        }
      } else {
        stablePolls = 0;
      }
      lastText = text;
      await logProgress('stabilize');
      await sleep(400);
    }

    stopVisible = await stop.isVisible().catch(() => false);
    if (stopVisible) {
      await stop.click().catch(() => undefined);
    }
    return {
      partial: true,
      firstTokenSeen: firstTokenMs !== null,
      firstTokenMs,
      stopVisible,
      stablePolls,
    };
  }

  async scrapeAssistant(page: Page, prompt = ''): Promise<string> {
    const probe = await this.probeAssistant(page, prompt);
    return probe.text;
  }

  private async probeAssistant(
    page: Page,
    prompt: string,
  ): Promise<ScrapeProbe & { text: string }> {
    const probe = await page.evaluate(extractLastAssistantProbe).catch(
      (): ScrapeProbe => ({
        raw: '',
        source: 'none',
        copyButtons: 0,
        assistantRoleNodes: 0,
        actionRows: 0,
      }),
    );
    return { ...probe, text: cleanAssistantText(probe.raw, prompt) };
  }

  private debugSnapshot(
    wait: {
      partial: boolean;
      firstTokenSeen: boolean;
      firstTokenMs: number | null;
      stopVisible: boolean;
      stablePolls: number;
    },
    probe: ScrapeProbe & { text: string },
    baseline: { text: string; copies: number; assistants: number; actionRows: number; source: string },
    durationMs: number,
  ): Record<string, unknown> {
    return {
      durationMs,
      scrapeSource: probe.source,
      copyButtons: probe.copyButtons,
      assistantRoleNodes: probe.assistantRoleNodes,
      actionRows: probe.actionRows,
      scrapedChars: probe.text.length,
      scrapedPreview: probe.text.replace(/\s+/g, ' ').trim().slice(0, 80),
      waitUnlimited: this.waitUnlimited,
      baselineChars: baseline.text.length,
      baselineCopies: baseline.copies,
      baselineActionRows: baseline.actionRows,
      textChanged: probe.text !== baseline.text,
      firstTokenSeen: wait.firstTokenSeen,
      firstTokenMs: wait.firstTokenMs,
      stopVisible: wait.stopVisible,
      stablePolls: wait.stablePolls,
      generationTimeoutMs: this.config.generationTimeoutMs,
      firstTokenTimeoutMs: this.config.firstTokenTimeoutMs,
    };
  }

  /** Count user turns — used by tests / continue verification helpers. */
  async countUserMessages(page: Page): Promise<number> {
    return page.locator(SELECTORS.userMessage).count();
  }

  async captureArtifacts(page: Page, requestId: string, tracingActive: boolean): Promise<void> {
    const dir = artifactsDir(requestId);
    await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true }).catch(() => undefined);
    const html = await page.content().catch(() => '');
    if (html) {
      writeFileSync(path.join(dir, 'page.html'), html, 'utf8');
    }
    if (tracingActive) {
      await page
        .context()
        .tracing.stop({ path: path.join(dir, 'trace.zip') })
        .catch(() => undefined);
    }
  }
}
