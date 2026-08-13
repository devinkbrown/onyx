// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dmCipher.ts — end-to-end encryption for DMs (Roadmap Phase 3.6).
 *
 * No new cryptography: the same Web Crypto primitives the Cadence media
 * engine already ships (P-256 ECDH + HKDF-SHA-256 + AES-GCM), arranged
 * static-static so BOTH directions and replayed history derive the same key:
 *
 *   shared  = ECDH(my_device_secret, peer_device_public)
 *   aes_key = HKDF(shared, salt="onyx-dm-v1", info=sorted(pubA ‖ pubB))
 *   wire    = "ONYXDM1 " ‖ b64url(nonce12 ‖ ciphertext‖tag)
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

/** On-wire E2EE DM envelope prefix (single peer device). */
export const ENVELOPE_PREFIX = 'ONYXDM1 ';

/**
 * Multi-device fan-out envelope (Era 3 C2).
 * Wire: `ONYXDMN1 ` ‖ b64url(u16be count ‖ for each: u16be len ‖ seal-body)
 * where each seal-body is the same nonce12‖ct layout as a single ONYXDM1 body.
 * Recipient opens by trying each seal under the sender's public key until one
 * authenticates — only the seal for *this* device's private key will succeed.
 */
export const MULTI_ENVELOPE_PREFIX = 'ONYXDMN1 ';

/** Hard cap on fan-out targets so a hostile directory cannot force unbounded work. */
export const MAX_MULTI_DEVICE_SEALS = 16;

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

type StoredDeviceRead =
  | { kind: 'absent' }
  | { kind: 'pair'; keyPair: CryptoKeyPair }
  | { kind: 'invalid' };

function exactUsageSet(actualUsages: readonly KeyUsage[], expected: readonly KeyUsage[]): boolean {
  if (actualUsages.length !== expected.length) return false;
  const actual = new Set(actualUsages);
  return actual.size === expected.length && expected.every((usage) => actual.has(usage));
}

function validPrivateDeviceUsages(usages: readonly KeyUsage[]): boolean {
  return exactUsageSet(usages, ['deriveBits'])
    || exactUsageSet(usages, ['deriveKey', 'deriveBits']);
}

/** Test hook for the exact legacy/new durable-key capability policy. */
export function _isValidDevicePrivateUsagesForTests(usages: readonly KeyUsage[]): boolean {
  return validPrivateDeviceUsages(usages);
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  if (a.byteLength !== b.byteLength) return false;
  let different = 0;
  for (let i = 0; i < a.byteLength; i += 1) different |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return different === 0;
}

/**
 * IndexedDB rows are untrusted structured-clone input. Validate both key
 * capabilities and pair correspondence before the durable identity may be
 * projected or used. A corrupt row is never treated as absence: callers must
 * fail closed instead of silently rotating the device identity.
 */
async function validateStoredDevicePair(value: unknown): Promise<CryptoKeyPair | null> {
  if (!value || typeof value !== 'object' || typeof CryptoKey === 'undefined') return null;
  const candidate = value as Partial<CryptoKeyPair>;
  const privateKey = candidate.privateKey;
  const publicKey = candidate.publicKey;
  if (!(privateKey instanceof CryptoKey) || !(publicKey instanceof CryptoKey)) return null;
  if (privateKey.type !== 'private' || publicKey.type !== 'public' || privateKey.extractable) return null;
  const privateAlgorithm = privateKey.algorithm as EcKeyAlgorithm;
  const publicAlgorithm = publicKey.algorithm as EcKeyAlgorithm;
  const validPrivateUsages = validPrivateDeviceUsages(privateKey.usages);
  if (
    privateAlgorithm.name !== 'ECDH'
    || publicAlgorithm.name !== 'ECDH'
    || privateAlgorithm.namedCurve !== CURVE
    || publicAlgorithm.namedCurve !== CURVE
    || !validPrivateUsages
    || !exactUsageSet(publicKey.usages, [])
  ) return null;
  try {
    const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
    if (!isValidPeerPublicKey(toB64url(rawPublic))) return null;
    const witness = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: CURVE },
      false,
      ['deriveBits'],
    ) as CryptoKeyPair;
    const [fromStoredPrivate, fromWitnessPrivate] = await Promise.all([
      crypto.subtle.deriveBits({ name: 'ECDH', public: witness.publicKey }, privateKey, 256),
      crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, witness.privateKey, 256),
    ]);
    return equalBytes(fromStoredPrivate, fromWitnessPrivate) ? { privateKey, publicKey } : null;
  } catch {
    return null;
  }
}

