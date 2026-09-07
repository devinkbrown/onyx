// SPDX-License-Identifier: AGPL-3.0-or-later
import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const COMPOSER_DRAFTS_KEY = 'onyx:composer-drafts';

/**
 * Bounds on persisted composer drafts. Drafts are unauthenticated local UI
 * state, so cap both the number of stored targets and the length of any single
 * draft to keep `onyx:composer-drafts` from growing without limit (a long paste
 * or many visited channels/DMs).
 */
export const MAX_COMPOSER_DRAFTS = 50;
export const MAX_DRAFT_LEN = 8192;
export const MAX_DRAFT_TARGET_LENGTH = 256;
export const MAX_COMPOSER_DRAFTS_STORAGE_CHARS = 3 * 1024 * 1024;

const INVALID_DRAFT_TARGET_CHARACTERS = /[\s,\x00-\x1f\x7f]/u;

export type ComposerDrafts = Record<string, string>;

export type ComposerDraftPersistenceStatus =
  | 'saved'
  | 'only-in-tab'
  | 'limit-reached'
  | 'malformed';

export interface ComposerDraftPersistenceResult {
  status: ComposerDraftPersistenceStatus;
  drafts: ComposerDrafts;
}

function draftsHitLimit(drafts: ComposerDrafts): boolean {
  return Object.keys(drafts).length > MAX_COMPOSER_DRAFTS
    || Object.values(drafts).some((draft) => draft.length > MAX_DRAFT_LEN);
}

/**
 * Enforce the count bound deterministically. Drafts carry no timestamp, so we
 * retain an insertion-stable subset: the first {@link MAX_COMPOSER_DRAFTS}
 * entries in key-insertion order and drop the excess. On the write path this
 * means once the cap is reached a brand-new target's draft is not persisted,
 * while updates to already-stored targets keep working.
 */
