/**
 * Quick smoke: open chatbot URL, assert composer visible.
 * Usage: MOCK running; CHATBOT_URL set; npm run smoke
 * Set HEADLESS=false for a headed window.
 */
import { chromium } from 'playwright';

const url = process.env.CHATBOT_URL || 'http://127.0.0.1:4173';
const headless = process.env.HEADLESS !== 'false';

async function main() {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#prompt-textarea').waitFor({ state: 'visible', timeout: 15_000 });
  console.log('smoke ok:', url, headless ? '(headless)' : '(headed)');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
