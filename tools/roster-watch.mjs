// Webchat roster sampler: connects as guest and logs member-row count every 30s.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('input').first().fill('rwatch' + Math.floor(Math.random() * 9999));
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
for (let i = 0; i < 8; i++) {
  const rows = await page.locator('.shell-member-row').count();
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.shell-member-row')].map((r) => (r.getAttribute('aria-label') || '').split(',')[0]).join(' '));
  console.log(`[${new Date().toISOString().slice(11, 19)}] client roster → ${rows}: ${labels}`);
  await page.waitForTimeout(30000);
}
await browser.close();
