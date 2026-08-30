import type { Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/env.js';
import { SELECTORS } from '../config/selectors.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { artifactsDir } from './browser.js';

export type ChatResult = {
  response: string;
  partial: boolean;
  durationMs: number;
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

    await newChat.click({ timeout: 10_000 });
    await page.locator(SELECTORS.userMessage).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    await page.locator(SELECTORS.assistantMessage).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
    await page.locator(SELECTORS.promptTextarea).waitFor({ state: 'visible' });
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
      await this.insertPrompt(page, prompt);
      await this.submit(page);

      const wait = await this.waitForDone(page);
      const response = await this.scrapeAssistant(page);

      if (!response) {
        throw new AppError('SELECTOR_NOT_FOUND', 'No assistant message found after generation', 502);
      }

      if (tracing) {
        await page.context().tracing.stop();
        tracing = false;
      }

      return { response, partial: wait.partial, durationMs: Date.now() - started };
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

  async waitForDone(page: Page): Promise<{ partial: boolean }> {
    const deadline = Date.now() + this.config.generationTimeoutMs;
    const firstTokenDeadline = Date.now() + this.config.firstTokenTimeoutMs;
    const stop = page.locator(SELECTORS.stopButton);
    const assistants = page.locator(SELECTORS.assistantMessage);
    const baselineCount = await assistants.count();

    while (Date.now() < firstTokenDeadline) {
      const stopVisible = await stop.isVisible().catch(() => false);
      const count = await assistants.count();
      if (stopVisible || count > baselineCount) break;
      const last = assistants.last();
      if ((await last.count()) > 0) {
        const len = ((await last.innerText().catch(() => '')) || '').length;
        if (len > 0) break;
      }
      await sleep(200);
    }

    let stablePolls = 0;
    let lastText = '';
    while (Date.now() < deadline) {
      const stopVisible = await stop.isVisible().catch(() => false);
      const text = await this.scrapeAssistant(page).catch(() => '');

      if (!stopVisible && text.length > 0 && text === lastText) {
        stablePolls += 1;
        if (stablePolls >= 3) return { partial: false };
      } else {
        stablePolls = 0;
      }
      lastText = text;
      await sleep(400);
    }

    if (await stop.isVisible().catch(() => false)) {
      await stop.click().catch(() => undefined);
    }
    logger.warn('Generation timed out; returning partial scrape');
    return { partial: true };
  }

  async scrapeAssistant(page: Page): Promise<string> {
    const body = page.locator(SELECTORS.assistantBody).last();
    if ((await body.count()) > 0) {
      await body.scrollIntoViewIfNeeded().catch(() => undefined);
      return (await body.innerText()).trim();
    }
    const node = page.locator(SELECTORS.assistantMessage).last();
    if ((await node.count()) === 0) return '';
    await node.scrollIntoViewIfNeeded().catch(() => undefined);
    return (await node.innerText()).trim();
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
