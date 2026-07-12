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
  it('returns an empty public shape for empty boost input', () => {
    const boosts: readonly [] = [];

    const groups = aggregateBoosts(boosts, 'kai');

    expect(groups).toEqual([]);
    expect(totalBoosts(groups)).toBe(0);
  });

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

  it('keeps visually distinct reaction forms in separate stable groups', () => {
    const boosts = [
      { emoji: '👍', from: 'kai' },
      { emoji: '👍🏽', from: 'kai' },
      { emoji: '👍', from: 'mio' },
      { emoji: '👨‍👩‍👧‍👦', from: 'ren' },
    ];

    const groups = aggregateBoosts(boosts, 'KAI');

    expect(groups).toEqual([
      { emoji: '👍', count: 2, reactors: ['kai', 'mio'], youBoosted: true },
      { emoji: '👍🏽', count: 1, reactors: ['kai'], youBoosted: true },
      { emoji: '👨‍👩‍👧‍👦', count: 1, reactors: ['ren'], youBoosted: false },
    ]);
  });

  it('does not mutate the input boost rows while deduplicating duplicate reactors', () => {
    const boosts = [
      { emoji: '✨', from: 'Kai' },
      { emoji: '✨', from: 'kai' },
      { emoji: '✨', from: 'Mio' },
    ];

    const groups = aggregateBoosts(boosts, 'ren');

    expect(groups).toEqual([{ emoji: '✨', count: 2, reactors: ['Kai', 'Mio'], youBoosted: false }]);
    expect(boosts).toEqual([
      { emoji: '✨', from: 'Kai' },
      { emoji: '✨', from: 'kai' },
      { emoji: '✨', from: 'Mio' },
    ]);
  });

  it('deduplicates a reactor per emoji but lets the same nick boost different emojis', () => {
    const groups = aggregateBoosts(
      [
        { emoji: 'a', from: 'Kai' },
        { emoji: 'a', from: 'kai' },
        { emoji: 'b', from: 'kai' },
        { emoji: 'b', from: 'Mio' },
        { emoji: 'b', from: 'mio' },
      ],
      'KAI',
    );

    expect(groups).toEqual([
      { emoji: 'b', count: 2, reactors: ['kai', 'Mio'], youBoosted: true },
      { emoji: 'a', count: 1, reactors: ['Kai'], youBoosted: true },
    ]);
    expect(totalBoosts(groups)).toBe(3);
  });

  it('documents that boosts never notify anyone', () => {
    expect(BOOST_NOTIFIES).toBe(false);
  });
});

