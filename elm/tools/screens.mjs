#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens.mjs — real-browser screenshots of the Elm client for visual QA.
 *
 *   node elm/tools/screens.mjs [--out DIR] [--only name,name] [--dist elm/dist-elm]
 *
 * Serves the built bundle (elm/tools/build.sh output) on 127.0.0.1 with SPA
 * fallback, plus a tiny fake IRC-over-WebSocket server at /ws (registration,
 * CAP 302, a seeded room with members + varied messages, LIST, echo). The
 * page is pinned to it with ?ws=, so nothing touches the live network.
 * Drives the system Chromium (CHROMIUM=… overrides) through playwright-core.
 *
 * --extra FILE adds scenarios (see below). Each scenario is shot at phone (390x844, DPR 3, touch) and desktop
 * (1440x900). Writes PNGs + index.html contact sheet to --out.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const repo = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dist = resolve(repo, opt('--dist', 'elm/dist-elm'));
const out = resolve(repo, opt('--out', '/tmp/onyx-screens'));
const only = opt('--only', '') ? opt('--only', '').split(',') : null;
mkdirSync(out, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`no build at ${dist} — run: bash elm/tools/build.sh`);
  process.exit(1);
}

// ---- playwright-core from the repo's pnpm store ---------------------------
const pnpmDirs = [resolve(repo, 'node_modules/.pnpm'), resolve(repo, '../../../node_modules/.pnpm'), '/home/kain/onyx/node_modules/.pnpm'];
let pwPath = null;
for (const d of pnpmDirs) {
  if (!existsSync(d)) continue;
  const hit = (await import('node:fs')).readdirSync(d).find((n) => n.startsWith('playwright-core@'));
  if (hit) { pwPath = join(d, hit, 'node_modules/playwright-core'); break; }
}
if (!pwPath) { console.error('playwright-core not found in node_modules/.pnpm'); process.exit(1); }
const { chromium } = createRequire(import.meta.url)(pwPath);
const chromePath = process.env.CHROMIUM || ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => existsSync(p));

// ---- fake IRC server -------------------------------------------------------
const NET = 'onyx.test';
const now = () => new Date().toISOString();
const MEMBERS = ['~mara', '@jun', '@iris', '+theo', 'sol', 'ash', 'nova', 'kip', 'rue', 'lark'];
const seed = (nick, room) => {
  const t = (m) => new Date(Date.now() - m * 60000).toISOString();
  return [
    `@time=${t(190)};msgid=s1 :mara!m@onyx.test PRIVMSG ${room} :Morning all — the new build is up on staging 🎉`,
    `@time=${t(188)};msgid=s2 :jun!j@onyx.test PRIVMSG ${room} :Nice. Release notes are at https://eshmaki.me/roadmap if anyone wants a look`,
    `@time=${t(187)};msgid=s3 :jun!j@onyx.test PRIVMSG ${room} :also: **bold**, _italic_, \`inline code\` and ||a spoiler|| all render now`,
    `@time=${t(120)};msgid=s4 :iris!i@onyx.test PRIVMSG ${room} :> quoting the old thread\nyes, and the composer finally wraps on phones`,
    `@time=${t(64)};msgid=s5 :theo!t@onyx.test PRIVMSG ${room} :\`\`\`elm\nview model =\n    text "hello, onyx"\n\`\`\``,
    `@time=${t(12)};msgid=s6 :sol!s@onyx.test PRIVMSG ${room} :@${nick} welcome in! grab a seat in #lounge or #design`,
    `@time=${t(11)};msgid=s7 :sol!s@onyx.test PRIVMSG ${room} :voice call later at 6? :wave:`,
    `@time=${t(2)};msgid=s8 :mara!m@onyx.test PRIVMSG ${room} :Sounds good. I'll set it up 🙌`,
  ];
};

