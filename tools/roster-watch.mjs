// Webchat roster sampler: connects as guest and logs member-row count every 30s.
import { chromium } from '@playwright/test';

const origin = process.env.ONYX_ORIGIN ?? 'https://eshmaki.me';
const nick = `rwatch${Math.floor(Math.random() * 100_000)}`;
const browser = await chromium.launch();
const page = await (await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
})).newPage();
await page.goto(`${origin}/app/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByPlaceholder('your-nick').fill(nick);
await page.getByPlaceholder('#root').fill('#root');
await page.getByRole('button', { name: 'Connect to Onyx as a guest' }).click();
await page.locator('.shell-member-row').first().waitFor({ state: 'visible', timeout: 45_000 });
for (let i = 0; i < 8; i++) {
  const rows = await page.locator('.shell-member-row').count();
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.shell-member-row')].map((r) => (r.getAttribute('aria-label') || '').split(',')[0]).join(' '));
  console.log(`[${new Date().toISOString().slice(11, 19)}] client roster → ${rows}: ${labels}`);
  await page.waitForTimeout(30000);
}
await browser.close();
