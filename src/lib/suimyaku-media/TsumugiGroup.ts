'use client';

/*
 * TsumugiGroup.ts — Multi-party TSUMUGI group key for encrypted channel media.
 *
 * The channel creator generates a 256-bit AES-GCM group key, encrypts it
 * pairwise for each participant using their TsumugiSession, and distributes it.
 * All subsequent TSUMUGI_DATA frames use the single group key instead of
 * per-peer keys, reducing the number of crypto operations by O(N).
 *
 * Usage:
 *   // Creator side:
 *   const group = await TsumugiGroup.create();
 *   for (const [nick, session] of sessions) {
 *     const wrapped = await group.exportKeyFor(session);
 *     sendTsumugiGroupKey(nick, wrapped);
 *   }
 *
 *   // Recipient side:
 *   const group = await TsumugiGroup.importKey(wrapped, mySession);
 *   const ct = await group.encrypt(plaintext);
 *   const pt = await group.decrypt(ct);
 */

const GCM_ALG = 'AES-GCM';
const GCM_LEN = 256;
const GCM_TAG = 128;
const IV_LEN  = 12;
const IV_PREFIX_LEN = 8;

export class TsumugiGroup {
  private groupKey: CryptoKey | null;
  private readonly sendIvPrefix = crypto.getRandomValues(new Uint8Array(IV_PREFIX_LEN));
  private sendIvCounter = 0;
  private readonly seenReceiveIvs = new Set<string>();
  private destroyed = false;

  private constructor(groupKey: CryptoKey) {
    this.groupKey = groupKey;
  }

  /** Create a new group session (creator). */
  static async create(): Promise<TsumugiGroup> {
    const key = await crypto.subtle.generateKey(
      { name: GCM_ALG, length: GCM_LEN },
      true,
      ['encrypt', 'decrypt'],
    );
    return new TsumugiGroup(key);
  }

  /**
   * Wrap the group key for a specific peer using their TsumugiSession.
   * Returns iv || encrypted_group_key_material for transmission.
   */
  async exportKeyFor(session: { encrypt: (pt: Uint8Array) => Promise<Uint8Array> }): Promise<Uint8Array> {
    const key = this.requireKey();
    const raw = await crypto.subtle.exportKey('raw', key);
    const rawBytes = new Uint8Array(raw);
    try {
      return await session.encrypt(rawBytes);
    } finally {
      rawBytes.fill(0);
    }
  }

  /**
   * Import a group key from wrapped bytes received over the channel.
   * Decrypts the wrapped key using the recipient's TsumugiSession.
   */
  static async importKey(
    wrapped: Uint8Array,
    session: { decrypt: (ct: Uint8Array) => Promise<Uint8Array> },
  ): Promise<TsumugiGroup> {
    const raw = await session.decrypt(wrapped);
    try {
      if (raw.byteLength !== GCM_LEN / 8) throw new Error('TsumugiGroup: invalid key length');
      const keyBytes = new Uint8Array(raw);
      try {
        const key = await crypto.subtle.importKey(
          'raw', toArrayBuffer(keyBytes),
          { name: GCM_ALG, length: GCM_LEN },
          false,
          ['encrypt', 'decrypt'],
        );
        return new TsumugiGroup(key);
      } finally {
        keyBytes.fill(0);
      }
    } finally {
      raw.fill(0);
    }
  }

  /** Encrypt a plaintext frame. Returns iv || ciphertext. */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const key = this.requireKey();
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

  /** Decrypt iv || ciphertext with the group key. */
  async decrypt(frame: Uint8Array): Promise<Uint8Array> {
    const key = this.requireKey();
    if (frame.length < IV_LEN + 16) throw new Error('TsumugiGroup: frame too short');
    const iv = frame.slice(0, IV_LEN);
    if (this.seenReceiveIvs.has(ivKey(iv))) throw new Error('TsumugiGroup: replayed frame');
    const ct = frame.slice(IV_LEN);
    const pt = await crypto.subtle.decrypt(
      { name: GCM_ALG, iv: toArrayBuffer(iv), tagLength: GCM_TAG },
      key,
      toArrayBuffer(ct),
    );
    this.seenReceiveIvs.add(ivKey(iv));
    return new Uint8Array(pt);
  }

  /** Clear group key material and reject future use of this object. */
  destroy(): void {
    this.groupKey = null;
    this.seenReceiveIvs.clear();
    this.destroyed = true;
  }

  private requireKey(): CryptoKey {
    if (this.destroyed || !this.groupKey) throw new Error('TsumugiGroup: destroyed');
    return this.groupKey;
  }

  private nextIv(): Uint8Array {
    if (this.sendIvCounter > 0xffffffff) {
      throw new Error('TsumugiGroup: AES-GCM nonce space exhausted');
    }
    const iv = new Uint8Array(IV_LEN);
    iv.set(this.sendIvPrefix, 0);
    new DataView(iv.buffer).setUint32(IV_PREFIX_LEN, this.sendIvCounter++, false);
    return iv;
  }
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
