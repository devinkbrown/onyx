// SPDX-License-Identifier: AGPL-3.0-or-later
export const CHANNEL_TOPIC_DRAFTS_KEY = 'onyx:channel-topic-drafts';

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
    if (!key || !(key.startsWith('#') || key.startsWith('&'))) continue;
    if (typeof draft !== 'string' || draft.length === 0) continue;
    drafts[key] = draft;
  }
  return drafts;
}

export function loadChannelTopicDrafts(storage?: TopicDraftStorage): ChannelTopicDrafts {
  const resolved = storageOrDefault(storage);
  if (!resolved) return {};
  try {
    const raw = resolved.getItem(CHANNEL_TOPIC_DRAFTS_KEY);
    return raw ? sanitizeChannelTopicDrafts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveChannelTopicDrafts(
  drafts: ChannelTopicDrafts,
  storage?: TopicDraftStorage,
): void {
  const resolved = storageOrDefault(storage);
  if (!resolved) return;

  const sanitized = sanitizeChannelTopicDrafts(drafts);
  try {
    if (Object.keys(sanitized).length === 0) {
      resolved.removeItem(CHANNEL_TOPIC_DRAFTS_KEY);
      return;
    }
    resolved.setItem(CHANNEL_TOPIC_DRAFTS_KEY, JSON.stringify(sanitized));
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
): ClearChannelTopicDraftsResult {
  const resolved = storageOrDefault(storage);
  const before = loadChannelTopicDrafts(storage);
  const count = Object.keys(before).length;
  if (!resolved) return { success: false, cleared: 0, remaining: count };

  try {
    resolved.removeItem(CHANNEL_TOPIC_DRAFTS_KEY);
    const remaining = Object.keys(loadChannelTopicDrafts(storage)).length;
    const success = resolved.getItem(CHANNEL_TOPIC_DRAFTS_KEY) === null && remaining === 0;
    return {
      success,
      cleared: success ? count : 0,
      remaining,
    };
  } catch {
    return {
      success: false,
      cleared: 0,
      remaining: Object.keys(loadChannelTopicDrafts(storage)).length,
    };
  }
}

export function readChannelTopicDraft(channel: string, storage?: TopicDraftStorage): string | null {
  return loadChannelTopicDrafts(storage)[channelTopicDraftKey(channel)] ?? null;
}

export function saveChannelTopicDraft(
  channel: string,
  draft: string,
  serverTopic: string,
  storage?: TopicDraftStorage,
): void {
  const key = channelTopicDraftKey(channel);
  if (!key) return;
  const drafts = loadChannelTopicDrafts(storage);
  if (draft === serverTopic) delete drafts[key];
  else drafts[key] = draft;
  saveChannelTopicDrafts(drafts, storage);
}
