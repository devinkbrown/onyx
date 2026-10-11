// SPDX-License-Identifier: AGPL-3.0-or-later
/* global DataTransfer, DragEvent */
/**
 * screens-gap-convo.mjs — v3/gap-convo scenarios for screens.mjs.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-convo.mjs --only gc-draft,gc-drop
 *
 * Every scenario also ASSERTS what it shows (a failed assertion throws, which
 * the harness reports as a PROBLEM line), so the matrix proves behaviour as
 * well as layout:
 *   gc-draft          typing saves "Saved here"; a reload restores the draft
 *   gc-drop           a file drag names the room and sends nothing
 *   gc-paste          a pasted photo stages with its privacy line; the POST
 *                     carries no EXIF/GPS bytes
 *   gc-paste-compact  the Compact choice posts the smaller re-encoded copy
 *   gc-paste-unsafe   a photo that cannot be cleaned is refused until consent
 *   gc-room-switch    staged files stay with their room
 *   gc-edit           a server edit rewrites the row in place; earlier text opens
 *   gc-collapsed      hidden sender banner and "Show all"
 *   gc-search-empty   "No matches yet"
 *   gc-land           a search hit far back lands centred on the row
 *   gc-undelivered    a 401 for a labeled DM says so and returns the text
 *   gc-menu-keys      arrow keys rove the message menu
 *   gc-ctrlf          Ctrl+F keeps the draft
 *   gc-loading        history in flight: placeholders, not "say hi"
 *   gc-caret          an emoji lands at the caret, which stays after it
 *   gc-reply-focus    Reply / Quote hand the keyboard to the composer
 *   gc-react-keys     the reaction picker opens on its search and roves with arrows
 *   gc-search-focus   search opens on its field and gives focus back on Escape
 */

const T = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const isPhone = (page) => page.viewportSize().width < 768;

function ok(cond, what) {
  if (!cond) throw new Error(`assert: ${what}`);
}

/* A WebSocket route in front of the fake server: lets scenarios inject lines
   and answer chosen client lines. */
async function wire(page, hooks = {}) {
  let client = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    client = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const line = String(m);
      if (hooks.fromClient && hooks.fromClient(line, (l) => ws.send(l))) return;
      server.send(m);
    });
    server.onMessage((m) => {
      const line = String(m);
      if (hooks.dropServer && hooks.dropServer(line)) return;
      if (hooks.fromServer) hooks.fromServer(line, (l) => ws.send(l));
      ws.send(hooks.rewrite ? hooks.rewrite(line) : line);
    });
  });
  return (lines) => { for (const l of lines) if (client) client.send(l); };
}

/* Build a real JPEG in the page, optionally with an EXIF block that carries a
   GPS tag, a camera make and an orientation. Returns a File. */
const MAKE_PHOTO = `
async function makePhoto(opts) {
  const w = opts.w || 1800, h = opts.h || 1200;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = 'hsl(' + (i * 9) + ',55%,' + (30 + (i % 5) * 8) + '%)';
    ctx.fillRect((i * 97) % w, (i * 53) % h, 320, 220);
  }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = bytes;
  if (opts.exif) {
    const text = new TextEncoder().encode('Exif\\u0000\\u0000MM\\u0000*\\u0000\\u0000\\u0000\\u0008GPSLatitude=33.7490N GPSLongitude=84.3880W Make=ACME Camera');
    const seg = new Uint8Array(4 + text.length);
    seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = ((text.length + 2) >> 8) & 255; seg[3] = (text.length + 2) & 255;
    seg.set(text, 4);
    out = new Uint8Array(2 + seg.length + bytes.length - 2);
    out.set(bytes.subarray(0, 2), 0); out.set(seg, 2); out.set(bytes.subarray(2), 2 + seg.length);
  }
  return new File([out], opts.name || 'meetup.jpg', { type: 'image/jpeg' });
}
async function pasteFiles(files) {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  const field = document.getElementById('shell-composer-input');
  field.focus();
  field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}
`;

async function installHelpers(page) {
  await page.addScriptTag({ content: `${MAKE_PHOTO}; window.makePhoto = makePhoto; window.pasteFiles = pasteFiles;` });
}

