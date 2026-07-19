// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * deviceSign.ts — per-account device SIGNING key (account attribution, F1).
 *
 * A non-extractable Ed25519 keypair, generated on first use and persisted in
 * the existing `onyx-keys` IndexedDB store under its own record key —
 * deliberately SEPARATE from the E2EE ECDH device key (`dm-v1`): the DM
 * cipher key agrees, this key attests. It signs exactly two transcripts,
 * byte-matched to the daemon's `src/proto/account_identity.zig`:
 *
 *   enroll (IDENTITY ADD):
 *     "ONYX-ACCOUNT-IDENTITY-v1" ‖ 0x00 ‖ account ‖ 0x00 ‖ label ‖ 0x00 ‖ pub(32)
 *
 *   residence proof (IDENTITY RESIDENCE):
 *     unsigned = "ARP1"(u32 BE) ‖ len8(account) ‖ account
 *                ‖ node:u64 BE ‖ epoch:u64 BE ‖ expiry_ms:u64 BE
 *     message  = "ONYX-ACCOUNT-RESIDENCE-v1" ‖ 0x00 ‖ unsigned
 *
 * All integers are BIG-endian; every hex string on the wire is lower-case.
 * Fail-closed throughout: a keygen/sign/validation failure returns null and
 * the caller simply never sends the trusted-path commands — the account stays
 * on the daemon's conservative UID path, never a silently-weaker proof.
 */

const DB_NAME = 'onyx-keys';
const DB_VERSION = 1;
const STORE = 'device';
/** Record key for the SIGNING pair — the ECDH DM key lives under 'dm-v1'. */
const KEY_ID = 'sign-v1';

/** Domain label of the enroll self-signature (daemon `transcript_domain`). */
export const IDENTITY_DOMAIN = 'ONYX-ACCOUNT-IDENTITY-v1';
/** Domain label of the residence proof (daemon `residence_domain`). */
export const RESIDENCE_DOMAIN = 'ONYX-ACCOUNT-RESIDENCE-v1';
/** "ARP1" — the residence wire magic (daemon `residence_magic`). */
const RESIDENCE_MAGIC = 0x41525031;

/** Daemon `max_account_len` — accounts longer than this never validate. */
const MAX_ACCOUNT_LEN = 64;
/** Daemon `validLabel`: 1..32 chars of [A-Za-z0-9._-]. */
const LABEL_RE = /^[A-Za-z0-9._-]{1,32}$/;
/** A mesh node shortId as advertised: EXACTLY 16 lower hex chars. */
const NODE_HEX_RE = /^[0-9a-f]{16}$/;

export const ED25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

export interface DeviceSigningKeys {
  keyPair: CryptoKeyPair;
  /** Raw 32-byte Ed25519 public key. */
  publicRaw: Uint8Array;
  /** The same key as 64 lower-hex chars — the IDENTITY ADD wire value. */
  publicHex: string;
}

/** The residence binding the device key attests. */
export interface ResidenceBinding {
  account: string;
  /** Home node shortId, exactly 16 lower hex (from ISUPPORT ACCOUNTRESIDENCE). */
  nodeHex: string;
  /** Monotonic per-(account,node) counter (wall-clock ms works). */
  epoch: number;
  /** Wall-clock expiry, unix ms (exclusive; daemon caps it at now+1h). */
  expiryMs: number;
}

// ── hex helper ───────────────────────────────────────────────────────────────

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// ── key persistence (mirrors dmCipher's best-effort onyx-keys access) ────────

let _signingPromise: Promise<DeviceSigningKeys | null> | null = null;

function openKeysDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withPublic(kp: CryptoKeyPair): Promise<DeviceSigningKeys> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { keyPair: kp, publicRaw: raw, publicHex: toHex(raw) };
}

/**
 * The device signing key pair, created on first use and persisted as
 * structured-clone CryptoKeys (private key non-extractable — it never exists
 * as bytes outside the WebCrypto boundary). Null when the environment can't
 * sign (no IndexedDB / no Ed25519) — the caller stays on the UID path.
 */
