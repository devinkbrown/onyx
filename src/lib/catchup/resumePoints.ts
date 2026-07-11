// SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
// Resume points — "drop me back exactly where I left off".
//
// Home already RANKS what you missed (notifications/catchUp.ts: mentions/DMs
// first, then followed, then ambient, by recency). This module takes that ranked
// list and attaches, per target, the AUTHORITATIVE read boundary — the store's
// `firstUnreadId` (the first message you haven't seen, the same cursor that
// draws the UnreadDivider). A resume point therefore deep-links to the *exact*
// first-unread message, not to the start of a heuristic "last N" window: the
// resume boundary IS the last-read cursor.
//
// A target only becomes a resume point when it actually has a boundary to resume
// at (a non-null `firstUnreadId`). No boundary ⇒ nothing to "resume", so it is
// dropped — the surface never offers a jump that would land in the wrong place.
//
// Pure + unit-tested: no store, no Date.now(); deterministic given its inputs.
// The ranking is inherited unchanged from buildCatchUp, so the tiers stay
// mentions > DMs > followed > ambient, recency-broken.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatchUpItem } from '@/lib/notifications/catchUp';

/** Which relevance bucket a resume point fell into (for labels + styling). */
export type ResumeTier = 'mention' | 'dm' | 'followed' | 'active';

export interface ResumePoint {
  /** Stable key for keyed <For> rendering. */
  key: string;
  kind: 'channel' | 'dm';
  /** Display label: '#channel' or a nick. */
  name: string;
  /** Navigation target: the channel name or the DM nick. */
  target: string;
  /**
   * Authoritative first-unread message id — the exact place to land. Guaranteed
   * non-empty: a point is only produced when the store has a real boundary.
   */
  boundaryId: string;
  /** Unread message count behind the boundary. */
  unread: number;
  /** Messages that mention you. */
  highlights: number;
  /** Conversation is locally followed. */
  followed: boolean;
  /** Relevance bucket, highest-first when sorted. */
  tier: ResumeTier;
  /** Last activity, unix ms; 0 when unknown. */
  lastActivity: number;
}

const DEFAULT_LIMIT = 6;

/** Relevance bucket for a ranked catch-up item. Mention wins over everything. */
function tierOf(item: CatchUpItem): ResumeTier {
  if (item.highlights > 0) return 'mention';
  if (item.kind === 'dm') return 'dm';
  if (item.followed) return 'followed';
  return 'active';
}

/**
 * Attach the authoritative read boundary to each already-ranked catch-up item,
 * keeping only targets that have a real `firstUnreadId` to resume at. Order is
 * inherited from `items` (buildCatchUp: mentions/DMs first, then followed, then
 * ambient, recency-broken), so a resume point's rank matches its catch-up rank.
 *
 * `firstUnreadId` is the store's map keyed by lowercased target; a null/absent
 * entry means "no unseen boundary" and the target is dropped.
 */
export function buildResumePoints(
  items: readonly CatchUpItem[],
  firstUnreadId: ReadonlyMap<string, string | null>,
  limit: number = DEFAULT_LIMIT,
): ResumePoint[] {
  const points: ResumePoint[] = [];

  for (const item of items) {
    const boundaryId = firstUnreadId.get(item.target.toLowerCase());
    // Only resume where there is a genuine boundary to land on.
    if (!boundaryId) continue;

    points.push({
      key: item.key,
      kind: item.kind,
      name: item.name,
      target: item.target,
      boundaryId,
      unread: item.unread,
      highlights: item.highlights,
      followed: item.followed,
      tier: tierOf(item),
      lastActivity: item.lastActivity,
    });
  }

  // Same slice idiom as summary.ts: negative limit means "uncapped".
  return limit >= 0 ? points.slice(0, limit) : points;
}
