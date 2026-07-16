// SPDX-License-Identifier: AGPL-3.0-or-later

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const CUSTOM_EMOJI_STORAGE_KEY = 'onyx:custom-emoji';
export const RECENT_EMOJI_STORAGE_KEY = 'onyx:recent-emoji';
export const FAVORITE_EMOJI_STORAGE_KEY = 'onyx:fav-emojis';
export const EMOJI_USAGE_STORAGE_KEY = 'onyx:emoji-usage';

export const MAX_CUSTOM_EMOJI = 128;
export const MAX_RECENT_EMOJIS = 20;
export const MAX_FAVORITE_EMOJIS = 64;
export const MAX_EMOJI_USAGE_ENTRIES = 256;
export const MAX_EMOJI_USAGE_COUNT = 1_000_000;

const MAX_EMOJI_STORAGE_CHARS = 256 * 1024;
const MAX_EMOJI_TOKEN_LENGTH = 64;
const MAX_EMOJI_NAME_LENGTH = 64;
const MAX_EMOJI_URL_LENGTH = 2_048;
const MAX_EMOJI_AUTHOR_LENGTH = 128;
const SHORTCODE_PATTERN = /^:[a-z0-9][a-z0-9_+-]{0,61}:$/;
const CUSTOM_NAME_PATTERN = /^[a-z0-9][a-z0-9_+-]{0,63}$/;
const CONTROL_OR_WHITESPACE_PATTERN = /[\u0000-\u001f\u007f-\u009f\s]/u;
const ASCII_PATTERN = /^[\u0000-\u007f]*$/;
const EMOJI_CODE_POINT_PATTERN = /\p{Emoji}/u;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const DEFAULT_FAVORITE_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export interface CustomEmoji {
  name: string;
  url: string;
  addedBy?: string;
}

export interface EmojiMemory {
  customEmoji: CustomEmoji[];
  recentEmojis: string[];
  favoriteEmojis: string[];
  emojiUsageCounts: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function ownerStorageKey(baseKey: string, owner?: DeviceMemoryOwner): string | null {
  return owner ? deviceMemoryStorageKey(baseKey, owner) : null;
}

function parseStoredValue(store: Storage, key: string): unknown | null {
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_EMOJI_STORAGE_CHARS) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function serializeUsage(value: Record<string, number>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    )),
  ));
}

/** Ownerless emoji choices are ambiguous after upgrade and are never claimed. */
export function purgeLegacyEmojiMemory(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(CUSTOM_EMOJI_STORAGE_KEY);
    store.removeItem(RECENT_EMOJI_STORAGE_KEY);
    store.removeItem(FAVORITE_EMOJI_STORAGE_KEY);
    store.removeItem(EMOJI_USAGE_STORAGE_KEY);
    return [
      CUSTOM_EMOJI_STORAGE_KEY,
      RECENT_EMOJI_STORAGE_KEY,
      FAVORITE_EMOJI_STORAGE_KEY,
      EMOJI_USAGE_STORAGE_KEY,
    ].every(key => store.getItem(key) === null);
  } catch {
    return false;
  }
}

/** Admit an inert emoji glyph or a strict, lowercase `:shortcode:` token. */
export function normalizeEmojiToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (
    token.length === 0
    || token.length > MAX_EMOJI_TOKEN_LENGTH
    || CONTROL_OR_WHITESPACE_PATTERN.test(token)
    || UNSAFE_RECORD_KEYS.has(token)
  ) return null;
  if (ASCII_PATTERN.test(token)) {
    const normalized = token.toLowerCase();
    return SHORTCODE_PATTERN.test(normalized) ? normalized : null;
  }
  return EMOJI_CODE_POINT_PATTERN.test(token) ? token : null;
}

/** Normalize the bare name used to address one custom emoji. */
export function normalizeCustomEmojiName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return CUSTOM_NAME_PATTERN.test(name) ? name : null;
}

/** Admit only absolute, credential-free HTTP(S) image locations. */
export function normalizeCustomEmojiUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (
    candidate.length === 0
    || candidate.length > MAX_EMOJI_URL_LENGTH
    || CONTROL_OR_WHITESPACE_PATTERN.test(candidate)
  ) return null;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.href.length > MAX_EMOJI_URL_LENGTH
    ) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeEmojiAuthor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const author = value.trim();
  if (
    author.length === 0
    || author.length > MAX_EMOJI_AUTHOR_LENGTH
    || CONTROL_OR_WHITESPACE_PATTERN.test(author)
  ) return null;
  return author;
}

/** Sanitize custom emoji records independently and deduplicate canonical names. */
export function normalizeCustomEmojis(value: unknown): CustomEmoji[] {
  if (!Array.isArray(value)) return [];
  const emojis: CustomEmoji[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (emojis.length >= MAX_CUSTOM_EMOJI) break;
    if (!isRecord(entry)) continue;
    const name = normalizeCustomEmojiName(entry.name);
    const url = normalizeCustomEmojiUrl(entry.url);
    if (!name || !url || seen.has(name)) continue;
    seen.add(name);
    const addedBy = normalizeEmojiAuthor(entry.addedBy);
    emojis.push(addedBy ? { name, url, addedBy } : { name, url });
  }
  return emojis;
}

