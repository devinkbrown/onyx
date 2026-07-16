// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * keyPinning.ts — trust-on-first-use (TOFU) device-key pinning, the key-change
 * anti-MITM gate, and a comparable "safety number" for out-of-band verification.
 *
 * WHY THIS EXISTS
 * ---------------
 * The DM cipher (dmCipher.ts) derives a per-peer key from the peer's published
 * `ocean.dm-key` device point. That point arrives through the SERVER's METADATA
 * directory, and dmCipher only validates it STRUCTURALLY (65-byte uncompressed
 * SEC1) — it never proves the point belongs to the claimed peer. A Byzantine or
 * compromised node can therefore hand us a forged device key and machine-in-
 * the-middle an "end-to-end" DM.
 *
 * This module adds the standard client-side defence, as Signal/WhatsApp/Matrix
 * do: PIN the peer's key on first use, and on any later SILENT change refuse to
 * seal/open under the new key until the user explicitly re-pins (having verified
 * the peer out-of-band via the safety number). It needs NO daemon change.
 *
 * KNOWN LIMITATION (inherent to TOFU): if an attacker is present on the VERY
 * FIRST contact, we pin the attacker's key. That residual risk is exactly what
 * the safety number closes — two humans compare the 60-digit number out-of-band
 * and detect a MITM even on first contact. Follow-ups: surface the safety number
 * + the blocking key-change warning in the DM UI (onyx-render / onyx-ui), and
 * bind the KEYTRANS proof to the pinned key (onyx-crypto + a daemon co-check).
 *
 * Storage: its OWN IndexedDB ('onyx-key-pins'), deliberately SEPARATE from the
 * device-key store ('onyx-keys'). Keeping trust state in a sibling DB means we
 * never touch the identity-key store's schema/version — a botched DB_VERSION
 * bump there would orphan the device key and silently lose decryptable history.
 * It also lets "reset trust / re-pin everyone" stay independent of "forget my
 * identity key".
 */

import { deviceKeys, isEnvelope, isValidPeerPublicKey, openDm, sealDm } from './dmCipher';
import {
  deviceMemoryOwnerKey,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';

// ── pin store (sibling IndexedDB) ─────────────────────────────────────────────

const PIN_DB_NAME = 'onyx-key-pins';
const PIN_DB_VERSION = 1;
const PIN_STORE = 'pins';

/**
 * Normalize the account identifier for the pin bucket. This DELIBERATELY matches
 * the store's existing `peerDmKeys`/`dms` keying (`nick.toLowerCase()`) so a pin
 * and the peer key it guards land in the same bucket in both send and receive
 * directions. NOTE: `toLowerCase()` is NOT the server's RFC1459/services
 * casemapping — that mismatch is a pre-existing, store-wide convention, not
 * introduced here. If the client ever adopts server-authoritative account
 * folding, the store keys and this pin key must move together (a solidjs-coder /
 * orochi-ircx co-check), or the buckets will diverge and the gate will silently
 * degrade.
 */
function acctKey(account: string): string {
  return account.toLowerCase();
}

/**
 * Physical trust bucket. Signed sessions always include the local owner, so two
 * accounts on the same browser can make independent trust decisions about the
 * same peer. Omitting `owner` deliberately addresses only the legacy bucket;
 * old unowned pins stay quarantined instead of being claimed by the next login.
 */
function pinRecordKey(account: string, owner?: DeviceMemoryOwner): string | null {
  const peer = acctKey(account);
  if (owner === undefined) return peer;
  const ownerKey = deviceMemoryOwnerKey(owner);
  return ownerKey ? JSON.stringify([ownerKey, peer]) : null;
}

function openPinsDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(PIN_DB_NAME, PIN_DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(PIN_STORE)) {
          req.result.createObjectStore(PIN_STORE);
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

/** ok:false means the store could not be read at all — callers MUST fail closed. */
type PinRead = { ok: true; key: string | null } | { ok: false };

function readPin(account: string, owner?: DeviceMemoryOwner): Promise<PinRead> {
  const recordKey = pinRecordKey(account, owner);
  if (!recordKey) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    void openPinsDb().then((db) => {
      if (!db) return resolve({ ok: false });
      try {
        const tx = db.transaction(PIN_STORE, 'readonly');
        const get = tx.objectStore(PIN_STORE).get(recordKey);
        get.onsuccess = () => {
          const val = get.result;
          db.close();
          resolve({ ok: true, key: typeof val === 'string' ? val : null });
        };
        get.onerror = () => {
          db.close();
          resolve({ ok: false });
        };
      } catch {
        db.close();
        resolve({ ok: false });
      }
    });
  });
}

