'use client';

/*
 * TsumugiSession.ts — Browser-side TSUMUGI encrypted media session.
 *
 * Implements the TSUMUGI_HANDSHAKE / TSUMUGI_RATCHET / TSUMUGI_DATA protocol
 * using Web Crypto (P-256 ECDH + HKDF + AES-256-GCM).
 *
 * Usage:
 *   const v = await TsumugiSession.create();
 *   const offer = v.exportPublicKey();  // send to peer via TSUMUGI_HANDSHAKE
 *   await v.ingestPeerKey(peerPublicKeyBytes); // on receiving TSUMUGI_HANDSHAKE
 *   const ct = await v.encrypt(plaintext);
 *   const pt = await v.decrypt(ct);
 */

const CURVE    = 'P-256' as const;
const GCM_ALG  = 'AES-GCM';
const GCM_LEN  = 256;
const GCM_TAG  = 128;
const HKDF_ALG = 'HKDF';
const IV_LEN   = 12;
const IV_PREFIX_LEN = 8;

type AesGcmKey = CryptoKey & { _gcm: true };
type Direction = 'low-to-high' | 'high-to-low';

export class TsumugiSession {
  private readonly keyPair: CryptoKeyPair;
  private sendKey: AesGcmKey | null = null;
  private receiveKey: AesGcmKey | null = null;
  private readonly sendIvPrefix = crypto.getRandomValues(new Uint8Array(IV_PREFIX_LEN));
  private sendIvCounter = 0;
  private readonly seenReceiveIvs = new Set<string>();
  private ratchetEpoch = 0;
  private destroyed = false;

  private constructor(kp: CryptoKeyPair) {
    this.keyPair = kp;
  }

  static async create(): Promise<TsumugiSession> {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: CURVE },
      true,
      ['deriveKey', 'deriveBits'],
    );
    return new TsumugiSession(kp);
  }

  static fromKeyPair(kp: CryptoKeyPair): TsumugiSession {
    return new TsumugiSession(kp);
  }

  /** Return raw uncompressed public key bytes (65 bytes, 0x04 prefix). */
  async exportPublicKey(): Promise<Uint8Array> {
    this.assertLive();
    const raw = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    return new Uint8Array(raw);
  }

  /**
   * Ingest peer's raw public key (from TSUMUGI_HANDSHAKE frame) and derive
   * the shared AES-256-GCM session key via ECDH + HKDF.
   */
  async ingestPeerKey(peerRawKey: Uint8Array, info = 'tsumugi-v1'): Promise<void> {
    this.assertLive();
    const peerBytes = copyPublicKey(peerRawKey);
    const localBytes = await this.exportPublicKey();
    if (constantTimeEqual(peerBytes, localBytes)) {
      throw new Error('TsumugiSession: refusing self public key');
    }

    const peerKey = await crypto.subtle.importKey(
      'raw', toArrayBuffer(peerBytes),
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

    const localDirection: Direction = compareBytes(localBytes, peerBytes) < 0
      ? 'low-to-high'
      : 'high-to-low';
    const peerDirection: Direction = localDirection === 'low-to-high'
      ? 'high-to-low'
      : 'low-to-high';
    const salt = await transcriptSalt(info, localBytes, peerBytes);

    this.sendKey = await deriveGcmKey(hkdfKey, salt, `${info}:media:${localDirection}`);
    this.receiveKey = await deriveGcmKey(hkdfKey, salt, `${info}:media:${peerDirection}`);
    this.ratchetEpoch = 0;
    this.seenReceiveIvs.clear();
  }

  /**
   * Ratchet the session key forward (called on TSUMUGI_RATCHET frame).
   * Derives a new key by HKDF-expanding the current key with the new epoch.
   */
  async ratchet(): Promise<void> {
    this.assertLive();
    if (!this.sendKey || !this.receiveKey) throw new Error('TsumugiSession: not yet established');
    const nextEpoch = this.ratchetEpoch + 1;
    const sendKeyBytes = await crypto.subtle.exportKey('raw', this.sendKey)
      .catch(() => { throw new Error('TsumugiSession: ratchet requires extractable key'); });
    const receiveKeyBytes = await crypto.subtle.exportKey('raw', this.receiveKey)
      .catch(() => { throw new Error('TsumugiSession: ratchet requires extractable key'); });

    try {
      const [sendKey, receiveKey] = await Promise.all([
        ratchetKey(sendKeyBytes, nextEpoch),
        ratchetKey(receiveKeyBytes, nextEpoch),
      ]);
      this.sendKey = sendKey;
      this.receiveKey = receiveKey;
      this.ratchetEpoch = nextEpoch;
      this.seenReceiveIvs.clear();
    } finally {
      new Uint8Array(sendKeyBytes).fill(0);
      new Uint8Array(receiveKeyBytes).fill(0);
    }
  }

  /** Clear derived session material and reject future use of this object. */
  destroy(): void {
    this.sendKey = null;
    this.receiveKey = null;
    this.seenReceiveIvs.clear();
    this.ratchetEpoch = 0;
    this.destroyed = true;
  }

  private nextIv(): Uint8Array {
    if (this.sendIvCounter > 0xffffffff) {
      throw new Error('TsumugiSession: AES-GCM nonce space exhausted');
    }
    const iv = new Uint8Array(IV_LEN);
    iv.set(this.sendIvPrefix, 0);
    new DataView(iv.buffer).setUint32(IV_PREFIX_LEN, this.sendIvCounter++, false);
    return iv;
  }

  private assertLive(): void {
    if (this.destroyed) throw new Error('TsumugiSession: destroyed');
  }

  private rememberReceiveIv(iv: Uint8Array): void {
    const key = ivKey(iv);
    if (this.seenReceiveIvs.has(key)) throw new Error('TsumugiSession: replayed frame');
    this.seenReceiveIvs.add(key);
  }

  private hasSeenReceiveIv(iv: Uint8Array): boolean {
    return this.seenReceiveIvs.has(ivKey(iv));
  }

  private get encryptKey(): AesGcmKey {
    this.assertLive();
    if (!this.sendKey) throw new Error('TsumugiSession: not yet established');
    return this.sendKey;
  }

  private get decryptKey(): AesGcmKey {
    this.assertLive();
    if (!this.receiveKey) throw new Error('TsumugiSession: not yet established');
    return this.receiveKey;
  }

  /** Encrypt plaintext with current session key. Returns iv || ciphertext. */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const key = this.encryptKey;
    const iv = this.nextIv();
    const ct = await crypto.subtle.encrypt(
      { name: GCM_ALG, iv: toArrayBuffer(iv), tagLength: GCM_TAG },
      key,
      toArrayBuffer(plaintext),
    );
    const out = new Uint8Array(IV_LEN + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), IV_LEN);
    return out;
  }

  /** Decrypt iv || ciphertext with current session key. */
  async decrypt(frame: Uint8Array): Promise<Uint8Array> {
    const key = this.decryptKey;
    if (frame.length < IV_LEN + 16) throw new Error('TsumugiSession: frame too short');
    const iv = frame.slice(0, IV_LEN);
    if (this.hasSeenReceiveIv(iv)) throw new Error('TsumugiSession: replayed frame');
    const ct = frame.slice(IV_LEN);
    const pt = await crypto.subtle.decrypt(
      { name: GCM_ALG, iv: toArrayBuffer(iv), tagLength: GCM_TAG },
      key,
      toArrayBuffer(ct),
    );
    this.rememberReceiveIv(iv);
    return new Uint8Array(pt);
  }

  get established(): boolean { return this.sendKey !== null && this.receiveKey !== null; }
  get epoch():       number  { return this.ratchetEpoch; }

  /**
   * Get a human-readable fingerprint of the local public key for out-of-band verification.
   * Returns 12 Base58 characters derived from SHA-256 of the raw public key.
   */
  async getFingerprint(): Promise<string> {
    this.assertLive();
    const raw   = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    const hash  = await crypto.subtle.digest('SHA-256', raw);
    return tsumugiBase58(new Uint8Array(hash)).slice(0, 12).padStart(12, '1');
  }
}

