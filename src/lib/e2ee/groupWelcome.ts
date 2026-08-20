// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OGC1-v2 welcome wrapping over an ODD1 P-256 recipient key.
 *
 * The only private material accepted here is an injected recipient
 * CryptoKey.  It is never exported, persisted, or put in a returned object.
 * Sender ephemeral private material is likewise scoped to one prepare call.
 */

import { fromB64url, toB64url } from './dmCipher';
import {
  decodeGroupDeviceDirectoryEntry,
  isValidP256UncompressedPublicKey,
} from './groupDeviceDirectory';
import { normalizeGroupRoom } from './groupKeyring';
import type { ResolveResult } from './trustedGroupSigner';

export const GROUP_WELCOME_MAGIC = 'OGW1';
export const GROUP_WELCOME_VERSION = 1;
export const GROUP_WELCOME_PLAINTEXT_MAGIC = 'OGWP1';
export const GROUP_WELCOME_CONTEXT_DOMAIN = 'ONYX-GROUP-WELCOME-CONTEXT-v1';
export const GROUP_WELCOME_HKDF_INFO = 'ONYX-GROUP-WELCOME-v1';
export const GROUP_WELCOME_EPHEMERAL_BYTES = 65;
export const GROUP_WELCOME_NONCE_BYTES = 12;
export const GROUP_WELCOME_COMMIT_ID_BYTES = 32;
export const GROUP_WELCOME_KEY_BYTES = 32;
export const GROUP_WELCOME_PLAINTEXT_BYTES = 5 + 8 + 32 + 32 + 32;
export const GROUP_WELCOME_MAX_BYTES = 4 + 1 + 65 + 12 + GROUP_WELCOME_PLAINTEXT_BYTES + 16;

const MAGIC_BYTES = new TextEncoder().encode(GROUP_WELCOME_MAGIC);
const PLAINTEXT_MAGIC_BYTES = new TextEncoder().encode(GROUP_WELCOME_PLAINTEXT_MAGIC);
const HKDF_INFO_PREFIX = new TextEncoder().encode(`${GROUP_WELCOME_HKDF_INFO}\u0000`);
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]{1,64}$/u;
const DEVICE_RE = /^[A-Za-z0-9_.-]{1,32}$/u;
const B64_RE = /^[A-Za-z0-9_-]+$/u;
const U64_MAX = (1n << 64n) - 1n;

export type GroupWelcomeContextInput = {
  room: string;
  fromAccount: string;
  fromDevice: string;
  toAccount: string;
  toDevice: string;
  epoch: bigint | number;
  commitId: Uint8Array;
};

export type GroupWelcomePlaintext = {
  epoch: bigint;
  commitId: Uint8Array;
  membershipDigest: Uint8Array;
  epochKey: Uint8Array;
};

export type GroupWelcomeParts = {
  version: number;
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export type PreparedGroupWelcome = {
  wire: string;
  bytes: Uint8Array;
  context: Uint8Array;
  destroy(): void;
};

export type OpenedGroupWelcome = GroupWelcomePlaintext & {
  context: Uint8Array;
  /** SHA-256 of the exact OGC1-v2 body representation verified on open. */
  bodyDigest: Uint8Array;
};

type OpenedGroupWelcomeSnapshot = {
  readonly epoch: bigint;
  readonly commitId: Uint8Array;
  readonly membershipDigest: Uint8Array;
  readonly epochKey: Uint8Array;
  readonly context: Uint8Array;
  readonly bodyDigest: Uint8Array;
};

/** Runtime capability registry: only this module can mint an opened welcome. */
const openedWelcomeSnapshots = new WeakMap<object, OpenedGroupWelcomeSnapshot>();

/** Verify that an opened welcome was returned by `openGroupWelcome`. */
export function isOpenedGroupWelcome(value: unknown): value is OpenedGroupWelcome {
  return typeof value === 'object' && value !== null && openedWelcomeSnapshots.has(value);
}

/**
 * Read an opened welcome through the private capability snapshot.  Every
 * returned byte array is a fresh copy; public object/array mutation cannot
 * alter the authenticated values retained by this module.
 */
export function readOpenedGroupWelcome(value: unknown): OpenedGroupWelcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const snapshot = openedWelcomeSnapshots.get(value);
  if (!snapshot) return null;
  return Object.freeze({
    epoch: snapshot.epoch,
    commitId: copy(snapshot.commitId),
    membershipDigest: copy(snapshot.membershipDigest),
    epochKey: copy(snapshot.epochKey),
    context: copy(snapshot.context),
    bodyDigest: copy(snapshot.bodyDigest),
  }) as OpenedGroupWelcome;
}

/**
 * Consume an opened welcome capability exactly once.
 *
 * The returned value is a fresh snapshot for the immediate caller.  The
 * private registry entry is deleted before its retained arrays are zeroed, so
 * a second consumer (or a caller holding the original frozen object) cannot
 * recover the authenticated plaintext or epoch key.
 */
