// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ODD1 (Onyx Device Directory v1) and the bounded E2EEKEY LIST collector.
 *
 * ODD1 is deliberately a tiny public-key record.  It is not a credential and
 * it never contains a room secret:
 *
 *   magic (4) | suite (1) | Ed25519 signer (32) | P-256 point (65)
 *
 * Directory records are retained even when they are from an older/unknown
 * algorithm, but only a structurally valid ODD1 record whose deterministic id
 * matches the E2EEKEY id is eligible for trusted group-control verification.
 */

import { fromB64url, toB64url } from './dmCipher';

export const GROUP_DEVICE_DIRECTORY_MAGIC = 'ODD1';
export const GROUP_DEVICE_DIRECTORY_SUITE = 0x01;
export const GROUP_DEVICE_DIRECTORY_ID_DOMAIN = 'ONYX-OGC1-DEVICE-ID-v1';
/** Short aliases make the domain explicit to callers constructing test vectors. */
export const GROUP_DEVICE_ID_DOMAIN = GROUP_DEVICE_DIRECTORY_ID_DOMAIN;
export const ODD1_DEVICE_ID_DOMAIN = GROUP_DEVICE_DIRECTORY_ID_DOMAIN;

export const GROUP_DEVICE_DIRECTORY_BINARY_BYTES = 102;
export const ED25519_DEVICE_DIRECTORY_BYTES = 32;
export const P256_DEVICE_DIRECTORY_BYTES = 65;
export const MAX_GROUP_DEVICE_DIRECTORY_ENTRIES = 64;
export const GROUP_DEVICE_DIRECTORY_ALGORITHM = 'onyx-ogc1-v1';
export const ODD1_ALGORITHM = GROUP_DEVICE_DIRECTORY_ALGORITHM;
export const ODD1_MAGIC = GROUP_DEVICE_DIRECTORY_MAGIC;
export const ODD1_SUITE = GROUP_DEVICE_DIRECTORY_SUITE;

const MAGIC_BYTES = new TextEncoder().encode(GROUP_DEVICE_DIRECTORY_MAGIC);
const B64URL_RE = /^[A-Za-z0-9_-]+$/u;
const DEVICE_ID_RE = /^[A-Za-z0-9_.-]{1,32}$/u;
const ACCOUNT_RE = /^[A-Za-z0-9_.@-]{1,64}$/u;
const TOKEN_RE = /^[A-Za-z0-9_.:@+/=-]{1,4096}$/u;

// NIST P-256 field and curve constants.  The directory carries a raw
// uncompressed SEC1 point, so validation is deliberately self-contained and
// does not depend on a browser WebCrypto import accepting a malformed point.
const P256_P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const P256_B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return BigInt(`0x${hex}`);
}

function modP256(value: bigint): bigint {
  const reduced = value % P256_P;
  return reduced < 0n ? reduced + P256_P : reduced;
}

/** Validate a raw SEC1 uncompressed P-256 public point. */
export function isValidP256UncompressedPublicKey(raw: Uint8Array): boolean {
  if (raw.byteLength !== P256_DEVICE_DIRECTORY_BYTES || raw[0] !== 0x04) return false;
  const x = bytesToBigInt(raw.slice(1, 33));
  const y = bytesToBigInt(raw.slice(33, 65));
  if (x >= P256_P || y >= P256_P) return false;
  const lhs = modP256(y * y);
  const rhs = modP256((x * x * x) - (3n * x) + P256_B);
  return lhs === rhs;
}

export type GroupDeviceDirectoryEntry = {
  /** Raw 32-byte Ed25519 key used as the OGC1 signer. */
  signerPub: Uint8Array;
  /** Raw 65-byte uncompressed SEC1 P-256 encryption key. */
  encryptionPub: Uint8Array;
};

