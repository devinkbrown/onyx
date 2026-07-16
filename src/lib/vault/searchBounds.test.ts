// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  boundedSearchField,
  buildBoundedSearchText,
  SEARCH_CORPUS_TEXT_MAX,
  SEARCH_QUERY_TEXT_MAX,
  boundedSearchQuery,
  boundedSearchResultText,
  SEARCH_RESULT_TEXT_MAX,
} from './searchBounds';

describe('local search corpus bounds', () => {
  it('bounds a single stored field before search work', () => {
    const bounded = boundedSearchField(`prefix-${'x'.repeat(SEARCH_CORPUS_TEXT_MAX)}`);
    expect(bounded.length).toBe(SEARCH_CORPUS_TEXT_MAX);
    expect(bounded.startsWith('prefix-')).toBe(true);
  });

  it('bounds the combined sender and body without first requiring a full joined value', () => {
    const combined = buildBoundedSearchText(
      'alice',
      'x'.repeat(SEARCH_CORPUS_TEXT_MAX * 2),
      'unreachable-tail',
    );
    expect(combined.length).toBe(SEARCH_CORPUS_TEXT_MAX);
    expect(combined.startsWith('alice ')).toBe(true);
    expect(combined).not.toContain('unreachable-tail');
  });

  it('does not leave a dangling UTF-16 high surrogate at the work boundary', () => {
    const value = `${'x'.repeat(SEARCH_CORPUS_TEXT_MAX - 1)}\ud83d\ude00`;
    const bounded = boundedSearchField(value);
    expect(bounded).toHaveLength(SEARCH_CORPUS_TEXT_MAX - 1);
    expect(bounded.charCodeAt(bounded.length - 1)).not.toBe(0xd83d);
  });

  it('slices a query before trimming hostile leading whitespace', () => {
    expect(boundedSearchQuery(`  needle  `)).toBe('needle');
    expect(boundedSearchQuery(`${' '.repeat(SEARCH_QUERY_TEXT_MAX)}hidden`)).toBe('');
    expect(boundedSearchQuery('q'.repeat(SEARCH_QUERY_TEXT_MAX + 100))).toHaveLength(
      SEARCH_QUERY_TEXT_MAX,
    );
  });

  it('caps text before it enters reactive result/render state', () => {
    expect(boundedSearchResultText('x'.repeat(SEARCH_RESULT_TEXT_MAX + 50))).toHaveLength(
      SEARCH_RESULT_TEXT_MAX,
    );
  });

  it('keeps a deep matched term inside the bounded result excerpt', () => {
    const value = `${'x'.repeat(SEARCH_RESULT_TEXT_MAX + 500)} deep-needle tail`;
    const result = boundedSearchResultText(value, 'deep-needle');
    expect(result.length).toBeLessThanOrEqual(SEARCH_RESULT_TEXT_MAX);
    expect(result).toContain('deep-needle');
    expect(result.startsWith('…')).toBe(true);
  });
});
