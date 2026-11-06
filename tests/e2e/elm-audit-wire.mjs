// SPDX-License-Identifier: AGPL-3.0-or-later
/* global setTimeout */
// Shared mock IRC wire for the Fable UI audit. Answered through Playwright
// `page.routeWebSocket`, so nothing ever reaches the live network.
//
//   const wire = createWire({ ...options });
//   await page.routeWebSocket(WS, wire.handler);
//
// Options:
//   nickDefault   initial nick before NICK arrives (default 'guest')
//   dropAfterMs   close the socket after N ms once registered (reconnect states)
//   emptyRoom     #quiet has no messages and three members
//   manyRooms     join 40 extra rooms (long lists)
//   noHistory     do not replay the #root transcript
//   hugeRoot      500 messages in #root
export const WS = 'wss://fable-audit.test/ws';

// A 60-character unbroken nick: profile panels must wrap it, never overflow.
export const LONG_NICK = 'xq'.repeat(30);

const ROOT_MEMBERS = [
  '~mara', '&iris', '@jun', '@kain', '%ren', '+theo', '+sol', 'ash', 'nova', 'kip', 'trev', 'odile', 'bram', 'ciel', 'dax',
  'elia', 'fenn', 'gale', 'hollis', 'ines', 'jory', 'kazu', 'lior', 'mika', 'nell', 'oona', 'pax', 'quinn', 'rue', 'sasha',
  'tam', 'uli', 'vesper', 'wren', 'xan', 'yara', 'zed', 'a-very-long-nickname-that-tests-wrapping', 'guest-1337', 'ObserverBot',
  LONG_NICK,
];

const LONG_TOPIC = 'Welcome to #root — the front door. House rules: be kind, no spam, keep spoilers tagged. Voice call most evenings at six (local). Release notes: https://eshmaki.me/roadmap — ask an op if you need a hand finding your way around; this topic is intentionally long to test truncation in the header and the topic row.';

export function createWire(options = {}) {
  const sent = [];
  let socket = null;
  const api = {
    sent,
    get socket() { return socket; },
    // Server-side pushes for tests: a mention, a DM, an INVITE, an error…
    push(...lines) { for (const line of lines) socket?.send(line); },
    close() { socket?.close(); },
    historyFailed: false,
    handler: s => wire(s, options, sent, next => { socket = next; }, api),
  };
  return api;
}

function iso(minutesAgo, dayOffset = 0) {
  return new Date(Date.now() - minutesAgo * 60000 - dayOffset * 86400000).toISOString();
}

let msgCounter = 100;
function mid() { msgCounter += 1; return `m${msgCounter}`; }

export function rootTranscript(nick, { huge = false } = {}) {
  msgCounter = 100; // ids are per transcript so +draft/reply=m105 resolves in every context
  const t = (minutesAgo, from, body, extraTags = '', dayOffset = 0) =>
    `@time=${iso(minutesAgo, dayOffset)};msgid=${mid()}${extraTags ? ';' + extraTags : ''} :${from}!${from.slice(0, 4)}@onyx.test PRIVMSG #root :${body}`;
  const lines = [
    t(1500, 'mara', 'Yesterday’s build is up on staging if anyone wants to poke at it.', '', 1),
    t(1490, 'jun', 'On it. Release notes are on the roadmap page.', '', 1),
    t(1480, 'mara', 'https://eshmaki.me/roadmap#catch-up', '', 1),
    t(300, 'trev', `${nick}: are you around for the call later?`),
    t(299, 'trev', 'first or second time I can’t really tell'),
    t(298, 'trev', 'went to the ER because I was so weak and they pumped me full of fluids and tried to give me a 1500 prescription'),
    t(297, 'trev', 'I’m just coming off of it now'),
    t(240, 'sol', 'A long message to test wrapping on narrow screens: the quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly, and pack my box with five dozen liquor jugs — all before the composer and the roster steal any width.'),
    t(239, 'ash', 'https://example.com/a/very/long/url/that/should/wrap/or/truncate/instead/of/forcing/horizontal/scroll/0123456789/abcdefghijklmnopqrstuvwxyz/0123456789'),
    t(238, 'nova', 'Supercalifragilisticexpialidociouslylongwordwithoutanyspacesatallthatkeepsgoingandgoingandgoing_ok_done'),
    t(200, 'kip', '\u0001ACTION waves at everyone\u0001'),
    t(180, 'iris', 'Pinned reminder: voice call at six. \u{1F3A7}'),
    t(120, 'jun', `@${nick} can you check the composer on iPhone? the audience pill looks off`),
    t(90, 'odile', 'reply test →', '+draft/reply=m105'),
    t(60, 'ren', '<b>not bold</b> &amp; "quotes" and emoji \u{1F600}\u{1F680}❤️'),
    t(30, 'a-very-long-nickname-that-tests-wrapping', 'my name is long and so is this line, which should not break the author column or the time stamp alignment at 320px'),
    t(5, 'mara', 'Voice call at six, I will set it up.'),
    t(4, 'mara', 'bring questions'),
    t(3, 'mara', 'and snacks'),
    `@time=${iso(2)};msgid=${mid()};+draft/react=\u{1F44D};+draft/reply=m117 :sol!sol@onyx.test TAGMSG #root`,
    `@time=${iso(2)};msgid=${mid()};+draft/react=\u{1F389};+draft/reply=m117 :ash!ash@onyx.test TAGMSG #root`,
  ];
  if (huge) {
    for (let i = 0; i < 500; i += 1) lines.push(t(2000 + i, i % 3 ? 'nova' : 'kip', `Buffered message ${i} with readable conversation text.`, '', 2));
  }
  return lines;
}

