// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * groupEnvelope.ts — Era 3 C1 group-room E2EE foundation.
 *
 * Opaque on-wire envelope for channel messages once a room key exists.
 * This module deliberately does NOT implement TreeKEM/MLS key agreement —
 * it only defines the wire shape, validation, and sealed-payload helpers so
 * send/receive paths can fail closed on unknown group ciphertext and so later
 * MLS work has a stable prefix boundary. No RFC-9420 compliance claim.
 *
 * Wire: `ONYXROOM1 ` ‖ b64url(version u8 ‖ keyEpoch u32be ‖ nonce12 ‖ ct‖tag)
 *
 * AES-GCM binds additional authenticated data (AAD) to the normalized room
 * name and key epoch so a ciphertext cannot be replayed into another room or
 * epoch even when the raw AES key material is reused. Room identity is taken
 * from channel context at seal/open time (not duplicated in the body).
 */

import { fromB64url, toB64url } from './dmCipher';
import { normalizeGroupRoom, validRoomEpoch } from './groupKeyring';

export const GROUP_ENVELOPE_PREFIX = 'ONYXROOM1 ';
export const GROUP_ENVELOPE_VERSION = 1;
/** Exact daemon limit for the complete ASCII `ONYXROOM1 ...` trailing body. */
export const MAX_GROUP_ENVELOPE_WIRE_BYTES = 4096;
// 3031 plaintext + 16 GCM tag + 17 header/nonce = 3064 raw bytes, whose
// unpadded base64url plus the 10-byte prefix fits the 4096-byte daemon limit.
export const MAX_GROUP_PLAINTEXT_BYTES = 3031;
export const MAX_GROUP_CIPHERTEXT_BYTES = MAX_GROUP_PLAINTEXT_BYTES + 16;

const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HEADER_BYTES = 1 + 4; // version + epoch
const MIN_BODY_BYTES = HEADER_BYTES + NONCE_BYTES + GCM_TAG_BYTES;
const MAX_GROUP_ENVELOPE_BODY_BYTES = HEADER_BYTES + NONCE_BYTES + MAX_GROUP_CIPHERTEXT_BYTES;

/** Copy into a fresh ArrayBuffer so WebCrypto BufferSource typing is satisfied. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

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
 * Canonical AAD for group AES-GCM: wire prefix label + normalized room + epoch.
 * Both seal and open must use the same bytes; any room/epoch mismatch fails closed.
 */
export function buildGroupAad(room: string, keyEpoch: number): Uint8Array | null {
  const normalized = normalizeGroupRoom(room);
  if (!normalized || !validRoomEpoch(keyEpoch)) return null;
  // Stable ASCII domain: "ONYXROOM1|<room>|<epoch>"
  return new TextEncoder().encode(
    `${GROUP_ENVELOPE_PREFIX.trim()}|${normalized}|${keyEpoch >>> 0}`,
  );
}

/**
 * Parse a group envelope without decrypting. Fail closed on any structural
 * problem so hostile room traffic never reaches WebCrypto.
 */
export function parseGroupEnvelope(text: string): GroupEnvelopeParts | null {
  if (!isGroupEnvelope(text)) return null;
  const raw = fromB64url(text.slice(GROUP_ENVELOPE_PREFIX.length));
  if (!raw || raw.length < MIN_BODY_BYTES || raw.length > MAX_GROUP_ENVELOPE_BODY_BYTES) {
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
  const wire = `${GROUP_ENVELOPE_PREFIX}${toB64url(body)}`;
  return wire.length <= MAX_GROUP_ENVELOPE_WIRE_BYTES ? wire : null;
}

/**
 * Seal plaintext under a caller-supplied AES-GCM CryptoKey (room epoch key).
 * AAD binds `room` (normalized) + `keyEpoch` so the ciphertext is not portable
 * across rooms or epochs. Returns null on any crypto or size failure — never
 * leaks partial ciphertext.
 */
export async function sealGroupMessage(
  roomKey: CryptoKey,
  room: string,
  keyEpoch: number,
  plaintext: string,
): Promise<string | null> {
  const aad = buildGroupAad(room, keyEpoch);
  if (!aad) return null;
  const encoded = new TextEncoder().encode(plaintext);
  if (encoded.byteLength === 0 || encoded.byteLength > MAX_GROUP_PLAINTEXT_BYTES) {
    return null;
  }
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ct = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
      },
      roomKey,
      toArrayBuffer(encoded),
    );
    return packGroupEnvelope(keyEpoch, nonce, new Uint8Array(ct));
  } catch {
    return null;
  }
}

/**
 * Open a group envelope with the room epoch key in a known room context.
 * Null when not for this key, room AAD, or optional expectedEpoch.
 */
export async function openGroupMessage(
  roomKey: CryptoKey,
  room: string,
  envelope: string,
  expectedEpoch?: number,
): Promise<string | null> {
  const parts = parseGroupEnvelope(envelope);
  if (!parts) return null;
  if (expectedEpoch !== undefined && parts.keyEpoch !== expectedEpoch) return null;
  const aad = buildGroupAad(room, parts.keyEpoch);
  if (!aad) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(parts.nonce),
        additionalData: toArrayBuffer(aad),
      },
      roomKey,
      toArrayBuffer(parts.ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/**
 * Local seal via keyring active epoch: looks up the active key and binds AAD.
 * Fail closed when the room has no active epoch or seal fails.
 */
export async function sealGroupMessageWithKeyring(
  keyring: {
    activeEpoch(room: string): number | null;
    getActive(room: string): CryptoKey | null;
  },
  room: string,
  plaintext: string,
): Promise<string | null> {
  const epoch = keyring.activeEpoch(room);
  const key = keyring.getActive(room);
  if (epoch === null || !key) return null;
  return sealGroupMessage(key, room, epoch, plaintext);
}

/**
 * Local open via keyring: uses the envelope's epoch key if retained for room.
 * Fail closed when the epoch key is missing or AAD/key rejects.
 */
export async function openGroupMessageWithKeyring(
  keyring: {
    get(room: string, epoch: number): CryptoKey | null;
  },
  room: string,
  envelope: string,
): Promise<string | null> {
  const parts = parseGroupEnvelope(envelope);
  if (!parts) return null;
  const key = keyring.get(room, parts.keyEpoch);
  if (!key) return null;
  return openGroupMessage(key, room, envelope, parts.keyEpoch);
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
