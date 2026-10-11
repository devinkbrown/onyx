// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-shell.mjs — extra screens.mjs scenarios for v3/gap-shell:
 * the Activity sheet, the room More menu additions, the Leave confirm,
 * join-by-name, the Home network message, the Start-a-room hang label,
 * and the sign-in failure states on the connect gate (wrong password,
 * taken name, registered name), plus a kill and an offline browser.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-shell.mjs \
 *     --only gs-activity,gs-leave,gs-more,gs-join,gs-motd,gs-hang,gs-bad-password,gs-nick-taken,gs-nick-registered,gs-killed,gs-offline
 *
 * The scenarios that need a misbehaving server (refused SASL, collisions,
 * a KILL) intercept the page's WebSocket with Playwright's
 * `routeWebSocket` and speak a minimal IRC themselves — never the live
 * network. It re-exports the shell scenarios, so one `--extra` covers both.
 */
import shell from './screens-shell.mjs';

const NET = 'onyx.test';
const MOTD = [
  'Welcome to Onyx.',
  '',
  'Mesh nodes: 2 linked  ·  uptime 41d',
  'Be kind, stay curious. Rooms are free to start.',
  'Maintenance window: Sundays 03:00 UTC (a few minutes).',
  'Questions? Ask in #lounge.',
];

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page, 350);
        return true;
      }
    }
  }
  return false;
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]:not([data-testid="activity-sheet"])')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

/** A tiny scriptable IRC server behind the page's /ws socket. */
async function mockIrc(page, o = {}) {
  const sockets = [];
  let connections = 0;
  await page.routeWebSocket(/\/ws(\?.*)?$/, (ws) => {
    const index = connections++;
    const st = { nick: 'guest', capDone: false, registered: false, saslPending: false };
    const send = (...lines) => { for (const l of lines) { try { ws.send(l); } catch { /* closed */ } } };
    const ctl = { send, close: () => ws.close(), st, index };
    sockets.push(ctl);
    const welcome = () => {
      if (st.registered || !st.capDone || st.saslPending) return;
      st.registered = true;
      send(`:${NET} 001 ${st.nick} :Welcome to the Onyx network, ${st.nick}`,
        `:${NET} 002 ${st.nick} :Your host is ${NET}`,
        `:${NET} 005 ${st.nick} CHANTYPES=# PREFIX=(qaohv)~&@%+ NETWORK=Onyx CHANMODES=b,k,l,imnpst :are supported`);
      const tail = o.tail ? o.tail(st, index) : null;
      if (tail === 'taken') {
        send(`:${NET} 433 ${st.nick} ${st.nick} :Nickname is already in use`);
        setTimeout(() => ws.close(), 30);
        return;
      }
      if (tail === 'registered') {
        send(`:${NET} 432 ${st.nick} ${st.nick} :Nickname is registered; authenticate as this account before using it`);
        setTimeout(() => ws.close(), 30);
        return;
      }
      send(`:${NET} NOTICE ${st.nick} :mesh: 2 nodes linked | /HELP to get started`);
      if (o.motd) {
        send(`:${NET} 375 ${st.nick} :- ${NET} Message of the day -`,
          ...o.motd.map((l) => `:${NET} 372 ${st.nick} :- ${l}`),
          `:${NET} 376 ${st.nick} :End of MOTD`);
      } else {
        send(`:${NET} 376 ${st.nick} :End of MOTD`);
      }
      if (o.afterWelcome) o.afterWelcome(send, st, ctl);
    };
    const room = (r) => {
      send(`@time=${new Date().toISOString()} :${st.nick}!u@${NET} JOIN ${r}`,
        `:${NET} 332 ${st.nick} ${r} :Welcome to ${r} — be kind, stay curious.`,
        `:${NET} 353 ${st.nick} = ${r} :${st.nick} ~mara @jun +theo sol ash nova`,
        `:${NET} 366 ${st.nick} ${r} :End of /NAMES list.`,
        `@time=${new Date(Date.now() - 120000).toISOString()};msgid=g${r}1 :mara!m@${NET} PRIVMSG ${r} :Morning all`,
        `@time=${new Date(Date.now() - 60000).toISOString()};msgid=g${r}2 :jun!j@${NET} PRIVMSG ${r} :Release notes are up`);
    };
    const handle = (line) => {
      const m = /^(?:@\S+ )?(\S+)(?: (.*))?$/.exec(line.trim());
      if (!m) return;
      const cmd = m[1].toUpperCase();
      const rest = m[2] || '';
      const arg = rest.split(' ');
      if (cmd === 'CAP' && arg[0] === 'LS') send(`:${NET} CAP * LS :sasl=PLAIN server-time message-tags echo-message batch labeled-response`);
      else if (cmd === 'CAP' && arg[0] === 'REQ') { send(`:${NET} CAP * ACK ${rest.slice(4)}`); if (/sasl/.test(rest)) st.saslPending = true; }
      else if (cmd === 'CAP' && arg[0] === 'END') { st.capDone = true; welcome(); }
      else if (cmd === 'NICK') st.nick = arg[0].replace(/^:/, '');
      else if (cmd === 'USER') welcome();
      else if (cmd === 'AUTHENTICATE') {
        if (arg[0] === 'PLAIN') send('AUTHENTICATE +');
        else if (o.sasl === 'fail') send(`:${NET} 904 ${st.nick} :SASL authentication failed`);
        else {
          st.saslPending = false;
          send(`:${NET} 900 ${st.nick} ${st.nick}!u@${NET} ${st.nick} :You are now logged in as ${st.nick}`, `:${NET} 903 ${st.nick} :SASL authentication successful`);
        }
      } else if (cmd === 'PING') send(`:${NET} PONG ${NET} ${rest}`);
      else if (cmd === 'JOIN') { for (const r of arg[0].split(',')) room(r); if (o.onJoin) o.onJoin(arg[0], send, st); }
      else if (cmd === 'PART') send(`:${st.nick}!u@${NET} PART ${arg[0]} :Goodbye`);
      else if (cmd === 'PRIVMSG' || cmd === 'NOTICE') send(`@time=${new Date().toISOString()};msgid=e${Date.now()} :${st.nick}!u@${NET} ${cmd} ${rest}`);
      else if (cmd === 'WHO') send(`:${NET} 315 ${st.nick} ${arg[0]} :End of /WHO list.`);
      else if (cmd === 'LIST') send(`:${NET} 321 ${st.nick} Channel :Users Name`, `:${NET} 322 ${st.nick} #lounge 18 :Hang out, say hi`, `:${NET} 323 ${st.nick} :End of /LIST`);
    };
    ws.onMessage((raw) => { for (const l of String(raw).split(/\r?\n/)) if (l) handle(l); });
  });
  return { sockets, last: () => sockets[sockets.length - 1], count: () => connections };
}

