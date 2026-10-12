// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatIRCLine, parseIRCMessage } from './parser';

describe('parseIRCMessage wire framing contract', () => {
  it('parses a prefixed PRIVMSG with middle and trailing params', () => {
    const msg = parseIRCMessage(':nick!user@host PRIVMSG #chan :hello world');

    expect(msg.tags).toEqual({});
    expect(msg.prefix).toBe('nick!user@host');
    expect(msg.nick).toBe('nick');
    expect(msg.host).toBe('host');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.params).toEqual(['#chan', 'hello world']);
    expect(msg.raw).toBe(':nick!user@host PRIVMSG #chan :hello world');
  });

  it('parses IRCv3 tags before an unprefixed command', () => {
    const msg = parseIRCMessage('@id=123;key=val;empty=;bare CMD a b');

    expect(msg.tags).toEqual({
      id: '123',
      key: 'val',
      empty: '',
      bare: '',
    });
    expect(msg.prefix).toBeNull();
    expect(msg.command).toBe('CMD');
    expect(msg.params).toEqual(['a', 'b']);
  });

  it('unescapes all IRCv3 message-tag escape forms', () => {
    const msg = parseIRCMessage('@semi=\\:;space=\\s;slash=\\\\;cr=\\r;lf=\\n CMD');

    expect(msg.tags.semi).toBe(';');
    expect(msg.tags.space).toBe(' ');
    expect(msg.tags.slash).toBe('\\');
    expect(msg.tags.cr).toBe('\r');
    expect(msg.tags.lf).toBe('\n');
    expect(msg.command).toBe('CMD');
  });

  it('handles lines with no prefix and no params', () => {
    const msg = parseIRCMessage('PING');

    expect(msg.tags).toEqual({});
    expect(msg.prefix).toBeNull();
    expect(msg.command).toBe('PING');
    expect(msg.params).toEqual([]);
  });

  it('keeps multiple middle params before a trailing param', () => {
    const msg = parseIRCMessage('COMMAND alpha beta gamma :tail with spaces');

    expect(msg.command).toBe('COMMAND');
    expect(msg.params).toEqual(['alpha', 'beta', 'gamma', 'tail with spaces']);
  });

  it('keeps spaces and colons inside the trailing param', () => {
    const msg = parseIRCMessage('PRIVMSG #chan ::starts with :colon and spaces');

    expect(msg.command).toBe('PRIVMSG');
    expect(msg.params).toEqual(['#chan', ':starts with :colon and spaces']);
  });

  it('strips trailing CRLF from a complete wire line', () => {
    const msg = parseIRCMessage(':srv NOTICE nick :ready\r\n');

    expect(msg.raw).toBe(':srv NOTICE nick :ready');
    expect(msg.prefix).toBe('srv');
    expect(msg.command).toBe('NOTICE');
    expect(msg.params).toEqual(['nick', 'ready']);
  });

  it('tolerates frames without CRLF and a lone LF frame terminator', () => {
    const withoutCrlf = parseIRCMessage(':srv PING token');
    const withLf = parseIRCMessage(':srv PING token\n');

    expect(withoutCrlf.raw).toBe(':srv PING token');
    expect(withoutCrlf.params).toEqual(['token']);
    expect(withLf.raw).toBe(':srv PING token');
    expect(withLf.params).toEqual(['token']);
  });

  it('handles empty and whitespace-only lines without throwing', () => {
    expect(() => parseIRCMessage('')).not.toThrow();
    expect(() => parseIRCMessage('   ')).not.toThrow();

    expect(parseIRCMessage('').command).toBe('');
    expect(parseIRCMessage('\n').command).toBe('');
  });
});

describe('formatIRCLine wire builder contract', () => {
  it('formats a command with middle params and a trailing param', () => {
    expect(formatIRCLine('PRIVMSG', '#chan', 'hello world')).toBe('PRIVMSG #chan :hello world\r\n');
  });

  it('formats an empty trailing param and a trailing param that starts with a colon', () => {
    expect(formatIRCLine('PART', '#chan', '')).toBe('PART #chan :\r\n');
    expect(formatIRCLine('PRIVMSG', '#chan', ':literal')).toBe('PRIVMSG #chan ::literal\r\n');
  });
});
