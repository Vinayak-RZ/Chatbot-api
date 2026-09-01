import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  composerContains,
  insertText,
  readComposer,
  readSubmitSnapshot,
  submitComposer,
  submitSucceeded,
  waitForSubmitSuccess,
} from '../src/automation/cdp-drive.js';

const UNSTABLE = `<!doctype html>
<html>
<head>
<style>
@keyframes wobble {
  0% { transform: translateY(0); }
  50% { transform: translateY(3px); }
  100% { transform: translateY(0); }
}
#prompt-textarea {
  animation: wobble 40ms infinite linear;
  min-height: 40px;
  border: 1px solid #333;
}
#blocker {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0,0,0,0.01);
}
</style>
</head>
<body>
  <form id="composer-form">
    <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
    <button type="submit" data-testid="send-button">Send</button>
  </form>
  <div id="blocker"></div>
  <script>
    window.__submitted = [];
    document.getElementById('composer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const el = document.getElementById('prompt-textarea');
      window.__submitted.push((el && el.innerText) || '');
      el.innerText = '';
    });
  </script>
</body>
</html>`;

describe('cdp-drive on an unstable composer', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(UNSTABLE);
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('Playwright actionability click on the composer fails (overlay + animation)', async () => {
    await expect(page.locator('#prompt-textarea').click({ timeout: 800 })).rejects.toThrow();
  });

  it('insertText writes hello without click or fill', async () => {
    const ok = await insertText(page, 'hello');
    expect(ok).toBe(true);
    expect(await composerContains(page, 'hello')).toBe(true);
    expect(await readComposer(page)).toMatch(/hello/);
  });

  it('submitComposer records the prompt via evaluate click, not locator.click', async () => {
    const before = await readSubmitSnapshot(page);
    await submitComposer(page);
    const after = await readSubmitSnapshot(page);
    expect(submitSucceeded(before, after, 'hello')).toBe(true);
    const recorded = await page.evaluate(() => (window as unknown as { __submitted: string[] }).__submitted);
    expect(recorded.some((t) => t.includes('hello'))).toBe(true);
  });
});

describe('submitSucceeded', () => {
  const base = { composer: 'hello', userCount: 0, stopVisible: false };

  it('is true when the composer no longer holds the prompt', () => {
    expect(submitSucceeded(base, { ...base, composer: '' }, 'hello')).toBe(true);
  });

  it('is true when a user turn appears', () => {
    expect(submitSucceeded(base, { ...base, userCount: 1 }, 'hello')).toBe(true);
  });

  it('is false when nothing changed', () => {
    expect(submitSucceeded(base, base, 'hello')).toBe(false);
  });
});

describe('waitForSubmitSuccess', () => {
  it('is false when the composer never clears and no Stop/user bubble appears', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><div id="prompt-textarea">hello</div>');
    const before = await readSubmitSnapshot(page);
    expect(await waitForSubmitSuccess(page, before, 'hello', 200)).toBe(false);
    await browser.close();
  });
});
