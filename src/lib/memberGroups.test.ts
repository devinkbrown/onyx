// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { createGroupReconciler, resolveRole, type MemberEntry, type GroupEntry } from './memberGroups';
import type { ChannelUser } from '@/lib/irc/types';

const PREFIX: Record<string, string> = { Y: '*', Q: '!', q: '.', o: '@', h: '%', v: '+' };

function user(nick: string, modes = '', away = false): ChannelUser {
  return { nick, modes: new Set(modes.split('').filter(Boolean)), away };
}

/** Build the store-shape user map (keyed by lowercased nick). */
function toMap(...users: ChannelUser[]): Map<string, ChannelUser> {
  return new Map(users.map((u) => [u.nick.toLowerCase(), u]));
}

/** Mirror the store's immutable update: fresh map, only the named user replaced. */
function patchMap(
  prev: ReadonlyMap<string, ChannelUser>,
  nick: string,
  change: Partial<ChannelUser>,
): Map<string, ChannelUser> {
  const next = new Map(prev);
  const key = nick.toLowerCase();
  const existing = next.get(key);
  if (existing) next.set(key, { ...existing, ...change });
  return next;
}

function flat(groups: GroupEntry[]): MemberEntry[] {
  return groups.flatMap((g) => g.members);
}

function entryFor(groups: GroupEntry[], nick: string): MemberEntry | undefined {
  return flat(groups).find((e) => e.user.nick === nick);
}

describe('resolveRole', () => {
  it('picks the highest-precedence mode and its prefix symbol', () => {
    expect(resolveRole(user('a', 'ov'), PREFIX).key).toBe('op');
    expect(resolveRole(user('a', 'Yo'), PREFIX)).toMatchObject({ key: 'netop', symbol: '*' });
    expect(resolveRole(user('a', ''), PREFIX)).toMatchObject({ key: 'member', symbol: '', sort: 7 });
  });

  it('falls back to a default symbol when the prefix map lacks the mode', () => {
    expect(resolveRole(user('a', 'v'), {}).symbol).toBe('+');
  });
});

describe('createGroupReconciler — grouping & sorting', () => {
  it('sorts by role precedence then alphabetically within a group', () => {
    const r = createGroupReconciler();
    const groups = r.reconcile(
      toMap(user('zoe', 'o'), user('amy', 'o'), user('bob'), user('cal', 'v')),
      PREFIX,
    );
    expect(groups.map((g) => g.key)).toEqual(['op', 'voice', 'member']);
    expect(groups[0]?.members.map((m) => m.user.nick)).toEqual(['amy', 'zoe']);
    expect(groups.find((g) => g.key === 'member')?.members.map((m) => m.user.nick)).toEqual(['bob']);
  });
});

describe('createGroupReconciler — identity stability', () => {
  it('returns identical entry and group references when the map is unchanged', () => {
    const r = createGroupReconciler();
    const map = toMap(user('amy', 'o'), user('bob'), user('cal', 'v'));
    const first = r.reconcile(map, PREFIX);
    const second = r.reconcile(map, PREFIX);

    // Every group object is reused (no section re-render).
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i += 1) {
      expect(second[i]).toBe(first[i]);
      expect(second[i]?.members).toBe(first[i]?.members);
    }
    // Every entry object is reused (no row re-render).
    for (const e of flat(first)) {
      expect(entryFor(second, e.user.nick)).toBe(e);
    }
  });

  it('rebuilds only the affected row when one member toggles away', () => {
    const r = createGroupReconciler();
    const map = toMap(user('amy', 'o'), user('bob'), user('cal', 'v'));
    const before = r.reconcile(map, PREFIX);

    // Store-shape update: only bob's user object is replaced.
    const after = r.reconcile(patchMap(map, 'bob', { away: true }), PREFIX);

    // Unaffected members keep their exact entry reference.
    expect(entryFor(after, 'amy')).toBe(entryFor(before, 'amy'));
    expect(entryFor(after, 'cal')).toBe(entryFor(before, 'cal'));
    // The toggled member's entry is a fresh object carrying the new state.
    expect(entryFor(after, 'bob')).not.toBe(entryFor(before, 'bob'));
    expect(entryFor(after, 'bob')?.user.away).toBe(true);

    // The op and voice groups are untouched → same group + array reference.
    const opBefore = before.find((g) => g.key === 'op');
    const opAfter = after.find((g) => g.key === 'op');
    expect(opAfter).toBe(opBefore);
    const voiceBefore = before.find((g) => g.key === 'voice');
    const voiceAfter = after.find((g) => g.key === 'voice');
    expect(voiceAfter).toBe(voiceBefore);
    // The member group (bob) got a new array because its contents changed.
    const memBefore = before.find((g) => g.key === 'member');
    const memAfter = after.find((g) => g.key === 'member');
    expect(memAfter).not.toBe(memBefore);
  });

  it('keeps existing rows stable when a new member joins', () => {
    const r = createGroupReconciler();
    const map = toMap(user('amy', 'o'), user('bob'));
    const before = r.reconcile(map, PREFIX);

    const joined = new Map(map);
    joined.set('cal', user('cal'));
    const after = r.reconcile(joined, PREFIX);

    expect(entryFor(after, 'amy')).toBe(entryFor(before, 'amy'));
    expect(entryFor(after, 'bob')).toBe(entryFor(before, 'bob'));
    expect(entryFor(after, 'cal')).toBeDefined();
    // The op group has no new members → reused; the member group changed.
    expect(after.find((g) => g.key === 'op')).toBe(before.find((g) => g.key === 'op'));
  });

  it('rebuilds the row when a member gains a mode', () => {
    const r = createGroupReconciler();
    const map = toMap(user('amy'), user('bob'));
    const before = r.reconcile(map, PREFIX);

    // bob is opped: store replaces bob with a new modes set.
    const opped = patchMap(map, 'bob', { modes: new Set(['o']) });
    const after = r.reconcile(opped, PREFIX);

    expect(entryFor(after, 'amy')).toBe(entryFor(before, 'amy'));
    expect(entryFor(after, 'bob')?.role.key).toBe('op');
    expect(after.map((g) => g.key)).toEqual(['op', 'member']);
  });

  it('prunes a departed member and does not resurrect its stale identity on rejoin', () => {
    const r = createGroupReconciler();
    const map = toMap(user('amy', 'o'), user('bob'));
    const before = r.reconcile(map, PREFIX);
    const bobBefore = entryFor(before, 'bob');

    const parted = new Map(map);
    parted.delete('bob');
    r.reconcile(parted, PREFIX);

    // bob rejoins with a brand-new user object.
    const rejoined = new Map(parted);
    rejoined.set('bob', user('bob'));
    const after = r.reconcile(rejoined, PREFIX);

    expect(entryFor(after, 'bob')).not.toBe(bobBefore);
    expect(entryFor(after, 'amy')).toBe(entryFor(before, 'amy'));
  });
});