export function consumeOpenedGroupWelcome(value: unknown): OpenedGroupWelcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const snapshot = openedWelcomeSnapshots.get(value);
  if (!snapshot) return null;
  openedWelcomeSnapshots.delete(value);
  const consumed = Object.freeze({
    epoch: snapshot.epoch,
    commitId: copy(snapshot.commitId),
    membershipDigest: copy(snapshot.membershipDigest),
    epochKey: copy(snapshot.epochKey),
    context: copy(snapshot.context),
    bodyDigest: copy(snapshot.bodyDigest),
  }) as OpenedGroupWelcome;
  snapshot.commitId.fill(0);
  snapshot.membershipDigest.fill(0);
  snapshot.epochKey.fill(0);
  snapshot.context.fill(0);
  snapshot.bodyDigest.fill(0);
  return consumed;
}

function copy(bytes: Uint8Array): Uint8Array { return new Uint8Array(bytes); }

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function nonZero(bytes: Uint8Array): boolean {
  let value = 0;
  for (const byte of bytes) value |= byte;
  return value !== 0;
}

function asU64(value: bigint | number): bigint | null {
  if (typeof value === 'bigint') return value >= 0n && value <= U64_MAX ? value : null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const result = BigInt(value);
  return result <= U64_MAX ? result : null;
}

function writeU64be(out: Uint8Array, offset: number, value: bigint): void {
  let current = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[offset + index] = Number(current & 0xffn);
    current >>= 8n;
  }
}

function readU64be(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(bytes[offset + index]!);
  return value;
}

function writeField(out: Uint8Array, offset: number, value: Uint8Array): number {
  out[offset] = (value.byteLength >>> 8) & 0xff;
  out[offset + 1] = value.byteLength & 0xff;
  out.set(value, offset + 2);
  return offset + 2 + value.byteLength;
}

/** Exact canonical context shared by HKDF salt/info and AES-GCM AAD. */
export function buildGroupWelcomeContext(input: GroupWelcomeContextInput): Uint8Array | null {
  const room = normalizeGroupRoom(input.room);
  const fromAccount = typeof input.fromAccount === 'string' ? input.fromAccount.trim().toLowerCase() : '';
  const toAccount = typeof input.toAccount === 'string' ? input.toAccount.trim().toLowerCase() : '';
  const epoch = asU64(input.epoch);
  if (!room || !ACCOUNT_RE.test(fromAccount) || !ACCOUNT_RE.test(toAccount)
    || !DEVICE_RE.test(input.fromDevice) || !DEVICE_RE.test(input.toDevice)
    || epoch === null || input.commitId.byteLength !== GROUP_WELCOME_COMMIT_ID_BYTES
    || !nonZero(input.commitId)) return null;
  const enc = new TextEncoder();
  const fields = [enc.encode(room), enc.encode(fromAccount), enc.encode(input.fromDevice), enc.encode(toAccount), enc.encode(input.toDevice)];
  const total = new TextEncoder().encode(GROUP_WELCOME_CONTEXT_DOMAIN).byteLength + 1
    + fields.reduce((sum, field) => sum + 2 + field.byteLength, 0) + 8 + 32;
  const out = new Uint8Array(total);
  const domain = enc.encode(GROUP_WELCOME_CONTEXT_DOMAIN);
  let offset = 0;
  out.set(domain, offset); offset += domain.byteLength;
  out[offset++] = 0;
  for (const field of fields) offset = writeField(out, offset, field);
  writeU64be(out, offset, epoch); offset += 8;
  out.set(input.commitId, offset);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copyBytes = new Uint8Array(bytes.byteLength);
  copyBytes.set(bytes);
  return copyBytes.buffer;
}

function recipientWrapBytes(input: Uint8Array | string): Uint8Array | null {
  if (typeof input !== 'string') return isValidP256UncompressedPublicKey(input) ? copy(input) : null;
  if (!B64_RE.test(input)) return null;
  const odd = decodeGroupDeviceDirectoryEntry(input);
  if (odd) return copy(odd.encryptionPub);
  const raw = fromB64url(input);
  return raw && toB64url(raw) === input && isValidP256UncompressedPublicKey(raw) ? raw : null;
}

function verifiedResolution(
  resolution: ResolveResult | undefined,
  fromAccount: string,
  fromDevice: string,
  welcomeBytes?: Uint8Array,
): boolean {
  if (!resolution || resolution.status !== 'verified') return false;
  if (resolution.account !== fromAccount.trim().toLowerCase() || resolution.deviceId !== fromDevice) return false;
  if (resolution.parts.version !== 2 || resolution.parts.diagnosticOnly || resolution.parts.kind !== 'welcome') return false;
  if (!welcomeBytes) return true;
  const wireBytes = new TextEncoder().encode(toB64url(welcomeBytes));
  return equalBytes(resolution.parts.body, welcomeBytes) || equalBytes(resolution.parts.body, wireBytes);
}

