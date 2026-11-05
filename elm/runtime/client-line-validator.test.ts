import { describe, expect, it } from 'vitest';
import { validateClientLine } from './client-line-validator';

const result = (line: string) => validateClientLine(line);
const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;

describe('client outbound IRC line validation', () => {
  it('accepts source-supported custom commands, prefixes, repeated spaces and trailing parameters', () => {
    expect(result('  :fixture.test   CUSTOM123 a b :tail with spaces')).toMatchObject({ valid: true });
    expect(result('PRIVMSG #room :')).toMatchObject({ valid: true });
    expect(result('PRIVMSG #room :\u0001ACTION waves\u0001')).toMatchObject({ valid: true });
  });

  it('accepts Onyx and IRCv3 plus-prefixed tags and rejects keys outside server grammar', () => {
    expect(result('@+onyx/e2ee=mls;+draft/reply=abc PRIVMSG #room :hello')).toMatchObject({ valid: true });
    expect(result('@bad_key=value PING')).toEqual({ valid: false, reason: 'invalid-tags' });
  });

  it('enforces UTF-8 line byte boundaries and valid astral code points', () => {
    const prefix = 'PRIVMSG #room :';
    const remaining = 8191 - utf8Length(prefix);
    const astrals = Math.floor(remaining / 4);
    const ascii = 'x'.repeat(remaining % 4);
    const exact = `${prefix}${'😀'.repeat(astrals)}${ascii}`;
    expect(utf8Length(exact)).toBe(8191);
    expect(result(exact)).toEqual({ valid: true, byteLength: 8191 });
    expect(result(`${exact}x`)).toEqual({ valid: false, reason: 'line-too-long' });
  });

  it.each(['\ud800', '\udc00', `ascii\udc00`])('rejects malformed UTF-16 code units without replacement encoding', suffix => {
    expect(result(`PRIVMSG #room :${suffix}`)).toEqual({ valid: false, reason: 'invalid-unicode' });
  });

  it('rejects NUL and embedded line breaks before the encoded line can change meaning', () => {
    for (const value of ['\u0000', '\r', '\n', '\r\n']) {
      expect(result(`PRIVMSG #room :body${value}PING`)).toEqual({ valid: false, reason: 'line-control' });
    }
    expect(result('')).toEqual({ valid: false, reason: 'empty-line' });
  });

  it('allows exactly fifteen IRC parameters, counting an empty trailing field once', () => {
    expect(result(`CMD ${Array.from({ length: 15 }, (_, index) => `p${index}`).join(' ')}`)).toMatchObject({ valid: true });
    expect(result(`CMD ${Array.from({ length: 16 }, (_, index) => `p${index}`).join(' ')}`)).toEqual({ valid: false, reason: 'too-many-parameters' });
    expect(result('CMD a b :')).toMatchObject({ valid: true });
  });

  it('enforces raw tag segment, tag count and key byte limits', () => {
    const exactSegment = `@k=${'v'.repeat(4092)} PING`;
    expect(utf8Length(exactSegment.slice(1, exactSegment.indexOf(' ')))).toBe(4094);
    expect(result(exactSegment)).toMatchObject({ valid: true });
    expect(result(`@k=${'v'.repeat(4093)} PING`)).toEqual({ valid: false, reason: 'invalid-tags' });

    expect(result(`@${Array.from({ length: 32 }, (_, index) => `k${index}=v`).join(';')} PING`)).toMatchObject({ valid: true });
    expect(result(`@${Array.from({ length: 33 }, (_, index) => `k${index}=v`).join(';')} PING`)).toEqual({ valid: false, reason: 'invalid-tags' });
    expect(result(`@${'a'.repeat(96)}=v PING`)).toMatchObject({ valid: true });
    expect(result(`@${'a'.repeat(97)}=v PING`)).toEqual({ valid: false, reason: 'invalid-tags' });
  });

  it('rejects empty tags and malformed command or parameter tokens', () => {
    for (const line of ['@ PING', '@a=x;;b=y PING', ': PING', 'BAD\tCMD', 'PING middle\tfield']) {
      expect(result(line).valid).toBe(false);
    }
  });
});
