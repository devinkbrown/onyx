// SPDX-License-Identifier: AGPL-3.0-or-later
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export type ReviewHistoryKind = 'channel' | 'dm';

export interface ReviewHistoryEntry {
  target: string;
  name: string;
  kind: ReviewHistoryKind;
  firstMessageId: string;
  firstAt: string;
  reviewedAt: string;
  messageCount: number;
  mentionCount: number;
  preview: string;
}

/**
 * A trusted, side-effect-free instruction for reopening one reviewed anchor.
 * `at` is deliberately nullable: an exact message id remains safe to focus
 * when imported history contains a malformed timestamp, but time travel must
 * fail closed rather than normalizing or sending that timestamp.
 */
export interface ReviewedAnchorRecallPlan {
  kind: ReviewHistoryKind;
  target: string;
  messageId: string;
  at: Date | null;
}

export interface ClearReviewHistoryResult {
  success: boolean;
  cleared: number;
  remaining: number;
}

export type ReviewHistoryListener = (entries: readonly ReviewHistoryEntry[]) => void;

export const REVIEW_HISTORY_KEY = 'onyx:home-review-history';
const REVIEW_HISTORY_LIMIT = 5;
export const MAX_REVIEW_HISTORY_INPUT_ENTRIES = 256;
export const MAX_REVIEW_HISTORY_NAME_LENGTH = 128;
export const MAX_REVIEW_HISTORY_PREVIEW_LENGTH = 512;

const MAX_CHANNEL_TARGET_LENGTH = 128;
const MAX_DM_TARGET_LENGTH = 64;
const MAX_MESSAGE_ID_LENGTH = 512;
const TARGET_INVALID_PATTERN = /[\s,\x00-\x1f\x7f]/u;
const MESSAGE_ID_CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;
const DISPLAY_TEXT_CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;
const CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const listeners = new Map<string, Set<ReviewHistoryListener>>();

function canonicalInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || (value.length !== 20 && value.length !== 24)) return null;
  if (value !== value.trim() || !CANONICAL_INSTANT_PATTERN.test(value)) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const canonicalValue = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
    return instant.toISOString() === canonicalValue ? instant : null;
  } catch {
    return null;
  }
}

function canonicalTimestamp(value: unknown): string | null {
  return canonicalInstant(value)?.toISOString() ?? null;
}

function normalizeTarget(value: unknown, kind: ReviewHistoryKind): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const maxLength = kind === 'channel' ? MAX_CHANNEL_TARGET_LENGTH : MAX_DM_TARGET_LENGTH;
  if (value.length > maxLength || value !== value.trim()) return null;
  const channelTarget = value.startsWith('#') || value.startsWith('&');
  if (
    TARGET_INVALID_PATTERN.test(value)
    || (kind === 'channel'
      ? !channelTarget
      : channelTarget)
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
  // Reject before regex/replacement work so hostile multi-megabyte strings do
  // not turn a five-row reviewed-anchor feature into an unbounded text pass.
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

function sanitizeReviewHistoryEntry(value: unknown): ReviewHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const kind = item.kind === 'channel' || item.kind === 'dm' ? item.kind : null;
  if (!kind) return null;

  const target = normalizeTarget(item.target, kind);
  const name = normalizeDisplayText(item.name, MAX_REVIEW_HISTORY_NAME_LENGTH, false);
  const firstMessageId = normalizeMessageId(item.firstMessageId);
  const reviewedAt = canonicalTimestamp(item.reviewedAt);
  const messageCount = normalizeCount(item.messageCount);
  const mentionCount = normalizeCount(item.mentionCount);
  const preview = normalizeDisplayText(item.preview, MAX_REVIEW_HISTORY_PREVIEW_LENGTH, true);
  if (
    !target || !name || !firstMessageId || !reviewedAt
    || messageCount === null || mentionCount === null || preview === null
    || mentionCount > messageCount
    || typeof item.firstAt !== 'string'
  ) return null;

  // Existing recall intentionally treats a malformed firstAt as "exact id
  // only". Preserve that useful fail-closed contract without retaining the
  // untrusted timestamp string itself.
  const firstAt = canonicalTimestamp(item.firstAt) ?? '';
  return {
    target,
    name,
    kind,
    firstMessageId,
    firstAt,
    reviewedAt,
    messageCount,
    mentionCount,
    preview,
  };
}

/**
 * Validate a persisted reviewed anchor without reading storage or mutating the
 * store. Target and message id are required for any recall. A bad `firstAt`
 * only disables time travel; callers can still navigate and focus the exact id.
 */
