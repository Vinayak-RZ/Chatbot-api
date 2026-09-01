/**
 * Privacy-first tab targeting. Callers must not log sibling tab URLs or
 * evaluate chat selectors on pages that are not the returned bind.
 */

export type BindablePage = {
  isClosed(): boolean;
  url(): string;
};

/** Origin match; if the configured URL has a non-root path, require that prefix. */
export function urlsMatch(pageUrl: string, chatbotUrl: string): boolean {
  try {
    const page = new URL(pageUrl);
    const target = new URL(chatbotUrl);
    if (page.origin !== target.origin) return false;
    const targetPath = target.pathname === '/' ? '' : target.pathname;
    if (!targetPath) return true;
    return page.pathname === target.pathname || page.pathname.startsWith(targetPath);
  } catch {
    return pageUrl === chatbotUrl;
  }
}

export function findMatchingUrlPage<T extends BindablePage>(pages: T[], chatbotUrl: string): T | null {
  for (const page of pages) {
    if (page.isClosed()) continue;
    if (urlsMatch(page.url(), chatbotUrl)) return page;
  }
  return null;
}

/** Probe hasFocus only — no URL or chat DOM. Stops at the first focused page. */
export async function findFocusedPage<T extends { isClosed(): boolean }>(
  pages: T[],
  isFocused: (page: T) => Promise<boolean>,
): Promise<T | null> {
  for (const page of pages) {
    if (page.isClosed()) continue;
    const focused = await isFocused(page).catch(() => false);
    if (focused) return page;
  }
  return null;
}

export type PageFrontness = 'focused' | 'visible' | 'hidden';

export type FrontPageResult<T> =
  | { ok: true; page: T; reason: 'focused' | 'visible' }
  | { ok: false; reason: 'none' | 'ambiguous' };

/**
 * OS focus (`document.hasFocus`) is false as soon as the operator switches to
 * a terminal. The selected tab in a non-minimized window stays `visible`.
 * Prefer a focused tab; otherwise the unique visible content tab.
 */
export async function findFrontPage<T extends { isClosed(): boolean }>(
  pages: T[],
  probe: (page: T) => Promise<PageFrontness>,
): Promise<FrontPageResult<T>> {
  let focused: T | undefined;
  const visible: T[] = [];
  for (const page of pages) {
    if (page.isClosed()) continue;
    const state = await probe(page).catch((): PageFrontness => 'hidden');
    if (state === 'focused' && !focused) focused = page;
    if (state === 'focused' || state === 'visible') visible.push(page);
  }
  if (focused) return { ok: true, page: focused, reason: 'focused' };
  if (visible.length === 1) {
    const page = visible[0];
    if (page) return { ok: true, page, reason: 'visible' };
  }
  if (visible.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: false, reason: 'none' };
}

/** chrome://inspect and extension targets — skip without logging the URL. */
export function isInternalBrowserUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'devtools:' || u.protocol === 'chrome-extension:') return true;
    if (u.protocol === 'chrome:' || u.protocol === 'edge:') {
      return /inspect/i.test(`${u.hostname}${u.pathname}`);
    }
    return false;
  } catch {
    return false;
  }
}
