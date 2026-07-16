// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure sanitizers for values loaded back out of localStorage.
//
// localStorage is untrusted input: it can be corrupted, written by an older
// build, or clobbered by another tab. A raw `JSON.parse(...) as string[]` cast
// is unsound — valid-but-wrong-shape JSON (`{}`, `"x"`, `5`, `null`) parses
// without throwing, so the cast silently yields a non-array. Downstream array
// methods (`.some`, `.filter`, spread) then throw. Sanitize at the boundary.

/**
 * Parse a persisted JSON string into a `string[]`, discarding anything that is
 * not a JSON array of strings. Always returns an array — never throws.
 */
const MAX_PERSISTED_COLLECTION_BYTES = 512 * 1024;
const MAX_PERSISTED_STRING_ITEMS = 256;
const MAX_PERSISTED_STRING_LENGTH = 512;
const MAX_PERSISTED_EMOJI_ITEMS = 256;
const MAX_EMOJI_NAME_LENGTH = 64;
const MAX_EMOJI_URL_LENGTH = 2_048;
const MAX_EMOJI_AUTHOR_LENGTH = 128;
const MAX_PERSISTED_RECORD_ENTRIES = 256;
const MAX_PERSISTED_RECORD_KEY_LENGTH = 512;
const MAX_PERSISTED_RECORD_VALUE_LENGTH = 2_048;
const MAX_PERSISTED_NESTED_ITEMS = 32;

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw || raw.length > MAX_PERSISTED_COLLECTION_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeRecordKey(key: string): boolean {
  return key.length > 0
    && key.length <= MAX_PERSISTED_RECORD_KEY_LENGTH
    && key !== '__proto__'
    && key !== 'prototype'
    && key !== 'constructor';
}

/** Parse a bounded plain string record, retaining valid siblings on corruption. */
export function parseStringRecord(raw: string | null): Record<string, string> {
  const parsed = parseRecord(raw);
  const out: Record<string, string> = {};
  if (!parsed) return out;
  let accepted = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (accepted >= MAX_PERSISTED_RECORD_ENTRIES) break;
    if (
      safeRecordKey(key)
      && typeof value === 'string'
      && value.length <= MAX_PERSISTED_RECORD_VALUE_LENGTH
    ) {
      out[key] = value;
      accepted += 1;
    }
  }
  return out;
}

/** Parse non-negative integer counters used by bounded local usage ledgers. */
export function parseCounterRecord(raw: string | null): Record<string, number> {
  const parsed = parseRecord(raw);
  const out: Record<string, number> = {};
  if (!parsed) return out;
  let accepted = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (accepted >= MAX_PERSISTED_RECORD_ENTRIES) break;
    if (
      safeRecordKey(key)
      && typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
    ) {
      out[key] = value;
      accepted += 1;
    }
  }
  return out;
}

/** Parse a bounded record of bounded string arrays (for per-target histories). */
export function parseStringArrayRecord(raw: string | null): Record<string, string[]> {
  const parsed = parseRecord(raw);
  const out: Record<string, string[]> = {};
  if (!parsed) return out;
  let accepted = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (accepted >= MAX_PERSISTED_RECORD_ENTRIES) break;
    if (!safeRecordKey(key) || !Array.isArray(value)) continue;
    const items: string[] = [];
    for (const item of value) {
      if (items.length >= MAX_PERSISTED_NESTED_ITEMS) break;
      if (typeof item === 'string' && item.length <= MAX_PERSISTED_STRING_LENGTH) {
        items.push(item);
      }
    }
    out[key] = items;
    accepted += 1;
  }
  return out;
}

export function parseStringArray(raw: string | null): string[] {
  if (!raw || raw.length > MAX_PERSISTED_COLLECTION_BYTES) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const value of parsed) {
      if (out.length >= MAX_PERSISTED_STRING_ITEMS) break;
      if (typeof value === 'string' && value.length <= MAX_PERSISTED_STRING_LENGTH) {
        out.push(value);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** A persisted custom-emoji record. `url` is a display source, never a secret. */
export interface CustomEmoji {
  name: string;
  url: string;
  addedBy?: string;
}

export interface PersistedWatchEntry {
  nick: string;
  online: false;
  lastSeen?: Date;
}

/**
 * Parse a persisted JSON string into a `CustomEmoji[]`, discarding anything that
 * is not a JSON array of `{ name: string; url: string }` records. Always returns
 * an array — never throws. A non-array (e.g. `{}` from a clobbered key) would
 * otherwise crash the first `addCustomEmoji`/`removeCustomEmoji` action, which
 * spreads/`.filter`s the value.
 */
export function parseEmojiArray(raw: string | null): CustomEmoji[] {
  if (!raw || raw.length > MAX_PERSISTED_COLLECTION_BYTES) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomEmoji[] = [];
    for (const item of parsed) {
      if (out.length >= MAX_PERSISTED_EMOJI_ITEMS) break;
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      if (
        typeof rec.name !== 'string'
        || rec.name.length === 0
        || rec.name.length > MAX_EMOJI_NAME_LENGTH
        || typeof rec.url !== 'string'
        || rec.url.length === 0
        || rec.url.length > MAX_EMOJI_URL_LENGTH
      ) continue;
      const emoji: CustomEmoji = { name: rec.name, url: rec.url };
      if (typeof rec.addedBy === 'string' && rec.addedBy.length <= MAX_EMOJI_AUTHOR_LENGTH) {
        emoji.addedBy = rec.addedBy;
      }
      out.push(emoji);
    }
    return out;
  } catch {
    return [];
  }
}

/** Parse the persisted WATCH roster without trusting entry shape or dates. */
export function parseWatchList(raw: string | null): PersistedWatchEntry[] {
  if (!raw || raw.length > MAX_PERSISTED_COLLECTION_BYTES) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: PersistedWatchEntry[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    if (out.length >= MAX_PERSISTED_STRING_ITEMS) break;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (
      typeof record.nick !== 'string'
      || record.nick.length === 0
      || record.nick.length > 128
    ) continue;
    const key = record.nick.toLocaleLowerCase('en');
    if (seen.has(key)) continue;
    seen.add(key);

    const entry: PersistedWatchEntry = { nick: record.nick, online: false };
    if (typeof record.lastSeen === 'string' && record.lastSeen.length <= 64) {
      const lastSeen = new Date(record.lastSeen);
      if (Number.isFinite(lastSeen.getTime())) entry.lastSeen = lastSeen;
    }
    out.push(entry);
  }
  return out;
}
