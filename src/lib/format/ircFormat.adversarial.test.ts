// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { hasIrcFormatting, parseIrcRuns, type IrcStyle } from './ircFormat';

const B = '\x02';
const C = '\x03';
const H = '\x04';
const O = '\x0f';
const I = '\x1d';
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
    const hostileControls = '\x00\x01\x07\x08\x1b[31m';

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
});
