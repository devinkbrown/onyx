// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-chanserv.mjs — extra screens.mjs scenarios for the
 * registered-room services and channel-operator tools (v3/gap-chanserv):
 * Room settings (welcome + slow mode, more rules, mutes and exceptions,
 * registration), the join-refusal card, the hosts' join-request row and
 * the composer's slow-mode line.
 *
 *   node elm/tools/screens.mjs --vp se,phone,tablet,desktop \
 *     --extra elm/tools/screens-gap-chanserv.mjs --out /tmp/cs-shots
 *
 * The page's WebSocket goes through Playwright (`routeWebSocket`): the
 * local fake IRC server answers registration and JOIN, and this file
 * plays the parts it does not know (CHANNEL services, mask lists, join
 * refusals). Every line the client sends is kept in `page.__sent` so a
 * scenario can assert on the wire (see the `cs-wire` scenario).
 */

const NET = 'onyx.test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

/** A registered #lounge: INFO / ACCESS / AKICK / SUCCESSOR / LISTCHANS. */
function services(state) {
  const n = (text) => `:${NET} NOTICE kn :${text}`;
  return (cmd, args, send) => {
    const sub = (args[0] || '').toUpperCase();
    const chan = args[1] || '';
    if (cmd === 'CHANNEL' || cmd === 'CS') {
      if (sub === 'INFO') {
        if (!state.registered) return send(`:${NET} FAIL CHANNEL CHANNEL_UNKNOWN :No such registered channel`);
        send(n(`channel=${chan} founder=${state.founder} flags=${state.flags ?? 0} mlock=${state.mlock ?? '+nt'} topiclock=${!!state.topiclock} guard=${!!state.guard} private=false`));
        if (state.desc) send(n(`  desc: ${state.desc}`));
        if (state.url) send(n(`  url: ${state.url}`));
        return true;
      }
      if (sub === 'REGISTER') {
        state.registered = true;
        state.founder = 'kn';
        send(n(`Channel ${chan} registered to kn`));
        return true;
      }
      if (sub === 'DROP') {
        state.registered = false;
        send(n(`Channel ${chan} dropped`));
        return true;
      }
      if (sub === 'ACCESS') {
        for (const [a, l] of state.access ?? []) send(n(`ACCESS ${chan} ${a} ${l}`));
        send(n(`End of ACCESS list for ${chan}`));
        return true;
      }
      if (sub === 'AKICK') {
        for (const [m, r] of state.akick ?? []) send(n(`AKICK ${chan} ${m} :${r}`));
        send(n(`End of AKICK list for ${chan}`));
        return true;
      }
      return true;
    }
    if (cmd === 'SUCCESSOR') {
      send(n(state.successor ? `SUCCESSOR: ${chan} successor is ${state.successor}` : `SUCCESSOR: ${chan} has no successor`));
      return true;
    }
    if (cmd === 'LISTCHANS') {
      send(n(`LISTCHANS ${args[0] ?? '#lounge'} FOUNDER`), n('End of LISTCHANS (1)'));
      return true;
    }
    return false;
  };
}

/** Mask lists answer `MODE #c +Z|+e|+I` with 728/348/346 rows. */
function maskLists(lists) {
  const codes = { Z: ['728', '729', 'End of channel quiet list'], e: ['348', '349', 'End of channel exception list'], I: ['346', '347', 'End of channel invite exception list'] };
  return (cmd, args, send) => {
    if (cmd !== 'MODE' || args.length !== 2 || !/^\+[ZeI]$/.test(args[1])) return false;
    const letter = args[1][1];
    const [row, end, text] = codes[letter];
    for (const e of lists[letter] ?? []) send(`:${NET} ${row} kn ${args[0]} ${e[0]} ${e[1]} ${e[2]}`);
    send(`:${NET} ${end} kn ${args[0]} :${text}`);
    return true;
  };
}

/**
 * Join #lounge through the proxied socket. `fake(cmd, args, send)` may
 * answer a client line (return truthy to swallow it). Returns
 * `{ inject, sent }`.
 */
async function boot(page, h, opts = {}) {
  if ((page.viewportSize() || { width: 1440 }).width < 768) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }).catch(() => {});
  }
  const sent = [];
  let client = null;
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    const send = (...lines) => { for (const l of lines) ws.send(l); return true; };
    ws.onMessage((m) => {
      for (const raw of String(m).split(/\r?\n/)) {
        if (!raw) continue;
        sent.push(raw);
        const mm = /^(?:@\S+ )?(\S+)(?: (.*))?$/.exec(raw);
        const cmd = mm ? mm[1].toUpperCase() : '';
        const rest = mm?.[2] ?? '';
        const trailing = rest.indexOf(' :');
        const args = (trailing >= 0 ? rest.slice(0, trailing) : rest).split(' ').filter(Boolean);
        if (trailing >= 0) args.push(rest.slice(trailing + 2));
        let swallowed = false;
        for (const f of opts.fakes ?? []) { if (f(cmd, args, send)) { swallowed = true; break; } }
        if (!swallowed) server.send(raw + '\r\n');
      }
    });
    server.onMessage((m) => ws.send(m));
  });
  await h.joinRoom(page, 'kn', opts.room === undefined ? '#lounge' : opts.room);
  const inject = async (...lines) => {
    for (const l of lines) if (client) client.send(l);
    await h.settle(page, 350);
  };
  if (opts.account) await inject(`:${NET} 900 kn kn!u@${NET} kn :You are now logged in as kn`);
  if (opts.op) await inject(`:mara!m@${NET} MODE #lounge +o kn`);
  if (opts.oper) await inject(`:${NET} 381 kn :You are now an IRC operator`);
  if (opts.props) await inject(...Object.entries(opts.props).map(([k, v]) => `:${NET} 818 kn #lounge ${k} :${v}`));
  page.__sent = sent;
  return { inject, sent };
}


