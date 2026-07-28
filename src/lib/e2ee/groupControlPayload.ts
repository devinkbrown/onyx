// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * groupControlPayload.ts — versioned client payload for opaque E2EEGROUP.
 *
 * The IRC routing layer (`groupControl.ts`) carries an uninterpreted canonical
 * base64url trailing parameter. This module owns that parameter's first
 * client-side format: a length-prefixed body inside a signed envelope whose
 * Ed25519 transcript binds the exact outer routing metadata (normalized
 * channel, kind, from-device, welcome targets), protocol version, epoch, body
 * bytes, and the embedded 32-byte signer_pub.
 *
 * Trust boundary: verification requires an **explicit trusted signer** public
 * key supplied by the caller (device directory / pin / prior enrollment). The
 * wire `signer_pub` must **exactly equal** that trusted key (bytes compared
 * after exporting a CryptoKey when needed). It is never treated as account
 * authentication by itself — the external trusted input remains mandatory.
 *
 * Non-goals: MLS/RFC 9420 wire interop; TreeKEM; server decryption; embedding
 * raw room AES keys in key-package or commit bodies. Welcome body bytes are
 * reserved for a later pairwise key-wrap layer (owned outside this module).
 */

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
} from './deviceSign';
import { fromB64url, toB64url } from './dmCipher';

/** Domain separation label for the Ed25519 transcript. */
export const GROUP_CONTROL_PAYLOAD_DOMAIN = 'ONYX-GROUP-CONTROL-v1';

/**
 * Fixed 4-byte ASCII magic prefix for binary v1 (`OGC1`).
 * Rejects accidental non-control base64url blobs at parse time.
 */
export const GROUP_CONTROL_PAYLOAD_MAGIC = 'OGC1';

const MAGIC_BYTES = new TextEncoder().encode(GROUP_CONTROL_PAYLOAD_MAGIC);

/** First versioned payload format. */
export const GROUP_CONTROL_PAYLOAD_VERSION = 1;

/**
 * Hard cap on the body field (bytes). Chosen so the full binary envelope
 * always re-encodes to ≤ 4096 canonical base64url chars (E2EEGROUP wire max).
 */
export const MAX_GROUP_CONTROL_BODY_BYTES = 2048;

/** Matches `MAX_GROUP_CONTROL_PAYLOAD` on the IRC codec. */
export const MAX_GROUP_CONTROL_WIRE_B64 = 4096;

/** Channel / device / account bounds (aligned with groupControl routing). */
export const MAX_GROUP_CONTROL_CHANNEL_BYTES = 128;
export const MAX_GROUP_CONTROL_DEVICE_CHARS = 32;
export const MAX_GROUP_CONTROL_ACCOUNT_CHARS = 64;

/** Fixed header + trailer size excluding the variable body. */
const FIXED_ENVELOPE_BYTES =
  4 /* magic OGC1 */
  + 1 /* version */
  + 1 /* kind */
  + 4 /* epoch */
  + 2 /* body_len */
  + ED25519_PUBLIC_KEY_BYTES
  + ED25519_SIGNATURE_BYTES;

/** Offset of the version byte after magic. */
const OFF_VERSION = 4;
const OFF_KIND = 5;
const OFF_EPOCH = 6;
const OFF_BODY_LEN = 10;
const OFF_BODY = 12;

const KIND_CODES = {
  'key-package': 1,
  welcome: 2,
  commit: 3,
} as const;

const CODE_KINDS: ReadonlyMap<number, GroupControlPayloadKind> = new Map([
  [1, 'key-package'],
  [2, 'welcome'],
  [3, 'commit'],
]);

const DEVICE_RE = /^[A-Za-z0-9_.-]+$/;
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]+$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export type GroupControlPayloadKind = 'key-package' | 'welcome' | 'commit';

/**
 * Outer E2EEGROUP routing metadata bound into the signature transcript.
 * Channel is normalized (trim + lowercase) before encoding.
 */
export type GroupControlRouting = {
  channel: string;
  kind: GroupControlPayloadKind;
  fromDevice: string;
  /** Required when kind === 'welcome'; must be absent otherwise. */
  toAccount?: string;
  /** Required when kind === 'welcome'; must be absent otherwise. */
  toDevice?: string;
};

/** Structural parts of a parsed payload (signature not yet verified). */
export type GroupControlPayloadParts = {
  version: number;
  kind: GroupControlPayloadKind;
  epoch: number;
  body: Uint8Array;
  /**
   * Wire-embedded Ed25519 public key (32 bytes). Bound into the transcript
   * and must equal the caller-supplied trusted signer at verify time —
   * never a standalone account auth claim.
   */
  signerPub: Uint8Array;
  signature: Uint8Array;
};