export function planReviewedAnchorRecall(
  entry: unknown,
): ReviewedAnchorRecallPlan | null {
  const safe = sanitizeReviewHistoryEntry(entry);
  if (!safe) return null;

  return {
    kind: safe.kind,
    target: safe.target,
    messageId: safe.firstMessageId,
    at: canonicalInstant(safe.firstAt),
  };
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function reviewHistoryKey(entry: ReviewHistoryEntry): string {
  return `${entry.kind}:${entry.target.toLowerCase()}:${entry.firstMessageId}`;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNewest(left: ReviewHistoryEntry, right: ReviewHistoryEntry): number {
  const timeOrder = Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt);
  return timeOrder || compareText(reviewHistoryKey(left), reviewHistoryKey(right));
}

function sameEntries(
  left: readonly ReviewHistoryEntry[],
  right: readonly ReviewHistoryEntry[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reviewStorageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(REVIEW_HISTORY_KEY, owner);
}

function publish(entries: readonly ReviewHistoryEntry[], owner?: DeviceMemoryOwner): void {
  const scope = reviewStorageKey(owner);
  if (!scope) return;
  for (const listener of [...(listeners.get(scope) ?? [])]) {
    try {
      listener(entries.map((entry) => ({ ...entry })));
    } catch {
      // A consumer cannot prevent later listeners from receiving authoritative
      // device state.
    }
  }
}

/** Subscribe to verified same-tab reviewed-anchor changes. */
export function subscribeReviewHistory(
  listener: ReviewHistoryListener,
  owner?: DeviceMemoryOwner,
): () => void {
  const scope = reviewStorageKey(owner);
  if (!scope) return () => {};
  const scoped = listeners.get(scope) ?? new Set<ReviewHistoryListener>();
  scoped.add(listener);
  listeners.set(scope, scoped);
  return () => {
    scoped.delete(listener);
    if (scoped.size === 0) listeners.delete(scope);
  };
}

export function parseReviewHistoryEntries(value: unknown): ReviewHistoryEntry[] {
  if (!Array.isArray(value)) return [];

  const byKey = new Map<string, ReviewHistoryEntry>();
  const inputLength = Math.min(value.length, MAX_REVIEW_HISTORY_INPUT_ENTRIES);
  for (let index = 0; index < inputLength; index += 1) {
    const entry = sanitizeReviewHistoryEntry(value[index]);
    if (!entry) continue;
    const key = reviewHistoryKey(entry);
    const existing = byKey.get(key);
    if (!existing || Date.parse(entry.reviewedAt) > Date.parse(existing.reviewedAt)) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()]
    .sort(compareNewest)
    .slice(0, REVIEW_HISTORY_LIMIT);
}

export function readReviewHistory(owner?: DeviceMemoryOwner): ReviewHistoryEntry[] {
  const store = storage();
  if (!store) return [];
  const storageKey = reviewStorageKey(owner);
  if (!storageKey) return [];
  try {
    const raw = store.getItem(storageKey);
    const parsed = JSON.parse(raw ?? '[]');
    return parseReviewHistoryEntries(parsed);
  } catch {
    return [];
  }
}

export function latestReviewForTarget(
  target: string,
  kind?: ReviewHistoryKind,
  owner?: DeviceMemoryOwner,
): ReviewHistoryEntry | null {
  const key = target.toLowerCase();
  return readReviewHistory(owner).find((entry) =>
    entry.target.toLowerCase() === key && (kind === undefined || entry.kind === kind),
  ) ?? null;
}

export function recordReviewHistory(
  entry: ReviewHistoryEntry,
  owner?: DeviceMemoryOwner,
): ReviewHistoryEntry[] {
  const current = readReviewHistory(owner);
  const safe = sanitizeReviewHistoryEntry(entry);
  if (!safe) return current;
  const store = storage();
  const storageKey = reviewStorageKey(owner);
  if (!store || !storageKey) return current;

  const next = parseReviewHistoryEntries([safe, ...current]);

  try {
    store.setItem(storageKey, JSON.stringify(next));
  } catch {
    const retained = readReviewHistory(owner);
    publish(retained, owner);
    return retained;
  }
  const committed = readReviewHistory(owner);
  if (!sameEntries(committed, next)) {
    publish(committed, owner);
    return committed;
  }
  publish(committed, owner);
  return committed;
}

export function mergeReviewHistory(
  entries: readonly unknown[],
  owner?: DeviceMemoryOwner,
): { imported: number; total: number } {
  const imported = parseReviewHistoryEntries(entries);
  const current = readReviewHistory(owner);
  const store = storage();
  const storageKey = reviewStorageKey(owner);
  if (!store || !storageKey || imported.length === 0) {
    return { imported: 0, total: current.length };
  }

  // Existing entries come first, so an imported collision with the exact same
  // reviewedAt cannot overwrite device-local display metadata. A strictly
  // newer reviewedAt still wins in parseReviewHistoryEntries.
  const next = parseReviewHistoryEntries([...current, ...imported]);

  try {
    store.setItem(storageKey, JSON.stringify(next));
  } catch {
    const retained = readReviewHistory(owner);
    publish(retained, owner);
    return { imported: 0, total: retained.length };
  }
  const committed = readReviewHistory(owner);
  publish(committed, owner);
  if (!sameEntries(committed, next)) return { imported: 0, total: committed.length };

  const retainedImported = imported.filter((entry) =>
    committed.some((item) => reviewHistoryKey(item) === reviewHistoryKey(entry)
      && JSON.stringify(item) === JSON.stringify(entry)),
  ).length;
  return { imported: retainedImported, total: committed.length };
}

/**
 * Remove only device-local reviewed anchors and verify the authoritative key
 * state before reporting success. Message history, topic cursors, searches,
 * drafts, and every other local surface are deliberately outside this boundary.
 */
export function clearReviewHistory(owner?: DeviceMemoryOwner): ClearReviewHistoryResult {
  const before = readReviewHistory(owner);
  const store = storage();
  const storageKey = reviewStorageKey(owner);
  if (!store || !storageKey) {
    publish(before, owner);
    return { success: false, cleared: 0, remaining: before.length };
  }

  try {
    store.removeItem(storageKey);
    const keyRemoved = store.getItem(storageKey) === null;
    const remaining = readReviewHistory(owner);
    publish(remaining, owner);
    if (!keyRemoved || remaining.length > 0) {
      return { success: false, cleared: 0, remaining: remaining.length };
    }
    return { success: true, cleared: before.length, remaining: 0 };
  } catch {
    const retained = readReviewHistory(owner);
    publish(retained, owner);
    return { success: false, cleared: 0, remaining: retained.length };
  }
}
