// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { buildAwayDigest } from './awayDigest';
import type { CatchUpItem } from './catchUp';
import type { NotifyLevel } from './channelNotifyMode';
import type { CalmPreset } from './calmMode';

// Fixed synthetic clock — no wall-clock read anywhere in the pure engine.
const T = 1_700_000_000_000;

function chan(over: Partial<CatchUpItem> = {}): CatchUpItem {
  return {
    key: `c:${(over.name ?? '#room').toLowerCase()}`,
    kind: 'channel',
    name: over.name ?? '#room',
    target: over.target ?? over.name ?? '#room',
    unread: 3,
    highlights: 0,
    followed: false,
    lastActivity: T,
    ...over,
  };
}

function dm(over: Partial<CatchUpItem> = {}): CatchUpItem {
  return {
    key: `d:${(over.name ?? 'alice').toLowerCase()}`,
    kind: 'dm',
    name: over.name ?? 'alice',
    target: over.target ?? over.name ?? 'alice',
    unread: 1,
    highlights: 0,
    followed: false,
    lastActivity: T,
    ...over,
  };
}

const levels = (entries: Array<[string, NotifyLevel]> = []): Map<string, NotifyLevel> =>
  new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));

function digest(items: CatchUpItem[], preset: CalmPreset = 'regular', notifyLevels = levels()) {
  return buildAwayDigest(items, { notifyLevels, preset });
}

describe('buildAwayDigest — tier decision table', () => {
  it('routes a DM to the attention tier', () => {
    const d = digest([dm({ name: 'bob' })]);
    expect(d.attention.map((i) => i.name)).toEqual(['bob']);
    expect(d.followed).toHaveLength(0);
    expect(d.quiet).toHaveLength(0);
  });

  it('routes a mentioned channel to the attention tier', () => {
    const d = digest([chan({ name: '#dev', highlights: 2 })]);
    expect(d.attention.map((i) => i.name)).toEqual(['#dev']);
  });

  it('routes a followed channel (no mention) to the followed tier under regular', () => {
    const d = digest([chan({ name: '#news', followed: true })]);
    expect(d.followed.map((i) => i.name)).toEqual(['#news']);
    expect(d.attention).toHaveLength(0);
  });

  it('keeps a followed channel in the followed tier under calm (never escalated)', () => {
    const d = digest([chan({ name: '#news', followed: true })], 'calm');
    expect(d.followed.map((i) => i.name)).toEqual(['#news']);
    expect(d.attention).toHaveLength(0);
  });

  it('escalates a followed channel to attention under power', () => {
    const d = digest([chan({ name: '#news', followed: true })], 'power');
    expect(d.attention.map((i) => i.name)).toEqual(['#news']);
    expect(d.followed).toHaveLength(0);
  });

  it('routes an ambient (unfollowed, no mention) channel to the quiet tail', () => {
    const d = digest([chan({ name: '#random' })]);
    expect(d.quiet.map((i) => i.name)).toEqual(['#random']);
    expect(d.attention).toHaveLength(0);
    expect(d.followed).toHaveLength(0);
  });

  it('excludes a muted channel from attention even when mentioned', () => {
    const d = digest(
      [chan({ name: '#spam', highlights: 5 })],
      'regular',
      levels([['#spam', 'none']]),
    );
    expect(d.attention).toHaveLength(0);
    expect(d.followed).toHaveLength(0);
    expect(d.quiet.map((i) => i.name)).toEqual(['#spam']);
  });

  it('excludes a muted followed channel from the followed tier', () => {
    const d = digest(
      [chan({ name: '#loud', followed: true })],
      'regular',
      levels([['#loud', 'none']]),
    );
    expect(d.followed).toHaveLength(0);
    expect(d.quiet.map((i) => i.name)).toEqual(['#loud']);
  });

  it('never mutes a DM via the channelNotify map', () => {
    const d = digest([dm({ name: 'carol' })], 'regular', levels([['carol', 'none']]));
    expect(d.attention.map((i) => i.name)).toEqual(['carol']);
  });
});

describe('buildAwayDigest — ordering & aggregates', () => {
  it('orders attention by highlight count, then DM, then recency', () => {
    const d = digest([
      chan({ name: '#a', highlights: 1, lastActivity: T }),
      chan({ name: '#b', highlights: 3, lastActivity: T - 1000 }),
      dm({ name: 'zoe', highlights: 1, lastActivity: T }),
    ]);
    // #b has the most highlights; then the DM and #a tie on highlights=1,
    // DM ranks above channel.
    expect(d.attention.map((i) => i.name)).toEqual(['#b', 'zoe', '#a']);
  });

  it('orders followed and quiet tiers by unread desc then recency', () => {
    const d = digest([
      chan({ name: '#q1', unread: 2, lastActivity: T - 5000 }),
      chan({ name: '#q2', unread: 9, lastActivity: T }),
    ]);
    expect(d.quiet.map((i) => i.name)).toEqual(['#q2', '#q1']);
  });

  it('caps the quiet tail at quietLimit', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      chan({ name: `#c${i}`, unread: i + 1, lastActivity: T - i }),
    );
    const d = buildAwayDigest(items, { notifyLevels: levels(), preset: 'regular', quietLimit: 3 });
    expect(d.quiet).toHaveLength(3);
    // Highest unread first.
    expect(d.quiet.map((i) => i.name)).toEqual(['#c9', '#c8', '#c7']);
  });

  it('sums unread and mentions across every tier, including capped/muted rows', () => {
    const d = digest(
      [
        dm({ name: 'a', unread: 1, highlights: 1 }),
        chan({ name: '#f', followed: true, unread: 4 }),
        chan({ name: '#m', unread: 7, highlights: 2 }, ),
      ],
      'regular',
      levels([['#m', 'none']]),
    );
    expect(d.totalUnread).toBe(1 + 4 + 7);
    expect(d.totalMentions).toBe(1 + 0 + 2);
  });

  it('reports empty when quietLimit hides every surviving (quiet-only) row', () => {
    const d = buildAwayDigest([chan({ name: '#a' }), chan({ name: '#b' })], {
      notifyLevels: levels(),
      preset: 'regular',
      quietLimit: 0,
    });
    expect(d.quiet).toHaveLength(0);
    expect(d.empty).toBe(true);
  });

  it('reports empty when there is nothing unread', () => {
    const d = digest([]);
    expect(d.empty).toBe(true);
    expect(d.attention).toHaveLength(0);
    expect(d.followed).toHaveLength(0);
    expect(d.quiet).toHaveLength(0);
  });

  it('is not empty when any tier has a row', () => {
    expect(digest([chan({ name: '#x' })]).empty).toBe(false);
  });

  it('produces a stable ordering for identical input (no reshuffle)', () => {
    const items = [
      chan({ name: '#b', followed: true, unread: 2 }),
      chan({ name: '#a', followed: true, unread: 2 }),
    ];
    const first = digest(items).followed.map((i) => i.name);
    const second = digest([...items].reverse()).followed.map((i) => i.name);
    expect(first).toEqual(second);
    expect(first).toEqual(['#a', '#b']); // tie broken by name
  });
});
