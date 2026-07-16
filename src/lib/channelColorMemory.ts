// SPDX-License-Identifier: AGPL-3.0-or-later

import { normalizeNavigationChannel } from '@/lib/channelNavigationMemory';
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import { normalizeNickColor } from '@/lib/identityOverrides';

export const CHANNEL_COLORS_STORAGE_KEY = 'onyx:channel-colors';
export const MAX_CHANNEL_COLOR_ENTRIES = 256;
const MAX_CHANNEL_COLOR_STORAGE_CHARS = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonicalize private room labels and admit only the supported safe hex contract. */
export function parseChannelColors(value: unknown): Map<string, string> {
  if (!isRecord(value)) return new Map();
  const colors = new Map<string, string>();
  for (const [rawChannel, rawColor] of Object.entries(value)) {
    const channel = normalizeNavigationChannel(rawChannel);
    const color = normalizeNickColor(rawColor);
    if (!channel || !color) continue;
    if (!colors.has(channel) && colors.size >= MAX_CHANNEL_COLOR_ENTRIES) break;
    colors.set(channel, color);
  }
  return colors;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(CHANNEL_COLORS_STORAGE_KEY, owner) : null;
}

/** Ownerless room-name mappings are ambiguous after upgrade and are never claimed. */
export function purgeLegacyChannelColors(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(CHANNEL_COLORS_STORAGE_KEY);
    return store.getItem(CHANNEL_COLORS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadChannelColors(owner?: DeviceMemoryOwner): Map<string, string> {
  const store = storage();
  purgeLegacyChannelColors();
  const key = ownerStorageKey(owner);
  if (!store || !key || !owner) return new Map();
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_CHANNEL_COLOR_STORAGE_CHARS) return new Map();
    return parseChannelColors(JSON.parse(raw) as unknown);
  } catch {
    return new Map();
  }
}

function serializable(colors: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...colors].sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

/** Persist and verify one owner map; callers retain prior live state on failure. */
export function saveChannelColors(
  value: ReadonlyMap<string, string>,
  owner?: DeviceMemoryOwner,
): Map<string, string> | null {
  const store = storage();
  purgeLegacyChannelColors();
  const key = ownerStorageKey(owner);
  if (!store || !key || !owner) return null;
  const colors = parseChannelColors(Object.fromEntries(value));
  const serialized = JSON.stringify(serializable(colors));
  try {
    if (colors.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = loadChannelColors(owner);
    return JSON.stringify(serializable(verified)) === serialized ? verified : null;
  } catch {
    return null;
  }
}