describe('quiet boost optimistic toggles', () => {
  it('does nothing when adding a missing group without a valid emoji or actor', () => {
    const groups: BoostGroup[] = [];

    const emptyEmoji = toggleBoost(groups, '', 'kai');
    const emptyActor = toggleBoost(groups, '🌊', '');

    expect(emptyEmoji).toEqual([]);
    expect(emptyActor).toEqual([]);
    expect(groups).toEqual([]);
  });

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

  it('round-trips an add/remove toggle without disturbing other reactors', () => {
    const groups: BoostGroup[] = [{ emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false }];

    const added = toggleBoost(groups, '🌊', 'kai');
    const removed = toggleBoost(added, '🌊', 'KAI');

    expect(removed).toEqual([{ emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false }]);
    expect(groups).toEqual([{ emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false }]);
  });

  it('recomputes stale public counts and self state for untouched groups', () => {
    const groups: BoostGroup[] = [
      { emoji: 'b', count: 99, reactors: ['mio'], youBoosted: true },
      { emoji: 'a', count: 1, reactors: ['ren'], youBoosted: false },
    ];

    const next = toggleBoost(groups, 'a', 'kai');

    expect(next).toEqual([
      { emoji: 'a', count: 2, reactors: ['ren', 'kai'], youBoosted: true },
      { emoji: 'b', count: 1, reactors: ['mio'], youBoosted: false },
    ]);
    expect(groups[0]).toEqual({ emoji: 'b', count: 99, reactors: ['mio'], youBoosted: true });
  });

  it('leaves the original nested reactor arrays untouched when toggling another emoji', () => {
    const reactors = ['mio'];
    const groups: BoostGroup[] = [{ emoji: '🌊', count: 1, reactors, youBoosted: false }];

    const next = toggleBoost(groups, '✨', 'kai');

    expect(next).toEqual([
      { emoji: '✨', count: 1, reactors: ['kai'], youBoosted: true },
      { emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false },
    ]);
    expect(reactors).toEqual(['mio']);
    expect(next[1]?.reactors).not.toBe(reactors);
  });

  it('removes every case variant of you from a stale reconciled group', () => {
    const groups: BoostGroup[] = [{ emoji: '🌊', count: 3, reactors: ['Kai', 'kai', 'mio'], youBoosted: false }];

    const next = toggleBoost(groups, '🌊', 'KAI');

    expect(next).toEqual([{ emoji: '🌊', count: 1, reactors: ['mio'], youBoosted: false }]);
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

  it('uses target then message id as deterministic tie-breakers and applies the limit', () => {
    const conversations = [
      {
        target: '#zeta',
        messages: [msg('b', 'same total', [{ emoji: 'a', users: ['mio'] }], 1000)],
      },
      {
        target: '#alpha',
        messages: [
          msg('c', 'same total', [{ emoji: 'a', users: ['mio'] }], 1000),
          msg('a', 'same total', [{ emoji: 'a', users: ['mio'] }], 1000),
        ],
      },
    ];

    const digest = buildQuietBoostDigest(conversations, 'ren', 2);

    expect(digest.map((item) => [item.target, item.messageId])).toEqual([
      ['#alpha', 'a'],
      ['#alpha', 'c'],
    ]);
  });

  it('prefers plaintext, normalizes whitespace, and leaves source messages untouched', () => {
    const message = {
      ...msg('plain', '<b>rendered</b>', [{ emoji: 'sparkles', users: ['mio'] }], 1000),
      plaintext: '  rendered\n  text\tonly  ',
    };

    const digest = buildQuietBoostDigest([{ target: '#general', messages: [message] }], 'mio');

    expect(digest[0]?.text).toBe('rendered text only');
    expect(message.plaintext).toBe('  rendered\n  text\tonly  ');
  });

  it('deduplicates duplicate reaction rows per emoji before counting digest totals', () => {
    const message = msg(
      'dupes',
      'duplicate rows',
      [
        { emoji: '✨', users: ['kai', 'mio'] },
        { emoji: '✨', users: ['KAI', 'ren'] },
      ],
      1000,
    );

    const digest = buildQuietBoostDigest([{ target: '#general', messages: [message] }], 'kai');

    expect(digest).toHaveLength(1);
    expect(digest[0]?.total).toBe(3);
    expect(digest[0]?.groups).toEqual([
      { emoji: '✨', count: 3, reactors: ['kai', 'mio', 'ren'], youBoosted: true },
    ]);
  });

  it('honors a zero limit after filtering otherwise valid digest items', () => {
    const digest = buildQuietBoostDigest(
      [{ target: '#general', messages: [msg('visible', 'boosted', [{ emoji: 'a', users: ['mio'] }], 1000)] }],
      'kai',
      0,
    );

    expect(digest).toEqual([]);
  });

  it('reconciles malformed TAGMSG reaction rows before computing digest totals', () => {
    const message = msg(
      'tagmsg-reconcile',
      '  reaction\tfold-back\nsummary  ',
      [
        { emoji: '', users: ['kai'] },
        { emoji: '✨', users: ['Ren'] },
        { emoji: '✨', users: ['ren', 'Aya'] },
        { emoji: '🌊', users: ['', 'Kai', 'kai', 'Mio', 'Ren'] },
      ],
      1000,
    );

    const digest = buildQuietBoostDigest([{ target: '#general', messages: [message] }], 'kai');

    expect(digest).toEqual([
      {
        target: '#general',
        messageId: 'tagmsg-reconcile',
        at: new Date(1000),
        from: 'alice',
        text: 'reaction fold-back summary',
        total: 5,
        groups: [
          { emoji: '🌊', count: 3, reactors: ['Kai', 'Mio', 'Ren'], youBoosted: true },
          { emoji: '✨', count: 2, reactors: ['Ren', 'Aya'], youBoosted: false },
        ],
      },
    ]);
  });

  it('sorts digest items by deduped totals, not raw repeated TAGMSG rows', () => {
    const digest = buildQuietBoostDigest(
      [{
        target: '#general',
        messages: [
          msg(
            'raw-dupes',
            'many repeated rows',
            [
              { emoji: 'a', users: ['Kai', 'kai'] },
              { emoji: 'a', users: ['KAI'] },
            ],
            3000,
          ),
          msg('unique-two', 'two real boosts', [{ emoji: 'b', users: ['mio', 'ren'] }], 1000),
        ],
      }],
      'kai',
    );

    expect(digest.map((item) => [item.messageId, item.total])).toEqual([
      ['unique-two', 2],
      ['raw-dupes', 1],
    ]);
  });

  it('skips messages whose reconciled TAGMSG reactions have no valid emoji or reactor', () => {
    const digest = buildQuietBoostDigest(
      [{
        target: '#general',
        messages: [
          msg('empty-emoji', 'invalid emoji', [{ emoji: '', users: ['mio'] }], 1000),
          msg('empty-user', 'invalid user', [{ emoji: '🌊', users: ['', ''] }], 2000),
          msg('valid', 'visible', [{ emoji: '🌊', users: ['mio'] }], 3000),
        ],
      }],
      'kai',
    );

    expect(digest.map((item) => item.messageId)).toEqual(['valid']);
  });
});
