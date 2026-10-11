// SPDX-License-Identifier: AGPL-3.0-or-later
/* global IDBObjectStore, DOMException */
/**
 * screens-gap-claim.mjs — extra screens.mjs scenarios for v3/gap-claim:
 * the Home card and the Preferences → History & data card that offer to
 * attach (or delete) history from before owner scoping.
 *
 *   node elm/tools/screens.mjs --vp se,phone,phone-land,tablet,desktop \
 *     --extra elm/tools/screens-gap-claim.mjs --out /tmp/claude-1002/gap-claim-shots
 *
 * Each scenario seeds the page's real IndexedDB vault with UNSTAMPED
 * rows (what the client wrote before scoping), then drives the real
 * client against the fake IRC server. The seeded message text is a
 * sentinel; the scenarios assert it never appears on screen. Nothing
 * touches a real network.
 */

const NET = 'onyx.test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
const SENTINEL = 'LEGACY-SECRET-TEXT';

const isPhone = (page) => (page.viewportSize() || { width: 1440 }).width < 768;

async function phoneUa(page) {
  if (isPhone(page)) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }).catch(() => {});
  }
}

/** Seed unstamped rows through the page's own IndexedDB connection (the
    client creates the database on first load). `others` stamped rows for
    other identities model a shared device. */
async function seedVault(page, { rows = 1284, targets = 17, others = 0 } = {}) {
  await page.evaluate(async ({ rows, targets, others, sentinel }) => {
    const names = ['#lounge', '#design', '#elm', '#root', '#music', '#games', '#dev', '#help', '#news', 'jun', 'mara', 'iris', 'theo', 'sol', 'ash', 'nova', 'kip', 'rue', 'lark'];
    const open = indexedDB.open('onyx-vault');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const from = Date.UTC(2026, 2, 3, 9, 0, 0);
    const to = Date.UTC(2026, 9, 8, 21, 0, 0);
    await new Promise((res, rej) => {
      const tx = db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      for (let i = 0; i < rows; i += 1) {
        const target = names[i % Math.min(targets, names.length)];
        store.put({ id: `${target}:${i}`, target, from: 'mara', body: `${sentinel} ${i}`, at: from + Math.floor(((to - from) * i) / Math.max(1, rows - 1)), deleted: false, redacted: false });
      }
      for (let i = 0; i < others; i += 1) {
        const owner = '["onyx","account","lee"]';
        store.put({ id: `${owner}\u0000#lounge:${i}`, rid: `#lounge:${i}`, owner, target: '#lounge', from: 'lee', body: 'someone else', at: to - i, deleted: false, redacted: false });
      }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    db.close();
  }, { rows, targets, others, sentinel: SENTINEL });
}

/** Raw counts straight from IndexedDB (stamped vs unstamped). */
async function vaultCounts(page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('onyx-vault');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const all = await new Promise((res, rej) => {
      const req = db.transaction('messages', 'readonly').objectStore('messages').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    const byOwner = {};
    let unstamped = 0;
    for (const r of all) {
      if (r.owner) byOwner[r.owner] = (byOwner[r.owner] || 0) + 1; else unstamped += 1;
    }
    return { total: all.length, unstamped, byOwner };
  });
}

/** Load the app once so the client creates its vault, seed it, then join. */
async function boot(page, h, opts = {}) {
  await phoneUa(page);
  const { rows, targets, others, login, nick = 'kn', room = '' , prefs } = opts;
  if (prefs) {
    await page.addInitScript((p) => { try { localStorage.setItem('onyx:preferences', JSON.stringify(p)); } catch { /* private mode */ } }, prefs);
  }
  // Plain DMs: the fixture has no key directory.
  await page.addInitScript(() => {
    try {
      const cur = JSON.parse(localStorage.getItem('onyx:preferences') || '{}');
      if (cur.e2eeDms === undefined) { cur.e2eeDms = false; localStorage.setItem('onyx:preferences', JSON.stringify(cur)); }
    } catch { /* private mode */ }
  });
  let client = null;
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    server.onMessage((m) => ws.send(m));
    ws.onMessage((m) => server.send(m));
  });
  await page.goto(`${h.base}/app?${h.pin}`);
  await h.settle(page, 700);
  await seedVault(page, { rows, targets, others });
  await h.joinRoom(page, nick, room);
  if (login) {
    if (client) client.send(`:${NET} 900 ${nick} ${nick}!u@${NET} ${nick} :You are now logged in as ${nick}`);
    await h.settle(page, 500);
  }
  // the client scans ~0.8s after its scope settles
  await h.settle(page, 1700);
}