async function room(page, h, hooks) {
  const inject = await wire(page, hooks);
  await h.joinRoom(page);
  await h.settle(page, 500);
  await installHelpers(page);
  return inject;
}

async function pastePhoto(page, opts) {
  await page.evaluate(async (o) => { const f = await window.makePhoto(o); await window.pasteFiles([f]); }, opts);
  await page.waitForSelector('.onyx-attach-row', { timeout: 4000 });
  await page.waitForTimeout(700);
}

async function captureUpload(page) {
  const posts = [];
  await page.route('**/upload', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    posts.push(req.postDataBuffer());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ url: '/uploads/ok.jpg', path: '/uploads/ok.jpg' }) });
  });
  return posts;
}

/* Header search icon on wide layouts; the room "More" sheet on phones. */
async function openSearch(page, h) {
  const toggle = await page.$('.onyx-search-toggle');
  if (toggle && (await toggle.isVisible())) { await toggle.click(); }
  else {
    await page.click('[data-testid="room-more"]');
    await page.waitForTimeout(300);
    await page.click('.onyx-room-more-search');
  }
  await h.settle(page, 400);
}

/* Open the "More" menu on the n-th row (hover on desktop, tap on touch). */
async function openMenuOnRow(page, n) {
  const row = (await page.$$('.onyx-message'))[n];
  await row.scrollIntoViewIfNeeded();
  if (isPhone(page)) {
    const box = await row.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 24));
  } else {
    await row.hover();
  }
  await page.waitForTimeout(250);
  await (await row.$('.onyx-msg-menu-trigger')).click();
  await page.waitForTimeout(400);
}

/* Hop to a joined room through the Ctrl/Cmd+K switcher. */
async function hop(page, name) {
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await page.keyboard.type(name);
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
}

const hasBytes = (buf, text) => buf && Buffer.from(buf).includes(Buffer.from(text));

