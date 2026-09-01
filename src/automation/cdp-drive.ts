/**
 * Drive one bound Playwright Page through CDP + in-page evaluate.
 * Never iterates other tabs. Do not use Playwright actionability click/fill.
 */
import type { CDPSession, Page } from 'playwright';
import { SELECTORS } from '../config/selectors.js';

const COMPOSER = SELECTORS.promptTextarea;

export type SubmitSnapshot = {
  composer: string;
  userCount: number;
  stopVisible: boolean;
};

async function withSession<T>(page: Page, fn: (session: CDPSession) => Promise<T>): Promise<T> {
  const session = await page.context().newCDPSession(page);
  try {
    return await fn(session);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export async function composerAttached(page: Page): Promise<boolean> {
  return page.evaluate((sel) => Boolean(document.querySelector(sel)), COMPOSER);
}

export async function readComposer(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value.replace(/\u00a0/g, ' ');
    }
    if (el instanceof HTMLElement) return (el.innerText || '').replace(/\u00a0/g, ' ');
    return '';
  }, COMPOSER);
}

export async function composerContains(page: Page, prompt: string): Promise<boolean> {
  const hay = await readComposer(page);
  return hay.includes(prompt);
}

export async function focusComposer(page: Page): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return false;
    el.focus();
    return el === document.activeElement || el.contains(document.activeElement);
  }, COMPOSER);
}

/** Focus then insertText / Input.insertText. Success = composer contains prompt. */
export async function insertText(page: Page, prompt: string): Promise<boolean> {
  if (!(await composerAttached(page))) return false;
  await focusComposer(page);

  const viaDom = await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return false;
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      desc?.set?.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value.includes(text);
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('selectAll', false);
    const typed = document.execCommand('insertText', false, text);
    if (!typed) {
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    return (el.innerText || '').replace(/\u00a0/g, ' ').includes(text);
  }, { sel: COMPOSER, text: prompt });

  if (viaDom) return true;

  await withSession(page, async (session) => {
    await session.send('Input.insertText', { text: prompt });
  });
  return composerContains(page, prompt);
}

export async function clickSend(page: Page): Promise<boolean> {
  return page.evaluate((sel) => {
    const byTest = document.querySelector(sel);
    let btn: Element | null = byTest;
    if (!(btn instanceof HTMLElement)) {
      btn =
        [...document.querySelectorAll('button')].find((b) =>
          /send/i.test(b.getAttribute('aria-label') || ''),
        ) ?? null;
    }
    if (!(btn instanceof HTMLElement)) return false;
    if (btn instanceof HTMLButtonElement && btn.disabled) return false;
    if (btn.hasAttribute('disabled')) return false;
    btn.click();
    return true;
  }, SELECTORS.sendButton);
}

export async function submitComposer(page: Page): Promise<{ usedSend: boolean }> {
  if (await clickSend(page)) return { usedSend: true };
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return;
    el.focus();
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
    );
    const form = el.closest('form');
    if (form instanceof HTMLFormElement) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }
  }, COMPOSER);
  return { usedSend: false };
}

export async function readSubmitSnapshot(page: Page): Promise<SubmitSnapshot> {
  return page.evaluate(
    ({ composerSel, userSel, stopSel }) => {
      const el = document.querySelector(composerSel);
      let composer = '';
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) composer = el.value;
      else if (el instanceof HTMLElement) composer = el.innerText || '';
      const userCount = document.querySelectorAll(userSel).length;
      const stop = document.querySelector(stopSel);
      const stopVisible = stop instanceof HTMLElement && !stop.hidden && stop.getAttribute('hidden') === null;
      return { composer: composer.replace(/\u00a0/g, ' '), userCount, stopVisible };
    },
    {
      composerSel: COMPOSER,
      userSel: SELECTORS.userMessage,
      stopSel: SELECTORS.stopButton,
    },
  );
}

export function submitSucceeded(before: SubmitSnapshot, after: SubmitSnapshot, prompt: string): boolean {
  if (after.stopVisible && !before.stopVisible) return true;
  if (after.userCount > before.userCount) return true;
  const beforeHas = before.composer.includes(prompt);
  const afterHas = after.composer.includes(prompt);
  if (beforeHas && !afterHas) return true;
  return false;
}

/** Poll until submitSucceeded, so a Send click that did nothing is not treated as ack. */
export async function waitForSubmitSuccess(
  page: Page,
  before: SubmitSnapshot,
  prompt: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const after = await readSubmitSnapshot(page);
    if (submitSucceeded(before, after, prompt)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function clearComposer(page: Page): Promise<void> {
  if (!(await composerAttached(page))) return;
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return;
    el.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, COMPOSER);
}
