// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const FRIENDS_STORAGE_KEY = 'onyx:friends';
export const WATCH_LIST_STORAGE_KEY = 'onyx:watch-list';
export const MAX_CONTACTS = 256;
export const MAX_CONTACT_NICK_LENGTH = 128;
export const MAX_FRIEND_NOTE_LENGTH = 512;
export const MAX_CONTACT_PRESENCE_STORAGE_CHARS = 256 * 1024;

const UNSAFE_MONITOR_NICK = /[\s,\x00-\x1f\x7f]/u;

export interface FriendEntry {
  nick: string;
  online: boolean;
  note?: string;
}

export interface WatchEntry {
  nick: string;
  online: boolean;
  lastSeen?: Date;
}

function normalizedNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim();
  if (
    nick.length === 0
    || nick.length > MAX_CONTACT_NICK_LENGTH
    || UNSAFE_MONITOR_NICK.test(nick)
  ) return null;
  return nick;
}

/** Sanitize untrusted friend records and reset network-derived presence. */
export function parseFriends(value: unknown): Map<string, FriendEntry> {
  const friends = new Map<string, FriendEntry>();
  if (!Array.isArray(value)) return friends;
  for (const raw of value) {
    if (friends.size >= MAX_CONTACTS) break;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const nick = normalizedNick(record.nick);
    if (!nick) continue;
    const key = nick.toLowerCase();
    if (friends.has(key)) continue;
    const friend: FriendEntry = { nick, online: false };
    if (typeof record.note === 'string' && record.note.length <= MAX_FRIEND_NOTE_LENGTH) {
      friend.note = record.note;
    }
    friends.set(key, friend);
  }
  return friends;
}

/** Sanitize untrusted WATCH records and reset network-derived presence. */
export function parseWatchList(value: unknown): WatchEntry[] {
  const entries: WatchEntry[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(value)) return entries;
  for (const raw of value) {
    if (entries.length >= MAX_CONTACTS) break;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const nick = normalizedNick(record.nick);
    if (!nick) continue;
    const key = nick.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: WatchEntry = { nick, online: false };
    if (typeof record.lastSeen === 'string' && record.lastSeen.length <= 64) {
      const lastSeen = new Date(record.lastSeen);
      if (Number.isFinite(lastSeen.getTime())) entry.lastSeen = lastSeen;
    }
    entries.push(entry);
  }
  return entries;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerKey(baseKey: string, owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(baseKey, owner);
}

/** Purge ownerless contact data instead of assigning it to the next login. */
export function purgeLegacyContactPresence(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(FRIENDS_STORAGE_KEY);
    store.removeItem(WATCH_LIST_STORAGE_KEY);
    return store.getItem(FRIENDS_STORAGE_KEY) === null
      && store.getItem(WATCH_LIST_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadFriends(owner?: DeviceMemoryOwner): Map<string, FriendEntry> {
  const store = storage();
  const key = ownerKey(FRIENDS_STORAGE_KEY, owner);
  if (!store || !key) return new Map();
  if (owner !== undefined) purgeLegacyContactPresence();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_CONTACT_PRESENCE_STORAGE_CHARS) return new Map();
    return raw ? parseFriends(JSON.parse(raw) as unknown) : new Map();
  } catch {
    return new Map();
  }
}

export function saveFriends(
  value: ReadonlyMap<string, FriendEntry>,
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = ownerKey(FRIENDS_STORAGE_KEY, owner);
  if (!store || !key) return false;
  const friends = parseFriends([...value.values()]);
  const persisted = [...friends.values()].map((friend) => ({
    nick: friend.nick,
    ...(friend.note !== undefined ? { note: friend.note } : {}),
  }));
  const serialized = JSON.stringify(persisted);
  try {
    if (friends.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify([...loadFriends(owner).values()].map((friend) => ({
      nick: friend.nick,
      ...(friend.note !== undefined ? { note: friend.note } : {}),
    }))) === serialized;
  } catch {
    return false;
  }
}

export function loadWatchList(owner?: DeviceMemoryOwner): WatchEntry[] {
  const store = storage();
  const key = ownerKey(WATCH_LIST_STORAGE_KEY, owner);
  if (!store || !key) return [];
  if (owner !== undefined) purgeLegacyContactPresence();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_CONTACT_PRESENCE_STORAGE_CHARS) return [];
    return raw ? parseWatchList(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function saveWatchList(
  value: readonly WatchEntry[],
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = ownerKey(WATCH_LIST_STORAGE_KEY, owner);
  if (!store || !key) return false;
  const entries = parseWatchList(value);
  const persisted = entries.map((entry) => ({ nick: entry.nick, online: false }));
  const serialized = JSON.stringify(persisted);
  try {
    if (entries.length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(loadWatchList(owner).map((entry) => ({
      nick: entry.nick,
      online: false,
    }))) === serialized;
  } catch {
    return false;
  }
}
