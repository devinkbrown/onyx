// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { buildResumePoints, type ResumePoint } from './resumePoints';
import { buildCatchUp, type CatchUpItem } from '@/lib/notifications/catchUp';

// Build a ranked catch-up list the way HomeView does, so the test pins the
// real end-to-end contract (buildCatchUp ranking → resume points), not a
// hand-mocked ordering.
function ranked(
  channels: Array<{ name: string; unread: number; highlights: number }>,
  dms: Array<{ nick: string; unread: number; highlights: number; lastSeen?: Date }>,
  lastActivity: Map<string, number> = new Map(),
  followedKeys: ReadonlySet<string> = new Set(),
): CatchUpItem[] {
  return buildCatchUp(channels, dms, lastActivity, { followedKeys, limit: 50 });
}

describe('buildResumePoints', () => {
  it('attaches the authoritative firstUnreadId as the boundary to land on', () => {
    const items = ranked([{ name: '#root', unread: 4, highlights: 0 }], []);
    const firstUnread = new Map<string, string | null>([['#root', 'msg-42']]);

    const points = buildResumePoints(items, firstUnread);

    expect(points).toHaveLength(1);
    expect(points[0]!.target).toBe('#root');
    // The resume boundary IS the store's last-read cursor for that target.
    expect(points[0]!.boundaryId).toBe('msg-42');
    expect(points[0]!.tier).toBe('active');
    // Counters used by the rendered meta + aria-label are carried through.
    expect(points[0]!.unread).toBe(4);
    expect(points[0]!.highlights).toBe(0);
    expect(points[0]!.followed).toBe(false);
  });

  it('tags a DM that also mentions you as a mention (highest bucket wins)', () => {
    const items = ranked([], [{ nick: 'alice', unread: 2, highlights: 1 }]);
    const firstUnread = new Map<string, string | null>([['alice', 'm-alice']]);

    const points = buildResumePoints(items, firstUnread);

    expect(points).toHaveLength(1);
    expect(points[0]!.kind).toBe('dm');
    expect(points[0]!.tier).toBe('mention');
    expect(points[0]!.highlights).toBe(1);
  });

  it('drops targets with no boundary (null or absent firstUnreadId)', () => {
    const items = ranked(
      [
        { name: '#has', unread: 3, highlights: 0 },
        { name: '#nullb', unread: 2, highlights: 0 },
        { name: '#absent', unread: 5, highlights: 0 },
      ],
      [],
    );
    const firstUnread = new Map<string, string | null>([
      ['#has', 'm1'],
      ['#nullb', null], // known target, but no unseen boundary
      // '#absent' intentionally missing
    ]);

    const points = buildResumePoints(items, firstUnread);

    expect(points.map((p) => p.target)).toEqual(['#has']);
  });

  it('preserves the catch-up ranking: mention/dm bucket > followed > active', () => {
    // buildCatchUp buckets mentions AND DMs into the same top priority, then
    // breaks by recency; followed is the next bucket, ambient last. The
    // #plain channel has the newest activity yet still sinks below the
    // personal + followed items — that is the whole point of the ranking.
    const activity = new Map<string, number>([
      ['#ment', 3000], // mention, newer than the dm → leads the top bucket
      ['#follow', 4000], // followed, but a lower bucket than mention/dm
      ['#plain', 5000], // most recent, but ambient → lowest bucket
    ]);
    const items = ranked(
      [
        { name: '#plain', unread: 6, highlights: 0 }, // active, most recent
        { name: '#follow', unread: 2, highlights: 0 }, // followed
        { name: '#ment', unread: 1, highlights: 1 }, // mention
      ],
      [{ nick: 'alice', unread: 1, highlights: 0, lastSeen: new Date(2000) }], // dm
      activity,
      new Set(['#follow']),
    );
    const firstUnread = new Map<string, string | null>([
      ['#ment', 'a'],
      ['alice', 'b'],
      ['#follow', 'c'],
      ['#plain', 'd'],
    ]);

    const points = buildResumePoints(items, firstUnread);

    // Despite #plain being the most-recent, mentions/DMs/followed outrank it.
    expect(points.map((p) => p.target)).toEqual(['#ment', 'alice', '#follow', '#plain']);
    expect(points.map((p) => p.tier)).toEqual(['mention', 'dm', 'followed', 'active']);
  });

  it('is case-insensitive on the boundary lookup (store keys are lowercased)', () => {
    const items = ranked([{ name: '#Root', unread: 2, highlights: 0 }], []);
    const firstUnread = new Map<string, string | null>([['#root', 'm-lower']]);

    const points = buildResumePoints(items, firstUnread);

    expect(points[0]!.boundaryId).toBe('m-lower');
    // Display name keeps original casing; navigation target is the raw name.
    expect(points[0]!.name).toBe('#Root');
    expect(points[0]!.target).toBe('#Root');
  });

  it('caps at the limit while keeping the highest-ranked boundaries', () => {
    const items = ranked(
      [
        { name: '#a', unread: 1, highlights: 1 },
        { name: '#b', unread: 1, highlights: 1 },
        { name: '#c', unread: 1, highlights: 1 },
      ],
      [],
      new Map([
        ['#a', 3000],
        ['#b', 2000],
        ['#c', 1000],
      ]),
    );
    const firstUnread = new Map<string, string | null>([
      ['#a', 'a'],
      ['#b', 'b'],
      ['#c', 'c'],
    ]);

    const points = buildResumePoints(items, firstUnread, 2);

    expect(points.map((p) => p.target)).toEqual(['#a', '#b']);
  });

  it('returns an empty list when nothing has a boundary', () => {
    const items = ranked([{ name: '#quiet', unread: 3, highlights: 0 }], []);
    const points: ResumePoint[] = buildResumePoints(items, new Map());
    expect(points).toEqual([]);
  });
});
