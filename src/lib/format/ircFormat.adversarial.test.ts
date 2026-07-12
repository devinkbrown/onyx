// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { hasIrcFormatting, parseIrcRuns, type IrcStyle } from './ircFormat';

const B = '\x02';
const C = '\x03';
const H = '\x04';
const O = '\x0f';
const M = '\x11';
const R = '\x16';
const I = '\x1d';
const S = '\x1e';
const U = '\x1f';

function styleValues(styles: readonly IrcStyle[]): string[] {
  return styles.flatMap((style) => Object.values(style).filter((value): value is string => typeof value === 'string'));
}

describe('parseIrcRuns adversarial mIRC formatting', () => {
  it('threads deeply nested toggles and colour changes without collapsing independent state', () => {
    const { runs, out } = parseIrcRuns(
      `${B}bold ${C}04red ${I}red italic ${C}06,01purple on black${I} purple${C}${B}plain`,
    );

    expect(runs.map((run) => run.text)).toEqual([
      'bold ',
      'red ',
      'red italic ',
      'purple on black',
      ' purple',
      'plain',
    ]);
    expect(runs[0]!.style).toEqual({ bold: true });
    expect(runs[1]!.style).toEqual({ bold: true, fg: '#ff0000' });
    expect(runs[2]!.style).toEqual({ bold: true, fg: '#ff0000', italic: true });
    expect(runs[3]!.style).toEqual({ bold: true, fg: '#9c009c', italic: true, bg: '#000000' });
    expect(runs[4]!.style).toEqual({ bold: true, fg: '#9c009c', italic: false, bg: '#000000' });
    expect(runs[5]!.style).toEqual({ bold: false, fg: undefined, italic: false, bg: undefined });
    expect(out).toEqual({ bold: false, fg: undefined, italic: false, bg: undefined });
  });

  it('emits no empty runs for adjacent controls while retaining the trailing style', () => {
    const { runs, out } = parseIrcRuns(`${B}${I}${U}${C}12,08`);

    expect(runs).toEqual([]);
    expect(out).toEqual({ bold: true, italic: true, underline: true, fg: '#0000fc', bg: '#ffff00' });
  });

  it('carries unterminated nested formatting state to EOF', () => {
    const { runs, out } = parseIrcRuns(`${B}bold ${I}italic ${U}under ${S}strike ${M}mono ${R}reverse`);

    expect(runs).toEqual([
      { text: 'bold ', style: { bold: true } },
      { text: 'italic ', style: { bold: true, italic: true } },
      { text: 'under ', style: { bold: true, italic: true, underline: true } },
      { text: 'strike ', style: { bold: true, italic: true, underline: true, strike: true } },
      { text: 'mono ', style: { bold: true, italic: true, underline: true, strike: true, monospace: true } },
      {
        text: 'reverse',
        style: { bold: true, italic: true, underline: true, strike: true, monospace: true, reverse: true },
      },
    ]);
    expect(out).toEqual({ bold: true, italic: true, underline: true, strike: true, monospace: true, reverse: true });
  });

  it('limits decimal colour fields to two digits and leaves overflow as inert text', () => {
    const { runs, out } = parseIrcRuns(`${C}123${C}04,567`);

    expect(runs).toEqual([
      { text: '3', style: { fg: '#0000fc' } },
      { text: '7', style: { fg: '#ff0000', bg: '#00ff00' } },
    ]);
    expect(out).toEqual({ fg: '#ff0000', bg: '#00ff00' });
  });

  it('keeps unterminated decimal background separators as visible text under the foreground style', () => {
    const { runs, out } = parseIrcRuns(`${C}04,`);

    expect(runs).toEqual([{ text: ',', style: { fg: '#ff0000' } }]);
    expect(out).toEqual({ fg: '#ff0000' });
  });

  it('consumes truncated hex foreground digits, clears colours, and does not fabricate text runs', () => {
    const { runs, out } = parseIrcRuns(`${H}12`, { fg: '#ff0000', bg: '#000000', bold: true });

    expect(runs).toEqual([]);
    expect(out).toEqual({ fg: undefined, bg: undefined, bold: true });
  });

  it('leaves an incomplete hex background literal while applying the validated foreground only', () => {
    const { runs, out } = parseIrcRuns(`${H}AaBbCc,12gg`);

    expect(runs).toEqual([{ text: ',12gg', style: { fg: '#aabbcc' } }]);
    expect(out).toEqual({ fg: '#aabbcc' });
  });

  it('preserves hostile non-format C0 bytes as inert text and does not count them as IRC formatting', () => {
    const hostileControls = '\x00\x01\x05\x06\x07\x08\x0e\x1b[31m\x7f';

    expect(hasIrcFormatting(hostileControls)).toBe(false);
    expect(parseIrcRuns(`a${hostileControls}${B}b${hostileControls}${B}c`).runs).toEqual([
      { text: `a${hostileControls}`, style: {} },
      { text: `b${hostileControls}`, style: { bold: true } },
      { text: 'c', style: { bold: false } },
    ]);
  });

  it('keeps hostile markup and CSS-looking payloads in text while styles remain fixed palette values', () => {
    const hostile = '<img src=x onerror=alert(1)>javascript:alert(1)';
    const { runs } = parseIrcRuns(`${C}04,02${hostile}${H}zz<style>body{background:url(javascript:1)}</style>${O}done`);
    const styles = runs.map((run) => run.style);

    expect(runs).toEqual([
      { text: hostile, style: { fg: '#ff0000', bg: '#00007f' } },
      {
        text: 'zz<style>body{background:url(javascript:1)}</style>',
        style: { fg: undefined, bg: undefined },
      },
      { text: 'done', style: {} },
    ]);
    expect(styleValues(styles).every((value) => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    expect(styleValues(styles).join(' ')).not.toContain('javascript');
    expect(styleValues(styles).join(' ')).not.toContain('onerror');
  });

  it('keeps CSS-looking colour injection attempts in text after the validated hex foreground', () => {
    const payload = ';background-image:url(javascript:alert(1));color:red';
    const { runs, out } = parseIrcRuns(`${H}fF00Aa${payload}`);
    const styleText = styleValues(runs.map((run) => run.style)).join(' ');

    expect(runs).toEqual([{ text: payload, style: { fg: '#ff00aa' } }]);
    expect(out).toEqual({ fg: '#ff00aa' });
    expect(styleText).toBe('#ff00aa');
    expect(styleText).not.toContain('javascript');
    expect(styleText).not.toContain('background-image');
  });

  it('keeps malformed decimal colour tails as text after clearing incoming colours', () => {
    const { runs, out } = parseIrcRuns(`${C},12${C}04,tail`, { fg: '#ff0000', bg: '#000000' });

    expect(runs).toEqual([
      { text: ',12', style: { fg: undefined, bg: undefined } },
      { text: ',tail', style: { fg: '#ff0000', bg: undefined } },
    ]);
    expect(out).toEqual({ fg: '#ff0000', bg: undefined });
  });

  it('does not let truncated hex digits or hostile markup become style values', () => {
    const hostile = '</span><img src=x onerror=alert(1)>';
    const { runs, out } = parseIrcRuns(`${B}${H}fff${hostile}`);
    const styles = runs.map((run) => run.style);

    expect(runs).toEqual([
      {
        text: hostile,
        style: { bold: true, fg: undefined, bg: undefined },
      },
    ]);
    expect(out).toEqual({ bold: true, fg: undefined, bg: undefined });
    expect(styleValues(styles)).toEqual([]);
    expect(JSON.stringify(styles)).not.toContain('onerror');
    expect(JSON.stringify(styles)).not.toContain('<img');
  });
});
