// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * catchUpMemory.ts — durable Home catch-up snapshot for cold return.
 *
 * Live unread lives in the zustand store and evaporates on a full reload.
 * This module keeps a bounded, owner-scoped copy of the last ranked catch-up
 * list (plus optional recap seeds + first-unread boundaries) so Home can paint
 * "what you left unfinished" from device memory before the network rejoins
 * rooms and re-derives unread. Vault recaps may enrich previews later; the
 * snapshot itself is the instant first paint.
 *
 * Fail-closed: malformed / oversize storage is ignored. Never mutates inputs.
 */
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import type { CatchUpItem } from '@/lib/notifications/catchUp';

export const CATCH_UP_MEMORY_KEY = 'onyx:home-catch-up';
export const CATCH_UP_MEMORY_LIMIT = 8;
export const MAX_CATCH_UP_MEMORY_INPUT_ENTRIES = 64;
export const MAX_CATCH_UP_MEMORY_NAME_LENGTH = 128;
export const MAX_CATCH_UP_MEMORY_PREVIEW_LENGTH = 512;
export const MAX_CATCH_UP_MEMORY_STORAGE_CHARS = 128 * 1024;
export const MAX_CATCH_UP_MEMORY_VOICES = 4;

const MAX_CHANNEL_TARGET_LENGTH = 128;
const MAX_DM_TARGET_LENGTH = 64;
const MAX_MESSAGE_ID_LENGTH = 512;
const TARGET_INVALID_PATTERN = /[\s,\x00-\x1f\x7f]/u;
const MESSAGE_ID_CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;
const DISPLAY_TEXT_CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;

export interface CatchUpMemoryItem {
  key: string;
  kind: 'channel' | 'dm';
  name: string;
  target: string;
  unread: number;
  highlights: number;
  followed: boolean;
  lastActivity: number;
  /** Authoritative first-unread id when known (resume boundary). */
  firstUnreadId: string | null;
  /** Optional recap seed so cold paint does not wait on IndexedDB. */
  preview: string;
  messageCount: number;
  mentionCount: number;
  firstMessageId: string | null;
  firstAt: string;
  voices: readonly string[];
}

export type CatchUpMemoryListener = (items: readonly CatchUpMemoryItem[]) => void;

const listeners = new Map<string, Set<CatchUpMemoryListener>>();

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function memoryStorageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(CATCH_UP_MEMORY_KEY, owner);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTarget(value: unknown, kind: 'channel' | 'dm'): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const maxLength = kind === 'channel' ? MAX_CHANNEL_TARGET_LENGTH : MAX_DM_TARGET_LENGTH;
  if (value.length > maxLength || value !== value.trim()) return null;
  const channelTarget = value.startsWith('#') || value.startsWith('&');
  if (
    TARGET_INVALID_PATTERN.test(value)
    || (kind === 'channel' ? !channelTarget : channelTarget)
  ) return null;
  return value;
}

function normalizeMessageId(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_MESSAGE_ID_LENGTH
    || value !== value.trim()
    || MESSAGE_ID_CONTROL_PATTERN.test(value)
  ) return null;
  return value;
}

function normalizeDisplayText(
  value: unknown,
  maxLength: number,
  allowEmpty: boolean,
): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  if (DISPLAY_TEXT_CONTROL_PATTERN.test(value)) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 || allowEmpty ? normalized : null;
}

function normalizeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeActivity(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER
    ? Math.floor(value)
    : null;
}

function normalizeVoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const voices: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const voice = normalizeDisplayText(raw, MAX_CATCH_UP_MEMORY_NAME_LENGTH, false);
    if (!voice) continue;
    const key = voice.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    voices.push(voice);
    if (voices.length >= MAX_CATCH_UP_MEMORY_VOICES) break;
  }
  return voices;
}

function itemKey(item: Pick<CatchUpMemoryItem, 'kind' | 'target'>): string {
  return `${item.kind}:${item.target.toLowerCase()}`;
}

function compareActivity(a: CatchUpMemoryItem, b: CatchUpMemoryItem): number {
  return (
    b.lastActivity - a.lastActivity
    || a.target.toLowerCase().localeCompare(b.target.toLowerCase())
  );
}

function priority(item: CatchUpMemoryItem): number {
  return item.highlights > 0 || item.kind === 'dm' ? 2 : item.followed ? 1 : 0;
}

