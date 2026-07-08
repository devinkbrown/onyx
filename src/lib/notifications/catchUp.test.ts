import { describe, expect, test } from 'vitest';
import { buildCatchUp, catchUpSummary } from './catchUp';

const ch = (name: string, unread: number, highlights = 0) => ({ name, unread, highlights });
const dm = (nick: string, unread: number, highlights = 0, lastSeen?: Date) => ({
  nick,
  unread,
  highlights,
  lastSeen,
});

describe('buildCatchUp', () => {
  test('only includes targets with unread or a highlight', () => {
    const out = buildCatchUp(
      [ch('#a', 0, 0), ch('#b', 3, 0), ch('#c', 0, 1)],
      [dm('bob', 0, 0), dm('sue', 2, 0)],
      new Map(),
    );
    expect(out.map((i) => i.target).sort()).toEqual(['#b', '#c', 'sue']);
  });

  test('DMs and mentioned channels rank above plain-unread channels', () => {
    const out = buildCatchUp(
      [ch('#chatter', 50, 0), ch('#mentioned', 1, 1)],
      [dm('alice', 1, 0)],
      new Map([['#chatter', 9999]]), // most recent, but no personal signal
    );
    // both #mentioned and alice are "priority"; #chatter (highest unread, most
    // recent) is deprioritised because nothing there was addressed to you.
    expect(out[out.length - 1]?.target).toBe('#chatter');
    expect(out.slice(0, 2).map((i) => i.target).sort()).toEqual(['#mentioned', 'alice']);
  });

  test('within the same priority, most-recent activity wins', () => {
    const out = buildCatchUp(
      [ch('#old', 1, 1), ch('#new', 1, 1)],
      [],
      new Map([
        ['#old', 1000],
        ['#new', 5000],
      ]),
    );
    expect(out.map((i) => i.target)).toEqual(['#new', '#old']);
  });

  test('caps the list at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ch(`#c${i}`, 1, 0));
    expect(buildCatchUp(many, [], new Map(), 5)).toHaveLength(5);
  });

  test('DM lastSeen feeds recency; missing activity sorts last', () => {
    const out = buildCatchUp(
      [ch('#nostamp', 2, 2)],
      [dm('recent', 1, 1, new Date(10_000))],
      new Map(), // #nostamp has no lastActivity → 0
    );
    expect(out[0]?.target).toBe('recent');
  });
});

describe('catchUpSummary', () => {
  test('sums unread and mentions', () => {
    const items = buildCatchUp(
      [ch('#a', 3, 1), ch('#b', 2, 0)],
      [dm('x', 4, 1)],
      new Map(),
    );
    expect(catchUpSummary(items)).toEqual({ unread: 9, mentions: 2 });
  });

  test('empty list is zero', () => {
    expect(catchUpSummary([])).toEqual({ unread: 0, mentions: 0 });
  });
});