export type GroupDeviceDirectoryRecord = {
  account: string;
  deviceId: string;
  algorithm: string;
  /** Original E2EEKEY public-key token, retained for diagnostics. */
  publicKey: string;
  /** Exact base64url signer key; this is the directory lookup key. */
  directoryKey: string | null;
  /** True only for a valid ODD1 record with a matching deterministic id. */
  trusted: boolean;
  /** Unknown or malformed legacy rows are retained but never trusted. */
  legacy: boolean;
  entry: GroupDeviceDirectoryEntry | null;
};

export type GroupDeviceDirectorySnapshot = {
  account: string;
  devices: readonly GroupDeviceDirectoryRecord[];
  trusted: readonly GroupDeviceDirectoryRecord[];
  /** Exact wire signer key → row. Never keyed by the advertised device id. */
  bySigner: ReadonlyMap<string, GroupDeviceDirectoryRecord>;
};

export type GroupDeviceDirectorySnapshotLine =
  | { kind: 'device'; account: string; deviceId: string; algorithm: string; publicKey: string }
  | { kind: 'end'; account: string; count: number };

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function hasNonZeroByte(bytes: Uint8Array): boolean {
  let nonZero = 0;
  for (const byte of bytes) nonZero |= byte;
  return nonZero !== 0;
}

function validAccount(account: string): boolean {
  return ACCOUNT_RE.test(account);
}

function validDeviceId(deviceId: string): boolean {
  return DEVICE_ID_RE.test(deviceId);
}

/** Pack ODD1 bytes. Returns null for any wrong key shape. */
export function packGroupDeviceDirectoryEntry(
  entry: GroupDeviceDirectoryEntry,
): Uint8Array | null {
  if (
    entry.signerPub.byteLength !== ED25519_DEVICE_DIRECTORY_BYTES
    || !hasNonZeroByte(entry.signerPub)
    || entry.encryptionPub.byteLength !== P256_DEVICE_DIRECTORY_BYTES
    || !isValidP256UncompressedPublicKey(entry.encryptionPub)
  ) return null;

  const raw = new Uint8Array(GROUP_DEVICE_DIRECTORY_BINARY_BYTES);
  raw.set(MAGIC_BYTES, 0);
  raw[4] = GROUP_DEVICE_DIRECTORY_SUITE;
  raw.set(entry.signerPub, 5);
  raw.set(entry.encryptionPub, 5 + ED25519_DEVICE_DIRECTORY_BYTES);
  return raw;
}

/** Encode ODD1 as canonical unpadded base64url. */
export function encodeGroupDeviceDirectoryEntry(
  entry: GroupDeviceDirectoryEntry,
): string | null {
  const raw = packGroupDeviceDirectoryEntry(entry);
  return raw ? toB64url(raw) : null;
}

function decodeRaw(raw: Uint8Array): GroupDeviceDirectoryEntry | null {
  if (raw.byteLength !== GROUP_DEVICE_DIRECTORY_BINARY_BYTES) return null;
  if (!equalBytes(raw.slice(0, MAGIC_BYTES.length), MAGIC_BYTES)) return null;
  if (raw[4] !== GROUP_DEVICE_DIRECTORY_SUITE) return null;
  const signerPub = raw.slice(5, 5 + ED25519_DEVICE_DIRECTORY_BYTES);
  if (!hasNonZeroByte(signerPub)) return null;
  const encryptionPub = raw.slice(5 + ED25519_DEVICE_DIRECTORY_BYTES);
  if (!isValidP256UncompressedPublicKey(encryptionPub)) return null;
  return {
    signerPub,
    encryptionPub,
  };
}

/** Decode ODD1 from bytes or a canonical base64url token. */
export function decodeGroupDeviceDirectoryEntry(
  wire: string | Uint8Array,
): GroupDeviceDirectoryEntry | null {
  const raw = typeof wire === 'string'
    ? (!B64URL_RE.test(wire) ? null : fromB64url(wire))
    : wire;
  if (!raw) return null;
  if (typeof wire === 'string' && toB64url(raw) !== wire) return null;
  return decodeRaw(raw);
}

type DeviceIdInput = string | Uint8Array | GroupDeviceDirectoryEntry;

