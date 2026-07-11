// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * markCaughtUp tests — the pure plan of which targets a "mark all caught up"
 * affordance advances, its totals, deterministic ordering, and the announce
 * string. No store, no DOM.
 */
import { describe, expect, it } from 'vitest';

import {
  caughtUpAnnounce,
  planCatchUpAll,
  type CaughtUpChannelLike,
  type CaughtUpDmLike,
} from './markCaughtUp';

const ch = (name: string, unread: number, highlights = 0): CaughtUpChannelLike => ({
  name,
  unread,
  highlights,
});
const dm = (nick: string, unread: number, highlights = 0): CaughtUpDmLike => ({
  nick,
  unread,
  highlights,
});

describe('planCatchUpAll', () => {
  it('returns an empty plan when nothing is unread', () => {
    const plan = planCatchUpAll([ch('#root', 0), ch('#zig', 0)], [dm('trev', 0)]);
    expect(plan).toEqual({ targets: [], rooms: 0, unread: 0, mentions: 0 });
  });

  it('includes only rooms with unread or highlights', () => {
    const plan = planCatchUpAll(
      [ch('#read', 0), ch('#busy', 4), ch('#pinged', 0, 2)],
      [dm('trev', 0), dm('kim', 3)],
    );
    expect(plan.targets.map((t) => t.target).sort()).toEqual(['#busy', '#pinged', 'kim']);
    expect(plan.rooms).toBe(3);
  });

  it('sums unread and mentions across channels and DMs', () => {
    const plan = planCatchUpAll(
      [ch('#root', 4, 2), ch('#zig', 10, 1)],
      [dm('trev', 3, 1)],
    );
    expect(plan.unread).toBe(17);
    expect(plan.mentions).toBe(4);
    expect(plan.rooms).toBe(3);
  });

  it('orders mentions first, then most unread, then name A→Z', () => {
    const plan = planCatchUpAll(
      [
        ch('#chatter', 40, 0), // busiest but no mention
        ch('#zeta', 1, 3), // most mentions
        ch('#alpha', 1, 3), // tie on mentions+unread → name breaks it
        ch('#mid', 12, 1),
      ],
      [dm('trev', 2, 1)],
    );
    expect(plan.targets.map((t) => t.target)).toEqual([
      '#alpha',
      '#zeta',
      '#mid',
      'trev',
      '#chatter',
    ]);
  });

  it('is deterministic regardless of input iteration order', () => {
    const a = planCatchUpAll([ch('#b', 2, 1), ch('#a', 2, 1)], []);
    const b = planCatchUpAll([ch('#a', 2, 1), ch('#b', 2, 1)], []);
    expect(a.targets).toEqual(b.targets);
  });

  it('clamps negative counters to zero', () => {
    const plan = planCatchUpAll([ch('#weird', 3, -5)], []);
    expect(plan.targets[0]!.highlights).toBe(0);
    expect(plan.mentions).toBe(0);
  });

  it('tags channel vs DM kind on each target', () => {
    const plan = planCatchUpAll([ch('#root', 1)], [dm('trev', 1)]);
    const byTarget = new Map(plan.targets.map((t) => [t.target, t.kind]));
    expect(byTarget.get('#root')).toBe('channel');
    expect(byTarget.get('trev')).toBe('dm');
  });
});

describe('caughtUpAnnounce', () => {
  it('reports the already-caught-up case', () => {
    expect(caughtUpAnnounce(planCatchUpAll([], []))).toBe('Already all caught up.');
  });

  it('pluralises rooms and omits mentions when there are none', () => {
    expect(caughtUpAnnounce(planCatchUpAll([ch('#root', 3)], []))).toBe(
      'Marked 1 room as caught up.',
    );
    expect(caughtUpAnnounce(planCatchUpAll([ch('#a', 1), ch('#b', 1)], []))).toBe(
      'Marked 2 rooms as caught up.',
    );
  });

  it('includes cleared mentions when present', () => {
    expect(
      caughtUpAnnounce(planCatchUpAll([ch('#root', 3, 1)], [dm('trev', 2, 1)])),
    ).toBe('Marked 2 rooms as caught up, clearing 2 mentions.');
    expect(caughtUpAnnounce(planCatchUpAll([ch('#root', 3, 1)], []))).toBe(
      'Marked 1 room as caught up, clearing 1 mention.',
    );
  });
});
