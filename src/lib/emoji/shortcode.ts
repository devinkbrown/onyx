// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * shortcode.ts — pure, safe-by-construction `:shortcode:` tokenizer.
 *
 * SECURITY: this module NEVER produces HTML. It emits typed, inert segments
 * (a discriminated union of `text` / `emoji`). A shortcode is only recognized
 * when its name matches the strict lowercase charset AND resolves to a known
 * entry in EMOJI_LIST, so a colon-wrapped injection payload like
 * `:<img src=x onerror=alert(1)>:` can never become an `emoji` token — every
 * byte of it falls through as literal `text`. The scan is a single linear pass
 * (no backtracking regex ⇒ no ReDoS) and is bounded by MAX_SHORTCODE_SCAN.
 */
/**
 * OWNERSHIP — this is NOT the message render sink. Rendering `:shortcode:` inside
 * a chat message is owned end-to-end by the format pipeline: parseMessage()
 * (src/lib/format/parseMessage.ts) emits a typed `emoji` token, and MessageText
 * resolves it with lookupEmoji() (src/lib/format/emoji.ts). That is the single
 * source of truth for message-content emoji, and its coverage table (EMOJI_MAP,
 * ~290 codes) is far larger than the picker's keyword-indexed EMOJI_LIST (~28
 * codes) used here. Do NOT wire parseEmojiShortcodes into MessageText: it would
 * fork emoji tokenization into two competing renderers and regress recognized-
 * shortcode coverage. This module is a standalone, DOM-free segmenter over the
 * PICKER data model for contexts that receive a raw, non-grammar string and want
 * inert text/emoji segments — never a render sink.
 */
import { EMOJI_LIST, type EmojiEntry } from './emoji';

/** Upper bound on scanned input; larger strings pass through untouched as text. */
export const MAX_SHORTCODE_SCAN = 8_000;

/** A single inert render segment. Consumers build DOM text/`role="img"` nodes. */
export type EmojiSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'emoji'; readonly emoji: string; readonly shortcode: string };

const EMOJI_BY_SHORTCODE: ReadonlyMap<string, EmojiEntry> = new Map(
  EMOJI_LIST.map((entry) => [entry.shortcode, entry]),
);

/**
 * Single-character shortcode-name predicate. Kept per-char (never applied to a
 * whole span) so matching stays linear and free of catastrophic backtracking.
 */
function isShortcodeChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '+' ||
    ch === '-'
  );
}

/** Exact, case-sensitive lookup of a known shortcode name. */
export function lookupShortcode(name: string): EmojiEntry | null {
  return EMOJI_BY_SHORTCODE.get(name) ?? null;
}

/**
 * Tokenize `input` into inert text/emoji segments. Unknown or malformed
 * shortcodes are preserved verbatim as text (passthrough), so the concatenation
 * of segment values always reproduces the original string.
 */
export function parseEmojiShortcodes(input: string): EmojiSegment[] {
  if (input.length === 0) return [];
  if (input.length > MAX_SHORTCODE_SCAN) return [{ kind: 'text', value: input }];

  const segments: EmojiSegment[] = [];
  const n = input.length;
  let pending = '';
  let i = 0;

  const flush = (): void => {
    if (pending.length > 0) {
      segments.push({ kind: 'text', value: pending });
      pending = '';
    }
  };

  while (i < n) {
    const ch = input[i] ?? '';
    if (ch !== ':') {
      pending += ch;
      i += 1;
      continue;
    }

    // Attempt to read `:name:` starting at the opening colon.
    let j = i + 1;
    while (j < n && isShortcodeChar(input[j])) j += 1;

    const nameLen = j - (i + 1);
    if (nameLen > 0 && j < n && input[j] === ':') {
      const entry = EMOJI_BY_SHORTCODE.get(input.slice(i + 1, j));
      if (entry) {
        flush();
        segments.push({ kind: 'emoji', emoji: entry.emoji, shortcode: entry.shortcode });
        i = j + 1;
        continue;
      }
    }

    // Not a known shortcode: keep the colon as literal text and advance one char.
    pending += ':';
    i += 1;
  }

  flush();
  return segments;
}
