// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-auth.mjs — extra screens.mjs scenarios for v3/gap-auth: the
 * sign-in steps the connect gate was missing (two-step code, the pre-001
 * CHALLENGE question / stop screens / proof-of-work note, forgot password,
 * passkey sign-in) and the sign-in form's Forgot password / passkey links.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-auth.mjs --only ga-2fa-code,...
 *
 * Each scenario dials its own scripted fake server (wire shapes copied from
 * the Onyx Server source: server.zig noticeChallenge / handleIdentify /
 * handleResetpass / webauthnAuth, dispatch.zig SASL 904). Nothing touches a
 * real network. The pre-001 proof of work is verified with the same BLAKE3
 * the client ships (ports.js), pinned to the official test vectors in
 * elm/challenge.smoke.mjs.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
require(resolve(new URL('.', import.meta.url).pathname, '../ports.js'));
const { challenge } = globalThis.OnyxPorts;

const NET = 'onyx.test';
const SEED = '0102030405060708090a0b0c0d0e0f10';
const RESET_CODE = '0123456789abcdef0123456789abcdef';
const TFA_PASSWORD = 'hunter22';
const TFA_CODE = '123456';

const accept = (key) => createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
const frame = (text) => {
  const p = Buffer.from(text);
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([head, p]);
};

