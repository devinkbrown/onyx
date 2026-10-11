// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-usermodes.mjs — extra screens.mjs scenarios for the
 * v3/gap-usermodes slice (privacy user modes, message requests, server
 * blocks, offline messages, server-held schedules, account autojoin,
 * offline profiles). Also re-exports the shell scenarios.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-usermodes.mjs \
 *     --only um-privacy,um-inbox --out /tmp/um-shots
 *
 * The page WebSocket is routed through Playwright: client lines pass to
 * the local fake server, and a tiny responder answers the commands the
 * fake server does not know (MODE, ACCEPT, SILENCE, MEMO, AUTOJOIN,
 * DEFER, WHOWAS, SEEN, SETNAME) with real Onyx Server reply shapes, so
 * nothing here edits screens.mjs or touches the network.
 */
import shell from './screens-shell.mjs';

const NET = 'onyx.test';

function responder(nick, state) {
  return (line) => {
    const m = /^(?:@\S+ )?(\S+)(?: (.*))?$/.exec(line.trim());
    if (!m) return [];
    const cmd = m[1].toUpperCase();
    const rest = m[2] || '';
    const arg = rest.split(' ');
    const trailing = rest.includes(' :') ? rest.slice(rest.indexOf(' :') + 2) : arg[arg.length - 1];
    const out = [];
    if (cmd === 'MODE' && arg[0] && arg[0].toLowerCase() === nick.toLowerCase()) {
      if (arg.length === 1) out.push(`:${NET} 221 ${nick} :+${[...state.modes].join('')}`);
      else {
        let add = true; let applied = '';
        for (const ch of arg[1]) {
          if (ch === '+') { add = true; continue; }
          if (ch === '-') { add = false; continue; }
          if (add && !state.modes.has(ch)) { state.modes.add(ch); applied += `+${ch}`; }
          if (!add && state.modes.has(ch)) { state.modes.delete(ch); applied += `-${ch}`; }
        }
        if (applied) out.push(`:${nick}!u@${NET} MODE ${nick} :${applied}`);
      }
    } else if (cmd === 'ACCEPT') {
      for (const tok of rest.split(/[ ,]/).filter(Boolean)) {
        if (tok === '*') continue;
        if (tok[0] === '+') state.accepts.add(tok.slice(1)); else if (tok[0] === '-') state.accepts.delete(tok.slice(1));
      }
      if (!rest || rest.includes('*')) {
        for (const a of state.accepts) out.push(`:${NET} 281 ${nick} ${a} :is on your accept list`);
        out.push(`:${NET} 282 ${nick} :End of /ACCEPT list`);
      }
    } else if (cmd === 'SILENCE') {
      if (!rest) {
        if (state.silence.size) out.push(`:${NET} 271 ${nick} ${[...state.silence].join(',')} :`);
        out.push(`:${NET} 272 ${nick} :End of SILENCE list`);
      } else {
        for (const tok of rest.split(/[ ,]/).filter(Boolean)) {
          const mask = tok.slice(1);
          if (tok[0] === '+' && !state.silence.has(mask)) { state.silence.add(mask); out.push(`:${nick}!u@${NET} SILENCE +${mask}`); }
          if (tok[0] === '-' && state.silence.has(mask)) { state.silence.delete(mask); out.push(`:${nick}!u@${NET} SILENCE -${mask}`); }
        }
      }
    } else if (cmd === 'MEMO') {
      const sub = (arg[0] || 'LIST').toUpperCase();
      if (sub === 'LIST') {
        for (const mm of state.memos) out.push(`:${NET} NOTICE ${nick} :MEMO from ${mm.from} :${mm.text}`);
        out.push(`:${NET} NOTICE ${nick} :MEMO: End of offline memos (${state.memos.length})`);
      } else if (sub === 'CLEAR') {
        out.push(`:${NET} NOTICE ${nick} :MEMO: Cleared ${state.memos.length} message(s)`); state.memos = [];
      } else if (sub === 'FORWARD') {
        if (!arg[1]) out.push(`:${NET} NOTICE ${nick} :${state.forward ? 'MEMO: Forwarding your offline memos to ' + state.forward : 'MEMO: No forward set'}`);
        else if (/^(off|none)$/i.test(arg[1])) { state.forward = null; out.push(`:${NET} NOTICE ${nick} :MEMO: forwarding disabled`); }
        else { state.forward = arg[1]; out.push(`:${NET} NOTICE ${nick} :MEMO: Forwarding your offline memos to ${arg[1]}`); }
      } else if (sub === 'IGNORE') {
        const op = (arg[1] || 'LIST').toUpperCase();
        if (op === 'LIST') {
          for (const i of state.memoIgnores) out.push(`:${NET} NOTICE ${nick} :MEMO: ignoring ${i}`);
          out.push(`:${NET} NOTICE ${nick} :MEMO: End of ignore list (${state.memoIgnores.size})`);
        } else if (op === 'ADD') { state.memoIgnores.add(arg[2]); out.push(`:${NET} NOTICE ${nick} :MEMO: now ignoring memos from ${arg[2]}`); }
        else { state.memoIgnores.delete(arg[2]); out.push(`:${NET} NOTICE ${nick} :MEMO: no longer ignoring ${arg[2]}`); }
      } else if (sub === 'SEND') {
        out.push(`:${NET} NOTICE ${nick} :MEMO: message stored for delivery`);
      }
    } else if (cmd === 'AUTOJOIN') {
      const sub = (arg[0] || 'LIST').toUpperCase();
      if (sub === 'LIST') {
        for (const c of state.autojoin) out.push(`:${NET} NOTICE ${nick} :AUTOJOIN ${c}`);
        out.push(`:${NET} NOTICE ${nick} :AUTOJOIN: end of list`);
      } else if (sub === 'ADD') { state.autojoin.add(arg[1]); out.push(`:${NET} NOTICE ${nick} :AUTOJOIN added`); }
      else if (sub === 'DEL') { state.autojoin.delete(arg[1]); out.push(`:${NET} NOTICE ${nick} :AUTOJOIN removed`); }
    } else if (cmd === 'DEFER') {
      out.push(`:${NET} NOTICE ${nick} :DEFER: scheduled`);
    } else if (cmd === 'WHOIS') {
      const who = arg[arg.length - 1];
      if (state.offline.includes(who.toLowerCase())) {
        out.push(`:${NET} 401 ${nick} ${who} :No such nick`, `:${NET} 318 ${nick} ${who} :End of /WHOIS list`);
      } else {
        out.push(`:${NET} 311 ${nick} ${who} ${who[0]} ${NET} * :${who} Example`,
          `:${NET} 312 ${nick} ${who} ${NET} :Onyx test node`,
          `:${NET} 318 ${nick} ${who} :End of /WHOIS list`);
      }
    } else if (cmd === 'WHOWAS') {
      const who = arg[0];
      out.push(`:${NET} 314 ${nick} ${who} ${who[0]} cloak-7f3a.${NET} * :Wren Ito`,
        `:${NET} 330 ${nick} ${who} ${who} :is logged in as`,
        `:${NET} 312 ${nick} ${who} ${NET} :${Math.floor(Date.now() / 1000) - 3 * 3600}`,
        `:${NET} 369 ${nick} ${who} :End of WHOWAS`);
    } else if (cmd === 'SEEN') {
      const t = Date.now() - 3 * 3600 * 1000;
      out.push(`:${NET} NOTICE ${nick} :SEEN ${arg[0]}: last_seen=${t} last_login=${t - 2 * 3600 * 1000}`,
        `:${NET} NOTICE ${nick} :  logout ${t} ${arg[0]}!u@cloak.${NET}`);
    } else if (cmd === 'SETNAME') {
      out.push(`:${nick}!u@${NET} SETNAME :${trailing}`);
    }
    return out;
  };
}