/** Sanitize, deduplicate, and bound one emoji token list. */
export function normalizeEmojiTokens(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (tokens.length >= limit) break;
    const token = normalizeEmojiToken(entry);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/** Sanitize a bounded positive-integer usage ledger without prototype keys. */
export function normalizeEmojiUsageCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const counts: Record<string, number> = {};
  let accepted = 0;
  for (const [rawToken, rawCount] of Object.entries(value)) {
    if (accepted >= MAX_EMOJI_USAGE_ENTRIES) break;
    const token = normalizeEmojiToken(rawToken);
    if (
      !token
      || Object.hasOwn(counts, token)
      || typeof rawCount !== 'number'
      || !Number.isSafeInteger(rawCount)
      || rawCount <= 0
      || rawCount > MAX_EMOJI_USAGE_COUNT
    ) continue;
    counts[token] = rawCount;
    accepted += 1;
  }
  return counts;
}

export function emptyEmojiMemory(): EmojiMemory {
  return {
    customEmoji: [],
    recentEmojis: [],
    favoriteEmojis: [...DEFAULT_FAVORITE_EMOJIS],
    emojiUsageCounts: {},
  };
}

/** Load exactly one endpoint+account/guest namespace; ownerless reads stay generic. */
export function loadEmojiMemory(owner?: DeviceMemoryOwner): EmojiMemory {
  const store = storage();
  purgeLegacyEmojiMemory();
  if (!store || !owner) return emptyEmojiMemory();
  const customKey = ownerStorageKey(CUSTOM_EMOJI_STORAGE_KEY, owner);
  const recentKey = ownerStorageKey(RECENT_EMOJI_STORAGE_KEY, owner);
  const favoriteKey = ownerStorageKey(FAVORITE_EMOJI_STORAGE_KEY, owner);
  const usageKey = ownerStorageKey(EMOJI_USAGE_STORAGE_KEY, owner);
  if (!customKey || !recentKey || !favoriteKey || !usageKey) return emptyEmojiMemory();

  const favoriteValue = parseStoredValue(store, favoriteKey);
  return {
    customEmoji: normalizeCustomEmojis(parseStoredValue(store, customKey)),
    recentEmojis: normalizeEmojiTokens(parseStoredValue(store, recentKey), MAX_RECENT_EMOJIS),
    favoriteEmojis: favoriteValue === null
      ? [...DEFAULT_FAVORITE_EMOJIS]
      : normalizeEmojiTokens(favoriteValue, MAX_FAVORITE_EMOJIS),
    emojiUsageCounts: normalizeEmojiUsageCounts(parseStoredValue(store, usageKey)),
  };
}

function saveOwnedValue<T>(
  baseKey: string,
  serialized: string,
  isEmpty: boolean,
  owner: DeviceMemoryOwner | undefined,
  verify: () => T,
  matches: (value: T) => boolean,
): T | null {
  const store = storage();
  purgeLegacyEmojiMemory();
  const key = ownerStorageKey(baseKey, owner);
  if (!store || !owner || !key || serialized.length > MAX_EMOJI_STORAGE_CHARS) return null;
  try {
    if (isEmpty) store.removeItem(key);
    else store.setItem(key, serialized);
    const verified = verify();
    return matches(verified) ? verified : null;
  } catch {
    return null;
  }
}

export function saveCustomEmojis(
  value: unknown,
  owner?: DeviceMemoryOwner,
): CustomEmoji[] | null {
  const emojis = normalizeCustomEmojis(value);
  const serialized = JSON.stringify(emojis);
  return saveOwnedValue(
    CUSTOM_EMOJI_STORAGE_KEY,
    serialized,
    emojis.length === 0,
    owner,
    () => loadEmojiMemory(owner).customEmoji,
    verified => JSON.stringify(verified) === serialized,
  );
}

export function saveRecentEmojis(
  value: unknown,
  owner?: DeviceMemoryOwner,
): string[] | null {
  const emojis = normalizeEmojiTokens(value, MAX_RECENT_EMOJIS);
  const serialized = JSON.stringify(emojis);
  return saveOwnedValue(
    RECENT_EMOJI_STORAGE_KEY,
    serialized,
    emojis.length === 0,
    owner,
    () => loadEmojiMemory(owner).recentEmojis,
    verified => JSON.stringify(verified) === serialized,
  );
}

export function saveFavoriteEmojis(
  value: unknown,
  owner?: DeviceMemoryOwner,
): string[] | null {
  const emojis = normalizeEmojiTokens(value, MAX_FAVORITE_EMOJIS);
  const serialized = JSON.stringify(emojis);
  // An explicit empty favorites list is meaningful and must not reload defaults.
  return saveOwnedValue(
    FAVORITE_EMOJI_STORAGE_KEY,
    serialized,
    false,
    owner,
    () => loadEmojiMemory(owner).favoriteEmojis,
    verified => JSON.stringify(verified) === serialized,
  );
}

export function saveEmojiUsageCounts(
  value: unknown,
  owner?: DeviceMemoryOwner,
): Record<string, number> | null {
  const counts = normalizeEmojiUsageCounts(value);
  const serialized = serializeUsage(counts);
  return saveOwnedValue(
    EMOJI_USAGE_STORAGE_KEY,
    serialized,
    Object.keys(counts).length === 0,
    owner,
    () => loadEmojiMemory(owner).emojiUsageCounts,
    verified => serializeUsage(verified) === serialized,
  );
}
