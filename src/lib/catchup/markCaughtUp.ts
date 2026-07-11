// SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
// "Mark all caught up" plan — the set of targets whose read-state should advance.
//
// A pure, DOM-free companion to `catchup/summary.ts`: instead of ranking rooms
// for display, it enumerates exactly which channels + DMs still carry unread
// activity, so a single "Mark all caught up" affordance can advance read-state
// through the store's per-target `markRead` action. Ordering is deterministic
// (mentions first, then most-unread, then name A→Z) so the affordance's count,
// its announce text, and its tests are all stable given the same input.
//
// This module decides WHICH targets to mark and reports the totals; it never
// touches the store — the component drives `markRead(target)` for each planned
// target. Fully unit-tested, no store, no Date.now().
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal channel shape (structurally satisfied by the store `Channel`). */
export interface CaughtUpChannelLike {
  name: string;
  unread: number;
  highlights: number;
}

/** Minimal DM shape (structurally satisfied by the store `DMConversation`). */
export interface CaughtUpDmLike {
  nick: string;
  unread: number;
  highlights: number;
}

export interface CaughtUpTarget {
  kind: 'channel' | 'dm';
  /** The `markRead`/navigation target: the channel name or the DM nick. */
  target: string;
  unread: number;
  highlights: number;
}

export interface CaughtUpPlan {
  /** Targets to advance, in a stable, deterministic order. */
  targets: CaughtUpTarget[];
  /** Number of rooms (channels + DMs) with unread activity. */
  rooms: number;
  /** Total unread messages that would be cleared. */
  unread: number;
  /** Total mentions/highlights that would be cleared. */
  mentions: number;
}

function hasUnread(unread: number, highlights: number): boolean {
  // A room counts as "to catch up on" if it has either unread messages OR
  // unread highlights — matching the buildCatchUp inclusion rule so the button
  // clears exactly the rooms the catch-up list surfaces.
  return unread > 0 || highlights > 0;
}

function compareTargets(a: CaughtUpTarget, b: CaughtUpTarget): number {
  // Deterministic: mentions first (what matters most), then most unread, then
  // name A→Z. Independent of iteration order so the plan is reproducible.
  return (
    b.highlights - a.highlights ||
    b.unread - a.unread ||
    a.target.toLowerCase().localeCompare(b.target.toLowerCase())
  );
}

/**
 * Enumerate every joined channel + DM that still has unread activity, with the
 * running totals. The returned `targets` are ordered deterministically and are
 * exactly the values to pass to the store's `markRead` action.
 */
export function planCatchUpAll(
  channels: Iterable<CaughtUpChannelLike>,
  dms: Iterable<CaughtUpDmLike>,
): CaughtUpPlan {
  const targets: CaughtUpTarget[] = [];
  let unread = 0;
  let mentions = 0;

  for (const ch of channels) {
    if (!hasUnread(ch.unread, ch.highlights)) continue;
    const highlights = Math.max(0, ch.highlights);
    targets.push({ kind: 'channel', target: ch.name, unread: Math.max(0, ch.unread), highlights });
    unread += Math.max(0, ch.unread);
    mentions += highlights;
  }

  for (const dm of dms) {
    if (!hasUnread(dm.unread, dm.highlights)) continue;
    const highlights = Math.max(0, dm.highlights);
    targets.push({ kind: 'dm', target: dm.nick, unread: Math.max(0, dm.unread), highlights });
    unread += Math.max(0, dm.unread);
    mentions += highlights;
  }

  targets.sort(compareTargets);
  return { targets, rooms: targets.length, unread, mentions };
}

/** Human-readable announce string for a completed "mark all caught up". */
export function caughtUpAnnounce(plan: CaughtUpPlan): string {
  if (plan.rooms === 0) return 'Already all caught up.';
  const roomLabel = plan.rooms === 1 ? 'room' : 'rooms';
  const mentionSuffix =
    plan.mentions > 0
      ? `, clearing ${plan.mentions} ${plan.mentions === 1 ? 'mention' : 'mentions'}`
      : '';
  return `Marked ${plan.rooms} ${roomLabel} as caught up${mentionSuffix}.`;
}
