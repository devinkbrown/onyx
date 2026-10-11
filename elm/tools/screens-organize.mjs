// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-organize.mjs — screens.mjs scenarios for v3/gap-organize:
 * room folders, hidden rooms, closed conversations, the row menu, the
 * folder picker, saved messages, private notes, the room / DM More
 * entries, Room settings "On this device", quiet hours / notification
 * mode / smart mute, the Home "Since you left" digest + saved strip,
 * the Preferences organize group and reader mode. Re-exports the
 * shell scenarios so one --extra covers both.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-organize.mjs --only org-rooms,org-home
 */
import shell from './screens-shell.mjs';

const T = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Click the first VISIBLE element matching any selector. */
async function clickVisible(page, selectors, h, ms) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page, ms);
        return true;
      }
    }
  }
  return false;
}

/** Clear toasts left over from the fixture (they would sit over a sheet). */
async function clearToasts(page, h) {
  for (let i = 0; i < 6; i += 1) {
    const btn = await page.$('.onyx-toast__dismiss');
    if (!btn) break;
    await btn.click().catch(() => {});
    await h.settle(page, 120);
  }
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

/** A WebSocket route in front of the fake server: returns inject(lines). */
async function wire(page) {
  let client = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    client = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(String(m)));
  });
  return {
    inject: (lines) => { for (const l of lines) if (client) client.send(l); },
    drop: () => { if (client) client.close(); },
  };
}

let dbg = 0;
async function snap(page, label) {
  if (!process.env.ORG_DEBUG) return;
  dbg += 1;
  await page.screenshot({ path: `${process.env.ORG_DEBUG}/${String(dbg).padStart(2, '0')}-${label}.png` }).catch(() => {});
}

/**
 * An extra named shot inside one scenario (ORG_OUT=dir): one fixture per
 * viewport serves several screens. Throws on horizontal overflow so the
 * run reports it like screens.mjs does for the final shot.
 */
async function extra(page, label) {
  const out = process.env.ORG_OUT;
  if (!out) return;
  const { width, height } = page.viewportSize();
  // Toasts left by the steps before would sit over the surface under test.
  for (let i = 0; i < 6; i += 1) {
    const btn = await page.$('.onyx-toast__dismiss');
    if (!btn) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(120);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${out}/${label}--${width}x${height}.png` }).catch(() => {});
  if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px at ${label}`);
}

async function say(page, h, text) {
  await snap(page, 'say');
  await page.fill('#shell-composer-input', text, { timeout: 5000 });
  await page.keyboard.press('Enter');
  await h.settle(page, 500);
}

async function toList(page, h, which) {
  if (isPhone(page)) {
    await clickVisible(page, ['[data-testid="room-back"]'], h);
    // A second tap on the current tab would toggle back to the conversation.
    if (!(await page.$(`.onyx-frame[data-nav="${which}"][data-nav-drawer="true"]`))) {
      await clickVisible(page, [`.onyx-mobile-nav [data-testid="nav-${which}"]`], h);
    }
  } else {
    await clickVisible(page, [`.onyx-primary-nav [data-testid="nav-${which}"]`], h);
  }
}

async function openDm(page, h, nick, line) {
  await toList(page, h, 'messages');
  await clickVisible(page, ['[data-testid="new-conversation"]'], h);
  await snap(page, 'newmsg');
  await page.fill('#new-message-recipient', nick, { timeout: 5000 });
  await page.keyboard.press('Enter');
  await h.settle(page, 500);
  await say(page, h, line);
  await dismissAsks(page, h);
}

/** Row "…" for a conversation in the visible list. */
async function rowMore(page, h, name) {
  const rows = await page.$$('.onyx-rail li');
  for (const li of rows) {
    if (!(await li.isVisible())) continue;
    const label = await li.$eval('.onyx-rail-name', (n) => n.textContent).catch(() => '');
    if (label.trim().toLowerCase() === name.toLowerCase()) {
      await li.hover().catch(() => {});
      const more = await li.$('[data-testid="sidebar-organize-more"]');
      if (more) { await more.click().catch(() => {}); await h.settle(page, 400); return true; }
    }
  }
  return false;
}

/**
 * The organize fixture: #lounge, #design and #elm joined; DMs with jun
 * and mara; #design filed in a "Work" folder, #elm hidden; then fresh
 * lines (a mention in #design, chatter in #elm and #lounge, a DM from
 * jun) arrive while the mara DM is open, so Home has a digest.
 */
