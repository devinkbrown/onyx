// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const IGNORED_USERS_STORAGE_KEY = 'onyx:ignored-users';
export const MAX_IGNORED_USERS = 512;
export const MAX_IGNORED_NICK_LENGTH = 128;
export const MAX_IGNORED_USERS_STORAGE_CHARS = 128 * 1024;

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;

/** Normalize untrusted persisted nicknames into a bounded unique set. */
export function parseIgnoredUsers(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const users = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const nick = raw.trim().toLowerCase();
    if (
      nick.length === 0
      || nick.length > MAX_IGNORED_NICK_LENGTH
      || CONTROL_CHARACTERS.test(nick)
    ) continue;
    users.add(nick);
    if (users.size >= MAX_IGNORED_USERS) break;
  }
  return users;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(IGNORED_USERS_STORAGE_KEY, owner);
}

/** Purge ownerless contact metadata instead of assigning it to the next login. */
export function purgeLegacyIgnoredUsers(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(IGNORED_USERS_STORAGE_KEY);
    return store.getItem(IGNORED_USERS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadIgnoredUsers(owner?: DeviceMemoryOwner): Set<string> {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return new Set();
  if (owner !== undefined) purgeLegacyIgnoredUsers();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_IGNORED_USERS_STORAGE_CHARS) return new Set();
    return raw ? parseIgnoredUsers(JSON.parse(raw) as unknown) : new Set();
  } catch {
    return new Set();
  }
}

export function saveIgnoredUsers(
  value: ReadonlySet<string>,
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const users = parseIgnoredUsers([...value]);
  const serialized = JSON.stringify([...users]);
  try {
    if (users.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify([...loadIgnoredUsers(owner)]) === serialized;
  } catch {
    return false;
  }
}
