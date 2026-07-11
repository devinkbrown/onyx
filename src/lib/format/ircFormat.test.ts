// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ircFormat.test.ts — unit tests for the mIRC/IRC control-code parser.
 *
 * Covers: every formatting toggle, colour (decimal + hex) with/without
 * background, resets, two-digit + extended palette indices, the default colour
 * (99), malformed input, and style threading across calls.
 */

import { describe, expect, it } from 'vitest';
import { parseIrcRuns, isDefaultStyle, hasIrcFormatting } from './ircFormat';

// Control bytes as readable constants.
const B = '\x02'; // bold
const C = '\x03'; // colour
const H = '\x04'; // hex colour
const O = '\x0f'; // reset
const M = '\x11'; // monospace
const R = '\x16'; // reverse
const I = '\x1d'; // italic
const S = '\x1e'; // strike
const U = '\x1f'; // underline

describe('hasIrcFormatting', () => {
  it('is false for plain text', () => {
    expect(hasIrcFormatting('hello world')).toBe(false);
  });

  it('detects each control byte', () => {
    for (const ctrl of [B, C, H, O, M, R, I, S, U]) {
      expect(hasIrcFormatting(`a${ctrl}b`)).toBe(true);
    }
  });
});

describe('isDefaultStyle', () => {
  it('is true for an empty style', () => {
    expect(isDefaultStyle({})).toBe(true);
  });

  it('is false when any attribute is set', () => {
    expect(isDefaultStyle({ bold: true })).toBe(false);
    expect(isDefaultStyle({ fg: '#ff0000' })).toBe(false);
    expect(isDefaultStyle({ reverse: true })).toBe(false);
  });
});

describe('parseIrcRuns — plain', () => {
  it('returns a single default run for plain text', () => {
    const { runs } = parseIrcRuns('hello');
    expect(runs).toEqual([{ text: 'hello', style: {} }]);
  });

  it('strips control bytes from the visible text', () => {
    const { runs } = parseIrcRuns(`${B}hi${B}`);
    expect(runs.map((r) => r.text).join('')).toBe('hi');
  });
});

describe('parseIrcRuns — toggles', () => {
  it('bold toggles on then off', () => {
    const { runs, out } = parseIrcRuns(`${B}bold${B}plain`);
    expect(runs).toEqual([
      { text: 'bold', style: { bold: true } },
      { text: 'plain', style: { bold: false } },
    ]);
    expect(out.bold).toBe(false);
  });

  it('handles italic, underline, strike, monospace, reverse', () => {
    expect(parseIrcRuns(`${I}x`).runs[0]!.style.italic).toBe(true);
    expect(parseIrcRuns(`${U}x`).runs[0]!.style.underline).toBe(true);
    expect(parseIrcRuns(`${S}x`).runs[0]!.style.strike).toBe(true);
    expect(parseIrcRuns(`${M}x`).runs[0]!.style.monospace).toBe(true);
    expect(parseIrcRuns(`${R}x`).runs[0]!.style.reverse).toBe(true);
  });

  it('reset clears every attribute', () => {
    const { runs } = parseIrcRuns(`${B}${I}both${O}clean`);
    const last = runs[runs.length - 1]!;
    expect(last.text).toBe('clean');
    expect(isDefaultStyle(last.style)).toBe(true);
  });
});

