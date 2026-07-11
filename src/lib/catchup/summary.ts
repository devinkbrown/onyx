// SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
// Catch-up summary — "where is my unread activity, most first".
//
// A pure, DOM-free ranking of the store's per-target unread/mention counters
// sorted by UNREAD COUNT (descending) so the busiest rooms surface first. This
// is deliberately a different lens from `notifications/catchUp.ts` (which ranks
// by priority — DMs/mentions first — then recency): this module answers "which
// rooms have the most to catch up on", the priority module answers "what should
// I look at first". The component just renders the result.
//
// Pure + unit-tested: no store, no Date.now(), fully deterministic given inputs.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal channel shape (structurally satisfied by the store `Channel`). */
export interface CatchUpChannelLike {
  name: string;
  unread: number;
  highlights: number;
}

/** Minimal DM shape (structurally satisfied by the store `DMConversation`). */
export interface CatchUpDmLike {
  nick: string;
  unread: number;
  highlights: number;
  lastSeen?: Date;
}

export interface CatchUpRow {
  /** Stable key for keyed <For> rendering. */
  key: string;
  kind: 'channel' | 'dm';
  /** Display label: '#channel' or a nick. */
  name: string;
  /** Navigation target: the channel name or the DM nick. */
  target: string;
  /** Unread message count — the primary sort signal. */
  unread: number;
  /** Messages that mention you (channel highlights / DM pings). */
  highlights: number;
  /** Last activity, unix ms; 0 when unknown. */
  lastActive: number;
}

export interface CatchUpTotals {
  /** Number of rooms with unread activity. */
  rooms: number;
  /** Total unread across every room. */
  unread: number;
  /** Total mentions/highlights across every room. */
  mentions: number;
}

const DEFAULT_LIMIT = 8;

function compareRows(a: CatchUpRow, b: CatchUpRow): number {
  // Primary: most unread first. Ties broken deterministically so ordering is
  // stable across renders: more mentions, then more recent, then name A→Z.
  return (
    b.unread - a.unread ||
    b.highlights - a.highlights ||
    b.lastActive - a.lastActive ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
}

/**
 * Build the unread-ranked catch-up list from joined channels + DMs. Only
 * targets with unread messages appear, sorted by unread count (desc) and capped
 * at `limit`. `channelLastActivity` is keyed by lowercased channel name (the
 * store's `channelLastActivity` map); DM recency comes from `lastSeen`.
 */
export function summarizeCatchUp(
  channels: Iterable<CatchUpChannelLike>,
  dms: Iterable<CatchUpDmLike>,
  channelLastActivity: ReadonlyMap<string, number> = new Map(),
  limit: number = DEFAULT_LIMIT,
): CatchUpRow[] {
  const rows: CatchUpRow[] = [];

  for (const ch of channels) {
    if (ch.unread <= 0) continue;
    rows.push({
      key: `c:${ch.name.toLowerCase()}`,
      kind: 'channel',
      name: ch.name,
      target: ch.name,
      unread: ch.unread,
      highlights: Math.max(0, ch.highlights),
      lastActive: channelLastActivity.get(ch.name.toLowerCase()) ?? 0,
    });
  }

  for (const dm of dms) {
    if (dm.unread <= 0) continue;
    rows.push({
      key: `d:${dm.nick.toLowerCase()}`,
      kind: 'dm',
      name: dm.nick,
      target: dm.nick,
      unread: dm.unread,
      highlights: Math.max(0, dm.highlights),
      lastActive: dm.lastSeen ? dm.lastSeen.getTime() : 0,
    });
  }

  rows.sort(compareRows);
  return limit >= 0 ? rows.slice(0, limit) : rows;
}

/** Aggregate unread + mention totals across a catch-up list. */
export function catchUpTotals(rows: readonly CatchUpRow[]): CatchUpTotals {
  return rows.reduce<CatchUpTotals>(
    (acc, r) => ({
      rooms: acc.rooms + 1,
      unread: acc.unread + r.unread,
      mentions: acc.mentions + r.highlights,
    }),
    { rooms: 0, unread: 0, mentions: 0 },
  );
}