export function deviceSigningKeys(): Promise<DeviceSigningKeys | null> {
  if (_signingPromise) return _signingPromise;
  _signingPromise = (async () => {
    try {
      const db = await openKeysDb();
      if (!db) return null;

      const existing = await new Promise<CryptoKeyPair | null>((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const get = tx.objectStore(STORE).get(KEY_ID);
        get.onsuccess = () => resolve((get.result as CryptoKeyPair | undefined) ?? null);
        get.onerror = () => resolve(null);
      });
      if (existing?.privateKey && existing.publicKey) {
        return await withPublic(existing);
      }

      const kp = (await crypto.subtle.generateKey(
        'Ed25519',
        false, // private key never leaves WebCrypto
        ['sign', 'verify'],
      )) as CryptoKeyPair;
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(kp, KEY_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return await withPublic(kp);
    } catch {
      return null;
    }
  })();
  return _signingPromise;
}

/** Test hook — drop the cached signing promise (a fresh IDBFactory follows). */
export function _resetDeviceSigningForTests(): void {
  _signingPromise = null;
}

/**
 * Sign a transcript with the device key; 128 lower-hex chars (the wire form
 * of the 64-byte Ed25519 signature), or null when signing is unavailable —
 * a sign failure BLOCKS the trusted path, it never downgrades silently.
 */
export async function signHex(message: Uint8Array): Promise<string | null> {
  const keys = await deviceSigningKeys();
  if (!keys) return null;
  try {
    const sig = await crypto.subtle.sign('Ed25519', keys.keyPair.privateKey, message as BufferSource);
    return toHex(new Uint8Array(sig));
  } catch {
    return null;
  }
}

// ── transcripts (pure; byte-matched to account_identity.zig) ─────────────────

/** Per-device enroll label: distinct per device so two devices on one account
 *  never overwrite each other's `identity.key.<label>` prop. */
export function deviceLabel(publicHex: string): string {
  return `onyx-${publicHex.slice(0, 16)}`;
}

function accountBytes(account: string): Uint8Array | null {
  const bytes = new TextEncoder().encode(account);
  if (bytes.length === 0 || bytes.length > MAX_ACCOUNT_LEN) return null;
  return bytes;
}

/**
 * The IDENTITY ADD self-signature transcript:
 * domain ‖ 0x00 ‖ account ‖ 0x00 ‖ label ‖ 0x00 ‖ pub(32). Null on any
 * invalid field (fail-closed — never sign a malformed binding).
 */
export function buildIdentityTranscript(
  account: string,
  label: string,
  publicKeyRaw: Uint8Array,
): Uint8Array | null {
  const acct = accountBytes(account);
  if (!acct || !LABEL_RE.test(label) || publicKeyRaw.length !== ED25519_PUBLIC_KEY_BYTES) return null;
  const domain = new TextEncoder().encode(IDENTITY_DOMAIN);
  const labelBytes = new TextEncoder().encode(label);
  const out = new Uint8Array(domain.length + 1 + acct.length + 1 + labelBytes.length + 1 + publicKeyRaw.length);
  let off = 0;
  out.set(domain, off); off += domain.length;
  out[off++] = 0;
  out.set(acct, off); off += acct.length;
  out[off++] = 0;
  out.set(labelBytes, off); off += labelBytes.length;
  out[off++] = 0;
  out.set(publicKeyRaw, off);
  return out;
}

/**
 * The unsigned residence wire (everything the signature covers, minus the
 * domain framing): "ARP1" ‖ len8(account) ‖ account ‖ node ‖ epoch ‖ expiry,
 * all integers u64/u32 BIG-endian. Null on any invalid field.
 */
export function residenceUnsignedWire(b: ResidenceBinding): Uint8Array | null {
  const acct = accountBytes(b.account);
  if (!acct || !NODE_HEX_RE.test(b.nodeHex)) return null;
  if (!Number.isSafeInteger(b.epoch) || b.epoch < 0) return null;
  if (!Number.isSafeInteger(b.expiryMs) || b.expiryMs < 0) return null;
  const out = new Uint8Array(4 + 1 + acct.length + 8 + 8 + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, RESIDENCE_MAGIC, false);
  out[4] = acct.length;
  out.set(acct, 5);
  let off = 5 + acct.length;
  view.setBigUint64(off, BigInt(`0x${b.nodeHex}`), false); off += 8;
  view.setBigUint64(off, BigInt(b.epoch), false); off += 8;
  view.setBigUint64(off, BigInt(b.expiryMs), false);
  return out;
}

/**
 * The exact bytes the device key signs for IDENTITY RESIDENCE:
 * "ONYX-ACCOUNT-RESIDENCE-v1" ‖ 0x00 ‖ unsigned-wire. Null when the
 * binding is invalid.
 */
export function buildResidenceMessage(b: ResidenceBinding): Uint8Array | null {
  const unsigned = residenceUnsignedWire(b);
  if (!unsigned) return null;
  const domain = new TextEncoder().encode(RESIDENCE_DOMAIN);
  const out = new Uint8Array(domain.length + 1 + unsigned.length);
  out.set(domain, 0);
  out[domain.length] = 0;
  out.set(unsigned, domain.length + 1);
  return out;
}
