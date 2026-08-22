// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * messagesInbox.ts — Messages collection order (recency, not nick alpha).
 *
 * Rooms stay on their own alpha/folder comparator. This helper is Messages
 * only: newest last-message / last-activity first. Nick compare is a
 * tie-break so equal timestamps stay stable, not the sort.
 */

export type MessagesInboxItem = {
  nick: string;
  lastSeen?: Date;
  messages?: ReadonlyArray<{ time: Date }>;
};

/** Latest finite last-message or lastSeen time; 0 when unknown. */
export function messagesInboxActivityMs(item: MessagesInboxItem): number {
  let latest = 0;
  const seen = item.lastSeen?.getTime();
  if (seen !== undefined && Number.isFinite(seen) && seen > latest) latest = seen;
  for (const message of item.messages ?? []) {
    const time = message.time.getTime();
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return latest;
}

/** Newer activity first; nick alpha only when recency ties. */
export function compareMessagesInboxRecency(
  a: MessagesInboxItem,
  b: MessagesInboxItem,
): number {
  const recency = messagesInboxActivityMs(b) - messagesInboxActivityMs(a);
  if (recency !== 0) return recency;
  return a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' });
}

/**
 * Copy + sort. Does not mutate `items`. Unread is not a rank key — badges
 * and paper weight stay presentation. Optional `closedNicks` drops rows
 * already closed by the leave/hide helper when that set exists.
 */
export function sortMessagesInbox<T extends MessagesInboxItem>(
  items: readonly T[],
  closedNicks?: ReadonlySet<string>,
): T[] {
  const visible = closedNicks
    ? items.filter((item) => !closedNicks.has(item.nick.toLowerCase()))
    : [...items];
  return visible.sort(compareMessagesInboxRecency);
}
