#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * call-e2e.mjs — real two-browser voice/video call against a THROWAWAY local
 * Onyx Server node. Never touches the live network.
 *
 *   node elm/tools/call-e2e.mjs [--dist elm/dist-elm] [--out DIR]
 *                               [--server-bin PATH] [--keep-node] [--reuse-node]
 *                               [--skip-video] [--shots]
 *
 * 1. Node: starts the reference daemon (default
 *    /home/kain/onyx-server/zig-out/bin/onyx-server) with a fresh temp dir,
 *    a generated config and a throwaway ECDSA P-256 cert (browser media
 *    requires a protected WebSocket — server.zig requireCaller). Listeners
 *    bind 127.0.0.1 only (wss 18080, irc 16667), no mesh links. When the
 *    binary cannot run on this CPU (SIGILL — it is built for the native
 *    CPU of the build host) it boots the SAME binary in a tiny TCG-emulated
 *    VM (qemu-system-x86_64 -cpu max, host kernel, busybox initramfs) with
 *    127.0.0.1-only port forwards and no guest outbound network.
 * 2. Registers two fresh accounts (media E2EE needs an account + an
 *    enrolled device key; the Elm client enrolls on sign-in).
 * 3. Serves the Elm build and drives two headless Chromium contexts
 *    (fake mic/camera) through sign-in → join one room's call, then
 *    asserts: both in_call; each sees the other (engine peers + Elm stage);
 *    E2EE group key active; encrypted Cadence frames flow both ways and
 *    decode; remote speaking; mute propagates; camera on → peer gets video;
 *    leave cleans up on both sides; DM ring is reported unsupported by the
 *    server (no MEDIA target other than a channel — media_cmd.zig).
 * 4. Stops everything (unless --keep-node). Exit code 0 = all checks passed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const repo = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const dist = resolve(repo, opt('--dist', 'elm/dist-elm'));
const out = resolve(opt('--out', join(tmpdir(), 'onyx-call-e2e')));
const serverBin = opt('--server-bin', process.env.ONYX_SERVER_BIN || '/home/kain/onyx-server/zig-out/bin/onyx-server');
const stateDir = resolve(opt('--state', join(tmpdir(), 'onyx-call-node')));
const WS_PORT = Number(opt('--ws-port', '18080'));
const IRC_PORT = Number(opt('--irc-port', '16667'));
const WS_URL = `wss://127.0.0.1:${WS_PORT}/`;
mkdirSync(out, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`no build at ${dist} — run: bash elm/tools/build.sh`);
  process.exit(1);
}
// Throwaway self-signed cert on a loopback-only node.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 30000, every = 250, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// ---- 1. the local node ------------------------------------------------------
const CONFIG = (host, dir) => `# Throwaway local Onyx Server node (call-e2e). Never meshed.
[node]
id = 1

[listen]
host = "${host}"
irc  = ${IRC_PORT}
ws   = ${WS_PORT}

[tls]
enabled   = true
port      = ${IRC_PORT + 30}
cert_path = "${dir}/cert.pem"
key_path  = "${dir}/key.pem"

[media]
enabled = true
ws_media_relay = true
ws_media_require_mac = false

[sasl]
enabled = true
account_db = "${dir === '/srv' ? '/tmp' : dir}/accounts.wal"

[accounts]
pbkdf2_rounds = 10000

# The built-in default class (conn_class.zig): Cadence camera frames run
# ~70 KB each, which overruns the stock 1 MiB SendQ and aborts receivers.
[class.user]
sendq = "32M"
`;

function makeCert(dir) {
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-days', '7', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('openssl could not mint the throwaway cert');
}

function runsNatively(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
  return r.status === 0 && /Onyx Server/.test(r.stdout + r.stderr);
}

async function wssReady(timeout) {
  return until(() => new Promise((res) => {
    let done = false;
    const ws = new WebSocket(WS_URL);
    const finish = (v) => { if (!done) { done = true; try { ws.close(); } catch { /* */ } res(v); } };
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    setTimeout(() => finish(false), 4000);
  }), { timeout, every: 1000, label: `wss on ${WS_PORT}` });
}

