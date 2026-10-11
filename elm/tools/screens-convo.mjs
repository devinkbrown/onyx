// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-convo.mjs — conversation-surface scenarios for screens.mjs,
 * built for the aspect-ratio matrix (`--vp all`).
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-convo.mjs --only cv-room,cv-thread
 *
 * Re-exports the app-frame scenarios of screens-shell.mjs (one --extra
 * file per run) and adds `cv-*` scenarios. A Playwright WebSocket route
 * sits in front of the fake IRC server and turns #lounge into a full,
 * realistic room:
 *
 *   - the server's two multi-line seed rows (a quote and a code block)
 *     are re-sent as real `draft/multiline` batches (the fake server
 *     would otherwise split them into broken lines);
 *   - yesterday's rows (day divider), author groups, replies, a thread
 *     with two replies, boosts (one of them ours), a long paragraph,
 *     a long code block and a very long URL (320px overflow checks),
 *     inline pictures (landscape + portrait), a file receipt, a link
 *     preview card, and our own message;
 *   - `draft/message-editing` / `-redaction` / `multiline` are offered
 *     in CAP LS so the edit flow (and its local history) is real;
 *   - the room's IRCX `PINS` prop names four rows, and `kn` can be
 *     made an op for the pins / pin-menu states.
 *
 * Touch viewports (hover: none) reveal row actions with a tap, fine
 * pointers with a hover. `cv-keyboard` publishes what the ports.js
 * visualViewport bridge would while the on-screen keyboard is up, and
 * paints a keyboard-sized block where iOS draws it. `cv-zoom` renders
 * a non-touch viewport at half its size (200% browser zoom); on touch
 * viewports it raises the default font size to 20px instead.
 */
import shell from './screens-shell.mjs';

const T = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const DAY = 24 * 60;
const ROOM = '#lounge';
const SELF = 'kn';

/* Yesterday's rows, sent right after NAMES so they land above the seed. */
const earlier = (room) => [
  `@time=${T(DAY + 95)};msgid=y1 :nova!n@onyx.test PRIVMSG ${room} :anyone around for the design crit tomorrow?`,
  `@time=${T(DAY + 93)};msgid=y2 :kip!k@onyx.test PRIVMSG ${room} :I'll be there — bringing the new onboarding flow`,
  `@time=${T(DAY + 92)};msgid=y3 :kip!k@onyx.test PRIVMSG ${room} :it's rough, but it's honest`,
  `@time=${T(DAY + 80)};msgid=y4 :rue!r@onyx.test PRIVMSG ${room} :count me in`,
];

/* A `draft/multiline` batch: the first child carries the row's msgid and
   time (the client re-dispatches the assembled body with its tags). */
function multiline(ref, { msgid, at, from, room, lines }) {
  return [
    `:onyx.test BATCH +${ref} draft/multiline ${room}`,
    ...lines.map((l, i) => `@batch=${ref}${i === 0 ? `;msgid=${msgid};time=${at}` : ''} :${from} PRIVMSG ${room} :${l}`),
    `:onyx.test BATCH -${ref}`,
  ];
}

const LONG_URL = 'https://eshmaki.me/roadmap?utm_source=onyx-weekly-digest&utm_medium=chat&utm_campaign=autumn-release-notes-2026&ref=lounge-pinned-thread-0123456789abcdef0123456789';

