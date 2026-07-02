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

export const ENVELOPE_PREFIX = 'TSUMUGI1 ';
/** Rendered in place of ciphertext we cannot open (wrong device, lost key). */
export const LOCKED_PLACEHOLDER = '🔒 Encrypted message (sent to another device)';

const CURVE = 'P-256';
const HKDF_SALT = new TextEncoder().encode('onyx-dm-v1');

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
      if (!peerRaw || peerRaw.length !== 65 || peerRaw[0] !== 0x04) return null;
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
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      new TextEncoder().encode(plaintext),
    );
    const body = new Uint8Array(12 + ct.byteLength);
    body.set(nonce, 0);
    body.set(new Uint8Array(ct), 12);
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
  if (!body || body.length < 13) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: body.slice(0, 12) },
      key,
      body.slice(12),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null; // wrong device / rotated key — caller shows the placeholder
  }
}
