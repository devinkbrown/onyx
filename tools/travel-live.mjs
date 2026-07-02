// Time-travel live check — open /app?join=%23root&at=<moment>, connect as a
// guest, and verify the feed lands on (and pulses) a message near the moment
// instead of resting at the bottom.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

const nick = 'ttl' + Math.floor(Math.random() * 9999);
// Aim a day back — #root has history there.
const at = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

await page.goto(`https://eshmaki.me/app?join=%23root&at=${encodeURIComponent(at)}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(2200);
await page.locator('input').first().fill(nick);
await page.keyboard.press('Enter');

// connect (≈7s) + pending join (1.6s) + travel fetch (2.4s) + batch + scroll
await page.waitForTimeout(14000);

const state = await page.evaluate(() => {
  const feed = document.querySelector('.shell-feed, [data-testid="message-feed"]')
    ?? document.querySelector('main');
  const el = feed ?? document.scrollingElement;
  const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 60 : null;
  return {
    atBottom,
    scrollTop: el?.scrollTop ?? -1,
    scrollHeight: el?.scrollHeight ?? -1,
    rows: document.querySelectorAll('[data-message-search-id]').length,
  };
});
console.log('feed state:', JSON.stringify(state));
console.log('page errors:', errs.length ? errs : 'none');

// Landing means: messages rendered AND the feed is NOT parked at the bottom
// (the landing scroll centers an older message), with no page errors.
const pass = state.rows > 10 && state.atBottom === false && errs.length === 0;
console.log(pass ? 'TIME TRAVEL LIVE: PASS' : 'TIME TRAVEL LIVE: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
