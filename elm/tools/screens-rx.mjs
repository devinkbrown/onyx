// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-rx.mjs — screens.mjs scenarios for the v3/rx-shell aspect-ratio
 * pass (the app frame on every viewport). Re-exports screens-shell.mjs
 * and adds:
 *
 *   rail-menu        the sidebar row menu (⋯ / long-press / right-click)
 *   rail-mute        a DM muted from its row menu (the toast)
 *   busy             unread + mentions waiting in other rooms and a DM
 *                    while a room is open (nav totals on every form)
 *   busy-list        the same, on the collection page / sidebar
 *   busy-home        the same, on Home (the catch-up)
 *   crowd            a 64-member room with the member list open
 *   empty-rooms      the empty Rooms collection
 *   empty-messages   the empty Messages collection
 *   new-convo        New conversation from inside a room
 *   land-keyboard    a room with the on-screen keyboard up (short viewports)
 *   zoom200          a room at 200% browser zoom (half the CSS viewport)
 *   bigfont          a room with a 20px default font size
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-rx.mjs --only busy,crowd
 *
 * Server-side state the fake IRC server does not seed (extra rooms,
 * members, unread traffic) is injected through page.routeWebSocket.
 */
import shell from './screens-shell.mjs';

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 600;

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

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

/** Proxy the page's IRC socket: `rewrite` may expand each server line;
    `st.inject(line)` pushes extra server lines later. */
async function tap(page, rewrite = (l) => [l]) {
  const st = { ws: null, inject: (l) => st.ws && st.ws.send(l) };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    st.ws = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => { for (const l of rewrite(String(m))) ws.send(l); });
  });
  return st;
}

const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

/** Extra rooms joined ahead of #lounge (so #lounge stays the open one). */
const extraRooms = (nick) => [
  `:${nick}!u@onyx.test JOIN #design`,
  `:onyx.test 332 ${nick} #design :Pixels, type and taste — critique Fridays`,
  `:onyx.test 353 ${nick} = #design :${nick} mara @jun iris`,
  `:onyx.test 366 ${nick} #design :End of /NAMES list.`,
  `:${nick}!u@onyx.test JOIN #elm`,
  `:onyx.test 332 ${nick} #elm :The v3 client`,
  `:onyx.test 353 ${nick} = #elm :${nick} theo sol`,
  `:onyx.test 366 ${nick} #elm :End of /NAMES list.`,
  `:${nick}!u@onyx.test JOIN #a-room-with-a-very-long-name-that-never-ends`,
  `:onyx.test 332 ${nick} #a-room-with-a-very-long-name-that-never-ends :An extremely long topic that keeps going well past any sensible width so it has to ellipsize somewhere`,
  `:onyx.test 353 ${nick} = #a-room-with-a-very-long-name-that-never-ends :${nick} rue`,
  `:onyx.test 366 ${nick} #a-room-with-a-very-long-name-that-never-ends :End of /NAMES list.`,
];

const traffic = (nick) => [
  `@time=${iso(9)};msgid=b1 :mara!m@onyx.test PRIVMSG #design :new mockups are up in the shared folder`,
  `@time=${iso(8)};msgid=b2 :jun!j@onyx.test PRIVMSG #design :${nick}: can you check the header spacing?`,
  `@time=${iso(7)};msgid=b3 :iris!i@onyx.test PRIVMSG #design :${nick} the bottom nav badges too please`,
  ...Array.from({ length: 14 }, (_, i) => `@time=${iso(6 - i * 0.2)};msgid=e${i} :theo!t@onyx.test PRIVMSG #elm :build ${i + 1} is green`),
  `@time=${iso(3)};msgid=d1 :carol!c@onyx.test PRIVMSG ${nick} :hey, got a minute later?`,
  `@time=${iso(2)};msgid=d2 :carol!c@onyx.test PRIVMSG ${nick} :no rush`,
  `@time=${iso(1)};msgid=d3 :rue!r@onyx.test PRIVMSG #a-room-with-a-very-long-name-that-never-ends :anyone around?`,
];

