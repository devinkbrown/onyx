// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-people.mjs — screens.mjs scenarios for the v3/gap-people
 * slice: role-gated moderation on the member card and the room desk,
 * the read-only desk for members, the timed-block review, Room care
 * (invite / leave / handover offers), webhooks and transcript export in
 * Room settings, peer accounts from WHOX, and a 4,000-member room.
 *
 *   node elm/tools/screens.mjs --extra elm/tools/screens-gap-people.mjs \
 *     --vp all --out /tmp/claude-1002/gap-people-shots [--only gp-members-4000]
 *
 * Re-exports the elm/tools/screens-shell.mjs scenarios (screens.mjs takes
 * one --extra file). Server state the fake IRC server does not seed is
 * injected by routing the page WebSocket through Playwright
 * (`routeWebSocket`): extra lines down, WHOX rows answered locally, the
 * NAMES burst widened for the big room. Nothing edits screens.mjs or
 * touches the network.
 *
 * Note: the 4,000-member scenarios push ~8,000 server lines through
 * Playwright's WebSocket route one await at a time (~30 s), so the app's
 * own keepalive can report "NOTE page socket closed 4001 Ping timeout"
 * (the PONG queues behind the roster). That is the harness pacing, not
 * app CPU: the join's long tasks total ~1.5-3 s.
 *
 * `gp-members-4000` prints MEASURE lines (long tasks while the roster
 * paints and while typing in the composer) so a change can be compared
 * against the baseline build.
 */
import shell from './screens-shell.mjs';

const NET = 'onyx.test';
const WHOX_TOKEN = '616';

const SYL = ['ka', 'ri', 'mo', 'ne', 'su', 'ta', 'lo', 'vi', 'ze', 'pa', 'du', 'ho', 'mi', 'ra', 'en', 'ol'];
const bigNick = (i) => `${SYL[i % 16]}${SYL[(i >> 4) % 16]}${SYL[(i >> 8) % 16]}${i}`;

/** Accounts the fake WHOX answer reports: every third member, plus the
    seeded regulars (mara, jun) under their own names. */
const accountFor = (nick, i) => (nick === 'mara' || nick === 'jun' ? nick : i % 3 === 0 ? `${nick}-acct` : '0');

/** Join with the socket proxied. opts: { op, owner, oper, big, nick }.
    Returns `inject(...lines)`. */
async function boot(page, h, opts = {}) {
  let client = null;
  const nick = opts.nick || 'kn';
  let roster = [];
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    // A dropped socket shows up as "Retrying" in the shot; say why.
    ws.onClose((code, reason) => console.log(`NOTE page socket closed ${code} ${reason || ''}`));
    server.onClose((code, reason) => console.log(`NOTE fake server closed ${code} ${reason || ''}`));
    ws.onMessage((m) => {
      const line = String(m);
      const who = /^WHO (\S+) %tcnfa,(\S+)/.exec(line);
      if (who && who[2] === WHOX_TOKEN) {
        // Answer WHOX locally (the fake server only sends 315).
        roster.forEach((entry, i) => {
          const bare = entry.replace(/^[~&@%+]+/, '');
          if (bare === nick) return;
          const away = opts.big ? i % 7 === 0 : bare === 'lark' || bare === 'rue';
          const flags = (away ? 'G' : 'H') + (entry.match(/^[~&@%+]+/)?.[0] ?? '');
          ws.send(`:${NET} 354 ${nick} ${WHOX_TOKEN} ${who[1]} ${bare} ${flags} ${accountFor(bare, i)}`);
        });
      }
      // A server without WHOX support (and the pre-WHOX client) gets the
      // plain 352 roster, so the two builds process the same row count.
      const plain = /^WHO (\S+)\s*$/.exec(line);
      if (plain) {
        roster.forEach((entry, i) => {
          const bare = entry.replace(/^[~&@%+]+/, '');
          if (bare === nick) return;
          const away = opts.big ? i % 7 === 0 : bare === 'lark' || bare === 'rue';
          const flags = (away ? 'G' : 'H') + (entry.match(/^[~&@%+]+/)?.[0] ?? '');
          ws.send(`:${NET} 352 ${nick} ${plain[1]} u h ${NET} ${bare} ${flags} :0 ${bare}`);
        });
      }
      server.send(m);
    });
    server.onMessage((m) => {
      const line = String(m);
      const names = new RegExp(`^:${NET} 353 \\S+ = (\\S+) :(.*)$`).exec(line);
      if (names) {
        roster = names[2].split(' ').filter(Boolean);
        if (opts.big) {
          const extra = [];
          for (let i = 0; i < 4000; i++) extra.push((i % 97 === 0 ? '+' : '') + bigNick(i));
          roster = roster.concat(extra);
          // Real servers chunk NAMES; ~40 nicks per 353 line.
          for (let i = 0; i < roster.length; i += 40) {
            ws.send(`:${NET} 353 ${nick} = ${names[1]} :${roster.slice(i, i + 40).join(' ')}`);
          }
          return;
        }
      }
      ws.send(m);
    });
  });
  await h.joinRoom(page, nick, opts.room === undefined ? '#lounge' : opts.room);
  const inject = async (...lines) => {
    for (const l of lines) if (client) client.send(l);
    await h.settle(page, 400);
  };
  if (opts.owner) await inject(`:mara!m@${NET} MODE #lounge +q ${nick}`);
  else if (opts.op) await inject(`:mara!m@${NET} MODE #lounge +o ${nick}`);
  if (opts.oper) await inject(`:${NET} 381 ${nick} :You are now an IRC operator`);
  // Close the quiet asks (notifications, Add to Home Screen).
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 200);
  }
  return inject;
}

