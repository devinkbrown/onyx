// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dmCipher.ts — end-to-end encryption for DMs (Roadmap Phase 3.6).
 *
 * No new cryptography: the same Web Crypto primitives the Tsumugi media
 * engine already ships (P-256 ECDH + HKDF-SHA-256 + AES-GCM), arranged
 * static-static so BOTH directions and replayed history derive the same key:
 *
 *   shared  = ECDH(my_device_secret, peer_device_public)
 *   aes_key = HKDF(shared, salt="onyx-dm-v1", info=sorted(pubA ‖ pubB))
 *   wire    = "TSUMUGI1 " ‖ b64url(nonce12 ‖ ciphertext‖tag)
 *
 * The envelope rides an ordinary PRIVMSG, so CHATHISTORY, session-sync and
 * the outbox all carry ciphertext untouched; the server (and its search
 * index) only ever sees the envelope. Device keys are per-DEVICE: another
 * device on the same account (different key) shows a locked placeholder
 * rather than silently reading — the honest failure mode.
 *
 * Key storage: its OWN IndexedDB ('onyx-keys'), deliberately separate from
 * the history vault so "forget local history" never destroys identity keys.
 */

const DB_NAME = 'onyx-keys';
const DB_VERSION = 1;
const STORE = 'device';
const KEY_ID = 'dm-v1';

export const ENVELOPE_PREFIX = 'TSUMUGI1 ';
/** Rendered in place of ciphertext we cannot open (wrong device, lost key). */
export const LOCKED_PLACEHOLDER = '🔒 Encrypted message (sent to another device)';

const CURVE = 'P-256';
const HKDF_SALT = new TextEncoder().encode('onyx-dm-v1');

/** AES-GCM nonce (IV) length, in bytes — fresh-random per message. */
const NONCE_BYTES = 12;
/** AES-GCM authentication tag length, in bytes (128-bit, the WebCrypto default). */
const GCM_TAG_BYTES = 16;
/** Smallest possible body: a nonce plus a bare (empty-plaintext) GCM tag. */
const MIN_BODY_BYTES = NONCE_BYTES + GCM_TAG_BYTES;

/** Base64url alphabet, no padding — the exact envelope-body encoding. */
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export interface DeviceKeys {
  keyPair: CryptoKeyPair;
  /** Raw uncompressed SEC1 public key, base64url-unpadded — the METADATA value. */
  publicB64: string;
}

// ── base64url helpers ────────────────────────────────────────────────────────

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array | null {
  // Strict + fail-closed, mirroring the WebAuthn b64urlToBytes decoder: the wire
  // is base64url with NO padding, so any '+', '/', '=' or out-of-alphabet
  // character — or an impossible length %4===1 — is a malformed envelope. Reject
  // to null rather than silently decoding standard-base64 or junk to the wrong
  // bytes (which would otherwise only surface later as a GCM auth failure).
  if (!B64URL_RE.test(text) || text.length % 4 === 1) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ── device key persistence ───────────────────────────────────────────────────

let _devicePromise: Promise<DeviceKeys | null> | null = null;

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

async function exportPublicB64(kp: CryptoKeyPair): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return toB64url(new Uint8Array(raw));
}

/**
 * The device key pair, created on first use and persisted as structured-clone
 * CryptoKeys (private key non-extractable — it never exists as bytes outside
 * the WebCrypto boundary). Null when the environment can't do E2EE.
 */
export function deviceKeys(): Promise<DeviceKeys | null> {
  if (_devicePromise) return _devicePromise;
  _devicePromise = (async () => {
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
        return { keyPair: existing, publicB64: await exportPublicB64(existing) };
      }

      const kp = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: CURVE },
        false, // private key never leaves WebCrypto
        ['deriveKey', 'deriveBits'],
      );
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(kp, KEY_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return { keyPair: kp, publicB64: await exportPublicB64(kp) };
    } catch {
      return null;
    }
  })();
  return _devicePromise;
}

/** Test hook — drop the cached device promise (a fresh IDBFactory follows). */
export function _resetDeviceKeysForTests(): void {
  _devicePromise = null;
}

// ── key agreement ────────────────────────────────────────────────────────────

/** Length of a raw uncompressed SEC1 P-256 public point: 0x04 ‖ X(32) ‖ Y(32). */
const SEC1_UNCOMPRESSED_BYTES = 65;
/** SEC1 tag byte identifying an uncompressed point. */
const SEC1_UNCOMPRESSED_TAG = 0x04;

