// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import {
  parseChannelFolders,
  type PersistedChannelFolder,
} from '@/lib/store/channelFoldersPersistence';

export const CHANNEL_NAVIGATION_STORAGE_KEY = 'onyx:channel-navigation';
export const MAX_NAVIGATION_CHANNELS = 256;
export const MAX_CHANNEL_ORDER = 512;
export const MAX_NAVIGATION_CHANNEL_LENGTH = 128;
export const MAX_CHANNEL_NAVIGATION_STORAGE_CHARS = 2 * 1024 * 1024;

export const LEGACY_CHANNEL_NAVIGATION_KEYS = [
  'onyx:pinned-channels',
  'onyx:followed-channels',
  'onyx:starred',
  'onyx:channel-folders',
  'onyx:channel-order',
  'onyx:nsfw-channels',
  'onyx:forum-channels',
] as const;

const INVALID_CHANNEL_CHARACTERS = /[\s,\x00-\x1f\x7f]/u;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;

export interface ChannelNavigationMemory {
  pinnedChannels: Set<string>;
  followedChannels: Set<string>;
  starredChannels: Set<string>;
  channelFolders: PersistedChannelFolder[];
  channelOrder: string[];
  nsfwChannels: Set<string>;
  forumChannels: Set<string>;
}

export function emptyChannelNavigationMemory(): ChannelNavigationMemory {
  return {
    pinnedChannels: new Set(),
    followedChannels: new Set(),
    starredChannels: new Set(),
    channelFolders: parseChannelFolders(null),
    channelOrder: [],
    nsfwChannels: new Set(),
    forumChannels: new Set(),
  };
}

export function normalizeNavigationChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim().toLowerCase();
  if (
    !channel
    || channel.length > MAX_NAVIGATION_CHANNEL_LENGTH
    || (channel[0] !== '#' && channel[0] !== '&')
    || INVALID_CHANNEL_CHARACTERS.test(channel)
  ) return null;
  return channel;
}

function boundedChannels(value: unknown, maximum = MAX_NAVIGATION_CHANNELS): string[] {
  if (!Array.isArray(value) && !(value instanceof Set)) return [];
  const channels = new Set<string>();
  for (const raw of value) {
    const channel = normalizeNavigationChannel(raw);
    if (channel) channels.add(channel);
    if (channels.size >= maximum) break;
  }
  return [...channels];
}

function sanitizeFolders(value: unknown): PersistedChannelFolder[] {
  let parsed: PersistedChannelFolder[];
  try {
    parsed = parseChannelFolders(JSON.stringify(value));
  } catch {
    return parseChannelFolders(null);
  }
  const claimed = new Set<string>();
  const folders: PersistedChannelFolder[] = [];
  for (const folder of parsed) {
    if (CONTROL_CHARACTERS.test(folder.id) || CONTROL_CHARACTERS.test(folder.name)) continue;
    const channels: string[] = [];
    for (const rawChannel of folder.channels) {
      const channel = normalizeNavigationChannel(rawChannel);
      if (!channel || claimed.has(channel)) continue;
      claimed.add(channel);
      channels.push(channel);
    }
    folders.push({ ...folder, name: folder.name.trim(), channels });
  }
  return folders.length > 0 ? folders : parseChannelFolders(null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonicalize all room-name navigation caches at one bounded boundary. */
export function parseChannelNavigationMemory(value: unknown): ChannelNavigationMemory {
  if (!isRecord(value)) return emptyChannelNavigationMemory();
  return {
    pinnedChannels: new Set(boundedChannels(value.pinnedChannels)),
    followedChannels: new Set(boundedChannels(value.followedChannels)),
    starredChannels: new Set(boundedChannels(value.starredChannels)),
    channelFolders: sanitizeFolders(value.channelFolders),
    channelOrder: boundedChannels(value.channelOrder, MAX_CHANNEL_ORDER),
    nsfwChannels: new Set(boundedChannels(value.nsfwChannels)),
    forumChannels: new Set(boundedChannels(value.forumChannels)),
  };
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(CHANNEL_NAVIGATION_STORAGE_KEY, owner);
}

/** Ownerless room organization cannot safely be assigned after an upgrade. */
export function purgeLegacyChannelNavigation(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(CHANNEL_NAVIGATION_STORAGE_KEY);
    for (const key of LEGACY_CHANNEL_NAVIGATION_KEYS) store.removeItem(key);
    return store.getItem(CHANNEL_NAVIGATION_STORAGE_KEY) === null
      && LEGACY_CHANNEL_NAVIGATION_KEYS.every((key) => store.getItem(key) === null);
  } catch {
    return false;
  }
}

function serializable(value: ChannelNavigationMemory): Record<string, unknown> {
  return {
    pinnedChannels: [...value.pinnedChannels],
    followedChannels: [...value.followedChannels],
    starredChannels: [...value.starredChannels],
    channelFolders: value.channelFolders,
    channelOrder: value.channelOrder,
    nsfwChannels: [...value.nsfwChannels],
    forumChannels: [...value.forumChannels],
  };
}

export function loadChannelNavigationMemory(owner: DeviceMemoryOwner): ChannelNavigationMemory {
  const store = storage();
  const key = ownerStorageKey(owner);
  if (!store || !key) return emptyChannelNavigationMemory();
  purgeLegacyChannelNavigation();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_CHANNEL_NAVIGATION_STORAGE_CHARS) {
      return emptyChannelNavigationMemory();
    }
    return raw ? parseChannelNavigationMemory(JSON.parse(raw) as unknown) : emptyChannelNavigationMemory();
  } catch {
    return emptyChannelNavigationMemory();
  }
}

export function saveChannelNavigationMemory(
  value: ChannelNavigationMemory,
  owner: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = ownerStorageKey(owner);
  if (!store || !key) return false;
  const navigation = parseChannelNavigationMemory(value);
  const serialized = JSON.stringify(serializable(navigation));
  try {
    purgeLegacyChannelNavigation();
    store.setItem(key, serialized);
    return JSON.stringify(serializable(loadChannelNavigationMemory(owner))) === serialized;
  } catch {
    return false;
  }
}
