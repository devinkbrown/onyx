// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-oper.mjs — extra screens.mjs scenarios for the operator
 * desk (v3/gap-oper). The stock fake IRC server has no operator account,
 * so each scenario wraps the page's WebSocket (Playwright routeWebSocket)
 * and plays the daemon's operator replies from the exact line shapes
 * `oper_cmd.zig` / `server.zig` write — nothing here touches a real node.
 *
 *   node elm/tools/screens.mjs --extra elm/tools/screens-gap-oper.mjs --vp all
 */

const SRV = 'onyx.test';

function daemon(nick) {
  const state = {
    follow: new Set(['CONNECT', 'FLOOD', 'KILL', 'SECURITY', 'OPER_ACTION']),
    floor: 'info',
    wards: [
      ['mask', '*!*@bad.example', 'node', 'expel', 'root', 'spam wave from this host'],
      ['address', '203.0.113.0/24', 'mesh', 'refuse', 'ops', 'botnet range'],
      ['realname', '*bad?bot*', 'node', 'expel', 'ops', 'bot realname'],
    ],
    shuns: [['*!*@flood.example', 'root', 'Flooding after a warning']],
    filters: ['free money', 'buy followers now'],
    appeals: [
      [1, 'bob', '203.0.113.9', 'open', 'I was banned by mistake, my brother shares the connection. Please look again.'],
      [2, 'ann', 'h.example', 'open', 'Sorry for the caps. Will not happen again.'],
      [3, 'cy', '198.51.100.4', 'answered', 'wrong person'],
    ],
  };
  const out = [];
  const n = (text) => out.push(`:${SRV} NOTICE ${nick} :${text}`);
  const cats = () => n(`Event categories: ${[...state.follow].join(' ') || '(none)'} (min severity: ${state.floor})`);
  const handle = (line) => {
    const m = /^(?:@\S+ )?(\S+)(?: (.*))?$/.exec(line.trim());
    if (!m) return [];
    const cmd = m[1].toUpperCase();
    const rest = m[2] || '';
    const words = rest.split(' ');
    const trailing = rest.includes(' :') ? rest.slice(rest.indexOf(' :') + 2) : rest.startsWith(':') ? rest.slice(1) : '';
    out.length = 0;
    if (cmd === 'EVENT') {
      const sub = (words[0] || '').toUpperCase();
      if (sub === 'LIST') { out.push(`:${SRV} 808 ${nick} :Start of event list`, `:${SRV} 810 ${nick} :End of event list`); cats(); }
      else if (sub === 'ADD') { state.follow.add(words[1].toUpperCase()); cats(); }
      else if (sub === 'DEL') { state.follow.delete(words[1].toUpperCase()); cats(); }
      else if (sub === 'SEVERITY') { state.floor = words[1]; n(`Event minimum severity set to ${words[1]}`); }
      else if (sub === 'STATS') n('{"total":1432,"history_depth":512,"categories":{"connect":801,"disconnect":512,"flood":61,"kill":9,"spam":14,"security":35},"severities":{"debug":0,"info":1313,"notice":40,"warn":71,"error":8,"critical":0},"operator_surfaces":{"audit_json":true}}');
    } else if (cmd === 'WARD') {
      const sub = (words[0] || '').toUpperCase();
      if (sub === 'LIST') { for (const w of state.wards) n(`WARD ${w[0]} ${w[1]} ${w[2]}/${w[3]} by ${w[4]} :${w[5]}`); n('WARD: end of list'); }
      else if (sub === 'ADD') {
        const reason = trailing || 'No reason';
        const scope = words.includes('mesh') ? 'mesh' : 'node';
        const action = ['refuse', 'quarantine', 'require_auth'].find((a) => words.includes(a)) || 'expel';
        state.wards.unshift([words[1], words[2], scope, action, nick, reason]);
        out.push(`@onyx_server.io/category=OPER_ACTION;onyx_server.io/severity=notice :${SRV} EVENT ${nick} WARD ADD ${words[1]} ${words[2]} ${scope}/${action} proof=9f3a7c`);
      } else if (sub === 'DEL') {
        state.wards = state.wards.filter((w) => !(w[0] === words[1] && w[1] === words[2]));
        out.push(`@onyx_server.io/category=OPER_ACTION;onyx_server.io/severity=notice :${SRV} EVENT ${nick} WARD DEL ${words[1]} ${words[2]}: removed proof=9f3a80`);
      } else if (sub === 'TEST') n(words[2] && words[2].includes('bad.example') ? 'WARD TEST: matched mask *!*@bad.example (expel) :spam wave from this host' : 'WARD TEST: no match');
    } else if (cmd === 'KLINE' || cmd === 'DLINE' || cmd === 'XLINE') {
      const match = cmd === 'KLINE' ? 'mask' : cmd === 'DLINE' ? 'address' : 'realname';
      state.wards.unshift([match, words[1], 'node', cmd === 'DLINE' ? 'refuse' : 'expel', nick, trailing || 'No reason']);
      out.push(`@onyx_server.io/category=OPER_ACTION;onyx_server.io/severity=notice :${SRV} EVENT ${nick} WARD ADD ${match} ${words[1]} node/expel proof=9f3a7d`);
    } else if (cmd === 'TESTLINE') out.push(`:${SRV} 725 ${nick} mask *!*@bad.example :spam wave from this host`);
    else if (cmd === 'TESTMASK') out.push(`:${SRV} 727 ${nick} ${words[0]} 3 :clients match`);
    else if (cmd === 'SHUN') {
      if (!rest) { for (const s of state.shuns) n(`SHUN ${s[0]} by ${s[1]} :${s[2]}`); n('SHUN: end of list'); }
      else { state.shuns.unshift([words[0], nick, trailing || 'No reason']); out.push(`@onyx_server.io/category=OPER_ACTION;onyx_server.io/severity=notice :${SRV} EVENT ${nick} SHUN ${words[0]} proof=aa11bb`); }
    } else if (cmd === 'UNSHUN') { state.shuns = state.shuns.filter((s) => s[0] !== words[0]); out.push(`@onyx_server.io/category=OPER_ACTION;onyx_server.io/severity=notice :${SRV} EVENT ${nick} UNSHUN ${words[0]}: removed proof=aa11bc`); }
    else if (cmd === 'MODE' && /^[+-]z$/.test(words[1] || '')) out.push(`:${SRV} MODE ${words[0]} ${words[1]}`);
    else if (cmd === 'QUARANTINE') n('QUARANTINE moved');
    else if (cmd === 'ABUSE') {
      n(`ABUSE ${words[0]}: flood none excess=0 message_tokens=14`); n(`ABUSE ${words[0]}: shun yes`); n(`ABUSE ${words[0]}: dnsbl listed 2`);
      n(`ABUSE ${words[0]}: reputation 18`); n(`ABUSE ${words[0]}: account bobby score=3`);
    } else if (cmd === 'CLONES') {
      n('CLONES policy: max_per_ip=3 (on) max_per_net=0 (off); per-class clone caps via STATS Y');
      n('CLONES throttle: disabled (set [limits] throttle_connects)');
      n('CLONES ip 203.0.113.9 (3 clients)'); n('  alice 203.0.113.9 *'); n('  bob 203.0.113.9 bobby'); n('  carol 203.0.113.9 *');
      n('CLONES net 198.51.100.0/24 (2 clients)'); n('  dave 198.51.100.4 dave'); n('  erin 198.51.100.77 *');
    } else if (cmd === 'SESSIONS') {
      out.push(`:${SRV} 204 ${nick} Oper sessions ${nick} (198.51.100.7) 5400 0 tls root`,
        `:${SRV} 205 ${nick} User sessions alice (203.0.113.9) 340 0 tls alice`,
        `:${SRV} 205 ${nick} User sessions bob (203.0.113.9) 95 0 clear *`,
        `:${SRV} 205 ${nick} User sessions mara (192.0.2.44) 86500 0 tls mara`,
        `:${SRV} 262 ${nick} SESSION :End of SESSION view`);
    } else if (cmd === 'APPEAL') {
      const sub = (words[0] || '').toUpperCase();
      if (sub === 'LIST') { if (!state.appeals.length) n('APPEAL none'); for (const a of state.appeals) n(`APPEAL ${a[0]} ${a[1]} ${a[2]} ${a[3]} :${a[4]}`); }
      else if (sub === 'ANSWER') { const a = state.appeals.find((x) => String(x[0]) === words[1]); if (a) { a[3] = 'answered'; n('APPEAL answered'); } else n('APPEAL no such id'); }
      else n('APPEAL filed 7');
    } else if (cmd === 'FILTER') {
      const sub = (words[0] || 'LIST').toUpperCase();
      if (sub === 'LIST') { state.filters.forEach((f, i) => n(`FILTER LIST #${i + 1} ${f}`)); n(`FILTER: End of filter list (${state.filters.length})`); }
      else if (sub === 'ADD') { state.filters.push(trailing); n('FILTER: pattern added'); }
      else if (sub === 'DEL') { state.filters = state.filters.filter((f) => f !== trailing); n('FILTER: pattern removed'); }
    } else if (cmd === 'SPAMTRAP') n('SPAMTRAP: 2 trap nick(s), 1 trap channel(s), 1 offender(s), 6 total trip(s)');
    else if (cmd === 'HOLD') n('HOLD released 2');
    else if (cmd === 'POLICY') n(words[0] === 'ROLLBACK' ? 'POLICY: rolled ward back to generation 3' : 'POLICY: ward=4 filter=2 class=1 ban=7');
    else if (cmd === 'CHALLENGE') n('CHALLENGE method set');
    else if (cmd === 'PRIVS') out.push(`:${SRV} 270 ${nick} ${nick} admin :client_kill client_moderate server_rehash event_subscribe audit_read oper_grant mesh_admin`);
    else if (cmd === 'REHASH') out.push(`:${SRV} 382 ${nick} /etc/onyx/onyx_server.conf :Configuration reloaded (2 oper bindings; TLS certificates unchanged)`);
    else if (cmd === 'MESH') { n('mesh onyx.test: 2 peers linked'); n('  peer n2.test established 12ms'); n('  peer n3.test established 31ms'); n('mesh intact: 3/3 nodes reachable'); }
    else if (cmd === 'NETHEALTH' || cmd === 'ROUTE' || cmd === 'GRANTS') n(`${cmd.toLowerCase()}: ok`);
    else if (cmd === 'STATS') out.push(`:${SRV} 242 ${nick} :Server Up 3 days 04:11:09`, `:${SRV} 219 ${nick} ${words[0]} :End of /STATS report`);
    return [...out];
  };
  return { state, handle };
}

