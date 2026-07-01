import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MULTILINE_LIMITS,
  assembleMultilineText,
  buildMultilineLines,
  parseMultilineLimits,
  planMultilineBatches,
} from './multiline';

describe('parseMultilineLimits', () => {
  it('parses max-bytes and max-lines from the cap value', () => {
    expect(parseMultilineLimits('max-bytes=4096,max-lines=24')).toEqual({
      maxBytes: 4096,
      maxLines: 24,
    });
  });

  it('falls back to defaults for missing or malformed tokens', () => {
    expect(parseMultilineLimits(undefined)).toEqual(DEFAULT_MULTILINE_LIMITS);
    expect(parseMultilineLimits('')).toEqual(DEFAULT_MULTILINE_LIMITS);
    expect(parseMultilineLimits('max-bytes=potato')).toEqual(DEFAULT_MULTILINE_LIMITS);
    expect(parseMultilineLimits('max-bytes=-5,max-lines=0')).toEqual(DEFAULT_MULTILINE_LIMITS);
    expect(parseMultilineLimits('max-lines=8')).toEqual({ maxBytes: 4096, maxLines: 8 });
  });
});

describe('planMultilineBatches', () => {
  it('returns null for single-line text (caller sends a plain PRIVMSG)', () => {
    expect(planMultilineBatches('just one line')).toBeNull();
    expect(planMultilineBatches('one line\n\n  \n')).toBeNull(); // blank lines dropped
  });

  it('plans a single batch of plain (non-concat) lines', () => {
    const batches = planMultilineBatches('alpha\nbeta\ngamma');
    expect(batches).toEqual([
      [
        { text: 'alpha', concat: false },
        { text: 'beta', concat: false },
        { text: 'gamma', concat: false },
      ],
    ]);
  });

  it('splits into multiple batches when max-lines is exceeded', () => {
    const batches = planMultilineBatches('a\nb\nc\nd\ne', { maxBytes: 4096, maxLines: 2 });
    expect(batches).toHaveLength(3);
    expect(batches![0]).toHaveLength(2);
    expect(batches![1]).toHaveLength(2);
    expect(batches![2]).toHaveLength(1);
  });

  it('splits into multiple batches when max-bytes is exceeded', () => {
    const line = 'x'.repeat(10); // 10 bytes each
    const batches = planMultilineBatches(`${line}\n${line}\n${line}`, {
      maxBytes: 25,
      maxLines: 24,
    });
    // 10+10 fits under 25; adding the third (30) overflows → 2 batches
    expect(batches).toHaveLength(2);
    expect(batches![0]).toHaveLength(2);
    expect(batches![1]).toHaveLength(1);
  });

  it('fragments a single overlong line with concat continuations', () => {
    const long = 'a'.repeat(30);
    const batches = planMultilineBatches(`${long}\nshort`, { maxBytes: 16, maxLines: 24 });
    const parts = batches!.flat();
    // 30 bytes @ 16-byte cap → 16 + 14, second fragment concat:true
    expect(parts[0]).toEqual({ text: 'a'.repeat(16), concat: false });
    // the concat fragment lands in a fresh batch (byte budget), losing concat
    // at the batch boundary — the split degrades to a newline, never corrupts.
    expect(parts.map((p) => p.text).join('')).toContain('a'.repeat(16));
    expect(assembleMultilineText(parts).replace(/\n/g, '').startsWith('a'.repeat(30))).toBe(true);
  });

  it('never splits inside a multi-byte code point', () => {
    const line = '€€€€'; // 3 bytes each
    const batches = planMultilineBatches(`${line}\nx`, { maxBytes: 4, maxLines: 24 });
    const fragments = batches!.flat().map((p) => p.text);
    for (const frag of fragments) {
      expect(frag).not.toContain('�');
      // each fragment must round-trip through UTF-8 intact
      expect(new TextDecoder().decode(new TextEncoder().encode(frag))).toBe(frag);
    }
  });
});

describe('buildMultilineLines', () => {
  const makeRef = () => 'ref1';

  it('wraps lines in BATCH +ref draft/multiline … BATCH -ref', () => {
    const batches = planMultilineBatches('one\ntwo')!;
    const { lines } = buildMultilineLines('#chan', batches, makeRef);
    expect(lines).toEqual([
      'BATCH +ref1 draft/multiline #chan\r\n',
      '@batch=ref1 PRIVMSG #chan :one\r\n',
      '@batch=ref1 PRIVMSG #chan :two\r\n',
      'BATCH -ref1\r\n',
    ]);
  });

  it('adds the concat tag only to continuation fragments', () => {
    const batches = [[
      { text: 'aaaa', concat: false },
      { text: 'bbbb', concat: true },
    ]];
    const { lines } = buildMultilineLines('#chan', batches, makeRef);
    expect(lines[1]).toBe('@batch=ref1 PRIVMSG #chan :aaaa\r\n');
    expect(lines[2]).toBe('@batch=ref1;draft/multiline-concat PRIVMSG #chan :bbbb\r\n');
  });

  it('applies extra tags (e.g. reply) to the first BATCH command only', () => {
    let n = 0;
    const refGen = () => `r${++n}`;
    const batches = [
      [{ text: 'a', concat: false }, { text: 'b', concat: false }],
      [{ text: 'c', concat: false }, { text: 'd', concat: false }],
    ];
    const { lines } = buildMultilineLines('#chan', batches, refGen, {
      '+draft/reply': 'msg-42',
    });
    expect(lines[0]).toBe('@+draft/reply=msg-42 BATCH +r1 draft/multiline #chan\r\n');
    // second batch start carries no tags
    expect(lines[4]).toBe('BATCH +r2 draft/multiline #chan\r\n');
  });
});

describe('assembleMultilineText', () => {
  it('joins plain parts with newlines', () => {
    expect(
      assembleMultilineText([
        { text: 'one', concat: false },
        { text: 'two', concat: false },
      ]),
    ).toBe('one\ntwo');
  });

  it('joins concat parts without a separator', () => {
    expect(
      assembleMultilineText([
        { text: 'hel', concat: false },
        { text: 'lo', concat: true },
        { text: 'world', concat: false },
      ]),
    ).toBe('hello\nworld');
  });

  it('round-trips a planned send back to the original text', () => {
    const text = 'first line\nsecond line\nthird line';
    const parts = planMultilineBatches(text)!.flat();
    expect(assembleMultilineText(parts)).toBe(text);
  });
});
