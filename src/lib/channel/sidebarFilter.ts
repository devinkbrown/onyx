// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sidebarFilter.ts — pure filter for channel/DM sidebar lists.
 *
 * Case-insensitive substring match on channel names and DM nicks.
 * Optional unread-only attention filter. Empty query passes everything through.
 */

export function normalizeSidebarQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when `name` matches the normalized query (empty query matches all). */
export function matchesSidebarQuery(name: string, query: string): boolean {
  const q = normalizeSidebarQuery(query);
  if (q.length === 0) return true;
  return name.toLowerCase().includes(q);
}

/** Unread badge or mention highlight counts as attention. */
export function hasSidebarAttention(item: {
  unread?: number;
  highlights?: number;
}): boolean {
  return (item.unread ?? 0) > 0 || (item.highlights ?? 0) > 0;
}

/**
 * Filter a list of named items. Returns a new array; never mutates input.
 * `nameOf` defaults to string items.
 */
export function filterSidebarNames<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string = (item) => String(item),
  options?: { unreadOnly?: boolean; hasAttention?: (item: T) => boolean },
): T[] {
  const q = normalizeSidebarQuery(query);
  const unreadOnly = options?.unreadOnly === true;
  const attention = options?.hasAttention ?? ((item: T) => hasSidebarAttention(item as {
    unread?: number;
    highlights?: number;
  }));
  if (q.length === 0 && !unreadOnly) return [...items];
  return items.filter((item) => {
    if (unreadOnly && !attention(item)) return false;
    if (q.length === 0) return true;
    return nameOf(item).toLowerCase().includes(q);
  });
}
