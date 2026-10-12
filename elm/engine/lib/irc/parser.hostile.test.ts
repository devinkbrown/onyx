// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  formatIRCLine,
  MAX_IRCV3_MESSAGE_TAGS,
  MAX_IRCV3_TAG_KEY_LENGTH,
  MAX_IRCV3_TAG_VALUE_LENGTH,
  parseIRCMessage,
} from './parser';

const bodyWithoutTerminator = (line: string): string => line.slice(0, -2);

describe('formatIRCLine hostile input sanitising', () => {
  it('strips CR, LF, and NUL from command, middle params, and trailing params', () => {
    const line = formatIRCLine(
      'PRIV\rMSG\n\x00',
      '#chan\r\nJOIN#evil',
      'hi\x00\r\nQUIT :pwnd',
    );

    expect(line).toBe('PRIVMSG #chanJOIN#evil :hiQUIT :pwnd\r\n');
    expect(bodyWithoutTerminator(line)).not.toMatch(/[\r\n\x00]/);
    expect(line.match(/\r\n/g)).toEqual(['\r\n']);
  });

  it('decides whether to colon-prefix the trailing param after stripping injection bytes', () => {
    expect(formatIRCLine('NOTICE', 'nick', 'hello\r\n world')).toBe(
      'NOTICE nick :hello world\r\n',
    );
    expect(formatIRCLine('CMD', 'abc\r\n:def')).toBe('CMD abc:def\r\n');
  });

  it('does not emit extra wire terminators for hostile empty-looking fields', () => {
    const line = formatIRCLine('\r\n', '\x00', '\n\r');

    expect(line).toBe('  :\r\n');
    expect(bodyWithoutTerminator(line)).not.toMatch(/[\r\n\x00]/);
    expect(line.match(/\r\n/g)).toEqual(['\r\n']);
  });
});

describe('parseIRCMessage tag parsing with hostile wire values', () => {
  it('parses blank tag segments, bare tags, embedded equals, and escaped control values', () => {
    const msg = parseIRCMessage(
      '@a=1;;bare;empty=;eq=a=b;semi=x\\:y;space=a\\sb;slash=a\\\\b;cr=a\\rb;lf=a\\nb CMD target',
    );

    expect(msg.tags).toEqual({
      a: '1',
      bare: '',
      empty: '',
      eq: 'a=b',
      semi: 'x;y',
      space: 'a b',
      slash: 'a\\b',
      cr: 'a\rb',
      lf: 'a\nb',
    });
    expect(msg.command).toBe('CMD');
    expect(msg.params).toEqual(['target']);
  });

  it('handles a tag-only hostile line without a separating space', () => {
    const msg = parseIRCMessage('@a=1;bare;dangling=abc\\');

    expect(msg.tags).toEqual({
      a: '1',
      bare: '',
      dangling: 'abc',
    });
    expect(msg.command).toBe('');
    expect(msg.params).toEqual([]);
    expect(msg.raw).toBe('@a=1;bare;dangling=abc\\');
  });

  it('keeps current permissive behavior for empty tag keys', () => {
    const msg = parseIRCMessage('@=value;normal=ok CMD');

    expect(msg.tags['']).toBe('value');
    expect(msg.tags.normal).toBe('ok');
    expect(msg.command).toBe('CMD');
  });

  it('records prototype-named tags as own data without mutating prototypes', () => {
    const msg = parseIRCMessage('@__proto__=wire;constructor=remote;normal=ok CMD');

    expect(Object.getPrototypeOf(msg.tags)).toBe(Object.prototype);
    expect(Object.hasOwn(msg.tags, '__proto__')).toBe(true);
    expect(msg.tags.__proto__).toBe('wire');
    expect(msg.tags.constructor).toBe('remote');
    expect(msg.tags.normal).toBe('ok');
    expect(Object.prototype).not.toHaveProperty('wire');
  });

  it('bounds tag count, keys, and values before decoding', () => {
    const many = Array.from(
      { length: MAX_IRCV3_MESSAGE_TAGS + 10 },
      (_, index) => `tag${index}=value`,
    ).join(';');
    const bounded = parseIRCMessage(`@${many} CMD`);
    expect(Object.keys(bounded.tags)).toHaveLength(MAX_IRCV3_MESSAGE_TAGS);
    expect(bounded.tags.tag255).toBe('value');
    expect(bounded.tags.tag256).toBeUndefined();

    const fields = parseIRCMessage(
      `@${'k'.repeat(MAX_IRCV3_TAG_KEY_LENGTH + 1)}=bad;huge=${'x'.repeat(MAX_IRCV3_TAG_VALUE_LENGTH + 1)};normal=ok CMD`,
    );
    expect(fields.tags).toEqual({ normal: 'ok' });
    expect(fields.command).toBe('CMD');
  });
});

describe('parseIRCMessage tag unescaping edge cases', () => {
  const backslash = '\\';

  it('unescapes adjacent backslash and space escapes in a single consuming pass', () => {
    const msg = parseIRCMessage(`@combo=${backslash}${backslash}${backslash}s CMD`);

    expect(msg.tags.combo).toBe('\\ ');
  });

  it('drops a dangling escape and turns unknown escapes into the escaped character', () => {
    const msg = parseIRCMessage(`@unknown=${backslash}x;dangling=abc${backslash} CMD`);

    expect(msg.tags.unknown).toBe('x');
    expect(msg.tags.dangling).toBe('abc');
  });
});