const isNarrow = (page) => (page.viewportSize()?.width ?? 1440) < 1100;

/** Open a member card by nick (the roster is a hidden popover on narrow
    layouts; click its entry programmatically there). */
async function openCard(page, h, who) {
  await page.evaluate((n) => {
    const b = document.querySelector(`.onyx-roster button[aria-label="View member card for ${n}"]`);
    if (b) b.click();
  }, who);
  await h.settle(page, 400);
}

async function roomMore(page, h, testId) {
  await h.tryClick(page, '[data-testid="room-more"]');
  await h.tryClick(page, `[data-testid="${testId}"]`);
  await h.settle(page, 300);
}

/** Scroll so `sel` is in view (inside whatever sheet holds it). */
async function scrollTo(page, h, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.scrollIntoView({ block: 'center' });
  }, sel);
  await h.settle(page, 250);
}

const clickJs = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

/** A select that paints blank (selectedIndex -1) is a PROBLEM: Elm's
    `value` property on a placeholder option leaves it that way. */
async function assertSelected(page, h, sel) {
  await h.settle(page, 300);
  const idx = await page.evaluate((s) => document.querySelector(s)?.selectedIndex ?? -2, sel);
  if (idx < 0) throw new Error(`select ${sel} paints blank (selectedIndex ${idx})`);
}

const readLongTasks = (page) => page.evaluate(() => {
  const t = window.__lt || [];
  window.__lt = [];
  return { count: t.length, total: Math.round(t.reduce((a, b) => a + b, 0)), max: Math.round(Math.max(0, ...t)) };
});

