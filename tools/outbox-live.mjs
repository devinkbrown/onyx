// Offline-outbox live check — connect, join a room, go offline, compose a
// message (must queue + show a pending row + land in IDB), come back online,
// and verify the queued message actually delivers after auto-reconnect.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

const nick = 'obx' + Math.floor(Math.random() * 9999);
const chan = '#obx-' + Math.floor(Math.random() * 99999);
const needle = 'lantern-' + Math.floor(Math.random() * 99999);

await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('input').first().fill(nick);
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);

await page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first().fill(chan);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);

// Sever the network and wait until the client NOTICES the drop (WS close /
// ping timeout can take a while) — composing before that just rides TCP
// retransmission and never touches the outbox.
await ctx.setOffline(true);
const noticed = await page
  .waitForFunction(
    () => !/\bconnected\b/i.test(document.querySelector('.shell-ribbon')?.textContent ?? document.body.textContent ?? ''),
    { timeout: 90000, polling: 1000 },
  )
  .then(() => true)
  .catch(() => false);
console.log('client noticed the drop:', noticed);

const composer = page.locator('.shell-composer-textarea');
await composer.fill(`${needle} written while offline`);
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);

const pendingVisible = await page.locator('.shell-msg-pending').count() > 0;
const queuedRows = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('onyx-vault');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  if (!db) return -1;
  return await new Promise((res) => {
    try {
      const req = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      req.onsuccess = () => res(req.result.length);
      req.onerror = () => res(-1);
    } catch { res(-1); }
  });
});
console.log('pending row shown while offline:', pendingVisible);
console.log('outbox rows queued:', queuedRows);

// Restore the network; auto-reconnect + flush (2.5s post-connect + retries).
await ctx.setOffline(false);
await page.waitForTimeout(20000);

const after = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('onyx-vault');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  const outbox = db ? await new Promise((res) => {
    try {
      const req = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      req.onsuccess = () => res(req.result.length);
      req.onerror = () => res(-1);
    } catch { res(-1); }
  }) : -1;
  return { outbox, pendingRows: document.querySelectorAll('.shell-msg-pending').length, body: document.body.textContent ?? '' };
});
const delivered = after.body.includes(needle);
console.log('outbox after reconnect:', after.outbox);
console.log('pending rows after reconnect:', after.pendingRows);
console.log('message visible in feed:', delivered);
console.log('page errors:', errs.length ? errs : 'none');

const pass = pendingVisible && queuedRows === 1 && after.outbox === 0 && after.pendingRows === 0 && delivered && errs.length === 0;
console.log(pass ? 'OUTBOX LIVE: PASS' : 'OUTBOX LIVE: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
