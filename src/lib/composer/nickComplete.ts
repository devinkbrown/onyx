// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * nickComplete.ts — pure Tab-complete for channel/DM nick tokens in the composer.
 *
 * Extracts the incomplete nick at the caret (optional leading `@`), ranks
 * candidates by case-insensitive prefix, and returns the completed input with
 * a trailing space when the match is unique or when cycling.
 */

export type NickToken = {
  /** Absolute start index of the token in `text` (includes leading @ if present). */
  start: number;
  /** Absolute end index (caret is at or after this when completing). */
  end: number;
  /** Whether the token began with `@`. */
  at: boolean;
  /** Query without leading `@`. */
  query: string;
};

// IRC nick characters (RFC 2812 subset): alnum + specials -[]\,`^{}|_
// Avoid character-class escapes that trip no-useless-escape.
const NICK_SPECIAL = new Set(['-', '[', ']', ',', '\\', '`', '^', '{', '}', '|', '_']);

export function isNickChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  if (
    (code >= 48 && code <= 57) // 0-9
    || (code >= 65 && code <= 90) // A-Z
    || (code >= 97 && code <= 122) // a-z
  ) {
    return true;
  }
  return NICK_SPECIAL.has(ch);
}

/**
 * Find the incomplete nick token ending at `caret` (or immediately before it).
 * Returns null when the caret is mid-whitespace or mid-slash command.
 */
export function nickTokenAt(text: string, caret: number): NickToken | null {
  if (caret < 0 || caret > text.length) return null;
  // Do not compete with slash-command completion.
  if (text.startsWith('/') && !/\s/.test(text.slice(1, Math.max(1, caret)))) return null;

  let end = caret;
  // If caret sits on a nick char, include through the end of that run.
  while (end < text.length && isNickChar(text[end]!)) end += 1;

  let start = end;
  while (start > 0 && isNickChar(text[start - 1]!)) start -= 1;
  if (start === end) return null;

  let at = false;
  if (start > 0 && text[start - 1] === '@') {
    at = true;
    start -= 1;
  }

  // Require a word boundary before the token (start of line, whitespace, or punctuation).
  if (start > 0) {
    const prev = text[start - 1]!;
    if (isNickChar(prev) || prev === '@') return null;
  }

  const raw = text.slice(start, end);
  const query = at ? raw.slice(1) : raw;
  if (query.length === 0 && !at) return null;
  return { start, end, at, query };
}

/**
 * Rank nick candidates for a query. Case-insensitive prefix match; exact
 * case-sensitive prefix ranks first, then shorter nicks.
 */
export function rankNickCompletions(
  query: string,
  nicks: readonly string[],
  limit = 8,
): string[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const nick of nicks) {
    if (!nick || seen.has(nick.toLowerCase())) continue;
    if (q.length === 0 || nick.toLowerCase().startsWith(q)) {
      seen.add(nick.toLowerCase());
      hits.push(nick);
    }
  }
  hits.sort((a, b) => {
    const aPref = a.startsWith(query) ? 0 : 1;
    const bPref = b.startsWith(query) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b, 'en');
  });
  return hits.slice(0, Math.max(1, limit));
}

/**
 * Apply the chosen nick into `text` at the token, preserving a leading `@` and
 * adding a trailing space when missing.
 */
export function applyNickCompletion(
  text: string,
  token: NickToken,
  nick: string,
): { text: string; caret: number } {
  const insert = `${token.at ? '@' : ''}${nick} `;
  const next = `${text.slice(0, token.start)}${insert}${text.slice(token.end)}`;
  return { text: next, caret: token.start + insert.length };
}

/**
 * Cycle nick completion: first Tab picks the best match; subsequent Tabs with
 * the same prefix advance through the ranked list.
 */
export function cycleNickCompletion(
  text: string,
  caret: number,
  nicks: readonly string[],
  previousIndex = -1,
): { text: string; caret: number; index: number; matches: string[] } | null {
  const token = nickTokenAt(text, caret);
  if (!token) return null;
  const matches = rankNickCompletions(token.query, nicks);
  if (matches.length === 0) return null;
  const index = previousIndex < 0
    ? 0
    : (previousIndex + 1) % matches.length;
  const applied = applyNickCompletion(text, token, matches[index]!);
  return { ...applied, index, matches };
}
