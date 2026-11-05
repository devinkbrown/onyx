#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens.mjs — real-browser screenshots of the Elm client for visual QA.
 *
 *   node elm/tools/screens.mjs --site DIR [--out DIR] [--only a,b] [--vp 320x568,1280x800]
 *
 * Ported from the v3 tool (claude/elm-port-fix-f381d5:elm/tools/screens.mjs)
 * and adapted to today's client: the runtime accepts only `wss:` endpoints,
 * so instead of a local plain-`ws:` IRC server the page's WebSocket is
 * answered by Playwright `routeWebSocket` (the same mock wire the e2e specs
 * use). Nothing touches the live network: every non-origin request aborts.
 *
 * `--site` is a staged build (`node tools/build-elm-site.mjs DIR`); the tool
 * serves it with SPA fallback on 127.0.0.1. Each scenario is shot at every
 * viewport (default 320x568, 390x844, 768x1024, 1280x800, 1920x1080). After
 * each shot the tool reports layout problems it can measure: horizontal
 * overflow and, under 768px, visible controls smaller than 44x44.
 */
/* global console, innerWidth, innerHeight, getComputedStyle */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (key, fallback) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : fallback; };
const site = opt('--site', '');
const out = resolve(opt('--out', '/tmp/onyx-screens'));
const only = opt('--only', '') ? opt('--only', '').split(',') : null;
const viewports = opt('--vp', '320x568,390x844,768x1024,1280x800,1920x1080')
  .split(',')
  .map(spec => { const [w, h] = spec.split('x').map(Number); return { width: w, height: h }; });