async function setup(page, h, opts = {}) {
  await page.addInitScript(() => {
    try { localStorage.setItem('onyx:preferences', JSON.stringify({ e2eeDms: false })); } catch { /* private mode */ }
  });
  const ws = await wire(page);
  await h.joinRoom(page, 'kn', '#lounge');
  await dismissAsks(page, h);
  await say(page, h, '/join #design');
  await say(page, h, '/join #elm');
  await dismissAsks(page, h);
  await openDm(page, h, 'jun', 'thanks for the release notes!');
  await openDm(page, h, 'mara', 'are we still on for 6?');
  if (opts.organize !== false) {
    await toList(page, h, 'rooms');
    if (await rowMore(page, h, '#design')) {
      await clickVisible(page, ['[data-testid="organize-move"]'], h);
      await snap(page, 'move');
      await page.fill('#organize-new-folder', 'Work', { timeout: 5000 });
      await page.keyboard.press('Enter');
      await h.settle(page, 400);
    }
    if (await rowMore(page, h, '#elm')) {
      await clickVisible(page, ['[data-testid="organize-hide"]'], h);
    }
    await dismissAsks(page, h);
  }
  ws.inject([
    `@time=${T(9)};msgid=n1 :iris!i@onyx.test PRIVMSG #design :new type scale is in — kn can you check the release headings?`,
    `@time=${T(8)};msgid=n2 :theo!t@onyx.test PRIVMSG #design :release headings look tighter now`,
    `@time=${T(7)};msgid=n3 :mara!m@onyx.test PRIVMSG #design :+1, ship the release headings`,
    `@time=${T(6)};msgid=n4 :ash!a@onyx.test PRIVMSG #elm :compiler bump landed, tests green`,
    `@time=${T(5)};msgid=n5 :nova!n@onyx.test PRIVMSG #lounge :anyone up for the voice call at 6?`,
    `@time=${T(4)};msgid=n6 :kip!k@onyx.test PRIVMSG #lounge :voice call works for me`,
    `@time=${T(3)};msgid=n7 :jun!j@onyx.test PRIVMSG kn :got a minute for the release notes?`,
  ]);
  await h.settle(page, 700);
  await clearToasts(page, h);
  return ws;
}

async function openRoom(page, h, name) {
  await toList(page, h, 'rooms');
  await page.mouse.move(5, 5);
  for (const el of await page.$$('.onyx-rail-item')) {
    if (!(await el.isVisible())) continue;
    const txt = (await el.textContent()) || '';
    if (txt.toLowerCase().includes(name.toLowerCase())) { await el.click(); await h.settle(page, 500); return true; }
  }
  return false;
}

/** Save the message `fromEnd` rows from the bottom through its menu. */
async function saveRow(page, h, fromEnd) {
  const rows = await page.$$('.onyx-message');
  const row = rows[rows.length - fromEnd];
  if (!row) return;
  await row.scrollIntoViewIfNeeded();
  const touch = await page.evaluate(() => window.matchMedia('(hover: none)').matches);
  if (touch) {
    const box = await row.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 24));
  } else {
    await row.hover();
  }
  await h.settle(page, 250);
  const trigger = await row.$('.onyx-msg-menu-trigger');
  if (trigger) { await trigger.click().catch(() => {}); await h.settle(page, 300); }
  await clickVisible(page, ['[data-testid="msg-menu-save"]'], h);
  await page.keyboard.press('Escape');
}

