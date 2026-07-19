// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * notificationBody.ts — OS-alert body text for in-tab desktop notifications.
 *
 * The browser Notification API renders body as plain text (not HTML), so this
 * is not an XSS sink. It IS an E2EE surface: a failed/undecrypted DM must never
 * put ciphertext (or key material) on a lock screen. Envelopes fail closed to a
 * neutral placeholder; plaintext is truncated for display.
 */
import { isEnvelope } from '@/lib/e2ee/dmCipher';

/** Neutral body when the note text is still (or only) an E2EE envelope. */
export const ENCRYPTED_NOTIFICATION_BODY = 'New encrypted message';

const MAX_BODY_CHARS = 180;

/**
 * True when `text` is a Tsumugi DM envelope, including after leading whitespace.
 *
 * Crypto (`isEnvelope`) stays strict so seal/open never invent a wire form.
 * Display redaction is deliberately broader: a buggy or hostile peer that
 * prefixes ` TSUMUGI1 …` must still fail closed on a lock-screen alert body.
 */
export function isNotificationEnvelope(text: string): boolean {
  if (isEnvelope(text)) return true;
  // Strip only leading whitespace — never rewrite the envelope body itself.
  const trimmed = text.replace(/^\s+/u, '');
  return trimmed !== text && isEnvelope(trimmed);
}

/**
 * Body string for an OS notification.
 * - E2EE envelope (`TSUMUGI1 …`, optionally whitespace-prefixed) → neutral placeholder
 * - otherwise truncate at 180 characters
 */
export function notificationBodyFor(text: string): string {
  if (isNotificationEnvelope(text)) return ENCRYPTED_NOTIFICATION_BODY;
  if (text.length > MAX_BODY_CHARS) return `${text.slice(0, MAX_BODY_CHARS - 3)}...`;
  return text;
}
