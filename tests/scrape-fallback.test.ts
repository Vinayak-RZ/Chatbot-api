import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { ChatAutomation } from '../src/automation/chat.js';
import { loadConfig } from '../src/config/env.js';

const FIXTURE = `<!doctype html>
<html>
<body>
  <main>
    <div class="thread">
      <div class="user" style="text-align:right">hello</div>
      <div class="assistant">
        <p>Hello. What do you need help with?</p>
        <div class="actions">
          <button aria-label="Copy">Copy</button>
          <button aria-label="Dislike">Dislike</button>
          <button aria-label="Share">Share</button>
          <button aria-label="Regenerate">Regenerate</button>
          <button aria-label="More">More</button>
        </div>
      </div>
    </div>
    <div id="prompt-textarea" contenteditable="true"></div>
  </main>
</body>
</html>`;

describe('scrape fallback (copy-toolbar UI, no author-role)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(FIXTURE);
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('reads the assistant reply from a labeled Copy button', async () => {
    await page.setContent(FIXTURE);
    const chat = new ChatAutomation(
      loadConfig({
        API_KEY: 'k',
        CHATBOT_URL: 'http://127.0.0.1:4173',
        ARTIFACTS_ON_ERROR: 'false',
      }),
    );
    const text = await chat.scrapeAssistant(page, 'hello');
    expect(text).toBe('Hello. What do you need help with?');
  });

  it('reads the assistant reply from an icon-only action row (no aria-label)', async () => {
    await page.setContent(`<!doctype html>
      <main>
        <div class="user">hello</div>
        <div class="assistant">
          <p>Hello. How can I help?</p>
          <div class="actions">
            <button></button><button></button><button></button><button></button><button></button>
          </div>
        </div>
        <div id="prompt-textarea" contenteditable="true"></div>
      </main>`);
    const chat = new ChatAutomation(
      loadConfig({
        API_KEY: 'k',
        CHATBOT_URL: 'http://127.0.0.1:4173',
        ARTIFACTS_ON_ERROR: 'false',
      }),
    );
    const text = await chat.scrapeAssistant(page, 'hello');
    expect(text).toBe('Hello. How can I help?');
  });
});
