// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sidebarFilter.ts — pure filter for channel/DM sidebar lists.
 *
 * Case-insensitive substring match on channel names and DM nicks.
 * Empty query passes everything through.
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

/**
 * Filter a list of named items. Returns a new array; never mutates input.
 * `nameOf` defaults to string items.
 */
export function filterSidebarNames<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string = (item) => String(item),
): T[] {
  const q = normalizeSidebarQuery(query);
  if (q.length === 0) return [...items];
  return items.filter((item) => nameOf(item).toLowerCase().includes(q));
}
