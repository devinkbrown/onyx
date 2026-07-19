// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  parseIRCMessage,
  escapeTagValue,
  formatIRCLine,
  formatTaggedLine,
  parseNamesPrefix,
  parsePREFIX,
  parseCHANLIMIT,
  normalizeCase,
  selectSaslMechanism,
  parseStandardReply,
  MAX_STANDARD_REPLY_PARAMS,
  MAX_STANDARD_REPLY_TOKEN_LENGTH,
  parseSessionTokenNote,
  parseSessionMeshTokenNote,
  isValidSessionCredential,
  MAX_SESSION_CREDENTIAL_LENGTH,
  buildSessionResumeLine,
  MAX_MONITOR_NUMERIC_TARGETS,
  parseMonitorNumeric,
  parseAccountInfo,
  MAX_ACCOUNT_INFO_TEXT_LENGTH,
} from './parser';

describe('parseIRCMessage', () => {
  it('parses a bare command with a trailing param', () => {
    const m = parseIRCMessage('PING :token123');
    expect(m.command).toBe('PING');
    expect(m.params).toEqual(['token123']);
    expect(m.prefix).toBeNull();
  });

  it('extracts nick + host from a nick!user@host prefix', () => {
    const m = parseIRCMessage(':alice!ally@host.example PRIVMSG #onyx :hello world');
    expect(m.nick).toBe('alice');
    expect(m.host).toBe('host.example');
    expect(m.command).toBe('PRIVMSG');
    expect(m.params).toEqual(['#onyx', 'hello world']);
  });

  it('keeps a server-name prefix as the prefix', () => {
    const m = parseIRCMessage(':eshmaki.me 001 onyx :Welcome');
    expect(m.prefix).toBe('eshmaki.me');
    expect(m.command).toBe('001');
    expect(m.params[0]).toBe('onyx');
  });

  it('parses IRCv3 message tags with escapes', () => {
    const m = parseIRCMessage('@account=bob;msg=a\\sb :n!u@h PRIVMSG #c :hi');
    expect(m.tags.account).toBe('bob');
    expect(m.tags.msg).toBe('a b'); // \s unescapes to a space
    expect(m.command).toBe('PRIVMSG');
  });

  it('unescapes an escaped backslash as a single left-to-right pass', () => {
    // Wire value `\\s` = an escaped backslash followed by a literal `s`.
    // Per IRCv3 it must decode to `\s` (backslash + s), NOT be re-interpreted
    // as `\s` (space). A multi-pass replace collapses `\\`->`\` and then wrongly
    // reads the trailing `s` as an escape.
    const m = parseIRCMessage('@k=\\\\s FOO');
    expect(m.tags.k).toBe('\\s');
  });

  it('does not resurrect escapes after collapsing a doubled backslash (\\n, \\:)', () => {
    const mn = parseIRCMessage('@k=\\\\n FOO');
    expect(mn.tags.k).toBe('\\n'); // backslash + n, never a newline
    const mc = parseIRCMessage('@k=\\\\: FOO');
    expect(mc.tags.k).toBe('\\:'); // backslash + colon, never a semicolon
  });

  it('round-trips every escaped tag value through escape/unescape', () => {
    for (const orig of ['\\s', '\\n', '\\:', 'a\\b', 'a;b c', 'x\\\\y', 'plain']) {
      const m = parseIRCMessage('@k=' + escapeTagValue(orig) + ' FOO');
      expect(m.tags.k).toBe(orig);
    }
  });

  it('drops a lone trailing backslash and passes unknown escapes through', () => {
    expect(parseIRCMessage('@k=abc\\ FOO').tags.k).toBe('abc'); // trailing lone backslash dropped
    expect(parseIRCMessage('@k=a\\xb FOO').tags.k).toBe('axb'); // unknown escape -> literal char
  });

  it('strips a trailing CRLF and null bytes', () => {
    const m = parseIRCMessage('NICK onyx\x00\r\n');
    expect(m.command).toBe('NICK');
    expect(m.params).toEqual(['onyx']);
  });
});