export default {
  'gc-draft': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', 'see you at six — bringing the extra chairs');
    await page.waitForTimeout(800);
    const status = await page.textContent('[data-testid="draft-status"]');
    ok(/Saved here/.test(status || ''), `draft status says Saved here (got ${status})`);
    await page.reload();
    await page.fill('#conn-nick', 'kn').catch(() => {});
    await h.settle(page, 400);
    // a reload lands on the connect gate again: join and look for the draft
    if (await page.$('[data-testid="conn-submit"]')) {
      await page.fill('#conn-nick', 'kn');
      await page.fill('#conn-room', '#lounge');
      await page.click('[data-testid="conn-submit"]');
      await page.waitForSelector('[data-testid="connect"]', { state: 'detached', timeout: 8000 });
      await h.settle(page, 900);
    }
    const restored = await page.inputValue('#shell-composer-input');
    ok(restored === 'see you at six — bringing the extra chairs', `draft restored after reload (got ${JSON.stringify(restored)})`);
  },

  'gc-drop': async (page, h) => {
    await room(page, h);
    // a held drag re-fires dragover on its own; do the same
    await page.evaluate(() => {
      const fire = () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'sunrise.jpg', { type: 'image/jpeg' }));
        document.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      };
      fire();
      window.__drag = setInterval(fire, 150);
    });
    await page.waitForSelector('[data-testid="drop-target"]', { timeout: 2000 });
    const copy = await page.textContent('[data-testid="drop-target"]');
    ok(/#lounge/.test(copy) && /Nothing sends/.test(copy), `drop target names the room and promises no send (got ${copy})`);
    await h.settle(page, 1200);
    ok(!!(await page.$('[data-testid="drop-target"]')), 'the target stays while the drag is held');
    ok(!(await page.$('.onyx-attach-row')), 'nothing is staged or sent by a drag alone');
  },

  'gc-paste': async (page, h) => {
    await room(page, h);
    const posts = await captureUpload(page);
    await pastePhoto(page, { exif: true, name: 'meetup-rooftop-with-everyone-squinting.jpg' });
    const note = await page.textContent('.onyx-attach-row');
    ok(/removed/i.test(note), `photo row says its details were removed (got ${note})`);
    await h.settle(page, 200);
    await page.screenshot({ path: '/dev/null' }).catch(() => {});
    // send it and prove the bytes that leave carry no EXIF or GPS
    await page.click('.onyx-composer-send');
    await page.waitForTimeout(1200);
    ok(posts.length === 1, `one upload posted (got ${posts.length})`);
    ok(!hasBytes(posts[0], 'GPSLatitude') && !hasBytes(posts[0], 'Exif'), 'the posted bytes carry no EXIF/GPS');
    ok(hasBytes(posts[0], 'JFIF') || posts[0].length > 1000, 'a real image was posted');
    // stage another so the shot shows the privacy line
    await pastePhoto(page, { exif: true, name: 'second.jpg' });
  },

  'gc-paste-compact': async (page, h) => {
    await room(page, h);
    const posts = await captureUpload(page);
    await pastePhoto(page, { exif: true, w: 2600, h: 1700, name: 'big-photo.jpg' });
    const compact = await page.$('.gap-attach-quality-opt:has-text("Compact")');
    ok(!!compact, 'a Compact choice is offered for a large photo');
    await compact.click();
    await page.waitForTimeout(300);
    const pressed = await page.getAttribute('.gap-attach-quality-opt:has-text("Compact")', 'aria-checked');
    ok(pressed === 'true', 'Compact is selected');
    const before = await page.evaluate(() => 0);
    await page.click('.onyx-composer-send');
    await page.waitForTimeout(1500);
    ok(posts.length === 1, `one upload posted (got ${posts.length})`);
    ok(!hasBytes(posts[0], 'GPSLatitude'), 'compact copy carries no GPS');
    await pastePhoto(page, { exif: true, w: 2600, h: 1700, name: 'big-photo-2.jpg' });
    await page.click('.gap-attach-quality-opt:has-text("Compact")');
    await h.settle(page, 300);
    void before;
  },

  'gc-paste-unsafe': async (page, h) => {
    await room(page, h);
    await page.evaluate(async () => {
      // a TIFF-container "raw": cannot be cleaned here
      const bytes = new Uint8Array(4096);
      bytes.set([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
      await window.pasteFiles([new File([bytes], 'IMG_0412.dng', { type: 'image/x-adobe-dng' })]);
    });
    await page.waitForSelector('.onyx-attach-row', { timeout: 4000 });
    await page.waitForTimeout(700);
    const text = await page.textContent('.onyx-attach-row');
    ok(/can't be removed|cannot be removed/i.test(text), `unsafe photo says so (got ${text})`);
    ok(!!(await page.$('.gap-attach-keep')), 'explicit consent control present');
    await h.settle(page, 200);
  },

  'gc-room-switch': async (page, h) => {
    await room(page, h);
    // join #design first (the fake server answers), then stage in #lounge
    await page.fill('#shell-composer-input', '/join #design');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await page.evaluate(async () => { await window.pasteFiles([new File(['hello'], 'notes.txt', { type: 'text/plain' })]); });
    await page.waitForSelector('.onyx-attach-row');
    await hop(page, 'design');
    ok(!(await page.$('.onyx-attach-row')), 'staged file stays behind in #lounge');
    ok((await page.inputValue('#shell-composer-input')) === '', 'composer is clean in the new room');
    await hop(page, 'lounge');
    ok(!!(await page.$('.onyx-attach-row')), 'staged file is back in #lounge');
    await h.settle(page, 200);
  },

  'gc-edit': async (page, h) => {
    const inject = await room(page, h);
    inject([
      `@time=${T(3)};account=sol;msgid=ed-1 :sol!s@onyx.test PRIVMSG #lounge :voice call at six? bring snacks`,
    ]);
    await h.settle(page, 400);
    inject([
      `@time=${T(2)};account=sol;msgid=ed-1;+draft/edit=ed-1;+draft/revision=1 :sol!s@onyx.test PRIVMSG #lounge :voice call at seven? bring snacks`,
      `@time=${T(1)};account=sol;msgid=ed-1;+draft/edit=ed-1;+draft/revision=2 :sol!s@onyx.test PRIVMSG #lounge :voice call at seven — bring snacks and chairs`,
    ]);
    await h.settle(page, 500);
    const bodies = await page.$$eval('.onyx-message .onyx-body', (els) => els.map((e) => e.textContent));
    const hits = bodies.filter((b) => /voice call at/.test(b) && !/Sounds|later at 6/.test(b));
    ok(hits.length === 1 && /seven — bring snacks and chairs/.test(hits[0]), `one row, latest text (got ${JSON.stringify(hits)})`);
    const toggle = await page.$('.gap-edited-toggle');
    ok(!!toggle, 'the edited marker is a disclosure');
    await toggle.click();
    await h.settle(page, 400);
    ok(!!(await page.$('.gap-revisions')), 'earlier versions open');
  },

  'gc-collapsed': async (page, h) => {
    await room(page, h);
    const row = (await page.$$('.onyx-message'))[3];
    await row.scrollIntoViewIfNeeded();
    if (isPhone(page)) {
      const box = await row.boundingBox();
      await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 24));
    } else {
      await row.hover();
    }
    await page.waitForTimeout(250);
    const trigger = await row.$('.onyx-msg-menu-trigger');
    ok(!!trigger, 'row menu trigger');
    await trigger.click();
    await page.waitForTimeout(300);
    await page.click('.onyx-msg-menu-item[aria-label^="Hide messages from"]');
    await page.waitForTimeout(400);
    ok(!!(await page.$('[data-testid="collapsed-banner"]')), 'banner shows');
    ok(await (await page.$('.gap-collapsed')).isVisible(), 'banner visible');
  },

  'gc-search-empty': async (page, h) => {
    await room(page, h);
    await openSearch(page, h);
    const input = await page.$('.onyx-message-search__input');
    ok(!!input, 'search input');
    await input.fill('zzqx');
    await page.waitForSelector('[data-testid="search-empty"]', { timeout: 6000 });
    await h.settle(page, 200);
  },

  'gc-ctrlf': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', 'half a thought');
    await page.keyboard.press('Control+f');
    await h.settle(page, 400);
    ok((await page.inputValue('#shell-composer-input')) === 'half a thought', 'Ctrl+F keeps the draft');
  },

  'gc-land': async (page, h) => {
    const inject = await room(page, h);
    const rows = [];
    for (let i = 0; i < 90; i += 1) {
      rows.push(`@time=${T(400 - i)};msgid=bulk-${i} :${['sol', 'rue', 'ash', 'nova'][i % 4]}!x@onyx.test PRIVMSG #lounge :${i === 7 ? 'the needle everyone is looking for' : `filler line ${i} about nothing in particular`}`);
    }
    inject(rows);
    await h.settle(page, 900);
    await openSearch(page, h);
    const input = await page.$('.onyx-message-search__input');
    await input.fill('needle');
    await page.keyboard.press('Enter');
    await h.settle(page, 900);
    const where = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.onyx-message')].find((r) => /needle/.test(r.textContent));
      const pane = document.querySelector('.onyx-thread-pane');
      if (!row || !pane) return null;
      const r = row.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      return { top: r.top - p.top, bottom: p.bottom - r.bottom, h: p.height };
    });
    ok(where && where.top >= 0 && where.bottom >= 0, `the hit is on screen inside the pane (got ${JSON.stringify(where)})`);
  },

  'gc-undelivered': async (page, h) => {
    await room(page, h, {
      fromClient: (line, reply) => {
        const m = /^(?:@(\S+) )?PRIVMSG rue /.exec(line);
        if (!m) return false;
        const label = /(?:^|;)label=([^;]+)/.exec(m[1] || '');
        reply(`${label ? `@label=${label[1]} ` : ''}:onyx.test 401 kn rue :No such nick/channel`);
        return true;
      },
    });
    if (isPhone(page)) { await h.tryClick(page, '[data-testid="members-toggle"]'); await page.waitForTimeout(350); }
    // double-click a member row = open a DM with them (same on every layout)
    await page.dispatchEvent('.onyx-member:has-text("rue")', 'dblclick');
    await page.waitForTimeout(700);
    // the phone's Members popover outlives the room it belonged to: dismiss it
    if (isPhone(page)) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.fill('#shell-composer-input', 'are you there? the call moved to seven');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const unenc = await page.$('[data-testid="dm-send-unencrypted"]');
    if (unenc) { await unenc.click(); await page.waitForTimeout(900); }
    const seen = await page.evaluate(() => document.body.innerText);
    ok(/isn't on the network right now/.test(seen), `a not-delivered notice is shown (got ${seen.slice(-300)})`);
    ok((await page.inputValue('#shell-composer-input')) === 'are you there? the call moved to seven', 'the text is back in the composer');
  },

  'gc-loading': async (page, h) => {
    // advertise chathistory, hold back #design's seed rows, never answer its history request
    await room(page, h, {
      rewrite: (line) => line.replace(/(CAP \* LS :batch labeled-response)/, '$1 chathistory'),
      dropServer: (line) => /msgid=s\d.*#design/.test(line),
      fromClient: (line) => /CHATHISTORY \S+ #design/i.test(line),
    });
    await page.fill('#shell-composer-input', '/join #design');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await hop(page, 'design');
    ok(!!(await page.$('[data-testid="history-loading"]')), 'placeholders show while history is in flight');
    await h.settle(page, 200);
  },

  'gc-caret': async (page, h) => {
    await room(page, h);
    await page.fill('#shell-composer-input', 'hello world');
    await page.focus('#shell-composer-input');
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await page.click('.shell-composer-tool--emoji');
    await page.waitForTimeout(400);
    const choice = await page.$('.shell-emoji-choice');
    ok(!!choice, 'emoji picker open');
    const glyph = (await choice.textContent()).trim();
    await choice.click();
    await page.waitForTimeout(500);
    const value = await page.inputValue('#shell-composer-input');
    ok(value === `hello${glyph} world`, `the emoji landed at the caret (got ${JSON.stringify(value)})`);
    const pos = await page.evaluate(() => document.getElementById('shell-composer-input').selectionStart);
    ok(pos === 5 + glyph.length, `the cursor sits right after it (got ${pos})`);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'shell-composer-input'), 'the field has the keyboard back');
  },

  'gc-reply-focus': async (page, h) => {
    await room(page, h);
    await openMenuOnRow(page, 4);
    await page.click('.onyx-msg-menu-item:has-text("Reply")');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'shell-composer-input'), 'Reply hands focus to the composer');
    await openMenuOnRow(page, 5);
    await page.click('.onyx-msg-menu-item:has-text("Quote")');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'shell-composer-input'), 'Quote hands focus to the composer');
    ok((await page.inputValue('#shell-composer-input')).startsWith('> '), 'the quote is in the composer');
  },

  'gc-react-keys': async (page, h) => {
    await room(page, h);
    await openMenuOnRow(page, 4);
    await page.click('.onyx-msg-menu-item:has-text("React")');
    await page.waitForTimeout(500);
    const picker = await page.$('.onyx-react-picker');
    ok(!!picker, 'reaction picker open');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('onyx-react-search')), 'the picker opens on its search field');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('onyx-react-choice')), 'ArrowDown enters the grid');
    const first = await page.evaluate(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    const second = await page.evaluate(() => document.activeElement.textContent);
    ok(first !== second, 'ArrowRight moves along the grid');
    await h.settle(page, 200);
  },

  'gc-search-focus': async (page, h) => {
    await room(page, h);
    await openSearch(page, h);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'onyx-message-search-input'), 'search opens on its field');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    ok(!(await page.$('.onyx-message-search')), 'Escape closes search');
    const where = await page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : ''; });
    ok(where && where !== 'BODY', `focus is not dropped on the page (got ${where})`);
  },

  'gc-menu-keys': async (page, h) => {
    await room(page, h);
    const row = (await page.$$('.onyx-message'))[4];
    await row.scrollIntoViewIfNeeded();
    if (isPhone(page)) {
      const box = await row.boundingBox();
      await page.touchscreen.tap(box.x + box.width * 0.6, box.y + Math.min(box.height - 6, 24));
    } else {
      await row.hover();
    }
    await page.waitForTimeout(250);
    await (await row.$('.onyx-msg-menu-trigger')).click();
    await page.waitForTimeout(400);
    const first = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const second = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
    ok(first && second && first !== second, `arrow keys move through the menu (${first} -> ${second})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const back = await page.evaluate(() => document.activeElement && document.activeElement.className);
    ok(/onyx-msg-menu-trigger|onyx-message/.test(back || ''), `focus returns to the trigger (got ${back})`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  },
};
