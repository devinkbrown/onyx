// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const TOPIC_HISTORY_STORAGE_KEY = 'onyx:topic-history';
export const MAX_TOPIC_HISTORY_CHANNELS = 128;
export const MAX_TOPICS_PER_CHANNEL = 10;
export const MAX_TOPIC_HISTORY_CHANNEL_LENGTH = 128;
export const MAX_TOPIC_HISTORY_TEXT_LENGTH = 2_048;
export const MAX_TOPIC_HISTORY_PARSE_CHANNELS = 4_096;
const MAX_TOPIC_HISTORY_STORAGE_LENGTH = 1024 * 1024;

export type TopicHistory = Record<string, string[]>;

const INVALID_CHANNEL_CHARACTERS = /[\s,\x00-\x1f\x7f]/u;
const INVALID_TOPIC_CHARACTERS = /[\x00\r\n\x7f]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeTopicHistoryChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim().toLowerCase();
  if (
    channel.length === 0
    || channel.length > MAX_TOPIC_HISTORY_CHANNEL_LENGTH
    || (channel[0] !== '#' && channel[0] !== '&')
    || INVALID_CHANNEL_CHARACTERS.test(channel)
  ) return null;
  return channel;
}

export function normalizeTopicHistoryText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const topic = value.trim();
  if (!topic || INVALID_TOPIC_CHARACTERS.test(topic)) return null;
  return topic.slice(0, MAX_TOPIC_HISTORY_TEXT_LENGTH);
}

/** Bound untrusted room/topic history without retaining malformed entries. */
export function parseTopicHistory(value: unknown): TopicHistory {
  if (!isRecord(value)) return {};
  const history: TopicHistory = {};
  const entries = Object.entries(value);
  const scanCount = Math.min(entries.length, MAX_TOPIC_HISTORY_PARSE_CHANNELS);
  for (let index = 0; index < scanCount; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const [rawChannel, rawTopics] = entry;
    const channel = normalizeTopicHistoryChannel(rawChannel);
    if (!channel || !Array.isArray(rawTopics)) continue;
    const topics: string[] = [];
    for (const rawTopic of rawTopics) {
      const topic = normalizeTopicHistoryText(rawTopic);
      if (!topic || topics.includes(topic)) continue;
      topics.push(topic);
      if (topics.length >= MAX_TOPICS_PER_CHANNEL) break;
    }
    if (topics.length === 0) continue;
    history[channel] = topics;
    if (Object.keys(history).length >= MAX_TOPIC_HISTORY_CHANNELS) break;
  }
  return history;
}

export function recordTopicHistory(
  value: TopicHistory,
  channel: string,
  topic: string,
): TopicHistory {
  const history = parseTopicHistory(value);
  const key = normalizeTopicHistoryChannel(channel);
  const normalizedTopic = normalizeTopicHistoryText(topic);
  if (!key || !normalizedTopic) return history;
  if (!Object.hasOwn(history, key) && Object.keys(history).length >= MAX_TOPIC_HISTORY_CHANNELS) {
    return history;
  }
  history[key] = [
    normalizedTopic,
    ...(history[key] ?? []).filter((entry) => entry !== normalizedTopic),
  ].slice(0, MAX_TOPICS_PER_CHANNEL);
  return history;
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(owner: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(TOPIC_HISTORY_STORAGE_KEY, owner);
}

/** Purge ownerless room/topic text instead of assigning it to the next login. */
export function purgeLegacyTopicHistory(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(TOPIC_HISTORY_STORAGE_KEY);
    return store.getItem(TOPIC_HISTORY_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadTopicHistory(owner: DeviceMemoryOwner): TopicHistory {
  const store = storage();
  const key = ownerStorageKey(owner);
  if (!store || !key) return {};
  purgeLegacyTopicHistory();
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_TOPIC_HISTORY_STORAGE_LENGTH) return {};
    return parseTopicHistory(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export function saveTopicHistory(value: TopicHistory, owner: DeviceMemoryOwner): boolean {
  const store = storage();
  const key = ownerStorageKey(owner);
  if (!store || !key) return false;
  const history = parseTopicHistory(value);
  const serialized = JSON.stringify(history);
  try {
    purgeLegacyTopicHistory();
    if (Object.keys(history).length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(loadTopicHistory(owner)) === serialized;
  } catch {
    return false;
  }
}

/** Clear every owner scope because the history control is whole-device. */
export function clearDeviceTopicHistory(): boolean {
  const store = storage();
  if (!store) return false;
  const ownerPrefix = `${TOPIC_HISTORY_STORAGE_KEY}:owner:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === TOPIC_HISTORY_STORAGE_KEY || key?.startsWith(ownerPrefix)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === TOPIC_HISTORY_STORAGE_KEY || key?.startsWith(ownerPrefix)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
