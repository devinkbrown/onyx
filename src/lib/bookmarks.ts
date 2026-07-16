// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import { sanitizeDMPin } from '@/lib/dmPins';
import { hasEncryptedMessageBoundary, persistedReplyPreviewText } from '@/lib/e2ee/replyPrivacy';
import type { ChatMessage } from '@/lib/irc/types';

export const BOOKMARKS_STORAGE_KEY = 'onyx:bookmarks';
export const MAX_BOOKMARKS = 100;
export const MAX_BOOKMARKS_STORAGE_CHARS = 2 * 1024 * 1024;

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(BOOKMARKS_STORAGE_KEY, owner) : null;
}

/**
 * Apply the durable ChatMessage allowlist and close the legacy E2EE-reply gap:
 * an envelope without an `encrypted` flag must not retain a decrypted preview.
 */
export function sanitizeBookmark(value: unknown): ChatMessage | null {
  const message = sanitizeDMPin(value);
  if (!message) return null;
  if (message.replyTo && hasEncryptedMessageBoundary(message)) {
    message.replyTo = {
      ...message.replyTo,
      text: persistedReplyPreviewText(message),
    };
  }
  return message;
}

/** Keep only the newest bounded, valid, unique durable message snapshots. */
export function sanitizeBookmarks(value: readonly unknown[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const raw of value.slice(-MAX_BOOKMARKS)) {
    const message = sanitizeBookmark(raw);
    if (!message) continue;
    // A later duplicate is authoritative and belongs at the end of the list.
    byId.delete(message.id);
    byId.set(message.id, message);
  }
  return [...byId.values()];
}

function parseBookmarks(raw: string | null): ChatMessage[] {
  if (!raw || raw.length > MAX_BOOKMARKS_STORAGE_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitizeBookmarks(parsed) : [];
  } catch {
    return [];
  }
}

/** Purge the unsafe ownerless journal instead of assigning it to a new owner. */
export function purgeLegacyBookmarks(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(BOOKMARKS_STORAGE_KEY);
    return store.getItem(BOOKMARKS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load only the explicit owner's bookmark journal; ownerless reads fail closed. */
export function loadBookmarks(owner?: DeviceMemoryOwner): ChatMessage[] {
  const store = storage();
  purgeLegacyBookmarks();
  const key = ownerStorageKey(owner);
  if (!store || !key) return [];
  try {
    return parseBookmarks(store.getItem(key));
  } catch {
    return [];
  }
}

/**
 * Persist a sanitized owner journal and return the exact durable state.
 * Oldest entries are dropped if the aggregate storage ceiling is reached.
 */
export function saveBookmarks(
  value: readonly unknown[],
  owner?: DeviceMemoryOwner,
): ChatMessage[] | null {
  const store = storage();
  purgeLegacyBookmarks();
  const key = ownerStorageKey(owner);
  if (!store || !key) return null;

  const bookmarks = sanitizeBookmarks(value);
  let serialized = JSON.stringify(bookmarks);
  while (bookmarks.length > 0 && serialized.length > MAX_BOOKMARKS_STORAGE_CHARS) {
    bookmarks.shift();
    serialized = JSON.stringify(bookmarks);
  }

  try {
    if (bookmarks.length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadBookmarks(owner);
    return JSON.stringify(verified) === serialized ? verified : null;
  } catch {
    return null;
  }
}

/** Clear legacy and every owner scope for the whole-device history wipe. */
export function clearDeviceBookmarks(): boolean {
  const store = storage();
  if (!store) return false;
  const ownerPrefix = `${BOOKMARKS_STORAGE_KEY}:owner:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === BOOKMARKS_STORAGE_KEY || key?.startsWith(ownerPrefix)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === BOOKMARKS_STORAGE_KEY || key?.startsWith(ownerPrefix)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
