import { describe, it, expect } from 'vitest';
import {
  parseIRCMessage,
  formatIRCLine,
  parseNamesPrefix,
  parsePREFIX,
  parseCHANLIMIT,
  parseMonitorNumeric,
  parseStandardReply,
} from '@/lib/irc/parser';

// ─────────────────────────────────────────────────────────────────────────────
// parseIRCMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('parseIRCMessage', () => {
  it('parses a simple PING', () => {
    const msg = parseIRCMessage('PING :lagcheck');
    expect(msg.command).toBe('PING');
    expect(msg.params).toEqual(['lagcheck']);
    expect(msg.nick).toBeNull();
    expect(msg.prefix).toBeNull();
  });

  it('parses a PRIVMSG with full prefix', () => {
    const msg = parseIRCMessage(':devin!devin@eshmaki.me PRIVMSG #root :hello world');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.nick).toBe('devin');
    expect(msg.host).toBe('eshmaki.me');
    expect(msg.params[0]).toBe('#root');
    expect(msg.params[1]).toBe('hello world');
  });

  it('parses a server-originated numeric', () => {
    const msg = parseIRCMessage(':irc.eshmaki.me 001 devin :Welcome to the network');
    expect(msg.command).toBe('001');
    expect(msg.nick).toBeNull();
    expect(msg.host).toBe('irc.eshmaki.me');
    expect(msg.params[1]).toBe('Welcome to the network');
  });

  it('parses IRCv3 message tags', () => {
    const msg = parseIRCMessage('@account=devin;time=2025-01-01T00:00:00Z :devin!d@h PRIVMSG #ch :hi');
    expect(msg.tags['account']).toBe('devin');
    expect(msg.tags['time']).toBe('2025-01-01T00:00:00Z');
    expect(msg.command).toBe('PRIVMSG');
  });

  it('unescapes tag value sequences', () => {
    const msg = parseIRCMessage('@label=a\\:b\\sc :srv CMD');
    expect(msg.tags['label']).toBe('a;b c');
  });

  it('parses value-less tags', () => {
    const msg = parseIRCMessage('@draft/multiline :srv CMD');
    expect(msg.tags['draft/multiline']).toBe('');
  });

  it('handles trailing param starting with ":"', () => {
    const msg = parseIRCMessage(':srv NOTICE * ::MOTD starts here');
    expect(msg.params[1]).toBe(':MOTD starts here');
  });

  it('strips CRLF', () => {
    const msg = parseIRCMessage('PING :hello\r\n');
    expect(msg.params[0]).toBe('hello');
  });

  it('handles a bare nick (no user/host) as the prefix', () => {
    const msg = parseIRCMessage(':devin JOIN #root');
    expect(msg.nick).toBe('devin');
    expect(msg.host).toBeNull();
    expect(msg.command).toBe('JOIN');
  });

  it('handles multi-param commands', () => {
    const msg = parseIRCMessage(':srv MODE #chan +ov user1 user2');
    expect(msg.params).toEqual(['#chan', '+ov', 'user1', 'user2']);
  });

  it('CAP LS with multiline asterisk', () => {
    const msg = parseIRCMessage(':srv CAP * LS * :multi-prefix sasl');
    expect(msg.command).toBe('CAP');
    expect(msg.params[1]).toBe('LS');
    expect(msg.params[2]).toBe('*');
    expect(msg.params[3]).toBe('multi-prefix sasl');
  });

  it('AUTHENTICATE + (no params after command)', () => {
    const msg = parseIRCMessage(':srv AUTHENTICATE +');
    expect(msg.command).toBe('AUTHENTICATE');
    expect(msg.params[0]).toBe('+');
  });

  it('parses NOTE SESSION TOKEN from server', () => {
    const msg = parseIRCMessage(':orochi.local NOTE SESSION TOKEN :abcdef');
    expect(msg.command).toBe('NOTE');
    expect(msg.params).toEqual(['SESSION', 'TOKEN', 'abcdef']);
  });

  it('upper-cases the command', () => {
    const msg = parseIRCMessage(':srv privmsg #ch :hi');
    expect(msg.command).toBe('PRIVMSG');
  });

  it('preserves raw line', () => {
    const raw = ':d!u@h PRIVMSG #c :test';
    expect(parseIRCMessage(raw).raw).toBe(raw);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatIRCLine
// ─────────────────────────────────────────────────────────────────────────────

describe('formatIRCLine', () => {
  it('formats a simple command', () => {
    expect(formatIRCLine('PING', 'lag')).toBe('PING lag\r\n');
  });

  it('adds colon to trailing param with spaces', () => {
    expect(formatIRCLine('PRIVMSG', '#root', 'hello world')).toBe('PRIVMSG #root :hello world\r\n');
  });

  it('adds colon when trailing param starts with :', () => {
    expect(formatIRCLine('NOTE', 'SESSION', 'TOKEN', ':abcdef')).toBe('NOTE SESSION TOKEN ::abcdef\r\n');
  });

  it('does not add colon to a simple trailing param without spaces', () => {
    expect(formatIRCLine('JOIN', '#root')).toBe('JOIN #root\r\n');
  });

  it('adds colon to empty trailing param', () => {
    expect(formatIRCLine('AUTHENTICATE', '')).toBe('AUTHENTICATE :\r\n');
  });

  it('formats CAP REQ correctly', () => {
    expect(formatIRCLine('CAP', 'REQ', 'multi-prefix sasl')).toBe('CAP REQ :multi-prefix sasl\r\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parsePREFIX
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePREFIX', () => {
  it('parses standard Orochi PREFIX', () => {
    const { modeToPrefix, prefixToMode } = parsePREFIX('(qaohv)~&@%+');
    expect(modeToPrefix['q']).toBe('~');
    expect(modeToPrefix['o']).toBe('@');
    expect(modeToPrefix['v']).toBe('+');
    expect(prefixToMode['~']).toBe('q');
    expect(prefixToMode['@']).toBe('o');
  });

  it('parses Orochi PREFIX positionally with founder ! as q tier', () => {
    const { modeToPrefix, prefixToMode } = parsePREFIX('(Qqov)!.@+');
    expect(modeToPrefix).toEqual({ Q: '!', q: '.', o: '@', v: '+' });
    expect(prefixToMode).toEqual({ '!': 'Q', '.': 'q', '@': 'o', '+': 'v' });
  });

  it('returns empty maps for malformed value', () => {
    const { modeToPrefix, prefixToMode } = parsePREFIX('INVALID');
    expect(Object.keys(modeToPrefix)).toHaveLength(0);
    expect(Object.keys(prefixToMode)).toHaveLength(0);
  });

  it('parses minimal (ov)@+', () => {
    const { modeToPrefix } = parsePREFIX('(ov)@+');
    expect(modeToPrefix['o']).toBe('@');
    expect(modeToPrefix['v']).toBe('+');
  });
});

describe('parseCHANLIMIT', () => {
  it('parses Orochi channel limits', () => {
    expect(parseCHANLIMIT('#&:50')).toEqual({ '#': 50, '&': 50 });
  });
});

describe('parseStandardReply', () => {
  it('parses FAIL with context and description', () => {
    const reply = parseStandardReply(parseIRCMessage(':orochi.local FAIL REGISTER ACCOUNT_EXISTS kain :Account already exists'));
    expect(reply).toEqual({
      kind: 'FAIL',
      command: 'REGISTER',
      code: 'ACCOUNT_EXISTS',
      context: ['kain'],
      description: 'Account already exists',
    });
  });

  it('parses WARN', () => {
    const reply = parseStandardReply(parseIRCMessage(':orochi.local WARN CHATHISTORY RATE_LIMITED #root :Slow down'));
    expect(reply?.kind).toBe('WARN');
    expect(reply?.command).toBe('CHATHISTORY');
    expect(reply?.code).toBe('RATE_LIMITED');
  });
});

describe('parseMonitorNumeric', () => {
  it('parses MONITOR online and offline numerics', () => {
    expect(parseMonitorNumeric(parseIRCMessage(':orochi.local 730 me :alice!u@h,bob!u@h'))).toEqual({
      kind: 'online',
      targets: ['alice!u@h', 'bob!u@h'],
    });
    expect(parseMonitorNumeric(parseIRCMessage(':orochi.local 731 me :carol'))).toEqual({
      kind: 'offline',
      targets: ['carol'],
    });
  });

  it('parses MONITOR full limit', () => {
    expect(parseMonitorNumeric(parseIRCMessage(':orochi.local 734 me 128 alice,bob :Monitor list is full'))).toEqual({
      kind: 'full',
      targets: ['alice', 'bob'],
      limit: 128,
      description: 'Monitor list is full',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseNamesPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('parseNamesPrefix', () => {
  const prefixMap: Record<string, string> = { '~': 'q', '@': 'o', '+': 'v' };

  it('extracts owner + operator modes', () => {
    const result = parseNamesPrefix('~@devin', prefixMap);
    expect(result.nick).toBe('devin');
    expect(result.modes.has('q')).toBe(true);
    expect(result.modes.has('o')).toBe(true);
  });

  it('extracts voice mode', () => {
    const result = parseNamesPrefix('+alice', prefixMap);
    expect(result.nick).toBe('alice');
    expect(result.modes.has('v')).toBe(true);
  });

  it('handles nick with no modes', () => {
    const result = parseNamesPrefix('bob', prefixMap);
    expect(result.nick).toBe('bob');
    expect(result.modes.size).toBe(0);
  });

  it('strips userhost suffix from userhost-in-names', () => {
    const result = parseNamesPrefix('@devin!user@host', prefixMap);
    expect(result.nick).toBe('devin');
    expect(result.modes.has('o')).toBe(true);
  });
});