function readStoredDevicePair(): Promise<StoredDeviceRead> {
  return new Promise((resolve) => {
    void openKeysDb().then((db) => {
      if (!db) { resolve({ kind: 'invalid' }); return; }
      try {
        const tx = db.transaction(STORE, 'readonly');
        const get = tx.objectStore(STORE).get(KEY_ID);
        tx.oncomplete = () => {
          const value = get.result;
          db.close();
          if (value === undefined) { resolve({ kind: 'absent' }); return; }
          void validateStoredDevicePair(value).then(
            (keyPair) => resolve(keyPair ? { kind: 'pair', keyPair } : { kind: 'invalid' }),
            () => resolve({ kind: 'invalid' }),
          );
        };
        tx.onerror = tx.onabort = () => { db.close(); resolve({ kind: 'invalid' }); };
      } catch {
        db.close();
        resolve({ kind: 'invalid' });
      }
    }).catch(() => resolve({ kind: 'invalid' }));
  });
}

function persistDevicePair(keyPair: CryptoKeyPair): Promise<boolean> {
  return new Promise((resolve) => {
    void openKeysDb().then((db) => {
      if (!db) { resolve(false); return; }
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(ok);
      };
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(keyPair, KEY_ID);
        tx.oncomplete = () => finish(true);
        tx.onerror = tx.onabort = () => finish(false);
      } catch {
        finish(false);
      }
    }).catch(() => resolve(false));
  });
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
      const existing = await readStoredDevicePair();
      if (existing.kind === 'pair') {
        return { keyPair: existing.keyPair, publicB64: await exportPublicB64(existing.keyPair) };
      }
      if (existing.kind === 'invalid') return null;

      const kp = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: CURVE },
        false, // private key never leaves WebCrypto
        ['deriveBits'],
      ) as CryptoKeyPair;
      // Fail closed if the identity key cannot be durable: an ephemeral-only
      // device key would mint a new public point after reload and silently
      // orphan every prior envelope sealed under the discarded identity.
      const persisted = await persistDevicePair(kp);
      if (!persisted) return null;
      // Read and validate the structured-cloned row before exposing it. The
      // generated in-memory pair is not publication authority by itself.
      const durable = await readStoredDevicePair();
      if (durable.kind !== 'pair') return null;
      return { keyPair: durable.keyPair, publicB64: await exportPublicB64(durable.keyPair) };
    } catch {
      return null;
    }
  })();
  // Do not permanently cache a hard failure — a transient IDB abort should not
  // freeze the tab into "no E2EE" for the rest of the session after recovery.
  // Identity-check the promise so a later successful retry is not wiped by a
  // stale failure settling after a fresh attempt already started.
  const pending = _devicePromise;
  void pending.then((keys) => {
    if (keys === null && _devicePromise === pending) _devicePromise = null;
  });
  return pending;
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

/**
 * Derived AES keys are cheap to reproduce but sensitive to retain indefinitely.
 * Keep a modest working set for active conversations instead of allowing every
 * peer key observed during a long-lived tab to remain resident forever.
 */
const SHARED_KEY_CACHE_CAP = 64;
const _sharedKeyCache = new Map<string, Promise<CryptoKey | null>>();

function rememberSharedKey(peerPublicB64: string, key: Promise<CryptoKey | null>): void {
  _sharedKeyCache.delete(peerPublicB64);
  _sharedKeyCache.set(peerPublicB64, key);
  while (_sharedKeyCache.size > SHARED_KEY_CACHE_CAP) {
    const oldest = _sharedKeyCache.keys().next().value;
    if (oldest === undefined) break;
    _sharedKeyCache.delete(oldest);
  }
}

/**
 * The AES-GCM key shared with a peer's published device key. Symmetric in
 * both directions: the HKDF info concatenates the two public keys sorted, so
 * sender and recipient (and either one replaying history) derive identically.
 */
