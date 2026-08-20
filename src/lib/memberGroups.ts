// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * memberGroups — role resolution + identity-stable grouping for the member list.
 *
 * The store replaces `ch.users` with a fresh Map on every roster event
 * (join/part/mode/away), but preserves the object identity of every *untouched*
 * `ChannelUser` (it copies the map and only re-creates the one affected user).
 * The reconciler exploits that: it caches the derived `MemberEntry`/`GroupEntry`
 * objects by nick/role and returns the SAME reference for members whose
 * underlying user object hasn't changed. That lets Solid's reference-keyed
 * `<For>` patch a single row on a join/part instead of tearing down and
 * rebuilding every row (each row is a Popover with several effects) — turning an
 * O(members) rebuild per roster event into O(1) affected rows.
 */

import type { ChannelUser } from '@/lib/irc/types';

export type RoleKey =
  | 'netop'
  | 'founder'
  | 'owner'
  | 'admin'
  | 'op'
  | 'halfop'
  | 'voice'
  | 'member';

export interface ResolvedRole {
  key: RoleKey;
  label: string;
  symbol: string;
  sort: number;
}

export interface MemberEntry {
  user: ChannelUser;
  role: ResolvedRole;
}

export interface GroupEntry {
  key: RoleKey;
  label: string;
  members: MemberEntry[];
}

const ROLE_ORDER: Record<RoleKey, number> = {
  netop: 0,
  founder: 1,
  owner: 2,
  admin: 3,
  op: 4,
  halfop: 5,
  voice: 6,
  member: 7,
};

/** Rendered top-to-bottom in this order; also drives the sort within `groups`. */
const ROLE_SEQUENCE: readonly RoleKey[] = [
  'netop',
  'founder',
  'owner',
  'admin',
  'op',
  'halfop',
  'voice',
  'member',
];

export const GROUP_LABELS: Record<RoleKey, string> = {
  netop: 'Network Operators',
  founder: 'Founders',
  owner: 'Owners',
  admin: 'Admins',
  op: 'Ops',
  halfop: 'Half-ops',
  voice: 'Voice',
  member: 'Members',
};

function prefixFor(modeToPrefix: Record<string, string>, mode: string, fallback: string): string {
  return modeToPrefix[mode] || fallback;
}

interface NamedRole {
  key: RoleKey;
  label: string;
  fallbackSymbol: string;
}

/** The conventional named ladder, in fixed rank order (highest first). Used
 *  as-is when the learned PREFIX map has nothing to say about a user's modes,
 *  and to recover the label/key for a mode the learned map DOES recognise. */
const NAMED_ROLES: ReadonlyMap<string, NamedRole> = new Map([
  ['Y', { key: 'netop',   label: 'Network Oper', fallbackSymbol: '*' }],
  ['Q', { key: 'founder', label: 'Founder',      fallbackSymbol: '!' }],
  ['q', { key: 'owner',   label: 'Owner',        fallbackSymbol: '.' }],
  ['a', { key: 'admin',   label: 'Admin',        fallbackSymbol: '&' }],
  ['o', { key: 'op',      label: 'Op',           fallbackSymbol: '@' }],
  ['h', { key: 'halfop',  label: 'Half-op',      fallbackSymbol: '%' }],
  ['v', { key: 'voice',   label: 'Voice',        fallbackSymbol: '+' }],
]);

