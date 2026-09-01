import { describe, expect, it, vi } from 'vitest';
import { findFocusedPage, findMatchingUrlPage, urlsMatch } from '../src/automation/tab-bind.js';
import { parseDevToolsActivePort } from '../src/automation/cdp-endpoint.js';

function page(url: string, closed = false) {
  const locators: string[] = [];
  return {
    url: () => url,
    isClosed: () => closed,
    locator: (sel: string) => {
      locators.push(sel);
      return { isVisible: async () => false };
    },
    locators,
  };
}

describe('urlsMatch', () => {
  it('matches origin when the configured path is /', () => {
    expect(urlsMatch('http://127.0.0.1:4173/chat', 'http://127.0.0.1:4173')).toBe(true);
    expect(urlsMatch('https://other.example/', 'http://127.0.0.1:4173')).toBe(false);
  });

  it('requires pathname prefix when CHATBOT_URL has a path', () => {
    expect(urlsMatch('http://x.test/app/thread', 'http://x.test/app')).toBe(true);
    expect(urlsMatch('http://x.test/other', 'http://x.test/app')).toBe(false);
  });
});

describe('findMatchingUrlPage', () => {
  it('returns the matching page without recording sibling URLs in the result', () => {
    const personal = page('https://mail.example/inbox');
    const target = page('http://127.0.0.1:4173/');
    const found = findMatchingUrlPage([personal, target], 'http://127.0.0.1:4173');
    expect(found).toBe(target);
    expect(personal.locators).toHaveLength(0);
    expect(target.locators).toHaveLength(0);
  });

  it('returns null when nothing matches (no composer probe)', () => {
    const personal = page('https://mail.example/inbox');
    expect(findMatchingUrlPage([personal], 'http://127.0.0.1:4173')).toBeNull();
    expect(personal.locators).toHaveLength(0);
  });
});

describe('findFocusedPage', () => {
  it('returns the first focused page and does not keep probing after a hit', async () => {
    const a = page('https://personal.example/a');
    const b = page('http://127.0.0.1:4173/');
    const c = page('https://personal.example/c');
    const probed: string[] = [];
    const found = await findFocusedPage([a, b, c], async (p) => {
      probed.push(p.url());
      return p === b;
    });
    expect(found).toBe(b);
    expect(probed).toEqual(['https://personal.example/a', 'http://127.0.0.1:4173/']);
  });
});

describe('parseDevToolsActivePort', () => {
  it('builds a ws endpoint from port and path', () => {
    expect(parseDevToolsActivePort('9222\n/devtools/browser/abc-id\n')).toBe(
      'ws://127.0.0.1:9222/devtools/browser/abc-id',
    );
  });

  it('defaults the path when only a port is present', () => {
    expect(parseDevToolsActivePort('9333')).toBe('ws://127.0.0.1:9333/devtools/browser');
  });

  it('returns null for garbage', () => {
    expect(parseDevToolsActivePort('')).toBeNull();
    expect(parseDevToolsActivePort('nope')).toBeNull();
  });
});

describe('privacy: bind helpers never query chat selectors', () => {
  it('does not call locator on any page', async () => {
    const spy = vi.fn();
    const p = { ...page('https://personal.example/'), locator: spy };
    findMatchingUrlPage([p], 'http://127.0.0.1:4173');
    await findFocusedPage([p], async () => false);
    expect(spy).not.toHaveBeenCalled();
  });
});