describe('formatIRCLine', () => {
  it('prefixes a trailing param containing a space with a colon and ends with CRLF', () => {
    expect(formatIRCLine('PRIVMSG', '#c', 'hello world')).toBe('PRIVMSG #c :hello world\r\n');
  });
  it('leaves a single space-free param unprefixed', () => {
    expect(formatIRCLine('NICK', 'onyx')).toBe('NICK onyx\r\n');
  });
  it('colon-prefixes an empty trailing param', () => {
    expect(formatIRCLine('PART', '#c', '')).toBe('PART #c :\r\n');
  });

  // CRLF/NUL injection guard: a single formatIRCLine call must NEVER be able to
  // emit a second IRC command. Without stripping, a param carrying an embedded
  // \r\n (a composer paste, a rename-dialog nick, a topic/part reason, or a
  // server-supplied session token) would let one call transmit two commands.
  it('strips embedded CR/LF/NUL from the trailing param so it cannot inject a second command', () => {
    const line = formatIRCLine('PRIVMSG', '#c', 'hi\r\nJOIN #evil');
    expect(line).toBe('PRIVMSG #c :hiJOIN #evil\r\n');
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\0]/);
  });
  it('strips CR/LF/NUL from the command token and middle params', () => {
    const line = formatIRCLine('NICK\r\nOPER', 'ev\x00il', 'x');
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\0]/);
  });
  it('buildSessionResumeLine cannot be split by a CRLF-laced token', () => {
    const line = buildSessionResumeLine('tok\r\nPRIVMSG #x :pwned');
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\0]/);
    expect(line.endsWith('\r\n')).toBe(true);
  });
});

describe('formatTaggedLine', () => {
  it('emits a plain formatIRCLine when there are no tags', () => {
    expect(formatTaggedLine({}, 'PRIVMSG', '#c', 'hello world')).toBe(
      'PRIVMSG #c :hello world\r\n',
    );
  });
  it('prepends an escaped @tag prefix and one space before the command', () => {
    expect(formatTaggedLine({ '+draft/reply': 'abc123' }, 'PRIVMSG', '#c', 'hi there')).toBe(
      '@+draft/reply=abc123 PRIVMSG #c :hi there\r\n',
    );
  });
  it('serialises a valueless tag as a bare key', () => {
    expect(formatTaggedLine({ 'draft/bot': '' }, 'TAGMSG', '#c')).toBe(
      '@draft/bot TAGMSG #c\r\n',
    );
  });
  it('joins multiple tags with a semicolon in insertion order', () => {
    const line = formatTaggedLine({ a: '1', b: '2' }, 'TAGMSG', '#c');
    expect(line).toBe('@a=1;b=2 TAGMSG #c\r\n');
  });

  // Injection guard — the outbound choke point the store now routes through.
  // A lone \r or \n in the message body (the store splits only on \n) must be
  // stripped by construction so it can never smuggle a second wire command.
  it('strips a lone CR from the trailing body so it cannot inject a second command', () => {
    const line = formatTaggedLine({ '+draft/reply': 'r1' }, 'PRIVMSG', '#c', 'hi there\rQUIT');
    expect(line).toBe('@+draft/reply=r1 PRIVMSG #c :hi thereQUIT\r\n');
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\0]/);
  });
  it('strips embedded CR/LF/NUL from the body and target', () => {
    const line = formatTaggedLine({ x: 'y' }, 'PRIVMSG', '#c\r\nJOIN #evil', 'a\nb\x00c');
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\0]/);
    expect(line.endsWith('\r\n')).toBe(true);
  });
  it('neutralises CR/LF hidden inside a tag value via IRCv3 escaping', () => {
    const line = formatTaggedLine({ '+draft/reply': 'a\r\nb' }, 'PRIVMSG', '#c', 'hello');
    // \r → \r, \n → \n escape sequences — literal control bytes never reach the wire.
    expect(line).toBe('@+draft/reply=a\\r\\nb PRIVMSG #c hello\r\n');
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\0]/);
  });
});

describe('parseNamesPrefix', () => {
  const map = { '~': 'q', '@': 'o', '+': 'v', '%': 'h', '&': 'a' };
  it('collects leading mode prefixes and the nick', () => {
    expect(parseNamesPrefix('@bob', map)).toEqual({ nick: 'bob', modes: new Set(['o']) });
  });
  it('handles stacked prefixes + userhost-in-names', () => {
    const r = parseNamesPrefix('~@alice!u@h', map);
    expect(r.nick).toBe('alice');
    expect(r.modes).toEqual(new Set(['q', 'o']));
  });
});

