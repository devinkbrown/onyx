import { describe, it, expect } from 'vitest';
import {
  parseIRCMessage,
  escapeTagValue,
  formatIRCLine,
  parseNamesPrefix,
  parsePREFIX,
  parseCHANLIMIT,
  normalizeCase,
  selectSaslMechanism,
  parseStandardReply,
  parseSessionTokenNote,
  parseSessionMeshTokenNote,
  buildSessionResumeLine,
  parseMonitorNumeric,
  parseAccountInfo,
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
  it('extracts a SESSION TOKEN', () => {
    expect(parseSessionTokenNote(parseIRCMessage(':srv NOTE SESSION TOKEN :abc123'))).toBe('abc123');
  });
  it('extracts a SESSION MTOKEN (mesh)', () => {
    expect(parseSessionMeshTokenNote(parseIRCMessage(':srv NOTE SESSION MTOKEN :m3sh'))).toBe('m3sh');
  });
  it('does not confuse TOKEN and MTOKEN', () => {
    expect(parseSessionMeshTokenNote(parseIRCMessage(':srv NOTE SESSION TOKEN :abc'))).toBeNull();
  });
  it('builds a resume line', () => {
    expect(buildSessionResumeLine('tok')).toBe('SESSION RESUME tok\r\n');
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
});