export default {
  ...shell,

  // Member card as a room op: role-based controls (no experience level).
  'gp-card-op': async (page, h) => {
    await boot(page, h, { op: true });
    await openCard(page, h, 'sol');
  },
  // Member card for a registered peer (account learned from WHOX).
  'gp-card-account': async (page, h) => {
    await boot(page, h);
    await openCard(page, h, 'jun');
    await page.evaluate(() => { const d = document.querySelector('.onyx-member-advanced'); if (d) d.open = true; });
    await h.settle(page, 200);
  },
  // Room desk for an op.
  'gp-desk-op': async (page, h) => {
    await boot(page, h, { op: true });
    await roomMore(page, h, 'moderation-open');
    await assertSelected(page, h, '[data-testid="desk-member-select"]');
  },
  // Read-only desk for a member.
  'gp-desk-member': async (page, h) => {
    await boot(page, h);
    await roomMore(page, h, 'moderation-open');
  },
  // Timed block staged for review.
  'gp-timed-review': async (page, h) => {
    await boot(page, h, { op: true });
    await roomMore(page, h, 'moderation-open');
    await page.fill('[data-testid="ban-add-mask"]', 'spammer!*@*');
    await page.fill('[data-testid="ban-add-minutes"]', '30');
    await clickJs(page, '[data-testid="ban-add-submit"]');
    await h.settle(page, 300);
    await scrollTo(page, h, '[data-testid="ban-add-form"]');
  },
  // A match-everyone timed block is refused before review.
  'gp-timed-everyone': async (page, h) => {
    await boot(page, h, { op: true });
    await roomMore(page, h, 'moderation-open');
    await page.fill('[data-testid="ban-add-mask"]', '*!*@*');
    await clickJs(page, '[data-testid="ban-add-submit"]');
    await h.settle(page, 300);
    await scrollTo(page, h, '[data-testid="ban-add-form"]');
  },
  // Room care as the owner: invite + leave.
  'gp-steward': async (page, h) => {
    await boot(page, h, { owner: true });
    await clickJs(page, '[data-testid="steward-open"]');
    await h.settle(page, 300);
    await assertSelected(page, h, '[data-testid="steward-successor"]');
  },
  'gp-steward-leave': async (page, h) => {
    await boot(page, h, { owner: true });
    await clickJs(page, '[data-testid="steward-open"]');
    await h.settle(page, 300);
    await clickJs(page, '[data-testid="steward-leave"]');
    await h.settle(page, 300);
    await scrollTo(page, h, '[data-testid="steward-leave-confirm"]');
  },
  // The owner offered the room to jun: the waiting state.
  'gp-transfer-offer': async (page, h) => {
    await boot(page, h, { owner: true });
    await clickJs(page, '[data-testid="steward-open"]');
    await h.settle(page, 300);
    await page.selectOption('[data-testid="steward-successor"]', 'jun').catch(() => {});
    await clickJs(page, '[data-testid="steward-offer"]');
    await h.settle(page, 300);
    await scrollTo(page, h, '[data-testid="steward-transfer-wait"]');
  },
  // mara (the owner) offers us the room over the wire: toast + inbox.
  'gp-transfer-incoming': async (page, h) => {
    const inject = await boot(page, h);
    await inject(`@+onyx/room-transfer=offer;+onyx/room=#lounge :mara!m@${NET} TAGMSG kn`);
  },
  // ... and the take view it opens.
  'gp-transfer-take': async (page, h) => {
    const inject = await boot(page, h);
    await inject(`@+onyx/room-transfer=offer;+onyx/room=#lounge :mara!m@${NET} TAGMSG kn`);
    await clickJs(page, '[data-testid="steward-open"]');
    await h.settle(page, 300);
  },
  // Room settings as an op (any room size): transcript export.
  'gp-settings': async (page, h) => {
    await boot(page, h, { op: true });
    await roomMore(page, h, 'ribbon-room-settings');
    await scrollTo(page, h, '[data-testid="chset-export"]');
  },
  // ... and webhooks under Advanced → Integrations.
  'gp-settings-webhooks': async (page, h) => {
    await boot(page, h, { op: true });
    await roomMore(page, h, 'ribbon-room-settings');
    await page.evaluate(() => { const d = document.querySelector('.rset-advanced'); if (d) d.open = true; });
    await h.settle(page, 200);
    await scrollTo(page, h, '[data-testid="chset-webhooks"]');
  },
  // 4,000 members: the roster paints a window, keeps the groups.
  'gp-members-4000': async (page, h) => {
    await page.addInitScript(() => {
      window.__lt = [];
      try {
        new window.PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true });
      } catch { /* unsupported */ }
    });
    const t0 = Date.now();
    await boot(page, h, { big: true });
    await page.waitForFunction(() => document.querySelectorAll('.onyx-roster .onyx-member').length > 50, null, { timeout: 15000 }).catch(() => {});
    const joinMs = Date.now() - t0;
    const join = await readLongTasks(page);
    const rows = await page.evaluate(() => document.querySelectorAll('.onyx-roster .onyx-member').length);
    await page.focus('#shell-composer-input').catch(() => {});
    await h.settle(page, 300);
    await readLongTasks(page);
    const k0 = Date.now();
    await page.keyboard.type('typing into a big room', { delay: 15 });
    const typeMs = Date.now() - k0;
    const typing = await readLongTasks(page);
    console.log(`MEASURE ${page.viewportSize()?.width}x${page.viewportSize()?.height} rows=${rows} join+paint=${joinMs}ms joinLongTasks=${JSON.stringify(join)} type22=${typeMs}ms typingLongTasks=${JSON.stringify(typing)}`);
    await page.fill('#shell-composer-input', '').catch(() => {});
    if (isNarrow(page)) await h.tryClick(page, '[data-testid="members-toggle"]');
    await h.settle(page, 400);
  },
  // ... scrolled to the end of the painted window ("Show more").
  'gp-members-4000-end': async (page, h) => {
    await boot(page, h, { big: true });
    await page.waitForFunction(() => document.querySelectorAll('.onyx-roster .onyx-member').length > 50, null, { timeout: 15000 }).catch(() => {});
    if (isNarrow(page)) await h.tryClick(page, '[data-testid="members-toggle"]');
    await scrollTo(page, h, '.onyx-roster-more');
  },
};
