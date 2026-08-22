// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * keywordMatch.ts — Slack-shaped exact-token keyword matching.
 *
 * Keywords ADD pings on top of All / @ / Mute. They never replace those
 * room modes. Matching is whole-token and case-insensitive: "cat" matches
 * "the cat sat" and "cat." but not "category".
 */

const TOKEN = /[\p{L}\p{N}_]+/gu;

/** Lowercased word tokens. Punctuation is a boundary, not part of the token. */
export function keywordTokens(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

/** True when `keyword` appears as a consecutive exact-token run in `text`. */
export function matchesKeyword(text: string, keyword: string): boolean {
  const needle = keywordTokens(keyword);
  if (needle.length === 0) return false;
  const haystack = keywordTokens(text);
  if (needle.length > haystack.length) return false;
  if (needle.length === 1) {
    const token = needle[0]!;
    return haystack.includes(token);
  }
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** True when any saved keyword is an exact token (or token run) in `text`. */
export function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => matchesKeyword(text, keyword));
}
