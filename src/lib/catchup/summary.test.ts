import { describe, expect, it } from 'vitest';

import {
  catchUpTotals,
  summarizeCatchUp,
  type CatchUpChannelLike,
  type CatchUpDmLike,
} from './summary';

const ch = (over: Partial<CatchUpChannelLike> & { name: string }): CatchUpChannelLike => ({
  unread: 0,
  highlights: 0,
  ...over,
});

const dm = (over: Partial<CatchUpDmLike> & { nick: string }): CatchUpDmLike => ({
  unread: 0,
  highlights: 0,
  ...over,
});

describe('summarizeCatchUp', () => {
  it('returns an empty list when nothing is unread', () => {
    const rows = summarizeCatchUp(
      [ch({ name: '#root', unread: 0 }), ch({ name: '#zig', unread: 0 })],
      [dm({ nick: 'trev', unread: 0 })],
    );
    expect(rows).toEqual([]);
  });

  it('excludes read rooms and keeps only those with unread', () => {
    const rows = summarizeCatchUp(
      [ch({ name: '#root', unread: 3 }), ch({ name: '#quiet', unread: 0 })],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['#root']);
  });

  it('orders rooms by unread count, descending', () => {
    const rows = summarizeCatchUp(
      [
        ch({ name: '#low', unread: 1 }),
        ch({ name: '#high', unread: 40 }),
        ch({ name: '#mid', unread: 12 }),
      ],
      [dm({ nick: 'trev', unread: 7 })],
    );
    expect(rows.map((r) => r.name)).toEqual(['#high', '#mid', 'trev', '#low']);
    expect(rows.map((r) => r.unread)).toEqual([40, 12, 7, 1]);
  });

  it('breaks unread ties by highlights, then recency, then name', () => {
    const activity = new Map<string, number>([
      ['#older', 1_000],
      ['#newer', 5_000],
    ]);
    const rows = summarizeCatchUp(
      [
        // same unread (5): #ping has a mention → first
        ch({ name: '#older', unread: 5 }),
        ch({ name: '#newer', unread: 5 }),
        ch({ name: '#ping', unread: 5, highlights: 2 }),
      ],
      [],
      activity,
    );
    // #ping (mention) → #newer (more recent) → #older
    expect(rows.map((r) => r.name)).toEqual(['#ping', '#newer', '#older']);
  });

  it('breaks a full tie deterministically by case-insensitive name', () => {
    const rows = summarizeCatchUp(
      [ch({ name: '#Bravo', unread: 2 }), ch({ name: '#alpha', unread: 2 })],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['#alpha', '#Bravo']);
  });

  it('resolves channel last-active from the activity map by lowercased key', () => {
    const activity = new Map<string, number>([['#root', 9_999]]);
    const [row] = summarizeCatchUp([ch({ name: '#Root', unread: 1 })], [], activity);
    expect(row!.lastActive).toBe(9_999);
  });

  it('uses DM lastSeen for recency and 0 when unknown', () => {
    const seen = new Date(42_000);
    const rows = summarizeCatchUp(
      [],
      [dm({ nick: 'seen', unread: 1, lastSeen: seen }), dm({ nick: 'unseen', unread: 1 })],
    );
    const bySeen = new Map(rows.map((r) => [r.name, r.lastActive]));
    expect(bySeen.get('seen')).toBe(42_000);
    expect(bySeen.get('unseen')).toBe(0);
  });

  it('emits stable, kind-prefixed keys and correct targets', () => {
    const rows = summarizeCatchUp(
      [ch({ name: '#Root', unread: 1 })],
      [dm({ nick: 'Trev', unread: 1 })],
    );
    const chan = rows.find((r) => r.kind === 'channel')!;
    const conv = rows.find((r) => r.kind === 'dm')!;
    expect(chan.key).toBe('c:#root');
    expect(chan.target).toBe('#Root');
    expect(conv.key).toBe('d:trev');
    expect(conv.target).toBe('Trev');
  });

  it('caps the list at the requested limit, keeping the highest unread', () => {
    const rows = summarizeCatchUp(
      [
        ch({ name: '#a', unread: 1 }),
        ch({ name: '#b', unread: 9 }),
        ch({ name: '#c', unread: 5 }),
      ],
      [],
      new Map(),
      2,
    );
    expect(rows.map((r) => r.name)).toEqual(['#b', '#c']);
  });

  it('clamps negative highlights to zero', () => {
    const [row] = summarizeCatchUp([ch({ name: '#root', unread: 1, highlights: -3 })], []);
    expect(row!.highlights).toBe(0);
  });
});

describe('catchUpTotals', () => {
  it('sums rooms, unread, and mentions across the list', () => {
    const rows = summarizeCatchUp(
      [ch({ name: '#root', unread: 4, highlights: 2 }), ch({ name: '#zig', unread: 6 })],
      [dm({ nick: 'trev', unread: 3, highlights: 1 })],
    );
    expect(catchUpTotals(rows)).toEqual({ rooms: 3, unread: 13, mentions: 3 });
  });

  it('is all-zero for an empty list', () => {
    expect(catchUpTotals([])).toEqual({ rooms: 0, unread: 0, mentions: 0 });
  });
});