function capDraftCount(drafts: ComposerDrafts): ComposerDrafts {
  const keys = Object.keys(drafts);
  if (keys.length <= MAX_COMPOSER_DRAFTS) return drafts;

  const kept: ComposerDrafts = {};
  for (const key of keys.slice(0, MAX_COMPOSER_DRAFTS)) {
    const value = drafts[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOrDefault(storage?: DraftStorage): DraftStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function composerDraftKey(target: string): string {
  const key = target.trim().toLowerCase();
  if (
    key.length === 0
    || key.length > MAX_DRAFT_TARGET_LENGTH
    || INVALID_DRAFT_TARGET_CHARACTERS.test(key)
  ) return '';
  return key;
}

export function sanitizeComposerDrafts(value: unknown): ComposerDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const drafts: ComposerDrafts = {};
  for (const [target, draft] of Object.entries(value)) {
    const key = composerDraftKey(target);
    if (!key || typeof draft !== 'string' || draft.length === 0) continue;
    drafts[key] = draft.slice(0, MAX_DRAFT_LEN);
  }
  return capDraftCount(drafts);
}

export function loadComposerDrafts(
  storage?: DraftStorage,
  owner?: DeviceMemoryOwner,
): ComposerDrafts {
  const resolved = storageOrDefault(storage);
  if (!resolved) return {};
  const storageKey = deviceMemoryStorageKey(COMPOSER_DRAFTS_KEY, owner);
  if (!storageKey) return {};
  try {
    const raw = resolved.getItem(storageKey);
    if (raw && raw.length > MAX_COMPOSER_DRAFTS_STORAGE_CHARS) return {};
    return raw ? sanitizeComposerDrafts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function loadComposerDraftsWithStatus(
  storage?: DraftStorage,
  owner?: DeviceMemoryOwner,
): ComposerDraftPersistenceResult {
  const resolved = storageOrDefault(storage);
  const storageKey = deviceMemoryStorageKey(COMPOSER_DRAFTS_KEY, owner);
  if (!resolved || !storageKey) return { status: 'only-in-tab', drafts: {} };
  try {
    const raw = resolved.getItem(storageKey);
    if (!raw) return { status: 'saved', drafts: {} };
    if (raw.length > MAX_COMPOSER_DRAFTS_STORAGE_CHARS) {
      return { status: 'malformed', drafts: {} };
    }
    const parsed = JSON.parse(raw);
    return { status: 'saved', drafts: sanitizeComposerDrafts(parsed) };
  } catch {
    return { status: 'malformed', drafts: {} };
  }
}

export function saveComposerDrafts(
  drafts: ComposerDrafts,
  storage?: DraftStorage,
  owner?: DeviceMemoryOwner,
): ComposerDraftPersistenceResult {
  const resolved = storageOrDefault(storage);
  const sanitized = sanitizeComposerDrafts(drafts);
  const limited = draftsHitLimit(drafts);
  if (!resolved) return { status: limited ? 'limit-reached' : 'only-in-tab', drafts: sanitized };
  const storageKey = deviceMemoryStorageKey(COMPOSER_DRAFTS_KEY, owner);
  if (!storageKey) return { status: limited ? 'limit-reached' : 'only-in-tab', drafts: sanitized };

  try {
    if (Object.keys(sanitized).length === 0) {
      resolved.removeItem(storageKey);
      if (resolved.getItem(storageKey) !== null) {
        return { status: 'only-in-tab', drafts: sanitized };
      }
      return { status: limited ? 'limit-reached' : 'saved', drafts: sanitized };
    }
    const serialized = JSON.stringify(sanitized);
    resolved.setItem(storageKey, serialized);
    if (resolved.getItem(storageKey) !== serialized) {
      return { status: 'only-in-tab', drafts: sanitized };
    }
    return { status: limited ? 'limit-reached' : 'saved', drafts: sanitized };
  } catch {
    return { status: 'only-in-tab', drafts: sanitized };
  }
}

export interface ClearRoomComposerDraftsResult {
  success: boolean;
  cleared: number;
  remaining: number;
}

function isRoomDraftTarget(target: string): boolean {
  return target.startsWith('#') || target.startsWith('&');
}

/**
 * Remove only persisted room composer drafts and verify the committed shape.
 * DM drafts are intentionally retained: portable transfer excludes that
 * plaintext, and this room/topic control must not silently broaden its scope.
 */
export function clearRoomComposerDrafts(
  storage?: DraftStorage,
  owner?: DeviceMemoryOwner,
): ClearRoomComposerDraftsResult {
  const resolved = storageOrDefault(storage);
  const storageKey = deviceMemoryStorageKey(COMPOSER_DRAFTS_KEY, owner);
  const before = loadComposerDrafts(storage, owner);
  const roomKeys = Object.keys(before).filter(isRoomDraftTarget);
  if (!resolved || !storageKey) {
    return { success: false, cleared: 0, remaining: roomKeys.length };
  }

  const retained = Object.fromEntries(
    Object.entries(before).filter(([target]) => !isRoomDraftTarget(target)),
  );
  try {
    if (Object.keys(retained).length === 0) resolved.removeItem(storageKey);
    else resolved.setItem(storageKey, JSON.stringify(retained));

    const committed = loadComposerDrafts(storage, owner);
    const remaining = Object.keys(committed).filter(isRoomDraftTarget).length;
    const retainedCommitted = Object.fromEntries(
      Object.entries(committed).filter(([target]) => !isRoomDraftTarget(target)),
    );
    const keyShapeVerified = Object.keys(retained).length > 0
      || resolved.getItem(storageKey) === null;
    const success = keyShapeVerified
      && remaining === 0
      && JSON.stringify(retainedCommitted) === JSON.stringify(retained);
    return {
      success,
      cleared: success ? roomKeys.length : 0,
      remaining,
    };
  } catch {
    const remaining = Object.keys(loadComposerDrafts(storage, owner)).filter(isRoomDraftTarget).length;
    return { success: false, cleared: 0, remaining };
  }
}

export function setComposerDraft(
  drafts: ComposerDrafts,
  target: string,
  text: string,
): ComposerDrafts {
  const key = composerDraftKey(target);
  if (!key) return drafts;

  const next = { ...drafts };
  if (text.length === 0) {
    delete next[key];
  } else {
    next[key] = text.slice(0, MAX_DRAFT_LEN);
  }
  return capDraftCount(next);
}

export function getComposerDraft(drafts: ComposerDrafts, target: string): string {
  return drafts[composerDraftKey(target)] ?? '';
}
