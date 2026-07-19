// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MEDIA_MAC_KEY_BYTES,
  MEDIA_MAC_TAG_BYTES,
  appendMediaMac,
  deriveMediaMacKey,
  importMediaMacKey,
  mediaMacEqual,
  mediaMacTag,
  verifyMediaMac,
} from './mediaMac';
import vectors from './ws_media_mac.vectors.json';

function hex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const v = vectors.vector;

describe('mediaMac — browser datagram KAT', () => {
  it('derives K32 byte-for-byte from the server root + (channel, participant)', async () => {
    const k32 = await deriveMediaMacKey(hex(v.root_hex), v.channel, v.participant);
    expect(k32.length).toBe(MEDIA_MAC_KEY_BYTES);
    expect(toHex(k32)).toBe(v.k32_hex);
  });

  it('computes the 16-byte browser media datagram tag', async () => {
    const key = await importMediaMacKey(hex(v.k32_hex));
    const tag = await mediaMacTag(key, hex(v.frame_hex));
    expect(tag.length).toBe(MEDIA_MAC_TAG_BYTES);
    expect(toHex(tag)).toBe(v.tag_hex);
  });

  it('appends the tag to produce frame || tag16', async () => {
    const key = await importMediaMacKey(hex(v.k32_hex));
    const datagram = await appendMediaMac(key, hex(v.frame_hex));
    expect(toHex(datagram)).toBe(v.frame_hex + v.tag_hex);
  });

  it('produces a tag that round-trips through a server-derived key', async () => {
    // End-to-end: derive K32 the way the server does, then tag — must match.
    const k32 = await deriveMediaMacKey(hex(v.root_hex), v.channel, v.participant);
    const key = await importMediaMacKey(k32);
    const tag = await mediaMacTag(key, hex(v.frame_hex));
    expect(toHex(tag)).toBe(v.tag_hex);
  });
});

describe('mediaMacEqual — constant-time tag comparison', () => {
  it('accepts identical tags and rejects any single-byte difference', () => {
    const a = hex(v.tag_hex);
    const same = hex(v.tag_hex);
    const firstDiff = hex(v.tag_hex); firstDiff[0] = firstDiff[0]! ^ 0x01;
    const lastDiff = hex(v.tag_hex); lastDiff[lastDiff.length - 1] = lastDiff[lastDiff.length - 1]! ^ 0x80;

    expect(mediaMacEqual(a, same)).toBe(true);
    expect(mediaMacEqual(a, firstDiff)).toBe(false);
    expect(mediaMacEqual(a, lastDiff)).toBe(false);
    expect(mediaMacEqual(a, a.slice(0, a.length - 1))).toBe(false);
  });
});

describe('verifyMediaMac — receiver-side fail-closed verification', () => {
  it('accepts a well-formed frame || tag16 datagram and returns the frame bytes', async () => {
    const key = await importMediaMacKey(hex(v.k32_hex));
    const frame = hex(v.frame_hex);
    const datagram = await appendMediaMac(key, frame);

    const verified = await verifyMediaMac(key, datagram);
    expect(verified).not.toBeNull();
    expect(toHex(verified!)).toBe(v.frame_hex);
  });

  it('rejects a datagram whose MAC tag was tampered with (any single bit)', async () => {
    const key = await importMediaMacKey(hex(v.k32_hex));
    const datagram = await appendMediaMac(key, hex(v.frame_hex));
    datagram[datagram.length - 1]! ^= 0x01; // flip a tag bit

    expect(await verifyMediaMac(key, datagram)).toBeNull();
  });

  it('rejects a datagram whose frame payload was tampered with', async () => {
    const key = await importMediaMacKey(hex(v.k32_hex));
    const datagram = await appendMediaMac(key, hex(v.frame_hex));
    datagram[0]! ^= 0x80; // flip a frame byte, tag now stale

    expect(await verifyMediaMac(key, datagram)).toBeNull();
  });

  it('rejects a datagram verified under the wrong key (fail-closed)', async () => {
    const goodKey = await importMediaMacKey(hex(v.k32_hex));
    const datagram = await appendMediaMac(goodKey, hex(v.frame_hex));

    const wrongRaw = hex(v.k32_hex); wrongRaw[0]! ^= 0xff;
    const wrongKey = await importMediaMacKey(wrongRaw);
    expect(await verifyMediaMac(wrongKey, datagram)).toBeNull();
  });

  it('rejects a datagram too short to carry a full tag', async () => {
    const key = await importMediaMacKey(hex(v.k32_hex));
    // Exactly tag-sized and shorter carry no frame bytes → fail-closed.
    expect(await verifyMediaMac(key, new Uint8Array(MEDIA_MAC_TAG_BYTES))).toBeNull();
    expect(await verifyMediaMac(key, new Uint8Array(MEDIA_MAC_TAG_BYTES - 1))).toBeNull();
    expect(await verifyMediaMac(key, new Uint8Array(0))).toBeNull();
  });

  it('verifies against a key re-derived the way the server does', async () => {
    const k32 = await deriveMediaMacKey(hex(v.root_hex), v.channel, v.participant);
    const key = await importMediaMacKey(k32);
    const datagram = hex(v.frame_hex + v.tag_hex);

    const verified = await verifyMediaMac(key, datagram);
    expect(verified).not.toBeNull();
    expect(toHex(verified!)).toBe(v.frame_hex);
  });
});
