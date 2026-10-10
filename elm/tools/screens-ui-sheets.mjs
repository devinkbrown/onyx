// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-ui-sheets.mjs — extra screens.mjs scenarios that open every
 * overlay the v3/ui-sheets slice owns (sheets, dialogs, popovers).
 *
 *   node elm/tools/screens.mjs --extra elm/tools/screens-ui-sheets.mjs \
 *     --out /tmp/onyx-sheets [--only sheet-prefs,sheet-notify]
 *
 * Each scenario joins #lounge on the local fake IRC server. A few need
 * server state the fake server does not seed (channel op, IRC oper, a
 * logged-in account, an incoming DM); those route the page WebSocket
 * through Playwright (`routeWebSocket`) and inject the extra server
 * lines, so nothing here edits screens.mjs or touches the network.
 */

const NET = 'onyx.test';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

/** Join #lounge with the socket proxied; returns `inject(...lines)`.
    Phone runs present as an iPhone 15 (Safari UA on top of the
    390x844 / DPR 3 / touch context screens.mjs creates). */
async function boot(page, h, opts = {}) {
  if ((page.viewportSize() || { width: 1440 }).width < 768) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }).catch(() => {});
  }
  let client = null;
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
  });
  await h.joinRoom(page, opts.nick || 'kn', opts.room === undefined ? '#lounge' : opts.room);
  const inject = async (...lines) => {
    for (const l of lines) if (client) client.send(l);
    await h.settle(page, 400);
  };
  if (opts.op) await inject(`:mara!m@${NET} MODE #lounge +o kn`);
  if (opts.oper) await inject(`:${NET} 381 kn :You are now an IRC operator`);
  return inject;
}

/** Run a palette action by query (Ctrl+K, type, Enter). */
async function palette(page, h, query) {
  await page.keyboard.press('Control+k');
  await h.settle(page, 250);
  await page.keyboard.type(query);
  await h.settle(page, 150);
  await page.keyboard.press('Enter');
  await h.settle(page, 500);
}

/** Type a slash command in the composer and send it (Enter twice when
    the first Enter only accepts the command suggestion). */
async function slash(page, h, line) {
  const box = '.onyx-composer textarea, .onyx-composer input';
  await page.fill(box, line);
  await h.settle(page, 150);
  await page.keyboard.press('Enter');
  await h.settle(page, 300);
  const left = await page.$eval(box, (el) => el.value).catch(() => '');
  if (left && left.trim()) { await page.keyboard.press('Enter'); await h.settle(page, 400); }
}

async function youEntry(page, h, testId) {
  await h.tryClick(page, '[data-testid="you-open"]');
  await h.tryClick(page, `[data-testid="${testId}"]`);
  await h.settle(page, 300);
}

async function roomMore(page, h, label) {
  await h.tryClick(page, '[data-testid="room-more"]');
  await h.tryClick(page, `[data-testid="room-more-menu"] button:has-text("${label}")`);
}

/** Scroll the open sheet panel to its end (phone shots of long sheets). */
async function scrollSheet(page, h) {
  await page.evaluate(() => {
    const panels = document.querySelectorAll('[data-shortcut-scope]');
    const top = panels[panels.length - 1];
    if (top) top.scrollTop = top.scrollHeight;
  });
  await h.settle(page, 200);
}