describe('parseIrcRuns — colour', () => {
  it('resolves a single-digit foreground from the palette', () => {
    const { runs } = parseIrcRuns(`${C}4red`);
    expect(runs).toEqual([{ text: 'red', style: { fg: '#ff0000' } }]);
  });

  it('resolves foreground and background', () => {
    const { runs } = parseIrcRuns(`${C}4,2text`);
    expect(runs[0]!.style.fg).toBe('#ff0000'); // 4 = red
    expect(runs[0]!.style.bg).toBe('#00007f'); // 2 = blue
    expect(runs[0]!.text).toBe('text');
  });

  it('reads a two-digit index greedily', () => {
    const { runs } = parseIrcRuns(`${C}12blue`);
    expect(runs[0]!.style.fg).toBe('#0000fc'); // 12, not 1
    expect(runs[0]!.text).toBe('blue');
  });

  it('supports the extended palette (16-98)', () => {
    expect(parseIrcRuns(`${C}52x`).runs[0]!.style.fg).toBe('#ff0000');
    expect(parseIrcRuns(`${C}88x`).runs[0]!.style.fg).toBe('#000000');
  });

  it('treats colour 99 as the default (no colour)', () => {
    const { runs } = parseIrcRuns(`${C}99x`);
    expect(runs[0]!.style.fg).toBeUndefined();
    expect(runs[0]!.text).toBe('x');
  });

  it('a bare colour code clears the active colour', () => {
    const { runs } = parseIrcRuns(`${C}4red${C}plain`);
    expect(runs[0]!.style.fg).toBe('#ff0000');
    expect(runs[1]!.style.fg).toBeUndefined();
    expect(runs[1]!.text).toBe('plain');
  });

  it('a lone colour control at end of input clears colour and emits no empty run', () => {
    const { runs, out } = parseIrcRuns(C, { fg: '#ff0000', bg: '#000000' });

    expect(runs).toEqual([]);
    expect(out.fg).toBeUndefined();
    expect(out.bg).toBeUndefined();
  });

  it('keeps other attributes when colour resets', () => {
    const { runs } = parseIrcRuns(`${B}${C}4x${C}y`);
    expect(runs[runs.length - 1]!.style.bold).toBe(true);
    expect(runs[runs.length - 1]!.style.fg).toBeUndefined();
  });

  it('parses one-digit foreground/background when the next byte is not a digit', () => {
    // Arrange
    const input = `${C}4,2!`;

    // Act
    const { runs } = parseIrcRuns(input);

    // Assert
    expect(runs).toEqual([{ text: '!', style: { fg: '#ff0000', bg: '#00007f' } }]);
  });

  it('keeps an unterminated comma literal when no background digit follows', () => {
    // Arrange
    const input = `${C}04,${B}bold`;

    // Act
    const { runs, out } = parseIrcRuns(input);

    // Assert
    expect(runs).toEqual([
      { text: ',', style: { fg: '#ff0000' } },
      { text: 'bold', style: { fg: '#ff0000', bold: true } },
    ]);
    expect(out).toEqual({ fg: '#ff0000', bold: true });
  });

  it('clears only colours for a bare colour control while preserving toggles', () => {
    // Arrange
    const input = `${B}${I}${U}${C}4,2hot${C}plain`;

    // Act
    const { runs, out } = parseIrcRuns(input);

    // Assert
    expect(runs).toEqual([
      { text: 'hot', style: { bold: true, italic: true, underline: true, fg: '#ff0000', bg: '#00007f' } },
      { text: 'plain', style: { bold: true, italic: true, underline: true, fg: undefined, bg: undefined } },
    ]);
    expect(out).toEqual({ bold: true, italic: true, underline: true, fg: undefined, bg: undefined });
  });
});

describe('parseIrcRuns — hex colour', () => {
  it('resolves a 6-digit hex foreground', () => {
    const { runs } = parseIrcRuns(`${H}ff8800warm`);
    expect(runs).toEqual([{ text: 'warm', style: { fg: '#ff8800' } }]);
  });

  it('resolves hex foreground and background', () => {
    const { runs } = parseIrcRuns(`${H}ffffff,000000x`);
    expect(runs[0]!.style.fg).toBe('#ffffff');
    expect(runs[0]!.style.bg).toBe('#000000');
  });

  it('clears colour when the hex is malformed', () => {
    const { runs } = parseIrcRuns(`${C}4red${H}zzonly`);
    // ^D not followed by 6 hex digits → colour cleared, the 'zz' stays literal
    const last = runs[runs.length - 1]!;
    expect(last.style.fg).toBeUndefined();
    expect(last.text).toContain('only');
  });
});

describe('parseIrcRuns — threading', () => {
  it('carries the incoming style', () => {
    const { runs } = parseIrcRuns('still red', { fg: '#ff0000' });
    expect(runs[0]!.style.fg).toBe('#ff0000');
  });

  it('returns the trailing style for the next line', () => {
    const { out } = parseIrcRuns(`${C}4open`);
    expect(out.fg).toBe('#ff0000');
  });
});
