export const COMPOSER_DRAFTS_KEY = 'onyx:composer-drafts';

export type ComposerDrafts = Record<string, string>;

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
    drafts[key] = draft;
  }
  return drafts;
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
    next[key] = text;
  }
  return next;
}

export function getComposerDraft(drafts: ComposerDrafts, target: string): string {
  return drafts[composerDraftKey(target)] ?? '';
}