const EVENTS = [
  ['CONNECT', 'info', 'USER CONNECT alice!u@203.0.113.9'],
  ['CONNECT', 'info', 'USER CONNECT bob!b@203.0.113.9'],
  ['FLOOD', 'warn', 'FLOOD possible raid on #lounge: join rate exceeded, throttling new joins'],
  ['SECURITY', 'warn', 'SECURITY login failed for bobby from 203.0.113.9 (3 attempts)'],
  ['KILL', 'notice', 'KILL root killed mallory (repeat flooding)'],
  ['SERVER_LINK', 'notice', 'SERVER LINK n2.test established'],
  ['FLOOD', 'error', 'FLOOD raid shield engaged slowmode on #lounge'],
  ['DISCONNECT', 'info', 'USER DISCONNECT carol!c@198.51.100.4 :Ping timeout'],
  ['SPAM', 'warn', 'FLOOD spamtrap tripped: mallory touched honeypot nick honeypot'],
];

async function operSession(page, h, opts = {}) {
  const nick = 'root';
  const d = daemon(nick);
  let socket = null;
  await page.routeWebSocket(/\/ws(\?.*)?$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => ws.send(m));
    ws.onMessage((m) => {
      server.send(m);
      for (const line of String(m).split(/\r?\n/)) if (line.trim()) for (const r of d.handle(line)) ws.send(r);
    });
  });
  await h.joinRoom(page, nick, '');
  const send = (line) => socket && socket.send(line);
  send(`:${SRV} 381 ${nick} :You are now an IRC operator`);
  await h.settle(page, 400);
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) { await page.keyboard.press('Escape'); await h.settle(page, 250); }
  const events = (count = EVENTS.length) => {
    EVENTS.slice(0, count).forEach(([cat, sev, text], i) => {
      send(`@msgid=ev${Date.now()}${i};onyx_server.io/category=${cat};onyx_server.io/severity=${sev} :${i % 3 === 2 ? 'n2.test' : SRV} EVENT ${nick} ${text}`);
    });
    send(`:${SRV} EVENT ${nick} OBSERVE connect mallory!~m@203.0.113.50 acct=*`);
    send(`@onyx_server.io/category=ANNOUNCE;onyx_server.io/severity=notice :${SRV} EVENT ${nick} ops!o@h.example: maintenance window starts at 03:00 UTC`);
    send(`:${SRV} EVENT ${nick} AUDIT #41 ops SHUN *!*@flood.example proof=aa11bb :Flooding after a warning`);
  };
  return { send, events, d };
}

