// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * digestStability — value-equality helpers for the Home time-driven digests.
 *
 * The Home surface shares one 30s clock signal (`nowMs`) so every relative-time
 * label stays current. But that clock is also a dependency of the *structural*
 * digest memos (scheduled events, quiet activity) because they filter by
 * visibility/age windows. With the default `Object.is` memo equality, each 30s
 * tick makes those memos emit a brand-new array of brand-new objects even when
 * the visible set is byte-for-byte identical — which tears down and rebuilds
 * every `<For>` row (and, for scheduled events, cascades into the room-rhythm
 * memo and its nested spark `<For>`s) purely to advance a countdown chip that
 * already updates on its own from `nowMs`.
 *
 * These comparators let each memo keep its previous array reference when the
 * tick changed nothing, so a no-op clock advance stops propagating. The
 * countdown/relative-time text still updates because it reads `nowMs()` inline
 * in JSX; only the wasted DOM churn is removed. When something real changes
 * (an event goes live, an item drops out of its window, a new one appears) the
 * comparator returns false and the update flows as before.
 */
import type { ScheduledEventItem } from './scheduledEvents';
import type { QuietActivityItem } from './quietActivity';
import type { CatchUpItem } from './catchUp';
import type { AwayDigest } from './awayDigest';

/** Positional list equality under a per-item comparator. Cheap short-circuits. */
export function listEqualsBy<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!eq(a[i]!, b[i]!)) return false;
  }
  return true;
}

/** Value-equality for a scheduled-event item (channel, time, title, live flag). */
export function scheduledEventItemEqual(a: ScheduledEventItem, b: ScheduledEventItem): boolean {
  return (
    a.channel === b.channel &&
    a.at === b.at &&
    a.title === b.title &&
    a.live === b.live
  );
}

/** Value-equality for a quiet-activity item (name, topic, last-activity ms). */
export function quietActivityItemEqual(a: QuietActivityItem, b: QuietActivityItem): boolean {
  return a.name === b.name && a.topic === b.topic && a.lastActivity === b.lastActivity;
}

/** `createMemo` equality for the scheduled-events list. */
export function scheduledEventsListEqual(
  a: readonly ScheduledEventItem[],
  b: readonly ScheduledEventItem[],
): boolean {
  return listEqualsBy(a, b, scheduledEventItemEqual);
}

/** `createMemo` equality for the quiet-activity list. */
export function quietActivityListEqual(
  a: readonly QuietActivityItem[],
  b: readonly QuietActivityItem[],
): boolean {
  return listEqualsBy(a, b, quietActivityItemEqual);
}

/**
 * Value-equality for one catch-up row across the fields the digest renders.
 * `key` encodes the lowercased name + kind prefix (`c:`/`d:`) in every current
 * builder, so name/target/kind identity is covered transitively via `key`.
 */
export function catchUpItemEqual(a: CatchUpItem, b: CatchUpItem): boolean {
  return (
    a.key === b.key &&
    a.unread === b.unread &&
    a.highlights === b.highlights &&
    a.followed === b.followed &&
    a.lastActivity === b.lastActivity
  );
}

/**
 * `createMemo` equality for the tiered away digest. Keeps the previous digest
 * reference (and every `<For>` tier below it) stable when a 30s clock tick
 * changes only relative-time labels and not the unread/tier shape.
 */
export function awayDigestEqual(a: AwayDigest, b: AwayDigest): boolean {
  return (
    a.empty === b.empty &&
    a.totalUnread === b.totalUnread &&
    a.totalMentions === b.totalMentions &&
    listEqualsBy(a.attention, b.attention, catchUpItemEqual) &&
    listEqualsBy(a.followed, b.followed, catchUpItemEqual) &&
    listEqualsBy(a.quiet, b.quiet, catchUpItemEqual)
  );
}