/* Rows newer than the seed, plus boosts and thread replies on seeded rows. */
const later = (room, base, self) => [
  `@time=${T(1.9)};msgid=l1;+draft/reply=s6 :rue!r@onyx.test PRIVMSG ${room} :saving you a seat by the window`,
  `@time=${T(1.8)};msgid=l2;+draft/reply=s6 :lark!l@onyx.test PRIVMSG ${room} :same, I'll be there at 6 sharp`,
  `@time=${T(1.7)};msgid=l3 :nova!n@onyx.test PRIVMSG ${room} :Quick recap from the crit for anyone who missed it: the onboarding flow reads much calmer now, the connect step finally explains why a nick was taken, and the guest "keep this name" prompt only shows up after your first message instead of on arrival. Next up is the phone composer.`,
  `@time=${T(1.6)};msgid=l4 :lark!l@onyx.test PRIVMSG ${room} :photos from the meetup ${base}/media/meetup.png`,
  `@time=${T(1.55)};msgid=l5;+draft/reply=s2 :ash!a@onyx.test PRIVMSG ${room} :the roadmap page reads great on my phone now`,
  ...multiline('ml6', {
    msgid: 'l6', at: T(1.5), from: 'theo!t@onyx.test', room,
    lines: [
      'the transcript export is one line now:',
      '```js',
      "const transcript = rows.filter((row) => !row.system && row.at > since).map((row) => `${row.from}: ${row.text}`).join('\\n');",
      '```',
    ],
  }),
  `@time=${T(1.4)};msgid=l7 :kip!k@onyx.test PRIVMSG ${room} :tracking link from the newsletter, for the record: ${LONG_URL}`,
  `@time=${T(1.3)};msgid=l8 :iris!i@onyx.test PRIVMSG ${room} :[file: onyx-v3-design-review.pdf] 2.4 MB ${base}/files/onyx-v3-design-review.pdf`,
  `@time=${T(1.25)};msgid=l9 :iris!i@onyx.test PRIVMSG ${room} :[file: rooftop.png] 812 KB ${base}/media/rooftop.png`,
  `@time=${T(1.2)};msgid=l10 :mara!m@onyx.test PRIVMSG ${room} :the design guide lives at https://eshmaki.me/guides — read the mobile section first`,
  `@time=${T(1.1)};msgid=k1 :${self}!u@onyx.test PRIVMSG ${room} :I can bring the projector and the long HDMI cable`,
  `@+draft/react=🎉;+draft/reply=s1 :jun!j@onyx.test TAGMSG ${room}`,
  `@+draft/react=🎉;+draft/reply=s1 :iris!i@onyx.test TAGMSG ${room}`,
  `@+draft/react=🎉;+draft/reply=s1 :${self}!u@onyx.test TAGMSG ${room}`,
  `@+draft/react=❤️;+draft/reply=s1 :sol!s@onyx.test TAGMSG ${room}`,
  `@+draft/react=👍;+draft/reply=s8 :kip!k@onyx.test TAGMSG ${room}`,
  `@+draft/react=👍;+draft/reply=s8 :rue!r@onyx.test TAGMSG ${room}`,
  `@+draft/react=🔥;+draft/reply=s5 :ash!a@onyx.test TAGMSG ${room}`,
  `@+draft/react=👀;+draft/reply=l9 :jun!j@onyx.test TAGMSG ${room}`,
];

/* The fake server's two multi-line seed rows, as real batches. */
const seedFix = (line, room) => {
  if (/msgid=s4 /.test(line)) {
    return multiline('ml4', {
      msgid: 's4', at: T(120), from: 'iris!i@onyx.test', room,
      lines: ['> quoting the old thread', 'yes, and the composer finally wraps on phones'],
    });
  }
  if (/msgid=s5 /.test(line)) {
    return multiline('ml5', {
      msgid: 's5', at: T(64), from: 'theo!t@onyx.test', room,
      lines: ['```elm', 'view model =', '    text "hello, onyx"', '```'],
    });
  }
  return null;
};

const PREVIEWS = {
  'https://eshmaki.me/roadmap': {
    url: 'https://eshmaki.me/roadmap', title: 'Onyx roadmap', site: 'eshmaki.me', image: '',
    description: 'What is shipping next across the client, Onyx Server and the mesh — updated every release.',
  },
  'https://eshmaki.me/guides': {
    url: 'https://eshmaki.me/guides', title: 'Onyx guides', site: 'eshmaki.me', image: '',
    description: 'Short, practical guides: rooms, calls, privacy and getting the most out of Onyx on a phone.',
  },
};

/* Rendered "photos" for the same-origin inline images, at a real
   camera-ish pixel size (so the lightbox has something to fit and to
   show at full size). Drawn once per run in a separate desktop-sized
   context (a phone viewport would clip the capture). */