/** Inputs for building a signed payload. */
export type GroupControlPayloadBuildInput = {
  routing: GroupControlRouting;
  epoch: number;
  body: Uint8Array;
  /** Raw 32-byte Ed25519 public key matching `privateKey` (also on wire). */
  signerPub: Uint8Array;
  privateKey: CryptoKey;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function writeU32be(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24)
      | (bytes[offset + 1]! << 16)
      | (bytes[offset + 2]! << 8)
      | bytes[offset + 3]!) >>> 0
  );
}

function writeU16be(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

function readU16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

/** Exact length-and-byte equality (fail closed on length mismatch). */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Resolve a trusted signer to raw 32-byte Ed25519 public key material.
 * CryptoKey path: export raw; fail closed if export is unavailable.
 */
async function resolveTrustedSignerRaw(
  trustedSigner: Uint8Array | CryptoKey,
): Promise<Uint8Array | null> {
  if (trustedSigner instanceof Uint8Array) {
    if (trustedSigner.byteLength !== ED25519_PUBLIC_KEY_BYTES) return null;
    return trustedSigner;
  }
  if (
    trustedSigner.type !== 'public'
    || trustedSigner.algorithm.name !== 'Ed25519'
  ) {
    return null;
  }
  try {
    const raw = new Uint8Array(
      await crypto.subtle.exportKey('raw', trustedSigner),
    );
    if (raw.byteLength !== ED25519_PUBLIC_KEY_BYTES) return null;
    return raw;
  } catch {
    // Non-extractable or export failure — fail closed.
    return null;
  }
}

/**
 * Canonical channel for transcript binding: trim + lowercase, with the same
 * size/shape guards as the IRC routing codec (leading #/& , no separators).
 */
export function normalizeControlChannel(channel: string): string | null {
  const normalized = channel.trim().toLowerCase();
  const byteLength = new TextEncoder().encode(normalized).byteLength;
  if (normalized.length < 2 || byteLength > MAX_GROUP_CONTROL_CHANNEL_BYTES) {
    return null;
  }
  if (normalized[0] !== '#' && normalized[0] !== '&') return null;
  if (/[\x00-\x20,:\x7f]/.test(normalized.slice(1))) return null;
  return normalized;
}

function validDevice(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_GROUP_CONTROL_DEVICE_CHARS
    && DEVICE_RE.test(value);
}

function validAccount(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_GROUP_CONTROL_ACCOUNT_CHARS
    && ACCOUNT_RE.test(value);
}

export function validControlEpoch(epoch: number): boolean {
  return Number.isInteger(epoch) && epoch >= 0 && epoch <= 0xffffffff;
}

function validBody(body: Uint8Array): boolean {
  return body.byteLength > 0 && body.byteLength <= MAX_GROUP_CONTROL_BODY_BYTES;
}

/**
 * Normalize and validate routing for transcript / verify. Fail closed:
 * welcome requires targets; non-welcome rejects targets.
 */
export function normalizeGroupControlRouting(
  routing: GroupControlRouting,
): GroupControlRouting | null {
  const channel = normalizeControlChannel(routing.channel);
  if (!channel || !validDevice(routing.fromDevice)) return null;

  if (routing.kind === 'welcome') {
    const toAccount = routing.toAccount;
    const toDevice = routing.toDevice;
    if (!toAccount || !toDevice) return null;
    if (!validAccount(toAccount) || !validDevice(toDevice)) return null;
    return {
      channel,
      kind: 'welcome',
      fromDevice: routing.fromDevice,
      toAccount,
      toDevice,
    };
  }

  if (routing.kind !== 'key-package' && routing.kind !== 'commit') return null;
  if (routing.toAccount !== undefined || routing.toDevice !== undefined) {
    return null;
  }
  return {
    channel,
    kind: routing.kind,
    fromDevice: routing.fromDevice,
  };
}

function kindCode(kind: GroupControlPayloadKind): number {
  return KIND_CODES[kind];
}

function kindFromCode(code: number): GroupControlPayloadKind | null {
  return CODE_KINDS.get(code) ?? null;
}

/**
 * Ed25519 transcript (pure). Bindings:
 *
 *   domain ‖ 0x00 ‖
 *   u8(channel_len) ‖ channel_utf8 ‖
 *   u8(kind_code) ‖
 *   u8(from_device_len) ‖ from_device_utf8 ‖
 *   u8(to_account_len) ‖ to_account_utf8 ‖   // 0 when non-welcome
 *   u8(to_device_len) ‖ to_device_utf8 ‖     // 0 when non-welcome
 *   u8(version) ‖
 *   u32be(epoch) ‖
 *   u16be(body_len) ‖ body ‖
 *   signer_pub (32 bytes)
 *
 * Field order is fixed; any reordering is a different transcript.
 * `signer_pub` is covered so the wire discovery field cannot be swapped
 * without invalidating the signature.
 */
export function buildGroupControlTranscript(
  routing: GroupControlRouting,
  version: number,
  epoch: number,
  body: Uint8Array,
  signerPub: Uint8Array,
): Uint8Array | null {
  const norm = normalizeGroupControlRouting(routing);
  if (!norm) return null;
  if (version !== GROUP_CONTROL_PAYLOAD_VERSION) return null;
  if (!validControlEpoch(epoch) || !validBody(body)) return null;
  if (signerPub.byteLength !== ED25519_PUBLIC_KEY_BYTES) return null;

  const enc = new TextEncoder();
  const channel = enc.encode(norm.channel);
  const fromDevice = enc.encode(norm.fromDevice);
  const toAccount = enc.encode(norm.toAccount ?? '');
  const toDevice = enc.encode(norm.toDevice ?? '');

  if (
    channel.length > 255
    || fromDevice.length > 255
    || toAccount.length > 255
    || toDevice.length > 255
  ) {
    return null;
  }

  const domain = enc.encode(GROUP_CONTROL_PAYLOAD_DOMAIN);
  const total =
    domain.length
    + 1
    + 1 + channel.length
    + 1
    + 1 + fromDevice.length
    + 1 + toAccount.length
    + 1 + toDevice.length
    + 1
    + 4
    + 2
    + body.length
    + ED25519_PUBLIC_KEY_BYTES;

  const out = new Uint8Array(total);
  let off = 0;
  out.set(domain, off);
  off += domain.length;
  out[off++] = 0;
  out[off++] = channel.length;
  out.set(channel, off);
  off += channel.length;
  out[off++] = kindCode(norm.kind);
  out[off++] = fromDevice.length;
  out.set(fromDevice, off);
  off += fromDevice.length;
  out[off++] = toAccount.length;
  out.set(toAccount, off);
  off += toAccount.length;
  out[off++] = toDevice.length;
  out.set(toDevice, off);
  off += toDevice.length;
  out[off++] = version & 0xff;
  writeU32be(out, off, epoch >>> 0);
  off += 4;
  writeU16be(out, off, body.length);
  off += 2;
  out.set(body, off);
  off += body.length;
  out.set(signerPub, off);
  return out;
}

/**
 * Pack a fully-formed payload (including signature) into canonical base64url.
 * Fail closed on bounds or non-canonical size relative to the wire cap.
 */
export function packGroupControlPayload(
  parts: GroupControlPayloadParts,
): string | null {
  if (parts.version !== GROUP_CONTROL_PAYLOAD_VERSION) return null;
  if (!validControlEpoch(parts.epoch) || !validBody(parts.body)) return null;
  if (parts.signerPub.byteLength !== ED25519_PUBLIC_KEY_BYTES) return null;
  if (parts.signature.byteLength !== ED25519_SIGNATURE_BYTES) return null;
  if (!CODE_KINDS.has(kindCode(parts.kind))) return null;

  const bodyLen = parts.body.byteLength;
  const raw = new Uint8Array(FIXED_ENVELOPE_BYTES + bodyLen);
  let off = 0;
  raw.set(MAGIC_BYTES, off);
  off += MAGIC_BYTES.length;
  raw[off++] = parts.version & 0xff;
  raw[off++] = kindCode(parts.kind);
  writeU32be(raw, off, parts.epoch >>> 0);
  off += 4;
  writeU16be(raw, off, bodyLen);
  off += 2;
  raw.set(parts.body, off);
  off += bodyLen;
  raw.set(parts.signerPub, off);
  off += ED25519_PUBLIC_KEY_BYTES;
  raw.set(parts.signature, off);

  const wire = toB64url(raw);
  if (wire.length === 0 || wire.length > MAX_GROUP_CONTROL_WIRE_B64) return null;
  // Canonical: re-encode must match (no padding, base64url alphabet only).
  if (!B64URL_RE.test(wire) || fromB64url(wire) === null) return null;
  if (toB64url(fromB64url(wire)!) !== wire) return null;
  return wire;
}

/**
 * Parse a wire base64url payload without cryptographic verification.
 * Rejects non-canonical base64url, bad magic, unknown version/kind, and
 * size violations.
 */
export function parseGroupControlPayload(
  wireB64: string,
): GroupControlPayloadParts | null {
  if (
    wireB64.length === 0
    || wireB64.length > MAX_GROUP_CONTROL_WIRE_B64
    || !B64URL_RE.test(wireB64)
  ) {
    return null;
  }
  const raw = fromB64url(wireB64);
  if (!raw || raw.length < FIXED_ENVELOPE_BYTES) return null;
  // Reject non-canonical encodings (standard base64 chars, padding, etc.).
  if (toB64url(raw) !== wireB64) return null;

  if (!equalBytes(raw.subarray(0, MAGIC_BYTES.length), MAGIC_BYTES)) {
    return null;
  }

  const version = raw[OFF_VERSION]!;
  if (version !== GROUP_CONTROL_PAYLOAD_VERSION) return null;
  const kind = kindFromCode(raw[OFF_KIND]!);
  if (!kind) return null;
  const epoch = readU32be(raw, OFF_EPOCH);
  const bodyLen = readU16be(raw, OFF_BODY_LEN);
  if (bodyLen === 0 || bodyLen > MAX_GROUP_CONTROL_BODY_BYTES) return null;
  const expected = FIXED_ENVELOPE_BYTES + bodyLen;
  if (raw.length !== expected) return null;

  const bodyStart = OFF_BODY;
  const bodyEnd = bodyStart + bodyLen;
  const signerStart = bodyEnd;
  const sigStart = signerStart + ED25519_PUBLIC_KEY_BYTES;

  return {
    version,
    kind,
    epoch,
    body: raw.slice(bodyStart, bodyEnd),
    signerPub: raw.slice(signerStart, sigStart),
    signature: raw.slice(sigStart, sigStart + ED25519_SIGNATURE_BYTES),
  };
}

/**
 * Sign a control payload. Returns canonical base64url for the E2EEGROUP
 * trailing parameter, or null on any validation / WebCrypto failure.
 *
 * `signerPub` is written into the envelope and bound into the transcript.
 * Verifiers still require an externally trusted public key that must exactly
 * equal the wire field (wire key alone is not account auth).
 */
export async function signGroupControlPayload(
  input: GroupControlPayloadBuildInput,
): Promise<string | null> {
  const { routing, epoch, body, signerPub, privateKey } = input;
  if (signerPub.byteLength !== ED25519_PUBLIC_KEY_BYTES) return null;
  if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'Ed25519') {
    return null;
  }

  const transcript = buildGroupControlTranscript(
    routing,
    GROUP_CONTROL_PAYLOAD_VERSION,
    epoch,
    body,
    signerPub,
  );
  if (!transcript) return null;

  const norm = normalizeGroupControlRouting(routing);
  if (!norm) return null;

  try {
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        'Ed25519',
        privateKey,
        toArrayBuffer(transcript),
      ),
    );
    if (sig.byteLength !== ED25519_SIGNATURE_BYTES) return null;
    return packGroupControlPayload({
      version: GROUP_CONTROL_PAYLOAD_VERSION,
      kind: norm.kind,
      epoch: epoch >>> 0,
      body,
      signerPub,
      signature: sig,
    });
  } catch {
    return null;
  }
}