describe('parsePREFIX', () => {
  it('maps modes <-> prefix chars from an ISUPPORT value', () => {
    const r = parsePREFIX('(qaohv)~&@%+');
    expect(r.modeToPrefix).toMatchObject({ q: '~', a: '&', o: '@', h: '%', v: '+' });
    expect(r.prefixToMode).toMatchObject({ '~': 'q', '@': 'o', '+': 'v' });
  });
  it('returns empty maps for a malformed value', () => {
    expect(parsePREFIX('garbage')).toEqual({ modeToPrefix: {}, prefixToMode: {} });
  });
});

describe('parseCHANLIMIT', () => {
  it('expands grouped channel-type limits', () => {
    expect(parseCHANLIMIT('#&:25,!:10')).toEqual({ '#': 25, '&': 25, '!': 10 });
  });

  it('rejects malformed, ambiguous, or unbounded values as a whole', () => {
    expect(parseCHANLIMIT('#:25junk')).toEqual({});
    expect(parseCHANLIMIT('#:-1')).toEqual({});
    expect(parseCHANLIMIT('#:25,')).toEqual({});
    expect(parseCHANLIMIT('#:25,#:10')).toEqual({});
    expect(parseCHANLIMIT(`${'#'.repeat(17)}:25`)).toEqual({});
    expect(parseCHANLIMIT('#:1000001')).toEqual({});
    expect(parseCHANLIMIT('x'.repeat(1025))).toEqual({});
  });
});

describe('normalizeCase', () => {
  it('ascii lowercases only', () => {
    expect(normalizeCase('Foo[]\\^', 'ascii')).toBe('foo[]\\^');
  });
  it('rfc1459 folds []\\^ to {}|~', () => {
    expect(normalizeCase('Foo[]\\^', 'rfc1459')).toBe('foo{}|~');
  });
});

describe('selectSaslMechanism', () => {
  it('prefers SCRAM when a password is present', () => {
    expect(selectSaslMechanism(['PLAIN', 'SCRAM-SHA-256'], { hasPassword: true })).toBe('SCRAM-SHA-256');
  });
  it('falls back to PLAIN', () => {
    expect(selectSaslMechanism(['PLAIN'], { hasPassword: true })).toBe('PLAIN');
  });
  it('uses EXTERNAL with a cert and no password', () => {
    expect(selectSaslMechanism(['EXTERNAL'], { hasPassword: false, hasClientCert: true })).toBe('EXTERNAL');
  });
  it('returns null when nothing is usable', () => {
    expect(selectSaslMechanism(['PLAIN'], { hasPassword: false })).toBeNull();
  });
});