const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Click the first VISIBLE element matching any selector. */
async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page);
        return true;
      }
    }
  }
  return false;
}

/** Phones show the room list page for the shell entries. */
async function backToList(page, h) {
  if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]'], h);
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

async function openSettings(page, h) {
  await h.tryClick(page, '[data-testid="room-more"]');
  await h.tryClick(page, '[data-testid="room-more-menu"] button:has-text("Room settings")');
  await h.settle(page, 500);
}

/** Open the Advanced disclosure, then (optionally) a nested one. */
async function openAdvanced(page, h, nested) {
  await page.locator('.rset-advanced > summary').click().catch(() => {});
  await h.settle(page, 250);
  if (nested) {
    for (const label of [].concat(nested)) {
      await page.locator(`.rset summary:has-text("${label}")`).first().click().catch(() => {});
      await h.settle(page, 350);
    }
  }
}

async function reveal(page, h, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
  await h.settle(page, 250);
}

const founder = () => ({ registered: true, founder: 'kn', mlock: '+nt', topiclock: true, guard: false, desc: 'A calm room for the harbour crowd', url: 'https://harbour.example', access: [['kn', 'FOUNDER'], ['mara', 'OP'], ['sol', 'VOICE']], akick: [['troll!*@*', 'Spam'], ['account:badbot', 'Bot network']], successor: 'mara' });

const REFUSALS = {
  '#secure': `:${NET} 489 kn #secure :Cannot join channel (+S) - TLS required`,
  '#staff': `:${NET} 520 kn #staff :Cannot join channel (+O) - IRC operator required`,
  '#admins': `:${NET} 520 kn #admins :Cannot join channel (+A) - server administrator required`,
  '#vip': `:${NET} 473 kn #vip :Cannot join channel (+i)`,
  '#keyed': `:${NET} 475 kn #keyed :Cannot join channel (+k)`,
  '#full': `:${NET} 471 kn #full :Cannot join channel (+l)`,
  '#bouncy': `:${NET} 470 kn #bouncy #overflow :Forwarding to another channel`,
  '#busy': `:${NET} 480 kn #busy :Cannot join channel (+j) - throttled`,
};
const joinRefusals = (cmd, args, send) => {
  if (cmd !== 'JOIN') return false;
  const line = REFUSALS[args[0]];
  if (!line) return false;
  send(line);
  return true;
};

const sendComposer = async (page, h, text) => {
  await page.fill('#shell-composer-input', text);
  await page.keyboard.press('Enter');
  await h.settle(page, 500);
};

