// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { formatBytes } from './byteSize';
import { countLabel } from './countLabel';
import { formatDuration } from './duration';
import { parseIrcRuns, type IrcRun } from './ircFormat';
import { parseMessage, type InlineToken, type StyledToken, type Token } from './parseMessage';

const BOLD = '\x02';
const COLOR = '\x03';
const RESET = '\x0f';
const REVERSE = '\x16';
const ITALIC = '\x1d';
const UNDERLINE = '\x1f';

function tokenTypes(tokens: readonly Token[]): string[] {
  const types: string[] = [];
  const visit = (token: Token | InlineToken): void => {
    types.push(token.type);
    if ('children' in token) {
      for (const child of token.children) {
        visit(child);
      }
    }
  };

  for (const token of tokens) {
    visit(token);
  }

  return types;
}

function styledTokens(tokens: readonly Token[]): StyledToken[] {
  return tokens.filter((token): token is StyledToken => token.type === 'styled');
}

describe('ircFormat control-code contracts', () => {
  it('emits styled runs for the user-visible mIRC control codes', () => {
    const cases: ReadonlyArray<readonly [string, IrcRun]> = [
      [`${BOLD}x`, { text: 'x', style: { bold: true } }],
      [`${COLOR}4,2x`, { text: 'x', style: { fg: '#ff0000', bg: '#00007f' } }],
      [`${REVERSE}x`, { text: 'x', style: { reverse: true } }],
      [`${UNDERLINE}x`, { text: 'x', style: { underline: true } }],
      [`${ITALIC}x`, { text: 'x', style: { italic: true } }],
    ];

    for (const [input, expectedRun] of cases) {
      expect(parseIrcRuns(input).runs).toEqual([expectedRun]);
    }
  });

  it('handles malformed and default color codes without leaking unsafe colors', () => {
    const bare = parseIrcRuns(`${COLOR}bare`, { bold: true, fg: '#ff0000', bg: '#000000' });
    expect(bare.runs[0]).toMatchObject({ text: 'bare', style: { bold: true } });
    expect(bare.runs[0]!.style.fg).toBeUndefined();
    expect(bare.runs[0]!.style.bg).toBeUndefined();

    const defaultForeground = parseIrcRuns(`${COLOR}99default`).runs[0]!;
    expect(defaultForeground.text).toBe('default');
    expect(defaultForeground.style.fg).toBeUndefined();

    const defaultBackground = parseIrcRuns(`${COLOR}4,99red`).runs[0]!;
    expect(defaultBackground.style.fg).toBe('#ff0000');
    expect(defaultBackground.style.bg).toBeUndefined();

    const malformedBackground = parseIrcRuns(`${COLOR}4,text`).runs[0]!;
    expect(malformedBackground).toMatchObject({ text: ',text', style: { fg: '#ff0000' } });
  });

  it('keeps overlapping styles independent until reset clears the state', () => {
    const { runs, out } = parseIrcRuns(
      `${BOLD}bold ${COLOR}4red ${ITALIC}red italic${COLOR} plain italic${RESET} plain`,
    );

    expect(runs.map((run) => run.text)).toEqual([
      'bold ',
      'red ',
      'red italic',
      ' plain italic',
      ' plain',
    ]);
    expect(runs[0]!.style).toMatchObject({ bold: true });
    expect(runs[1]!.style).toMatchObject({ bold: true, fg: '#ff0000' });
    expect(runs[2]!.style).toMatchObject({ bold: true, italic: true, fg: '#ff0000' });
    expect(runs[3]!.style).toMatchObject({ bold: true, italic: true });
    expect(runs[3]!.style.fg).toBeUndefined();
    expect(runs[4]!.style).toEqual({});
    expect(out).toEqual({});
  });
});

describe('parseMessage tokenizer contracts', () => {
  it('keeps plain text as one inert text token', () => {
    expect(parseMessage('plain text only')).toEqual([{ type: 'text', text: 'plain text only' }]);
  });

  it('tokenizes URLs, mentions, emoji, and IRC styled links through the real tokenizer', () => {
    const tokens = parseMessage(
      `hey @alice see ${COLOR}12https://example.test/path?q=1${COLOR} :rocket:`,
    );

    expect(tokens).toEqual([
      { type: 'text', text: 'hey ' },
      { type: 'mention', nick: 'alice' },
      { type: 'text', text: ' see ' },
      {
        type: 'styled',
        style: { fg: '#0000fc' },
        children: [{ type: 'link', href: 'https://example.test/path?q=1', text: 'https://example.test/path?q=1' }],
      },
      { type: 'text', text: ' ' },
      { type: 'emoji', shortcode: 'rocket' },
    ]);
  });

  it('leaves hostile HTML-looking input as inert text/link tokens only', () => {
    const hostile = 'look <img src=x onerror=alert(1)> https://example.test/<svg onload=alert(2)> end';
    const tokens = parseMessage(hostile);
    const types = tokenTypes(tokens);

    expect(types.every((type) => type === 'text' || type === 'link')).toBe(true);
    expect(types).not.toContain('html');
    expect(types).not.toContain('script');
    expect(tokens).toEqual([
      { type: 'text', text: 'look <img src=x onerror=alert(1)> ' },
      { type: 'link', href: 'https://example.test/', text: 'https://example.test/' },
      { type: 'text', text: '<svg onload=alert(2)> end' },
    ]);
  });

  it('threads reset-cleared IRC state before returning to unstyled tokens', () => {
    const tokens = parseMessage(`${BOLD}${COLOR}4hot${RESET} plain`);

    expect(styledTokens(tokens)).toEqual([
      {
        type: 'styled',
        style: { bold: true, fg: '#ff0000' },
        children: [{ type: 'text', text: 'hot' }],
      },
    ]);
    expect(tokens[tokens.length - 1]).toEqual({ type: 'text', text: ' plain' });
  });
});

describe('pure format helper contracts', () => {
  it('promotes rounded byte values to the next unit deterministically', () => {
    expect(formatBytes(999_950, { precision: 1 })).toBe('1 MB');
    expect(formatBytes(1024 ** 2 - 1, { binary: true, precision: 0 })).toBe('1 MiB');
  });

  it('formats the full duration unit chain when requested', () => {
    const ms = (2 * 604_800 + 3 * 86_400 + 4 * 3_600 + 5 * 60 + 6) * 1_000;

    expect(formatDuration(ms, { compact: false, maxUnits: 5 })).toBe(
      '2 weeks 3 days 4 hours 5 minutes 6 seconds',
    );
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('pluralizes only the exact numeric value one as singular', () => {
    expect(countLabel(1, 'event')).toBe('1 event');
    expect(countLabel(1.5, 'event')).toBe('1.5 events');
    expect(countLabel(-1, 'event')).toBe('-1 events');
  });
});
