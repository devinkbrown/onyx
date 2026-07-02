// Does re-JOINing a channel you're already in re-trigger a NAMES burst? And does
// SESSION TOKEN/RESUME replay channels? Probes the live server with a guest.
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'wss://eshmaki.me:8080/';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});

const out = await page.evaluate(({ url }) => new Promise((resolve) => {
  const chan = '#rejoin' + (Date.now() % 9999);
  const nick = 'rjp' + (Date.now() % 999);
  const r = { firstNames: 0, secondNames: 0, token: null, phase: 'join1' };
  let done = false;
  const fin = () => { if (done) return; done = true; try { s.close(); } catch {} resolve(r); };
  setTimeout(fin, 16000);
  const s = new WebSocket(url);
  s.onopen = () => { s.send('CAP LS 302\r\n'); s.send(`NICK ${nick}\r\n`); s.send(`USER ${nick} 0 * :${nick}\r\n`); };
  s.onmessage = (ev) => {
    for (const ln of String(ev.data).split(/\r?\n/)) {
      if (!ln) continue;
      const t = ln.split(' ');
      const cmd = t[0].startsWith(':') ? t[1] : t[0];
      if (cmd === 'CAP' && ln.includes(' LS ')) s.send('CAP END\r\n');
      if (cmd === 'PING') s.send('PONG ' + ln.split('PING')[1].trim() + '\r\n');
      if (cmd === '001') { s.send(`JOIN ${chan}\r\n`); s.send('SESSION TOKEN\r\n'); }
      if (cmd === 'NOTE' && ln.includes('SESSION') && ln.includes('TOKEN')) r.token = ln.split(' ').pop();
      if (cmd === '353') { if (r.phase === 'join1') r.firstNames++; else r.secondNames++; }
      if (cmd === '366') {
        if (r.phase === 'join1') {
          r.phase = 'join2';
          // re-JOIN the same channel we're already in
          setTimeout(() => s.send(`JOIN ${chan}\r\n`), 800);
        } else if (r.phase === 'join2') {
          setTimeout(fin, 800);
        }
      }
    }
  };
  s.onerror = () => fin();
}), { url });

console.log('first JOIN NAMES bursts:', out.firstNames);
console.log('re-JOIN (already in) NAMES bursts:', out.secondNames, out.secondNames > 0 ? '=> re-JOIN DOES re-send roster' : '=> re-JOIN is a NO-OP (no roster)');
console.log('guest got SESSION TOKEN:', out.token ? 'yes' : 'no');
await browser.close();