/**
 * Verify a wire payload against outer routing metadata and an **explicit**
 * trusted Ed25519 public key (raw 32 bytes or CryptoKey).
 *
 * Fail closed on: structural parse failure, magic mismatch, kind/routing
 * mismatch, wire `signer_pub` ≠ trusted signer (CryptoKey exported raw;
 * export unavailable → null), transcript rebuild failure, or signature
 * rejection under the trusted key.
 *
 * The wire key is not account auth — the external trusted input remains
 * mandatory and must match the bound wire field byte-for-byte.
 */
export async function verifyGroupControlPayload(
  wireB64: string,
  routing: GroupControlRouting,
  trustedSigner: Uint8Array | CryptoKey,
): Promise<GroupControlPayloadParts | null> {
  const parts = parseGroupControlPayload(wireB64);
  if (!parts) return null;

  const norm = normalizeGroupControlRouting(routing);
  if (!norm) return null;
  // Outer IRC kind must match the signed envelope kind.
  if (norm.kind !== parts.kind) return null;

  const trustedRaw = await resolveTrustedSignerRaw(trustedSigner);
  if (!trustedRaw) return null;
  // Wire signer_pub must exactly equal the external trusted signer.
  if (!equalBytes(parts.signerPub, trustedRaw)) return null;

  const transcript = buildGroupControlTranscript(
    norm,
    parts.version,
    parts.epoch,
    parts.body,
    parts.signerPub,
  );
  if (!transcript) return null;

  let verifyKey: CryptoKey;
  try {
    if (trustedSigner instanceof Uint8Array) {
      verifyKey = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(trustedRaw),
        'Ed25519',
        false,
        ['verify'],
      );
    } else {
      verifyKey = trustedSigner;
    }

    const ok = await crypto.subtle.verify(
      'Ed25519',
      verifyKey,
      toArrayBuffer(parts.signature),
      toArrayBuffer(transcript),
    );
    return ok ? parts : null;
  } catch {
    return null;
  }
}
