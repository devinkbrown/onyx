// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * groupEnvelope.ts — Era 3 C1 group-room E2EE foundation.
 *
 * Opaque on-wire envelope for channel messages once a room key exists.
 * This module deliberately does NOT implement TreeKEM/MLS key agreement yet —
 * it only defines the wire shape, validation, and sealed-payload helpers so
 * send/receive paths can fail closed on unknown group ciphertext and so later
 * MLS work has a stable prefix boundary.
 *
 * Wire: `ONYXROOM1 ` ‖ b64url(version u8 ‖ keyEpoch u32be ‖ nonce12 ‖ ct‖tag)
 */

import { fromB64url, toB64url } from './dmCipher';

export const GROUP_ENVELOPE_PREFIX = 'ONYXROOM1 ';
export const GROUP_ENVELOPE_VERSION = 1;
export const MAX_GROUP_PLAINTEXT_BYTES = 32 * 1024;
export const MAX_GROUP_CIPHERTEXT_BYTES = 48 * 1024;

const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HEADER_BYTES = 1 + 4; // version + epoch
const MIN_BODY_BYTES = HEADER_BYTES + NONCE_BYTES + GCM_TAG_BYTES;

export function isGroupEnvelope(text: string): boolean {
  return text.startsWith(GROUP_ENVELOPE_PREFIX);
}

export type GroupEnvelopeParts = {
  version: number;
  keyEpoch: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

/**
 * Parse a group envelope without decrypting. Fail closed on any structural
 * problem so hostile room traffic never reaches WebCrypto.
 */
export function parseGroupEnvelope(text: string): GroupEnvelopeParts | null {
  if (!isGroupEnvelope(text)) return null;
  const raw = fromB64url(text.slice(GROUP_ENVELOPE_PREFIX.length));
  if (!raw || raw.length < MIN_BODY_BYTES || raw.length > MAX_GROUP_CIPHERTEXT_BYTES) {
    return null;
  }
  const version = raw[0]!;
  if (version !== GROUP_ENVELOPE_VERSION) return null;
  const keyEpoch =
    ((raw[1]! << 24) | (raw[2]! << 16) | (raw[3]! << 8) | raw[4]!) >>> 0;
  const nonce = raw.slice(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const ciphertext = raw.slice(HEADER_BYTES + NONCE_BYTES);
  if (ciphertext.length < GCM_TAG_BYTES) return null;
  return { version, keyEpoch, nonce, ciphertext };
}

/**
 * Build a group envelope body from already-produced AES-GCM output.
 * Callers own key derivation; this only packages the wire shape.
 */
export function packGroupEnvelope(
  keyEpoch: number,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): string | null {
  if (!(Number.isInteger(keyEpoch) && keyEpoch >= 0 && keyEpoch <= 0xffffffff)) {
    return null;
  }
  if (nonce.length !== NONCE_BYTES) return null;
  if (ciphertext.length < GCM_TAG_BYTES || ciphertext.length > MAX_GROUP_CIPHERTEXT_BYTES) {
    return null;
  }
  const body = new Uint8Array(HEADER_BYTES + NONCE_BYTES + ciphertext.length);
  body[0] = GROUP_ENVELOPE_VERSION;
  body[1] = (keyEpoch >>> 24) & 0xff;
  body[2] = (keyEpoch >>> 16) & 0xff;
  body[3] = (keyEpoch >>> 8) & 0xff;
  body[4] = keyEpoch & 0xff;
  body.set(nonce, HEADER_BYTES);
  body.set(ciphertext, HEADER_BYTES + NONCE_BYTES);
  return `${GROUP_ENVELOPE_PREFIX}${toB64url(body)}`;
}

/**
 * Seal plaintext under a caller-supplied AES-GCM CryptoKey (room epoch key).
 * Returns null on any crypto or size failure — never leaks partial ciphertext.
 */
export async function sealGroupMessage(
  roomKey: CryptoKey,
  keyEpoch: number,
  plaintext: string,
): Promise<string | null> {
  const encoded = new TextEncoder().encode(plaintext);
  if (encoded.byteLength === 0 || encoded.byteLength > MAX_GROUP_PLAINTEXT_BYTES) {
    return null;
  }
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      roomKey,
      encoded,
    );
    return packGroupEnvelope(keyEpoch, nonce, new Uint8Array(ct));
  } catch {
    return null;
  }
}

/** Open a group envelope with the room epoch key. Null when not for this key. */
export async function openGroupMessage(
  roomKey: CryptoKey,
  envelope: string,
  expectedEpoch?: number,
): Promise<string | null> {
  const parts = parseGroupEnvelope(envelope);
  if (!parts) return null;
  if (expectedEpoch !== undefined && parts.keyEpoch !== expectedEpoch) return null;
  try {
    const iv = parts.nonce.slice();
    const data = parts.ciphertext.slice();
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      roomKey,
      data,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Placeholder shown when a room ciphertext cannot be opened. */
export const GROUP_LOCKED_PLACEHOLDER = '🔒 Encrypted room message (missing room key)';

/**
 * Display body for a (possibly sealed) room message.
 * Ciphertext never leaves this helper — missing key / failed open shows the
 * locked placeholder so hostile or unreadable ONYXROOM1 traffic fail closed.
 */
export function groupMessageDisplayText(
  text: string,
  plaintext?: string,
): string {
  if (plaintext !== undefined) return plaintext;
  if (isGroupEnvelope(text)) return GROUP_LOCKED_PLACEHOLDER;
  return text;
}