function writePin(account: string, key: string, owner?: DeviceMemoryOwner): Promise<boolean> {
  const recordKey = pinRecordKey(account, owner);
  if (!recordKey) return Promise.resolve(false);
  return new Promise((resolve) => {
    void openPinsDb().then((db) => {
      if (!db) return resolve(false);
      try {
        const tx = db.transaction(PIN_STORE, 'readwrite');
        tx.objectStore(PIN_STORE).put(key, recordKey);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
        tx.onabort = () => {
          db.close();
          resolve(false);
        };
      } catch {
        db.close();
        resolve(false);
      }
    });
  });
}

function deletePin(account: string, owner?: DeviceMemoryOwner): Promise<void> {
  const recordKey = pinRecordKey(account, owner);
  if (!recordKey) return Promise.resolve();
  return new Promise((resolve) => {
    void openPinsDb().then((db) => {
      if (!db) return resolve();
      try {
        const tx = db.transaction(PIN_STORE, 'readwrite');
        tx.objectStore(PIN_STORE).delete(recordKey);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  });
}

// ── public pin API ────────────────────────────────────────────────────────────

/** The device key currently pinned for an account, or null if none / unreadable. */
export async function pinnedPeerKey(
  account: string,
  owner?: DeviceMemoryOwner,
): Promise<string | null> {
  const read = await readPin(account, owner);
  return read.ok ? read.key : null;
}

/**
 * Pin (first use) or re-pin (explicit user accept of a key change) an account's
 * device key. Rejects a structurally invalid key so garbage is never pinned.
 * Returns false if the key is invalid OR the write could not be persisted — in
 * which case the caller must fail closed rather than proceed unverified.
 */
export async function pinPeerKey(
  account: string,
  key: string,
  owner?: DeviceMemoryOwner,
): Promise<boolean> {
  if (!isValidPeerPublicKey(key)) return false;
  return writePin(account, key, owner);
}

/** Forget an account's pin (drops back to first-use on next contact). */
export function unpinPeerKey(account: string, owner?: DeviceMemoryOwner): Promise<void> {
  return deletePin(account, owner);
}

/** The trust verdict for a presented key against the account's pin. */
export type PeerKeyVerdict =
  /** No pin yet — trust-on-first-use will pin this key. */
  | 'first-use'
  /** Presented key equals the pinned key — proceed silently. */
  | 'unchanged'
  /** Presented key differs from the pin — a possible MITM; block until accepted. */
  | 'changed'
  /** The pin store could not be read — cannot verify trust, so fail closed. */
  | 'unreadable';

/**
 * Compare a presented device key against the account's pin WITHOUT mutating
 * anything. Pure read: pinning happens explicitly in the gated seal/open paths
 * or via pinPeerKey, so a mere status check never establishes trust.
 */
export async function peerKeyStatus(
  account: string,
  presentedKey: string,
  owner?: DeviceMemoryOwner,
): Promise<PeerKeyVerdict> {
  const read = await readPin(account, owner);
  if (!read.ok) return 'unreadable';
  if (read.key === null) return 'first-use';
  return read.key === presentedKey ? 'unchanged' : 'changed';
}

// ── gated seal / open (the anti-MITM enforcement points) ──────────────────────

/** Outcome of a trust-gated seal. Only `sealed` puts ciphertext on the wire. */
export type SealTrustedOutcome =
  | { status: 'sealed'; envelope: string; keyStatus: 'first-use' | 'unchanged' }
  /** The peer's key silently changed — nothing sent; warn + require re-pin. */
  | { status: 'key-changed'; envelope: null; pinnedKey: string }
  /** Invalid key, unreadable/unwritable pin store, or a seal failure. */
  | { status: 'unavailable'; envelope: null };

/**
 * Seal a DM to a peer ONLY if their presented device key is trusted:
 *  - first-use  -> pin the key (TOFU), then seal;
 *  - unchanged  -> seal;
 *  - changed    -> BLOCK (no ciphertext), report the pinned key for the warning;
 *  - unreadable -> fail closed (unavailable).
 *
 * Fail-closed throughout: on any inability to establish or verify trust we emit
 * NO ciphertext and NO plaintext — the caller must not fall back to an
 * unencrypted send. Preserves the underlying static-static seal (sealDm).
 */
export async function sealDmTrusted(
  account: string,
  presentedKey: string,
  plaintext: string,
  owner?: DeviceMemoryOwner,
): Promise<SealTrustedOutcome> {
  if (!isValidPeerPublicKey(presentedKey)) return { status: 'unavailable', envelope: null };

  const verdict = await peerKeyStatus(account, presentedKey, owner);
  if (verdict === 'unreadable') return { status: 'unavailable', envelope: null };
  if (verdict === 'changed') {
    const pinnedKey = (await pinnedPeerKey(account, owner)) ?? '';
    return { status: 'key-changed', envelope: null, pinnedKey };
  }
  if (verdict === 'first-use') {
    // TOFU: persist the pin BEFORE sealing. If we cannot persist it we cannot
    // detect a future silent swap, so refuse rather than seal unverifiably.
    if (!(await pinPeerKey(account, presentedKey, owner))) return { status: 'unavailable', envelope: null };
  }

  const envelope = await sealDm(presentedKey, plaintext);
  if (!envelope) return { status: 'unavailable', envelope: null };
  return { status: 'sealed', envelope, keyStatus: verdict === 'first-use' ? 'first-use' : 'unchanged' };
}

/** Outcome of a trust-gated open. Only `opened` yields plaintext. */
export type OpenTrustedOutcome =
  | { status: 'opened'; plaintext: string; keyStatus: 'first-use' | 'unchanged' }
  /**
   * Ciphertext stays locked. `key-changed` = the sender key silently changed
   * (do not decrypt under an unverified key); `undecryptable` = not our
   * envelope / wrong or rotated key; `unavailable` = invalid key or unreadable
   * pin store. Every reason maps to LOCKED_PLACEHOLDER, never a plaintext leak.
   */
  | { status: 'locked'; reason: 'key-changed' | 'undecryptable' | 'unavailable' };

/**
 * Open a DM from a peer ONLY if their presented device key is trusted. A
 * silently-changed sender key stays LOCKED — we do not even attempt to decrypt
 * with a key that may be forged.
 *
 * The receive path is OPEN-THEN-PIN (deliberately asymmetric with the send
 * path's pin-then-seal): on first contact we decrypt FIRST and pin only after a
 * successful GCM auth. A key that never produced a validly-sealed message from a
 * holder of its private half is therefore never pinned — this defeats a cheap
 * pin-poisoning DoS where an origin-spoofed PRIVMSG carries a random valid-shaped
 * key (whose secret the attacker does not hold) purely to occupy the pin slot
 * and block the real peer. A decrypt failure locks as undecryptable. Preserves
 * openDm.
 */
export async function openDmTrusted(
  account: string,
  presentedKey: string,
  envelope: string,
  owner?: DeviceMemoryOwner,
): Promise<OpenTrustedOutcome> {
  if (!isEnvelope(envelope)) return { status: 'locked', reason: 'undecryptable' };
  if (!isValidPeerPublicKey(presentedKey)) return { status: 'locked', reason: 'unavailable' };

  const verdict = await peerKeyStatus(account, presentedKey, owner);
  if (verdict === 'unreadable') return { status: 'locked', reason: 'unavailable' };
  if (verdict === 'changed') return { status: 'locked', reason: 'key-changed' };

  // Decrypt before establishing trust. On an unchanged pin this is the normal
  // open; on first-use it also cryptographically confirms the key before pinning.
  const plaintext = await openDm(presentedKey, envelope);
  if (plaintext == null) return { status: 'locked', reason: 'undecryptable' };

  if (verdict === 'first-use') {
    // Pin only a key we have just confirmed can produce a valid message.
    if (!(await pinPeerKey(account, presentedKey, owner))) return { status: 'locked', reason: 'unavailable' };
  }
  return { status: 'opened', plaintext, keyStatus: verdict === 'first-use' ? 'first-use' : 'unchanged' };
}

// ── safety number (out-of-band verification) ──────────────────────────────────

/** Domain-separation + version tag for the safety-number hash. */
const SAFETY_LABEL = 'onyx-safety-v1';
/** Digits per readable group. */
const GROUP_DIGITS = 5;
/** Number of groups -> 60 digits total, matching the Signal display length. */
const GROUP_COUNT = 12;
/** Bytes consumed per 5-digit group (a 40-bit big-endian window). */
const BYTES_PER_GROUP = 5;
/** 10^5 — the modulus that maps a 40-bit window to a 5-digit group. */
const GROUP_MODULUS = 100000;

/**
 * Turn `count` 5-byte windows of `bytes` into zero-padded 5-digit decimal groups
 * (libsignal's NumericFingerprintGenerator encoding: a 40-bit big-endian window
 * mod 100000). `bytes` must hold at least count*5 bytes.
 */
function encodeGroups(bytes: Uint8Array, count: number): string {
  const groups: string[] = [];
  for (let g = 0; g < count; g++) {
    const off = g * BYTES_PER_GROUP;
    // 40-bit big-endian value. Multiply (not bit-shift) to stay in Number's
    // exact-integer range — a 40-bit value is well under 2^53.
    let v = 0;
    for (let i = 0; i < BYTES_PER_GROUP; i++) v = v * 256 + bytes[off + i]!;
    groups.push(String(v % GROUP_MODULUS).padStart(GROUP_DIGITS, '0'));
  }
  return groups.join(' ');
}

/**
 * A stable, order-independent 60-digit safety number over two device keys, for
 * out-of-band comparison (read aloud / scan) to detect a MITM'd or swapped key.
 *
 * Construction (a de-scoped libsignal NumericFingerprint):
 *  - sort the two base64url keys -> order-independence, matching the cipher's
 *    own sorted-`info` convention in sharedKeyWith;
 *  - one domain-separated SHA-512 over `label 0x00 keyLo 0x00 keyHi` gives 64
 *    bytes; the first 60 become twelve 5-digit groups via Signal's proven
 *    40-bit-window-mod-100000 encoding (encodeGroups).
 *
 * Single-pass (no Signal-style 5200x iteration) is sound HERE: a ~199-bit,
 * full-number comparison over already-256-bit-high-entropy ECDH points makes a
 * colliding-truncation second-preimage infeasible. Signal iterates only to slow
 * a brute-force grind against a SHORT prefix of a fingerprint that also mixes a
 * LOW-entropy stable identifier (a phone number); neither the partial-compare
 * nor the low-entropy input applies to two random curve points. Matrix's SAS
 * likewise uses un-iterated hashing for the same interactive-comparison job.
 *
 * Returns null if either key is structurally invalid.
 */
export async function safetyNumber(keyA_b64: string, keyB_b64: string): Promise<string | null> {
  if (!isValidPeerPublicKey(keyA_b64) || !isValidPeerPublicKey(keyB_b64)) return null;

  const [lo, hi] = [keyA_b64, keyB_b64].sort();
  const material = new TextEncoder().encode(`${SAFETY_LABEL}\x00${lo}\x00${hi}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', material.buffer as ArrayBuffer));
  // SHA-512 = 64 bytes; encodeGroups consumes the first 60 (12 x 5).
  return encodeGroups(digest, GROUP_COUNT);
}

/**
 * The safety number binding OUR device key to the peer's PINNED key — the value
 * the DM UI surfaces for out-of-band verification. Null if we have no device key
 * or the peer is not yet pinned.
 */
export async function peerSafetyNumber(
  account: string,
  owner?: DeviceMemoryOwner,
): Promise<string | null> {
  const pinned = await pinnedPeerKey(account, owner);
  if (!pinned) return null;
  const mine = await deviceKeys();
  if (!mine) return null;
  return safetyNumber(mine.publicB64, pinned);
}