async function startNode() {
  if (!existsSync(serverBin)) throw new Error(`server binary missing: ${serverBin}`);
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  const logFile = join(stateDir, 'node.log');
  if (runsNatively(serverBin)) {
    makeCert(stateDir);
    writeFileSync(join(stateDir, 'onyx.toml'), CONFIG('127.0.0.1', stateDir));
    const child = spawn(serverBin, [join(stateDir, 'onyx.toml')], { cwd: stateDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const log = [];
    child.stdout.on('data', (d) => log.push(String(d)));
    child.stderr.on('data', (d) => log.push(String(d)));
    writeFileSync(join(stateDir, 'node.pid'), String(child.pid));
    await wssReady(60000);
    return { mode: 'native', stop: () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } writeFileSync(logFile, log.join('')); } };
  }
  // VM path: same binary, emulated CPU.
  const kernel = ['/boot/vmlinuz-lts', '/boot/vmlinuz'].find((k) => existsSync(k));
  const qemu = spawnSync('which', ['qemu-system-x86_64'], { encoding: 'utf8' }).stdout.trim();
  const busybox = spawnSync('which', ['busybox'], { encoding: 'utf8' }).stdout.trim();
  if (!kernel || !qemu || !busybox) throw new Error(`${serverBin} does not run on this CPU and no qemu/kernel/busybox to emulate it`);
  const root = join(stateDir, 'root');
  for (const d of ['bin', 'lib', 'dev', 'proc', 'sys', 'tmp', 'etc', 'srv']) mkdirSync(join(root, d), { recursive: true });
  copyFileSync(busybox, join(root, 'bin/busybox'));
  const ld = readdirSync('/lib').find((n) => /^ld-musl-.*\.so\.1$/.test(n));
  if (ld) copyFileSync(join('/lib', ld), join(root, 'lib', ld));
  const kver = readdirSync('/lib/modules')[0];
  const e1000 = join('/lib/modules', kver, 'kernel/drivers/net/ethernet/intel/e1000/e1000.ko.gz');
  writeFileSync(join(root, 'lib/e1000.ko'), spawnSync('gzip', ['-dc', e1000], { maxBuffer: 1 << 26 }).stdout);
  const strip = spawnSync('strip', ['--strip-debug', '-o', join(root, 'srv/onyx-server'), serverBin]);
  if (strip.status !== 0) copyFileSync(serverBin, join(root, 'srv/onyx-server'));
  makeCert(join(root, 'srv'));
  writeFileSync(join(root, 'srv/onyx.toml'), CONFIG('0.0.0.0', '/srv'));
  writeFileSync(join(root, 'init'), `#!/bin/busybox sh
/bin/busybox --install -s /bin
mount -t proc proc /proc; mount -t sysfs sys /sys; mount -t devtmpfs dev /dev 2>/dev/null; mount -t tmpfs tmpfs /tmp
insmod /lib/e1000.ko
ip link set lo up; ip link set eth0 up; ip addr add 10.0.2.15/24 dev eth0; ip route add default via 10.0.2.2
echo "127.0.0.1 localhost" > /etc/hosts; : > /etc/resolv.conf
cd /srv && /srv/onyx-server /srv/onyx.toml 2>&1
poweroff -f
`, { mode: 0o755 });
  const initrd = join(stateDir, 'initrd.gz');
  const pack = spawnSync('sh', ['-c', `cd "${root}" && find . | cpio -o -H newc 2>/dev/null | gzip -1 > "${initrd}"`]);
  if (pack.status !== 0) throw new Error('initramfs pack failed');
  const pidFile = join(stateDir, 'qemu.pid');
  const vm = spawn(qemu, ['-pidfile', pidFile, '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', '2', '-m', '1536',
    '-nographic', '-no-reboot', '-kernel', kernel, '-initrd', initrd,
    '-append', 'console=ttyS0 quiet rdinit=/init panic=-1',
    '-netdev', `user,id=n0,restrict=on,hostfwd=tcp:127.0.0.1:${WS_PORT}-:${WS_PORT},hostfwd=tcp:127.0.0.1:${IRC_PORT}-:${IRC_PORT}`,
    '-device', 'e1000,netdev=n0'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const log = [];
  vm.stdout.on('data', (d) => log.push(String(d)));
  vm.stderr.on('data', (d) => log.push(String(d)));
  await wssReady(180000);
  return { mode: 'vm (TCG, -cpu max)', stop: () => { try { process.kill(-vm.pid, 'SIGTERM'); } catch { /* gone */ } writeFileSync(logFile, log.join('')); } };
}

/** Register one account over the raw socket (REGISTER logs in at once). */
function registerAccount(account, password) {
  return new Promise((resolveP, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error(`REGISTER ${account} timed out`)); }, 420000);
    ws.onopen = () => { ws.send(`NICK reg${randomBytes(3).toString('hex')}`); ws.send('USER r 0 * :r'); };
    ws.onmessage = (e) => {
      const t = String(e.data);
      if (t.startsWith('PING ')) { ws.send(`PONG ${t.slice(5)}`); return; }
      if (/ 001 /.test(t)) ws.send(`REGISTER ${account} * ${password}`);
      if (/REGISTER SUCCESS/.test(t)) { clearTimeout(timer); ws.send('QUIT :registered'); resolveP(); }
      else if (/REGISTER|ACCOUNT/.test(t) && /FAIL/.test(t)) { clearTimeout(timer); reject(new Error(t)); }
    };
    ws.onerror = () => {};
  });
}

