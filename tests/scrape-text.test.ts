import { describe, expect, it } from 'vitest';
import { cleanAssistantText, scrapeTimeoutHint } from '../src/automation/scrape-text.js';

describe('cleanAssistantText', () => {
  it('strips copy/dislike/share/regenerate chrome and the user prompt', () => {
    const raw = [
      'hello',
      'Hello. What do you need help with?',
      'Copy',
      'Dislike',
      'Share',
      'Regenerate',
      'More',
    ].join('\n');
    expect(cleanAssistantText(raw, 'hello')).toBe('Hello. What do you need help with?');
  });

  it('keeps mock contract replies that mention the prompt', () => {
    expect(cleanAssistantText('Mock reply to: hello', 'hello')).toBe('Mock reply to: hello');
  });

  it('returns empty when only the prompt remains', () => {
    expect(cleanAssistantText('hello\nCopy', 'hello')).toBe('');
  });
});

describe('scrapeTimeoutHint', () => {
  const base = {
    source: 'none' as const,
    copyButtons: 0,
    assistantRoleNodes: 0,
    actionRows: 0,
    scrapedChars: 0,
    textChanged: false,
    firstTokenSeen: false,
    stopVisible: false,
  };

  it('explains missing landmarks', () => {
    expect(scrapeTimeoutHint(base)).toMatch(/No assistant landmarks/);
  });

  it('explains unchanged previous turn', () => {
    expect(
      scrapeTimeoutHint({
        ...base,
        source: 'action-row',
        actionRows: 2,
        scrapedChars: 40,
        firstTokenSeen: true,
        textChanged: false,
      }),
    ).toMatch(/previous assistant text/);
  });
});