const ART = {};
async function art(page, w, h, variant) {
  const key = `${variant}:${w}x${h}`;
  if (ART[key]) return ART[key];
  const scenes = {
    meetup: `<div style="position:absolute;inset:auto 0 0 0;height:46%;background:#0f1a20"></div>
      <div style="position:absolute;left:11%;top:17%;width:19%;aspect-ratio:1;border-radius:50%;background:#e8c27a"></div>
      <div style="position:absolute;left:0;right:0;bottom:37%;height:18%;background:#2c3e48;clip-path:polygon(0 100%,18% 20%,36% 80%,55% 0,74% 70%,100% 30%,100% 100%)"></div>
      <div style="position:absolute;left:47%;bottom:10%;width:40%;height:18%;border-radius:2%;background:#46c08a33;border:4px solid #46c08a"></div>`,
    rooftop: `<div style="position:absolute;inset:0;background:#1a252e"></div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:38%;background:#0c1216"></div>
      <div style="position:absolute;left:12%;bottom:38%;width:16%;height:30%;background:#24323c"></div>
      <div style="position:absolute;left:34%;bottom:38%;width:22%;height:44%;background:#2a3a45"></div>
      <div style="position:absolute;left:62%;bottom:38%;width:14%;height:24%;background:#24323c"></div>
      <div style="position:absolute;left:58%;top:10%;width:14%;aspect-ratio:1;border-radius:50%;background:#d9a13b"></div>`,
  };
  const ctx = await page.context().browser().newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#000"><div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;background:#1d2a33">${scenes[variant]}</div></body>`);
  ART[key] = await p.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  await ctx.close();
  return ART[key];
}

/**
 * Put a WebSocket route in front of the fake server.
 *   opts.rich   — add yesterday's rows, the later rows and boosts
 *   opts.op     — make us an op (pin menu, unpin buttons)
 *   opts.pins   — publish the room's PINS prop
 *   opts.drop   — (room) => true strips that room's seed (empty intro)
 * Returns inject(lines) for scenario-driven lines.
 */
async function wire(page, h, opts = {}) {
  const meetup = await art(page, 1600, 1000, 'meetup');
  const rooftop = await art(page, 900, 1200, 'rooftop');
  await page.route('**/media/*.png', (r) => r.fulfill({ body: /rooftop/.test(r.request().url()) ? rooftop : meetup, contentType: 'image/png' }));
  await page.route('**/linkpreview?*', (r) => {
    const want = new URL(r.request().url()).searchParams.get('url') || '';
    const card = PREVIEWS[want.replace(/\/$/, '')] || PREVIEWS['https://eshmaki.me/roadmap'];
    return r.fulfill({ body: JSON.stringify(card), contentType: 'application/json' });
  });
  let client = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    client = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      let line = String(m);
      const room = (/ (#[^\s:]+)/.exec(line) || [])[1] || '';
      if (/ CAP \* LS \* :/.test(line)) line = line.replace(':server-time', ':server-time draft/message-editing draft/message-redaction draft/multiline');
      if (opts.op && / 353 /.test(line)) line = line.replace(` :${SELF} `, ` :@${SELF} `);
      const seeded = /msgid=s\d/.test(line);
      if (opts.drop && seeded && opts.drop(room)) return;
      const fixed = seeded ? seedFix(line, room) : null;
      if (fixed) for (const l of fixed) ws.send(l);
      else ws.send(line);
      if (room !== ROOM) return;
      if (opts.rich && / 366 /.test(line)) for (const l of earlier(room)) ws.send(l);
      if (opts.pins && / 366 /.test(line)) ws.send(`:mara!m@onyx.test PROP ${room} PINS :s1,l3,l10,l4`);
      if (opts.rich && /msgid=s8 /.test(line)) for (const l of later(room, h.base, SELF)) ws.send(l);
    });
  });
  return (lines) => { for (const l of lines) if (client) client.send(l); };
}