/** Join with the socket proxied; returns inject(...lines). */
async function boot(page, h, opts = {}) {
  const nick = opts.nick || 'kn';
  const state = {
    modes: new Set(opts.modes || ['x']), accepts: new Set(opts.accepts || []), silence: new Set(opts.silence || []),
    memos: opts.memos || [], forward: null, memoIgnores: new Set(), autojoin: new Set(opts.autojoin || []),
    offline: (opts.offline || []).map((n) => n.toLowerCase()),
  };
  if (opts.prefs) {
    await page.addInitScript((p) => { try { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v); } catch { /* private */ } }, opts.prefs);
  }
  let client = null;
  const answer = responder(nick, state);
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    ws.onMessage((m) => {
      const text = String(m);
      const replies = [];
      for (const l of text.split(/\r?\n/).filter(Boolean)) replies.push(...answer(l));
      server.send(m);
      if (replies.length) setTimeout(() => { for (const r of replies) ws.send(r); }, 30);
    });
    server.onMessage((m) => ws.send(m));
  });
  await h.joinRoom(page, nick, opts.room === undefined ? '#lounge' : opts.room);
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) { await page.keyboard.press('Escape'); await h.settle(page, 200); }
  const inject = async (...lines) => { for (const l of lines) if (client) client.send(l); await h.settle(page, 400); };
  if (opts.account) await inject(`:${NET} 900 ${nick} ${nick}!u@${NET} ${opts.account} :You are now logged in as ${opts.account}`);
  return inject;
}

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) { await el.click().catch(() => {}); await h.settle(page); return true; }
    }
  }
  return false;
}

