// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const MUTED_DMS_STORAGE_KEY = 'onyx:muted-dms';
export const MAX_MUTED_DMS = 512;
export const MAX_MUTED_DM_NICK_LENGTH = 128;

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;

/** Normalize untrusted persisted nicknames into a bounded unique set. */
export function parseMutedDMs(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const users = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const nick = raw.trim().toLowerCase();
    if (
      nick.length === 0
      || nick.length > MAX_MUTED_DM_NICK_LENGTH
      || CONTROL_CHARACTERS.test(nick)
    ) continue;
    users.add(nick);
    if (users.size >= MAX_MUTED_DMS) break;
  }
  return users;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(MUTED_DMS_STORAGE_KEY, owner);
}

/** Purge ownerless contact metadata instead of assigning it to the next login. */
export function purgeLegacyMutedDMs(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(MUTED_DMS_STORAGE_KEY);
    return store.getItem(MUTED_DMS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadMutedDMs(owner?: DeviceMemoryOwner): Set<string> {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return new Set();
  if (owner !== undefined) purgeLegacyMutedDMs();
  try {
    const raw = store.getItem(key);
    return raw ? parseMutedDMs(JSON.parse(raw) as unknown) : new Set();
  } catch {
    return new Set();
  }
}

export function saveMutedDMs(
  value: ReadonlySet<string>,
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const users = parseMutedDMs([...value]);
  const serialized = JSON.stringify([...users]);
  try {
    if (users.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify([...loadMutedDMs(owner)]) === serialized;
  } catch {
    return false;
  }
}