async function openGuest(page, h, { nick = 'kn', room = '#lounge' } = {}) {
  await page.goto(`${h.base}/app?${h.pin}`);
  await page.fill('#conn-nick', nick);
  if (room) await page.fill('#conn-room', room);
  await page.click('[data-testid="conn-submit"]');
}

async function settleIn(page, h, nick = 'kn', room = '#lounge') {
  await openGuest(page, h, { nick, room });
  await page.waitForSelector('[data-testid="connect"]', { state: 'detached', timeout: 8000 });
  await h.settle(page, 900);
  await dismissAsks(page, h);
}

async function backToList(page, h) {
  if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]', '.onyx-mobile-nav [data-testid="nav-rooms"]'], h);
}

async function openRoomMore(page, h) {
  await clickVisible(page, ['[data-testid="room-more"]', '.onyx-room-more-toggle'], h);
}

export default {
  ...shell,

  // The Activity sheet with a spread of server lines (Everything view).
  'gs-activity': async (page, h) => {
    await mockIrc(page, {
      motd: MOTD,
      afterWelcome: (send, st) => {
        send(`:op!o@${NET} WALLOPS :Restarting node 2 for a kernel patch at 03:00`,
          `:${NET} NOTICE ${st.nick} :Your session will be kept for 24h if you drop`,
          `:${NET} 710 ${st.nick} #vault ${st.nick}!u@h :has asked for an invite`,
          `:${NET} FAIL SEEN NO_SUCH_NICK zed :No such nick`,
          `:${NET} 477 ${st.nick} #vault :Cannot join channel (+a) - you must be authenticated`);
      },
    });
    await settleIn(page, h);
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="sidebar-activity"]'], h);
  },

  // Problems filter on, after some failures landed.
  'gs-activity-problems': async (page, h) => {
    const irc = await mockIrc(page, {});
    await settleIn(page, h);
    irc.last().send(`:${NET} FAIL CHANNEL CHANNEL_UNKNOWN #x :Channel is not registered`,
      `:${NET} 480 kn #busy :Cannot join channel (+j) - join rate exceeded, try again shortly`,
      `:${NET} NOTICE kn :Server will restart in 5 minutes`);
    await h.settle(page, 400);
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="sidebar-activity"]'], h);
    await clickVisible(page, ['[data-testid="activity-filter-problems"]'], h);
  },

  // Room More menu with Mark as read, Export, Ledger and Leave.
  'gs-more': async (page, h) => {
    const irc = await mockIrc(page, {});
    await settleIn(page, h);
    // Another room takes focus; #lounge gets traffic while away.
    await backToList(page, h);
    await page.fill('[data-testid="sidebar-join-input"]', 'design').catch(() => {});
    await clickVisible(page, ['[data-testid="sidebar-join-submit"]'], h);
    await h.settle(page, 500);
    irc.last().send(`@msgid=u1 :mara!m@${NET} PRIVMSG #lounge :anyone around?`, `@msgid=u2 :jun!j@${NET} PRIVMSG #lounge :yes, one minute`);
    await h.settle(page, 400);
    await backToList(page, h);
    await clickVisible(page, ['.onyx-rail-item:has-text("lounge")'], h);
    await h.settle(page, 400);
    await openRoomMore(page, h);
  },

  // The Leave confirm step.
  'gs-leave': async (page, h) => {
    await mockIrc(page, {});
    await settleIn(page, h);
    await openRoomMore(page, h);
    await clickVisible(page, ['[data-testid="ribbon-leave-room"]'], h);
  },

  // Join by name: filled, ready.
  'gs-join': async (page, h) => {
    await mockIrc(page, {});
    await settleIn(page, h);
    await backToList(page, h);
    await page.fill('[data-testid="sidebar-join-input"]', 'design').catch(() => {});
    await h.settle(page, 200);
  },

  // Join by name: refused input.
  'gs-join-error': async (page, h) => {
    await mockIrc(page, {});
    await settleIn(page, h);
    await backToList(page, h);
    await page.fill('[data-testid="sidebar-join-input"]', 'two words').catch(() => {});
    await page.keyboard.press('Enter');
    await h.settle(page, 250);
  },

  // Home with the network's message of the day.
  'gs-motd': async (page, h) => {
    await mockIrc(page, { motd: MOTD, afterWelcome: (send, st) => send(`:${NET} NOTICE ${st.nick} :WELCOME :Say hi in #lounge`, `:${NET} NOTICE ${st.nick} :WELCOME :Read the house rules`) });
    await settleIn(page, h, 'kn', '');
    await h.settle(page, 500);
  },

  // Start a room: the next-hang label is a real date now.
  'gs-hang': async (page, h) => {
    await mockIrc(page, {});
    await settleIn(page, h, 'kn', '');
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="sidebar-start-room"]', 'button:has-text("Start a room")'], h);
    await h.settle(page, 400);
  },

  // Wrong password on the connect gate: the real reason, no retry loop.
  'gs-bad-password': async (page, h) => {
    await mockIrc(page, { sasl: 'fail' });
    await page.goto(`${h.base}/app?${h.pin}`);
    await clickVisible(page, ['[data-testid="conn-mode-signin"]'], h);
    await page.fill('#conn-nick', 'kn');
    await page.fill('#conn-password', 'not-the-password');
    await page.click('[data-testid="conn-submit"]');
    await h.settle(page, 1500);
  },

  // A taken name: underscore retries, then a clear message.
  'gs-nick-taken': async (page, h) => {
    await mockIrc(page, { tail: () => 'taken' });
    await openGuest(page, h);
    await h.settle(page, 3500);
  },

  // A registered name: say so and offer Sign in.
  'gs-nick-registered': async (page, h) => {
    await mockIrc(page, { tail: () => 'registered' });
    await openGuest(page, h);
    await h.settle(page, 1500);
  },

  // An operator kill mid-session: the shell stays with the reason.
  'gs-killed': async (page, h) => {
    const irc = await mockIrc(page, {});
    await settleIn(page, h);
    irc.last().send(`:oper!o@${NET} KILL kn :Spamming invite links`,
      'ERROR :Closing Link: kn (Killed (oper (Spamming invite links)))');
    setTimeout(() => irc.last().close(), 60);
    await h.settle(page, 1200);
  },

  // The browser goes offline mid-session.
  'gs-offline': async (page, h) => {
    await mockIrc(page, {});
    await settleIn(page, h);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await h.settle(page, 900);
  },
};
