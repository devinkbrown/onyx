// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure OGCMT2 group-commit codec and hash helpers.
 *
 * The commit body is intentionally fixed width.  It carries no account or
 * device strings: those are authenticated by the outer OGC1-v2 transcript.
 * `buildGroupCommitContext`/`hashGroupCommit` bind that outer routing context
 * when a commit hash is calculated, so a valid body cannot be moved between
 * rooms, accounts, or devices.
 */

import { fromB64url, toB64url } from './dmCipher';
import { normalizeGroupRoom } from './groupKeyring';

export const GROUP_COMMIT_MAGIC = 'OGCMT2';
export const GROUP_COMMIT_VERSION = 1;
export const GROUP_COMMIT_HASH_BYTES = 32;
export const GROUP_COMMIT_ID_BYTES = 32;
export const GROUP_COMMIT_KEY_BYTES = 32;
export const GROUP_COMMIT_KEY_COMMITMENT_DOMAIN = 'ONYX-OGCMT2-EPOCH-KEY-v1';
export const GROUP_COMMIT_KEY_COMMITMENT_BYTES = 32;
export const GROUP_COMMIT_BYTES = 6 + 1 + (8 * 2) + (32 * 4);
export const GROUP_COMMIT_DOMAIN = 'ONYX-GROUP-COMMIT-v1';
export const GROUP_COMMIT_HASH_DOMAIN = 'ONYX-GROUP-COMMIT-HASH-v1';
export const GROUP_COMMIT_MAX_B64URL = 256;

const MAGIC_BYTES = new TextEncoder().encode(GROUP_COMMIT_MAGIC);
const DOMAIN_BYTES = new TextEncoder().encode(GROUP_COMMIT_DOMAIN);
const HASH_DOMAIN_BYTES = new TextEncoder().encode(GROUP_COMMIT_HASH_DOMAIN);
const KEY_COMMITMENT_DOMAIN_BYTES = new TextEncoder().encode(GROUP_COMMIT_KEY_COMMITMENT_DOMAIN);
const U64_MAX = (1n << 64n) - 1n;
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]{1,64}$/u;
const DEVICE_RE = /^[A-Za-z0-9_.-]{1,32}$/u;
const B64_RE = /^[A-Za-z0-9_-]+$/u;

export type GroupCommit = {
  priorEpoch: bigint;
  nextEpoch: bigint;
  priorCommitHash: Uint8Array;
  commitId: Uint8Array;
  membershipDigest: Uint8Array;
  /** SHA-256 commitment to the epoch key; the raw key is never serialized. */
  newEpochKeyCommitment: Uint8Array;
};

export type GroupCommitContextInput = {
  room: string;
  fromAccount: string;
  fromDevice: string;
  priorEpoch: bigint | number;
  nextEpoch: bigint | number;
  commitId: Uint8Array;
};

export type PreparedGroupCommit = {
  record: GroupCommit;
  body: Uint8Array;
  context: Uint8Array;
  commitHash: Uint8Array;
  /** Zeroize the prepared body/commitment copies and make the object unusable. */
  destroy(): void;
};

function copy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

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

function validFixed(bytes: Uint8Array): boolean {
  return bytes.byteLength === GROUP_COMMIT_HASH_BYTES;
}

function validNonZeroFixed(bytes: Uint8Array): boolean {
  return validFixed(bytes) && nonZero(bytes);
}

function validRecord(record: GroupCommit): boolean {
  const prior = asU64(record.priorEpoch);
  const next = asU64(record.nextEpoch);
  return prior !== null
    && next !== null
    && next > prior
    && validFixed(record.priorCommitHash)
    && (prior === 0n || nonZero(record.priorCommitHash))
    && validNonZeroFixed(record.commitId)
    && validNonZeroFixed(record.membershipDigest)
    && validNonZeroFixed(record.newEpochKeyCommitment);
}

/** Encode the exact 151-byte OGCMT2 body. Returns null on ambiguity. */
export function encodeGroupCommit(record: GroupCommit): Uint8Array | null {
  if (!validRecord(record)) return null;
  const prior = asU64(record.priorEpoch)!;
  const next = asU64(record.nextEpoch)!;
  const out = new Uint8Array(GROUP_COMMIT_BYTES);
  out.set(MAGIC_BYTES, 0);
  out[6] = GROUP_COMMIT_VERSION;
  writeU64be(out, 7, prior);
  writeU64be(out, 15, next);
  out.set(record.priorCommitHash, 23);
  out.set(record.commitId, 55);
  out.set(record.membershipDigest, 87);
  out.set(record.newEpochKeyCommitment, 119);
  return out;
}

/** Encode the body as canonical unpadded base64url for an OGC1 body. */
export function encodeGroupCommitBase64url(record: GroupCommit): string | null {
  const body = encodeGroupCommit(record);
  if (!body) return null;
  const wire = toB64url(body);
  return wire.length <= GROUP_COMMIT_MAX_B64URL ? wire : null;
}

