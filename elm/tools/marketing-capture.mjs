#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * marketing-capture.mjs — product screenshots for the public site.
 *
 *   node tools/build-elm-site.mjs /tmp/onyx-site
 *   node elm/tools/marketing-capture.mjs /tmp/onyx-site elm/marketing
 *
 * Shoots the real Elm shell (served from a staged build on 127.0.0.1)
 * against a mocked wire — the same Playwright routeWebSocket approach as
 * elm/tools/screens.mjs — with demo names, at 2x, then encodes each shot
 * with Chromium's canvas encoder to WebP (primary) and JPEG (fallback) at
 * 1x and 2x: elm/marketing/<name>-{1x,2x}.{webp,jpg}. Nothing touches the
 * live network: every non-origin request aborts. Transient chrome a
 * returning user would not see (guest-claim chip, unread jump, reading
 * bar, topic picker) is hidden before the shot. The shell is dark-only, so
 * there is one variant per shot; the site's CSS device frames adapt to
 * light and dark around it.
 */
/* global console, Image */
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const [site, out, onlyArg] = process.argv.slice(2);
if (!site || !out) { console.error('usage: node elm/tools/marketing-capture.mjs <staged site> <out dir> [names]'); process.exit(2); }
const raw = join(out, '.raw');
mkdirSync(raw, { recursive: true });
const only = onlyArg ? onlyArg.split(',') : null;
mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(site, path);
  if (!file.startsWith(resolve(site))) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(site, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const WS = 'wss://screens.test/ws';
const MEMBERS = ['~mara', '@jun', '@iris', '+theo', 'sol', 'ash', 'nova', 'kip', 'lena', 'omar'];
const BASE = Date.now();
const at = (h, m) => new Date(BASE - ((18 * 60 + 12) - (h * 60 + m)) * 60000).toISOString();
function wire(socket) {
  let nick = 'guest';
  const send = (...lines) => lines.forEach(line => socket.send(line));
  socket.onMessage(frame => {
    const line = String(frame).trim();
    const [cmd, ...rest] = line.replace(/^@\S+ /, '').split(' ');
    if (cmd === 'CAP' && rest[0] === 'LS') send(':onyx.test CAP * LS :server-time message-tags');
    else if (cmd === 'CAP' && rest[0] === 'REQ') send(`:onyx.test CAP * ACK ${rest.slice(1).join(' ')}`);
    else if (cmd === 'NICK') { nick = rest[0].replace(/^:/, ''); }
    else if (cmd === 'CAP' && rest[0] === 'END') {
      send(`:onyx.test 001 ${nick} :Welcome to Onyx`,
        `:onyx.test 005 ${nick} CASEMAPPING=rfc1459 CHANTYPES=#& PREFIX=(qaohv)~&@%+ NETWORK=Onyx :are supported`,
        `:${nick}!u@onyx.test JOIN #lounge`, `:${nick}!u@onyx.test JOIN #game-night`, `:${nick}!u@onyx.test JOIN #photography`,
        `@time=${at(18, 2)} :nova!n@onyx.test PRIVMSG ${nick} :are you coming to the call tonight?`,
        `@time=${at(18, 3)} :nova!n@onyx.test PRIVMSG ${nick} :theo's starting it in #lounge at 9`,
        `@time=${at(18, 4)} :nova!n@onyx.test PRIVMSG ${nick} :I saved you a spot — bring the playlist 🎧`,
        `@time=${at(18, 6)} :nova!n@onyx.test PRIVMSG ${nick} :see you there ✨`);
    } else if (cmd === 'NAMES') {
      const room = rest[0];
      const topic = room === '#lounge' ? 'Say hi, stay a while · voice call Fridays at 9' : room === '#game-night' ? 'Fridays at 9 — bring snacks' : 'Share a shot a day';
      send(`:onyx.test 332 ${nick} ${room} :${topic}`,
        `:onyx.test 353 ${nick} = ${room} :${nick} ${MEMBERS.join(' ')}`, `:onyx.test 366 ${nick} ${room} :End of names`);
      if (room === '#lounge') send(
        `@time=${at(17, 41)} :mara!m@onyx.test PRIVMSG ${room} :Morning everyone! Coffee's on ☕`,
        `@time=${at(17, 43)} :jun!j@onyx.test PRIVMSG ${room} :Morning. Did anyone finish the book for Sunday?`,
        `@time=${at(17, 44)} :iris!i@onyx.test PRIVMSG ${room} :Two chapters left. No spoilers please 🙏`,
        `@time=${at(17, 52)} :theo!t@onyx.test PRIVMSG ${room} :I'm starting a voice call at 9 — same room as last week`,
        `@time=${at(17, 53)} :sol!s@onyx.test PRIVMSG ${room} :I'm in. I'll bring the playlist`,
        `@time=${at(17, 55)} :lena!l@onyx.test PRIVMSG ${room} :Count me in too`,
        `@time=${at(18, 1)} :mara!m@onyx.test PRIVMSG ${room} :Perfect. See you all at 9!`);
    } else if (cmd === 'LIST') {
      send(`:onyx.test 321 ${nick} Channel :Users Name`, `:onyx.test 322 ${nick} #root 42 :The front door`,
        `:onyx.test 322 ${nick} #lounge 18 :Say hi, stay a while`, `:onyx.test 323 ${nick} :End of /LIST`);
    } else if (cmd === 'PING') send(`:onyx.test PONG onyx.test ${rest.join(' ')}`);
  });
}
const settle = (page, ms = 400) => page.waitForTimeout(ms);
async function clickVisible(page, selectors) {
  for (const s of selectors) for (const el of await page.locator(s).all()) if (await el.isVisible()) { await el.click(); await settle(page); return true; }
  return false;
}
async function shell(page) {
  await page.goto(`${origin}/app/?ws=${encodeURIComponent(WS)}&nick=alex`);
  await page.waitForFunction(() => window.__onyxBooted === true);
  await settle(page, 1200);
  for (let i = 0; i < 3 && await page.locator('[role="dialog"][aria-modal="true"]').count(); i += 1) { await page.keyboard.press('Escape'); await settle(page, 200); }
}
async function openRoom(page, room) {
  if (!await page.locator('#client-rooms').isVisible()) await clickVisible(page, ['[data-testid="nav-rooms"]', 'button.onyx-client-panel-toggle[aria-controls="client-rooms"]']);
  await clickVisible(page, [`#client-rooms button[title="${room}"]`]);
}
async function tidy(page) {
  // Transient chrome that a returning user would not see: the claim toast,
  // the reconnect banner and the unread jump pill.
  await page.addStyleTag({ content: '.guest-claim-chip, .onyx-unread-jump-wrap, .onyx-unread-divider, .onyx-reading-bar, .onyx-topic, .onyx-connection-banner, [class*="connectivity"], [class*="net-banner"] { display: none !important; }' });
  await page.evaluate(() => { for (const el of document.querySelectorAll('.onyx-transcript, .onyx-thread-pane, .onyx-thread')) el.scrollTop = el.scrollHeight; });
  await settle(page, 500);
}
const scenarios = {
  'room-desktop': { vp: { width: 1280, height: 800 }, run: async p => { await shell(p); await openRoom(p, '#lounge'); } },
  'room-phone': { vp: { width: 390, height: 844 }, run: async p => { await shell(p); await openRoom(p, '#lounge'); } },
  'dm-phone': { vp: { width: 390, height: 844 }, run: async p => {
    await shell(p); await clickVisible(p, ['[data-testid="nav-messages"]']); await clickVisible(p, ['#client-rooms button[title="nova"]']);
  } },
  'inbox-phone': { vp: { width: 390, height: 844 }, run: async p => { await shell(p); await openRoom(p, '#lounge'); await clickVisible(p, ['[data-testid="inbox-bell"]']); } },
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium' });
for (const [name, sc] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  const context = await browser.newContext({ viewport: sc.vp, deviceScaleFactor: 2, hasTouch: sc.vp.width < 768, serviceWorkers: 'block', colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.route('**/*', route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient')));
  await context.addInitScript(() => localStorage.setItem('onyx:first-hour-seen', '1'));
  const page = await context.newPage();
  page.on('pageerror', e => console.log(name, 'pageerror', e.message));
  await page.routeWebSocket(WS, wire);
  await sc.run(page);
  await settle(page, 2500);
  await tidy(page);
  await page.screenshot({ path: join(raw, `${name}.png`) });
  console.log('shot', name);
  await context.close();
}
server.close();

// ---- encode: WebP + JPEG fallback at 1x and 2x --------------------------------
const widths = { 'room-desktop': 1280, 'room-phone': 390, 'dm-phone': 390, 'inbox-phone': 390 };
const encoder = await browser.newPage();
for (const name of Object.keys(scenarios)) {
  if (only && !only.includes(name)) continue;
  const b64 = readFileSync(join(raw, `${name}.png`)).toString('base64');
  for (const [scale, suffix] of [[1, '1x'], [2, '2x']]) {
    for (const [mime, ext, q] of [['image/webp', 'webp', 0.8], ['image/jpeg', 'jpg', 0.82]]) {
      const data = await encoder.evaluate(async ({ b64, width, mime, q }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const h = Math.round(img.height * width / img.width);
        const c = document.createElement('canvas'); c.width = width; c.height = h;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, width, h);
        return c.toDataURL(mime, q).split(',')[1];
      }, { b64, width: widths[name] * scale, mime, q });
      writeFileSync(join(out, `${name}-${suffix}.${ext}`), Buffer.from(data, 'base64'));
    }
  }
  console.log('encoded', name);
}
await browser.close();
rmSync(raw, { recursive: true, force: true });
