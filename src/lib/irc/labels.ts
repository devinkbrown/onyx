// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * labels.ts — IRCv3 `labeled-response` client helpers.
 *
 * Opaque `@label=` values (≤64 bytes) correlate an outbound command with the
 * single logical server reply (echo, ACK, FAIL, or a labeled-response batch).
 * Used by optimistic send and outbox flush so pending UI rows can be replaced
 * with the authoritative server msgid / error.
 */

/** IRCv3 labeled-response: label value MUST NOT exceed 64 bytes. */
export const MAX_LABEL_BYTES = 64;

/** Bound in-flight optimistic / outbox correlations. */
export const MAX_PENDING_LABELED_SENDS = 128;

let _labelCounter = 0;

/**
 * Mint a fresh opaque label. Format is intentionally unreadable (not a
 * content hash) so servers/bouncers treat it as an opaque id.
 */
export function nextClientLabel(): string {
  _labelCounter = (_labelCounter + 1) % 0xffffff;
  // `o` prefix + base36 time + counter stays well under 64 bytes.
  const label = `o${Date.now().toString(36)}${_labelCounter.toString(36)}`;
  return label.length <= MAX_LABEL_BYTES ? label : label.slice(0, MAX_LABEL_BYTES);
}

/** Reset the counter between unit tests so ids stay predictable enough. */
export function _resetLabelCounterForTests(): void {
  _labelCounter = 0;
}

/** True when a string is a legal non-empty label value (≤64 bytes, no spaces). */
export function isValidLabel(value: string): boolean {
  if (!value || value.length > MAX_LABEL_BYTES) return false;
  // Wire tags cannot carry spaces unescaped; we never emit them and refuse
  // untrusted inbound labels that would never match our own mints.
  if (/[\u0000-\u0020\u007f]/u.test(value)) return false;
  return true;
}