/** One scripted IRC session. `opts`: { mode, welcomeDelay, closeAfterMs }. */
function session(sock, opts) {
  let nick = '*';
  let haveUser = false;
  let capDone = false;
  let registered = false;
  let passed = opts.mode !== 'pow' && opts.mode !== 'question';
  let account = null; // SASL account that failed 2FA on this socket
  let challengeSent = false;
  const send = (...lines) => { for (const l of lines) { try { sock.write(frame(l)); } catch { /* closed */ } } };
  const offerChallenge = () => {
    if (challengeSent || opts.mode === 'pow' && false) return;
    if (opts.mode === 'pow') { challengeSent = true; send(`:${NET} NOTICE * :CHALLENGE pow ${SEED}`); }
    if (opts.mode === 'question') {
      challengeSent = true;
      send(`:${NET} NOTICE * :CHALLENGE question What is the capital of France?`);
      if (opts.closeAfterMs) setTimeout(() => { try { sock.end(); } catch { /* closed */ } }, opts.closeAfterMs);
    }
  };
  const welcome = () => {
    if (registered || !capDone || !haveUser || !passed) return;
    registered = true;
    const go = () => send(
      `:${NET} 001 ${nick} :Welcome to the Onyx network, ${nick}`,
      `:${NET} 005 ${nick} CHANTYPES=# PREFIX=(qaohv)~&@%+ NETWORK=Onyx :are supported`,
      `:${NET} 376 ${nick} :End of MOTD`,
    );
    if (opts.welcomeDelay) setTimeout(go, opts.welcomeDelay); else go();
  };
  const handle = (line) => {
    const m = /^(?:@\S+ )?(\S+)(?: (.*))?$/.exec(line.trim());
    if (!m) return;
    const cmd = m[1].toUpperCase();
    const rest = m[2] || '';
    const arg = rest.split(' ');
    if (cmd === 'CAP' && arg[0] === 'LS') {
      send(`:${NET} CAP * LS :message-tags server-time standard-replies sasl=PLAIN onyx/2fa=IDENTIFY`);
    } else if (cmd === 'CAP' && arg[0] === 'REQ') send(`:${NET} CAP * ACK ${rest.slice(4)}`);
    else if (cmd === 'CAP' && arg[0] === 'END') { capDone = true; welcome(); }
    else if (cmd === 'NICK') { nick = arg[0].replace(/^:/, ''); offerChallenge(); }
    else if (cmd === 'USER') { haveUser = true; offerChallenge(); welcome(); }
    else if (cmd === 'AUTHENTICATE') {
      if (arg[0] === 'PLAIN') send('AUTHENTICATE +');
      else if (arg[0] !== '+') {
        const [, who, pw] = Buffer.from(arg[0], 'base64').toString('utf8').split('\0');
        if (opts.mode === '2fa' && pw === TFA_PASSWORD) {
          account = who;
          send(`:${NET} 904 ${nick} :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>`);
        } else send(`:${NET} 904 ${nick} :SASL authentication failed`);
      }
    } else if (cmd === 'CHALLENGE') {
      const answer = rest.replace(/^:/, '');
      const ok = opts.mode === 'pow' ? challenge.powOk(SEED, answer) : answer.trim().toLowerCase() === 'paris';
      if (ok) { passed = true; welcome(); } else send(`:${NET} NOTICE * :CHALLENGE failed`);
    } else if (cmd === 'IDENTIFY') {
      const [who, pw, code] = arg;
      if (pw !== TFA_PASSWORD) send(`:${NET} 464 ${nick} :Invalid account or password`);
      else if (code !== TFA_CODE) send(`:${NET} FAIL IDENTIFY TOTP_REQUIRED :Two-factor code required: IDENTIFY <account> <password> <6-digit-code>`);
      else send(`:${NET} NOTICE ${nick} :You are now identified as ${who}`);
    } else if (cmd === 'RESETPASS') {
      if (arg.length === 1) send(`:${NET} NOTICE ${nick} :RESETPASS: if that account has a verified email, a reset code has been sent.`);
      else if (arg[1] === RESET_CODE) send(`:${NET} RESETPASS SUCCESS ${arg[0]} :Password reset; log in with your new password`);
      else send(`:${NET} FAIL RESETPASS BAD_CODE :Incorrect reset code`);
    } else if (cmd === 'WEBAUTHN' && arg[0] === 'AUTH') {
      send(`:${NET} EVENT ${nick} WEBAUTHN AUTH-CHALLENGE AAAAAAAAAAAAAAAAAAAAAA ${NET} :${arg[1]}`,
        `:${NET} EVENT ${nick} WEBAUTHN ALLOW-CRED AQIDBAUGBwgJCgsMDQ4PEA`);
    } else if (cmd === 'PING') send(`:${NET} PONG ${NET} ${rest}`);
    void account;
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
  sock.on('error', () => {});
}

const servers = new Map();
async function endpoint(mode, opts = {}) {
  const key = `${mode}:${JSON.stringify(opts)}`;
  if (!servers.has(key)) {
    const srv = createServer((_, res) => { res.writeHead(404); res.end(); });
    srv.on('upgrade', (req, sock) => {
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept(req.headers['sec-websocket-key'])}\r\n\r\n`);
      session(sock, { mode, ...opts });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    srv.unref();
    servers.set(key, `ws=${encodeURIComponent(`ws://127.0.0.1:${srv.address().port}/ws`)}`);
  }
  return servers.get(key);
}

async function open(page, h, mode, opts) {
  await page.goto(`${h.base}/app?${await endpoint(mode, opts)}`);
  await h.settle(page, 500);
}
async function signIn(page, h, nick = 'kai', password = TFA_PASSWORD) {
  await page.click('[data-testid="conn-mode-signin"]');
  await h.settle(page, 200);
  await page.fill('#conn-nick', nick);
  await page.fill('#conn-password', password);
  await h.settle(page, 150);
}
const guestJoin = async (page, h) => {
  await page.fill('#conn-nick', 'kai');
  await page.click('[data-testid="conn-submit"]');
};
const waitFor = (page, sel, ms = 8000) => page.waitForSelector(sel, { state: 'visible', timeout: ms });

export default {
  'ga-debug': async (page, h) => {
    page.on('websocket', (ws) => {
      ws.on('framesent', (f) => console.log('>>', String(f.payload).slice(0, 160).replace(/\r?\n/g, ' | ')));
      ws.on('framereceived', (f) => console.log('<<', String(f.payload).slice(0, 160)));
      ws.on('close', () => console.log('ws closed'));
    });
    await open(page, h, '2fa');
    await signIn(page, h);
    await page.click('[data-testid="conn-submit"]');
    await h.settle(page, 3000);
    console.log('TEXT', (await page.innerText('body')).slice(0, 400).replace(/\n/g, ' / '));
  },
  // The sign-in form with its new Forgot password / passkey links.
  'ga-signin-links': async (page, h) => {
    await open(page, h, 'reset');
    await signIn(page, h, 'kai', '');
  },

  // Proof of work: solved silently; the form shows a short note meanwhile.
  'ga-pow-note': async (page, h) => {
    await open(page, h, 'pow', { welcomeDelay: 6000 });
    await guestJoin(page, h);
    await h.settle(page, 1500);
  },

  // The question gate.
  'ga-question': async (page, h) => {
    await open(page, h, 'question');
    await guestJoin(page, h);
    await waitFor(page, '[data-testid="auth-challenge-question"]');
    await h.settle(page, 250);
  },
  'ga-question-wrong': async (page, h) => {
    await open(page, h, 'question');
    await guestJoin(page, h);
    await waitFor(page, '#auth-answer');
    await page.fill('#auth-answer', 'lyon');
    await page.click('[data-testid="auth-answer-submit"]');
    await h.settle(page, 700);
  },
  'ga-question-timeout': async (page, h) => {
    await open(page, h, 'question', { closeAfterMs: 1200 });
    await guestJoin(page, h);
    await waitFor(page, '#auth-retry', 9000);
    await h.settle(page, 250);
  },

  // Two-step sign-in.
  'ga-2fa-code': async (page, h) => {
    await open(page, h, '2fa');
    await signIn(page, h);
    await page.click('[data-testid="conn-submit"]');
    await waitFor(page, '#auth-code');
    await h.settle(page, 300);
  },
  'ga-2fa-typed': async (page, h) => {
    await open(page, h, '2fa');
    await signIn(page, h);
    await page.click('[data-testid="conn-submit"]');
    await waitFor(page, '#auth-code');
    await page.fill('#auth-code', '482 913');
    await h.settle(page, 200);
  },
  'ga-2fa-wrong': async (page, h) => {
    await open(page, h, '2fa');
    await signIn(page, h);
    await page.click('[data-testid="conn-submit"]');
    await waitFor(page, '#auth-code');
    await page.fill('#auth-code', '000000');
    await page.click('[data-testid="auth-code-submit"]');
    await waitFor(page, '#auth-code-error');
    await h.settle(page, 300);
  },
  'ga-2fa-success': async (page, h) => {
    await open(page, h, '2fa');
    await signIn(page, h);
    await page.click('[data-testid="conn-submit"]');
    await waitFor(page, '#auth-code');
    await page.fill('#auth-code', TFA_CODE);
    await page.click('[data-testid="auth-code-submit"]');
    await page.waitForSelector('[data-testid="auth-gate"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await h.settle(page, 900);
  },

  // Forgot password.
  'ga-reset-ask': async (page, h) => {
    await open(page, h, 'reset');
    await page.click('[data-testid="conn-mode-signin"]');
    await page.fill('#conn-nick', 'kai');
    await page.click('[data-testid="conn-forgot"]');
    await waitFor(page, '#auth-reset-account');
    await h.settle(page, 300);
  },
  'ga-reset-enter': async (page, h) => {
    await open(page, h, 'reset');
    await page.click('[data-testid="conn-mode-signin"]');
    await page.fill('#conn-nick', 'kai');
    await page.click('[data-testid="conn-forgot"]');
    await waitFor(page, '#auth-reset-account');
    await page.click('[data-testid="auth-reset-request"]');
    await waitFor(page, '#auth-reset-code');
    await page.fill('#auth-reset-code', RESET_CODE);
    await page.fill('#auth-reset-password', 'a better passphrase');
    await h.settle(page, 250);
  },
  'ga-reset-wrong': async (page, h) => {
    await open(page, h, 'reset');
    await page.click('[data-testid="conn-mode-signin"]');
    await page.fill('#conn-nick', 'kai');
    await page.click('[data-testid="conn-forgot"]');
    await waitFor(page, '#auth-reset-account');
    await page.click('[data-testid="auth-reset-request"]');
    await waitFor(page, '#auth-reset-code');
    await page.fill('#auth-reset-code', 'ffffffffffffffffffffffffffffffff');
    await page.fill('#auth-reset-password', 'a better passphrase');
    await page.fill('#auth-reset-confirm', 'a better passphrase');
    await page.click('[data-testid="auth-reset-confirm-submit"]');
    await waitFor(page, '#auth-reset-confirm-error');
    await h.settle(page, 300);
  },
  'ga-reset-done': async (page, h) => {
    await open(page, h, 'reset');
    await page.click('[data-testid="conn-mode-signin"]');
    await page.fill('#conn-nick', 'kai');
    await page.click('[data-testid="conn-forgot"]');
    await waitFor(page, '#auth-reset-account');
    await page.click('[data-testid="auth-reset-request"]');
    await waitFor(page, '#auth-reset-code');
    await page.fill('#auth-reset-code', RESET_CODE);
    await page.fill('#auth-reset-password', 'a better passphrase');
    await page.fill('#auth-reset-confirm', 'a better passphrase');
    await page.click('[data-testid="auth-reset-confirm-submit"]');
    await waitFor(page, '#auth-done');
    await h.settle(page, 300);
  },

  // Passkey sign-in: headless Chromium has no authenticator, so the
  // ceremony ends in the honest "couldn't use a passkey" state.
  'ga-passkey': async (page, h) => {
    await open(page, h, 'reset');
    await page.click('[data-testid="conn-mode-signin"]');
    await page.fill('#conn-nick', 'kai');
    await page.click('[data-testid="conn-passkey"]');
    await h.settle(page, 2500);
  },
};
