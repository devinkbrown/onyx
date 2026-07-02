// WS/browser media datagram MAC — the JS twin of Orochi's native-media MAC
// (orochi/src/substrate/kagura_frame.zig). Authenticates each kagura media
// frame the browser sends over a binary WebSocket frame so the server (SFU/relay)
// can attribute it to the issued per-stream key before fanning it out.
//
// The cross-repo contract is pinned by a shared known-answer test:
//   orochi: docs/reference/vectors/ws_media_mac.json + the Zig KAT test
//   onyx:   ./ws_media_mac.vectors.json + ./mediaMac.test.ts
// Any change here MUST update both repos in lockstep.

/** MAC tag appended after the kagura frame (HMAC-SHA256 truncated to 128 bits). */
export const MEDIA_MAC_TAG_BYTES = 16;
/** Per-stream MAC key size handed to the participant by the server. */
export const MEDIA_MAC_KEY_BYTES = 32;

// HKDF-style domain separation labels — must match kagura_frame.zig exactly.
const EXTRACT_KEY = 'orochi native-media mac extract v1';
const EXPAND_LABEL = 'orochi native-media datagram mac v1';

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto (crypto.subtle) is unavailable in this environment');
  return s;
}

// Web Crypto wants a plain ArrayBuffer-backed view; a Uint8Array<ArrayBufferLike>
// is not assignable to BufferSource under strict lib types. Copy into a fresh
// ArrayBuffer (matches the existing TsumugiSession idiom).
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function hmacSha256(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', toArrayBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle().sign('HMAC', key, toArrayBuffer(msg));
  return new Uint8Array(sig);
}

/**
 * Derive the 32-byte per-stream MAC key from the server root + public context.
 * The server normally derives this and hands it to the participant at MEDIA
 * JOIN, so the browser rarely calls this — it exists so the full chain is
 * testable against the shared KAT without a live server.
 */
export async function deriveMediaMacKey(
  root: Uint8Array,
  channel: string,
  participant: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const prk = await hmacSha256(enc.encode(EXTRACT_KEY), root);

  const label = enc.encode(EXPAND_LABEL);
  const ch = enc.encode(channel);
  const pa = enc.encode(participant);
  const msg = new Uint8Array(label.length + 1 + ch.length + 1 + pa.length + 1);
  let o = 0;
  msg.set(label, o); o += label.length;
  msg[o++] = 0x00;
  msg.set(ch, o); o += ch.length;
  msg[o++] = 0x00;
  msg.set(pa, o); o += pa.length;
  msg[o] = 0x01;

  return hmacSha256(prk, msg);
}

/**
 * Import a server-issued 32-byte K32 as a reusable HMAC CryptoKey. Import once
 * per call and reuse for every frame — importing per-frame is needless work in
 * the 60fps video hot path.
 */
export async function importMediaMacKey(k32: Uint8Array): Promise<CryptoKey> {
  if (k32.length !== MEDIA_MAC_KEY_BYTES) {
    throw new Error(`media MAC key must be ${MEDIA_MAC_KEY_BYTES} bytes, got ${k32.length}`);
  }
  return subtle().importKey('raw', toArrayBuffer(k32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Compute the 16-byte MAC tag over the exact kagura frame bytes. */
export async function mediaMacTag(key: CryptoKey, frame: Uint8Array): Promise<Uint8Array> {
  const sig = await subtle().sign('HMAC', key, toArrayBuffer(frame));
  return new Uint8Array(sig).slice(0, MEDIA_MAC_TAG_BYTES);
}

/** Return `frame || tag16` — the datagram the server lenient-verifies. */
export async function appendMediaMac(key: CryptoKey, frame: Uint8Array): Promise<Uint8Array> {
  const tag = await mediaMacTag(key, frame);
  const out = new Uint8Array(frame.length + tag.length);
  out.set(frame, 0);
  out.set(tag, frame.length);
  return out;
}

/** Constant-time tag comparison (for receiver-side verification, if ever used). */
export function mediaMacEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
