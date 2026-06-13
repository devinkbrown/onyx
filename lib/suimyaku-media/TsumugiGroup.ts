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
const IV_LEN  = 12;

export class TsumugiGroup {
  private constructor(private readonly groupKey: CryptoKey) {}

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
    const raw     = await crypto.subtle.exportKey('raw', this.groupKey);
    const rawBytes = new Uint8Array(raw);
    return session.encrypt(rawBytes);
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
    const key = await crypto.subtle.importKey(
      'raw', raw.buffer as ArrayBuffer,
      { name: GCM_ALG, length: GCM_LEN },
      false,
      ['encrypt', 'decrypt'],
    );
    return new TsumugiGroup(key);
  }

  /** Encrypt a plaintext frame. Returns iv || ciphertext. */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ct = await crypto.subtle.encrypt(
      { name: GCM_ALG, iv },
      this.groupKey,
      new Uint8Array(plaintext).buffer as ArrayBuffer,
    );
    const out = new Uint8Array(IV_LEN + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), IV_LEN);
    return out;
  }

  /** Decrypt iv || ciphertext with the group key. */
  async decrypt(frame: Uint8Array): Promise<Uint8Array> {
    if (frame.length < IV_LEN + 16) throw new Error('TsumugiGroup: frame too short');
    const iv = frame.slice(0, IV_LEN);
    const ct = frame.slice(IV_LEN);
    const pt = await crypto.subtle.decrypt(
      { name: GCM_ALG, iv },
      this.groupKey,
      new Uint8Array(ct).buffer as ArrayBuffer,
    );
    return new Uint8Array(pt);
  }
}