/**
 * Structural fail-closed validation of a peer's published device key BEFORE it
 * ever reaches importKey: it must decode to a 65-byte uncompressed SEC1 point
 * (leading 0x04). This does NOT prove the point is on the curve — importKey /
 * deriveBits does that — it only rejects the obviously-malformed shapes early
 * so a bad advertisement is refused, never coerced. Note: this is a STRUCTURAL
 * check only; it says nothing about WHOSE key it is — binding a key to a claimed
 * peer is the job of the trust-on-first-use pin layer (keyPinning.ts).
 */
export function isValidPeerPublicKey(peerPublicB64: string): boolean {
  const raw = fromB64url(peerPublicB64);
  return raw !== null && raw.length === SEC1_UNCOMPRESSED_BYTES && raw[0] === SEC1_UNCOMPRESSED_TAG;
}

/**
 * Stable, non-secret registry id for this browser's E2EE key.
 *
 * The account protocol indexes keys by a caller-provided device id. A constant
 * id such as `browser` makes a second Onyx installation overwrite the first.
 * Derive a compact id from the public point instead: it is stable across page
 * reloads, distinct for independently generated devices, valid for the wire's
 * 32-character id bound, and reveals no private material.
 */
export async function deviceRegistryId(publicB64: string): Promise<string | null> {
  if (!isValidPeerPublicKey(publicB64)) return null;
  const raw = fromB64url(publicB64);
  if (!raw) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', raw.buffer as ArrayBuffer);
    return `web-${toB64url(new Uint8Array(digest)).slice(0, 20)}`;
  } catch {
    return null;
  }
}

const _sharedKeyCache = new Map<string, Promise<CryptoKey | null>>();

/**
 * The AES-GCM key shared with a peer's published device key. Symmetric in
 * both directions: the HKDF info concatenates the two public keys sorted, so
 * sender and recipient (and either one replaying history) derive identically.
 */
export function sharedKeyWith(peerPublicB64: string): Promise<CryptoKey | null> {
  const cached = _sharedKeyCache.get(peerPublicB64);
  if (cached) return cached;
  const p = (async (): Promise<CryptoKey | null> => {
    try {
      const mine = await deviceKeys();
      if (!mine) return null;
      const peerRaw = fromB64url(peerPublicB64);
      if (!peerRaw || peerRaw.length !== SEC1_UNCOMPRESSED_BYTES || peerRaw[0] !== SEC1_UNCOMPRESSED_TAG) {
        return null;
      }
      const peerKey = await crypto.subtle.importKey(
        'raw',
        peerRaw.buffer as ArrayBuffer,
        { name: 'ECDH', namedCurve: CURVE },
        false,
        [],
      );
      const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peerKey },
        mine.keyPair.privateKey,
        256,
      );
      const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
      const pair = [mine.publicB64, peerPublicB64].sort();
      const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
      return await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      return null;
    }
  })();
  _sharedKeyCache.set(peerPublicB64, p);
  return p;
}

/** Test hook — clear derived-key cache (peers rotate between tests). */
export function _resetSharedKeysForTests(): void {
  _sharedKeyCache.clear();
}

// ── envelope ─────────────────────────────────────────────────────────────────

export function isEnvelope(text: string): boolean {
  return text.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt plaintext for the peer. Null when E2EE is unavailable. */
export async function sealDm(peerPublicB64: string, plaintext: string): Promise<string | null> {
  const key = await sharedKeyWith(peerPublicB64);
  if (!key) return null;
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      new TextEncoder().encode(plaintext),
    );
    const body = new Uint8Array(NONCE_BYTES + ct.byteLength);
    body.set(nonce, 0);
    body.set(new Uint8Array(ct), NONCE_BYTES);
    return `${ENVELOPE_PREFIX}${toB64url(body)}`;
  } catch {
    return null;
  }
}

/** Decrypt an envelope from the peer. Null when it isn't ours to open. */
export async function openDm(peerPublicB64: string, envelope: string): Promise<string | null> {
  if (!isEnvelope(envelope)) return null;
  const key = await sharedKeyWith(peerPublicB64);
  if (!key) return null;
  const body = fromB64url(envelope.slice(ENVELOPE_PREFIX.length));
  // A real body is nonce(12) ‖ ciphertext ‖ tag(16); anything below 28 bytes
  // cannot even carry an empty-plaintext GCM tag, so reject it fast fail-closed.
  if (!body || body.length < MIN_BODY_BYTES) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: body.slice(0, NONCE_BYTES) },
      key,
      body.slice(NONCE_BYTES),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null; // wrong device / rotated key — caller shows the placeholder
  }
}
