// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dmCipher.test.ts — the E2EE DM cipher (Roadmap Phase 3.6).
 *
 * Runs on Node's WebCrypto (vitest/jsdom exposes it). Two "devices" are two
 * key pairs; the module under test plays one side and a locally-built peer
 * plays the other, proving both directions derive the same key.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ENVELOPE_PREFIX,
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  deviceRegistryId,
  deviceKeys,
  fromB64url,
  isEnvelope,
  openDm,
  sealDm,
  toB64url,
} from './dmCipher';

/** A peer device: raw keypair + the same derivation, built independently. */
async function makePeer() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { kp, publicB64: toB64url(raw) };
}

async function peerDerive(peer: Awaited<ReturnType<typeof makePeer>>, otherPublicB64: string) {
  const otherRaw = fromB64url(otherPublicB64)!;
  const otherKey = await crypto.subtle.importKey(
    'raw',
    otherRaw.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: otherKey }, peer.kp.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const pair = [peer.publicB64, otherPublicB64].sort();
  const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('onyx-dm-v1'), info },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
});

describe('dmCipher', () => {
  it('creates a device key once and reloads the same public key', async () => {
    const first = await deviceKeys();
    expect(first).not.toBeNull();
    _resetDeviceKeysForTests(); // same IDB, fresh module cache = "page reload"
    const second = await deviceKeys();
    expect(second!.publicB64).toBe(first!.publicB64);
    // 65-byte uncompressed SEC1 point.
    const raw = fromB64url(first!.publicB64)!;
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
  });

  it('derives a stable bounded registry id without collapsing different devices', async () => {
    const first = await makePeer();
    const second = await makePeer();

    const firstId = await deviceRegistryId(first.publicB64);
    expect(firstId).toMatch(/^web-[A-Za-z0-9_-]{20}$/);
    expect(await deviceRegistryId(first.publicB64)).toBe(firstId);
    expect(await deviceRegistryId(second.publicB64)).not.toBe(firstId);
  });

  it('refuses to derive a registry id from a malformed public point', async () => {
    await expect(deviceRegistryId('browser')).resolves.toBeNull();
    await expect(deviceRegistryId(toB64url(new Uint8Array(65)))).resolves.toBeNull();
  });

  it('seals an envelope the peer can open (and vice versa)', async () => {
    const peer = await makePeer();

    // We → peer.
    const envelope = await sealDm(peer.publicB64, 'quiet water, quiet wire');
    expect(envelope).not.toBeNull();
    expect(isEnvelope(envelope!)).toBe(true);

    const peerKey = await peerDerive(peer, (await deviceKeys())!.publicB64);
    const body = fromB64url(envelope!.slice(ENVELOPE_PREFIX.length))!;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.slice(0, 12) }, peerKey, body.slice(12));
    expect(new TextDecoder().decode(pt)).toBe('quiet water, quiet wire');

    // Peer → us (peer encrypts with ITS derivation; we open with openDm).
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      peerKey,
      new TextEncoder().encode('replies flow back'),
    );
    const wire = new Uint8Array(12 + ct.byteLength);
    wire.set(nonce, 0);
    wire.set(new Uint8Array(ct), 12);
    const opened = await openDm(peer.publicB64, `${ENVELOPE_PREFIX}${toB64url(wire)}`);
    expect(opened).toBe('replies flow back');
  });

  it('round-trips through its own seal/open (history replay path)', async () => {
    const peer = await makePeer();
    const envelope = await sealDm(peer.publicB64, 'same key both ways');
    expect(await openDm(peer.publicB64, envelope!)).toBe('same key both ways');
  });

  it('returns null instead of throwing on garbage', async () => {
    const peer = await makePeer();
    expect(await openDm(peer.publicB64, 'not an envelope')).toBeNull();
    expect(await openDm(peer.publicB64, `${ENVELOPE_PREFIX}!!!not-b64!!!`)).toBeNull();
    expect(await openDm(peer.publicB64, `${ENVELOPE_PREFIX}${toB64url(new Uint8Array(4))}`)).toBeNull();
    // Wrong peer key (tampered/rotated) → clean null.
    const other = await makePeer();
    const envelope = await sealDm(peer.publicB64, 'secret');
    expect(await openDm(other.publicB64, envelope!)).toBeNull();
  });

  it('rejects invalid peer public keys', async () => {
    expect(await sealDm('short', 'x')).toBeNull();
    expect(await sealDm(toB64url(new Uint8Array(65)), 'x')).toBeNull(); // not on curve
  });

  it('rejects a body shorter than nonce+tag (13–27 bytes) fail-closed', async () => {
    const peer = await makePeer();
    // Envelope + valid peer key, but the body is too short to be a real
    // nonce(12) ‖ tag(16); these used to slip past the < 13 guard and only fail
    // inside decrypt. They must all return null, never a partial plaintext.
    for (const len of [13, 20, 27]) {
      const short = `${ENVELOPE_PREFIX}${toB64url(new Uint8Array(len))}`;
      expect(await openDm(peer.publicB64, short)).toBeNull();
    }
    // 28 bytes clears the length guard but still isn't a valid GCM ciphertext.
    const min = `${ENVELOPE_PREFIX}${toB64url(new Uint8Array(28))}`;
    expect(await openDm(peer.publicB64, min)).toBeNull();
  });
});

describe('fromB64url (strict / fail-closed)', () => {
  it('round-trips valid unpadded base64url bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 42, 250, 255]);
    expect(fromB64url(toB64url(bytes))).toEqual(bytes);
  });

  it('rejects out-of-alphabet input instead of decoding to wrong bytes', () => {
    expect(fromB64url('++//')).toBeNull(); // standard-base64, not base64url
    expect(fromB64url('AAAA=')).toBeNull(); // explicit padding is a violation
    expect(fromB64url('a b c')).toBeNull(); // whitespace
    expect(fromB64url('hello!')).toBeNull(); // stray symbol
  });

  it('rejects an impossible length (%4 === 1)', () => {
    expect(fromB64url('A')).toBeNull();
    expect(fromB64url('AAAAA')).toBeNull();
  });
});
