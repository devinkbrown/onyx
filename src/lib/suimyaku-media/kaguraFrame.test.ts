import { describe, expect, it } from 'vitest';

import {
  KAGURA_MIN_FRAME_BYTES,
  KaguraCodec,
  decodeKaguraFrame,
  encodeKaguraFrame,
} from './kaguraFrame';
import vectors from './ws_media_mac.vectors.json';

function hex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

describe('kaguraFrame — wire format matches Orochi kagura_frame.zig', () => {
  it('encodes the canonical KAT frame byte-for-byte', () => {
    // Same fields the Zig KAT uses: band 64, stream 0x11223344, seq 7, ts 9000,
    // keyframe, kaguravox audio, payload "voice".
    const frame = encodeKaguraFrame({
      bandId: 64,
      streamId: 0x11223344,
      sequence: 7,
      timestamp: 9000,
      keyframe: true,
      codec: KaguraCodec.kaguravoxAudio,
      payload: new TextEncoder().encode('voice'),
    });
    expect(toHex(frame)).toBe(vectors.vector.frame_hex);
  });

  it('round-trips encode/decode', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const frame = {
      bandId: 128,
      streamId: 0xdeadbeef,
      sequence: 4242,
      timestamp: 1_700_000_000,
      keyframe: false,
      codec: KaguraCodec.kaguravisVideo,
      payload,
    };
    const decoded = decodeKaguraFrame(encodeKaguraFrame(frame));
    expect(decoded).not.toBeNull();
    expect(decoded!.bandId).toBe(128);
    expect(decoded!.streamId).toBe(0xdeadbeef);
    expect(decoded!.sequence).toBe(4242);
    expect(decoded!.timestamp).toBe(1_700_000_000);
    expect(decoded!.keyframe).toBe(false);
    expect(decoded!.codec).toBe(KaguraCodec.kaguravisVideo);
    expect(Array.from(decoded!.payload)).toEqual(Array.from(payload));
  });

  it('decodes a frame with a trailing 16-byte MAC tag (forwarded verbatim)', () => {
    const tagged = hex(vectors.vector.frame_hex + vectors.vector.tag_hex);
    const decoded = decodeKaguraFrame(tagged);
    expect(decoded).not.toBeNull();
    expect(decoded!.streamId).toBe(0x11223344);
    expect(new TextDecoder().decode(decoded!.payload)).toBe('voice');
  });

  it('rejects a control-band frame and truncated input', () => {
    const tooShort = new Uint8Array(KAGURA_MIN_FRAME_BYTES - 1);
    expect(decodeKaguraFrame(tooShort)).toBeNull();
    expect(() => encodeKaguraFrame({
      bandId: 10, streamId: 0, sequence: 0, timestamp: 0, keyframe: false,
      codec: KaguraCodec.raw, payload: new Uint8Array(0),
    })).toThrow();
  });
});