/**
 * Stable id for an ODD1 record: `ogc1-` plus the first 22 chars of the
 * base64url SHA-256 of `domain NUL raw_odd1_bytes`.
 */
export async function deriveGroupDeviceId(input: DeviceIdInput): Promise<string | null> {
  let raw: Uint8Array | null;
  if (typeof input === 'string' || input instanceof Uint8Array) {
    raw = typeof input === 'string' ? (() => {
      const decoded = decodeGroupDeviceDirectoryEntry(input);
      return decoded ? packGroupDeviceDirectoryEntry(decoded) : null;
    })() : (decodeRaw(input) ? copyBytes(input) : null);
  } else {
    raw = packGroupDeviceDirectoryEntry(input);
  }
  if (!raw) return null;

  try {
    const domain = new TextEncoder().encode(GROUP_DEVICE_DIRECTORY_ID_DOMAIN);
    const material = new Uint8Array(domain.byteLength + 1 + raw.byteLength);
    material.set(domain, 0);
    material[domain.byteLength] = 0;
    material.set(raw, domain.byteLength + 1);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material.buffer as ArrayBuffer));
    return `ogc1-${toB64url(digest).slice(0, 22)}`;
  } catch {
    return null;
  }
}

function parseSnapshotFields(text: string): GroupDeviceDirectorySnapshotLine | null {
  const match = /^E2EEKEY\s+(DEVICE|END)\s+(.+)$/u.exec(text.trim());
  if (!match) return null;
  const kind = match[1]!.toLowerCase();
  const fields = match[2]!.split(/\s+/u);
  const values = new Map<string, string>();
  for (const field of fields) {
    const equals = field.indexOf('=');
    if (equals <= 0 || equals === field.length - 1) return null;
    const key = field.slice(0, equals);
    const value = field.slice(equals + 1);
    if (!/^[a-z]+$/u.test(key) || !TOKEN_RE.test(value) || values.has(key)) return null;
    values.set(key, value);
  }
  const account = values.get('account') ?? '';
  if (!validAccount(account)) return null;
  if (kind === 'device') {
    const deviceId = values.get('id') ?? '';
    const algorithm = values.get('alg') ?? '';
    const publicKey = values.get('key') ?? '';
    if (
      !validDeviceId(deviceId)
      || algorithm.length === 0
      || algorithm.length > 64
      || publicKey.length === 0
    ) return null;
    if (values.size !== 4 || !values.has('account') || !values.has('id') || !values.has('alg') || !values.has('key')) return null;
    return { kind: 'device', account, deviceId, algorithm, publicKey };
  }

  const rawCount = values.get('devices') ?? '';
  if (values.size !== 2 || !values.has('account') || !/^\d{1,2}$/u.test(rawCount)) return null;
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_GROUP_DEVICE_DIRECTORY_ENTRIES) return null;
  return { kind: 'end', account, count };
}

/** Parse one authenticated E2EEKEY reply-body line; IRC framing is rejected. */
export function parseGroupDeviceDirectorySnapshotLine(
  input: string,
): GroupDeviceDirectorySnapshotLine | null {
  return parseSnapshotFields(input.trim());
}

function isOddAlgorithm(algorithm: string): boolean {
  return algorithm === GROUP_DEVICE_DIRECTORY_ALGORITHM;
}

async function materializeRecord(
  line: Extract<GroupDeviceDirectorySnapshotLine, { kind: 'device' }>,
): Promise<GroupDeviceDirectoryRecord> {
  const entry = isOddAlgorithm(line.algorithm)
    ? decodeGroupDeviceDirectoryEntry(line.publicKey)
    : null;
  const derivedId = entry ? await deriveGroupDeviceId(entry) : null;
  const trusted = Boolean(entry && derivedId === line.deviceId);
  return {
    account: line.account,
    deviceId: line.deviceId,
    algorithm: line.algorithm,
    publicKey: line.publicKey,
    directoryKey: entry ? toB64url(entry.signerPub) : null,
    trusted,
    legacy: !trusted,
    entry,
  };
}

