// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-account.mjs — extra screens.mjs scenarios for the
 * v3/gap-account surfaces: Account → Protection / Names, Preferences →
 * History & data (local history, clear, saved searches) and Import &
 * export (export review, staged import review), plus the tab-title
 * behaviour that has no pixels.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-account.mjs \
 *     --out /tmp/claude-1002/gap-account-shots
 *
 * The page WebSocket is routed through Playwright so the scenario can
 * play the account services (ACCOUNTINFO, ACCOUNTSET, RECOGNIZE, GROUP,
 * RECOVER) against the real client. Nothing touches a real network.
 */

const NET = 'onyx.test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

/** Join #lounge with the socket proxied; the stand-in account services
    answer the verbs this slice sends. Returns { inject, state }. */
async function boot(page, h, opts = {}) {
  if ((page.viewportSize() || { width: 1440 }).width < 768) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }).catch(() => {});
  }
  const state = {
    secure: false,
    enforce: true,
    masks: opts.masks || ['kn!*@home.example', '*!kn@*.office.example'],
    group: opts.group || [{ nick: 'kn', primary: true }, { nick: 'kn-away', primary: false }],
    seen: [],
  };
  let client = null;
  const flags = () => (state.secure ? 16 : 0) | (state.enforce ? 0 : 8);
  const reply = (line) => { if (client) client.send(line); };
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    server.onMessage((m) => ws.send(m));
    ws.onMessage((m) => {
      const line = String(m).replace(/\r?\n$/, '');
      state.seen.push(line);
      const [cmd, ...rest] = line.split(' ');
      const verb = cmd.toUpperCase();
      if (verb === 'ACCOUNTINFO') {
        reply(`:${NET} NOTICE kn :account=kn flags=${flags()} suspended=false forbidden=false noexpire=false`);
      } else if (verb === 'ACCOUNTSET' && (rest[2] === 'secure' || rest[2] === 'enforce')) {
        if (rest[1] !== 'hunter22') { reply(`:${NET} 464 kn :Password incorrect`); return; }
        state[rest[2]] = rest[3] === 'on';
        reply(`:${NET} NOTICE kn :Account kn updated (${rest[2]})`);
      } else if (verb === 'RECOGNIZE') {
        if (rest[0] === 'ADD') state.masks.push(rest[1]);
        if (rest[0] === 'DEL') state.masks = state.masks.filter((x) => x !== rest[1]);
        if (rest[0] === 'LIST') {
          if (!state.masks.length) reply(`:${NET} NOTICE kn :Recognition list for kn is empty`);
          for (const mask of state.masks) reply(`:${NET} NOTICE kn :Recognize: ${mask}`);
        } else {
          reply(`:${NET} NOTICE kn :Recognize ${rest[1]}: ${rest[0] === 'ADD' ? 'added' : 'removed'}`);
        }
      } else if (verb === 'GROUP') {
        if (rest[0] === 'LIST') {
          for (const g of state.group) reply(`:${NET} NOTICE kn :GROUP ${g.nick}${g.primary ? ' (primary)' : ''}`);
          reply(`:${NET} NOTICE kn :GROUP: end of list`);
        }
      } else if (verb === 'RECOVER') {
        reply(`:${NET} NOTICE kn :RECOVER: forced the holder off ${rest[0]}; reclaim it now`);
      } else if (verb === 'RELEASE') {
        reply(`:${NET} NOTICE kn :RELEASE: dropped the server hold on ${rest[0]}`);
      } else {
        server.send(m);
      }
    });
  });
  await h.joinRoom(page, opts.nick || 'kn', opts.room === undefined ? '#lounge' : opts.room);
  const inject = async (...lines) => {
    for (const l of lines) reply(l);
    await h.settle(page, 400);
  };
  if (opts.login) await inject(`:${NET} 900 kn kn!u@${NET} kn :You are now logged in as kn`);
  return { inject, state, reply };
}

const isPhone = (page) => (page.viewportSize() || { width: 1440 }).width < 768;

async function clickFirst(page, h, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await h.settle(page, 350);
      return true;
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

async function youEntry(page, h, testId) {
  await dismissAsks(page, h);
  if (isPhone(page)) {
    await clickFirst(page, h, ['[data-testid="room-back"]']);
    await clickFirst(page, h, ['.onyx-mobile-nav [data-testid="nav-you"]']);
  } else {
    await clickFirst(page, h, ['[data-testid="you-open"]']);
  }
  await clickFirst(page, h, [`[data-testid="${testId}"]`]);
  await h.settle(page, 300);
}

async function openAccount(page, h) {
  await youEntry(page, h, 'you-open-account');
  await h.settle(page, 500);
}

async function openPrefs(page, h, category) {
  await youEntry(page, h, 'you-settings-open-preferences');
  if (category) {
    const sel = [`[role="tab"]:has-text("${category}")`, `button:has-text("${category}")`];
    for (const s of sel) {
      if (await h.tryClick(page, s)) break;
    }
  }
  await h.settle(page, 400);
}

/** Scroll an element inside the open sheet into view. */
async function reveal(page, h, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ block: 'start' });
  }, selector);
  await h.settle(page, 300);
}

const OWNER_ROWS = `
(async () => {
  const open = indexedDB.open('onyx-vault');
  return await new Promise((res) => {
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction('messages', 'readonly');
        const all = tx.objectStore('messages').getAll();
        all.onsuccess = () => res(all.result.map((r) => ({ id: r.id, owner: r.owner || null })));
        all.onerror = () => res(null);
      } catch (e) { res(null); }
    };
    open.onerror = () => res(null);
  });
})()`;