// ---- 3. static server for the Elm build -------------------------------------
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};
function serveDist() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function loadChromium() {
  const dirs = [resolve(repo, 'node_modules/.pnpm'), resolve(repo, '../../../node_modules/.pnpm'), '/home/kain/onyx/node_modules/.pnpm'];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d).find((n) => n.startsWith('playwright-core@'));
    if (hit) return createRequire(import.meta.url)(join(d, hit, 'node_modules/playwright-core')).chromium;
  }
  throw new Error('playwright-core not found in node_modules/.pnpm');
}

// ---- 4. the call --------------------------------------------------------------
const ROOM = `#call${randomBytes(2).toString('hex')}`;
const stats = (page) => page.evaluate(() => (window.OnyxVoiceEngine && window.OnyxVoiceEngine.stats()) || null);
const showStage = (page) => page.evaluate(() => { const st = document.querySelector('[data-testid="voice-stage"]'); if (st) st.scrollIntoView({ block: 'start' }); });
const shoot = async (page, file) => { await showStage(page); await sleep(250); await page.screenshot({ path: join(out, file) }); };
const peerOf = (s, nick) => (s && s.peers || []).find((p) => p.nick.toLowerCase() === nick.toLowerCase());

async function signIn(page, base, nick, password) {
  await page.goto(`${base}/app?ws=${encodeURIComponent(WS_URL)}`);
  await page.click('[data-testid="conn-modes"] button:has-text("Sign in")');
  await page.fill('#conn-nick', nick);
  await page.fill('#conn-password', password);
  await page.fill('#conn-room', ROOM);
  await page.click('[data-testid="conn-submit"]');
  await page.waitForSelector('[data-testid="connect"]', { state: 'detached', timeout: 120000 });
  await until(async () => (await stats(page))?.account, { timeout: 120000, label: `${nick} logged in` });
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function main() {
  let node = null;
  let server = null;
  let browser = null;
  const pageErrors = [];
  try {
    const reuse = flag('--reuse-node');
    const accounts = { a: { nick: `ana${randomBytes(2).toString('hex')}`, pass: 'callpass-a-1234' }, b: { nick: `ben${randomBytes(2).toString('hex')}`, pass: 'callpass-b-1234' } };
    if (reuse && existsSync(join(stateDir, 'accounts.json'))) {
      Object.assign(accounts, JSON.parse(readFileSync(join(stateDir, 'accounts.json'), 'utf8')));
      await wssReady(10000);
      console.log(`node: reusing the running local node (${WS_URL})`);
    } else {
      node = await startNode();
      console.log(`node: ${node.mode} — ${WS_URL} (state ${stateDir})`);
      const t0 = Date.now();
      for (const who of ['a', 'b']) await registerAccount(accounts[who].nick, accounts[who].pass);
      console.log(`node: registered ${accounts.a.nick}, ${accounts.b.nick} in ${Math.round((Date.now() - t0) / 1000)}s`);
      writeFileSync(join(stateDir, 'accounts.json'), JSON.stringify(accounts));
    }
    check('local node up and accounts registered', true, `${accounts.a.nick} / ${accounts.b.nick}`);

    server = await serveDist();
    const base = `http://127.0.0.1:${server.address().port}`;
    const chromium = loadChromium();
    const chromePath = process.env.CHROMIUM || ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => existsSync(p));
    browser = await chromium.launch({
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
    });
    const open = async (who, { webkitApis, ...device }) => {
      const ctx = await browser.newContext({ ...device, ignoreHTTPSErrors: true, permissions: ['microphone', 'camera'] });
      device.webkitApis = webkitApis;
      if (device.webkitApis) {
        // WebKit (iOS Safari) lacks these: drive the engine's main-thread
        // camera fallback and the no-screen-picker path in Chromium.
        await ctx.addInitScript(() => {
          try { delete window.MediaStreamTrackProcessor; } catch { /* */ }
          window.MediaStreamTrackProcessor = undefined;
          try { if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = undefined; } catch { /* */ }
        });
      }
      const page = await ctx.newPage();
      page.on('pageerror', (e) => pageErrors.push(`${who}: ${e.message}`));
      page.on('console', (m) => { if (/\[onyx\]/.test(m.text())) console.log(`  ${who} console: ${m.text().slice(0, 200)}`); });
      return page;
    };
    // A: desktop. B: iPhone 15 emulation (390x844 @3x, touch, iPhone UA) —
    // Chromium's engine with WebKit's UA/viewport, so the iOS code paths
    // (no screen share, gesture capture, audio unlock) are exercised.
    const A = await open('A', { viewport: { width: 1440, height: 900 } });
    const B = await open('B', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, webkitApis: true });
    const a = accounts.a.nick;
    const b = accounts.b.nick;

    await Promise.all([signIn(A, base, a, accounts.a.pass), signIn(B, base, b, accounts.b.pass)]);
    check('both signed in with SASL (SCRAM) on the local node', true);
    check('engine mounted (window.OnyxVoiceEngine)', await A.evaluate(() => typeof window.OnyxVoiceEngine?.joinVoice === 'function'));

    // A starts the call from the room header; B joins from the invite banner.
    await A.click('[data-testid="ribbon-join-call"]');
    const sa = await until(async () => { const s = await stats(A); return s?.callState === 'in_call' && s.joinedRoom ? s : null; }, { timeout: 60000, label: 'A in_call' });
    check('A joined the room call', sa.callChannel?.toLowerCase() === ROOM, `${sa.callChannel}`);
    await B.waitForSelector('[data-testid="call-join-voice"], [data-testid="ribbon-join-call"], [data-testid="ribbon-voice-chip"]', { timeout: 30000 });
    const bJoin = (await B.$('[data-testid="call-join-voice"]')) || (await B.$('[data-testid="ribbon-voice-chip"]')) || (await B.$('[data-testid="ribbon-join-call"]'));
    await bJoin.click();
    await until(async () => (await stats(B))?.callState === 'in_call', { timeout: 60000, label: 'B in_call' });
    check('B joined the same call', true);
    const [ja, jb] = [await stats(A), await stats(B)];
    check('device keys enrolled before the E2EE handshake (IDENTITY ADD)', ja.enrolled && jb.enrolled && !ja.lastMediaFail && !jb.lastMediaFail,
      `A enrolled=${ja.enrolled} fail=${ja.lastMediaFail || '-'}; B enrolled=${jb.enrolled} fail=${jb.lastMediaFail || '-'}`);
    check('capture started inside the click gesture (A desktop, B iPhone)', ja.joinGesture === true && jb.joinGesture === true,
      `A ${ja.joinGesture}, B ${jb.joinGesture}`);
    check('iPhone profile detected on B (no screen share platform)', jb.platform?.ios === true && jb.platform?.canShareScreen === false);

    // Roster: each engine sees the other; Elm renders the other's tile.
    await until(async () => peerOf(await stats(A), b) && peerOf(await stats(B), a), { timeout: 60000, label: 'engine peers' });
    check('engine roster: each side sees the other peer', true);
    const tiles = async (page, nick) => page.evaluate((n) => [...document.querySelectorAll('[data-voice-tile]')].some((el) => (el.getAttribute('data-voice-tile') || '').toLowerCase() === `peer:${n.toLowerCase()}`)
      || [...document.querySelectorAll('.onyx-call-tile, [data-tile], [data-nick]')].some((el) => (el.textContent || '').toLowerCase().includes(n.toLowerCase())), nick);
    check('call stage shows the peer (A sees B)', await until(() => tiles(A, b), { timeout: 30000, label: 'A tile for B' }).catch(() => false));
    check('call stage shows the peer (B sees A)', await until(() => tiles(B, a), { timeout: 30000, label: 'B tile for A' }).catch(() => false));

    // Calls join muted (spec §2.3, muteOnJoin): unmute both so the fake mic's
    // tone gets past the encoder's silence gate.
    const unmute = async (page) => {
      const btn = await page.waitForSelector('[data-testid="call-mute"]', { timeout: 15000 });
      if (/unmute/i.test((await btn.getAttribute('aria-label')) || '')) await btn.click();
    };
    await unmute(A);
    await unmute(B);
    await until(async () => peerOf(await stats(B), a)?.muted === false && peerOf(await stats(A), b)?.muted === false, { timeout: 20000, label: 'both unmuted' }).then(
      () => check('unmute propagates both ways (server MEDIA UNMUTE → peer state)', true),
      (e) => check('unmute propagates both ways (server MEDIA UNMUTE → peer state)', false, e.message));

    // E2EE + media both ways.
    await until(async () => (await stats(A))?.e2eeActive && (await stats(B))?.e2eeActive, { timeout: 60000, label: 'E2EE group key on both' }).then(
      () => check('media E2EE group key active on both sides', true),
      (e) => check('media E2EE group key active on both sides', false, e.message));
    const flow = await until(async () => {
      const [x, y] = [await stats(A), await stats(B)];
      return x.framesOut > 50 && y.framesOut > 50 && x.framesIn > 50 && y.framesIn > 50 && x.framesDecoded > 20 && y.framesDecoded > 20 ? [x, y] : null;
    }, { timeout: 60000, label: 'frames both ways' }).catch(async (e) => { console.log('  stats A', JSON.stringify(await stats(A))); console.log('  stats B', JSON.stringify(await stats(B))); throw e; });
    check('encrypted Cadence frames flow A→B and B→A and decode', true,
      `A out ${flow[0].framesOut}/in ${flow[0].framesIn}/decoded ${flow[0].framesDecoded}; B out ${flow[1].framesOut}/in ${flow[1].framesIn}/decoded ${flow[1].framesDecoded}`);
    check('server rejected no media frames', (flow[0].framesRejected + flow[1].framesRejected) === 0, `A ${flow[0].framesRejected}, B ${flow[1].framesRejected}`);
    // Speaking: decoded-audio RMS in the engine, and the server's
    // SPEAKING/SILENT broadcast (the adapter announces local voice activity)
    // lighting the peer's cell in the Elm stage.
    const domSpeaking = (page, nick) => page.evaluate((n) => [...document.querySelectorAll('[data-speaking="true"]')]
      .some((el) => (el.getAttribute('data-nick') || el.getAttribute('aria-label') || '').toLowerCase().includes(n.toLowerCase())), nick);
    const spoke = await until(async () => peerOf(await stats(A), b)?.speaking || peerOf(await stats(B), a)?.speaking, { timeout: 30000, label: 'remote speaking' }).catch(() => false);
    check('remote speaking detected from decoded audio', !!spoke);
    const lit = await until(async () => (await domSpeaking(A, b)) || (await domSpeaking(B, a)), { timeout: 30000, every: 100, label: 'speaking ring' }).catch(() => false);
    check('stage lights the remote speaker (server SPEAKING relay)', !!lit);
    await shoot(A, 'call-desktop-A.png');
    await shoot(B, 'call-iphone-B.png');
    // iPhone: Share must not be offered anywhere (bar or More).
    const moreB = await B.$('[data-testid="call-more"]');
    if (moreB) { await moreB.click(); await sleep(300); }
    await shoot(B, 'call-iphone-B-more.png');
    const shareOffered = await B.evaluate(() => [...document.querySelectorAll('[data-testid="screenshare-button"], [data-testid="call-more-share"]')]
      .some((el) => el.offsetParent !== null && !el.disabled));
    check('iPhone: screen share is not offered', !shareOffered);
    if (moreB) { await B.keyboard.press('Escape'); await sleep(200); }

    // iPhone layout: every call control is a >= 44px target, and the
    // expanded stage is a full-screen call screen sized by the dynamic viewport.
    const small = await B.evaluate(() => [...document.querySelectorAll('[data-testid="voice-bar"] button')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((b) => b.w < 44 || b.h < 44));
    check('iPhone: call controls are >= 44px targets', small.length === 0, JSON.stringify(small).slice(0, 200));
    const barRows = await B.evaluate(() => { const c = document.querySelector('.onyx-call-bar-center'); if (!c) return -1; const tops = new Set([...c.children].filter((el) => el.offsetParent !== null).map((el) => Math.round(el.getBoundingClientRect().top))); return tops.size; });
    check('iPhone: call controls fit one row', barRows === 1, `rows=${barRows}`);
    const cycleSize = async () => {
      await B.click('[data-testid="call-more"]');
      await B.click('[data-testid="stage-size-button"]');
      await B.keyboard.press('Escape');
      await sleep(400);
    };
    await cycleSize();
    const full = await B.evaluate(() => { const st = document.querySelector('[data-testid="voice-stage"]'); const r = st.getBoundingClientRect(); return { size: st.getAttribute('data-size'), top: Math.round(r.top), h: Math.round(r.height), vh: window.innerHeight }; });
    check('iPhone: expanded stage is a full-screen call screen (100dvh)', full.top === 0 && Math.abs(full.h - full.vh) <= 1, JSON.stringify(full));
    await shoot(B, 'call-iphone-B-fullscreen.png');
    for (let i = 0; i < 3; i += 1) {
      const size = await B.evaluate(() => document.querySelector('[data-testid="voice-stage"]').getAttribute('data-size'));
      if (size === 'compact') break;
      await cycleSize();
    }

    // Mute propagates: A mutes → B's engine + Elm roster mark A muted.
    await A.click('[data-testid="call-mute"]');
    await until(async () => peerOf(await stats(B), a)?.muted, { timeout: 20000, label: 'B sees A muted' }).then(
      () => check('mute propagates (B sees A muted)', true),
      (e) => check('mute propagates (B sees A muted)', false, e.message));
    await A.click('[data-testid="call-mute"]');
    await until(async () => peerOf(await stats(B), a)?.muted === false, { timeout: 20000, label: 'B sees A unmuted' }).then(
      () => check('unmute propagates', true),
      (e) => check('unmute propagates', false, e.message));

    // Camera: A turns video on → B gets a video peer + bound tile.
    if (!flag('--skip-video')) {
      const cam = await A.$('[data-testid="camera-button"]');
      if (cam) {
        await cam.click();
        await until(async () => peerOf(await stats(B), a)?.videoFrames, { timeout: 60000, label: 'B receives A video' }).then(
          () => check('camera on: B receives and decodes A video', true),
          async (e) => {
            check('camera on: B receives and decodes A video', false, e.message);
            console.log('  stats A', JSON.stringify(await stats(A)));
            console.log('  stats B', JSON.stringify(await stats(B)));
          });
        const bound = await until(() => B.evaluate((n) => [...document.querySelectorAll('video[data-voice-tile]')].some((v) => v.getAttribute('data-voice-tile').toLowerCase() === `peer:${n.toLowerCase()}` && v.getAttribute('data-bound') === 'true'), a), { timeout: 20000, label: 'video tile bound' }).catch(() => false);
        check('B binds A camera stream to the tile', !!bound);
        await sleep(1500);
        await shoot(A, 'call-video-A.png');
        await shoot(B, 'call-video-B.png');
        // Camera off: the tile falls back to the avatar on the peer.
        await A.click('[data-testid="camera-button"]');
        await until(async () => peerOf(await stats(A), a) === undefined || (await stats(A)).localKind === 'voice', { timeout: 20000, label: 'A camera off' }).then(
          () => check('camera off: A keeps the call on voice', true),
          (e) => check('camera off: A keeps the call on voice', false, e.message));
        // iPhone camera: WebKit has no MediaStreamTrackProcessor, so B encodes
        // on the main thread (the engine's Safari path) at the phone profile.
        await B.click('[data-testid="camera-button"]');
        await until(async () => peerOf(await stats(A), b)?.videoFrames, { timeout: 60000, label: 'A receives B video' }).then(
          () => check('iPhone camera (main-thread encoder path): A receives and decodes B video', true),
          (e) => check('iPhone camera (main-thread encoder path): A receives and decodes B video', false, e.message));
        await sleep(1500);
        const boundB = await until(() => A.evaluate((n) => [...document.querySelectorAll('video[data-voice-tile]')].some((v) => v.getAttribute('data-voice-tile').toLowerCase() === `peer:${n.toLowerCase()}` && v.getAttribute('data-bound') === 'true'), b), { timeout: 20000, label: 'A binds B video' }).catch(() => false);
        check('A binds the iPhone camera stream to the tile', !!boundB);
        await shoot(A, 'call-video-from-iphone-A.png');
        await shoot(B, 'call-video-iphone-B-self.png');
        await B.click('[data-testid="camera-button"]');
      } else {
        check('camera control present', false, 'no call-camera button');
      }
    }

    // Leave cleans up on both sides.
    await A.click('[data-testid="call-leave"]');
    const confirm = await A.$('[data-testid="call-leave-confirm"] button:has-text("Leave")');
    if (confirm) await confirm.click();
    await until(async () => (await stats(A))?.callState === 'idle', { timeout: 20000, label: 'A idle' }).then(
      () => check('leave: A back to idle', true),
      (e) => check('leave: A back to idle', false, e.message));
    await until(async () => !peerOf(await stats(B), a), { timeout: 20000, label: 'B drops A' }).then(
      () => check('leave: B drops A from the call', true),
      (e) => check('leave: B drops A from the call', false, e.message));
    const local = await A.evaluate(() => window.OnyxVoiceEngine.stats().localKind);
    check('leave: A released local capture', local === null, String(local));

    // DM ring: the server has no non-channel MEDIA target (media_cmd.zig:36-39).
    const ring = await A.evaluate(async (peer) => {
      try { await window.OnyxVoiceEngine.startCall(peer, 'voice'); return 'resolved'; } catch (e) { return `rejected: ${e && e.message}`; }
    }, b);
    check('DM ring reports the server limitation honestly (no phantom ring)', /rejected/.test(ring), ring);

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('harness', false, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
    if (node && !flag('--keep-node')) node.stop();
    else if (node) console.log(`node kept running (state ${stateDir}); rerun with --reuse-node`);
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed — shots + results in ${out}`);
  process.exit(failed.length ? 1 : 0);
}

await main();
