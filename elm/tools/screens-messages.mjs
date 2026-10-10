// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-messages.mjs — conversation-surface scenarios for screens.mjs.
 *
 *   node elm/tools/screens.mjs --extra elm/tools/screens-messages.mjs --only msg-long,msg-hover
 *
 * The fake IRC server seeds #lounge with eight rows. These scenarios sit
 * a Playwright WebSocket route in front of it and inject a fuller,
 * realistic room: yesterday's rows (day divider), author groups, a
 * reply, a two-reply thread, boosts (one of them ours), a long
 * paragraph, a same-origin image, a link preview (the /linkpreview
 * endpoint is routed to a JSON card) and typing. Each scenario then
 * drives one state of the conversation surface: row hover / tap
 * reveal, the message menu, the reaction picker, a reply in progress,
 * the emoji picker, search, the thread panel, the tools tray, the
 * jump-to-latest pill, the unread divider and the empty-room intro.
 */

const T = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const DAY = 24 * 60;

/* Rows older than the fake seed (yesterday) — sent right after NAMES so
   they land above it. */
const earlier = (room) => [
  `@time=${T(DAY + 95)};msgid=y1 :nova!n@onyx.test PRIVMSG ${room} :anyone around for the design crit tomorrow?`,
  `@time=${T(DAY + 93)};msgid=y2 :kip!k@onyx.test PRIVMSG ${room} :I'll be there — bringing the new onboarding flow`,
  `@time=${T(DAY + 92)};msgid=y3 :kip!k@onyx.test PRIVMSG ${room} :it's rough, but it's honest`,
  `@time=${T(DAY + 80)};msgid=y4 :rue!r@onyx.test PRIVMSG ${room} :count me in`,
];

/* Rows newer than the seed, plus boosts and thread replies on seeded rows. */
const later = (room, base, self) => [
  `@time=${T(1.8)};msgid=l1;+draft/reply=s6 :rue!r@onyx.test PRIVMSG ${room} :saving you a seat by the window`,
  `@time=${T(1.7)};msgid=l2;+draft/reply=s6 :lark!l@onyx.test PRIVMSG ${room} :same, I'll be there at 6 sharp`,
  `@time=${T(1.5)};msgid=l3 :nova!n@onyx.test PRIVMSG ${room} :Quick recap from the crit for anyone who missed it: the onboarding flow reads much calmer now, the connect step finally explains why a nick was taken, and the guest "keep this name" prompt only shows up after your first message instead of on arrival. Next up is the phone composer.`,
  `@time=${T(1.2)};msgid=l4 :lark!l@onyx.test PRIVMSG ${room} :photos from the meetup ${base}/media/meetup.png`,
  `@time=${T(1)};msgid=l5;+draft/reply=s2 :ash!a@onyx.test PRIVMSG ${room} :the roadmap page reads great on my phone now`,
  `@+draft/react=🎉;+draft/reply=s1 :jun!j@onyx.test TAGMSG ${room}`,
  `@+draft/react=🎉;+draft/reply=s1 :iris!i@onyx.test TAGMSG ${room}`,
  `@+draft/react=🎉;+draft/reply=s1 :${self}!u@onyx.test TAGMSG ${room}`,
  `@+draft/react=❤️;+draft/reply=s1 :sol!s@onyx.test TAGMSG ${room}`,
  `@+draft/react=👍;+draft/reply=s8 :kip!k@onyx.test TAGMSG ${room}`,
  `@+draft/react=👍;+draft/reply=s8 :rue!r@onyx.test TAGMSG ${room}`,
  `@+draft/react=🔥;+draft/reply=s5 :ash!a@onyx.test TAGMSG ${room}`,
];

/* A big room for the member list: 64 people across roles, a dozen away
   (one of them an op), and a few long names. */
const BIG_PLAIN = ['ada', 'basil', 'cleo', 'dmitri', 'elio', 'fern', 'gus', 'hana', 'ines', 'joss', 'kai', 'lumen',
  'milo', 'nadia', 'otto', 'pia', 'quill', 'rhea', 'silas', 'tove', 'uma', 'vik', 'wes', 'xan', 'yara', 'zed',
  'AlexandraKonstantinova', 'the_quiet_cartographer', 'Maximilian_vonHohenberg', 'birch', 'cosmo', 'dune', 'ember',
  'flint', 'gale', 'heron', 'iris_b', 'juniper', 'koa', 'lark2', 'moss', 'nimbus', 'oak', 'pebble', 'quartz',
  'reed', 'sage', 'tide', 'umber', 'vale'];
