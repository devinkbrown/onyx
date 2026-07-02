/**
 * parseMessage.ts — tokenize a raw IRC message into typed tokens.
 *
 * SECURITY: This is a pure data transformation. No HTML is ever produced.
 * The caller (MessageText.tsx) renders each token as safe JSX nodes only.
 *
 * TOKEN TYPES:
 *   text        — plain text segment
 *   bold        — **text** or __text__
 *   italic      — *text* or _text_
 *   strike      — ~~text~~
 *   code        — `inline code`
 *   codeblock   — ```code block```
 *   blockquote  — > line (must start at column 0 after \n or start of string)
 *   spoiler     — ||hidden text||
 *   link        — https?:// URL
 *   mention     — @nick
 *   channel     — #channel
 *   emoji       — :shortcode:
 *
 * DESIGN GOALS:
 *   - No regex with catastrophic backtracking (ReDoS-safe: linear passes)
 *   - Bounded: each character is consumed exactly once in the outer scan
 *   - Nesting: bold/italic can contain inline tokens (but not block tokens)
 *   - Adversarial: unclosed markers render as literal text; empty spans skipped
 *   - Max input length: capped at MAX_LENGTH chars before parsing
 */

import { parseIrcRuns, isDefaultStyle, type IrcStyle } from './ircFormat';
export type { IrcStyle } from './ircFormat';

export type TokenType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeblock'
  | 'blockquote'
  | 'spoiler'
  | 'link'
  | 'mention'
  | 'channel'
  | 'emoji'
  | 'styled';

/** A leaf token with no children. */
export interface TextToken      { type: 'text';       text: string }
export interface CodeToken      { type: 'code';       text: string }
export interface CodeBlockToken { type: 'codeblock';  text: string; lang: string }
export interface LinkToken      { type: 'link';       href: string; text: string }
export interface MentionToken   { type: 'mention';    nick: string }
export interface ChannelToken   { type: 'channel';    name: string }
export interface EmojiToken     { type: 'emoji';      shortcode: string }

/** Container tokens that hold inline children. */
export interface BoldToken      { type: 'bold';       children: InlineToken[] }
export interface ItalicToken    { type: 'italic';     children: InlineToken[] }
export interface StrikeToken    { type: 'strike';     children: InlineToken[] }
export interface SpoilerToken   { type: 'spoiler';    children: InlineToken[] }
export interface BlockquoteToken{ type: 'blockquote'; children: InlineToken[] }
/** A run carrying resolved IRC/mIRC formatting (bold/colour/etc.). */
export interface StyledToken    { type: 'styled';     style: IrcStyle; children: InlineToken[] }

/** Union of all inline tokens (can appear inside containers). */
export type InlineToken =
  | TextToken
  | CodeToken
  | LinkToken
  | MentionToken
  | ChannelToken
  | EmojiToken
  | BoldToken
  | ItalicToken
  | StrikeToken
  | SpoilerToken
  | StyledToken;

/** Top-level tokens (includes blockquote which is block-level). */
export type Token = InlineToken | CodeBlockToken | BlockquoteToken;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Hard cap to prevent DoS on pathological inputs. */
const MAX_LENGTH = 4_000;

/** Characters that can end a @nick token. */
const NICK_END_RE = /[^\w-]/;

