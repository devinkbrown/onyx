// Live NAMES diagnostic against the real server. Opens two WS clients to the
// SAME node, both join a test channel, then client A issues NAMES and we capture
// the raw 353 reply to see whether B (and A) are listed.
//   node tools/names-diag.mjs wss://eshmaki.me:8080/
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'wss://eshmaki.me:8080/';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});

const result = await page.evaluate(({ url }) => new Promise((resolve) => {
  const chan = '#namesdiag' + (Date.now() % 9999);
  const log = [];
  const out = { chan, names353: [], aLines: [], joinedB: false, err: null };
  let done = false;
  const fin = () => { if (done) return; done = true; try { a.close(); b.close(); } catch {} resolve(out); };
  setTimeout(fin, 18000);

  function mkClient(nick, onReady, capture) {
    const s = new WebSocket(url);
    s.onopen = () => { s.send('CAP LS 302\r\n'); s.send(`NICK ${nick}\r\n`); s.send(`USER ${nick} 0 * :${nick}\r\n`); };
    s.onmessage = (ev) => {
      for (const ln of String(ev.data).split(/\r?\n/)) {
        if (!ln) continue;
        if (capture) out.aLines.push(ln);
        const t = ln.split(' ');
        const cmd = t[0].startsWith(':') ? t[1] : t[0];
        if (cmd === 'CAP' && ln.includes(' LS ')) s.send('CAP END\r\n');
        if (cmd === 'PING') s.send('PONG ' + ln.split('PING')[1].trim() + '\r\n');
        if (cmd === '001') onReady(s);
        if (cmd === '353') out.names353.push(ln);
      }
    };
    s.onerror = () => { out.err = 'ws-error ' + nick; };
    return s;
  }

  let aReg = false, bReg = false;
  const a = mkClient('diagA' + (Date.now() % 999), (s) => { aReg = true; s.send(`JOIN ${chan}\r\n`); maybeNames(); }, true);
  const b = mkClient('diagB' + (Date.now() % 999), (s) => { bReg = true; s.send(`JOIN ${chan}\r\n`); out.joinedB = true; maybeNames(); }, false);

  function maybeNames() {
    if (aReg && bReg) {
      // give both joins time to propagate, then A asks for the authoritative roster
      setTimeout(() => { a.send(`NAMES ${chan}\r\n`); setTimeout(fin, 1500); }, 1500);
    }
  }
}), { url });

console.log('channel:', result.chan, 'joinedB:', result.joinedB, 'err:', result.err);
console.log('--- all 353 NAMES lines seen by A ---');
for (const l of result.names353) console.log('  ', l);
await browser.close();