/** Decode exact raw bytes or a canonical base64url body; trailing bytes reject. */
export function decodeGroupCommit(input: Uint8Array | string): GroupCommit | null {
  const raw = typeof input === 'string'
    ? (!B64_RE.test(input) || toB64url(fromB64url(input) ?? new Uint8Array()) !== input
      ? null
      : fromB64url(input))
    : input;
  if (!raw || raw.byteLength !== GROUP_COMMIT_BYTES) return null;
  if (!equalBytes(raw.slice(0, MAGIC_BYTES.length), MAGIC_BYTES) || raw[6] !== GROUP_COMMIT_VERSION) return null;
  const record: GroupCommit = {
    priorEpoch: readU64be(raw, 7),
    nextEpoch: readU64be(raw, 15),
    priorCommitHash: raw.slice(23, 55),
    commitId: raw.slice(55, 87),
    membershipDigest: raw.slice(87, 119),
    newEpochKeyCommitment: raw.slice(119, 151),
  };
  return validRecord(record) ? record : null;
}

/**
 * Commit to a raw next-epoch key without placing that key in OGCMT2.
 *
 * The room is canonicalized exactly once (trim + lowercase), while the
 * remaining fields are fixed-width.  The returned digest is the only key
 * material that may appear in a commit body; the raw key belongs in an
 * encrypted OGW1 welcome or in an explicitly local-only apply call.
 */
export async function computeGroupEpochKeyCommitment(input: {
  room: string;
  nextEpoch: bigint | number;
  commitId: Uint8Array;
  membershipDigest: Uint8Array;
  epochKey: Uint8Array;
}): Promise<Uint8Array | null> {
  const room = normalizeGroupRoom(input.room);
  const next = asU64(input.nextEpoch);
  if (!room || next === null || input.commitId.byteLength !== GROUP_COMMIT_ID_BYTES
    || !nonZero(input.commitId) || input.membershipDigest.byteLength !== GROUP_COMMIT_HASH_BYTES
    || !nonZero(input.membershipDigest) || input.epochKey.byteLength !== GROUP_COMMIT_KEY_BYTES
    || !nonZero(input.epochKey)) return null;
  const roomBytes = new TextEncoder().encode(room);
  const material = new Uint8Array(
    KEY_COMMITMENT_DOMAIN_BYTES.byteLength + 1 + roomBytes.byteLength + 8
      + GROUP_COMMIT_ID_BYTES + GROUP_COMMIT_HASH_BYTES + GROUP_COMMIT_KEY_BYTES,
  );
  let offset = 0;
  material.set(KEY_COMMITMENT_DOMAIN_BYTES, offset); offset += KEY_COMMITMENT_DOMAIN_BYTES.byteLength;
  material[offset++] = 0;
  material.set(roomBytes, offset); offset += roomBytes.byteLength;
  writeU64be(material, offset, next); offset += 8;
  material.set(input.commitId, offset); offset += GROUP_COMMIT_ID_BYTES;
  material.set(input.membershipDigest, offset); offset += GROUP_COMMIT_HASH_BYTES;
  material.set(input.epochKey, offset);
  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  } catch {
    return null;
  } finally {
    material.fill(0);
  }
}

/** Alias retained for callers that prefer the verb `build` for a digest. */
export const buildGroupEpochKeyCommitment = computeGroupEpochKeyCommitment;

function writeField(out: Uint8Array, offset: number, value: Uint8Array): number {
  out[offset] = (value.byteLength >>> 8) & 0xff;
  out[offset + 1] = value.byteLength & 0xff;
  out.set(value, offset + 2);
  return offset + 2 + value.byteLength;
}

/** Canonical context used by commit hashes and outer transcript binding. */
export function buildGroupCommitContext(input: GroupCommitContextInput): Uint8Array | null {
  const room = normalizeGroupRoom(input.room);
  const account = typeof input.fromAccount === 'string' ? input.fromAccount.trim().toLowerCase() : '';
  const device = input.fromDevice;
  const prior = asU64(input.priorEpoch);
  const next = asU64(input.nextEpoch);
  if (!room || !ACCOUNT_RE.test(account) || !DEVICE_RE.test(device) || prior === null || next === null) return null;
  if (input.commitId.byteLength !== GROUP_COMMIT_ID_BYTES || !nonZero(input.commitId)) return null;
  const enc = new TextEncoder();
  const fields = [enc.encode(room), enc.encode(account), enc.encode(device)];
  if (fields.some((field) => field.byteLength > 0xffff)) return null;
  const total = DOMAIN_BYTES.byteLength + 1 + fields.reduce((sum, field) => sum + 2 + field.byteLength, 0) + 8 + 8 + 32;
  const out = new Uint8Array(total);
  let offset = 0;
  out.set(DOMAIN_BYTES, offset); offset += DOMAIN_BYTES.byteLength;
  out[offset++] = 0;
  for (const field of fields) offset = writeField(out, offset, field);
  writeU64be(out, offset, prior); offset += 8;
  writeU64be(out, offset, next); offset += 8;
  out.set(input.commitId, offset);
  return out;
}

