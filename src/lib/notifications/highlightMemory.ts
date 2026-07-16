// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const HIGHLIGHT_WORDS_STORAGE_KEY = 'onyx:highlight-words';
export const MAX_HIGHLIGHT_WORDS = 128;
export const MAX_HIGHLIGHT_WORD_LENGTH = 256;
export const MAX_HIGHLIGHT_WORDS_STORAGE_CHARS = 128 * 1024;

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;

/** Normalize untrusted custom highlight terms into a bounded unique list. */
export function parseHighlightWords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const words = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const word = raw.trim().toLowerCase();
    if (
      word.length === 0
      || word.length > MAX_HIGHLIGHT_WORD_LENGTH
      || CONTROL_CHARACTERS.test(word)
    ) continue;
    words.add(word);
    if (words.size >= MAX_HIGHLIGHT_WORDS) break;
  }
  return [...words];
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  return deviceMemoryStorageKey(HIGHLIGHT_WORDS_STORAGE_KEY, owner);
}

/** Purge private ownerless terms instead of assigning them to the next login. */
export function purgeLegacyHighlightWords(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(HIGHLIGHT_WORDS_STORAGE_KEY);
    return store.getItem(HIGHLIGHT_WORDS_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function loadHighlightWords(owner?: DeviceMemoryOwner): string[] {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return [];
  if (owner !== undefined) purgeLegacyHighlightWords();
  try {
    const raw = store.getItem(key);
    if (raw && raw.length > MAX_HIGHLIGHT_WORDS_STORAGE_CHARS) return [];
    return raw ? parseHighlightWords(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function saveHighlightWords(
  value: readonly string[],
  owner?: DeviceMemoryOwner,
): boolean {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return false;
  const words = parseHighlightWords(value);
  const serialized = JSON.stringify(words);
  try {
    if (words.length === 0) store.removeItem(key);
    else store.setItem(key, serialized);
    return JSON.stringify(loadHighlightWords(owner)) === serialized;
  } catch {
    return false;
  }
}