/**
 * Bounded E2EEKEY LIST collector. It accepts only a complete DEVICE…END
 * snapshot. Once a malformed, duplicate, over-cap, drifted, or post-END line
 * is observed the collector remains failed and cannot be recovered by later
 * input.
 */
export class GroupDeviceDirectoryCollector {
  private account: string | null = null;
  private rows: GroupDeviceDirectoryRecord[] = [];
  private ended = false;
  private failed = false;
  private expectedCount: number | null = null;
  private processing: Promise<void> = Promise.resolve();

  get isFailed(): boolean { return this.failed; }
  get isComplete(): boolean { return this.ended && !this.failed; }

  /** Admit one already authenticated E2EEKEY reply-body line. */
  accept(input: string): boolean {
    if (this.failed || this.ended) return false;
    const line = parseGroupDeviceDirectorySnapshotLine(input);
    if (!line) { this.failed = true; return false; }
    if (this.account === null) this.account = line.account;
    if (line.account !== this.account) { this.failed = true; return false; }

    if (line.kind === 'end') {
      if (this.expectedCount !== null || line.count !== this.rows.length) {
        this.failed = true;
        return false;
      }
      this.expectedCount = line.count;
      this.ended = true;
      return true;
    }
    if (this.rows.length >= MAX_GROUP_DEVICE_DIRECTORY_ENTRIES || this.rows.some((row) => row.deviceId === line.deviceId)) {
      this.failed = true;
      return false;
    }

    // A structural row is retained immediately. ODD1 id derivation runs in a
    // serialized promise and can only downgrade trust, never admit a bad row.
    const provisional: GroupDeviceDirectoryRecord = {
      account: line.account,
      deviceId: line.deviceId,
      algorithm: line.algorithm,
      publicKey: line.publicKey,
      directoryKey: null,
      trusted: false,
      legacy: true,
      entry: null,
    };
    this.rows.push(provisional);
    this.processing = this.processing.then(async () => {
      const row = await materializeRecord(line);
      const index = this.rows.indexOf(provisional);
      if (index >= 0) this.rows[index] = row;
    }).catch(() => { this.failed = true; });
    return true;
  }

  consume(input: string): boolean { return this.accept(input); }
  push(input: string): boolean { return this.accept(input); }

  /** Await ODD1 id derivations and return a complete snapshot, or null. */
  async complete(): Promise<GroupDeviceDirectorySnapshot | null> {
    await this.processing;
    return this.finish();
  }

  /** Synchronous finalization for legacy rows / callers that do not need ODD1 ids. */
  finish(): GroupDeviceDirectorySnapshot | null {
    if (this.failed || !this.ended || this.account === null || this.expectedCount !== this.rows.length) return null;
    const bySigner = new Map<string, GroupDeviceDirectoryRecord>();
    for (const row of this.rows) {
      if (!row.trusted || !row.directoryKey) continue;
      if (bySigner.has(row.directoryKey)) return null;
      bySigner.set(row.directoryKey, row);
    }
    return {
      account: this.account,
      devices: this.rows.slice(),
      trusted: this.rows.filter((row) => row.trusted),
      bySigner,
    };
  }

  async snapshot(): Promise<GroupDeviceDirectorySnapshot | null> { return this.complete(); }
}

/** Collect a complete snapshot from already authenticated E2EEKEY reply-body lines. */
export async function collectGroupDeviceDirectorySnapshot(
  inputs: readonly string[],
): Promise<GroupDeviceDirectorySnapshot | null> {
  const collector = new GroupDeviceDirectoryCollector();
  for (const input of inputs) {
    if (!collector.accept(input)) return null;
  }
  return collector.complete();
}

/** Synchronous convenience for snapshots containing only legacy rows. */
export function collectGroupDeviceDirectorySnapshotSync(
  inputs: readonly string[],
): GroupDeviceDirectorySnapshot | null {
  const collector = new GroupDeviceDirectoryCollector();
  for (const input of inputs) if (!collector.accept(input)) return null;
  return collector.finish();
}