/* Label a few fresh rows with the `onyx/topic` tag so the filter chips,
   the Forum cards and the per-topic unread counts have something to show. */
async function topicRows(inject, h, page) {
  const at = (m) => new Date(Date.now() - m * 1000).toISOString();
  inject([
    `@time=${at(50)};msgid=tp1;onyx/topic=design :nova!n@onyx.test PRIVMSG ${ROOM} :crit notes are in the doc — three open questions on the connect step`,
    `@time=${at(40)};msgid=tp2;onyx/topic=design :kip!k@onyx.test PRIVMSG ${ROOM} :I'll take the first two`,
    `@time=${at(30)};msgid=tp3;onyx/topic=release :mara!m@onyx.test PRIVMSG ${ROOM} :cutting the candidate at five, freeze after that`,
    `@time=${at(20)};msgid=tp4;onyx/topic=release-notes-and-changelog-for-autumn :iris!i@onyx.test PRIVMSG ${ROOM} :draft is up, please add anything user-facing`,
    `@time=${at(10)};msgid=tp5;onyx/topic=design :lark!l@onyx.test PRIVMSG ${ROOM} :photos from the meetup are in the shared folder`,
  ]);
  await h.settle(page, 400);
}

/* Touch-target audit: names every button / link / field inside `scope`
   whose hit box (its own box grown by an absolutely positioned
   ::before / ::after) is under 44px on its short side. Inline links,
   #channel jumps and spoilers in running text are exempt (WCAG's inline
   exception), as is the calls slice's own stage strip. */
const auditTargets = (page, scope) => page.evaluate((scope) => {
  const bad = [];
  const reach = (el) => {
    const r = el.getBoundingClientRect();
    let l = 0, t = 0, rr = 0, b = 0;
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === 'none' || cs.position !== 'absolute') continue;
      const px = (v) => (v === 'auto' ? 0 : -parseFloat(v) || 0);
      l = Math.max(l, px(cs.left)); rr = Math.max(rr, px(cs.right)); t = Math.max(t, px(cs.top)); b = Math.max(b, px(cs.bottom));
    }
    return { w: r.width + l + rr, h: r.height + t + b };
  };
  const sel = 'button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select, summary, [role=menuitem], [role=button]';
  for (const root of document.querySelectorAll(scope)) {
    for (const el of root.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (el.closest('[aria-hidden="true"], [inert], .onyx-call-btn, .shell-msg-text')) continue;
      if (el.matches('.onyx-call-btn')) continue;
      const k = reach(el);
      if (Math.min(k.w, k.h) < 43.5) bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(k.w)}x${Math.round(k.h)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18)}"`);
    }
  }
  return [...new Set(bad)];
}, scope);

const isTouch = (page) => page.evaluate(() => matchMedia('(hover: none)').matches);
const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Close the quiet asks (notifications, Add to Home Screen). */
async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('.polish-sheet')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

async function room(page, h, opts = { rich: true }) {
  const inject = await wire(page, h, opts);
  if (opts.prefs) {
    await page.addInitScript((p) => {
      try { localStorage.setItem('onyx:preferences', JSON.stringify(p)); } catch { /* private mode */ }
    }, opts.prefs);
  }
  await h.joinRoom(page, SELF, opts.room || ROOM);
  await h.settle(page, 700);
  await dismissAsks(page, h);
  // Park the pointer over the collection sidebar (or the top-left
  // corner on phones), so no row is left hovered by the connect click.
  await page.mouse.move(4, Math.round((page.viewportSize()?.height ?? 800) / 2));
  return inject;
}

const rowByText = async (page, text) => page.$(`.onyx-message:has-text(${JSON.stringify(text)})`);

/* Reveal the action toolbar on a row: tap on touch, hover with a mouse. */
async function reveal(page, text) {
  const row = await rowByText(page, text);
  if (!row) return null;
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  if (await isTouch(page)) {
    const body = await row.$('.onyx-body');
    const box = await (body || row).boundingBox();
    await page.touchscreen.tap(box.x + Math.min(box.width - 4, 40), box.y + Math.min(box.height - 4, 10));
  } else {
    await row.hover();
  }
  await page.waitForTimeout(250);
  return row;
}

