// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * keywordList.ts — short notification-keyword list helpers.
 *
 * Persistence stays in highlightMemory (`onyx:highlight-words`). This module
 * owns add / remove / normalize for the You-settings word list so keywords
 * stay a small extra ping source, not a second notify mode.
 */

import { parseHighlightWords } from './highlightMemory';

export {
  MAX_HIGHLIGHT_WORD_LENGTH as MAX_KEYWORD_LENGTH,
  MAX_HIGHLIGHT_WORDS as MAX_KEYWORDS,
} from './highlightMemory';

/** Canonical lowercase keyword, or null when the raw term is empty/unsafe. */
export function normalizeKeyword(raw: string): string | null {
  const [word] = parseHighlightWords([raw]);
  return word ?? null;
}

/** Append one term and re-bound the unique list. */
export function addKeyword(list: readonly string[], raw: string): string[] {
  return parseHighlightWords([...list, raw]);
}

/** Drop the normalized term. Unknown or empty input leaves a cleaned copy. */
export function removeKeyword(list: readonly string[], raw: string): string[] {
  const normalized = normalizeKeyword(raw);
  if (!normalized) return parseHighlightWords(list);
  return parseHighlightWords(list.filter((word) => word !== normalized));
}