function sameItems(
  left: readonly CatchUpMemoryItem[],
  right: readonly CatchUpMemoryItem[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Fail-closed parse of one persisted catch-up row. */
export function sanitizeCatchUpMemoryItem(value: unknown): CatchUpMemoryItem | null {
  if (!isRecord(value)) return null;
  const kind = value.kind === 'channel' || value.kind === 'dm' ? value.kind : null;
  if (!kind) return null;

  const target = normalizeTarget(value.target, kind);
  const name = normalizeDisplayText(value.name, MAX_CATCH_UP_MEMORY_NAME_LENGTH, false);
  const unread = normalizeCount(value.unread);
  const highlights = normalizeCount(value.highlights);
  const lastActivity = normalizeActivity(value.lastActivity);
  if (!target || !name || unread === null || highlights === null || lastActivity === null) {
    return null;
  }
  if (unread === 0 && highlights === 0) return null;
  if (highlights > unread && unread > 0) return null;

  const firstUnreadId = value.firstUnreadId == null || value.firstUnreadId === ''
    ? null
    : normalizeMessageId(value.firstUnreadId);
  if (value.firstUnreadId != null && value.firstUnreadId !== '' && firstUnreadId === null) {
    return null;
  }

  const preview = normalizeDisplayText(
    value.preview ?? '',
    MAX_CATCH_UP_MEMORY_PREVIEW_LENGTH,
    true,
  );
  if (preview === null) return null;

  const messageCount = normalizeCount(value.messageCount ?? 0);
  const mentionCount = normalizeCount(value.mentionCount ?? 0);
  if (messageCount === null || mentionCount === null || mentionCount > messageCount) {
    return null;
  }

  const firstMessageId = value.firstMessageId == null || value.firstMessageId === ''
    ? null
    : normalizeMessageId(value.firstMessageId);
  if (value.firstMessageId != null && value.firstMessageId !== '' && firstMessageId === null) {
    return null;
  }

  const firstAt = typeof value.firstAt === 'string' && value.firstAt.length <= 40
    ? value.firstAt
    : '';

  const keyRaw = typeof value.key === 'string' ? value.key.trim() : '';
  const key = keyRaw.length > 0 && keyRaw.length <= 160
    ? keyRaw
    : `${kind === 'channel' ? 'c' : 'd'}:${target.toLowerCase()}`;

  return {
    key,
    kind,
    name,
    target,
    unread,
    highlights,
    followed: value.followed === true,
    lastActivity,
    firstUnreadId,
    preview,
    messageCount,
    mentionCount,
    firstMessageId,
    firstAt,
    voices: normalizeVoices(value.voices),
  };
}

/** Canonicalize a persisted list: dedupe by target, rank, bound. */
export function parseCatchUpMemoryItems(value: unknown): CatchUpMemoryItem[] {
  if (!Array.isArray(value)) return [];

  const byKey = new Map<string, CatchUpMemoryItem>();
  const inputLength = Math.min(value.length, MAX_CATCH_UP_MEMORY_INPUT_ENTRIES);
  for (let index = 0; index < inputLength; index += 1) {
    const item = sanitizeCatchUpMemoryItem(value[index]);
    if (!item) continue;
    const key = itemKey(item);
    const existing = byKey.get(key);
    if (!existing || item.lastActivity >= existing.lastActivity) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => priority(b) - priority(a) || compareActivity(a, b))
    .slice(0, CATCH_UP_MEMORY_LIMIT);
}

/**
 * Build a durable snapshot from the live ranked catch-up list + optional recap
 * seeds and first-unread boundaries. Pure: does not touch storage.
 */
export function buildCatchUpMemorySnapshot(
  items: readonly CatchUpItem[],
  options: {
    firstUnreadId?: ReadonlyMap<string, string | null>;
    recaps?: ReadonlyMap<string, {
      preview: string;
      messageCount: number;
      mentionCount: number;
      firstMessageId: string | null;
      firstAt: string;
      voices: readonly string[];
    }>;
  } = {},
): CatchUpMemoryItem[] {
  const firstUnreadId = options.firstUnreadId ?? new Map<string, string | null>();
  const recaps = options.recaps ?? new Map();
  const raw: CatchUpMemoryItem[] = [];

  for (const item of items) {
    if (item.unread <= 0 && item.highlights <= 0) continue;
    const recap = recaps.get(item.target.toLowerCase());
    const boundary = firstUnreadId.get(item.target.toLowerCase()) ?? null;
    raw.push({
      key: item.key,
      kind: item.kind,
      name: item.name,
      target: item.target,
      unread: item.unread,
      highlights: item.highlights,
      followed: item.followed,
      lastActivity: item.lastActivity,
      firstUnreadId: boundary && boundary.length > 0 ? boundary : null,
      preview: recap?.preview ?? '',
      messageCount: recap?.messageCount ?? 0,
      mentionCount: recap?.mentionCount ?? 0,
      firstMessageId: recap?.firstMessageId ?? null,
      firstAt: recap?.firstAt ?? '',
      voices: recap?.voices ?? [],
    });
  }

  return parseCatchUpMemoryItems(raw);
}

/** Project a memory row back to the live catch-up item shape. */
export function catchUpItemFromMemory(item: CatchUpMemoryItem): CatchUpItem {
  return {
    key: item.key,
    kind: item.kind,
    name: item.name,
    target: item.target,
    unread: item.unread,
    highlights: item.highlights,
    followed: item.followed,
    lastActivity: item.lastActivity,
  };
}

/** firstUnreadId map reconstruction for resume-point cold paint. */
export function firstUnreadMapFromMemory(
  items: readonly CatchUpMemoryItem[],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const item of items) {
    if (item.firstUnreadId) map.set(item.target.toLowerCase(), item.firstUnreadId);
  }
  return map;
}

function publish(items: readonly CatchUpMemoryItem[], owner?: DeviceMemoryOwner): void {
  const scope = memoryStorageKey(owner);
  if (!scope) return;
  for (const listener of [...(listeners.get(scope) ?? [])]) {
    try {
      listener(items.map((item) => ({ ...item, voices: [...item.voices] })));
    } catch {
      // A consumer cannot prevent later listeners from receiving authoritative
      // device state.
    }
  }
}

/** Subscribe to verified same-tab catch-up memory changes. */
export function subscribeCatchUpMemory(
  listener: CatchUpMemoryListener,
  owner?: DeviceMemoryOwner,
): () => void {
  const scope = memoryStorageKey(owner);
  if (!scope) return () => {};
  const scoped = listeners.get(scope) ?? new Set<CatchUpMemoryListener>();
  scoped.add(listener);
  listeners.set(scope, scoped);
  return () => {
    scoped.delete(listener);
    if (scoped.size === 0) listeners.delete(scope);
  };
}

export function readCatchUpMemory(owner?: DeviceMemoryOwner): CatchUpMemoryItem[] {
  const store = storage();
  if (!store) return [];
  const storageKey = memoryStorageKey(owner);
  if (!storageKey) return [];
  try {
    const raw = store.getItem(storageKey);
    if (raw && raw.length > MAX_CATCH_UP_MEMORY_STORAGE_CHARS) return [];
    return parseCatchUpMemoryItems(JSON.parse(raw ?? '[]'));
  } catch {
    return [];
  }
}

/**
 * Replace the owner-scoped catch-up snapshot. Empty `items` clears storage so
 * a fully-caught-up live session does not resurrect a stale cold paint.
 */
export function writeCatchUpMemory(
  items: readonly unknown[],
  owner?: DeviceMemoryOwner,
): CatchUpMemoryItem[] {
  const next = parseCatchUpMemoryItems(items);
  const store = storage();
  const storageKey = memoryStorageKey(owner);
  if (!store || !storageKey) return readCatchUpMemory(owner);

  try {
    if (next.length === 0) store.removeItem(storageKey);
    else store.setItem(storageKey, JSON.stringify(next));
  } catch {
    const retained = readCatchUpMemory(owner);
    publish(retained, owner);
    return retained;
  }

  const committed = readCatchUpMemory(owner);
  if (next.length > 0 && !sameItems(committed, next)) {
    publish(committed, owner);
    return committed;
  }
  publish(committed, owner);
  return committed;
}

/** Clear one owner's catch-up snapshot (mark-all / logout hygiene). */
export function clearCatchUpMemory(owner?: DeviceMemoryOwner): CatchUpMemoryItem[] {
  return writeCatchUpMemory([], owner);
}
