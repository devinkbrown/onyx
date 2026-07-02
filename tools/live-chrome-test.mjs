// Final end-to-end: a real Chrome WS to the LIVE server (valid cert, real name),
// open + IRC registration. One connection. Proves the user's desktop path works.
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});
const r = await p.evaluate(() => new Promise((res) => {
  const lines = []; let s, done = false;
  const fin = (o) => { if (!done) { done = true; try { s && s.close(); } catch {} res({ ...o, head: lines.slice(0, 6) }); } };
  setTimeout(() => fin({ result: 'timeout' }), 14000);
  s = new WebSocket('wss://eshmaki.me:8080/');
  s.onopen = () => { const k = 'pqtest' + (Date.now() % 9999); s.send('CAP LS 302\r\n'); s.send('NICK ' + k + '\r\n'); s.send('USER ' + k + ' 0 * :pq probe\r\n'); };
  s.onmessage = (ev) => { for (const ln of String(ev.data).split(/\r?\n/)) { if (!ln) continue; lines.push(ln); const t = ln.split(' '); const cmd = t[0].startsWith(':') ? t[1] : t[0]; if (cmd === 'CAP' && ln.includes(' LS ')) s.send('CAP END\r\n'); if (cmd === '001') fin({ result: 'CONNECTED-AND-REGISTERED (001)' }); if (cmd === 'PING') s.send('PONG ' + ln.split('PING')[1].trim() + '\r\n'); if (cmd === 'ERROR') fin({ result: 'server-ERROR' }); } };
  s.onerror = () => fin({ result: 'WS-error' });
  s.onclose = (e) => fin({ result: 'WS-close', code: e.code });
}));
console.log('LIVE CHROME RESULT:', JSON.stringify({ result: r.result }));
console.log('first lines:', (r.head || []).join(' | '));
if (errs.length) console.log('console errors:', errs.slice(-2).join(' | '));
await b.close();
