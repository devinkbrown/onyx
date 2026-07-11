// SPDX-License-Identifier: AGPL-3.0-or-later
export const COMPOSER_DRAFTS_KEY = 'onyx:composer-drafts';

/**
 * Bounds on persisted composer drafts. Drafts are unauthenticated local UI
 * state, so cap both the number of stored targets and the length of any single
 * draft to keep `onyx:composer-drafts` from growing without limit (a long paste
 * or many visited channels/DMs).
 */
export const MAX_COMPOSER_DRAFTS = 50;
export const MAX_DRAFT_LEN = 8192;

export type ComposerDrafts = Record<string, string>;

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
  return target.trim().toLowerCase();
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

export function loadComposerDrafts(storage?: DraftStorage): ComposerDrafts {
  const resolved = storageOrDefault(storage);
  if (!resolved) return {};
  try {
    const raw = resolved.getItem(COMPOSER_DRAFTS_KEY);
    return raw ? sanitizeComposerDrafts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveComposerDrafts(drafts: ComposerDrafts, storage?: DraftStorage): void {
  const resolved = storageOrDefault(storage);
  if (!resolved) return;

  const sanitized = sanitizeComposerDrafts(drafts);
  try {
    if (Object.keys(sanitized).length === 0) {
      resolved.removeItem(COMPOSER_DRAFTS_KEY);
      return;
    }
    resolved.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify(sanitized));
  } catch {}
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