async function openYou(page, h) {
  if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]'], h);
  await clickVisible(page, ['[data-testid="you-open"]', '.onyx-mobile-nav [data-testid="nav-you"]'], h);
}

async function palette(page, h, query) {
  await page.keyboard.press('Control+k');
  await h.settle(page, 250);
  await page.keyboard.type(query);
  await h.settle(page, 150);
  await page.keyboard.press('Enter');
  await h.settle(page, 500);
}

async function slash(page, h, line) {
  const box = '#shell-composer-input';
  await page.fill(box, line);
  await h.settle(page, 150);
  await page.keyboard.press('Enter');
  await h.settle(page, 300);
  const left = await page.$eval(box, (el) => el.value).catch(() => '');
  if (left && left.trim()) { await page.keyboard.press('Enter'); await h.settle(page, 400); }
}

async function openPrefs(page, h) {
  await openYou(page, h);
  await clickVisible(page, ['[data-testid="you-settings-open-preferences"]'], h);
}

async function scrollSheet(page, h, sel) {
  await page.evaluate((s) => {
    const el = s ? document.querySelector(s) : null;
    const panels = document.querySelectorAll('[data-shortcut-scope]');
    const top = el || panels[panels.length - 1];
    if (top) top.scrollTop = top.scrollHeight;
  }, sel || null);
  await h.settle(page, 200);
}

export default {
  ...shell,
  'um-base-prefs': async (page, h) => { await boot(page, h); await openPrefs(page, h); },
  'um-base-notify': async (page, h) => { await boot(page, h, { account: 'kn' }); await palette(page, h, 'Notifications'); await scrollSheet(page, h); },
  'um-base-inbox': async (page, h) => { await boot(page, h); await clickVisible(page, ['[data-testid="inbox-bell"]'], h); },
  'um-base-account': async (page, h) => { await boot(page, h, { account: 'kn' }); await openYou(page, h); await clickVisible(page, ['[data-testid="you-open-account"]'], h); },
  'um-base-schedule': async (page, h) => {
    await boot(page, h, { account: 'kn' });
    await page.fill('#shell-composer-input', 'see you at six');
    await h.tryClick(page, '[data-testid="composer-more-tools"]');
    await h.tryClick(page, '[data-testid="composer-schedule"]');
  },
  'um-base-profile': async (page, h) => { await boot(page, h, { offline: ['wren'] }); await slash(page, h, '/whois wren'); },
};
