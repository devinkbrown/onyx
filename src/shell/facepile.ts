// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * facepile.ts — PURE selection logic for the room-header facepile.
 *
 * "Presence-as-place" (roadmap v1.1 Sumi-e): the conversation ribbon shows a
 * small overlapping stack of the people most worth surfacing in the room, plus
 * a "+M" overflow count. This module decides *who* and *how many* — it is
 * deterministic, DOM-free, and unit-testable in isolation.
 *
 * Priority (highest first), applied as a stable layered sort:
 *   1. Role rank        — netop > founder > owner > admin > op > halfop > voice > member
 *                         (ops/voiced surface first).
 *   2. Presence         — people who are here (not away) before away members,
 *                         within the same role tier.
 *   3. Recent activity  — more-recently-active first, when `lastActiveAt` is
 *                         supplied (higher epoch-ms wins).
 *   4. Nick             — case-insensitive alphabetical, as a fully
 *                         deterministic final tiebreak.
 *
 * Members are deduped by case-insensitive nick (first occurrence wins) before
 * sorting, then the visible list is capped at `cap` (default 5). Everyone beyond
 * the cap becomes the overflow count.
 */

import type { ChannelUser } from '@/lib/irc/types';

// ── Role model ────────────────────────────────────────────────────────────────

export type FacepileRoleKey =
  | 'netop'
  | 'founder'
  | 'owner'
  | 'admin'
  | 'op'
  | 'halfop'
  | 'voice'
  | 'member';

/** Mode letter → role key, in descending precedence. */
const ROLE_BY_MODE: ReadonlyArray<readonly [string, FacepileRoleKey]> = [
  ['Y', 'netop'],
  ['Q', 'founder'],
  ['q', 'owner'],
  ['a', 'admin'],
  ['o', 'op'],
  ['h', 'halfop'],
  ['v', 'voice'],
];

const ROLE_RANK: Record<FacepileRoleKey, number> = {
  netop: 0,
  founder: 1,
  owner: 2,
  admin: 3,
  op: 4,
  halfop: 5,
  voice: 6,
  member: 7,
};

/** Default number of avatars shown before overflow collapses the rest. */
export const DEFAULT_FACEPILE_CAP = 5;

// ── Public shapes ─────────────────────────────────────────────────────────────

/**
 * Minimal member shape the facepile needs. `ChannelUser` satisfies this
 * structurally, but tests (and non-store callers) can pass plain objects.
 */
export interface FacepileMemberInput {
  nick: string;
  /** status modes held (e.g. {'o','v'}); precedence Y > Q > q > a > o > h > v. */
  modes: ReadonlySet<string>;
  away?: boolean;
  /** epoch-ms of last activity; higher = more recent. Optional. */
  lastActiveAt?: number;
}

export interface FacepileEntry {
  nick: string;
  /** highest-precedence role the member holds. */
  role: FacepileRoleKey;
  away: boolean;
  /** founder/owner → owner ring on the avatar. */
  owner: boolean;
}

export interface FacepileOptions {
  /** Maximum avatars to show before overflow. Defaults to {@link DEFAULT_FACEPILE_CAP}. */
  cap?: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveRole(modes: ReadonlySet<string>): FacepileRoleKey {
  for (const [mode, key] of ROLE_BY_MODE) {
    if (modes.has(mode)) return key;
  }
  return 'member';
}

function toEntry(member: FacepileMemberInput): FacepileEntry {
  const role = resolveRole(member.modes);
  return {
    nick: member.nick,
    role,
    away: member.away === true,
    owner: role === 'founder' || role === 'owner',
  };
}

/** Dedupe by case-insensitive nick, preserving iteration order (first wins). */
function dedupe(members: Iterable<FacepileMemberInput>): FacepileMemberInput[] {
  const seen = new Set<string>();
  const result: FacepileMemberInput[] = [];
  for (const member of members) {
    const key = member.nick.trim().toLowerCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(member);
  }
  return result;
}

function compare(a: FacepileMemberInput, b: FacepileMemberInput): number {
  // 1. Role rank.
  const rankDiff = ROLE_RANK[resolveRole(a.modes)] - ROLE_RANK[resolveRole(b.modes)];
  if (rankDiff !== 0) return rankDiff;

  // 2. Presence — present before away.
  const awayDiff = Number(a.away === true) - Number(b.away === true);
  if (awayDiff !== 0) return awayDiff;

  // 3. Recent activity — more recent first (missing sorts as oldest). Compared
  // by inequality, not subtraction, so two missing values don't yield NaN.
  const aRecent = a.lastActiveAt ?? Number.NEGATIVE_INFINITY;
  const bRecent = b.lastActiveAt ?? Number.NEGATIVE_INFINITY;
  if (aRecent !== bRecent) return bRecent - aRecent;

  // 4. Nick — case-insensitive, then raw, for total determinism.
  const ci = a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' });
  if (ci !== 0) return ci;
  return a.nick < b.nick ? -1 : a.nick > b.nick ? 1 : 0;
}

function normalizeCap(cap: number | undefined): number {
  if (cap === undefined || !Number.isFinite(cap)) return DEFAULT_FACEPILE_CAP;
  return Math.max(0, Math.floor(cap));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * The full facepile result: the visible (deduped, prioritized, capped) entries,
 * the total unique members considered, and how many are hidden by the cap.
 */
export interface Facepile {
  entries: FacepileEntry[];
  /** unique member count after dedupe. */
  total: number;
  /** members hidden beyond the cap (the "+M"). */
  overflow: number;
}

/**
 * Build the complete facepile from a member collection. Deterministic and pure.
 */
export function buildFacepile(
  members: Iterable<FacepileMemberInput>,
  opts: FacepileOptions = {},
): Facepile {
  const cap = normalizeCap(opts.cap);
  const unique = dedupe(members);
  const sorted = [...unique].sort(compare);
  const visible = sorted.slice(0, cap);
  return {
    entries: visible.map(toEntry),
    total: unique.length,
    overflow: Math.max(0, unique.length - visible.length),
  };
}

/**
 * The prioritized, deduped, capped list of members to show as avatars.
 * (Overflow count is available via {@link buildFacepile}.)
 */
export function pickFacepileMembers(
  members: Iterable<FacepileMemberInput>,
  opts: FacepileOptions = {},
): FacepileEntry[] {
  return buildFacepile(members, opts).entries;
}

/**
 * Adapt the store's channel user map (or any `ChannelUser` iterable) into the
 * facepile member inputs. `ChannelUser` is already structurally compatible;
 * this exists as a named, typed seam for the component.
 */
export function facepileInputsFromUsers(
  users: Iterable<ChannelUser>,
): FacepileMemberInput[] {
  const result: FacepileMemberInput[] = [];
  for (const user of users) {
    result.push({ nick: user.nick, modes: user.modes, away: user.away });
  }
  return result;
}
