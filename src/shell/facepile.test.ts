import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FACEPILE_CAP,
  buildFacepile,
  facepileInputsFromUsers,
  pickFacepileMembers,
  type FacepileMemberInput,
} from './facepile';
import type { ChannelUser } from '@/lib/irc/types';

function member(
  nick: string,
  modes: string[] = [],
  extra: Partial<FacepileMemberInput> = {},
): FacepileMemberInput {
  return { nick, modes: new Set(modes), ...extra };
}

describe('pickFacepileMembers', () => {
  it('returns an empty list for no members', () => {
    expect(pickFacepileMembers([])).toEqual([]);
  });

  it('returns the single member', () => {
    const entries = pickFacepileMembers([member('solo')]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.nick).toBe('solo');
    expect(entries[0]!.role).toBe('member');
    expect(entries[0]!.away).toBe(false);
    expect(entries[0]!.owner).toBe(false);
  });

  it('shows exactly N without overflow when count equals the cap', () => {
    const members = ['a', 'b', 'c'].map((n) => member(n));
    const result = buildFacepile(members, { cap: 3 });
    expect(result.entries).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.overflow).toBe(0);
  });

  it('caps the visible list and reports the overflow count when over N', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => member(n));
    const result = buildFacepile(members, { cap: 5 });
    expect(result.entries).toHaveLength(5);
    expect(result.total).toBe(7);
    expect(result.overflow).toBe(2);
  });

  it('defaults the cap to DEFAULT_FACEPILE_CAP', () => {
    const members = Array.from({ length: 8 }, (_, i) => member(`u${i}`));
    const result = buildFacepile(members);
    expect(result.entries).toHaveLength(DEFAULT_FACEPILE_CAP);
    expect(result.overflow).toBe(8 - DEFAULT_FACEPILE_CAP);
  });

  it('orders by role precedence: netop > founder > owner > op > voice > member', () => {
    const members = [
      member('plain'),
      member('voiced', ['v']),
      member('oper', ['o']),
      member('boss', ['Q']),
      member('netop', ['Y']),
      member('own', ['q']),
    ];
    const order = pickFacepileMembers(members, { cap: 6 }).map((e) => e.nick);
    expect(order).toEqual(['netop', 'boss', 'own', 'oper', 'voiced', 'plain']);
  });

  it('picks the highest-precedence role when a member holds several modes', () => {
    const entry = pickFacepileMembers([member('multi', ['v', 'o', 'q'])])[0]!;
    expect(entry.role).toBe('owner');
    expect(entry.owner).toBe(true);
  });

  it('marks founders and owners as owner for the avatar ring, but not ops', () => {
    const entries = pickFacepileMembers(
      [member('f', ['Q']), member('o', ['q']), member('op', ['o'])],
      { cap: 3 },
    );
    const byNick = new Map(entries.map((e) => [e.nick, e]));
    expect(byNick.get('f')!.owner).toBe(true);
    expect(byNick.get('o')!.owner).toBe(true);
    expect(byNick.get('op')!.owner).toBe(false);
  });

  it('sorts present members ahead of away members within a role tier', () => {
    const members = [
      member('zara', ['o'], { away: true }),
      member('amos', ['o'], { away: false }),
    ];
    const order = pickFacepileMembers(members).map((e) => e.nick);
    // Both are ops; present (amos) precedes away (zara) despite alpha order.
    expect(order).toEqual(['amos', 'zara']);
  });

  it('keeps a high-role away member ahead of a low-role present member', () => {
    const members = [
      member('lurker', [], { away: false }),
      member('awayop', ['o'], { away: true }),
    ];
    const order = pickFacepileMembers(members).map((e) => e.nick);
    expect(order).toEqual(['awayop', 'lurker']);
  });

  it('breaks ties by recent activity, most-recent first', () => {
    const members = [
      member('old', [], { lastActiveAt: 100 }),
      member('fresh', [], { lastActiveAt: 900 }),
      member('mid', [], { lastActiveAt: 500 }),
    ];
    const order = pickFacepileMembers(members).map((e) => e.nick);
    expect(order).toEqual(['fresh', 'mid', 'old']);
  });

  it('falls back to case-insensitive alphabetical order as the final tiebreak', () => {
    const members = [member('Charlie'), member('alice'), member('Bob')];
    const order = pickFacepileMembers(members).map((e) => e.nick);
    expect(order).toEqual(['alice', 'Bob', 'Charlie']);
  });

  it('dedupes by case-insensitive nick, first occurrence wins', () => {
    const members = [member('Nova', ['o']), member('nova', ['v']), member('other')];
    const result = buildFacepile(members);
    expect(result.total).toBe(2);
    const novas = result.entries.filter((e) => e.nick.toLowerCase() === 'nova');
    expect(novas).toHaveLength(1);
    // First occurrence (op) is the one retained.
    expect(novas[0]!.role).toBe('op');
  });

  it('ignores blank nicks', () => {
    const result = buildFacepile([member('   '), member('real')]);
    expect(result.total).toBe(1);
    expect(result.entries[0]!.nick).toBe('real');
  });

  it('treats a zero cap as all-overflow', () => {
    const result = buildFacepile([member('a'), member('b')], { cap: 0 });
    expect(result.entries).toHaveLength(0);
    expect(result.overflow).toBe(2);
  });

  it('never mutates the input collection', () => {
    const members = [member('b'), member('a')];
    const snapshot = members.map((m) => m.nick);
    pickFacepileMembers(members);
    expect(members.map((m) => m.nick)).toEqual(snapshot);
  });
});

describe('facepileInputsFromUsers', () => {
  it('maps ChannelUser records into facepile inputs', () => {
    const users: ChannelUser[] = [
      { nick: 'ada', modes: new Set(['o']), away: false },
      { nick: 'bo', modes: new Set(), away: true, account: 'bo' },
    ];
    const inputs = facepileInputsFromUsers(users);
    expect(inputs).toEqual([
      { nick: 'ada', modes: users[0]!.modes, away: false },
      { nick: 'bo', modes: users[1]!.modes, away: true },
    ]);
    // And the result flows through the picker unchanged in identity of nicks.
    expect(pickFacepileMembers(inputs).map((e) => e.nick)).toEqual(['ada', 'bo']);
  });
});
