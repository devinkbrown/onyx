// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { escapeTagValue, parseIRCMessage, splitWireFrame } from './parser';

/**
 * Pure framing + tag-escape robustness contract. No live socket: these pin the
 * load-bearing wire rules that once regressed into the CAP-LS registration hang
 * and the `\\s` tag mis-decode, so a future refactor can never silently
 * reintroduce either without failing here.
 */
describe('splitWireFrame — stateless, remainder-free frame splitting', () => {
  it('returns a single line for a CRLF-less frame (the Orochi CAP LS shape)', () => {
    // Orochi emits ":eshmaki.me CAP * LS :..." with NO trailing CRLF. The old
    // stateful `buffer = lines.pop()` stashed exactly this line forever, so CAP
    // was never handled and registration hung. It must surface immediately.
    const frame = ':eshmaki.me CAP * LS :sasl=PLAIN,SCRAM-SHA-256 multi-prefix';
    expect(splitWireFrame(frame)).toEqual([frame]);
  });

  it('splits a frame that legitimately batches several CRLF-separated lines', () => {
    const frame = ':srv 001 me :welcome\r\n:srv 002 me :host\r\n:srv 003 me :created';
    expect(splitWireFrame(frame)).toEqual([
      ':srv 001 me :welcome',
      ':srv 002 me :host',
      ':srv 003 me :created',
    ]);
  });

  it('tolerates lone-LF separators and a trailing terminator without emitting an empty tail', () => {
    expect(splitWireFrame(':srv PING a\n:srv PING b\n')).toEqual([
      ':srv PING a',
      ':srv PING b',
    ]);
  });

  it('drops blank segments from doubled or leading terminators', () => {
    expect(splitWireFrame('\r\n:srv PONG a\n\n:srv PONG b\r\n')).toEqual([
      ':srv PONG a',
      ':srv PONG b',
    ]);
  });

  it('returns an empty array for empty / whitespace-terminator-only frames', () => {
    expect(splitWireFrame('')).toEqual([]);
    expect(splitWireFrame('\r\n')).toEqual([]);
    expect(splitWireFrame('\n\n')).toEqual([]);
  });

  it('is a pure function: repeated calls retain no cross-frame remainder', () => {
    // Two frames arriving back-to-back, the first CRLF-less. A remainder-stashing
    // implementation would swallow the first line on frame 1 and mis-prepend it
    // to frame 2. A pure split yields each frame's line independently.
    const first = splitWireFrame(':srv CAP * LS :sasl');
    const second = splitWireFrame(':srv NOTICE me :hi');
    expect(first).toEqual([':srv CAP * LS :sasl']);
    expect(second).toEqual([':srv NOTICE me :hi']);
  });

  it('each split line parses cleanly with a truncation-free raw', () => {
    const lines = splitWireFrame(':srv CAP * LS :sasl=PLAIN\r\n:srv 001 me :hi');
    const parsed = lines.map(parseIRCMessage);
    expect(parsed[0]!.command).toBe('CAP');
    expect(parsed[0]!.params).toEqual(['*', 'LS', 'sasl=PLAIN']);
    expect(parsed[1]!.command).toBe('001');
    expect(parsed[1]!.raw).toBe(':srv 001 me :hi');
  });
});

describe('IRCv3 tag-value escape round-trip', () => {
  const B = '\\';

  it('round-trips every escape form through escape -> parse -> tags', () => {
    const cases: Array<[string, string]> = [
      ['semi', 'a;b'],
      ['space', 'a b'],
      ['slash', `a${B}b`],
      ['crlf', 'a\r\nb'],
      ['plain', 'plain-token'],
    ];
    const line = '@' + cases.map(([k, v]) => `${k}=${escapeTagValue(v)}`).join(';') + ' CMD';
    const tags = parseIRCMessage(line).tags;
    for (const [k, v] of cases) expect(tags[k]).toBe(v);
  });

  it('disambiguates escaped-backslash + literal s from an escaped space', () => {
    // The wire value `\\s` is an escaped backslash followed by a literal `s`,
    // i.e. it must decode to `\s` (backslash, s) — NOT to `\` + space. This is
    // the exact case a naive sequential-replace decoder gets wrong.
    const backslashThenS = `${B}s`;
    const escaped = escapeTagValue(backslashThenS); // -> "\\s" on the wire
    expect(escaped).toBe(`${B}${B}s`);
    const tags = parseIRCMessage(`@k=${escaped} CMD`).tags;
    expect(tags.k).toBe(backslashThenS);
    expect(tags.k).not.toBe(' ');
  });

  it('drops a lone trailing backslash and passes an unknown escape verbatim', () => {
    // Directly hostile wire values the escaper would never produce, but a server
    // can send: a dangling `\` is dropped; `\x` yields a literal `x`.
    expect(parseIRCMessage('@k=abc\\ CMD').tags.k).toBe('abc');
    expect(parseIRCMessage('@k=a\\xb CMD').tags.k).toBe('axb');
  });
});