export default {
  // Hosts see Welcome and slow mode on top of Room settings.
  'cs-pace': async (page, h) => {
    await boot(page, h, { op: true, props: { ONJOIN: 'Welcome to the harbour. Be kind.', SLOWMODE: '30' } });
    await openSettings(page, h);
    await reveal(page, h, '[data-testid="chset-pace"]');
  },
  // Members only see what is set.
  'cs-pace-member': async (page, h) => {
    await boot(page, h, { props: { ONJOIN: 'Welcome to the harbour. Be kind.', SLOWMODE: '30' } });
    await openSettings(page, h);
    await reveal(page, h, '[data-testid="chset-pace"]');
  },
  'cs-more-rules': async (page, h) => {
    await boot(page, h, { op: true });
    await openSettings(page, h);
    await openAdvanced(page, h, 'More rules');
    await reveal(page, h, '[data-testid="chset-more-rules"]');
  },
  'cs-more-rules-end': async (page, h) => {
    await boot(page, h, { op: true, oper: true });
    await openSettings(page, h);
    await openAdvanced(page, h, 'More rules');
    await reveal(page, h, '[data-testid="chset-timed-start"]');
  },
  'cs-lists': async (page, h) => {
    const lists = { Z: [['noisy!*@*', 'mara', 1760000000], ['account:spammer', 'iris', 1760100000]], e: [['friend!*@trusted.example', 'mara', 1760000000]], I: [] };
    await boot(page, h, { op: true, fakes: [maskLists(lists)] });
    await openSettings(page, h);
    await openAdvanced(page, h);
    await reveal(page, h, '[data-testid="chset-lists"]');
  },
  'cs-register': async (page, h) => {
    const state = { registered: false };
    await boot(page, h, { op: true, account: true, fakes: [services(state)] });
    await openSettings(page, h);
    await openAdvanced(page, h);
    await reveal(page, h, '[data-testid="chset-registration"]');
  },
  'cs-register-guest': async (page, h) => {
    await boot(page, h, { op: true });
    await openSettings(page, h);
    await openAdvanced(page, h);
    await reveal(page, h, '[data-testid="chset-registration"]');
  },
  'cs-registered': async (page, h) => {
    const state = founder();
    await boot(page, h, { op: true, account: true, fakes: [services(state)] });
    await openSettings(page, h);
    await openAdvanced(page, h);
    await reveal(page, h, '[data-testid="chset-registration"]');
  },
  'cs-registered-open': async (page, h) => {
    const state = founder();
    await boot(page, h, { op: true, account: true, fakes: [services(state)] });
    await openSettings(page, h);
    await openAdvanced(page, h, ['Protection and locked rules', 'Auto-kick', 'Account access']);
    await reveal(page, h, '[data-testid="chset-akick"]');
  },
  'cs-registered-locks': async (page, h) => {
    const state = founder();
    await boot(page, h, { op: true, account: true, fakes: [services(state)] });
    await openSettings(page, h);
    await openAdvanced(page, h, ['Protection and locked rules']);
    await reveal(page, h, '[data-testid="chset-mlock-save"]');
  },
  // Join refusals as the app-wide card (browser closed).
  'cs-join-tls': async (page, h) => {
    await boot(page, h, { fakes: [joinRefusals] });
    await sendComposer(page, h, '/join #secure');
  },
  'cs-join-operators': async (page, h) => {
    await boot(page, h, { fakes: [joinRefusals] });
    await sendComposer(page, h, '/join #staff');
  },
  'cs-join-invite': async (page, h) => {
    await boot(page, h, { fakes: [joinRefusals] });
    await sendComposer(page, h, '/join #vip');
  },
  'cs-join-key': async (page, h) => {
    await boot(page, h, { fakes: [joinRefusals] });
    await sendComposer(page, h, '/join #keyed');
  },
  'cs-join-forwarded': async (page, h) => {
    await boot(page, h, { fakes: [joinRefusals] });
    await sendComposer(page, h, '/join #bouncy');
  },
  // The same refusal inside the room browser.
  'cs-join-browser': async (page, h) => {
    await boot(page, h, { fakes: [joinRefusals, (cmd, args, send) => {
      if (cmd !== 'LIST') return false;
      send(`:${NET} 321 kn Channel :Users Name`, `:${NET} 322 kn #vip 4 :Members only`, `:${NET} 322 kn #lounge 18 :Hang out`, `:${NET} 323 kn :End of /LIST`);
      return true;
    }] });
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="sidebar-browse-rooms"]', 'button:has-text("Browse rooms")'], h);
    await h.settle(page, 600);
    await clickVisible(page, ['button[aria-label="Join #vip"]'], h);
    await h.settle(page, 600);
  },
  // A host sees "X asks to join" with an Invite action in the inbox.
  'cs-knock-inbox': async (page, h) => {
    const { inject } = await boot(page, h, { op: true });
    await inject(`:${NET} 710 kn #lounge nova!n@host.example :may I come in? friend of mara`);
    await dismissAsks(page, h);
    await h.settle(page, 6500); // let the arrival toast go
    await backToList(page, h);
    await clickVisible(page, ['[data-testid="inbox-bell"]', '.shell-ribbon-bell'], h);
    await h.settle(page, 400);
  },
  // Slow mode: the countdown line over the composer after a send.
  'cs-slow-composer': async (page, h) => {
    await boot(page, h, { props: { SLOWMODE: '30' } });
    await sendComposer(page, h, 'hello harbour');
    await dismissAsks(page, h);
    await page.fill('#shell-composer-input', 'one more thing');
    await h.settle(page, 300);
  },
  // The wire a few key actions put out (asserted, then shot).
  'cs-wire': async (page, h) => {
    const state = { registered: false };
    const { sent } = await boot(page, h, { op: true, account: true, fakes: [services(state)] });
    await openSettings(page, h);
    await openAdvanced(page, h);
    await h.tryClick(page, '[data-testid="chset-register"]');
    await h.settle(page, 600);
    const want = ['CHANNEL INFO #lounge', 'CHANNEL REGISTER #lounge'];
    for (const w of want) if (!sent.some((l) => l.startsWith(w))) throw new Error(`wire: missing ${w}; sent ${sent.filter((l) => /^(CHANNEL|CS|MODE|PROP)/.test(l)).join(' | ')}`);
    await reveal(page, h, '[data-testid="chset-registration"]');
  },
  // Delete room (Room care) with a registered room: INFO, then DROP.
  'cs-delete-room': async (page, h) => {
    const state = founder();
    const { sent } = await boot(page, h, { op: true, account: true, fakes: [services(state)] });
    await h.tryClick(page, '[data-testid="steward-open"]');
    await h.settle(page, 500);
    await h.tryClick(page, '[data-testid="steward-delete-room"], button:has-text("Delete room")');
    await h.settle(page, 400);
    void sent;
  },
};