async function rowAction(page, row, key) {
  const btn = await row.$(`[data-row-action="${key}"]`);
  if (!btn) return false;
  await btn.click();
  await page.waitForTimeout(350);
  return true;
}

async function keyboard(page) {
  const vp = page.viewportSize();
  const kb = vp.width > vp.height ? Math.round(vp.height * 0.52) : Math.round(vp.height * 0.4);
  await page.evaluate((px) => {
    const root = document.documentElement;
    root.style.setProperty('--vvh', `${globalThis.innerHeight - px}px`);
    root.style.setProperty('--kb-inset', `${px}px`);
    root.setAttribute('data-kb', 'open');
    const k = document.createElement('div');
    k.setAttribute('aria-hidden', 'true');
    k.textContent = 'keyboard (simulated)';
    k.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${px}px;z-index:2147483646;background:#2b2d31;color:#8a8f98;font:14px system-ui;display:grid;place-items:center;pointer-events:none`;
    document.body.appendChild(k);
  }, kb);
}

async function editOwn(page, nextText) {
  const row = await reveal(page, 'projector');
  if (!row) return false;
  if (!(await rowAction(page, row, 'more'))) return false;
  const edit = await page.$('.onyx-msg-menu-item:text-is("Edit")');
  if (!edit) return false;
  await edit.click();
  await page.waitForTimeout(250);
  await page.fill('#shell-composer-input', nextText);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  return true;
}

const scrollTo = async (page, fraction) => {
  await page.evaluate((f) => {
    const p = document.querySelector('.onyx-thread-pane');
    if (p) p.scrollTop = (p.scrollHeight - p.clientHeight) * f;
  }, fraction);
  await page.waitForTimeout(300);
};

