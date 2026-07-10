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
