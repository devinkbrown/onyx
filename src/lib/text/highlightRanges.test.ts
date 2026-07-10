import { describe, expect, it } from 'vitest';

import { highlightRanges } from './highlightRanges';

function joinSegments(text: string, segments: ReturnType<typeof highlightRanges>): string {
  return segments.map((segment) => text.slice(segment.start, segment.end)).join('');
}

describe('highlightRanges', () => {
  it('returns one non-match segment when there is no match', () => {
    expect(highlightRanges('open water', 'reef')).toEqual([{ start: 0, end: 10, match: false }]);
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

  it('reconstructs the original text from every segment', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['open water', 'water'],
      ['aaaa', 'aa'],
      ['Find a+b? and aab', 'a+b?'],
      ['Ocean ocean OCEAN', 'oCeAn'],
      ['hello 🌊 hello 🌊', '🌊'],
      ['', 'reef'],
      ['open water', ''],
    ];

    for (const [text, query] of cases) {
      expect(joinSegments(text, highlightRanges(text, query))).toBe(text);
    }
  });
});