export default {
  'sheet-you': async (page, h) => { await boot(page, h); await h.tryClick(page, '[data-testid="you-open"]'); },
  'sheet-you-end': async (page, h) => { await boot(page, h); await h.tryClick(page, '[data-testid="you-open"]'); await scrollSheet(page, h); },
  'sheet-inbox': async (page, h) => { await boot(page, h); await h.tryClick(page, '[data-testid="inbox-bell"]'); },
  'sheet-palette': async (page, h) => { await boot(page, h); await page.keyboard.press('Control+k'); await h.settle(page); },
  'sheet-palette-query': async (page, h) => { await boot(page, h); await page.keyboard.press('Control+k'); await h.settle(page, 200); await page.keyboard.type('ro'); await h.settle(page); },
  'sheet-shortcuts': async (page, h) => { await boot(page, h); await palette(page, h, 'keyboard shortcuts'); },
  'sheet-prefs': async (page, h) => { await boot(page, h); await youEntry(page, h, 'you-settings-open-preferences'); },
  'sheet-notify': async (page, h) => { await boot(page, h); await palette(page, h, 'Notifications'); },
  'sheet-guest-claim': async (page, h) => { await boot(page, h); await h.tryClick(page, '[data-testid="guest-claim-open"]'); },
  'sheet-account': async (page, h) => {
    const inject = await boot(page, h);
    await inject(`:${NET} 900 kn kn!u@${NET} kn :You are now logged in as kn`);
    await youEntry(page, h, 'you-open-account');
  },
  'sheet-reclaim': async (page, h) => {
    const inject = await boot(page, h);
    await inject(`:${NET} 900 kn kn!u@${NET} kain :You are now logged in as kain`);
    await h.tryClick(page, 'button[aria-label^="Reclaim the nick"]');
  },
  'sheet-people': async (page, h) => { await boot(page, h); await youEntry(page, h, 'you-open-people'); },
  'sheet-theme-share': async (page, h) => { await boot(page, h); await youEntry(page, h, 'you-open-theme-share'); },
  'sheet-room-settings': async (page, h) => { await boot(page, h, { op: true }); await roomMore(page, h, 'Room settings'); },
  'sheet-new-message': async (page, h) => { await boot(page, h); await palette(page, h, 'New conversation'); },
  'sheet-browse': async (page, h) => { await boot(page, h); await palette(page, h, 'Browse rooms'); await h.settle(page, 400); },
  'sheet-formation': async (page, h) => { await boot(page, h); await palette(page, h, 'Start a room'); },
  'sheet-profile': async (page, h) => { await boot(page, h); await slash(page, h, '/whois mara'); },
  'sheet-profile-whois': async (page, h) => {
    await boot(page, h);
    await h.tryClick(page, '.onyx-roster button:has-text("Profile")');
  },
  'sheet-member-card': async (page, h) => {
    await boot(page, h);
    // The roster is hidden on phones; click its (unrendered) entry so
    // the same card opens there too.
    await page.evaluate(() => {
      const b = document.querySelector('.onyx-roster button[aria-label="View member card for mara"]');
      if (b) b.click();
    });
    await h.settle(page, 400);
  },
  'sheet-voice': async (page, h) => { await boot(page, h); await youEntry(page, h, 'you-open-voice-settings'); },
  'sheet-moddesk': async (page, h) => { await boot(page, h, { op: true }); await h.tryClick(page, '[data-testid="room-more"]'); await h.tryClick(page, '[data-testid="moderation-open"]'); },
  'sheet-oper': async (page, h) => { await boot(page, h, { oper: true }); await h.tryClick(page, '[data-testid="oper-desk-open"]'); },
  'sheet-dm-safety': async (page, h) => {
    const inject = await boot(page, h);
    await inject(`@time=${new Date().toISOString()};msgid=d1 :mara!m@${NET} PRIVMSG kn :hey, got a sec?`);
    await palette(page, h, 'DM with mara');
    await h.tryClick(page, '.onyx-dmsafe-trigger');
  },
  'sheet-scheduled': async (page, h) => {
    await boot(page, h);
    await page.fill('.onyx-composer textarea, .onyx-composer input', 'see you at six');
    await h.tryClick(page, '[data-testid="composer-more-tools"]');
    await h.tryClick(page, '[data-testid="composer-schedule"]');
    await h.tryClick(page, '.onyx-schedule-view');
  },
  'sheet-steward': async (page, h) => { await boot(page, h, { op: true }); await h.tryClick(page, '[data-testid="steward-open"]'); },
  'sheet-invite': async (page, h) => { await boot(page, h); await h.tryClick(page, '[data-testid="room-invite-friends"]'); },
  'sheet-jump-date': async (page, h) => { await boot(page, h); await palette(page, h, 'Jump to date'); },
  // Phone: hold a finger 260px into a swipe-down on the Notifications
  // sheet (the sheet follows, the veil thins). Desktop: the plain sheet.
  'sheet-swipe-drag': async (page, h) => {
    await boot(page, h);
    await palette(page, h, 'Notifications');
    if ((page.viewportSize() || { width: 1440 }).width >= 768) return;
    const box = await page.locator('[data-testid="notify-sheet"]').boundingBox();
    if (!box) return;
    const cdp = await page.context().newCDPSession(page);
    const x = Math.round(box.x + box.width / 2);
    const y0 = Math.round(box.y + 40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + i * 13 }] });
      await page.waitForTimeout(16);
    }
    await h.settle(page, 150);
  },
  'sheet-first-run-notify': async (page, h) => {
    await boot(page, h);
    await slash(page, h, 'hello everyone');
    await h.settle(page, 400);
  },
  // Phone: the iOS keyboard is open (simulated: --kb-inset / --vvh as
  // the shell's visualViewport listener sets them, plus a grey block
  // where the keyboard would be). The sheet must sit above it.
  'sheet-keyboard': async (page, h) => {
    await boot(page, h);
    await palette(page, h, 'New conversation');
    await page.keyboard.type('mar');
    if ((page.viewportSize() || { width: 1440 }).width >= 768) return;
    await page.evaluate(() => {
      const kb = 336;
      document.documentElement.style.setProperty('--kb-inset', kb + 'px');
      document.documentElement.style.setProperty('--vvh', (window.innerHeight - kb) + 'px');
      const pad = document.createElement('div');
      pad.setAttribute('aria-hidden', 'true');
      pad.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:' + kb + 'px;background:#3a3f47;z-index:2147483647;display:grid;place-items:center;color:#cfd3d8;font:600 15px system-ui';
      pad.textContent = 'iOS keyboard (simulated)';
      document.body.appendChild(pad);
    });
    await h.settle(page, 300);
  },
  'sheet-toast': async (page, h) => {
    await boot(page, h);
    await slash(page, h, '/notify mute');
    await h.settle(page, 300);
  },
};