/** Characters that end a #channel name token. */
const CHAN_NAME_END_RE = /[\s,;!?'"()[\]{}<>]/;

// ── URL detection ─────────────────────────────────────────────────────────────

/**
 * Scan a URL starting at `start` (right after `://`).
 * Returns the exclusive end index, stripping trailing punctuation.
 */
function scanUrl(src: string, start: number): number {
  let i = start;
  const len = src.length;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (i < len) {
    const ch = src[i]!;
    if (ch === '(') { parenDepth++; i++; continue; }
    if (ch === '[') { bracketDepth++; i++; continue; }
    if (ch === ')') {
      if (parenDepth > 0) { parenDepth--; i++; continue; }
      break;
    }
    if (ch === ']') {
      if (bracketDepth > 0) { bracketDepth--; i++; continue; }
      break;
    }
    if (/[\s<>"']/.test(ch)) break;
    i++;
  }

  // Strip trailing sentence-ending punctuation
  while (i > start && /[.,;:!?]/.test(src[i - 1]!)) i--;

  return i;
}

// ── Nick / channel scanners ───────────────────────────────────────────────────

function scanNick(src: string, start: number): number {
  let i = start;
  const len = src.length;
  while (i < len && !NICK_END_RE.test(src[i]!)) i++;
  return i;
}

function scanChannel(src: string, start: number): number {
  let i = start;
  const len = src.length;
  while (i < len && !CHAN_NAME_END_RE.test(src[i]!)) i++;
  return i;
}

// ── Container-span finder (ReDoS-safe linear scan) ────────────────────────────

/**
 * Find the closing marker `close` in `src` starting at `start`, scanning
 * character by character up to `end`.  Returns the index of the first char
 * of `close`, or -1 if not found.
 *
 * This is intentionally simple: no backtracking.  The caller must not use it
 * in a nested regex.
 */
function findClose(src: string, start: number, end: number, close: string): number {
  const len = close.length;
  for (let i = start; i <= end - len; i++) {
    if (src.startsWith(close, i)) return i;
  }
  return -1;
}

// ── Inline token helper ────────────────────────────────────────────────────────

/** Push a string segment as a text token (merging with last if possible). */
function pushText(tokens: InlineToken[], text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.type === 'text') {
    (last as TextToken).text += text;
  } else {
    tokens.push({ type: 'text', text });
  }
}

// ── Inline parser ──────────────────────────────────────────────────────────────

/**
 * Parse inline tokens from `src[start..end)`.
 *
 * The parser is single-pass and consumes each character exactly once.
 * It does not recurse into its own range — container spans are handled by
 * looking ahead with `findClose` (a simple linear scan) before committing.
 */
function parseInline(src: string, start: number, end: number): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = start;

  while (i < end) {
    const ch = src[i]!;

    // ── Inline code `…` — highest priority (no markup inside) ───────────────
    if (ch === '`') {
      const codeStart = i + 1;
      const codeEnd = src.indexOf('`', codeStart);
      if (codeEnd !== -1 && codeEnd < end) {
        pushText(tokens, src.slice(start, i));
        start = codeEnd + 1;
        tokens.push({ type: 'code', text: src.slice(codeStart, codeEnd) });
        i = start;
        continue;
      }
    }

    // ── Bold **…** ─────────────────────────────────────────────────────────
    if (ch === '*' && src[i + 1] === '*') {
      const innerStart = i + 2;
      const closeAt = findClose(src, innerStart, end, '**');
      if (closeAt !== -1 && closeAt > innerStart) {
        pushText(tokens, src.slice(start, i));
        const children = parseInline(src, innerStart, closeAt);
        tokens.push({ type: 'bold', children });
        i = closeAt + 2;
        start = i;
        continue;
      }
    }

    // ── Bold __…__ ─────────────────────────────────────────────────────────
    if (ch === '_' && src[i + 1] === '_') {
      const innerStart = i + 2;
      const closeAt = findClose(src, innerStart, end, '__');
      if (closeAt !== -1 && closeAt > innerStart) {
        pushText(tokens, src.slice(start, i));
        const children = parseInline(src, innerStart, closeAt);
        tokens.push({ type: 'bold', children });
        i = closeAt + 2;
        start = i;
        continue;
      }
    }

    // ── Strike ~~…~~ ───────────────────────────────────────────────────────
    if (ch === '~' && src[i + 1] === '~') {
      const innerStart = i + 2;
      const closeAt = findClose(src, innerStart, end, '~~');
      if (closeAt !== -1 && closeAt > innerStart) {
        pushText(tokens, src.slice(start, i));
        const children = parseInline(src, innerStart, closeAt);
        tokens.push({ type: 'strike', children });
        i = closeAt + 2;
        start = i;
        continue;
      }
    }

    // ── Spoiler ||…|| ─────────────────────────────────────────────────────
    if (ch === '|' && src[i + 1] === '|') {
      const innerStart = i + 2;
      const closeAt = findClose(src, innerStart, end, '||');
      if (closeAt !== -1 && closeAt > innerStart) {
        pushText(tokens, src.slice(start, i));
        const children = parseInline(src, innerStart, closeAt);
        tokens.push({ type: 'spoiler', children });
        i = closeAt + 2;
        start = i;
        continue;
      }
    }

    // ── Italic *…* (must not be part of **) ─────────────────────────────────
    if (ch === '*' && src[i + 1] !== '*') {
      const innerStart = i + 1;
      // Find the close *, but not one that is part of **
      let closeAt = -1;
      for (let j = innerStart; j < end; j++) {
        if (src[j] === '*' && src[j + 1] !== '*') { closeAt = j; break; }
        if (src[j] === '*' && src[j + 1] === '*') break; // don't consume **
      }
      if (closeAt !== -1 && closeAt > innerStart) {
        pushText(tokens, src.slice(start, i));
        const children = parseInline(src, innerStart, closeAt);
        tokens.push({ type: 'italic', children });
        i = closeAt + 1;
        start = i;
        continue;
      }
    }

    // ── Italic _…_ (must not be part of __) ──────────────────────────────────
    if (ch === '_' && src[i + 1] !== '_') {
      const innerStart = i + 1;
      let closeAt = -1;
      for (let j = innerStart; j < end; j++) {
        if (src[j] === '_' && src[j + 1] !== '_') { closeAt = j; break; }
        if (src[j] === '_' && src[j + 1] === '_') break;
      }
      if (closeAt !== -1 && closeAt > innerStart) {
        pushText(tokens, src.slice(start, i));
        const children = parseInline(src, innerStart, closeAt);
        tokens.push({ type: 'italic', children });
        i = closeAt + 1;
        start = i;
        continue;
      }
    }

    // ── URL https?:// ─────────────────────────────────────────────────────
    if (
      (ch === 'h' || ch === 'H') &&
      (src.startsWith('https://', i) || src.startsWith('http://', i))
    ) {
      const schemeEnd = src.indexOf('://', i) + 3;
      const urlEnd = scanUrl(src, schemeEnd);
      if (urlEnd > schemeEnd) {
        pushText(tokens, src.slice(start, i));
        const href = src.slice(i, urlEnd);
        tokens.push({ type: 'link', href, text: href });
        i = urlEnd;
        start = i;
        continue;
      }
    }

    // ── @mention ──────────────────────────────────────────────────────────
    if (ch === '@') {
      const nickStart = i + 1;
      const nickEnd = scanNick(src, nickStart);
      if (nickEnd > nickStart) {
        pushText(tokens, src.slice(start, i));
        tokens.push({ type: 'mention', nick: src.slice(nickStart, nickEnd) });
        i = nickEnd;
        start = i;
        continue;
      }
    }

    // ── #channel ──────────────────────────────────────────────────────────
    if (ch === '#') {
      const chanStart = i + 1;
      const chanEnd = scanChannel(src, chanStart);
      if (chanEnd > chanStart) {
        pushText(tokens, src.slice(start, i));
        tokens.push({ type: 'channel', name: src.slice(i, chanEnd) }); // includes #
        i = chanEnd;
        start = i;
        continue;
      }
    }

    // ── :emoji_shortcode: ─────────────────────────────────────────────────
    if (ch === ':') {
      const codeStart = i + 1;
      let j = codeStart;
      while (j < end && src[j] !== ':' && src[j] !== '\n') {
        if (!/[\w\-+]/.test(src[j]!)) break;
        j++;
      }
      if (j > codeStart && j < end && src[j] === ':') {
        const shortcode = src.slice(codeStart, j);
        if (shortcode.length > 0 && shortcode.length <= 64) {
          pushText(tokens, src.slice(start, i));
          tokens.push({ type: 'emoji', shortcode });
          i = j + 1;
          start = i;
          continue;
        }
      }
    }

    // Default: advance one character
    i++;
  }

  // Flush remaining text
  pushText(tokens, src.slice(start, end));

  return tokens;
}

// ── IRC formatting layer ───────────────────────────────────────────────────────

/**
 * Parse one line as IRC-formatted text: split into styled runs (control bytes
 * stripped), then markdown-parse the visible text of each run. Runs with no
 * formatting pass straight through as plain inline tokens, so messages without
 * any control codes behave exactly as before. Non-default runs are wrapped in a
 * single `styled` token carrying the resolved colour/weight/etc.
 *
 * `inStyle` threads the active style in from the previous line; `out` carries it
 * forward, so colours opened before a newline continue afterwards.
 */
function parseStyledInline(
  line: string,
  inStyle: IrcStyle,
): { tokens: InlineToken[]; out: IrcStyle } {
  const { runs, out } = parseIrcRuns(line, inStyle);
  const tokens: InlineToken[] = [];

  for (const run of runs) {
    if (!run.text) continue;
    const inline = parseInline(run.text, 0, run.text.length);
    if (isDefaultStyle(run.style)) {
      for (const t of inline) tokens.push(t);
    } else {
      tokens.push({ type: 'styled', style: run.style, children: inline });
    }
  }

  return { tokens, out };
}

// ── Top-level parser ──────────────────────────────────────────────────────────

/**
 * Parse a raw message string into a typed token array.
 *
 * @param text - the raw message text (not HTML-escaped; must not be trusted HTML)
 * @returns Array of Token — safe to render as JSX nodes, never as HTML strings
 */
export function parseMessage(text: string): Token[] {
  // Cap input length to prevent abuse
  const src = text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH) : text;
  const tokens: Token[] = [];

  // Split on newlines first so blockquotes work correctly
  const lines = src.split('\n');

  // IRC formatting is stateful: thread the active style across lines so a colour
  // opened before a newline keeps applying until reset.
  let carry: IrcStyle = {};

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    // ── Blockquote (> at start of line) ──────────────────────────────────────
    if (line.startsWith('> ') || line === '>') {
      const content = line.startsWith('> ') ? line.slice(2) : '';
      const { tokens: children, out } = parseStyledInline(content, carry);
      carry = out;
      tokens.push({ type: 'blockquote', children });
      if (lineIdx < lines.length - 1) {
        tokens.push({ type: 'text', text: '\n' });
      }
      continue;
    }

    // ── Code block ```…``` (must start a line) ────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const bodyLines: string[] = [];
      let found = false;

      for (let j = lineIdx + 1; j < lines.length; j++) {
        if (lines[j]!.startsWith('```')) {
          tokens.push({ type: 'codeblock', text: bodyLines.join('\n'), lang });
          lineIdx = j;
          found = true;
          break;
        }
        bodyLines.push(lines[j]!);
      }

      // Code is literal — formatting does not bleed through a code block.
      carry = {};

      if (!found) {
        // Unclosed: output ``` literally then parse the rest
        const rest = line.slice(0); // full line including ```
        const { tokens: inlineTokens, out } = parseStyledInline(rest, carry);
        carry = out;
        for (const t of inlineTokens) tokens.push(t);
        if (lineIdx < lines.length - 1) tokens.push({ type: 'text', text: '\n' });
      } else if (lineIdx < lines.length - 1) {
        tokens.push({ type: 'text', text: '\n' });
      }
      continue;
    }

    // ── Normal inline line ────────────────────────────────────────────────────
    const { tokens: inlineTokens, out } = parseStyledInline(line, carry);
    carry = out;
    for (const t of inlineTokens) tokens.push(t);

    if (lineIdx < lines.length - 1) {
      tokens.push({ type: 'text', text: '\n' });
    }
  }

  return tokens;
}
