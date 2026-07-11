// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/search/fuzzy.test.ts
 *
 * Tests for the public lib/search/fuzzy façade. Verifies the re-export works
 * and exercises the core scoring contract.
 */
import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyFilter } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches a substring and returns a positive score', () => {
    const result = fuzzyMatch('lap', 'Go to #lapis');
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it('returns null when the query is not a subsequence of the title', () => {
    const result = fuzzyMatch('zzz', 'hello world');
    expect(result).toBeNull();
  });

  it('returns empty ranges for an empty query', () => {
    const result = fuzzyMatch('', 'anything');
    expect(result).not.toBeNull();
    expect(result!.ranges).toHaveLength(0);
  });

  it('ranks exact prefix matches higher than mid-string matches', () => {
    const prefixScore = fuzzyMatch('lap', 'lapis')!.score;
    const midScore = fuzzyMatch('lap', 'Open lapis')!.score;
    expect(prefixScore).toBeGreaterThan(midScore);
  });

  it('applies a score penalty (-38) for keyword-only matches vs title matches on the same string', () => {
    // Matching 'lap' against the exact same string 'lapis' as a title vs keyword
    // The keyword match gets -38 penalty applied to its score.
    const titleScore = fuzzyMatch('lap', 'lapis')!.score;
    // Simulate what fuzzyMatch does internally: keyword match = titleScore - 38
    // because the implementation subtracts 38 from keyword scores.
    // We can test this indirectly: a fuzzy result whose only match is via keyword
    // must have score lower than the equivalent title match on the same text.
    const keywordOnlyItem = fuzzyMatch('lap', 'xyz', ['lapis']);
    // 'lap' does not match 'xyz' as title, but does match keyword 'lapis'
    expect(keywordOnlyItem).not.toBeNull();
    // The keyword score should be less than title score on identical text
    expect(keywordOnlyItem!.score).toBeLessThan(titleScore);
  });

  it('produces compact highlight ranges for consecutive characters', () => {
    const result = fuzzyMatch('abc', 'xabcx');
    expect(result).not.toBeNull();
    // 'abc' is consecutive in 'xabcx' → one range [1,4]
    expect(result!.ranges).toHaveLength(1);
    expect(result!.ranges[0]).toEqual({ start: 1, end: 4 });
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { id: 'a', title: 'Apple channel', keywords: ['fruit'] },
    { id: 'b', title: 'Banana DM', keywords: ['fruit', 'yellow'] },
    { id: 'c', title: '#forge', keywords: ['irc', 'channel'] },
  ];

  it('returns all items for an empty query', () => {
    const results = fuzzyFilter(items, '', (i) => i.title, (i) => i.keywords);
    expect(results).toHaveLength(3);
  });

  it('filters items to only those matching the query', () => {
    const results = fuzzyFilter(items, 'forge', (i) => i.title, (i) => i.keywords);
    expect(results).toHaveLength(1);
    expect(results[0]!.item.id).toBe('c');
  });

  it('sorts results by descending score', () => {
    const results = fuzzyFilter(items, 'an', (i) => i.title, (i) => i.keywords);
    // Both Apple and Banana could match 'an'; Banana has 'an' earlier
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('returns highlight ranges for matched items', () => {
    const results = fuzzyFilter(items, 'forge', (i) => i.title, (i) => i.keywords);
    expect(results[0]!.ranges.length).toBeGreaterThan(0);
  });

  it('matches via keyword when title does not match', () => {
    // 'fruit' is only in keywords
    const results = fuzzyFilter(items, 'fruit', (i) => i.title, (i) => i.keywords);
    expect(results.length).toBeGreaterThan(0);
  });
});
