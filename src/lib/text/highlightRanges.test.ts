// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { highlightRanges } from './highlightRanges';

function joinSegments(text: string, segments: ReturnType<typeof highlightRanges>): string {
  return segments.map((segment) => text.slice(segment.start, segment.end)).join('');
}

function expectMonotonicSegments(
  text: string,
  segments: ReturnType<typeof highlightRanges>,
): void {
  let cursor = 0;

  for (const segment of segments) {
    expect(segment.start).toBe(cursor);
    expect(segment.end).toBeGreaterThanOrEqual(segment.start);
    cursor = segment.end;
  }

  expect(cursor).toBe(text.length);
  expect(joinSegments(text, segments)).toBe(text);
}

describe('highlightRanges', () => {
  it('returns one non-match segment when there is no match', () => {
    expect(highlightRanges('open water', 'reef')).toEqual([{ start: 0, end: 10, match: false }]);
  });

  it('returns empty ranges when query absent and text absent', () => {
    expect(highlightRanges('', '')).toEqual([{ start: 0, end: 0, match: false }]);
  });

  it('keeps boundary matches exact at the first and last code-unit offsets', () => {
    const text = 'reef middle reef';
    const ranges = highlightRanges(text, 'reef');

    expect(ranges).toEqual([
      { start: 0, end: 4, match: true },
      { start: 4, end: 12, match: false },
      { start: 12, end: 16, match: true },
    ]);
    expectMonotonicSegments(text, ranges);
  });

  it('returns only the first non-overlapping match for overlapping candidates', () => {
    expect(highlightRanges('banana', 'ana')).toEqual([
      { start: 0, end: 1, match: false },
      { start: 1, end: 4, match: true },
      { start: 4, end: 6, match: false },
    ]);
  });

  it('keeps overlapping prefix matches non-overlapping and reconstructable', () => {
    // Arrange
    const text = 'ababa';

    // Act
    const ranges = highlightRanges(text, 'aba');

    // Assert
    expect(ranges).toEqual([
      { start: 0, end: 3, match: true },
      { start: 3, end: 5, match: false },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('marks a single match between non-match segments', () => {
    expect(highlightRanges('open water', 'water')).toEqual([
      { start: 0, end: 5, match: false },
      { start: 5, end: 10, match: true },
    ]);
  });

  it('marks multiple non-overlapping matches', () => {
    expect(highlightRanges('one fish one dish', 'one')).toEqual([
      { start: 0, end: 3, match: true },
      { start: 3, end: 9, match: false },
      { start: 9, end: 12, match: true },
      { start: 12, end: 17, match: false },
    ]);
  });

  it('keeps adjacent matches as adjacent match segments', () => {
    expect(highlightRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2, match: true },
      { start: 2, end: 4, match: true },
    ]);
  });

  it('returns the whole text as one non-match segment for an empty query', () => {
    expect(highlightRanges('open water', '')).toEqual([{ start: 0, end: 10, match: false }]);
  });

  it('returns the whole unicode text as one non-match segment for an empty query', () => {
    const text = '👩‍💻';

    expect(highlightRanges(text, '')).toEqual([{ start: 0, end: text.length, match: false }]);
  });

  it('returns no segments for empty text with a non-empty query', () => {
    expect(highlightRanges('', 'reef')).toEqual([]);
  });

  it('treats regex-special characters as literal text', () => {
    expect(highlightRanges('Find a+b? and aab', 'a+b?')).toEqual([
      { start: 0, end: 5, match: false },
      { start: 5, end: 9, match: true },
      { start: 9, end: 17, match: false },
    ]);
  });

  it('does not normalize distinct unicode spellings into a match', () => {
    const text = 'Cafe\u0301 au lait';

    expect(highlightRanges(text, 'é')).toEqual([{ start: 0, end: text.length, match: false }]);
  });

  it('matches case-insensitively while preserving original ranges', () => {
    expect(highlightRanges('Ocean ocean OCEAN', 'oCeAn')).toEqual([
      { start: 0, end: 5, match: true },
      { start: 5, end: 6, match: false },
      { start: 6, end: 11, match: true },
      { start: 11, end: 12, match: false },
      { start: 12, end: 17, match: true },
    ]);
  });

  it('handles unicode substrings', () => {
    expect(highlightRanges('hello 🌊 hello 🌊', '🌊')).toEqual([
      { start: 0, end: 6, match: false },
      { start: 6, end: 8, match: true },
      { start: 8, end: 15, match: false },
      { start: 15, end: 17, match: true },
    ]);
  });

  it('keeps unicode matches monotonic when surrounded by overlapping ascii candidates', () => {
    const text = 'aa🌊aaa🌊aa';
    const ranges = highlightRanges(text, 'aa🌊');

    expect(ranges).toEqual([
      { start: 0, end: 4, match: true },
      { start: 4, end: 5, match: false },
      { start: 5, end: 9, match: true },
      { start: 9, end: 11, match: false },
    ]);
    expectMonotonicSegments(text, ranges);
  });

  it('matches combining-mark text literally without splitting the source range', () => {
    // Arrange
    const text = 'Cafe\u0301 cafe\u0301';

    // Act
    const ranges = highlightRanges(text, 'e\u0301');

    // Assert
    expect(ranges).toEqual([
      { start: 0, end: 3, match: false },
      { start: 3, end: 5, match: true },
      { start: 5, end: 9, match: false },
      { start: 9, end: 11, match: true },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('keeps dense overlapping candidates to non-overlapping regex matches', () => {
    const text = 'aaaaa';
    const ranges = highlightRanges(text, 'aaa');

    expect(ranges).toEqual([
      { start: 0, end: 3, match: true },
      { start: 3, end: 5, match: false },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('chooses the earliest nested candidate and does not emit inner matches', () => {
    const text = 'aaaaaa';
    const ranges = highlightRanges(text, 'aaaa');

    expect(ranges).toEqual([
      { start: 0, end: 4, match: true },
      { start: 4, end: 6, match: false },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('skips overlapping candidates and resumes matching after the accepted range', () => {
    const text = 'ababaaba';
    const ranges = highlightRanges(text, 'aba');

    expect(ranges).toEqual([
      { start: 0, end: 3, match: true },
      { start: 3, end: 5, match: false },
      { start: 5, end: 8, match: true },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('emits adjacent unicode matches at code-unit boundaries', () => {
    const text = '🌊reef🌊reef';
    const ranges = highlightRanges(text, '🌊reef');

    expect(ranges).toEqual([
      { start: 0, end: 6, match: true },
      { start: 6, end: 12, match: true },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('emits every adjacent literal match without inserting empty gaps', () => {
    const text = 'ababab';
    const ranges = highlightRanges(text, 'ab');

    expect(ranges).toEqual([
      { start: 0, end: 2, match: true },
      { start: 2, end: 4, match: true },
      { start: 4, end: 6, match: true },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('uses JS code-unit offsets for adjacent emoji ZWJ sequence matches', () => {
    const query = '👩🏽‍💻';
    const text = `${query}${query}`;
    const width = query.length;
    const ranges = highlightRanges(text, query);

    expect(ranges).toEqual([
      { start: 0, end: width, match: true },
      { start: width, end: width * 2, match: true },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('keeps an empty query inert even when text contains regex metacharacters and unicode', () => {
    const text = '^start$ [🌊] (reef)?';
    const ranges = highlightRanges(text, '');

    expect(ranges).toEqual([{ start: 0, end: text.length, match: false }]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('returns the full text as non-match when a unicode query is longer than the text', () => {
    const text = '🌊';
    const ranges = highlightRanges(text, '🌊🌊');

    expect(ranges).toEqual([{ start: 0, end: text.length, match: false }]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('matches unicode case-insensitively without normalizing decomposed text', () => {
    const text = 'mañana MAÑANA mañana';
    const ranges = highlightRanges(text, 'ÑANA');

    expect(ranges).toEqual([
      { start: 0, end: 2, match: false },
      { start: 2, end: 6, match: true },
      { start: 6, end: 9, match: false },
      { start: 9, end: 13, match: true },
      { start: 13, end: 21, match: false },
    ]);
    expect(joinSegments(text, ranges)).toBe(text);
  });

  it('returns a single full-match range when the query covers the whole text', () => {
    expect(highlightRanges('needle', 'needle')).toEqual([{ start: 0, end: 6, match: true }]);
  });

  it('keeps adversarial empty, unicode, and overlapping cases contiguous', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['', ''],
      ['', 'x'],
      ['x', ''],
      ['aaaaa', 'aa'],
      ['🌊aa🌊aa', 'aa'],
      ['Cafe\u0301Cafe\u0301', 'e\u0301C'],
      ['.*.*', '.*'],
    ];

    for (const [text, query] of cases) {
      expectMonotonicSegments(text, highlightRanges(text, query));
    }
  });

  it('reconstructs the original text from every segment', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['open water', 'water'],
      ['aaaa', 'aa'],
      ['Find a+b? and aab', 'a+b?'],
      ['Ocean ocean OCEAN', 'oCeAn'],
      ['hello 🌊 hello 🌊', '🌊'],
      ['ababaaba', 'aba'],
      ['aaaaaa', 'aaaa'],
      ['ababab', 'ab'],
      ['🌊reef🌊reef', '🌊reef'],
      ['👩🏽‍💻👩🏽‍💻', '👩🏽‍💻'],
      ['mañana MAÑANA mañana', 'ÑANA'],
      ['', 'reef'],
      ['open water', ''],
      ['^start$ [🌊] (reef)?', ''],
      ['🌊', '🌊🌊'],
    ];

    for (const [text, query] of cases) {
      expect(joinSegments(text, highlightRanges(text, query))).toBe(text);
    }
  });
});
