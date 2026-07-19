// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * labels.ts — IRCv3 `labeled-response` client helpers.
 *
 * Opaque `@label=` values (≤64 bytes) correlate an outbound command with the
 * single logical server reply (echo, ACK, FAIL, or a labeled-response batch).
 * Used by optimistic send and outbox flush so pending UI rows can be replaced
 * with the authoritative server msgid / error.
 */

/** IRCv3 labeled-response: label value MUST NOT exceed 64 bytes (UTF-8). */
export const MAX_LABEL_BYTES = 64;

/** Bound in-flight optimistic / outbox correlations. */
export const MAX_PENDING_LABELED_SENDS = 128;

let _labelCounter = 0;

/** UTF-8 byte length of a string (IRCv3 tag/label bounds are byte-oriented). */
function utf8ByteLength(value: string): number {
  // TextEncoder is ubiquitous in browsers and vitest's happy-dom/node envs;
  // measuring via encode is the only correct UTF-8 length for multi-byte
  // code points (a code-unit `.length` check would accept 33×'é' as "33
  // chars" while the wire carries 66 bytes).
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Mint a fresh opaque label. Format is intentionally unreadable (not a
 * content hash) so servers/bouncers treat it as an opaque id.
 */
export function nextClientLabel(): string {
  _labelCounter = (_labelCounter + 1) % 0xffffff;
  // `o` prefix + base36 time + counter is pure ASCII and stays well under
  // 64 UTF-8 bytes; the byte clamp is belt-and-braces against a future
  // format change that introduces multi-byte code points.
  const label = `o${Date.now().toString(36)}${_labelCounter.toString(36)}`;
  if (utf8ByteLength(label) <= MAX_LABEL_BYTES) return label;
  // Truncate by code unit then re-check: our alphabet is ASCII so this is
  // exact; if a future alphabet is multi-byte, keep chopping until it fits.
  let clipped = label.slice(0, MAX_LABEL_BYTES);
  while (clipped && utf8ByteLength(clipped) > MAX_LABEL_BYTES) {
    clipped = clipped.slice(0, -1);
  }
  return clipped;
}

/** Reset the counter between unit tests so ids stay predictable enough. */
export function _resetLabelCounterForTests(): void {
  _labelCounter = 0;
}

/**
 * True when a string is a legal non-empty label value (≤64 UTF-8 bytes,
 * no spaces / C0 controls / DEL). Used both to mint-check and to refuse
 * untrusted inbound `@label=` values that could never match our own mints
 * (and that would re-break tag serialization if echoed).
 */
export function isValidLabel(value: string): boolean {
  if (!value) return false;
  if (utf8ByteLength(value) > MAX_LABEL_BYTES) return false;
  // Wire tags cannot carry spaces unescaped; we never emit them and refuse
  // untrusted inbound labels that would never match our own mints.
  if (/[\u0000-\u0020\u007f]/u.test(value)) return false;
  return true;
}