async function clickFirst(page, h, selectors) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await h.settle(page, 350);
        return true;
      }
    }
  }
  return false;
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

async function openPrefsHistory(page, h) {
  await dismissAsks(page, h);
  if (isPhone(page)) {
    await clickFirst(page, h, ['[data-testid="room-back"]']);
    await clickFirst(page, h, ['.onyx-mobile-nav [data-testid="nav-you"]']);
  } else {
    await clickFirst(page, h, ['[data-testid="you-open"]']);
  }
  await clickFirst(page, h, ['[data-testid="you-settings-open-preferences"]']);
  for (const sel of ['[role="tab"]:has-text("History")', 'button:has-text("History & data")']) {
    if (await h.tryClick(page, sel)) break;
  }
  await h.settle(page, 400);
}

async function expectNoSecret(page) {
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes('LEGACY-SECRET')) throw new Error('legacy message text leaked into the page');
}

async function reveal(page, h, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ block: 'center' });
  }, selector);
  await h.settle(page, 300);
}

async function slowBatches(page, ms) {
  await page.evaluate((pause) => { window.OnyxPorts.gapClaim.tuning.pauseMs = pause; }, ms);
}

const HOME_CARD = '[data-testid="home-claim"]';
const PREFS_CARD = '[data-testid="pref-claim"]';