export default {
  ...shell,

  'cv-room': async (page, h) => { await room(page, h); },

  'cv-top': async (page, h) => { await room(page, h); await scrollTo(page, 0); },

  'cv-mid': async (page, h) => { await room(page, h); await scrollTo(page, 0.45); },

  'cv-compact': async (page, h) => {
    await room(page, h, { rich: true, prefs: { transcriptDensity: 'irc' } });
  },

  'cv-compact-mid': async (page, h) => {
    await room(page, h, { rich: true, prefs: { transcriptDensity: 'irc' } });
    await scrollTo(page, 0.4);
  },

  'cv-code': async (page, h) => {
    await room(page, h);
    const row = await rowByText(page, 'transcript export');
    if (row) await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await h.settle(page, 300);
  },

  'cv-hover': async (page, h) => { await room(page, h); await reveal(page, 'Sounds good'); },

  'cv-menu': async (page, h) => {
    await room(page, h, { rich: true, op: true });
    const row = await reveal(page, 'Sounds good');
    if (row) await rowAction(page, row, 'more');
  },

  'cv-react': async (page, h) => {
    await room(page, h);
    const row = await reveal(page, 'Sounds good');
    if (row) await rowAction(page, row, 'react');
  },

  'cv-reply': async (page, h) => {
    await room(page, h);
    const row = await reveal(page, 'photos from the meetup');
    if (row) await rowAction(page, row, 'reply');
    await page.fill('#shell-composer-input', 'Love these — can you post the full album? I want the one from the rooftop with everyone squinting into the sun');
    await h.settle(page, 300);
  },

  'cv-edit-history': async (page, h) => {
    await room(page, h);
    await editOwn(page, 'I can bring the projector and the long HDMI cable (and a USB-C adapter)');
    await editOwn(page, 'I can bring the projector, the long HDMI cable and a USB-C adapter');
    const marker = await page.$('.onyx-edited-toggle');
    if (marker) { await marker.scrollIntoViewIfNeeded(); await marker.click(); }
    await h.settle(page, 300);
    const row = await rowByText(page, 'projector');
    if (row) await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    if (!(await isTouch(page))) await page.mouse.move(2, 2);
    await h.settle(page, 200);
  },

  'cv-thread': async (page, h) => {
    await room(page, h);
    const ind = await page.$('.onyx-thread-indicator');
    if (ind) { await ind.scrollIntoViewIfNeeded(); await ind.click(); }
    await h.settle(page, 500);
  },

  'cv-tools': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '[data-testid="composer-more-tools"]');
  },

  'cv-slash': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', '/');
    await h.settle(page, 300);
  },

  'cv-emoji': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', 'see you all at six ');
    await h.tryClick(page, '.shell-composer-tool--emoji');
  },

  'cv-search': async (page, h) => {
    await room(page, h);
    await page.keyboard.press('Control+f');
    await h.settle(page, 300);
    const input = await page.$('.onyx-message-search__input');
    if (input) { await input.fill('the'); await page.keyboard.press('Enter'); }
    await h.settle(page, 500);
  },

  'cv-media': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '[data-testid="room-more"]');
    await h.tryClick(page, '[data-testid="ribbon-room-media"]');
    await h.settle(page, 600);
  },

  'cv-media-links': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '[data-testid="room-more"]');
    await h.tryClick(page, '[data-testid="ribbon-room-media"]');
    await h.tryClick(page, '.room-media-index-filter:has-text("Links")');
    await h.settle(page, 400);
  },

  'cv-pins': async (page, h) => {
    await room(page, h, { rich: true, op: true, pins: true });
    await h.tryClick(page, '[data-testid="room-more"]');
    await h.tryClick(page, '[data-testid="ribbon-pins"]');
    await h.settle(page, 500);
  },

  'cv-lightbox': async (page, h) => {
    await room(page, h);
    const open = await page.$('.shell-msg-media-open');
    if (open) { await open.scrollIntoViewIfNeeded(); await open.click(); }
    await h.settle(page, 500);
  },

  'cv-lightbox-zoom': async (page, h) => {
    await room(page, h);
    const open = await page.$('.shell-msg-media-open');
    if (open) { await open.scrollIntoViewIfNeeded(); await open.click(); }
    await h.settle(page, 400);
    await h.tryClick(page, '.shell-msg-lightbox-zoom');
    await page.evaluate(() => {
      const st = document.querySelector('.shell-msg-lightbox-stage');
      if (st) { st.scrollLeft = (st.scrollWidth - st.clientWidth) / 3; st.scrollTop = (st.scrollHeight - st.clientHeight) / 2; }
    });
    await h.settle(page, 300);
  },

  /* Behaviour, not pixels: focus lands in the dialog and never leaves it
     on Tab / Shift+Tab, Escape closes it and returns focus to the
     opener, and on touch a swipe down (the scroll-snap layer carried to
     its far end) closes it. Throws (-> PROBLEM) when any of it breaks. */
  'cv-lightbox-behaviour': async (page, h) => {
    await room(page, h);
    const open = await page.$('.shell-msg-media-open');
    if (!open) throw new Error('no inline picture to open');
    const openAndWait = async () => {
      await open.scrollIntoViewIfNeeded();
      await open.click();
      await page.waitForSelector('.shell-msg-lightbox-dialog', { timeout: 3000 });
      await h.settle(page, 250);
    };
    const inside = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.shell-msg-lightbox'));
    await openAndWait();
    if (!(await inside())) throw new Error('focus did not move into the lightbox');
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      if (!(await inside())) throw new Error(`focus left the lightbox on key press ${i + 1}`);
    }
    await page.keyboard.press('Escape');
    await h.settle(page, 300);
    if (await page.$('.shell-msg-lightbox-dialog')) throw new Error('Escape did not close the lightbox');
    const back = await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('shell-msg-media-open'));
    if (!back) throw new Error('focus did not return to the picture that opened the lightbox');
    if (await isTouch(page)) {
      await openAndWait();
      await page.evaluate(() => {
        const layer = document.querySelector('.shell-msg-lightbox');
        layer.scrollTop = -(layer.scrollHeight - layer.clientHeight);
      });
      await h.settle(page, 500);
      if (await page.$('.shell-msg-lightbox-dialog')) throw new Error('swiping the picture away did not close the lightbox');
    }
  },

  /* Touch-target audit (hover: none viewports): every button / link /
     field in the conversation surfaces — transcript, row toolbar and
     menu, composer and tools tray, search, thread, media index, pins,
     lightbox — must be at least 44px on its short side, counting an
     invisible pseudo-element hit area. The shell's own header controls
     are out of scope. Throws (-> PROBLEM) listing the offenders. */
  'cv-targets': async (page, h) => {
    await room(page, h, { rich: true, op: true, pins: true });
    if (!(await isTouch(page))) return;
    const SCOPE = '.onyx-thread-pane, .onyx-thread, .onyx-intro, .onyx-composer, .onyx-message-search, .onyx-thread-sheet, .shell-msg-lightbox, .room-media-index, .pins-panel, .onyx-msg-menu, .onyx-react-picker';
    const measure = () => auditTargets(page, SCOPE);
    const skipped = [];
    const rowTap = async (row, key) => {
      const btn = await row.$(`[data-row-action="${key}"]`);
      if (!btn) { skipped.push(`no ${key} action on the row`); return false; }
      try { await btn.click({ timeout: 5000 }); await page.waitForTimeout(350); return true; } catch (e) {
        skipped.push(`could not tap the row ${key} action: ${e.message.split('\n').filter((l) => /intercepts|obscur|not visible|outside/i.test(l)).slice(0, 2).join(' / ').trim() || e.message.split('\n')[0]}`);
        return false;
      }
    };
    const states = [];
    const seen = new Set();
    let step = 'start';
    const tap = async (el, what) => {
      try { await el.click({ timeout: 5000 }); } catch (e) {
        throw new Error(`could not tap the ${what} while auditing "${step}": ${e.message.split('\n').filter((l) => /intercepts|obscur|not visible|outside/i.test(l)).slice(0, 2).join(' / ') || e.message.split('\n')[0]}`);
      }
    };
    const note = async (name) => {
      step = name;
      const fresh = (await measure()).filter((x) => !seen.has(x.replace(/ "[^"]*"$/, '')));
      for (const x of fresh) seen.add(x.replace(/ "[^"]*"$/, ''));
      states.push([name, fresh]);
    };
    await note('room');
    await scrollTo(page, 0);
    await note('top-of-room');
    await scrollTo(page, 1);
    const row = await reveal(page, 'projector');
    if (row) {
      await note('row-toolbar');
      if (await rowTap(row, 'more')) { await note('row-menu'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    }
    await h.tryClick(page, '[data-testid="composer-more-tools"]');
    await h.settle(page, 300);
    await note('tools-tray');
    await page.keyboard.press('Escape');
    await h.tryClick(page, '.shell-composer-tool--emoji');
    await h.settle(page, 300);
    await note('emoji');
    await page.keyboard.press('Escape');
    await page.fill('#shell-composer-input', '/');
    await h.settle(page, 300);
    await note('slash');
    await page.fill('#shell-composer-input', '');
    const rr = await reveal(page, 'Sounds good');
    if (rr && (await rowTap(rr, 'react'))) { await note('react-picker'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    const rp = await reveal(page, 'photos from the meetup');
    if (rp && (await rowTap(rp, 'reply'))) { await note('reply-context'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    const ind = await page.$('.onyx-thread-indicator');
    if (ind) {
      await ind.scrollIntoViewIfNeeded();
      await tap(ind, 'thread link');
      await h.settle(page, 500);
      await note('thread');
      await page.keyboard.press('Escape');
      await h.settle(page, 300);
    }
    const pic = await page.$('.shell-msg-media-open');
    if (pic) {
      await pic.scrollIntoViewIfNeeded();
      await tap(pic, 'inline picture');
      await h.settle(page, 400);
      await note('lightbox');
      await page.keyboard.press('Escape');
      await h.settle(page, 300);
    }
    await page.keyboard.press('Control+f');
    await h.settle(page, 300);
    const q = await page.$('.onyx-message-search__input');
    if (q) { await q.fill('the'); await page.keyboard.press('Enter'); await h.settle(page, 400); }
    await h.tryClick(page, '.onyx-message-search__save-toggle');
    await note('search');
    await page.keyboard.press('Escape');
    await h.tryClick(page, '[data-testid="room-more"]');
    await h.tryClick(page, '[data-testid="ribbon-room-media"]');
    await h.settle(page, 500);
    await note('media-index');
    await page.keyboard.press('Escape');
    await h.settle(page, 200);
    await h.tryClick(page, '[data-testid="room-more"]');
    await h.tryClick(page, '[data-testid="ribbon-pins"]');
    await h.settle(page, 500);
    await note('pins');
    await page.keyboard.press('Escape');
    await h.settle(page, 200);
    const problems = states.filter(([, b]) => b.length).map(([n, b]) => `${n}: ${b.slice(0, 10).join('; ')}`);
    if (skipped.length) problems.push(`skipped: ${skipped.join('; ')}`);
    if (problems.length) throw new Error(`touch targets under 44px — ${problems.join(' | ')}`);
  },

  /* The empty-room intro on touch: its actions are 44px targets too. */
  'cv-targets-empty': async (page, h) => {
    await room(page, h, { drop: (r) => r === '#quiet', room: '#quiet' });
    if (!(await isTouch(page))) return;
    const bad = await auditTargets(page, '.onyx-thread-pane, .onyx-composer');
    if (bad.length) throw new Error(`touch targets under 44px in the empty room — ${bad.join('; ')}`);
  },

  /* Named conversations (the Topics preference): the quiet "Topics"
     disclosure opened, with filter chips from labelled rows. */
  'cv-topics': async (page, h) => {
    const inject = await room(page, h);
    await topicRows(inject, h, page);
    await h.tryClick(page, '.onyx-topic-tools-toggle');
    await page.fill('#shell-topic-create-input', 'weekend-plans');
    await scrollTo(page, 0);
    await h.settle(page, 300);
  },

  /* The same, with the Forum switch on: one card per topic. */
  'cv-topics-forum': async (page, h) => {
    const inject = await room(page, h);
    await topicRows(inject, h, page);
    await h.tryClick(page, '.onyx-topic-tools-toggle');
    await h.tryClick(page, '.shell-topic-actions .shell-topic-action');
    await scrollTo(page, 0);
    await h.settle(page, 400);
  },

  'cv-jump': async (page, h) => {
    const inject = await room(page, h);
    await scrollTo(page, 0);
    inject([
      `@time=${new Date().toISOString()};msgid=n1 :sol!s@onyx.test PRIVMSG ${ROOM} :heading over now`,
      `@time=${new Date().toISOString()};msgid=n2 :mara!m@onyx.test PRIVMSG ${ROOM} :doors open in five`,
    ]);
    await h.settle(page, 600);
  },

  'cv-typing': async (page, h) => {
    const inject = await room(page, h);
    inject([
      `@+typing=active :sol!s@onyx.test TAGMSG ${ROOM}`,
      `@+typing=active :rue!r@onyx.test TAGMSG ${ROOM}`,
    ]);
    await h.settle(page, 400);
  },

  'cv-empty': async (page, h) => {
    await room(page, h, { drop: (r) => r === '#quiet', room: '#quiet' });
  },

  'cv-keyboard': async (page, h) => {
    await room(page, h);
    await page.click('#shell-composer-input');
    await page.fill('#shell-composer-input', 'on my way, saving seats');
    if (await isTouch(page)) await keyboard(page);
    await h.settle(page, 400);
  },

  'cv-zoom': async (page, h) => {
    const vp = page.viewportSize();
    const touch = await page.evaluate(() => matchMedia('(hover: none)').matches).catch(() => false);
    if (!touch && !isPhone(page)) {
      await page.setViewportSize({ width: Math.round(vp.width / 2), height: Math.round(vp.height / 2) });
    } else {
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '20px'; });
      });
    }
    await room(page, h);
  },
};
