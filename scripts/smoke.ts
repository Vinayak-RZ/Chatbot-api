/**
 * Quick smoke: open chatbot URL, assert composer visible.
 * Usage: npm run smoke
 * Default is a visible browser window. Set HEADLESS=true to hide it.
 */
import { chromium } from 'playwright';

const url = process.env.CHATBOT_URL || 'http://127.0.0.1:4173';
const headless = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.HEADLESS ?? 'false').toLowerCase(),
);

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
