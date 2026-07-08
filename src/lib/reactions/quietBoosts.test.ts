/**
 * quietBoosts.test.ts — behavior coverage for no-notification reaction logic.
 */
import { describe, expect, it } from 'vitest';

import { aggregateBoosts, BOOST_NOTIFIES, type BoostGroup, toggleBoost, totalBoosts } from './quietBoosts';

describe('quiet boost aggregation', () => {
  it('groups boosts by emoji, counts reactors, and sorts by count then emoji', () => {
    const groups = aggregateBoosts(
      [
        { emoji: 'b', from: 'mio' },
        { emoji: 'a', from: 'kai' },
        { emoji: 'c', from: 'ren' },
        { emoji: 'b', from: 'aya' },
      ],
      'kai',
    );

    expect(groups).toEqual([
      { emoji: 'b', count: 2, reactors: ['mio', 'aya'], youBoosted: false },
      { emoji: 'a', count: 1, reactors: ['kai'], youBoosted: true },
      { emoji: 'c', count: 1, reactors: ['ren'], youBoosted: false },
    ]);
    expect(totalBoosts(groups)).toBe(4);
  });

  it('marks youBoosted with case-insensitive nick comparison', () => {
    const groups = aggregateBoosts([{ emoji: '🌊', from: 'Kain' }], 'kain');

    expect(groups).toEqual([{ emoji: '🌊', count: 1, reactors: ['Kain'], youBoosted: true }]);
  });

  it('ignores empty emoji/from values and deduplicates reactors first-seen', () => {
    const groups = aggregateBoosts(
      [
        { emoji: '', from: 'kai' },
        { emoji: '🌿', from: '' },
        { emoji: '🌿', from: 'Kai' },
        { emoji: '🌿', from: 'kai' },
        { emoji: '🌿', from: 'Mio' },
      ],
      'ren',
    );

    expect(groups).toEqual([{ emoji: '🌿', count: 2, reactors: ['Kai', 'Mio'], youBoosted: false }]);
  });

  it('documents that boosts never notify anyone', () => {
    expect(BOOST_NOTIFIES).toBe(false);
  });
});

describe('quiet boost optimistic toggles', () => {
  it('adds you to an existing group and leaves the original array unmutated', () => {
    const groups: BoostGroup[] = [{ emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false }];

    const next = toggleBoost(groups, '🌊', 'kai');

    expect(next).toEqual([{ emoji: '🌊', count: 2, reactors: ['mio', 'kai'], youBoosted: true }]);
    expect(groups).toEqual([{ emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false }]);
  });

  it('creates a missing group and re-sorts by count then emoji', () => {
    const groups: BoostGroup[] = [{ emoji: 'b', count: 1, reactors: ['mio'], youBoosted: false }];

    const next = toggleBoost(groups, 'a', 'kai');

    expect(next).toEqual([
      { emoji: 'a', count: 1, reactors: ['kai'], youBoosted: true },
      { emoji: 'b', count: 1, reactors: ['mio'], youBoosted: false },
    ]);
  });

  it('toggles you off with case-insensitive nick comparison', () => {
    const groups: BoostGroup[] = [{ emoji: '🌊', count: 2, reactors: ['Mio', 'Kai'], youBoosted: true }];

    const next = toggleBoost(groups, '🌊', 'kai');

    expect(next).toEqual([{ emoji: '🌊', count: 1, reactors: ['Mio'], youBoosted: false }]);
  });

  it('drops a group when toggling the final reactor off', () => {
    const groups: BoostGroup[] = [{ emoji: '🌊', count: 1, reactors: ['Kai'], youBoosted: true }];

    const next = toggleBoost(groups, '🌊', 'kai');

    expect(next).toEqual([]);
  });
});