async function deriveGcmKey(
  hkdfKey: CryptoKey,
  salt: Uint8Array,
  info: string,
): Promise<AesGcmKey> {
  /* extractable: true so ratchet() can re-derive a new generation key */
  const gcmKey = await crypto.subtle.deriveKey(
    {
      name: HKDF_ALG,
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: new TextEncoder().encode(info),
    },
    hkdfKey,
    { name: GCM_ALG, length: GCM_LEN },
    true,
    ['encrypt', 'decrypt'],
  );
  return gcmKey as AesGcmKey;
}

async function ratchetKey(rawKey: ArrayBuffer, epoch: number): Promise<AesGcmKey> {
  const hkdfKey = await crypto.subtle.importKey(
    'raw', rawKey, HKDF_ALG, false, ['deriveKey'],
  );
  /* extractable: true so subsequent ratchets can continue the chain */
  const newKey = await crypto.subtle.deriveKey(
    {
      name: HKDF_ALG,
      hash: 'SHA-256',
      salt:  new Uint8Array(32),
      info:  new TextEncoder().encode(`tsumugi-ratchet-${epoch}`),
    },
    hkdfKey,
    { name: GCM_ALG, length: GCM_LEN },
    true,
    ['encrypt', 'decrypt'],
  );
  return newKey as AesGcmKey;
}

function copyPublicKey(peerRawKey: Uint8Array): Uint8Array {
  const peerBytes = new Uint8Array(peerRawKey);
  if (peerBytes.length !== 65 || peerBytes[0] !== 0x04) {
    throw new Error('TsumugiSession: invalid P-256 public key');
  }
  return peerBytes;
}

async function transcriptSalt(
  info: string,
  a: Uint8Array,
  b: Uint8Array,
): Promise<Uint8Array> {
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const label = new TextEncoder().encode(`${info}:handshake`);
  const transcript = new Uint8Array(label.length + first.length + second.length);
  transcript.set(label, 0);
  transcript.set(first, label.length);
  transcript.set(second, label.length + first.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(transcript)));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function ivKey(iv: Uint8Array): string {
  let out = '';
  for (let i = 0; i < IV_LEN; i++) out += iv[i]!.toString(16).padStart(2, '0');
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Base58 encode bytes without BigInt (compatible with ES2017 target). */
function tsumugiBase58(bytes: Uint8Array): string {
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