function wsAccept(key) {
  return createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
function wsFrame(text) {
  const p = Buffer.from(text);
  const head = p.length < 126 ? Buffer.from([0x81, p.length])
    : p.length < 65536 ? Buffer.from([0x81, 126, p.length >> 8, p.length & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(p.length), 2); return b; })();
  return Buffer.concat([head, p]);
}
function ircSession(sock) {
  let nick = 'guest';
  let registered = false;
  let capDone = false;
  const send = (...lines) => { for (const l of lines) { try { sock.write(wsFrame(l)); } catch { /* closed */ } } };
  const welcome = () => {
    if (registered || !capDone) return;
    registered = true;
    send(`:${NET} 001 ${nick} :Welcome to the Onyx network, ${nick}`,
      `:${NET} 002 ${nick} :Your host is ${NET}`,
      `:${NET} 005 ${nick} CHANTYPES=# PREFIX=(qaohv)~&@%+ NETWORK=Onyx CHANMODES=b,k,l,imnpst :are supported`,
      `:${NET} NOTICE ${nick} :mesh: 2 nodes linked | /HELP to get started`,
      `:${NET} 376 ${nick} :End of MOTD`);
  };
  const handle = (line) => {
    const m = /^(?:@\S+ )?(\S+)(?: (.*))?$/.exec(line.trim());
    if (!m) return;
    const cmd = m[1].toUpperCase();
    const rest = m[2] || '';
    const arg = rest.split(' ');
    if (cmd === 'CAP' && arg[0] === 'LS') send(`:${NET} CAP * LS * :server-time message-tags echo-message`, `:${NET} CAP * LS :batch labeled-response`);
    else if (cmd === 'CAP' && arg[0] === 'REQ') send(`:${NET} CAP * ACK ${rest.slice(4)}`);
    else if (cmd === 'CAP' && arg[0] === 'END') { capDone = true; welcome(); }
    else if (cmd === 'NICK') { nick = arg[0].replace(/^:/, ''); }
    else if (cmd === 'USER') { welcome(); }
    else if (cmd === 'PING') send(`:${NET} PONG ${NET} ${rest}`);
    else if (cmd === 'JOIN') {
      for (const room of arg[0].split(',')) {
        send(`@time=${now()} :${nick}!u@${NET} JOIN ${room}`,
          `:${NET} 332 ${nick} ${room} :Welcome to ${room} — be kind, stay curious. Voice at 6pm.`,
          `:${NET} 353 ${nick} = ${room} :${nick} ${MEMBERS.join(' ')}`,
          `:${NET} 366 ${nick} ${room} :End of /NAMES list.`,
          ...seed(nick, room));
      }
    } else if (cmd === 'LIST') {
      send(`:${NET} 321 ${nick} Channel :Users Name`,
        `:${NET} 322 ${nick} #root 42 :The front door of the Onyx network`,
        `:${NET} 322 ${nick} #lounge 18 :Hang out, say hi`,
        `:${NET} 322 ${nick} #design 9 :Pixels, type and taste`,
        `:${NET} 322 ${nick} #elm 6 :The v3 client`,
        `:${NET} 323 ${nick} :End of /LIST`);
    } else if (cmd === 'PRIVMSG' || cmd === 'NOTICE') {
      send(`@time=${now()};msgid=e${Date.now()} :${nick}!u@${NET} ${cmd} ${rest}`);
    } else if (cmd === 'WHO') {
      send(`:${NET} 315 ${nick} ${arg[0]} :End of /WHO list.`);
    }
  };
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = buf[1] & 128;
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const k = buf.subarray(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ k[i % 4])); }
      buf = buf.subarray(need);
      if (op === 8) { sock.end(); return; }
      if (op === 1) for (const l of payload.toString().split(/\r?\n/)) if (l) handle(l);
    }
  });
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
server.on('upgrade', (req, sock) => {
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(req.headers['sec-websocket-key'])}\r\n\r\n`);
  ircSession(sock);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const pin = `ws=${encodeURIComponent(base.replace('http', 'ws') + '/ws')}`;

// ---- scenarios -------------------------------------------------------------
const settle = (page, ms = 500) => page.waitForTimeout(ms);
async function joinRoom(page, nick = 'kn', room = '#lounge') {
  await page.goto(`${base}/app?${pin}`);
  await page.fill('#conn-nick', nick);
  if (room) await page.fill('#conn-room', room);
  await page.click('[data-testid="conn-submit"]');
  await page.waitForSelector('[data-testid="connect"]', { state: 'detached', timeout: 8000 });
  await settle(page, 900);
}
const tryClick = async (page, sel) => { const el = await page.$(sel); if (el) { await el.click().catch(() => {}); await settle(page); return true; } return false; };
// Click the first VISIBLE match of the first selector that has one: the
// shell renders both nav forms (rail + bottom nav) and hides one per
// viewport, so "first DOM match" is often an invisible control.
const clickVisible = async (page, selectors) => {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) { await el.click().catch(() => {}); await settle(page); return true; }
    }
  }
  return false;
};
// Phones push a conversation as its own page (no global bar, no bottom
// nav): step back to the list first wherever a back control shows.
const toShell = async (page) => {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) { await page.keyboard.press('Escape'); await settle(page, 250); }
  await clickVisible(page, ['[data-testid="room-back"]']);
};

const SCENARIOS = {
  'landing': async (p) => { await p.goto(`${base}/`); await settle(p, 800); },
  'about': async (p) => { await p.goto(`${base}/about`); await settle(p, 800); },
  'download': async (p) => { await p.goto(`${base}/download`); await settle(p, 800); },
  'connect': async (p) => { await p.goto(`${base}/app?${pin}`); await settle(p, 800); },
  'home': async (p) => { await joinRoom(p, 'kn', ''); },
  'room': async (p) => { await joinRoom(p); },
  'room-composer': async (p) => { await joinRoom(p); await p.fill('.onyx-composer input, .onyx-composer textarea', '/'); await settle(p); },
  'you-hub': async (p) => { await joinRoom(p); await toShell(p); await clickVisible(p, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]', '.onyx-primary-nav [data-testid="nav-you"]']); },
  'inbox': async (p) => { await joinRoom(p); await toShell(p); await clickVisible(p, ['.shell-ribbon-bell', '[data-testid="inbox-open"]']); },
  'palette': async (p) => { await joinRoom(p); await p.keyboard.press('Control+k'); await settle(p); },
  'room-more': async (p) => { await joinRoom(p); await tryClick(p, '[data-testid="room-more"], .onyx-room-more'); },
  'browse': async (p) => { await joinRoom(p); await toShell(p); await clickVisible(p, ['[data-testid="sidebar-browse-rooms"]', '[data-testid="browse-rooms"]', 'button:has-text("Browse rooms")']); await settle(p, 600); },
  'calls': async (p) => { await joinRoom(p); await toShell(p); await clickVisible(p, ['.onyx-mobile-nav [data-testid="nav-calls"]', '.onyx-primary-nav [data-testid="nav-calls"]', '.onyx-calls-toggle']); },
};
// --extra path/to/scenarios.mjs : default-export { name: async (page, h) => … }
// where h = { base, pin, joinRoom, tryClick, settle }.
const extra = opt('--extra', '');
if (extra) {
  const mod = await import(resolve(process.cwd(), extra));
  const h = { base, pin, joinRoom, tryClick, settle };
  for (const [k, fn] of Object.entries(mod.default || {})) SCENARIOS[k] = (p) => fn(p, h);
}
// Aspect-ratio matrix. Select with --vp a,b,c or --vp all (default:
// phone,desktop). Touch entries emulate mobile (isMobile + hasTouch).
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const touch = (w, h, dpr, ua) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: ua });
const MATRIX = {
  se: touch(320, 568, 2, IPHONE_UA),            // iPhone SE 1st gen / smallest supported
  phone: touch(390, 844, 3, IPHONE_UA),         // iPhone 15
  promax: touch(430, 932, 3, IPHONE_UA),        // iPhone 15 Pro Max
  'phone-land': touch(844, 390, 3, IPHONE_UA),  // iPhone 15 landscape
  fold: touch(344, 882, 3),                     // foldable, folded (very tall/narrow)
  'fold-open': touch(673, 841, 2.6),            // foldable, unfolded (near-square)
  tablet: touch(820, 1180, 2, IPAD_UA),         // iPad Air portrait
  'tablet-land': touch(1180, 820, 2, IPAD_UA),  // iPad Air landscape
  'ipad-pro-land': touch(1366, 1024, 2, IPAD_UA),
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
  'laptop-short': { viewport: { width: 1366, height: 600 }, deviceScaleFactor: 1 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  fhd: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  ultrawide: { viewport: { width: 2560, height: 1080 }, deviceScaleFactor: 1 },
  'ultrawide-qhd': { viewport: { width: 3440, height: 1440 }, deviceScaleFactor: 1 },
};
const vpArg = opt('--vp', 'phone,desktop');
const vpNames = vpArg === 'all' ? Object.keys(MATRIX) : vpArg.split(',');
const VIEWPORTS = {};
for (const n of vpNames) {
  if (!MATRIX[n]) { console.error(`unknown viewport ${n}; known: ${Object.keys(MATRIX).join(', ')}`); process.exit(2); }
  VIEWPORTS[n] = MATRIX[n];
}

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const shots = [];
const problems = [];
for (const [name, run] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(name)) continue;
  for (const [vp, ctxOpts] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ ...ctxOpts, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}/${vp}: pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}/${vp}: console ${m.text()}`); });
    try {
      await run(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${name}/${vp}: horizontal overflow ${overflow}px`);
      const file = `${name}--${vp}.png`;
      await page.screenshot({ path: join(out, file), fullPage: vp === 'phone' ? false : false });
      shots.push({ name, vp, file });
    } catch (e) {
      problems.push(`${name}/${vp}: FAILED ${e.message.split('\n')[0]}`);
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset=utf-8><title>Onyx screens</title><style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}figure{display:inline-block;margin:8px;vertical-align:top}img{max-height:640px;border:1px solid #333}</style>${shots.map((s) => `<figure><img src="${s.file}"><figcaption>${s.name} — ${s.vp}</figcaption></figure>`).join('')}<pre>${problems.join('\n')}</pre>`);
console.log(`shots: ${shots.length} -> ${out}`);
for (const p of problems) console.log('PROBLEM', p);
