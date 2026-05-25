'use client';

/*
 * VeilSession.ts — Browser-side VEIL encrypted media session.
 *
 * Implements the VEIL_HANDSHAKE / VEIL_RATCHET / VEIL_DATA protocol
 * using Web Crypto (P-256 ECDH + HKDF + AES-256-GCM).
 *
 * Usage:
 *   const v = await VeilSession.create();
 *   const offer = v.exportPublicKey();  // send to peer via VEIL_HANDSHAKE
 *   await v.ingestPeerKey(peerPublicKeyBytes); // on receiving VEIL_HANDSHAKE
 *   const ct = await v.encrypt(plaintext);
 *   const pt = await v.decrypt(ct);
 */

const CURVE    = 'P-256' as const;
const GCM_ALG  = 'AES-GCM';
const GCM_LEN  = 256;
const HKDF_ALG = 'HKDF';
const IV_LEN   = 12;

type AesGcmKey = CryptoKey & { _gcm: true };

export class VeilSession {
  private readonly keyPair: CryptoKeyPair;
  private sessionKey: AesGcmKey | null = null;
  private ratchetEpoch = 0;

  private constructor(kp: CryptoKeyPair) {
    this.keyPair = kp;
  }

  static async create(): Promise<VeilSession> {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: CURVE },
      true,
      ['deriveKey', 'deriveBits'],
    );
    return new VeilSession(kp);
  }

  /** Return raw uncompressed public key bytes (65 bytes, 0x04 prefix). */
  async exportPublicKey(): Promise<Uint8Array> {
    const raw = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    return new Uint8Array(raw);
  }

  /**
   * Ingest peer's raw public key (from VEIL_HANDSHAKE frame) and derive
   * the shared AES-256-GCM session key via ECDH + HKDF.
   */
  async ingestPeerKey(peerRawKey: Uint8Array, info = 'veil-v1'): Promise<void> {
    const peerKey = await crypto.subtle.importKey(
      'raw', new Uint8Array(peerRawKey).buffer as ArrayBuffer,
      { name: 'ECDH', namedCurve: CURVE },
      false,
      [],
    );
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerKey },
      this.keyPair.privateKey,
      256,
    );
    const hkdfKey = await crypto.subtle.importKey(
      'raw', sharedBits, HKDF_ALG, false, ['deriveKey'],
    );
    /* extractable: true so ratchet() can re-derive a new generation key */
    const gcmKey = await crypto.subtle.deriveKey(
      {
        name: HKDF_ALG,
        hash: 'SHA-256',
        salt:  new Uint8Array(32),
        info:  new TextEncoder().encode(info),
      },
      hkdfKey,
      { name: GCM_ALG, length: GCM_LEN },
      true,
      ['encrypt', 'decrypt'],
    );
    this.sessionKey = gcmKey as AesGcmKey;
    this.ratchetEpoch = 0;
  }

  /**
   * Ratchet the session key forward (called on VEIL_RATCHET frame).
   * Derives a new key by HKDF-expanding the current key with the new epoch.
   */
  async ratchet(): Promise<void> {
    if (!this.sessionKey) throw new Error('VeilSession: not yet established');
    this.ratchetEpoch++;
    const exportable = await crypto.subtle.exportKey('raw', this.sessionKey)
      .catch(() => { throw new Error('VeilSession: ratchet requires extractable key'); });
    const hkdfKey = await crypto.subtle.importKey(
      'raw', exportable, HKDF_ALG, false, ['deriveKey'],
    );
    /* extractable: true so subsequent ratchets can continue the chain */
    const newKey = await crypto.subtle.deriveKey(
      {
        name: HKDF_ALG,
        hash: 'SHA-256',
        salt:  new Uint8Array(32),
        info:  new TextEncoder().encode(`veil-ratchet-${this.ratchetEpoch}`),
      },
      hkdfKey,
      { name: GCM_ALG, length: GCM_LEN },
      true,
      ['encrypt', 'decrypt'],
    );
    this.sessionKey = newKey as AesGcmKey;
  }

  /** Encrypt plaintext with current session key. Returns iv || ciphertext. */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.sessionKey) throw new Error('VeilSession: not yet established');
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ct = await crypto.subtle.encrypt(
      { name: GCM_ALG, iv },
      this.sessionKey,
      new Uint8Array(plaintext).buffer as ArrayBuffer,
    );
    const out = new Uint8Array(IV_LEN + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), IV_LEN);
    return out;
  }

  /** Decrypt iv || ciphertext with current session key. */
  async decrypt(frame: Uint8Array): Promise<Uint8Array> {
    if (!this.sessionKey) throw new Error('VeilSession: not yet established');
    if (frame.length < IV_LEN + 16) throw new Error('VeilSession: frame too short');
    const iv = frame.slice(0, IV_LEN);
    const ct = frame.slice(IV_LEN);
    const pt = await crypto.subtle.decrypt({ name: GCM_ALG, iv }, this.sessionKey,
                                           new Uint8Array(ct).buffer as ArrayBuffer);
    return new Uint8Array(pt);
  }

  get established(): boolean { return this.sessionKey !== null; }
  get epoch():       number  { return this.ratchetEpoch; }

  /**
   * Get a human-readable fingerprint of the local public key for out-of-band verification.
   * Returns 12 Base58 characters derived from SHA-256 of the raw public key.
   */
  async getFingerprint(): Promise<string> {
    const raw   = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    const hash  = await crypto.subtle.digest('SHA-256', raw);
    return veilBase58(new Uint8Array(hash)).slice(0, 12).padStart(12, '1');
  }
}

/** Base58 encode bytes without BigInt (compatible with ES2017 target). */
function veilBase58(bytes: Uint8Array): string {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return digits.reverse().map(d => B58[d]).join('');
}