if (!site || !existsSync(join(site, 'index.html'))) {
  console.error('usage: node elm/tools/screens.mjs --site <staged build> (node tools/build-elm-site.mjs <dir>)');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// ---- static server with SPA fallback ----------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
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

// ---- mock IRC wire ------------------------------------------------------------
const MEMBERS = ['~mara', '@jun', '@iris', '+theo', 'sol', 'ash', 'nova', 'kip'];
function wire(socket) {
  let nick = 'guest';
  const send = (...lines) => lines.forEach(line => socket.send(line));
  const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  socket.onMessage(frame => {
    const line = String(frame).trim();
    const [cmd, ...rest] = line.replace(/^@\S+ /, '').split(' ');
    if (cmd === 'CAP' && rest[0] === 'LS') send(':onyx.test CAP * LS :server-time message-tags');
    else if (cmd === 'CAP' && rest[0] === 'REQ') send(`:onyx.test CAP * ACK ${rest.slice(1).join(' ')}`);
    else if (cmd === 'NICK') {
      const next = rest[0].replace(/^:/, '');
      if (nick !== 'guest' && next !== nick) send(`:${nick}!u@onyx.test NICK ${next}`);
      nick = next;
    } else if (cmd === 'CAP' && rest[0] === 'END') {
      send(`:onyx.test 001 ${nick} :Welcome to Onyx`,
        `:onyx.test 005 ${nick} CASEMAPPING=rfc1459 CHANTYPES=#& PREFIX=(qaohv)~&@%+ NETWORK=Onyx :are supported`,
        `:${nick}!u@onyx.test JOIN #lounge`,
        `:${nick}!u@onyx.test JOIN #design`,
        `@time=${ago(30)} :nova!n@onyx.test PRIVMSG ${nick} :hey — are you around for the call later?`);
    } else if (cmd === 'NAMES') {
      const room = rest[0];
      send(`:onyx.test 353 ${nick} = ${room} :${nick} ${MEMBERS.join(' ')}`, `:onyx.test 366 ${nick} ${room} :End of names`,
        `@time=${ago(40)} :mara!m@onyx.test PRIVMSG ${room} :Morning all — the new build is up on staging`,
        `@time=${ago(32)} :jun!j@onyx.test PRIVMSG ${room} :Nice. Release notes are on the roadmap page if anyone wants a look`,
        `@time=${ago(12)} :sol!s@onyx.test PRIVMSG ${room} :${nick}: welcome in! grab a seat`,
        `@time=${ago(2)} :mara!m@onyx.test PRIVMSG ${room} :Voice call at six, I will set it up.`);
    } else if (cmd === 'LIST') {
      send(`:onyx.test 321 ${nick} Channel :Users Name`, `:onyx.test 322 ${nick} #root 42 :The front door`,
        `:onyx.test 322 ${nick} #lounge 18 :Hang out, say hi`, `:onyx.test 323 ${nick} :End of /LIST`);
    } else if (cmd === 'PING') send(`:onyx.test PONG onyx.test ${rest.join(' ')}`);
  });
}

// ---- helpers ---------------------------------------------------------------------
const settle = (page, ms = 400) => page.waitForTimeout(ms);
async function clickVisible(page, selectors) {
  for (const selector of selectors) {
    for (const el of await page.locator(selector).all()) {
      if (await el.isVisible()) { await el.click(); await settle(page); return true; }
    }
  }
  return false;
}
async function shell(page, query = '&nick=screens') {
  await page.goto(`${origin}/app/?ws=${encodeURIComponent(WS)}${query}`);
  await page.waitForFunction(() => window.__onyxBooted === true);
  await settle(page, 900);
  for (let i = 0; i < 3 && await page.locator('[role="dialog"][aria-modal="true"]').count(); i += 1) {
    await page.keyboard.press('Escape');
    await settle(page, 200);
  }
}
async function openRooms(page) {
  await clickVisible(page, ['[data-testid="nav-rooms"]', 'button.onyx-client-panel-toggle[aria-controls="client-rooms"]']);
}
async function openRoom(page, room) {
  if (!await page.locator('#client-rooms').isVisible()) await openRooms(page);
  await clickVisible(page, [`#client-rooms button[title="${room}"]`]);
}

const scenarios = {
  // First load without ?nick= — the connect gate (or the old shell).
  gate: async page => { await page.goto(`${origin}/app/?ws=${encodeURIComponent(WS)}`); await page.waitForFunction(() => window.__onyxBooted === true); await settle(page, 900); },
  'gate-signin': async page => {
    await scenarios.gate(page);
    await clickVisible(page, ['[data-testid="connect-mode-signin"]']);
  },
  home: async page => { await shell(page); },
  'rooms-list': async page => { await shell(page); await openRooms(page); },
  room: async page => { await shell(page); await openRoom(page, '#lounge'); },
  dm: async page => { await shell(page); await clickVisible(page, ['[data-testid="nav-messages"]']); await clickVisible(page, ['#client-rooms button[title="nova"]']); },
  you: async page => { await shell(page); await clickVisible(page, ['[data-testid="nav-you"]', '.onyx-ident']); },
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium' });
const report = [];
for (const [name, run] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: vp, hasTouch: vp.width < 768, serviceWorkers: 'block' });
    await context.route('**/*', route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient')));
    await context.addInitScript(() => localStorage.setItem('onyx:first-hour-seen', '1'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket(WS, wire);
    try { await run(page); } catch (e) { errors.push(`scenario: ${e.message}`); }
    await settle(page, 300);
    const file = join(out, `${name}-${vp.width}x${vp.height}.png`);
    await page.screenshot({ path: file });
    const issues = await page.evaluate(phone => {
      const found = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > innerWidth) found.push(`horizontal overflow ${doc.scrollWidth}>${innerWidth}`);
      if (phone) {
        for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], [tabindex="0"]')) {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (!r.width || !r.height || style.visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight) continue;
          if (el.closest('.onyx-message, .onyx-body, p')) continue; // inline text links
          if (r.width < 44 || r.height < 44) found.push(`small target ${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}"`);
        }
      }
      return found;
    }, vp.width < 768);
    report.push({ shot: file, issues: [...errors, ...issues] });
    await context.close();
  }
}
await browser.close();
server.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
for (const entry of report) console.log(`${entry.shot}${entry.issues.length ? `\n  - ${entry.issues.join('\n  - ')}` : ''}`);
