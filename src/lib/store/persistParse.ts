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
