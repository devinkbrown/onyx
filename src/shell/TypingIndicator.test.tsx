import { describe, expect, it } from 'vitest';
import { formatTypingLabel, latestTypingExpiry } from './TypingIndicator';

describe('formatTypingLabel', () => {
  it('returns empty string for no typers', () => {
    expect(formatTypingLabel([])).toBe('');
  });

  it('formats a single typer', () => {
    expect(formatTypingLabel(['aurora'])).toBe('aurora is typing');
  });

  it('formats two typers with "and"', () => {
    expect(formatTypingLabel(['aurora', 'vesper'])).toBe('aurora and vesper are typing');
  });

  it('formats three typers as a list', () => {
    expect(formatTypingLabel(['aurora', 'vesper', 'moss'])).toBe('aurora, vesper and moss are typing');
  });

  it('collapses four or more into "Several people"', () => {
    expect(formatTypingLabel(['a', 'b', 'c', 'd'])).toBe('Several people are typing');
    expect(formatTypingLabel(['a', 'b', 'c', 'd', 'e'])).toBe('Several people are typing');
  });
});

describe('latestTypingExpiry', () => {
  it('returns 0 for an empty map (no re-tick clock is scheduled)', () => {
    expect(latestTypingExpiry(new Map())).toBe(0);
  });

  it('returns the furthest-future expiry among entries', () => {
    const map = new Map([
      ['aurora', 1000],
      ['vesper', 5000],
      ['moss', 3000],
    ]);
    expect(latestTypingExpiry(map)).toBe(5000);
  });

  it('still reports the max even when all entries are already stale', () => {
    // Lingering entries (pruned only on the next TAGMSG) must not read as 0 —
    // callers compare the result against Date.now() to decide whether to tick.
    const map = new Map([['aurora', 10], ['vesper', 20]]);
    expect(latestTypingExpiry(map)).toBe(20);
  });
});
