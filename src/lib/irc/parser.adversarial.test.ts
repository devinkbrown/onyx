// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  formatIRCLine,
  parseIRCMessage,
  parseNamesPrefix,
  parsePREFIX,
} from './parser';

describe('parsePREFIX adversarial ISUPPORT values', () => {
  it('learns Orochi exotic PREFIX=(YQqov)*!.@+ without dropping nonstandard ranks', () => {
    const parsed = parsePREFIX('(YQqov)*!.@+');

    expect(parsed.modeToPrefix).toEqual({
      Y: '*',
      Q: '!',
      q: '.',
      o: '@',
      v: '+',
    });
    expect(parsed.prefixToMode).toEqual({
      '*': 'Y',
      '!': 'Q',
      '.': 'q',
      '@': 'o',
      '+': 'v',
    });
  });

  it('uses the learned exotic prefix map to peel stacked NAMES ranks from the nick', () => {
    const { prefixToMode } = parsePREFIX('(YQqov)*!.@+');
    const parsed = parseNamesPrefix('*!@+root!admin@mesh.example', prefixToMode);

    expect(parsed.nick).toBe('root');
    expect(parsed.modes).toEqual(new Set(['Y', 'Q', 'o', 'v']));
  });

  it('fails closed to empty maps when PREFIX has no explicit prefix characters', () => {
    expect(parsePREFIX('(YQqov)')).toEqual({ modeToPrefix: {}, prefixToMode: {} });
  });

  it('rejects mismatched, duplicate, and nick-like PREFIX maps atomically', () => {
    const malformed = [
      '(ov)@',
      '(o)@@',
      '(oo)@+',
      '(ov)@@',
      '(ov)o+',
      `(${'o'.repeat(33)})${'@'.repeat(33)}`,
    ];

    for (const value of malformed) {
      const parsed = parsePREFIX(value);
      expect(parsed).toEqual({ modeToPrefix: {}, prefixToMode: {} });
      expect(parsed.prefixToMode).not.toHaveProperty('undefined');
    }
  });
});

describe('parseIRCMessage adversarial tag and parameter parsing', () => {
  it('parses escaped tags, prefix, middle params, and a trailing param without CRLF', () => {
    const msg = parseIRCMessage(
      '@time=2026-07-12T10\\:20\\:30Z;label=a\\sb;slash=left\\\\right;crlf=x\\r\\ny ' +
        ':root!u@h PRIVMSG #ops :payload with :colon and spaces',
    );

    expect(msg.tags).toEqual({
      time: '2026-07-12T10;20;30Z',
      label: 'a b',
      slash: 'left\\right',
      crlf: 'x\r\ny',
    });
    expect(msg.nick).toBe('root');
    expect(msg.host).toBe('h');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.params).toEqual(['#ops', 'payload with :colon and spaces']);
    expect(msg.raw.endsWith('\r\n')).toBe(false);
  });

  it('keeps an empty trailing param distinct from an omitted trailing param', () => {
    expect(parseIRCMessage('NOTICE nick :').params).toEqual(['nick', '']);
    expect(parseIRCMessage('NOTICE nick').params).toEqual(['nick']);
  });

  it('tolerates missing CRLF and strips a single LF or CRLF terminator only', () => {
    expect(parseIRCMessage('PING token').raw).toBe('PING token');
    expect(parseIRCMessage('PING token\n').raw).toBe('PING token');
    expect(parseIRCMessage('PING token\r\n').raw).toBe('PING token');
  });

  it('fails safe on malformed or partial wire lines without throwing', () => {
    const cases = [
      '@',
      '@=',
      ':',
      ':onlyprefix',
      '   ',
      '\x00\x00',
      '@bad=abc\\',
    ];

    for (const line of cases) {
      expect(() => parseIRCMessage(line)).not.toThrow();
      const msg = parseIRCMessage(line);
      expect(msg.tags).toBeDefined();
      expect(msg.params).toBeDefined();
      expect(typeof msg.command).toBe('string');
    }
  });
});

describe('formatIRCLine adversarial output contract', () => {
  it('formats trailing params with spaces, leading colon, or empty string as trailing fields', () => {
    expect(formatIRCLine('PRIVMSG', '#ops', 'hello there')).toBe(
      'PRIVMSG #ops :hello there\r\n',
    );
    expect(formatIRCLine('PRIVMSG', '#ops', ':literal')).toBe('PRIVMSG #ops ::literal\r\n');
    expect(formatIRCLine('NOTICE', 'nick', '')).toBe('NOTICE nick :\r\n');
  });

  it('strips injected line separators before deciding whether a trailing colon is needed', () => {
    const line = formatIRCLine('PRIVMSG\r\nOPER', '#ops\nJOIN #bad', 'hello\r\nthere');

    expect(line).toBe('PRIVMSGOPER #opsJOIN #bad hellothere\r\n');
    expect(line.match(/\r\n/g)).toEqual(['\r\n']);
    expect(line.slice(0, -2)).not.toMatch(/[\r\n\x00]/);
  });
});