/** Hash a commit body together with its canonical outer context. */
export async function hashGroupCommit(record: GroupCommit, context: Uint8Array): Promise<Uint8Array | null> {
  const body = encodeGroupCommit(record);
  if (!body || context.byteLength === 0) return null;
  const material = new Uint8Array(HASH_DOMAIN_BYTES.byteLength + 1 + context.byteLength + body.byteLength);
  material.set(HASH_DOMAIN_BYTES, 0);
  material[HASH_DOMAIN_BYTES.byteLength] = 0;
  material.set(context, HASH_DOMAIN_BYTES.byteLength + 1);
  material.set(body, HASH_DOMAIN_BYTES.byteLength + 1 + context.byteLength);
  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  } finally {
    material.fill(0);
  }
}

/** Create a next-epoch commit from a transient key or precomputed commitment; neither is serialized as raw key material. */
export async function prepareGroupCommit(input: {
  room: string;
  fromAccount: string;
  fromDevice: string;
  priorEpoch: bigint | number;
  priorCommitHash: Uint8Array;
  membershipDigest: Uint8Array;
  commitId?: Uint8Array;
  /** Raw key is consumed only transiently to calculate the commitment. */
  newEpochKey?: Uint8Array;
  /** Precomputed commitment for callers that keep the raw key in a welcome path. */
  newEpochKeyCommitment?: Uint8Array;
  nextEpoch?: bigint | number;
}): Promise<PreparedGroupCommit | null> {
  const prior = asU64(input.priorEpoch);
  const next = asU64(input.nextEpoch ?? (prior === null ? -1 : prior + 1n));
  let commitId: Uint8Array;
  let key: Uint8Array | null;
  let suppliedCommitment: Uint8Array | null;
  try {
    commitId = input.commitId ? copy(input.commitId) : crypto.getRandomValues(new Uint8Array(GROUP_COMMIT_ID_BYTES));
    key = input.newEpochKey ? copy(input.newEpochKey) : null;
    suppliedCommitment = input.newEpochKeyCommitment ? copy(input.newEpochKeyCommitment) : null;
  } catch {
    return null;
  }
  if (prior === null || next === null || next <= prior
    || (key === null && suppliedCommitment === null)
    || (key !== null && (key.byteLength !== GROUP_COMMIT_KEY_BYTES || !nonZero(key)))
    || (suppliedCommitment !== null && (suppliedCommitment.byteLength !== GROUP_COMMIT_KEY_COMMITMENT_BYTES || !nonZero(suppliedCommitment)))) {
    commitId.fill(0);
    key?.fill(0);
    suppliedCommitment?.fill(0);
    return null;
  }
  const record: GroupCommit = {
    priorEpoch: prior,
    nextEpoch: next,
    priorCommitHash: copy(input.priorCommitHash),
    commitId,
    membershipDigest: copy(input.membershipDigest),
    newEpochKeyCommitment: new Uint8Array(GROUP_COMMIT_KEY_COMMITMENT_BYTES),
  };
  const computedCommitment = key
    ? await computeGroupEpochKeyCommitment({
      room: input.room,
      nextEpoch: next,
      commitId,
      membershipDigest: record.membershipDigest,
      epochKey: key,
    })
    : null;
  if (key) key.fill(0);
  if (key !== null && !computedCommitment) {
    suppliedCommitment?.fill(0);
    record.priorCommitHash.fill(0);
    record.commitId.fill(0);
    record.membershipDigest.fill(0);
    return null;
  }
  const commitment = computedCommitment ?? suppliedCommitment;
  if (computedCommitment && suppliedCommitment && !equalBytes(computedCommitment, suppliedCommitment)) {
    computedCommitment.fill(0);
    suppliedCommitment.fill(0);
    record.priorCommitHash.fill(0);
    record.commitId.fill(0);
    record.membershipDigest.fill(0);
    return null;
  }
  if (!commitment) {
    record.priorCommitHash.fill(0);
    record.commitId.fill(0);
    record.membershipDigest.fill(0);
    return null;
  }
  record.newEpochKeyCommitment = copy(commitment);
  computedCommitment?.fill(0);
  suppliedCommitment?.fill(0);
  const body = encodeGroupCommit(record);
  const context = buildGroupCommitContext({ room: input.room, fromAccount: input.fromAccount, fromDevice: input.fromDevice, priorEpoch: prior, nextEpoch: next, commitId });
  if (!body || !context) {
    commitId.fill(0);
    record.priorCommitHash.fill(0);
    record.membershipDigest.fill(0);
    record.newEpochKeyCommitment.fill(0);
    return null;
  }
  const commitHash = await hashGroupCommit(record, context);
  if (!commitHash) {
    commitId.fill(0);
    record.priorCommitHash.fill(0);
    record.membershipDigest.fill(0);
    record.newEpochKeyCommitment.fill(0);
    body.fill(0);
    context.fill(0);
    return null;
  }
  let destroyed = false;
  return {
    record,
    body,
    context,
    commitHash,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      record.priorCommitHash.fill(0);
      record.commitId.fill(0);
      record.membershipDigest.fill(0);
      record.newEpochKeyCommitment.fill(0);
      body.fill(0);
      context.fill(0);
      commitHash.fill(0);
    },
  };
}
