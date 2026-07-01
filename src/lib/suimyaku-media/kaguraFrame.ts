// Kagura media frame — the JS twin of Orochi's wire container
// (orochi/src/substrate/kagura_frame.zig). One encoded media payload per frame;
// the browser sends each frame as a binary WebSocket frame (optionally followed
// by a 16-byte MAC tag — see ./mediaMac).
//
// Wire format (little-endian), HEADER_BYTES = 19, MIN_FRAME_WIRE_BYTES = 23:
//   [ 4  payload-length (u32) ]
//   [ 1  band_id              ]
//   [ 4  stream_id  (u32)     ]
//   [ 4  sequence   (u32)     ]
//   [ 8  timestamp  (u64)     ]
//   [ 1  flags (bit0=keyframe)]
//   [ 1  codec_tag            ]
//   [ payload …               ]

export const KAGURA_HEADER_BYTES = 19;
export const KAGURA_MIN_FRAME_BYTES = 4 + KAGURA_HEADER_BYTES; // 23
/** Band IDs [0, 64) are control bands; media frames MUST use band >= 64. */
export const KAGURA_MEDIA_BAND_FLOOR = 64;

export const KaguraCodec = {
  raw: 0x00,
  kaguravoxAudio: 0x01,
  kaguravisVideo: 0x02,
} as const;
export type KaguraCodecTag = (typeof KaguraCodec)[keyof typeof KaguraCodec];

export interface KaguraFrame {
  bandId: number;
  streamId: number;
  sequence: number;
  /** Media-clock timestamp (codec-defined). Carried as a JS number (safe < 2^53). */
  timestamp: number;
  keyframe: boolean;
  codec: KaguraCodecTag;
  payload: Uint8Array;
}

/** Encode `frame` into a fresh Uint8Array. Throws on a control band id. */
export function encodeKaguraFrame(frame: KaguraFrame): Uint8Array {
  if (frame.bandId < KAGURA_MEDIA_BAND_FLOOR || frame.bandId > 0xff) {
    throw new Error(`kagura band_id must be ${KAGURA_MEDIA_BAND_FLOOR}-255, got ${frame.bandId}`);
  }
  const out = new Uint8Array(KAGURA_MIN_FRAME_BYTES + frame.payload.length);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, frame.payload.length, true); p += 4;
  out[p++] = frame.bandId & 0xff;
  dv.setUint32(p, frame.streamId >>> 0, true); p += 4;
  dv.setUint32(p, frame.sequence >>> 0, true); p += 4;
  dv.setBigUint64(p, BigInt(frame.timestamp), true); p += 8;
  out[p++] = frame.keyframe ? 1 : 0;
  out[p++] = frame.codec & 0xff;
  out.set(frame.payload, p);
  return out;
}

/**
 * Decode the kagura frame prefix from `buf`, ignoring an optional trailing
 * 16-byte MAC tag (the server forwards datagrams verbatim, tag included).
 * Returns null when `buf` is too short or the declared payload overruns it.
 */
export function decodeKaguraFrame(buf: Uint8Array, macTagBytes = 16): KaguraFrame | null {
  if (buf.length < KAGURA_MIN_FRAME_BYTES) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const payloadLen = dv.getUint32(0, true);
  const declaredTotal = KAGURA_MIN_FRAME_BYTES + payloadLen;
  // Accept exactly the frame, or the frame plus one MAC tag; reject other sizes.
  if (buf.length !== declaredTotal && buf.length !== declaredTotal + macTagBytes) return null;

  let p = 4;
  const bandId = buf[p]!; p += 1;
  if (bandId < KAGURA_MEDIA_BAND_FLOOR) return null;
  const streamId = dv.getUint32(p, true); p += 4;
  const sequence = dv.getUint32(p, true); p += 4;
  const timestamp = Number(dv.getBigUint64(p, true)); p += 8;
  const flags = buf[p]!; p += 1;
  const codecByte = buf[p]!; p += 1;
  if (codecByte !== KaguraCodec.raw && codecByte !== KaguraCodec.kaguravoxAudio && codecByte !== KaguraCodec.kaguravisVideo) {
    return null;
  }
  return {
    bandId,
    streamId,
    sequence,
    timestamp,
    keyframe: (flags & 0x01) !== 0,
    codec: codecByte as KaguraCodecTag,
    payload: buf.subarray(p, p + payloadLen),
  };
}