async function openDesk(page, h) {
  const sels = ['[data-testid="oper-desk-open"]'];
  for (const sel of sels) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) { await el.click(); await h.settle(page, 500); return true; }
    }
  }
  // Phone: the entry lives behind the You / More menus; fall back to a click through the DOM.
  const el = await page.$('[data-testid="oper-desk-open"]');
  if (el) { await el.evaluate((n) => n.click()); await h.settle(page, 500); return true; }
  return false;
}

async function tab(page, h, name) {
  await page.click(`[data-testid="oc-tab-${name}"]`);
  await h.settle(page, 500);
}

async function fillAll(page, pairs) {
  for (const [sel, value] of pairs) await page.fill(sel, value);
}

export default {
  'oper-live': async (page, h) => {
    const s = await operSession(page, h);
    await openDesk(page, h);
    s.events();
    await h.settle(page, 500);
  },
  'oper-live-paused': async (page, h) => {
    const s = await operSession(page, h);
    await openDesk(page, h);
    s.events();
    await h.settle(page, 300);
    await page.click('[data-testid="oc-feed-pause"]');
    s.events(3);
    await h.settle(page, 400);
  },
  'oper-scrolled': async (page, h) => {
    const s = await operSession(page, h);
    await openDesk(page, h);
    s.events();
    await h.settle(page, 400);
    await page.evaluate(() => { const el = document.querySelector('[data-testid="oper-sheet"]'); if (el) el.scrollTop = 400; });
    await h.settle(page, 300);
    const rects = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.left), Math.round(b.right)]; };
      return { sheet: r('[data-testid="oper-sheet"]'), tabs: r('[data-testid="oc-tabs"]'), close: r('[data-testid="oper-sheet"] .onyx-sheet-close'), vp: [innerWidth, innerHeight] };
    });
    console.log('MEASURE', page.viewportSize().width, JSON.stringify(rects));
  },
  'oper-bans': async (page, h) => {

    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'bans');
  },
  'oper-bans-review': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'bans');
    await fillAll(page, [['[data-testid="oc-ban-pattern"]', '*!*@spam.example'], ['[data-testid="oc-ban-reason"]', 'Spam wave from this host']]);
    await page.selectOption('[data-testid="oc-ban-duration"]', '86400');
    await page.click('[data-testid="oc-ban-submit"]');
    await h.settle(page, 400);
  },
  'oper-bans-ward': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'bans');
    await page.selectOption('[data-testid="oc-ban-kind"]', 'ward');
    await page.selectOption('[data-testid="oc-ban-duration"]', 'custom');
    await h.settle(page, 300);
  },
  'oper-silence': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'silence');
  },
  'oper-abuse': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'abuse');
    await page.fill('[data-testid="oc-abuse-nick"]', 'bob');
    await page.click('[data-testid="oc-abuse-submit"]');
    await h.settle(page, 400);
    await page.click('[data-testid="oc-clones-scan"]');
    await h.settle(page, 400);
    await page.click('[data-testid="oc-sessions-submit"]');
    await h.settle(page, 400);
  },
  'oper-appeals': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'appeals');
    await page.click('[data-testid="oc-appeal-answer-open"]');
    await h.settle(page, 300);
  },
  'oper-content': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'content');
  },
  'oper-network': async (page, h) => {
    await operSession(page, h);
    await openDesk(page, h);
    await tab(page, h, 'network');
    await page.click('[data-testid="oper-desk-privs"]');
    await h.settle(page, 300);
    await page.selectOption('[data-testid="oc-report"]', 'MESH|');
    await page.click('[data-testid="oc-report-run"]');
    await h.settle(page, 400);
  },
};