export function resolveRole(user: ChannelUser, modeToPrefix: Record<string, string>): ResolvedRole {
  const modes = user.modes;

  // Prefer the learned PREFIX's own declaration order: parsePREFIX
  // (irc/parser.ts) fills modeToPrefix in PREFIX order, and plain-object
  // string-key insertion order is preserved, so Object.keys(modeToPrefix)
  // IS the server's real rank order — including a non-standard letter a
  // fixed if-ladder would otherwise drop (e.g. PREFIX=(Xohv)!@%+). The first
  // of the user's modes to appear in that order is the highest-precedence
  // one, mirroring the old ladder's "check highest rank first" behavior.
  let i = 0;
  for (const mode of Object.keys(modeToPrefix)) {
    if (modes.has(mode)) {
      const named = NAMED_ROLES.get(mode);
      const symbol = prefixFor(modeToPrefix, mode, named?.fallbackSymbol ?? '');
      return named
        ? { key: named.key, label: named.label, symbol, sort: i }
        : { key: 'member', label: 'Member', symbol, sort: i };
    }
    i += 1;
  }

  // The learned map has nothing to say about this user's modes (empty
  // PREFIX, or none of their modes were ever declared) — fall back to the
  // named ladder in its conventional rank order, same as before.
  for (const [mode, named] of NAMED_ROLES) {
    if (modes.has(mode)) {
      return { key: named.key, label: named.label, symbol: prefixFor(modeToPrefix, mode, named.fallbackSymbol), sort: ROLE_ORDER[named.key] };
    }
  }
  return { key: 'member', label: 'Member', symbol: '', sort: ROLE_ORDER.member };
}

function sameRole(a: ResolvedRole, b: ResolvedRole): boolean {
  return a.key === b.key && a.symbol === b.symbol && a.label === b.label;
}

function sameRefs(a: readonly MemberEntry[], b: readonly MemberEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface GroupReconciler {
  /**
   * Derive sorted, grouped members from a channel's user map, reusing cached
   * entry/group objects wherever the underlying user object is unchanged so
   * reference-keyed rendering only rebuilds the rows that actually changed.
   */
  reconcile(users: ReadonlyMap<string, ChannelUser>, modeToPrefix: Record<string, string>): GroupEntry[];
}

export function createGroupReconciler(): GroupReconciler {
  // Keyed by the map key (lowercased nick) so lookups match the store's map.
  const entryCache = new Map<string, MemberEntry>();
  const groupCache = new Map<RoleKey, GroupEntry>();

  function reconcile(
    users: ReadonlyMap<string, ChannelUser>,
    modeToPrefix: Record<string, string>,
  ): GroupEntry[] {
    const entries: MemberEntry[] = [];

    for (const [key, user] of users) {
      const role = resolveRole(user, modeToPrefix);
      const prev = entryCache.get(key);
      // Reuse the cached entry only when the user object identity AND the
      // derived role are unchanged; otherwise the row genuinely needs a rebuild.
      const entry: MemberEntry =
        prev && prev.user === user && sameRole(prev.role, role) ? prev : { user, role };
      if (entry !== prev) entryCache.set(key, entry);
      entries.push(entry);
    }

    // Prune entries for users that left, so identity can't be wrongly reused if
    // the same nick rejoins with a new user object.
    if (entryCache.size !== users.size) {
      for (const key of [...entryCache.keys()]) {
        if (!users.has(key)) entryCache.delete(key);
      }
    }

    entries.sort((a, b) => {
      const roleDiff = a.role.sort - b.role.sort;
      if (roleDiff !== 0) return roleDiff;
      return a.user.nick.localeCompare(b.user.nick);
    });

    const grouped = new Map<RoleKey, MemberEntry[]>();
    for (const entry of entries) {
      const bucket = grouped.get(entry.role.key);
      if (bucket) bucket.push(entry);
      else grouped.set(entry.role.key, [entry]);
    }

    const result: GroupEntry[] = [];
    for (const key of ROLE_SEQUENCE) {
      const members = grouped.get(key);
      if (!members || members.length === 0) {
        groupCache.delete(key);
        continue;
      }
      const label = GROUP_LABELS[key];
      const prev = groupCache.get(key);
      // Reuse the cached group (and its members array) when every member entry
      // is reference-identical, so an untouched section never re-renders.
      const group: GroupEntry =
        prev && prev.label === label && sameRefs(prev.members, members) ? prev : { key, label, members };
      if (group !== prev) groupCache.set(key, group);
      result.push(group);
    }
    return result;
  }

  return { reconcile };
}
