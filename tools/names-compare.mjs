// Compare a channel's roster as reported by EACH mesh node directly. A guest
// connects to each node, issues NAMES <chan> (no join), and we diff the member
// sets. A mismatch => the nodes' route_table rosters are out of sync (server-side
// stale roster); a match => server state is consistent and any gap is client-side.
import { chromium } from '@playwright/test';

const chan = process.argv[2] ?? '#root';
const nodes = (process.argv[3] ?? 'wss://eshmaki.me:8080/,wss://ircx.us:8080/').split(',');
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'domcontentloaded' }).catch(() => {});

async function rosterFrom(url, chan) {
  return page.evaluate(({ url, chan }) => new Promise((resolve) => {
    const nick = 'rcmp' + Math.floor(Math.random() * 99999);
    const names = [];
    let done = false;
    const fin = (extra) => { if (done) return; done = true; try { s.close(); } catch {} resolve({ names, ...extra }); };
    setTimeout(() => fin({ to: true }), 12000);
    const s = new WebSocket(url);
    s.onopen = () => { s.send('CAP LS 302\r\n'); s.send(`NICK ${nick}\r\n`); s.send(`USER ${nick} 0 * :${nick}\r\n`); };
    s.onmessage = (ev) => {
      for (const ln of String(ev.data).split(/\r?\n/)) {
        if (!ln) continue;
        const t = ln.split(' ');
        const cmd = t[0].startsWith(':') ? t[1] : t[0];
        if (cmd === 'CAP' && ln.includes(' LS ')) s.send('CAP END\r\n');
        if (cmd === 'PING') s.send('PONG ' + ln.split('PING')[1].trim() + '\r\n');
        if (cmd === '001') s.send(`NAMES ${chan}\r\n`);
        if (cmd === '353') { const c = ln.indexOf(' :'); if (c >= 0) names.push(...ln.slice(c + 2).trim().split(' ')); }
        if (cmd === '366') fin({});
      }
    };
    s.onerror = () => fin({ err: true });
  }), { url, chan });
}

const clean = (arr) => [...new Set(arr.map((n) => n.replace(/^[~!.@%+*&]+/, '')).filter(Boolean))].sort();
const results = {};
for (const url of nodes) {
  const r = await rosterFrom(url, chan);
  results[url] = clean(r.names);
  console.log(`\n${url}  (#=${results[url].length})${r.to ? ' [timeout]' : ''}${r.err ? ' [err]' : ''}`);
  console.log('  ', results[url].join(' ') || '(empty)');
}
if (nodes.length === 2) {
  const [A, B] = nodes.map((u) => new Set(results[u]));
  const onlyA = [...A].filter((x) => !B.has(x));
  const onlyB = [...B].filter((x) => !A.has(x));
  console.log('\n=== DIFF ===');
  console.log('only on', nodes[0], ':', onlyA.join(' ') || '(none)');
  console.log('only on', nodes[1], ':', onlyB.join(' ') || '(none)');
  console.log('rosters match:', onlyA.length === 0 && onlyB.length === 0);
}
await browser.close();