describe('standard replies + SESSION notes', () => {
  it('parses a NOTE standard reply', () => {
    const r = parseStandardReply(parseIRCMessage(':srv NOTE REGISTER SUCCESS :done'));
    expect(r).toMatchObject({ kind: 'NOTE', command: 'REGISTER', code: 'SUCCESS', description: 'done' });
  });
  it('ignores non standard-reply commands', () => {
    expect(parseStandardReply(parseIRCMessage(':srv PRIVMSG #c :hi'))).toBeNull();
  });
  it('rejects unbounded parameter and token work', () => {
    const params = Array.from(
      { length: MAX_STANDARD_REPLY_PARAMS + 1 },
      (_, index) => `value-${index}`,
    ).join(' ');
    expect(parseStandardReply(parseIRCMessage(`:srv NOTE ${params}`))).toBeNull();
    expect(parseStandardReply(parseIRCMessage(
      `:srv FAIL SEARCH RATE_LIMITED :${'x'.repeat(MAX_STANDARD_REPLY_TOKEN_LENGTH + 1)}`,
    ))).toBeNull();
  });
  it('extracts a SESSION TOKEN', () => {
    expect(parseSessionTokenNote(parseIRCMessage(':srv NOTE SESSION TOKEN :abc123')))
      .toEqual({ token: 'abc123' });
  });
  it('extracts a SESSION TOKEN from the current server NOTICE envelope', () => {
    expect(parseSessionTokenNote(
      parseIRCMessage(':srv.example NOTICE onyx :SESSION TOKEN abc123'),
    )).toEqual({ token: 'abc123' });
  });
  it('extracts a SESSION MTOKEN (mesh)', () => {
    expect(parseSessionMeshTokenNote(parseIRCMessage(':srv NOTE SESSION MTOKEN :m3sh')))
      .toEqual({ token: 'm3sh' });
  });
  it('extracts a SESSION MTOKEN from the current server NOTICE envelope', () => {
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv.example NOTICE onyx :SESSION MTOKEN m3sh'),
    )).toEqual({ token: 'm3sh' });
  });
  it('extracts MTOKEN expires= from the live server NOTICE form', () => {
    // Onyx Server: `SESSION MTOKEN {hex} expires={unix}` (mesh wall clock).
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv.example NOTICE onyx :SESSION MTOKEN m3shdeadbeef expires=1800000000'),
    )).toEqual({ token: 'm3shdeadbeef', expiresAt: 1_800_000_000 });
  });
  it('extracts MTOKEN expires= from a standard-reply description trailer', () => {
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTE SESSION MTOKEN :m3sh expires=1800000000'),
    )).toEqual({ token: 'm3sh', expiresAt: 1_800_000_000 });
  });
  it('extracts MTOKEN expires= when the token sits in standard-reply context', () => {
    // NOTE SESSION MTOKEN <token> :expires=<unix>
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTE SESSION MTOKEN m3sh :expires=1800000000'),
    )).toEqual({ token: 'm3sh', expiresAt: 1_800_000_000 });
  });
  it('does not confuse TOKEN and MTOKEN', () => {
    expect(parseSessionMeshTokenNote(parseIRCMessage(':srv NOTE SESSION TOKEN :abc'))).toBeNull();
  });
  it('rejects malformed or oversized session credentials', () => {
    // Free-text trailer (not key=value) fails closed on both envelopes.
    expect(parseSessionTokenNote(parseIRCMessage(':srv NOTE SESSION TOKEN :abc extra'))).toBeNull();
    expect(parseSessionTokenNote(
      parseIRCMessage(':srv NOTICE onyx :SESSION TOKEN abc extra'),
    )).toBeNull();
    expect(parseSessionTokenNote(parseIRCMessage(
      `:srv NOTICE onyx :SESSION TOKEN ${'x'.repeat(MAX_SESSION_CREDENTIAL_LENGTH + 1)}`,
    ))).toBeNull();
    expect(parseSessionMeshTokenNote(parseIRCMessage(
      `:srv NOTE SESSION MTOKEN :${'x'.repeat(MAX_SESSION_CREDENTIAL_LENGTH + 1)}`,
    ))).toBeNull();
  });
  it('rejects a malformed expires= attr fail-closed (does not return the bare token)', () => {
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTICE onyx :SESSION MTOKEN m3sh expires=not-a-number'),
    )).toBeNull();
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTICE onyx :SESSION MTOKEN m3sh expires=-1'),
    )).toBeNull();
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTICE onyx :SESSION MTOKEN m3sh expires=01'),
    )).toBeNull();
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTICE onyx :SESSION MTOKEN m3sh expires=1 expires=2'),
    )).toBeNull();
    // Oversized digit run.
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(`:srv NOTICE onyx :SESSION MTOKEN m3sh expires=${'9'.repeat(17)}`),
    )).toBeNull();
  });
  it('ignores unknown key=value attrs for forward-compat', () => {
    expect(parseSessionMeshTokenNote(
      parseIRCMessage(':srv NOTICE onyx :SESSION MTOKEN m3sh expires=1800000000 scope=mesh'),
    )).toEqual({ token: 'm3sh', expiresAt: 1_800_000_000 });
  });
  it('builds a resume line', () => {
    expect(buildSessionResumeLine('tok')).toBe('SESSION RESUME tok\r\n');
  });
  it('isValidSessionCredential mirrors the parse-side fail-closed rules', () => {
    expect(isValidSessionCredential('abc123')).toBe(true);
    expect(isValidSessionCredential('x'.repeat(MAX_SESSION_CREDENTIAL_LENGTH))).toBe(true);
    expect(isValidSessionCredential('')).toBe(false);
    expect(isValidSessionCredential(null)).toBe(false);
    expect(isValidSessionCredential(undefined)).toBe(false);
    expect(isValidSessionCredential('has space')).toBe(false);
    expect(isValidSessionCredential('tok\r\nPRIVMSG')).toBe(false);
    expect(isValidSessionCredential('tok\0nul')).toBe(false);
    expect(isValidSessionCredential('x'.repeat(MAX_SESSION_CREDENTIAL_LENGTH + 1))).toBe(false);
  });
});

