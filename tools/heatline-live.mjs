import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0,160)));
const nick = 'heat' + Math.floor(Math.random()*9999);
const chan = '#heat-' + Math.floor(Math.random()*99999);
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('input').first().fill(nick);
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
// Join + generate a few messages so chanstats records this hour.
await page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first().fill(chan);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const composer = page.locator('.shell-composer-textarea');
for (const t of ['first','second','third','fourth','fifth']) { await composer.fill(t + ' message'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
// chanstats flushes ~every 30s — wait then reload so the client re-fetches.
console.log('waiting for stats flush...');
await page.waitForTimeout(38000);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
// Reconnect + rejoin to view the channel again.
await page.locator('input').first().fill(nick);
await page.keyboard.press('Enter').catch(()=>{});
await page.waitForTimeout(6000);
await page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first().fill(chan).catch(()=>{});
await page.keyboard.press('Enter').catch(()=>{});
await page.waitForTimeout(4000);
const bars = await page.locator('.shell-heat-bar').count();
const live = await page.locator('.shell-heat-bar--live').count();
const now = await page.locator('.shell-heat-bar--now').count();
// Also directly confirm the stats file exists with hours.
const slugCheck = await page.evaluate(async (c) => {
  const { channelToSlug } = await import('/src/lib/stats/channelStats.ts').catch(() => ({}));
  return null; // prod build; skip
}, chan);
console.log('heat bars:', bars, '| live bars:', live, '| now:', now);
console.log('page errors:', errs.length ? errs.slice(0,3) : 'none');
const pass = bars === 24 && live >= 1 && now === 1 && errs.length === 0;
console.log(pass ? 'HEATLINE LIVE: PASS' : 'HEATLINE LIVE: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