export function sharedKeyWith(peerPublicB64: string): Promise<CryptoKey | null> {
  const cached = _sharedKeyCache.get(peerPublicB64);
  if (cached) {
    rememberSharedKey(peerPublicB64, cached);
    return cached;
  }
  // Reject malformed advertisements before they can occupy cache space. Curve
  // membership is still verified by WebCrypto's importKey below.
  if (!isValidPeerPublicKey(peerPublicB64)) return Promise.resolve(null);

  const p = (async (): Promise<CryptoKey | null> => {
    try {
      const mine = await deviceKeys();
      if (!mine) return null;
      const peerRaw = fromB64url(peerPublicB64);
      if (!peerRaw) return null;
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
  rememberSharedKey(peerPublicB64, p);
  // Do not retain failed imports/derivations or a transient device-key failure
  // for the lifetime of the page. The identity check avoids deleting a newer
  // derivation if this promise was evicted and the same peer was requested again.
  void p.then((key) => {
    if (key === null && _sharedKeyCache.get(peerPublicB64) === p) {
      _sharedKeyCache.delete(peerPublicB64);
    }
  });
  return p;
}

/** Test hook — clear derived-key cache (peers rotate between tests). */
export function _resetSharedKeysForTests(): void {
  _sharedKeyCache.clear();
}

/** Test hook — inspect the cache bound without exposing any key material. */
export function _sharedKeyCacheSizeForTests(): number {
  return _sharedKeyCache.size;
}

// ── envelope ─────────────────────────────────────────────────────────────────

export function isEnvelope(text: string): boolean {
  return text.startsWith(ENVELOPE_PREFIX) || text.startsWith(MULTI_ENVELOPE_PREFIX);
}

export function isMultiEnvelope(text: string): boolean {
  return text.startsWith(MULTI_ENVELOPE_PREFIX);
}

/** Body offset after a recognized envelope prefix, or -1. */
export function envelopeBodyOffset(text: string): number {
  if (text.startsWith(MULTI_ENVELOPE_PREFIX)) return MULTI_ENVELOPE_PREFIX.length;
  if (text.startsWith(ENVELOPE_PREFIX)) return ENVELOPE_PREFIX.length;
  return -1;
}

/** Deduplicate + structurally validate peer device public keys for fan-out. */
export function normalizePeerDeviceKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    const key = raw.trim();
    if (!key || seen.has(key) || !isValidPeerPublicKey(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_MULTI_DEVICE_SEALS) break;
  }
  return out;
}

function encodeMultiSealBodies(bodies: readonly Uint8Array[]): Uint8Array | null {
  if (bodies.length === 0 || bodies.length > MAX_MULTI_DEVICE_SEALS) return null;
  let total = 2;
  for (const body of bodies) {
    if (body.length < MIN_BODY_BYTES || body.length > 0xffff) return null;
    total += 2 + body.length;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, bodies.length, false);
  let offset = 2;
  for (const body of bodies) {
    view.setUint16(offset, body.length, false);
    offset += 2;
    out.set(body, offset);
    offset += body.length;
  }
  return out;
}

function decodeMultiSealBodies(packed: Uint8Array): Uint8Array[] | null {
  if (packed.length < 2) return null;
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const count = view.getUint16(0, false);
  if (count === 0 || count > MAX_MULTI_DEVICE_SEALS) return null;
  const bodies: Uint8Array[] = [];
  let offset = 2;
  for (let i = 0; i < count; i += 1) {
    if (offset + 2 > packed.length) return null;
    const len = view.getUint16(offset, false);
    offset += 2;
    if (len < MIN_BODY_BYTES || offset + len > packed.length) return null;
    bodies.push(packed.slice(offset, offset + len));
    offset += len;
  }
  // Reject trailing garbage so a smuggled payload cannot hide after valid seals.
  if (offset !== packed.length) return null;
  return bodies;
}

/** Encrypt one seal body (nonce‖ct) for a peer device. Null on failure. */
async function sealBodyFor(peerPublicB64: string, plaintext: string): Promise<Uint8Array | null> {
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
    return body;
  } catch {
    return null;
  }
}

async function openBodyFrom(
  peerPublicB64: string,
  body: Uint8Array,
): Promise<string | null> {
  if (body.length < MIN_BODY_BYTES) return null;
  const key = await sharedKeyWith(peerPublicB64);
  if (!key) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: body.slice(0, NONCE_BYTES) },
      key,
      body.slice(NONCE_BYTES),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Encrypt plaintext for the peer. Null when E2EE is unavailable. */
export async function sealDm(peerPublicB64: string, plaintext: string): Promise<string | null> {
  const body = await sealBodyFor(peerPublicB64, plaintext);
  if (!body) return null;
  return `${ENVELOPE_PREFIX}${toB64url(body)}`;
}

/**
 * Seal plaintext to every published device key for a peer (C2 multi-device).
 * One device → classic ONYXDM1 envelope (backward compatible).
 * Two+ devices → ONYXDMN1 multi envelope. Fail closed if any seal fails.
 */
export async function sealDmToDevices(
  peerPublicKeys: readonly string[],
  plaintext: string,
): Promise<string | null> {
  const keys = normalizePeerDeviceKeys(peerPublicKeys);
  if (keys.length === 0) return null;
  if (keys.length === 1) return sealDm(keys[0]!, plaintext);

  const bodies: Uint8Array[] = [];
  for (const key of keys) {
    const body = await sealBodyFor(key, plaintext);
    if (!body) return null;
    bodies.push(body);
  }
  const packed = encodeMultiSealBodies(bodies);
  if (!packed) return null;
  return `${MULTI_ENVELOPE_PREFIX}${toB64url(packed)}`;
}

/** Decrypt an envelope from the peer. Null when it isn't ours to open. */
export async function openDm(peerPublicB64: string, envelope: string): Promise<string | null> {
  if (isMultiEnvelope(envelope)) {
    const packed = fromB64url(envelope.slice(MULTI_ENVELOPE_PREFIX.length));
    if (!packed) return null;
    const bodies = decodeMultiSealBodies(packed);
    if (!bodies) return null;
    for (const body of bodies) {
      const pt = await openBodyFrom(peerPublicB64, body);
      if (pt !== null) return pt;
    }
    return null;
  }
  const prefixLen = envelopeBodyOffset(envelope);
  if (prefixLen < 0) return null;
  const body = fromB64url(envelope.slice(prefixLen));
  if (!body) return null;
  return openBodyFrom(peerPublicB64, body);
}
