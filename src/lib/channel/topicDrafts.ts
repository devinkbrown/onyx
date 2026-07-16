// SPDX-License-Identifier: AGPL-3.0-or-later
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const CHANNEL_TOPIC_DRAFTS_KEY = 'onyx:channel-topic-drafts';
export const MAX_CHANNEL_TOPIC_DRAFTS = 50;
export const MAX_CHANNEL_TOPIC_DRAFT_LENGTH = 2048;
export const MAX_CHANNEL_TOPIC_TARGET_LENGTH = 256;

export type ChannelTopicDrafts = Record<string, string>;

type TopicDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOrDefault(storage?: TopicDraftStorage): TopicDraftStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function channelTopicDraftKey(channel: string): string {
  return channel.trim().toLowerCase();
}

export function sanitizeChannelTopicDrafts(value: unknown): ChannelTopicDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const drafts: ChannelTopicDrafts = {};
  for (const [channel, draft] of Object.entries(value)) {
    const key = channelTopicDraftKey(channel);
    if (!key || key.length > MAX_CHANNEL_TOPIC_TARGET_LENGTH || !(key.startsWith('#') || key.startsWith('&'))) continue;
    if (typeof draft !== 'string' || draft.length === 0) continue;
    if (Object.hasOwn(drafts, key)) {
      drafts[key] = draft.slice(0, MAX_CHANNEL_TOPIC_DRAFT_LENGTH);
      continue;
    }
    if (Object.keys(drafts).length >= MAX_CHANNEL_TOPIC_DRAFTS) continue;
    drafts[key] = draft.slice(0, MAX_CHANNEL_TOPIC_DRAFT_LENGTH);
  }
  return drafts;
}

export function loadChannelTopicDrafts(
  storage?: TopicDraftStorage,
  owner?: DeviceMemoryOwner,
): ChannelTopicDrafts {
  const resolved = storageOrDefault(storage);
  if (!resolved) return {};
  const storageKey = deviceMemoryStorageKey(CHANNEL_TOPIC_DRAFTS_KEY, owner);
  if (!storageKey) return {};
  try {
    const raw = resolved.getItem(storageKey);
    return raw ? sanitizeChannelTopicDrafts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveChannelTopicDrafts(
  drafts: ChannelTopicDrafts,
  storage?: TopicDraftStorage,
  owner?: DeviceMemoryOwner,
): void {
  const resolved = storageOrDefault(storage);
  if (!resolved) return;
  const storageKey = deviceMemoryStorageKey(CHANNEL_TOPIC_DRAFTS_KEY, owner);
  if (!storageKey) return;

  const sanitized = sanitizeChannelTopicDrafts(drafts);
  try {
    if (Object.keys(sanitized).length === 0) {
      resolved.removeItem(storageKey);
      return;
    }
    resolved.setItem(storageKey, JSON.stringify(sanitized));
  } catch {}
}

export interface ClearChannelTopicDraftsResult {
  success: boolean;
  cleared: number;
  remaining: number;
}

/**
 * Remove all persisted channel-topic drafts and verify both the physical key
 * and the sanitized readback before reporting success.
 */
export function clearChannelTopicDrafts(
  storage?: TopicDraftStorage,
  owner?: DeviceMemoryOwner,
): ClearChannelTopicDraftsResult {
  const resolved = storageOrDefault(storage);
  const storageKey = deviceMemoryStorageKey(CHANNEL_TOPIC_DRAFTS_KEY, owner);
  const before = loadChannelTopicDrafts(storage, owner);
  const count = Object.keys(before).length;
  if (!resolved || !storageKey) return { success: false, cleared: 0, remaining: count };

  try {
    resolved.removeItem(storageKey);
    const remaining = Object.keys(loadChannelTopicDrafts(storage, owner)).length;
    const success = resolved.getItem(storageKey) === null && remaining === 0;
    return {
      success,
      cleared: success ? count : 0,
      remaining,
    };
  } catch {
    return {
      success: false,
      cleared: 0,
      remaining: Object.keys(loadChannelTopicDrafts(storage, owner)).length,
    };
  }
}

export function readChannelTopicDraft(
  channel: string,
  storage?: TopicDraftStorage,
  owner?: DeviceMemoryOwner,
): string | null {
  return loadChannelTopicDrafts(storage, owner)[channelTopicDraftKey(channel)] ?? null;
}

export function saveChannelTopicDraft(
  channel: string,
  draft: string,
  serverTopic: string,
  storage?: TopicDraftStorage,
  owner?: DeviceMemoryOwner,
): void {
  const key = channelTopicDraftKey(channel);
  if (!key) return;
  const drafts = loadChannelTopicDrafts(storage, owner);
  if (draft === serverTopic) delete drafts[key];
  else drafts[key] = draft;
  saveChannelTopicDrafts(drafts, storage, owner);
}
