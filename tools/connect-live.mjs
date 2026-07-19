// One-off LIVE connect probe — drives the Ruri connect screen against the real
// ircx.us Onyx Server node to prove the vertical slice end-to-end. Not part of the suite.
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173';
const nick = 'RuriProbe' + Math.floor(1000 + Math.random() * 8999);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errs.push('console:' + m.text()));

await page.goto(base + '/app', { waitUntil: 'networkidle' });
await page.getByPlaceholder('your-nick').fill(nick);
await page.getByRole('button', { name: 'Select ircx.us' }).click().catch(() => {});
await page.getByRole('button', { name: /Connect to ircx\.us/i }).click();

let result = 'did NOT reach connected shell within 25s';
try {
  await page.getByRole('button', { name: 'Disconnect from network' }).waitFor({ state: 'visible', timeout: 25000 });
  result = 'CONNECTED — reached registered/connected shell';
} catch {}

await page.screenshot({ path: '/tmp/connect-live.png', fullPage: false });
const status = await page.locator('[role="status"]').first().textContent().catch(() => null);
console.log(`nick=${nick} | ${result} | status="${(status || '').trim()}" | pageerrors=${errs.length ? errs.join(' || ') : 'none'}`);
await browser.close();
