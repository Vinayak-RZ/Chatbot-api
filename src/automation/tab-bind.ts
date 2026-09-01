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