function wire(socket, options, sent, bind, api) {
  bind(socket);
  let nick = options.nickDefault ?? 'guest';
  let registered = false;
  const send = (...lines) => lines.forEach(line => socket.send(line));
  const joined = new Set();
  const rooms = {
    '#root': { members: ROOT_MEMBERS, topic: LONG_TOPIC },
    '#lounge': { members: ['@mara', 'jun', 'sol', 'nova'], topic: 'Hang out, say hi' },
    '#design-system-working-group-with-an-overlong-name': { members: ['~iris', 'ren'], topic: '' },
    '#quiet': { members: ['trev', 'kip'], topic: 'nothing happens here' },
  };
  if (options.manyRooms) for (let i = 1; i <= 40; i += 1) rooms[`#room-${String(i).padStart(2, '0')}`] = { members: ['ash'], topic: `Room ${i}` };

  const join = room => {
    if (joined.has(room)) return;
    joined.add(room);
    const def = rooms[room] ?? { members: ['ash'], topic: '' };
    send(`:${nick}!u@onyx.test JOIN ${room}`);
    if (def.topic) send(`:onyx.test 332 ${nick} ${room} :${def.topic}`, `:onyx.test 333 ${nick} ${room} mara!m@onyx.test ${Math.floor(Date.now() / 1000) - 86400}`);
  };

  socket.onMessage(frame => {
    const line = String(frame).trim();
    sent.push(line);
    const bare = line.replace(/^@\S+ /, '');
    const [cmd, ...rest] = bare.split(' ');
    const upper = (cmd || '').toUpperCase();
    if (upper === 'CAP' && rest[0] === 'LS') send(':onyx.test CAP * LS :server-time message-tags echo-message draft/react draft/reply batch chathistory sasl=PLAIN,SCRAM-SHA-256 account-notify away-notify');
    else if (upper === 'CAP' && rest[0] === 'REQ') send(`:onyx.test CAP * ACK :${rest.slice(1).join(' ').replace(/^:/, '')}`);
    else if (upper === 'NICK') {
      const next = rest[0].replace(/^:/, '');
      if (registered && next.toLowerCase() === 'taken') send(`:onyx.test 433 ${nick} ${next} :Nickname is already in use`);
      else if (registered) { send(`:${nick}!u@onyx.test NICK ${next}`); nick = next; }
      else nick = next;
    } else if (upper === 'CAP' && rest[0] === 'END') {
      registered = true;
      send(`:onyx.test 001 ${nick} :Welcome to the Onyx network, ${nick}`,
        `:onyx.test 002 ${nick} :Your host is onyx.test, running Onyx Server`,
        `:onyx.test 005 ${nick} CASEMAPPING=rfc1459 CHANTYPES=#& PREFIX=(qaohv)~&@%+ NETWORK=Onyx STATUSMSG=~&@%+ MSGREFTYPES=msgid :are supported`,
        `:onyx.test 005 ${nick} CHATHISTORY=200 BOT=B UTF8ONLY :are supported`,
        `:onyx.test NOTICE ${nick} :connecting from Dacula, Georgia, US | AS7018 (AT&T Enterprises, LLC)`,
        `:onyx.test NOTICE ${nick} :secured (TLS1.3 CHACHA20-POLY1305) | you are df586a83bac60079d2fc74b1265aa0ef`,
        `:onyx.test NOTICE ${nick} :mesh: 2 nodes linked | /HELP to get started`,
        `:onyx.test 421 ${nick} METADATA :Unknown command`,
        `:onyx.test 421 ${nick} EVENT :Unknown command`,
        `:onyx.test FAIL CHATHISTORY NEED_REGISTRATION :You must negotiate the draft/chathistory capability first`);
      if (!options.noAutoJoin) {
        join('#root'); join('#lounge'); join('#design-system-working-group-with-an-overlong-name'); join('#quiet');
        if (options.manyRooms) Object.keys(rooms).filter(r => r.startsWith('#room-')).forEach(join);
      }
      // Direct messages: one short unread, one from a long nick.
      send(`@time=${iso(45)};msgid=${mid()} :nova!n@onyx.test PRIVMSG ${nick} :hey — are you around for the call later? I have a question about the roadmap and the new composer.`,
        `@time=${iso(44)};msgid=${mid()} :nova!n@onyx.test PRIVMSG ${nick} :also: https://eshmaki.me/guides`,
        `@time=${iso(20)};msgid=${mid()} :a-very-long-nickname-that-tests-wrapping!x@onyx.test PRIVMSG ${nick} :long-nick DM`,
        `:iris!i@onyx.test INVITE ${nick} #secret-garden`,
        `:nova!n@onyx.test AWAY :brb`);
      if (options.dropAfterMs) setTimeout(() => { try { socket.close(); } catch { /* closed */ } }, options.dropAfterMs);
    } else if (upper === 'NAMES') {
      const room = rest[0];
      const def = rooms[room] ?? { members: ['ash'] };
      const members = [nick, ...def.members];
      for (let i = 0; i < members.length; i += 20) send(`:onyx.test 353 ${nick} = ${room} :${members.slice(i, i + 20).join(' ')}`);
      send(`:onyx.test 366 ${nick} ${room} :End of names`);
      if (room === '#root' && !options.noHistory) send(...rootTranscript(nick, { huge: !!options.hugeRoot }));
      if (room === '#lounge') send(`@time=${iso(12)};msgid=${mid()} :sol!s@onyx.test PRIVMSG #lounge :${nick}: welcome in! grab a seat`);
    } else if (upper === 'MODE' && rest.length === 1) send(`:onyx.test 324 ${nick} ${rest[0]} +nt`, `:onyx.test 329 ${nick} ${rest[0]} 1700000000`);
    else if (upper === 'PROP' && rest.length === 1) send(`:onyx.test 818 ${nick} ${rest[0]} TOPIC :${rooms[rest[0]]?.topic ?? ''}`, `:onyx.test 819 ${nick} ${rest[0]} :End of properties`);
    else if (upper === 'TOPIC' && rest.length === 1) send(`:onyx.test 332 ${nick} ${rest[0]} :${rooms[rest[0]]?.topic ?? ''}`);
    else if (upper === 'JOIN') rest[0].split(',').forEach(join);
    else if (upper === 'PART') { joined.delete(rest[0]); send(`:${nick}!u@onyx.test PART ${rest[0]}`); }
    else if (upper === 'LIST') {
      send(`:onyx.test 321 ${nick} Channel :Users Name`);
      send(`:onyx.test 322 ${nick} #root 42 :The front door`, `:onyx.test 322 ${nick} #lounge 18 :Hang out, say hi`, `:onyx.test 322 ${nick} #games 7 :Board games and co-op nights`, `:onyx.test 322 ${nick} #design-system-working-group-with-an-overlong-name 2 :`);
      send(`:onyx.test 323 ${nick} :End of /LIST`);
    } else if (upper === 'PRIVMSG') {
      const target = rest[0];
      const body = bare.slice(bare.indexOf(' :') + 2);
      const tags = line.startsWith('@') ? line.split(' ')[0] : '';
      if (target.toLowerCase() === 'nobody') send(`:onyx.test 401 ${nick} nobody :No such nick/channel`);
      else send(`${tags ? tags + ';' : '@'}time=${iso(0)};msgid=${mid()} :${nick}!u@onyx.test PRIVMSG ${target} :${body}`);
    } else if (upper === 'TAGMSG') {
      const tags = line.split(' ')[0];
      send(`${tags};time=${iso(0)};msgid=${mid()} :${nick}!u@onyx.test TAGMSG ${rest[0]}`);
    } else if (upper === 'WHOIS') {
      const who = rest[rest.length - 1];
      const realname = who === LONG_NICK ? `${'W'.repeat(70)} realname-without-spaces-${'y'.repeat(40)} https://example.com/${'p'.repeat(80)}` : `${who} (real name)`;
      const host = who === LONG_NICK ? `${'h'.repeat(60)}.example` : 'host.example';
      send(`:onyx.test 311 ${nick} ${who} ~${who} ${host} * :${realname}`, `:onyx.test 312 ${nick} ${who} onyx.test :Onyx`, `:onyx.test 319 ${nick} ${who} :@#root #lounge`, `:onyx.test 317 ${nick} ${who} 120 1700000000 :seconds idle, signon time`, `:onyx.test 318 ${nick} ${who} :End of /WHOIS list`);
    } else if (upper === 'PING') send(`:onyx.test PONG onyx.test :${rest.join(' ').replace(/^:/, '')}`);
    else if (upper === 'CHATHISTORY') { if (!api.historyFailed) { api.historyFailed = true; send(`:onyx.test FAIL CHATHISTORY NEED_REGISTRATION :You must negotiate the draft/chathistory capability first`); } }
    else if (upper === 'AUTHENTICATE') send(`:onyx.test 904 ${nick} :SASL authentication failed`);
    else if (upper === 'IDENTIFY' || upper === 'REGISTER' || upper === 'ACCOUNT' || upper === 'SESSION') send(`:onyx.test FAIL ${upper} ACCOUNT_REQUIRED :Accounts are unavailable on this test node`);
    else if (upper === 'METADATA' || upper === 'EVENT' || upper === 'MEDIA') send(`:onyx.test 421 ${nick} ${upper} :Unknown command`);
  });
}
