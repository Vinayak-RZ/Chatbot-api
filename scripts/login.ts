/**
 * Mint a Playwright storageState against the local mock login page.
 * Usage: MOCK_URL=http://127.0.0.1:4173 tsx scripts/login.ts
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const mockUrl = process.env.MOCK_URL || 'http://127.0.0.1:4173';
const out = path.resolve(process.env.STORAGE_STATE_PATH || './data/storage-state.json');

async function main() {
  mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch({
    headless: ['1', 'true', 'yes', 'on'].includes(
      String(process.env.HEADLESS ?? 'false').toLowerCase(),
    ),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${mockUrl}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', 'mock@example.com');
  await page.fill('#password', 'mock-password');
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/auth/login')),
    page.click('button[type="submit"]'),
  ]);
  await context.storageState({ path: out });
  console.log('Wrote storageState to', out);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
