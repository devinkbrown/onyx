// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * bookmarks.ts — favorite / pin-to-top channel bookmarks for the sidebar.
 */

import {
  deviceMemoryStorageKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';

export const CHANNEL_BOOKMARKS_KEY = 'onyx:channel-bookmarks';
export const MAX_BOOKMARKS = 48;
export const MAX_BOOKMARKS_STORAGE_CHARS = 16 * 1024;

const CONTROL = /[\u0000-\u001f\u007f]/u;

export type BookmarkList = string[];

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(CHANNEL_BOOKMARKS_KEY, owner) : null;
}

function sanitizeChannel(channel: string): string | null {
  const trimmed = channel.trim();
  if (!trimmed || trimmed.length > 64 || CONTROL.test(trimmed)) return null;
  if (!/^[#&+]/.test(trimmed)) return null;
  return trimmed;
}

export function parseBookmarks(value: unknown): BookmarkList {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, MAX_BOOKMARKS)) {
    if (typeof entry !== 'string') continue;
    const safe = sanitizeChannel(entry);
    if (!safe) continue;
    const key = safe.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe);
  }
  return out;
}

export function loadBookmarks(owner?: DeviceMemoryOwner): BookmarkList {
  if (typeof localStorage === 'undefined') return [];
  const key = storageKey(owner);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_BOOKMARKS_STORAGE_CHARS) return [];
    return parseBookmarks(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveBookmarks(list: BookmarkList, owner?: DeviceMemoryOwner): boolean {
  if (typeof localStorage === 'undefined') return false;
  const key = storageKey(owner);
  if (!key) return false;
  try {
    const payload = JSON.stringify(parseBookmarks(list));
    if (payload.length > MAX_BOOKMARKS_STORAGE_CHARS) return false;
    localStorage.setItem(key, payload);
    return true;
  } catch {
    return false;
  }
}

export function toggleBookmark(list: BookmarkList, channel: string): BookmarkList {
  const safe = sanitizeChannel(channel);
  if (!safe) return list;
  const key = safe.toLowerCase();
  const without = list.filter((ch) => ch.toLowerCase() !== key);
  if (without.length !== list.length) return without;
  if (list.length >= MAX_BOOKMARKS) return list;
  return [safe, ...list];
}

export function isBookmarked(list: BookmarkList, channel: string): boolean {
  const key = channel.trim().toLowerCase();
  return list.some((ch) => ch.toLowerCase() === key);
}

/** Bookmarks first (stable order), then the rest alphabetically. */
export function sortWithBookmarks(
  channels: readonly string[],
  bookmarks: BookmarkList,
): string[] {
  const bookKeys = new Set(bookmarks.map((b) => b.toLowerCase()));
  const fav: string[] = [];
  const rest: string[] = [];
  for (const ch of channels) {
    if (bookKeys.has(ch.toLowerCase())) fav.push(ch);
    else rest.push(ch);
  }
  // Preserve bookmark list order for favorites.
  fav.sort((a, b) => {
    const ia = bookmarks.findIndex((x) => x.toLowerCase() === a.toLowerCase());
    const ib = bookmarks.findIndex((x) => x.toLowerCase() === b.toLowerCase());
    return ia - ib;
  });
  rest.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [...fav, ...rest];
}
