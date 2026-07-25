// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * composerInject.ts — pure helpers for Quote / Mention composer inserts.
 *
 * Formats plaintext inserts and merges them into an existing draft without
 * touching the store or DOM.
 */

export type ComposerInjectMode = 'append' | 'prefix' | 'replace';

const MAX_QUOTE_BODY = 400;

/** Collapse whitespace and strip control characters from free text. */
export function sanitizeComposerFragment(raw: string, maxLen = MAX_QUOTE_BODY): string {
  return raw
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLen);
}

/**
 * IRC-style quote: leading `> ` lines + blank line for a reply.
 * Empty body yields a short attribution-only stub.
 */
export function formatQuoteInsert(from: string, body: string): string {
  const nick = sanitizeComposerFragment(from, 64) || 'someone';
  const text = sanitizeComposerFragment(body);
  if (!text) return `> (${nick})\n\n`;
  const quoted = text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n`;
}

/** Leading @mention with trailing space for continued typing. */
export function formatMentionInsert(nick: string): string {
  const clean = sanitizeComposerFragment(nick, 64);
  if (!clean) return '';
  return `@${clean} `;
}

/**
 * Merge an insert into current draft text.
 * - prefix: insert at start
 * - append: insert at end (with spacing if needed)
 * - replace: insert becomes the whole draft
 */
export function mergeComposerInsert(
  current: string,
  insert: string,
  mode: ComposerInjectMode = 'append',
): { text: string; caret: number } {
  const frag = insert;
  if (!frag) {
    return { text: current, caret: current.length };
  }
  if (mode === 'replace') {
    return { text: frag, caret: frag.length };
  }
  if (mode === 'prefix') {
    const next = current.length === 0 ? frag : `${frag}${current}`;
    return { text: next, caret: frag.length };
  }
  // append
  if (current.length === 0) {
    return { text: frag, caret: frag.length };
  }
  const needsSpace = !/\s$/.test(current) && !/^\s/.test(frag) && !frag.startsWith('\n');
  const next = needsSpace ? `${current} ${frag}` : `${current}${frag}`;
  return { text: next, caret: next.length };
}