export default {
  // ---- Home card ----
  'gc-home-guest': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17 });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await reveal(page, h, HOME_CARD);
    await expectNoSecret(page);
  },
  'gc-home-account': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await reveal(page, h, HOME_CARD);
    await expectNoSecret(page);
  },
  'gc-home-shared': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true, others: 12 });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await reveal(page, h, HOME_CARD);
    await expectNoSecret(page);
  },
  'gc-home-confirm': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.click(`${HOME_CARD} [data-testid="claim-delete"]`);
    await h.settle(page, 400);
    await reveal(page, h, HOME_CARD);
  },
  'gc-home-working': async (page, h) => {
    await boot(page, h, { rows: 2400, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await slowBatches(page, 900);
    await page.click(`${HOME_CARD} [data-testid="claim-attach"]`);
    await h.settle(page, 1500);
    await reveal(page, h, HOME_CARD);
    await page.waitForSelector(`${HOME_CARD} [data-testid="claim-progress"]`, { timeout: 3000 });
  },
  'gc-home-attached': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.click(`${HOME_CARD} [data-testid="claim-attach"]`);
    await page.waitForSelector(`${HOME_CARD} [data-testid="claim-result"]`, { timeout: 12000 });
    await h.settle(page, 300);
    const counts = await vaultCounts(page);
    if (counts.unstamped !== 0) throw new Error(`rows left unstamped: ${counts.unstamped}`);
    // the pinned test endpoint is its own network, so match the account part of the scope key
    if (!Object.keys(counts.byOwner).some((k) => k.endsWith(',"account","kn"]'))) throw new Error('rows were not attached to the account scope');
    await reveal(page, h, HOME_CARD);
    await expectNoSecret(page);
  },
  'gc-home-guest-attached': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17 });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.click(`${HOME_CARD} [data-testid="claim-attach"]`);
    await page.waitForSelector(`${HOME_CARD} [data-testid="claim-result"]`, { timeout: 12000 });
    await h.settle(page, 300);
    const counts = await vaultCounts(page);
    if (!Object.keys(counts.byOwner).some((k) => k.endsWith(',"guest"]'))) throw new Error('rows were not attached to the guest scope');
    await reveal(page, h, HOME_CARD);
  },
  'gc-home-deleted': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true, others: 12 });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.click(`${HOME_CARD} [data-testid="claim-delete"]`);
    await h.settle(page, 300);
    await page.click(`${HOME_CARD} [data-testid="claim-delete-confirm"]`);
    await page.waitForSelector(`${HOME_CARD} [data-testid="claim-result"]`, { timeout: 12000 });
    await h.settle(page, 300);
    const counts = await vaultCounts(page);
    if (counts.unstamped !== 0) throw new Error(`rows left unstamped: ${counts.unstamped}`);
    if (counts.byOwner['["onyx","account","lee"]'] !== 12) throw new Error('another identity\'s rows were touched');
    await reveal(page, h, HOME_CARD);
  },
  'gc-home-failed': async (page, h) => {
    // The injected storage fault surfaces as one uncaught exception in an
    // IndexedDB request handler (that is what aborts the transaction, like
    // a real quota error). Expect exactly that; anything else still fails.
    const unexpected = [];
    page.removeAllListeners('pageerror');
    page.on('pageerror', (e) => { if (!/quota/i.test(e.message)) unexpected.push(e.message); });
    await page.addInitScript(() => {
      const orig = IDBObjectStore.prototype.put;
      let n = 0;
      IDBObjectStore.prototype.put = function put(...args) {
        if (window.__gcFail && (n += 1) > 450) throw new DOMException('quota', 'QuotaExceededError');
        return orig.apply(this, args);
      };
    });
    await boot(page, h, { rows: 1284, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.evaluate(() => { window.__gcFail = true; });
    await page.click(`${HOME_CARD} [data-testid="claim-attach"]`);
    await page.waitForSelector(`${HOME_CARD} [data-testid="claim-retry"]`, { timeout: 12000 });
    await h.settle(page, 300);
    const counts = await vaultCounts(page);
    if (counts.unstamped === 0 || counts.unstamped === 1284) throw new Error(`expected a partial attach, got ${counts.unstamped} unstamped`);
    if (unexpected.length) throw new Error(`unexpected page error: ${unexpected[0]}`);
    await reveal(page, h, HOME_CARD);
  },
  // Browser zoom 200% at a laptop viewport is a 640x360 CSS-pixel window.
  'gc-home-zoom200': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true, others: 12 });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.setViewportSize({ width: 640, height: 360 });
    await h.settle(page, 500);
    await reveal(page, h, HOME_CARD);
  },
  // A large default font size (24px root) on a phone-sized window.
  'gc-home-bigfont': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    await h.settle(page, 500);
    await reveal(page, h, HOME_CARD);
  },
  'gc-home-notnow': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await page.click(`${HOME_CARD} [data-testid="claim-not-now"]`);
    await h.settle(page, 400);
    if (await page.$(HOME_CARD)) throw new Error('the card stayed after Not now');
    const kept = await page.evaluate(() => localStorage.getItem('onyx:history-claim'));
    if (!kept || !kept.includes('dismissed')) throw new Error('Not now was not remembered');
    const counts = await vaultCounts(page);
    if (counts.unstamped !== 1284) throw new Error('Not now must not touch the rows');
    // a reload keeps it away, and the rows are still there
    await page.reload();
    await h.settle(page, 2500);
    if (await page.$(HOME_CARD)) throw new Error('the card came back after a reload');
  },
  'gc-home-history-off': async (page, h) => {
    // History opted out but rows remain (an erase that could not finish).
    await boot(page, h, { rows: 640, targets: 9, login: true, prefs: { localHistory: false, e2eeDms: false } });
    await page.waitForSelector(HOME_CARD, { timeout: 6000 });
    await reveal(page, h, HOME_CARD);
  },
  // ---- Preferences card ----
  'gc-prefs': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true, room: '#lounge' });
    await openPrefsHistory(page, h);
    await page.waitForSelector(PREFS_CARD, { timeout: 6000 });
    await reveal(page, h, PREFS_CARD);
    await expectNoSecret(page);
  },
  'gc-prefs-guest': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, room: '#lounge' });
    await openPrefsHistory(page, h);
    await page.waitForSelector(PREFS_CARD, { timeout: 6000 });
    await reveal(page, h, PREFS_CARD);
  },
  'gc-prefs-confirm': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true, room: '#lounge' });
    await openPrefsHistory(page, h);
    await page.waitForSelector(PREFS_CARD, { timeout: 6000 });
    await page.click(`${PREFS_CARD} [data-testid="claim-delete"]`);
    await h.settle(page, 400);
    await reveal(page, h, PREFS_CARD);
  },
  'gc-prefs-attached': async (page, h) => {
    await boot(page, h, { rows: 1284, targets: 17, login: true, room: '#lounge' });
    await openPrefsHistory(page, h);
    await page.waitForSelector(PREFS_CARD, { timeout: 6000 });
    await page.click(`${PREFS_CARD} [data-testid="claim-attach"]`);
    await page.waitForSelector(`${PREFS_CARD} [data-testid="claim-result"]`, { timeout: 12000 });
    await h.settle(page, 300);
    await reveal(page, h, PREFS_CARD);
  },
  'gc-prefs-clean': async (page, h) => {
    // Nothing pending: the History & data page shows no claim card.
    await boot(page, h, { rows: 0, targets: 1, login: true, room: '#lounge' });
    await openPrefsHistory(page, h);
    await h.settle(page, 500);
    if (await page.$(PREFS_CARD)) throw new Error('a claim card showed with nothing to claim');
  },
};