describe('parseMonitorNumeric', () => {
  it('730 -> online targets', () => {
    expect(parseMonitorNumeric(parseIRCMessage(':srv 730 onyx :bob,carol'))).toMatchObject({
      kind: 'online', targets: ['bob', 'carol'],
    });
  });
  it('731 -> offline targets', () => {
    expect(parseMonitorNumeric(parseIRCMessage(':srv 731 onyx :dave'))).toMatchObject({
      kind: 'offline', targets: ['dave'],
    });
  });
  it('deduplicates and bounds server-owned target lists', () => {
    expect(parseMonitorNumeric(parseIRCMessage(':srv 730 onyx :Bob,bob,carol'))).toMatchObject({
      kind: 'online', targets: ['Bob', 'carol'],
    });
    const tooMany = Array.from(
      { length: MAX_MONITOR_NUMERIC_TARGETS + 1 },
      (_, index) => `nick-${index}`,
    ).join(',');
    expect(parseMonitorNumeric(parseIRCMessage(`:srv 730 onyx :${tooMany}`))).toMatchObject({
      kind: 'online', targets: [],
    });
    expect(parseMonitorNumeric(parseIRCMessage(`:srv 731 onyx :${'x'.repeat(513)}`))).toMatchObject({
      kind: 'offline', targets: [],
    });
  });
  it('parses only strict bounded MONLISTFULL fields', () => {
    expect(parseMonitorNumeric(
      parseIRCMessage(':srv 734 onyx 128 bob,carol :Monitor list is full'),
    )).toMatchObject({
      kind: 'full', targets: ['bob', 'carol'], limit: 128,
    });
    expect(parseMonitorNumeric(
      parseIRCMessage(':srv 734 onyx 128junk bob :Monitor list is full'),
    )).toMatchObject({ kind: 'full', targets: ['bob'], limit: undefined });
  });
  it('non-monitor numerics return null', () => {
    expect(parseMonitorNumeric(parseIRCMessage(':srv 001 onyx :hi'))).toBeNull();
  });
});

describe('parseAccountInfo', () => {
  it('parses the canonical account + flags reply', () => {
    expect(parseAccountInfo('account=alice flags=0')).toEqual({
      account: 'alice',
      flags: 0,
    });
  });

  it('parses extended fields (email/secure/enforce/registered)', () => {
    const r = parseAccountInfo(
      'account=bob flags=8 email=bob@example.net secure=on enforce=off registered=2026-01-02',
    );
    expect(r).toEqual({
      account: 'bob',
      flags: 8,
      email: 'bob@example.net',
      secure: true,
      enforce: false,
      registered: '2026-01-02',
    });
  });

  it('tolerates reordering and extra whitespace', () => {
    expect(parseAccountInfo('  flags=2   account=carol  ')).toEqual({
      account: 'carol',
      flags: 2,
    });
  });

  it('coerces on/off/true/false/1/0 to booleans', () => {
    expect(parseAccountInfo('secure=true enforce=0')).toEqual({
      secure: true,
      enforce: false,
    });
  });

  it('returns null when no recognised key=value pair is present', () => {
    expect(parseAccountInfo('You are now identified.')).toBeNull();
    expect(parseAccountInfo('')).toBeNull();
  });

  it('ignores unrecognised keys but keeps known ones', () => {
    expect(parseAccountInfo('account=dave nonsense=x flags=5')).toEqual({
      account: 'dave',
      flags: 5,
    });
  });

  it('rejects partial numbers, duplicate fields, and oversized payloads', () => {
    expect(parseAccountInfo('account=alice flags=8junk')).toBeNull();
    expect(parseAccountInfo('account=alice account=bob flags=8')).toBeNull();
    expect(parseAccountInfo(`account=alice email=${'x'.repeat(321)}`)).toBeNull();
    expect(parseAccountInfo('account=alice flags=4294967296')).toBeNull();
    expect(parseAccountInfo(`account=alice ${'x'.repeat(MAX_ACCOUNT_INFO_TEXT_LENGTH)}`)).toBeNull();
  });
});