/** Encode the fixed plaintext carried inside OGW1. */
export function encodeGroupWelcomePlaintext(input: GroupWelcomePlaintext): Uint8Array | null {
  const epoch = asU64(input.epoch);
  if (epoch === null || input.commitId.byteLength !== 32 || input.membershipDigest.byteLength !== 32 || input.epochKey.byteLength !== 32
    || !nonZero(input.commitId) || !nonZero(input.membershipDigest) || !nonZero(input.epochKey)) return null;
  const out = new Uint8Array(GROUP_WELCOME_PLAINTEXT_BYTES);
  out.set(PLAINTEXT_MAGIC_BYTES, 0);
  writeU64be(out, 5, epoch);
  out.set(input.commitId, 13);
  out.set(input.membershipDigest, 45);
  out.set(input.epochKey, 77);
  return out;
}

export function decodeGroupWelcomePlaintext(raw: Uint8Array): GroupWelcomePlaintext | null {
  if (raw.byteLength !== GROUP_WELCOME_PLAINTEXT_BYTES || !equalBytes(raw.slice(0, 5), PLAINTEXT_MAGIC_BYTES)) return null;
  const result: GroupWelcomePlaintext = {
    epoch: readU64be(raw, 5),
    commitId: raw.slice(13, 45),
    membershipDigest: raw.slice(45, 77),
    epochKey: raw.slice(77, 109),
  };
  return nonZero(result.commitId) && nonZero(result.membershipDigest) && nonZero(result.epochKey) ? result : null;
}

/** Package an exact OGW1 envelope from an ephemeral key, nonce, and GCM output. */
export function encodeGroupWelcome(parts: {
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}): Uint8Array | null {
  if (!isValidP256UncompressedPublicKey(parts.ephemeralPublicKey)
    || parts.nonce.byteLength !== GROUP_WELCOME_NONCE_BYTES
    || parts.ciphertext.byteLength !== GROUP_WELCOME_PLAINTEXT_BYTES + 16) return null;
  const out = new Uint8Array(GROUP_WELCOME_MAX_BYTES);
  out.set(MAGIC_BYTES, 0);
  out[4] = GROUP_WELCOME_VERSION;
  out.set(parts.ephemeralPublicKey, 5);
  out.set(parts.nonce, 70);
  out.set(parts.ciphertext, 82);
  return out;
}

export function encodeGroupWelcomeBase64url(parts: {
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}): string | null {
  const raw = encodeGroupWelcome(parts);
  return raw ? toB64url(raw) : null;
}

/** Decode OGW1 and reject all wrong lengths/trailing bytes. */
export function decodeGroupWelcome(input: Uint8Array | string): GroupWelcomeParts | null {
  const raw = typeof input === 'string'
    ? (!B64_RE.test(input) ? null : fromB64url(input))
    : input;
  if (!raw || raw.byteLength !== GROUP_WELCOME_MAX_BYTES) return null;
  if (typeof input === 'string' && toB64url(raw) !== input) return null;
  if (!equalBytes(raw.slice(0, 4), MAGIC_BYTES) || raw[4] !== GROUP_WELCOME_VERSION) return null;
  const ephemeralPublicKey = raw.slice(5, 70);
  if (!isValidP256UncompressedPublicKey(ephemeralPublicKey)) return null;
  return {
    version: raw[4]!,
    ephemeralPublicKey,
    nonce: raw.slice(70, 82),
    ciphertext: raw.slice(82),
  };
}

/** Hash the exact authenticated OGC1-v2 body representation for provenance. */
export async function hashGroupWelcomeBody(body: Uint8Array): Promise<Uint8Array | null> {
  if (body.byteLength === 0) return null;
  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(body)));
  } catch {
    return null;
  }
}

async function deriveWelcomeKey(sharedBits: ArrayBuffer, context: Uint8Array): Promise<CryptoKey> {
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(context)));
  const hkdf = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const info = new Uint8Array(HKDF_INFO_PREFIX.byteLength + context.byteLength);
  info.set(HKDF_INFO_PREFIX, 0);
  info.set(context, HKDF_INFO_PREFIX.byteLength);
  try {
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: toArrayBuffer(info) },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    salt.fill(0);
    info.fill(0);
  }
}

