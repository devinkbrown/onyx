// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-shell.mjs — extra screens.mjs scenarios for the app frame:
 * the phone Rooms / Messages list pages, a DM, the members sheet, and
 * viewport-robust versions of the built-in you-hub / calls / browse
 * scenarios (those click the first DOM match, which is the hidden
 * desktop rail on phones).
 *
 *   node elm/tools/screens.mjs --extra elm/tools/screens-shell.mjs --only rooms-list,members
 */

/** Click the first VISIBLE element matching any selector. */
async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page);
        return true;
      }
    }
  }
  return false;
}

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Close the quiet asks (notifications, Add to Home Screen) a fresh
    session may raise, so they do not sit over the scenario. */
async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

async function join(page, h, nick, room) {
  await h.joinRoom(page, nick, room);
  await dismissAsks(page, h);
}

/** Back from a conversation to its collection (phone), else no-op. */
async function backToList(page, h) {
  if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]', '.onyx-mobile-nav [data-testid="nav-rooms"]'], h);
}

async function openDm(page, h, nick, line) {
  await backToList(page, h);
  if (!(await page.$('.onyx-frame[data-nav="messages"][data-nav-drawer="true"], .onyx-frame[data-nav="messages"][data-convo="false"]'))
    && !(!isPhone(page) && await page.$('.onyx-frame[data-nav="messages"]'))) {
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-messages"]', '.onyx-primary-nav [data-testid="nav-messages"]'], h);
  }
  await clickVisible(page, ['[data-testid="new-conversation"]'], h);
  await page.fill('#new-message-recipient', nick);
  await page.keyboard.press('Enter');
  await h.settle(page, 600);
  await page.fill('#shell-composer-input', line);
  await page.keyboard.press('Enter');
  await h.settle(page, 600);
  // A first DM raises the quiet notifications ask; dismiss it.
  await dismissAsks(page, h);
}

async function withDm(page, h) {
  // Plain DMs for the fixture: the fake server has no key directory.
  await page.addInitScript(() => {
    try { localStorage.setItem('onyx:preferences', JSON.stringify({ e2eeDms: false })); } catch { /* private mode */ }
  });
  await join(page, h);
  await openDm(page, h, 'jun', 'thanks for the release notes!');
  await openDm(page, h, 'mara', 'are we still on for 6?');
}

export default {
  'you-hub': async (page, h) => {
    await join(page, h);
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]'], h);
  },
  calls: async (page, h) => {
    await join(page, h);
    await backToList(page, h);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-calls"]', '.onyx-primary-nav [data-testid="nav-calls"]', '.onyx-calls-toggle'], h);
  },
  inbox: async (page, h) => {
    await join(page, h);
    await backToList(page, h);
    await clickVisible(page, ['.shell-ribbon-bell', '[data-testid="inbox-open"]'], h);
  },
  browse: async (page, h) => {
    await join(page, h);
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="sidebar-browse-rooms"]', 'button:has-text("Browse rooms")'], h);
    await h.settle(page, 600);
  },
  'rooms-list': async (page, h) => {
    await withDm(page, h);
    if (isPhone(page)) {
      await backToList(page, h);
      await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-rooms"]'], h);
    } else {
      await clickVisible(page, ['.onyx-primary-nav [data-testid="nav-rooms"]'], h);
      await page.mouse.move(700, 450);
    }
  },
  'messages-list': async (page, h) => {
    await withDm(page, h);
    if (isPhone(page)) await backToList(page, h);
    else await page.mouse.move(700, 450);
  },
  dm: async (page, h) => {
    await withDm(page, h);
  },
  members: async (page, h) => {
    await join(page, h);
    if (await clickVisible(page, ['[data-testid="room-members"]'], h)) {
      // phones and tablets: the members sheet
    } else {
      const row = (await page.$$('.onyx-roster .onyx-member'))[3];
      if (row) { await row.hover(); await h.settle(page, 200); }
    }
  },
  // The iOS keyboard, emulated: Safari keeps the layout viewport and
  // shrinks the visual one; ports.js then publishes these variables.
  'room-keyboard': async (page, h) => {
    await join(page, h);
    await page.focus('#shell-composer-input').catch(() => {});
    if (isPhone(page)) {
      await page.evaluate(() => {
        const r = document.documentElement;
        r.style.setProperty('--kb-inset', '336px');
        r.style.setProperty('--vv-top', '0px');
        r.style.setProperty('--vv-height', '508px');
        r.setAttribute('data-kb', 'open');
      });
      await h.settle(page, 200);
    }
  },
  'room-long-topic': async (page, h) => {
    await join(page, h, 'kn', '#design');
  },
};