async function homeTab(page, h) {
  await clickVisible(page, ['[data-testid="room-back"]'], h);
  await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-home"]', '.onyx-primary-nav [data-testid="nav-home"]'], h, 600);
  await page.mouse.move(5, 5);
  // Home opens at its top: scroll every scrolling ancestor back up.
  await page.evaluate(() => {
    for (let el = document.querySelector('[data-testid="home"]'); el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
  await h.settle(page, 200);
}

async function openYou(page, h) {
  await toList(page, h, 'rooms');
  await clickVisible(page, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]'], h);
}

export default {
  ...shell,
  // ---- composite scenarios (several shots per fixture; see extra()) ----
  'orgm-lists': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'rooms');
    await clickVisible(page, ['[data-testid="sidebar-hidden-toggle"]'], h);
    await page.mouse.move(700, 450);
    await extra(page, 'rooms');
    await rowMore(page, h, '#lounge');
    await extra(page, 'row-menu');
    await clickVisible(page, ['[data-testid="organize-move"]'], h);
    await extra(page, 'move');
    await dismissAsks(page, h);
    await toList(page, h, 'messages');
    await rowMore(page, h, 'jun');
    await extra(page, 'dm-menu');
    await clickVisible(page, ['[data-testid="organize-close"]'], h);
    await clickVisible(page, ['[data-testid="sidebar-closed-toggle"]'], h);
    await page.mouse.move(700, 450);
  },
  'orgm-room': async (page, h) => {
    await setup(page, h, { organize: false });
    await openRoom(page, h, '#lounge');
    await saveRow(page, h, 3);
    await saveRow(page, h, 5);
    await h.settle(page, 300);
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await extra(page, 'room-more');
    await clickVisible(page, ['[data-testid="room-more-saved"]'], h);
    await extra(page, 'saved');
    await dismissAsks(page, h);
    const card = ['[aria-label="View member card for mara"]'];
    if (!(await clickVisible(page, card, h))) {
      await clickVisible(page, ['[data-testid="members-toggle"]'], h);
      await clickVisible(page, card, h);
    }
    await snap(page, 'room-card');
    if (await clickVisible(page, ['[data-testid="member-note-add"]'], h)) {
      await snap(page, 'room-note-adding');
      await page.fill('[data-testid="member-note-input"]', 'Runs the design crit on Thursdays. Prefers async reviews.', { timeout: 5000 });
      await clickVisible(page, ['[data-testid="member-note-save"]'], h);
    }
    await extra(page, 'note');
    await clickVisible(page, ['[aria-label="Close profile for mara"]'], h);
    await dismissAsks(page, h);
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="ribbon-room-settings"]'], h, 600);
    await extra(page, 'rset');
    await dismissAsks(page, h);
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="room-more-reader"]'], h, 600);
    await page.mouse.move(5, 300);
  },
  'orgm-dm': async (page, h) => {
    await setup(page, h, { organize: false });
    await clickVisible(page, ['[data-testid="room-more"]'], h);
  },
  'orgm-home': async (page, h) => {
    const ws = await setup(page, h);
    await openRoom(page, h, '#lounge');
    await saveRow(page, h, 4);
    await homeTab(page, h);
    await extra(page, 'home');
    ws.drop();
    await h.settle(page, 900);
    await homeTab(page, h);
  },
  'orgm-prefs': async (page, h) => {
    await setup(page, h);
    await openYou(page, h);
    await clickVisible(page, ['[data-testid="shell-notifications"]'], h, 500);
    await clickVisible(page, ['[data-testid="notify-quiet-toggle"]'], h);
    await clickVisible(page, ['[data-testid="notify-preset-calm"]'], h);
    const quiet = await page.$('[data-testid="notify-quiet"]');
    if (quiet) await quiet.scrollIntoViewIfNeeded();
    await h.settle(page, 300);
    await extra(page, 'notify');
    await page.fill('[data-testid="notify-smart-words"]', 'crypto airdrop, free nitro');
    await page.fill('[data-testid="notify-smart-people"]', 'deploy-bot');
    await clickVisible(page, ['[data-testid="notify-smart-save"]'], h);
    const smart = await page.$('[data-testid="notify-smart-mute"]');
    if (smart) await smart.scrollIntoViewIfNeeded();
    await h.settle(page, 300);
    await extra(page, 'smart');
    await dismissAsks(page, h);
    await openYou(page, h);
    await clickVisible(page, ['[data-testid="you-settings-open-preferences"]'], h, 500);
    await clickVisible(page, ['#pref-category-tab-conversation'], h, 400);
    const group = await page.$('[data-testid="pref-organize"]');
    if (group) await group.scrollIntoViewIfNeeded();
    await h.settle(page, 300);
  },
  // ---- single-screen scenarios (debugging one surface) ----
  'org-rooms': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'rooms');
    await clickVisible(page, ['[data-testid="sidebar-hidden-toggle"]'], h);
    await page.mouse.move(700, 450);
  },
  'org-row-menu': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'rooms');
    await rowMore(page, h, '#lounge');
  },
  'org-move': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'rooms');
    if (await rowMore(page, h, '#lounge')) await clickVisible(page, ['[data-testid="organize-move"]'], h);
  },
  'org-dm-menu': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'messages');
    await rowMore(page, h, 'jun');
  },
  'org-closed': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'messages');
    if (await rowMore(page, h, 'jun')) await clickVisible(page, ['[data-testid="organize-close"]'], h);
    await clickVisible(page, ['[data-testid="sidebar-closed-toggle"]'], h);
    await page.mouse.move(700, 450);
  },
  'org-saved': async (page, h) => {
    await setup(page, h, { organize: false });
    await openRoom(page, h, '#lounge');
    const rows = await page.$$('.onyx-message');
    for (const idx of [rows.length - 3, rows.length - 5]) {
      const row = rows[idx];
      if (!row) continue;
      await row.scrollIntoViewIfNeeded();
      if (isPhone(page)) {
        const box = await row.boundingBox();
        await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 24));
      } else {
        await row.hover();
      }
      await h.settle(page, 250);
      const trigger = await row.$('.onyx-msg-menu-trigger');
      if (trigger) { await trigger.click().catch(() => {}); await h.settle(page, 300); }
      await clickVisible(page, ['[data-testid="msg-menu-save"]'], h);
      await page.keyboard.press('Escape');
    }
    await h.settle(page, 300);
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="room-more-saved"]'], h);
  },
  'org-note': async (page, h) => {
    await setup(page, h, { organize: false });
    await openRoom(page, h, '#lounge');
    await snap(page, 'note-room');
    const card = ['[aria-label="View member card for mara"]'];
    if (!(await clickVisible(page, card, h))) {
      await clickVisible(page, ['[data-testid="members-toggle"]'], h);
      await snap(page, 'note-members');
      await clickVisible(page, card, h);
    }
    await snap(page, 'note-card');
    if (await clickVisible(page, ['[data-testid="member-note-add"]'], h)) {
      await snap(page, 'note-adding');
      await page.fill('[data-testid="member-note-input"]', 'Runs the design crit on Thursdays. Prefers async reviews.', { timeout: 5000 });
      await clickVisible(page, ['[data-testid="member-note-save"]'], h);
    }
  },
  'org-room-more': async (page, h) => {
    await setup(page, h);
    await openRoom(page, h, '#lounge');
    await clickVisible(page, ['[data-testid="room-more"]'], h);
  },
  'org-dm-more': async (page, h) => {
    await setup(page, h, { organize: false });
    await clickVisible(page, ['[data-testid="room-more"]'], h);
  },
  'org-rset': async (page, h) => {
    await setup(page, h);
    await openRoom(page, h, '#lounge');
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="ribbon-room-settings"]'], h, 600);
  },
  'org-home': async (page, h) => {
    await setup(page, h);
    // save one message so Home shows the saved strip
    await openRoom(page, h, '#lounge');
    const rows = await page.$$('.onyx-message');
    const row = rows[rows.length - 4];
    if (row) {
      await row.scrollIntoViewIfNeeded();
      if (isPhone(page)) {
        const box = await row.boundingBox();
        await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 24));
      } else { await row.hover(); }
      await h.settle(page, 250);
      const trigger = await row.$('.onyx-msg-menu-trigger');
      if (trigger) { await trigger.click().catch(() => {}); await h.settle(page, 300); }
      await clickVisible(page, ['[data-testid="msg-menu-save"]'], h);
    }
    await clickVisible(page, ['[data-testid="room-back"]'], h);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-home"]', '.onyx-primary-nav [data-testid="nav-home"]'], h, 600);
    await page.mouse.move(5, 5);
  },
  'org-offline': async (page, h) => {
    const ws = await setup(page, h, { organize: false });
    await page.fill('#shell-composer-input', 'draft I have not sent yet');
    ws.drop();
    await h.settle(page, 900);
    await clickVisible(page, ['[data-testid="room-back"]'], h);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-home"]', '.onyx-primary-nav [data-testid="nav-home"]'], h, 600);
  },
  'org-notify': async (page, h) => {
    await setup(page, h, { organize: false });
    await toList(page, h, 'rooms');
    await clickVisible(page, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]'], h);
    await clickVisible(page, ['[data-testid="shell-notifications"]'], h, 500);
    await clickVisible(page, ['[data-testid="notify-quiet-toggle"]'], h);
    await clickVisible(page, ['[data-testid="notify-preset-calm"]'], h);
    const quiet = await page.$('[data-testid="notify-quiet"]');
    if (quiet) await quiet.scrollIntoViewIfNeeded();
    await h.settle(page, 300);
  },
  'org-smart': async (page, h) => {
    await setup(page, h, { organize: false });
    await toList(page, h, 'rooms');
    await clickVisible(page, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]'], h);
    await clickVisible(page, ['[data-testid="shell-notifications"]'], h, 500);
    await page.fill('[data-testid="notify-smart-words"]', 'crypto airdrop, free nitro');
    await page.fill('[data-testid="notify-smart-people"]', 'deploy-bot');
    await clickVisible(page, ['[data-testid="notify-smart-save"]'], h);
    const smart = await page.$('[data-testid="notify-smart-mute"]');
    if (smart) await smart.scrollIntoViewIfNeeded();
    await h.settle(page, 300);
  },
  'org-prefs': async (page, h) => {
    await setup(page, h);
    await toList(page, h, 'rooms');
    await clickVisible(page, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]'], h);
    await clickVisible(page, ['[data-testid="you-settings-open-preferences"]'], h, 500);
    await clickVisible(page, ['#pref-category-tab-conversation'], h, 400);
    const group = await page.$('[data-testid="pref-organize"]');
    if (group) await group.scrollIntoViewIfNeeded();
    await h.settle(page, 300);
  },
  'org-reader': async (page, h) => {
    await setup(page, h, { organize: false });
    await openRoom(page, h, '#lounge');
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="room-more-reader"]'], h, 600);
    await page.mouse.move(5, 300);
  },
};
