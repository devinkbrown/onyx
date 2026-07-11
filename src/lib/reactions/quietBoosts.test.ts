// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * quietBoosts.test.ts — behavior coverage for no-notification reaction logic.
 */
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import {
  aggregateBoosts,
  BOOST_NOTIFIES,
  buildQuietBoostDigest,
  type BoostGroup,
  toggleBoost,
  totalBoosts,
} from './quietBoosts';

function msg(id: string, text: string, reactions: ChatMessage['reactions'], at: number): ChatMessage {
  return {
    id,
    from: 'alice',
    text,
    time: new Date(at),
    type: 'msg',
    target: '#general',
    reactions,
  };
}

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

describe('quiet boost Home digest', () => {
  it('collects boosted messages by total boosts then recency', () => {
    const digest = buildQuietBoostDigest(
      [
        {
          target: '#general',
          messages: [
            msg('low', 'one boost', [{ emoji: 'a', users: ['mio'] }], 1000),
            msg('top', 'two boosts', [{ emoji: 'b', users: ['mio', 'ren'] }], 2000),
          ],
        },
        {
          target: 'kai',
          messages: [
            msg('dm', 'new one boost', [{ emoji: 'c', users: ['ren'] }], 3000),
          ],
        },
      ],
      'mio',
    );

    expect(digest.map((item) => [item.target, item.messageId, item.total])).toEqual([
      ['#general', 'top', 2],
      ['kai', 'dm', 1],
      ['#general', 'low', 1],
    ]);
    expect(digest[0]?.groups[0]).toMatchObject({ emoji: 'b', count: 2, youBoosted: true });
  });

  it('skips deleted/redacted and blank boosted messages', () => {
    const digest = buildQuietBoostDigest(
      [{
        target: '#general',
        messages: [
          { ...msg('deleted', 'hidden', [{ emoji: 'a', users: ['mio'] }], 1000), deleted: true },
          { ...msg('redacted', 'hidden', [{ emoji: 'a', users: ['mio'] }], 2000), redacted: true },
          msg('blank', '   ', [{ emoji: 'a', users: ['mio'] }], 3000),
          msg('visible', 'quiet thanks', [{ emoji: 'a', users: ['mio'] }], 4000),
        ],
      }],
      'mio',
    );

    expect(digest.map((item) => item.messageId)).toEqual(['visible']);
  });
});
