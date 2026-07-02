// Vault live check — connect to production, join a channel, send a message,
// then verify (a) IndexedDB 'onyx-vault' has rows after the flush debounce and
// (b) rows survive a reload.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

const nick = 'vlt' + Math.floor(Math.random() * 9999);
const chan = '#vault-probe-' + Math.floor(Math.random() * 99999);

await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('input').first().fill(nick);
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);

// Join a throwaway channel via the sidebar join field (same as live-smoke).
await page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first().fill(chan);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const composer = page.locator('.shell-composer-textarea');
await composer.fill('vault check ' + nick);
await page.keyboard.press('Enter');
await page.waitForTimeout(3500); // > FLUSH_MS debounce

const readVault = () => page.evaluate(async (target) => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('onyx-vault');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  if (!db) return { ok: false, rows: -1 };
  return await new Promise((res) => {
    try {
      const tx = db.transaction('messages', 'readonly');
      const all = tx.objectStore('messages').getAll();
      all.onsuccess = () => {
        const rows = all.result.filter((r) => r.target_key === target);
        res({ ok: true, rows: rows.length, sample: rows[0]?.text ?? null });
      };
      all.onerror = () => res({ ok: false, rows: -1 });
    } catch { res({ ok: false, rows: -1 }); }
  });
}, chan.toLowerCase());

const before = await readVault();
console.log('vault rows after send:', JSON.stringify(before));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const after = await readVault();
console.log('vault rows after reload:', JSON.stringify(after));
console.log('page errors:', errs.length ? errs : 'none');
console.log(before.rows > 0 && after.rows > 0 ? 'VAULT LIVE: PASS' : 'VAULT LIVE: FAIL');

await browser.close();
