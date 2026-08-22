// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const HIDDEN_ROOMS_STORAGE_KEY = 'onyx:hidden-rooms';
export const MAX_HIDDEN_ROOMS = 512;
export const MAX_HIDDEN_ROOM_LENGTH = 128;
export const MAX_HIDDEN_ROOMS_STORAGE_CHARS = 128 * 1024;

const INVALID_CHANNEL_CHARACTERS = /[\s,\x00-\x1f\x7f]/u;

/** Normalize untrusted persisted room names into a bounded unique set. */
export function parseHiddenRooms(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const rooms = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const channel = raw.trim().toLowerCase();
    if (
      !channel
      || channel.length > MAX_HIDDEN_ROOM_LENGTH
      || (channel[0] !== '#' && channel[0] !== '&')
      || INVALID_CHANNEL_CHARACTERS.test(channel)
    ) continue;
    rooms.add(channel);
    if (rooms.size >= MAX_HIDDEN_ROOMS) break;
  }
  return rooms;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(HIDDEN_ROOMS_STORAGE_KEY, owner);
}

/** Purge ownerless list-state instead of assigning it to the next login. */
export function purgeLegacyHiddenRooms(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(HIDDEN_ROOMS_STORAGE_KEY);
    return store.getItem(HIDDEN_ROOMS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadHiddenRooms(owner?: DeviceMemoryOwner): Set<string> {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return new Set();
  if (owner !== undefined) purgeLegacyHiddenRooms();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_HIDDEN_ROOMS_STORAGE_CHARS) return new Set();
    return raw ? parseHiddenRooms(JSON.parse(raw) as unknown) : new Set();
  } catch {
    return new Set();
  }
}

export function saveHiddenRooms(
  value: ReadonlySet<string>,
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const rooms = parseHiddenRooms([...value]);
  const serialized = JSON.stringify([...rooms]);
  try {
    if (rooms.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify([...loadHiddenRooms(owner)]) === serialized;
  } catch {
    return false;
  }
}
