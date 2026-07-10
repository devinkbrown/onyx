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
export function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
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
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomEmoji[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.name !== 'string' || typeof rec.url !== 'string') continue;
      const emoji: CustomEmoji = { name: rec.name, url: rec.url };
      if (typeof rec.addedBy === 'string') emoji.addedBy = rec.addedBy;
      out.push(emoji);
    }
    return out;
  } catch {
    return [];
  }
}
