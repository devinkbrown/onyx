// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import { persistedReplyPreviewText } from '@/lib/e2ee/replyPrivacy';
import type { ChatMessage, MessageReaction, MessageType } from '@/lib/irc/types';

export const DM_PINS_STORAGE_KEY = 'onyx:dm-pins';
export const MAX_DM_PIN_TARGETS = 64;
export const MAX_DM_PINS_PER_TARGET = 20;
export const MAX_DM_PINS_STORAGE_BYTES = 512 * 1024;

const MAX_NICK_LENGTH = 128;
const MAX_ID_LENGTH = 512;
const MAX_TEXT_LENGTH = 128 * 1024;
const MAX_TARGET_LENGTH = 512;
const MAX_REACTIONS = 64;
const MAX_REACTION_USERS = 256;
const MESSAGE_TYPES = new Set<MessageType>([
  'msg', 'action', 'notice', 'join', 'part', 'quit', 'kick', 'mode', 'topic',
  'nick', 'system', 'error', 'whisper',
]);

export type DMPinnedMessages = Map<string, ChatMessage[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function normalizedNick(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim().toLowerCase();
  return nick.length > 0 && nick.length <= MAX_NICK_LENGTH ? nick : null;
}

function finiteDate(value: unknown): Date | null {
  const milliseconds = value instanceof Date ? value.getTime()
    : typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime()
      : Number.NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function sanitizeReactions(value: unknown): MessageReaction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const reactions: MessageReaction[] = [];
  for (const raw of value.slice(0, MAX_REACTIONS)) {
    if (!isRecord(raw)) continue;
    const emoji = boundedString(raw['emoji'], 64);
    if (!emoji || !Array.isArray(raw['users'])) continue;
    const users = raw['users']
      .slice(0, MAX_REACTION_USERS)
      .filter((user): user is string => typeof user === 'string' && user.length <= MAX_NICK_LENGTH);
    reactions.push({ emoji, users });
  }
  return reactions.length > 0 ? reactions : undefined;
}

/** Sanitize one untrusted pin and strip every decrypted/transient field. */
export function sanitizeDMPin(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value['id'], MAX_ID_LENGTH);
  const time = finiteDate(value['time']);
  const from = boundedString(value['from'], MAX_NICK_LENGTH);
  const text = boundedString(value['text'], MAX_TEXT_LENGTH);
  const type = value['type'];
  const target = boundedString(value['target'], MAX_TARGET_LENGTH);
  if (!id || !time || !from || !text || typeof type !== 'string'
    || !MESSAGE_TYPES.has(type as MessageType) || !target) return null;

  const message: ChatMessage = { id, time, from, text, type: type as MessageType, target };
  if (typeof value['highlight'] === 'boolean') message.highlight = value['highlight'];
  if (typeof value['topic'] === 'string' || value['topic'] === null) message.topic = value['topic'];
  const reactions = sanitizeReactions(value['reactions']);
  if (reactions) message.reactions = reactions;
  const reply = value['replyTo'];
  if (isRecord(reply)) {
    const replyId = boundedString(reply['id'], MAX_ID_LENGTH);
    const replyFrom = boundedString(reply['from'], MAX_NICK_LENGTH);
    const replyText = boundedString(reply['text'], MAX_TEXT_LENGTH);
    if (replyId && replyFrom && replyText) {
      message.replyTo = {
        id: replyId,
        from: replyFrom,
        text: persistedReplyPreviewText({
          text: replyText,
          encrypted: value['encrypted'] === true,
        }),
      };
    }
  }
  for (const flag of ['edited', 'deleted', 'redacted', 'encrypted'] as const) {
    if (typeof value[flag] === 'boolean') message[flag] = value[flag];
  }
  const e2ee = value['e2ee'];
  if (e2ee === 'generic' || e2ee === 'mls' || e2ee === 'sframe') message.e2ee = e2ee;
  return message;
}

/** Sanitize, normalize, deduplicate, and bound one in-memory pin map. */
export function sanitizeDMPins(value: ReadonlyMap<string, readonly unknown[]>): DMPinnedMessages {
  const pins: DMPinnedMessages = new Map();
  for (const [rawNick, rawMessages] of value) {
    if (pins.size >= MAX_DM_PIN_TARGETS) break;
    const nick = normalizedNick(rawNick);
    if (!nick || !Array.isArray(rawMessages)) continue;
    const byId = new Map<string, ChatMessage>();
    for (const raw of rawMessages.slice(-MAX_DM_PINS_PER_TARGET)) {
      const message = sanitizeDMPin(raw);
      if (message) byId.set(message.id, message);
    }
    if (byId.size > 0) pins.set(nick, [...byId.values()].slice(-MAX_DM_PINS_PER_TARGET));
  }
  return pins;
}

function parseDMPins(raw: string | null): DMPinnedMessages {
  if (!raw || raw.length > MAX_DM_PINS_STORAGE_BYTES) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return new Map();
    return sanitizeDMPins(new Map(
      Object.entries(parsed).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1])),
    ));
  } catch {
    return new Map();
  }
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(DM_PINS_STORAGE_KEY, owner);
}

/** Purge the unsafe ownerless journal without assigning it to the next account. */
export function purgeLegacyDMPins(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(DM_PINS_STORAGE_KEY);
    return store.getItem(DM_PINS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** Load one account's ciphertext-only pinned DM messages. */
export function loadDMPins(owner?: DeviceMemoryOwner): DMPinnedMessages {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return new Map();
  if (owner !== undefined) purgeLegacyDMPins();
  try {
    return parseDMPins(store.getItem(key));
  } catch {
    return new Map();
  }
}

/** Persist one account's sanitized pins; decrypted `plaintext` is never written. */
export function saveDMPins(
  value: ReadonlyMap<string, readonly unknown[]>,
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const pins = sanitizeDMPins(value);
  const serialized = JSON.stringify(Object.fromEntries(pins));
  if (serialized.length > MAX_DM_PINS_STORAGE_BYTES) return false;
  try {
    if (pins.size === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(Object.fromEntries(loadDMPins(owner))) === serialized;
  } catch {
    return false;
  }
}

/** Clear legacy and every owner scope for the whole-device history wipe. */
export function clearDeviceDMPins(): boolean {
  const store = storage();
  if (!store) return false;
  const ownerPrefix = `${DM_PINS_STORAGE_KEY}:owner:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === DM_PINS_STORAGE_KEY || key?.startsWith(ownerPrefix)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === DM_PINS_STORAGE_KEY || key?.startsWith(ownerPrefix)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
