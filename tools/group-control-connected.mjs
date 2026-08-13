import { mkdir, rm, writeFile, readFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { resolve, join } from 'node:path';

const root = resolve('.work/d2-connected', `${process.pid}-${Date.now()}`);
const accountA = `d2a${process.pid}`;
const accountB = `d2b${process.pid}`;
// Runtime-only disposable secrets. Never write or print either value.
const passwordA = `D2-${process.pid}-account-a-very-long`;
const passwordB = `D2-${process.pid}-account-b-very-long`;
const summary = { root, credentials: 'redacted', server: 'not-started', browser: 'not-run', secretScan: 'not-run', blocker: null };
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const command = (bin, args, env = {}, quiet = false) => new Promise((resolveRun, reject) => {
  const child = spawn(bin, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${bin} exited ${code}${stderr ? `: ${stderr.slice(-500)}` : ''}`)));
});
async function port() {
  return await new Promise((resolvePort, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close((e) => e ? reject(e) : resolvePort(a.port)); }); });
}
async function waitPort(value, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`local onyx-server exited ${child.exitCode}`);
    try { await new Promise((ok, bad) => { const s = connect(value, '127.0.0.1'); s.once('connect', () => { s.destroy(); ok(); }); s.once('error', bad); }); return; } catch { await sleep(150); }
  }
  throw new Error('local onyx-server did not bind before 60 seconds');
}
async function ircAccount(ircPort, nick, account, password, room) {
  const socket = await new Promise((ok, bad) => { const s = connect(ircPort, '127.0.0.1'); s.once('connect', () => ok(s)); s.once('error', bad); });
  let buffer = ''; const lines = [];
  socket.on('data', (chunk) => { buffer += chunk; const rows = buffer.split('\r\n'); buffer = rows.pop() ?? ''; lines.push(...rows); });
  const send = (line) => socket.write(`${line}\r\n`);
  const wait = async (needle) => { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { if (lines.some((line) => needle.test(line))) return; await sleep(25); } throw new Error(`IRC protocol timeout ${needle}`); };
  send(`NICK ${nick}`); send(`USER ${nick} 0 * :D2`); await wait(/ 001 /);
  send(`REGISTER ${account} * ${password}`); await wait(/ REGISTER SUCCESS /);
  if (room) { send(`JOIN ${room}`); await wait(new RegExp(` 366 .* ${room} `)); }
  socket.destroy();
}
async function scanSecrets() {
  const needles = [passwordA, passwordB, accountA, accountB];
  const candidates = [join(root, 'summary.json'), join(root, 'actor-evidence.json')];
  // dist is public build output; all secrets must be absent there as well.
  for (const file of candidates) { try { const body = await readFile(file, 'utf8'); if (needles.some((needle) => body.includes(needle))) throw new Error(`secret found in ${file}`); } catch (error) { if (error?.code !== 'ENOENT') throw error; } }
  await command('rg', ['-l', '--fixed-strings', passwordA, 'dist', root], {}, true).then(() => { throw new Error('password appeared in output'); }).catch((error) => { if (!String(error.message).includes('exited 1')) throw error; });
}
let server;
try {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const ircPort = await port(); const wsPort = await port(); const previewPort = await port();
  const room = `#d2${process.pid}`;
  const config = join(root, 'onyx-server.toml');
  await writeFile(config, `[node]\nid = 1\n[network]\nname = "Onyx D2"\nserver_name = "127.0.0.1"\n[listen]\nhost = "127.0.0.1"\nirc = ${ircPort}\nws = ${wsPort}\nws_plain = true\n[sasl]\nenabled = true\naccount_db = "${join(root, 'accounts.db')}"\n[limits]\nnum_shards = 1\n`, { mode: 0o600 });
  const serverLog = await open(join(root, 'server.log'), 'w', 0o600);
  server = spawn('zig', ['build', 'run', '--', config], { cwd: '/home/kain/onyx-server', stdio: ['ignore', serverLog.fd, serverLog.fd], detached: true });
  await waitPort(ircPort, server); summary.server = 'started';
  await ircAccount(ircPort, `n${process.pid}a`, accountA, passwordA);
  await ircAccount(ircPort, `n${process.pid}b`, accountB, passwordB);
  await command('pnpm', ['build'], { VITE_IRC_WS: `ws://127.0.0.1:${wsPort}` });
  await command('pnpm', ['playwright', 'test', 'tests/e2e/group-control-connected.spec.ts'], {
    ONYX_PLAYWRIGHT_PORT: String(previewPort), ONYX_D2_ACCOUNT_A: accountA, ONYX_D2_PASSWORD_A: passwordA,
    ONYX_D2_ACCOUNT_B: accountB, ONYX_D2_PASSWORD_B: passwordB, ONYX_D2_IRC_PORT: String(ircPort),
    ONYX_D2_EVIDENCE: join(root, 'actor-evidence.json'),
    PLAYWRIGHT_TRACE: 'off', PLAYWRIGHT_VIDEO: 'off', ONYX_D2_ROOM: room,
  });
  summary.browser = 'passed';
} catch (error) {
  summary.blocker = error instanceof Error ? error.message.replaceAll(passwordA, '[redacted]').replaceAll(passwordB, '[redacted]') : 'unknown runner failure';
  process.exitCode = 1;
} finally {
  await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  try { await scanSecrets(); summary.secretScan = 'passed'; await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 }); } catch { summary.secretScan = 'failed'; process.exitCode = 1; }
  if (server?.exitCode === null) {
    // Detached child owns a process group (`zig build run` → daemon); terminate
    // the whole PID-scoped group so no server survives an acceptance failure.
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    await Promise.race([new Promise((resolveExit) => server.once('exit', resolveExit)), sleep(10_000)]);
  }
}
