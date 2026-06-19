// Showcase: drive the /appearance theme chips and screenshot each theme.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await page.goto(base + '/appearance', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/theme-ruri.png' });

for (const [name, file] of [[/pearl/i, 'pearl'], [/hisui/i, 'hisui'], [/kohaku/i, 'kohaku']]) {
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(750);
  await page.screenshot({ path: `/tmp/theme-${file}.png` });
}
console.log('theme shots done | errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