const LONG_MASKS = [
  'a-really-long-nickname-for-testing!some-long-username-here@a-very-long-hostname.subdomain.example.org',
  '*!*@*.dynamic.customer-pool-1234567890.some-isp-with-long-names.example.net',
  'kn!*@home.example',
];
const LONG_GROUP = [
  { nick: 'kn', primary: true },
  { nick: 'a-grouped-nick-that-goes-on-and-on-and-on', primary: false },
  { nick: 'kn-away', primary: false },
];

export default {
  'ga-protect': async (page, h) => {
    await boot(page, h, { login: true });
    await openAccount(page, h);
    await reveal(page, h, '#acct-protection-title');
  },
  'ga-protect-toggled': async (page, h) => {
    await boot(page, h, { login: true });
    await openAccount(page, h);
    await page.fill('#acct-protect-password', 'hunter22');
    await h.tryClick(page, '[data-testid="account-protect-secure"]');
    await h.settle(page, 500);
    await reveal(page, h, '#acct-protection-title');
  },
  'ga-protect-wrong': async (page, h) => {
    await boot(page, h, { login: true });
    await openAccount(page, h);
    await page.fill('#acct-protect-password', 'nope-nope');
    await h.tryClick(page, '[data-testid="account-protect-enforce"]');
    await h.settle(page, 500);
    await reveal(page, h, '#acct-protection-title');
  },
  'ga-recover': async (page, h) => {
    await boot(page, h, { login: true });
    await openAccount(page, h);
    await page.fill('[data-testid="account-recover-nick"]', 'kn');
    await h.tryClick(page, '[data-testid="account-recover"]');
    await h.settle(page, 500);
    await reveal(page, h, '#acct-recover-heading');
  },
  'ga-names': async (page, h) => {
    await boot(page, h, { login: true });
    await openAccount(page, h);
    await reveal(page, h, '#acct-names-title');
  },
  'ga-history': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'History');
    await reveal(page, h, '[data-testid="pref-local-history"]');
  },
  'ga-history-confirm': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'History');
    await h.tryClick(page, '[data-testid="pref-clear-history-trigger"]');
    await reveal(page, h, '[data-testid="pref-clear-history"]');
  },
  'ga-history-cleared': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'History');
    await h.tryClick(page, '[data-testid="pref-clear-history-trigger"]');
    await h.tryClick(page, '[data-testid="pref-clear-history-confirm"]');
    await h.settle(page, 600);
    await reveal(page, h, '[data-testid="pref-clear-history"]');
  },
  'ga-history-off': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'History');
    await h.tryClick(page, '[data-testid="pref-toggle-localHistory"]');
    await h.settle(page, 600);
    await reveal(page, h, '[data-testid="pref-local-history"]');
  },
  'ga-saved-searches': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'History');
    await reveal(page, h, '[data-testid="pref-saved-searches"]');
  },
  'ga-transfer': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'Import');
    await reveal(page, h, '[data-testid="pref-vault-portable"]');
  },
  'ga-export-review': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'Import');
    await h.tryClick(page, '[data-testid="pref-vault-export"]');
    await reveal(page, h, '[data-testid="pref-vault-portable"]');
  },
  'ga-import-review': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'Import');
    const exportJson = JSON.stringify({
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-05-01T10:00:00.000Z',
      targets: [{
        target: '#lounge',
        messages: [
          { id: 'i1', from: 'mara', text: 'imported hello', type: 'msg', time: 1000 },
          { id: 'i2', from: 'jun', text: 'imported again', type: 'msg', time: 2000 },
        ],
      }],
    });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 4000 }),
      h.tryClick(page, '[data-testid="pref-vault-import"]'),
    ]);
    await chooser.setFiles({ name: 'vault.json', mimeType: 'application/json', buffer: Buffer.from(exportJson) });
    await h.settle(page, 600);
    await reveal(page, h, '[data-testid="pref-vault-portable"]');
  },
  'ga-transfer-searches': async (page, h) => {
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'Import');
    await reveal(page, h, '[data-testid="pref-saved-searches-transfer"]');
  },
  // Not visual: the document title carries the attention count.
  'ga-title-attention': async (page, h) => {
    const { inject } = await boot(page, h);
    await inject(`@time=${new Date().toISOString()};msgid=d9 :mara!m@${NET} PRIVMSG kn :hey, got a sec?`);
    await inject(`@time=${new Date().toISOString()};msgid=d10 :sol!s@${NET} PRIVMSG #lounge :kn are you around?`);
    const title = await page.title();
    if (!/^\(\d+\) /.test(title)) throw new Error(`title lacks the attention count: ${title}`);
  },
  // Not visual: vault rows written under a guest scope carry their owner.
  'ga-vault-owner': async (page, h) => {
    await boot(page, h);
    await h.settle(page, 1500);
    const rows = await page.evaluate(OWNER_ROWS);
    if (rows && rows.some((r) => r.owner === null)) throw new Error('vault holds ownerless rows');
  },
  'ga-names-long': async (page, h) => {
    await boot(page, h, { login: true, masks: LONG_MASKS, group: LONG_GROUP });
    await openAccount(page, h);
    await reveal(page, h, '#acct-names-title');
  },
  // Browser zoom 200% on a laptop is a 640x360 viewport.
  'ga-zoom-protect': async (page, h) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await boot(page, h, { login: true });
    await openAccount(page, h);
    await reveal(page, h, '#acct-protection-title');
  },
  'ga-zoom-history': async (page, h) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await boot(page, h, { login: true });
    await openPrefs(page, h, 'History');
    await reveal(page, h, '[data-testid="pref-local-history"]');
  },
};
