// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { escapeRegExpLiteral, highlightRanges } from './highlightRanges';
import { parseMentions } from './mentionParse';
import { truncateEnd, truncateMiddle } from './truncateMiddle';

function rangeText(text: string, range: { start: number; end: number }): string {
  return text.slice(range.start, range.end);
}

describe('parseMentions boundary contracts', () => {
  it('accepts IRC mention boundaries while rejecting email and word-internal @ markers', () => {
    const text = 'email alice@example.test path/@ops dot.@bot word@nope snowé@no #room\t&ops,';
    const parsed = parseMentions(text);

    expect(parsed.mentions).toEqual(['ops', 'bot']);
    expect(parsed.channels).toEqual(['#room', '&ops']);
    expect(parsed.ranges.map((range) => rangeText(text, range))).toEqual([
      '@ops',
      '@bot',
      '#room',
      '&ops',
    ]);
  });

  it('deduplicates collected mention values without dropping the individual ranges', () => {
    const text = '@Alice @alice #Root #root';
    const parsed = parseMentions(text);

    expect(parsed.mentions).toEqual(['Alice']);
    expect(parsed.channels).toEqual(['#Root']);
    expect(parsed.ranges.map((range) => range.value)).toEqual(['Alice', 'alice', '#Root', '#root']);
  });
});

describe('highlightRanges contracts', () => {
  it('escapes user queries as literals before building highlight ranges', () => {
    expect(escapeRegExpLiteral('a+b? [x]')).toBe('a\\+b\\? \\[x\\]');
    expect(highlightRanges('find a+b? [x] then aab', 'a+b? [x]')).toEqual([
      { start: 0, end: 5, match: false },
      { start: 5, end: 13, match: true },
      { start: 13, end: 22, match: false },
    ]);
  });

  it('emits adjacent matches without empty spacer ranges', () => {
    expect(highlightRanges('aaaa', 'a')).toEqual([
      { start: 0, end: 1, match: true },
      { start: 1, end: 2, match: true },
      { start: 2, end: 3, match: true },
      { start: 3, end: 4, match: true },
    ]);
  });

  it('returns a single non-match range when the query cannot fit', () => {
    expect(highlightRanges('reef', 'open water')).toEqual([{ start: 0, end: 4, match: false }]);
  });
});

describe('truncateMiddle and truncateEnd edge contracts', () => {
  it('handles the ellipsis-length boundary exactly', () => {
    expect(truncateMiddle('abcdef', 1)).toBe('…');
    expect(truncateEnd('abcdef', 1)).toBe('…');
  });

  it('keeps output within tiny middle-truncation limits', () => {
    expect(truncateMiddle('abcdef', 2)).toBe('…f');
    expect(truncateMiddle('abcdef', 3)).toBe('a…f');
  });

  it('treats non-finite maximums deterministically', () => {
    expect(truncateMiddle('abcdef', Number.POSITIVE_INFINITY)).toBe('abcdef');
    expect(truncateMiddle('abcdef', Number.NaN)).toBe('');
    expect(truncateEnd('abcdef', Number.NEGATIVE_INFINITY)).toBe('');
  });
});
