'use client';

/*
 * TsumugiIdentity.ts — Persistent P-256 identity key via IndexedDB.
 *
 * Provides a stable ECDH key pair across browser sessions for TOFU
 * (trust-on-first-use) peer verification.
 *
 * Usage:
 *   const id = await TsumugiIdentity.load();
 *   const pub = await id.exportPublicKey();   // send in TSUMUGI_HANDSHAKE
 */

const DB_NAME    = 'nexus-tsumugi';
const DB_VERSION = 1;
const STORE_NAME = 'identity';
const KEY_ID     = 'suimyaku-identity-v1';
const CURVE      = 'P-256';

export class TsumugiIdentity {
  private constructor(private readonly kp: CryptoKeyPair) {}

  /**
   * Load the persisted identity key from IndexedDB, or generate and save a new one.
   * Falls back gracefully if IndexedDB is unavailable (private browsing).
   */
  static async load(): Promise<TsumugiIdentity> {
    try {
      const stored = await TsumugiIdentity.dbGet();
      if (stored) return new TsumugiIdentity(stored);
    } catch { /* IndexedDB unavailable */ }

    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: CURVE },
      true,
      ['deriveKey', 'deriveBits'],
    );
    try { await TsumugiIdentity.dbPut(kp); } catch { /* non-fatal */ }
    return new TsumugiIdentity(kp);
  }

  /** Export raw uncompressed public key (65 bytes, 0x04 prefix). */
  async exportPublicKey(): Promise<Uint8Array> {
    const raw = await crypto.subtle.exportKey('raw', this.kp.publicKey);
    return new Uint8Array(raw);
  }

  /** Return the underlying key pair for use in TsumugiSession ECDH. */
  get keyPair(): CryptoKeyPair { return this.kp; }

  /**
   * Fingerprint for TOFU display: SHA-256(pubkey) → 12-char Base58.
   * Identical format to TsumugiSession.getFingerprint().
   */
  async getFingerprint(): Promise<string> {
    const raw   = await this.exportPublicKey();
    const hash  = await crypto.subtle.digest('SHA-256', raw.buffer as ArrayBuffer);
    return tsumugiIdentityBase58(new Uint8Array(hash)).slice(0, 12).padStart(12, '1');
  }

  /** Delete the persisted identity key (forces regeneration on next load). */
  static async clear(): Promise<void> {
    try {
      const db = await TsumugiIdentity.openDb();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(KEY_ID);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
      });
    } catch { /* non-fatal */ }
  }

  // -------------------------------------------------------------------
  // IndexedDB helpers
  // -------------------------------------------------------------------

  private static openDb(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME))
          db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = e => res((e.target as IDBOpenDBRequest).result);
      req.onerror   = e => rej((e.target as IDBOpenDBRequest).error);
    });
  }

  private static async dbGet(): Promise<CryptoKeyPair | null> {
    const db = await TsumugiIdentity.openDb();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_ID);
      req.onsuccess = () => res(req.result as CryptoKeyPair | null ?? null);
      req.onerror   = () => rej(req.error);
    });
  }

  private static async dbPut(kp: CryptoKeyPair): Promise<void> {
    const db = await TsumugiIdentity.openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(kp, KEY_ID);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }
}

/** Base58 encode bytes without BigInt (ES2017 compatible). */
function tsumugiIdentityBase58(bytes: Uint8Array): string {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return digits.reverse().map(d => B58[d]).join('');
}
