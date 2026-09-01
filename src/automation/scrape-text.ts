/** Chrome labels on assistant action rows (copy / dislike / share / …). */
const ACTION_LINE =
  /^(Copy|Copied|Dislike|Like|Share|Regenerate|More|Good response|Bad response|Read aloud|Stop generating|Continue generating)$/i;

/**
 * Strip toolbar labels and the user prompt if the turn container included both bubbles.
 */
export function cleanAssistantText(raw: string, prompt = ''): string {
  let t = raw.replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();
  if (!t) return '';

  t = t
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !ACTION_LINE.test(line))
    .join('\n')
    .trim();

  const p = prompt.trim();
  if (p) {
    if (t === p) return '';
    const prefix = p + '\n';
    if (t.startsWith(prefix)) t = t.slice(prefix.length).trim();
  }
  return t;
}

export type ScrapeSource = 'author-role' | 'copy-button' | 'action-row' | 'none';

export type ScrapeProbe = {
  raw: string;
  source: ScrapeSource;
  copyButtons: number;
  assistantRoleNodes: number;
  actionRows: number;
};

export function scrapeTimeoutHint(probe: {
  source: ScrapeSource;
  copyButtons: number;
  assistantRoleNodes: number;
  actionRows: number;
  scrapedChars: number;
  textChanged: boolean;
  firstTokenSeen: boolean;
  stopVisible: boolean;
}): string {
  if (probe.assistantRoleNodes === 0 && probe.copyButtons === 0 && probe.actionRows === 0) {
    return (
      'No assistant landmarks on this tab: no [data-message-author-role="assistant"], no Copy button, ' +
      'and no 4–6 button action row under a reply. The reply may be on screen but this scrape cannot see it.'
    );
  }
  if (!probe.firstTokenSeen && probe.scrapedChars === 0) {
    return (
      'Never saw a new assistant turn after submit (no Stop, no extra Copy/action row, scrape stayed empty). ' +
      'Either generation did not start, or the reply markup does not match.'
    );
  }
  if (probe.scrapedChars === 0) {
    return 'Found some chat chrome (Copy/action row or role nodes) but extracted 0 characters of assistant text.';
  }
  if (!probe.textChanged) {
    return (
      'Scrape still equals the previous assistant text — the new reply was not picked up (likely still reading an older turn).'
    );
  }
  if (probe.stopVisible) {
    return 'Stop is still visible; generation did not finish before GENERATION_TIMEOUT_MS.';
  }
  return 'Assistant text never stayed stable for 3 polls before GENERATION_TIMEOUT_MS (still streaming, or scrape flickering).';
}

/**
 * Runs in the page. Self-contained for Playwright evaluate().
 * Prefer role nodes, then labeled Copy, then the last icon action row (copy/dislike/share/regenerate/more).
 */
export function extractLastAssistantProbe(): ScrapeProbe {
  function isButton(el: Element): boolean {
    return el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
  }

  function buttonLabel(el: Element): string {
    const aria = (el.getAttribute('aria-label') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const testid = (el.getAttribute('data-testid') || '').trim();
    const svgTitle = (el.querySelector('title')?.textContent || '').trim();
    return `${aria} ${title} ${testid} ${svgTitle}`.trim();
  }

  function isCopyButton(el: Element): boolean {
    if (!isButton(el)) return false;
    const testid = (el.getAttribute('data-testid') || '').toLowerCase();
    const blob = buttonLabel(el).toLowerCase();
    if (testid.includes('copy-turn') || testid === 'copy-button' || /(^|[-_])copy($|[-_])/.test(testid)) {
      return true;
    }
    return /\bcopy(\s+to\s+clipboard)?\b/i.test(blob);
  }

  function textWithoutButtons(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button, [role="button"]').forEach((b) => b.remove());
    return (clone.innerText || '').trim();
  }

  function turnRoot(from: Element): HTMLElement {
    const tagged =
      from.closest('[data-message-author-role="assistant"]') ||
      from.closest('article') ||
      from.closest('[data-testid*="conversation-turn"]');
    if (tagged) return tagged as HTMLElement;

    let cur: HTMLElement | null = from.parentElement;
    for (let i = 0; i < 8 && cur; i++) {
      if (textWithoutButtons(cur).length > 8) return cur;
      cur = cur.parentElement;
    }
    return (from.parentElement as HTMLElement) || (from as HTMLElement);
  }

  const roleNodes = document.querySelectorAll('[data-message-author-role="assistant"]');
  const copyButtons = [...document.querySelectorAll('button, [role="button"]')].filter(isCopyButton);

  const actionRows: HTMLElement[] = [];
  for (const el of document.querySelectorAll('div, footer, nav, span, ul')) {
    const host = el as HTMLElement;
    const nested = [...host.querySelectorAll('button, [role="button"]')];
    const direct = [...host.querySelectorAll(':scope > button, :scope > [role="button"]')];
    const buttons = direct.length >= 4 ? direct : nested;
    if (buttons.length < 4 || buttons.length > 8) continue;
    if (textWithoutButtons(host).length > 40) continue;
    actionRows.push(host);
  }

  const empty = (): ScrapeProbe => ({
    raw: '',
    source: 'none',
    copyButtons: copyButtons.length,
    assistantRoleNodes: roleNodes.length,
    actionRows: actionRows.length,
  });

  if (roleNodes.length > 0) {
    const last = roleNodes[roleNodes.length - 1] as HTMLElement;
    const prose = last.querySelector('.markdown.prose, .markdown, [class*="prose"]') as HTMLElement | null;
    return {
      raw: (prose || last).innerText || '',
      source: 'author-role',
      copyButtons: copyButtons.length,
      assistantRoleNodes: roleNodes.length,
      actionRows: actionRows.length,
    };
  }

  if (copyButtons.length > 0) {
    const lastCopy = copyButtons[copyButtons.length - 1];
    if (!lastCopy) return empty();
    const root = turnRoot(lastCopy);
    return {
      raw: textWithoutButtons(root) || root.innerText || '',
      source: 'copy-button',
      copyButtons: copyButtons.length,
      assistantRoleNodes: roleNodes.length,
      actionRows: actionRows.length,
    };
  }

  if (actionRows.length > 0) {
    const lastRow = actionRows[actionRows.length - 1];
    if (!lastRow) return empty();
    const root = turnRoot(lastRow);
    return {
      raw: textWithoutButtons(root) || root.innerText || '',
      source: 'action-row',
      copyButtons: copyButtons.length,
      assistantRoleNodes: roleNodes.length,
      actionRows: actionRows.length,
    };
  }

  return empty();
}