async function busyJoin(page, h) {
  await page.addInitScript(() => {
    try { localStorage.setItem('onyx:preferences', JSON.stringify({ e2eeDms: false })); } catch { /* private mode */ }
  });
  const st = await tap(page, (l) => (/ JOIN #lounge$/.test(l) ? [...extraRooms('kn'), l] : [l]));
  await h.joinRoom(page);
  await dismissAsks(page, h);
  for (const l of traffic('kn')) st.inject(l);
  await h.settle(page, 700);
  await dismissAsks(page, h);
  return st;
}

const CROWD = Array.from({ length: 54 }, (_, i) => {
  const names = ['ada', 'bea', 'cal', 'dov', 'eli', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kai', 'liv', 'mo', 'nia', 'oz', 'pia', 'quin', 'ren'];
  const base = names[i % names.length];
  const nick = i < names.length ? base : `${base}${Math.floor(i / names.length) + 1}`;
  return i === 3 ? `+${nick}` : i === 7 ? `@${nick}` : i === 11 ? 'a-really-long-nickname-for-wrapping' : nick;
});

export default {
  ...shell,
  'rail-menu': async (page, h) => {
    await busyJoin(page, h);
    if (isPhone(page)) {
      await clickVisible(page, ['[data-testid="room-back"]'], h);
      await clickVisible(page, ['.onyx-rail-section--rooms [data-testid="sidebar-row-more"]'], h);
    } else {
      const rows = await page.$$('.onyx-rail-section--rooms .onyx-rail-row');
      const row = rows[1] || rows[0];
      if (row) {
        await row.hover();
        const more = await row.$('[data-testid="sidebar-row-more"]');
        if (more) await more.click();
        await h.settle(page);
      }
    }
  },
  // A DM muted from its row menu: the toast it raises, over the list.
  'rail-mute': async (page, h) => {
    await busyJoin(page, h);
    if (isPhone(page)) {
      await clickVisible(page, ['[data-testid="room-back"]'], h);
      await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-messages"]'], h);
    } else {
      await clickVisible(page, ['.onyx-primary-nav [data-testid="nav-messages"]'], h);
    }
    await clickVisible(page, ['.onyx-rail-section--dms [data-testid="sidebar-row-more"]'], h);
    await clickVisible(page, ['[data-testid="rail-menu-mute"]'], h);
  },
  busy: async (page, h) => {
    await busyJoin(page, h);
  },
  'busy-list': async (page, h) => {
    await busyJoin(page, h);
    if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]'], h);
    else await clickVisible(page, ['.onyx-primary-nav [data-testid="nav-home"]'], h);
  },
  'busy-home': async (page, h) => {
    await busyJoin(page, h);
    await clickVisible(page, ['[data-testid="room-back"]'], h);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-home"]', '.onyx-primary-nav [data-testid="nav-home"]'], h);
    await page.mouse.move(2, 2);
  },
  crowd: async (page, h) => {
    await tap(page, (l) => (/ 353 /.test(l) ? [`${l} ${CROWD.join(' ')}`] : [l]));
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await clickVisible(page, ['[data-testid="members-toggle"]'], h);
  },
  'empty-rooms': async (page, h) => {
    await h.joinRoom(page, 'kn', '');
    await dismissAsks(page, h);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-rooms"]', '.onyx-primary-nav [data-testid="nav-rooms"]'], h);
  },
  'empty-messages': async (page, h) => {
    await h.joinRoom(page, 'kn', '');
    await dismissAsks(page, h);
    await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-messages"]', '.onyx-primary-nav [data-testid="nav-messages"]'], h);
  },
  'new-convo': async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    if (!(await clickVisible(page, ['[data-testid="topbar-new-conversation"]'], h))) {
      await clickVisible(page, ['[data-testid="room-back"]'], h);
      await clickVisible(page, ['.onyx-mobile-nav [data-testid="nav-messages"]'], h);
      await clickVisible(page, ['[data-testid="new-conversation"]'], h);
    }
  },
  // The landscape keyboard, emulated (Safari keeps the layout viewport
  // and shrinks the visual one; ports.js publishes these).
  'land-keyboard': async (page, h) => {
    await busyJoin(page, h);
    await page.focus('#shell-composer-input').catch(() => {});
    const vp = page.viewportSize();
    if (vp && vp.height <= 520) {
      await page.evaluate((hgt) => {
        const r = document.documentElement;
        const kb = Math.round(hgt * 0.52);
        r.style.setProperty('--kb-inset', `${kb}px`);
        r.style.setProperty('--vv-top', '0px');
        r.style.setProperty('--vvh', `${hgt - kb}px`);
        r.setAttribute('data-kb', 'open');
      }, vp.height);
      await h.settle(page, 200);
    }
  },
  zoom200: async (page, h) => {
    const vp = page.viewportSize();
    if (vp && vp.width >= 1000) await page.setViewportSize({ width: Math.round(vp.width / 2), height: Math.round(vp.height / 2) });
    await busyJoin(page, h);
  },
  bigfont: async (page, h) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = 'html{font-size:125%}';
        document.head.appendChild(s);
      });
    });
    await busyJoin(page, h);
  },
};