/** Prepare one target-specific welcome. The sender's resolution is optional but, when supplied, must be verified. */
export async function prepareGroupWelcome(input: {
  room: string;
  fromAccount: string;
  fromDevice: string;
  toAccount: string;
  toDevice: string;
  epoch: bigint | number;
  commitId: Uint8Array;
  membershipDigest: Uint8Array;
  epochKey: Uint8Array;
  recipientWrapPublicKey: Uint8Array | string;
  senderResolution?: ResolveResult;
}): Promise<PreparedGroupWelcome | null> {
  const context = buildGroupWelcomeContext(input);
  const epoch = asU64(input.epoch);
  const recipient = recipientWrapBytes(input.recipientWrapPublicKey);
  if (!context || epoch === null || !recipient || (input.senderResolution && !verifiedResolution(input.senderResolution, input.fromAccount, input.fromDevice))) {
    context?.fill(0);
    recipient?.fill(0);
    return null;
  }
  const plaintext = encodeGroupWelcomePlaintext({ epoch, commitId: input.commitId, membershipDigest: input.membershipDigest, epochKey: input.epochKey });
  if (!plaintext) {
    context.fill(0);
    recipient.fill(0);
    return null;
  }
  try {
    const recipientKey = await crypto.subtle.importKey('raw', toArrayBuffer(recipient), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ephemeralPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const ephemeralPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeralPair.publicKey));
    const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientKey }, ephemeralPair.privateKey, 256);
    let key: CryptoKey;
    try {
      key = await deriveWelcomeKey(sharedBits, context);
    } finally {
      new Uint8Array(sharedBits).fill(0);
    }
    const nonce = crypto.getRandomValues(new Uint8Array(GROUP_WELCOME_NONCE_BYTES));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(context) }, key, toArrayBuffer(plaintext)));
    const bytes = encodeGroupWelcome({ ephemeralPublicKey, nonce, ciphertext });
    if (!bytes) {
      context.fill(0);
      return null;
    }
    const wire = toB64url(bytes);
    let destroyed = false;
    return {
      wire,
      bytes,
      context,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        context.fill(0);
        bytes.fill(0);
        ciphertext.fill(0);
        nonce.fill(0);
      },
    };
  } catch {
    context.fill(0);
    return null;
  } finally {
    plaintext.fill(0);
    recipient.fill(0);
  }
}

/** Open one target-specific welcome with an injected non-extractable private key. */
export async function openGroupWelcome(input: {
  wire: string | Uint8Array;
  room: string;
  fromAccount: string;
  fromDevice: string;
  toAccount: string;
  toDevice: string;
  epoch: bigint | number;
  commitId: Uint8Array;
  membershipDigest: Uint8Array;
  recipientPrivateKey: CryptoKey;
  resolution: ResolveResult;
}): Promise<OpenedGroupWelcome | null> {
  const envelope = decodeGroupWelcome(input.wire);
  const context = buildGroupWelcomeContext(input);
  if (!envelope || !context || input.resolution.status !== 'verified'
    || !verifiedResolution(input.resolution, input.fromAccount, input.fromDevice, typeof input.wire === 'string' ? fromB64url(input.wire) ?? undefined : input.wire)) return null;
  const privateKey = input.recipientPrivateKey;
  if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'ECDH' || privateKey.extractable || !privateKey.usages.includes('deriveBits')) return null;
  try {
    const ephemeral = await crypto.subtle.importKey('raw', toArrayBuffer(envelope.ephemeralPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephemeral }, privateKey, 256);
    let key: CryptoKey;
    try {
      key = await deriveWelcomeKey(sharedBits, context);
    } finally {
      new Uint8Array(sharedBits).fill(0);
    }
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(envelope.nonce), additionalData: toArrayBuffer(context) }, key, toArrayBuffer(envelope.ciphertext)));
    try {
      const opened = decodeGroupWelcomePlaintext(plaintext);
      if (!opened || opened.epoch !== asU64(input.epoch) || !equalBytes(opened.commitId, input.commitId) || !equalBytes(opened.membershipDigest, input.membershipDigest)) return null;
      if (BigInt(input.resolution.parts.epoch) !== opened.epoch) return null;
      const bodyDigest = await hashGroupWelcomeBody(input.resolution.parts.body);
      if (!bodyDigest) return null;
      const snapshot: OpenedGroupWelcomeSnapshot = {
        epoch: opened.epoch,
        commitId: copy(opened.commitId),
        membershipDigest: copy(opened.membershipDigest),
        epochKey: copy(opened.epochKey),
        context: copy(context),
        bodyDigest,
      };
      const openedWelcome = Object.freeze({
        epoch: snapshot.epoch,
        commitId: copy(snapshot.commitId),
        membershipDigest: copy(snapshot.membershipDigest),
        epochKey: copy(snapshot.epochKey),
        context: copy(snapshot.context),
        bodyDigest: copy(snapshot.bodyDigest),
      }) as OpenedGroupWelcome;
      openedWelcomeSnapshots.set(openedWelcome, snapshot);
      return openedWelcome;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    return null;
  } finally {
    context.fill(0);
  }
}
