// SPDX-License-Identifier: AGPL-3.0-or-later

import { normalizeNavigationChannel } from '@/lib/channelNavigationMemory';
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const AUTO_JOIN_STORAGE_KEY = 'onyx:autojoin';
export const MAX_AUTO_JOIN_CHANNELS = 128;
const MAX_AUTO_JOIN_STORAGE_CHARS = 64 * 1024;

/** Canonicalize an untrusted saved room list without widening the join surface. */
export function parseAutoJoinChannels(value: unknown): string[] {
  if (!Array.isArray(value) && !(value instanceof Set)) return [];
  const channels = new Set<string>();
  for (const raw of value) {
    const channel = normalizeNavigationChannel(raw);
    if (!channel) continue;
    channels.add(channel);
    if (channels.size >= MAX_AUTO_JOIN_CHANNELS) break;
  }
  return [...channels];
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(AUTO_JOIN_STORAGE_KEY, owner) : null;
}

/** Ownerless room names are ambiguous after upgrade, so purge rather than claim them. */
export function purgeLegacyAutoJoinChannels(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(AUTO_JOIN_STORAGE_KEY);
    return store.getItem(AUTO_JOIN_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load only one explicit server+account/guest namespace; ownerless reads are empty. */
export function loadAutoJoinChannels(owner?: DeviceMemoryOwner): string[] {
  const store = storage();
  purgeLegacyAutoJoinChannels();
  const key = ownerStorageKey(owner);
  if (!store || !key || !owner) return [];
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_AUTO_JOIN_STORAGE_CHARS) return [];
    return parseAutoJoinChannels(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Persist and verify one bounded owner namespace, leaving live state unchanged on failure. */
export function saveAutoJoinChannels(
  value: readonly unknown[],
  owner?: DeviceMemoryOwner,
): string[] | null {
  const store = storage();
  purgeLegacyAutoJoinChannels();
  const key = ownerStorageKey(owner);
  if (!store || !key || !owner) return null;
  const channels = parseAutoJoinChannels(value);
  const serialized = JSON.stringify(channels);
  try {
    if (channels.length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadAutoJoinChannels(owner);
    return JSON.stringify(verified) === serialized ? verified : null;
  } catch {
    return null;
  }
}