const BIG_ROLES = ['~mara', '@jun', '@iris', '@kestrel', '%wren', '+theo', '+sable', '+orchid', '+marlowe_the_bard'];
const BIG_AWAY = ['iris', 'sable', 'basil', 'fern', 'hana', 'kai', 'otto', 'quill', 'uma', 'xan', 'the_quiet_cartographer', 'moss', 'pebble', 'umber'];
const bigNames = (nick, room) => {
  const all = [...BIG_ROLES, ...BIG_PLAIN];
  const lines = [];
  for (let i = 0; i < all.length; i += 20) lines.push(`:onyx.test 353 ${nick} = ${room} :${all.slice(i, i + 20).join(' ')}`);
  return lines;
};
const bigAway = () => BIG_AWAY.map((n) => `:${n}!x@onyx.test AWAY :back later`);

const PREVIEW = {
  url: 'https://eshmaki.me/roadmap',
  title: 'Onyx roadmap',
  description: 'What is shipping next across the client, Onyx Server and the mesh — updated every release.',
  site: 'eshmaki.me',
  image: '',
};

async function artPng(page) {
  // A small rendered "photo" for the same-origin inline image (sized to
  // fit inside the phone viewport so the capture has no black margin).
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div style="width:360px;height:225px;position:relative;overflow:hidden;
    background:#1d2a33"><div style="position:absolute;inset:auto 0 0 0;height:46%;background:#0f1a20"></div>
    <div style="position:absolute;left:40px;top:38px;width:68px;height:68px;border-radius:50%;background:#e8c27a"></div>
    <div style="position:absolute;left:0;right:0;bottom:84px;height:40px;background:#2c3e48;clip-path:polygon(0 100%,18% 20%,36% 80%,55% 0,74% 70%,100% 30%,100% 100%)"></div>
    <div style="position:absolute;left:170px;bottom:22px;width:146px;height:40px;border-radius:6px;background:#46c08a33;border:2px solid #46c08a"></div>
    </div></body>`);
  return page.screenshot({ clip: { x: 0, y: 0, width: 360, height: 225 } });
}

/**
 * Put a WebSocket route in front of the fake server. `opts.drop(room)`
 * strips the seed for a room (empty-room intro); `opts.rich` adds the
 * earlier/later rows. Returns `inject(lines)` for scenario-driven lines.
 */
async function wire(page, h, opts = {}) {
  const png = await artPng(page);
  await page.route('**/media/*.png', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await page.route('**/linkpreview?*', (r) => r.fulfill({ body: JSON.stringify(PREVIEW), contentType: 'application/json' }));
  let client = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    client = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      const line = String(m);
      const room = (/ (#[^\s:]+)/.exec(line) || [])[1] || '';
      const seeded = /msgid=s\d/.test(line);
      if (opts.drop && seeded && opts.drop(room)) return;
      ws.send(line);
      if (opts.big && / 353 /.test(line)) for (const l of bigNames('kn', room)) ws.send(l);
      if (opts.big && / 366 /.test(line)) for (const l of bigAway()) ws.send(l);
      if (opts.rich && / 366 /.test(line) && room === '#lounge') for (const l of earlier(room)) ws.send(l);
      if (opts.rich && /msgid=s8 /.test(line) && room === '#lounge') for (const l of later(room, h.base, 'kn')) ws.send(l);
    });
  });
  return (lines) => { for (const l of lines) if (client) client.send(l); };
}

const isPhone = (page) => page.viewportSize().width < 768;
const lastRows = (page) => page.$$('.onyx-message');

async function room(page, h, opts = { rich: true }) {
  const inject = await wire(page, h, opts);
  await h.joinRoom(page);
  await h.settle(page, 700);
  return inject;
}

/* Reveal the action toolbar on a row: hover on desktop, tap on touch. */
async function reveal(page, index = -4) {
  const rows = await lastRows(page);
  const row = rows[(rows.length + index) % rows.length];
  if (!row) return null;
  await row.scrollIntoViewIfNeeded();
  if (isPhone(page)) {
    const box = await row.boundingBox();
    // Tap the row's body text (not a link / control).
    await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 30));
  } else {
    await row.hover();
  }
  await page.waitForTimeout(250);
  return row;
}

async function rowAction(page, row, label) {
  const btn = await row.$(`[data-row-action="${label}"]`);
  if (btn) { await btn.click(); await page.waitForTimeout(350); return true; }
  return false;
}

async function openMembers(page, h) {
  if (isPhone(page)) {
    await h.tryClick(page, '[data-testid="members-toggle"]');
    await page.waitForTimeout(350);
  }
}

export default {
  'roster': async (page, h) => { await room(page, h); await openMembers(page, h); },

  'roster-big': async (page, h) => { await room(page, h, { rich: true, big: true }); await openMembers(page, h); },

  'roster-filter': async (page, h) => {
    await room(page, h, { rich: true, big: true });
    await openMembers(page, h);
    await page.fill('[data-testid="member-filter"]', 'ma');
    await page.waitForTimeout(300);
  },

  'roster-hover': async (page, h) => {
    await room(page, h, { rich: true, big: true });
    await openMembers(page, h);
    const rows = await page.$$('.onyx-roster .onyx-member');
    if (rows[3]) { if (isPhone(page)) await rows[3].scrollIntoViewIfNeeded(); else await rows[3].hover(); }
    await page.waitForTimeout(250);
  },

  'msg-long': async (page, h) => { await room(page, h); },

  'msg-hover': async (page, h) => { await room(page, h); await reveal(page, -4); },

  'msg-menu': async (page, h) => {
    await room(page, h);
    const row = await reveal(page, -4);
    if (!(row && await rowAction(page, row, 'more'))) await h.tryClick(page, '.onyx-message:nth-last-child(4) .onyx-msg-menu-trigger');
  },

  'msg-react': async (page, h) => {
    await room(page, h);
    const row = await reveal(page, -4);
    if (!(row && await rowAction(page, row, 'react'))) await h.tryClick(page, '.onyx-message:nth-last-child(4) .boost-add');
  },

  'msg-reply': async (page, h) => {
    await room(page, h);
    const row = await reveal(page, -3);
    if (!(row && await rowAction(page, row, 'reply'))) {
      await h.tryClick(page, '.onyx-message:nth-last-child(3) .onyx-msg-menu-trigger');
      await h.tryClick(page, '.onyx-msg-menu-item:has-text("Reply")');
    }
    await page.fill('#shell-composer-input', 'Love these — can you post the full album? I want the one from the rooftop with everyone squinting into the sun');
    await h.settle(page, 400);
  },

  'msg-emoji': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', 'see you all at six ');
    await h.tryClick(page, '.shell-composer-tool--emoji');
  },

  'msg-search': async (page, h) => {
    await room(page, h);
    if (!(await h.tryClick(page, '.onyx-search-toggle'))) await page.keyboard.press('Control+f');
    await h.settle(page, 300);
    const input = await page.$('.onyx-message-search__input');
    if (input) { await input.fill('build'); await page.keyboard.press('Enter'); }
    await h.settle(page, 500);
  },

  'msg-thread': async (page, h) => {
    await room(page, h);
    const ind = await page.$('.onyx-thread-indicator');
    if (ind) { await ind.scrollIntoViewIfNeeded(); await ind.click(); }
    await h.settle(page, 500);
  },

  'msg-tools': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '[data-testid="composer-more-tools"]');
  },

  'msg-slash': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', '/');
    await h.settle(page, 300);
  },

  'msg-nick': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', 'thanks @');
    await page.type('#shell-composer-input', 'l');
    await h.settle(page, 300);
  },

  'msg-jump': async (page, h) => {
    const inject = await room(page, h);
    await page.evaluate(() => { const p = document.querySelector('.onyx-thread-pane'); if (p) p.scrollTop = 0; });
    await h.settle(page, 400);
    inject([
      `@time=${new Date().toISOString()};msgid=n1 :sol!s@onyx.test PRIVMSG #lounge :heading over now`,
      `@time=${new Date().toISOString()};msgid=n2 :mara!m@onyx.test PRIVMSG #lounge :doors open in five`,
    ]);
    await h.settle(page, 600);
  },

  'msg-typing': async (page, h) => {
    const inject = await room(page, h);
    inject([
      '@+typing=active :sol!s@onyx.test TAGMSG #lounge',
      '@+typing=active :rue!r@onyx.test TAGMSG #lounge',
    ]);
    await h.settle(page, 400);
  },

  'msg-unread': async (page, h) => {
    const inject = await room(page, h);
    await page.fill('#shell-composer-input', '/join #design');
    await page.keyboard.press('Enter');
    await h.settle(page, 900);
    inject([
      `@time=${new Date().toISOString()};msgid=u1 :iris!i@onyx.test PRIVMSG #lounge :ok the staging build is green again`,
      `@time=${new Date().toISOString()};msgid=u2 :iris!i@onyx.test PRIVMSG #lounge :@kn your fix landed, thank you`,
      `@time=${new Date().toISOString()};msgid=u3 :theo!t@onyx.test PRIVMSG #lounge :nice, shipping it tonight`,
    ]);
    await h.settle(page, 300);
    await page.fill('#shell-composer-input', '/join #lounge');
    await page.keyboard.press('Enter');
    await h.settle(page, 900);
  },

  'msg-empty': async (page, h) => {
    await wire(page, h, { drop: (r) => r === '#quiet' });
    await h.joinRoom(page, 'kn', '#quiet');
    await h.settle(page, 600);
  },
};
