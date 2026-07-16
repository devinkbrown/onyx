// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const CHANNEL_NOTIFY_STORAGE_KEY = 'onyx:channel-notify';
export const MAX_CHANNEL_NOTIFY_ENTRIES = 256;

export type ChannelNotifyLevel = 'all' | 'mentions' | 'none';
export type ChannelNotifyMap = Map<string, Exclude<ChannelNotifyLevel, 'all'>>;

const MAX_CHANNEL_LENGTH = 128;
const INVALID_CHANNEL = /[\s,\x00-\x1f\x7f]/u;

function normalizeChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim().toLowerCase();
  if (
    channel.length === 0
    || channel.length > MAX_CHANNEL_LENGTH
    || (channel[0] !== '#' && channel[0] !== '&')
    || INVALID_CHANNEL.test(channel)
  ) return null;
  return channel;
}

function parse(value: unknown): ChannelNotifyMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Map();
  const notify: ChannelNotifyMap = new Map();
  for (const [rawChannel, level] of Object.entries(value as Record<string, unknown>)) {
    if (notify.size >= MAX_CHANNEL_NOTIFY_ENTRIES) break;
    const channel = normalizeChannel(rawChannel);
    if (channel && (level === 'mentions' || level === 'none')) notify.set(channel, level);
  }
  return notify;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(CHANNEL_NOTIFY_STORAGE_KEY, owner);
}

/** Remove an ownerless policy instead of assigning its private room names to the next login. */
export function purgeLegacyChannelNotify(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(CHANNEL_NOTIFY_STORAGE_KEY);
    return store.getItem(CHANNEL_NOTIFY_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load only one account's bounded non-default notification policy. */
export function loadChannelNotify(owner?: DeviceMemoryOwner): ChannelNotifyMap {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return new Map();
  if (owner !== undefined) purgeLegacyChannelNotify();
  try {
    const raw = store.getItem(key);
    return raw ? parse(JSON.parse(raw) as unknown) : new Map();
  } catch {
    return new Map();
  }
}

/** Persist one account policy; the default `all` level never occupies disk. */
export function saveChannelNotify(
  value: ReadonlyMap<string, ChannelNotifyLevel>,
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const parsed = parse(Object.fromEntries(value));
  const serialized = JSON.stringify(Object.fromEntries(parsed));
  try {
    if (parsed.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(Object.fromEntries(loadChannelNotify(owner))) === serialized;
  } catch {
    return false;
  }
}
