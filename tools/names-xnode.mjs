// Cross-node NAMES diagnostic. A connects to node 1, B to node 2 (the other mesh
// node). Both join the same channel. We check three things from A's view:
//   (1) does A receive B's channel PRIVMSG?  -> mesh relay up
//   (2) does A see B's JOIN line?            -> membership propagated to A's node
//   (3) does A's explicit NAMES list B?      -> the roster bug under test
import { chromium } from '@playwright/test';

const nodeA = process.argv[2] ?? 'wss://eshmaki.me:8080/';
const nodeB = process.argv[3] ?? 'wss://ircx.us:8080/';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});

const result = await page.evaluate(({ nodeA, nodeB }) => new Promise((resolve) => {
  const chan = '#xnode' + (Date.now() % 9999);
  const nickA = 'xnA' + (Date.now() % 999);
  const nickB = 'xnB' + (Date.now() % 999);
  const out = { chan, nickA, nickB, names353: [], aSawBJoin: false, aSawBMsg: false, err: null };
  let done = false;
  const fin = () => { if (done) return; done = true; try { a.close(); b.close(); } catch {} resolve(out); };
  setTimeout(fin, 22000);

  function mk(url, nick, isA, onReady) {
    const s = new WebSocket(url);
    s.onopen = () => { s.send('CAP LS 302\r\n'); s.send(`NICK ${nick}\r\n`); s.send(`USER ${nick} 0 * :${nick}\r\n`); };
    s.onmessage = (ev) => {
      for (const ln of String(ev.data).split(/\r?\n/)) {
        if (!ln) continue;
        const t = ln.split(' ');
        const cmd = t[0].startsWith(':') ? t[1] : t[0];
        if (cmd === 'CAP' && ln.includes(' LS ')) s.send('CAP END\r\n');
        if (cmd === 'PING') s.send('PONG ' + ln.split('PING')[1].trim() + '\r\n');
        if (cmd === '001') onReady(s);
        if (isA) {
          if (cmd === '353') out.names353.push(ln);
          if (cmd === 'JOIN' && ln.includes(nickB)) out.aSawBJoin = true;
          if (cmd === 'PRIVMSG' && ln.includes('HELLO-FROM-B')) out.aSawBMsg = true;
        }
      }
    };
    s.onerror = () => { out.err = (out.err ? out.err + '; ' : '') + 'ws-error ' + nick; };
    return s;
  }

  let aReg = false, bReg = false;
  const a = mk(nodeA, nickA, true, () => { aReg = true; a.send(`JOIN ${chan}\r\n`); step(); });
  const b = mk(nodeB, nickB, false, () => { bReg = true; b.send(`JOIN ${chan}\r\n`); step(); });

  function step() {
    if (!(aReg && bReg)) return;
    // let both joins propagate across the mesh
    setTimeout(() => {
      b.send(`PRIVMSG ${chan} :HELLO-FROM-B\r\n`);      // (1) relay probe
      setTimeout(() => {
        a.send(`NAMES ${chan}\r\n`);                     // (3) roster probe
        setTimeout(fin, 1800);
      }, 1200);
    }, 2500);
  }
}), { nodeA, nodeB });

console.log('channel:', result.chan, '| A=', result.nickA, 'B=', result.nickB);
console.log('mesh relay (A saw B msg): ', result.aSawBMsg);
console.log('membership (A saw B JOIN):', result.aSawBJoin);
console.log('err:', result.err);
console.log('--- 353 NAMES lines seen by A (looking for B=' + result.nickB + ') ---');
for (const l of result.names353) console.log('  ', l);
const lastNames = result.names353[result.names353.length - 1] ?? '';
console.log('VERDICT: B in A\'s final NAMES =', lastNames.includes(result.nickB));
await browser.close();
