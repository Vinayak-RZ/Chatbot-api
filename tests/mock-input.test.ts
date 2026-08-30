import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4173';

describe('mock input gating', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(MOCK, { waitUntil: 'domcontentloaded' });
    await page.locator('#prompt-textarea').waitFor({ state: 'visible' });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('does not enable send when only innerHTML is set', async () => {
    await page.evaluate(() => {
      (
        window as unknown as {
          __mockChat: { setComposerHtmlWithoutInput: (h: string) => void };
        }
      ).__mockChat.setComposerHtmlWithoutInput('<p>secret</p>');
    });
    const send = page.getByTestId('send-button');
    expect(await send.isVisible()).toBe(false);
  });

  it('enables send after fill (dispatches input)', async () => {
    const composer = page.locator('#prompt-textarea');
    await composer.click();
    await composer.fill('hello mock');
    const send = page.getByTestId('send-button');
    await send.waitFor({ state: 'visible', timeout: 3000 });
    expect(await send.isEnabled()).toBe(true);
  });
});
