// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ENVELOPE_PREFIX,
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  _sharedKeyCacheSizeForTests,
  deviceKeys,
  fromB64url,
  isEnvelope,
  openDm,
  sealDm,
  sharedKeyWith,
  toB64url,
} from './dmCipher';

interface PeerDevice {
  keyPair: CryptoKeyPair;
  publicB64: string;
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`${label} unexpectedly missing`);
  return value;
}

async function makePeerDevice(): Promise<PeerDevice> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  return { keyPair, publicB64: toB64url(rawPublic) };
}

async function peerSharedKey(peer: PeerDevice, otherPublicB64: string): Promise<CryptoKey> {
  const otherPublic = requireValue(fromB64url(otherPublicB64), 'other public key');
  const otherKey = await crypto.subtle.importKey(
    'raw',
    otherPublic.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: otherKey },
    peer.keyPair.privateKey,
    256,
  );
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

function envelopeBody(envelope: string): Uint8Array {
  expect(envelope.startsWith(ENVELOPE_PREFIX)).toBe(true);
  const body = requireValue(fromB64url(envelope.slice(ENVELOPE_PREFIX.length)), 'envelope body');
  expect(body.length).toBeGreaterThanOrEqual(13);
  return body;
}

async function openEnvelopeWithKey(key: CryptoKey, envelope: string): Promise<string> {
  const body = envelopeBody(envelope);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: body.slice(0, 12) },
    key,
    body.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

async function sealWithKey(key: CryptoKey, plaintext: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  const body = new Uint8Array(12 + ciphertext.byteLength);
  body.set(nonce, 0);
  body.set(new Uint8Array(ciphertext), 12);
  return `${ENVELOPE_PREFIX}${toB64url(body)}`;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
});

describe('dmCipher security contracts', () => {
  it('round-trips exactly with symmetric static-static derivation in both directions', async () => {
    const peer = await makePeerDevice();
    const mine = requireValue(await deviceKeys(), 'local device keys');

    const senderKey = requireValue(await sharedKeyWith(peer.publicB64), 'sender shared key');
    const recipientKey = await peerSharedKey(peer, mine.publicB64);
    const senderEnvelope = await sealDm(peer.publicB64, 'exact plaintext: snowglass 27');

    expect(senderEnvelope).not.toBeNull();
    const sealedBySender = requireValue(senderEnvelope, 'sender envelope');
    expect(await openEnvelopeWithKey(recipientKey, sealedBySender)).toBe('exact plaintext: snowglass 27');

    const peerEnvelope = await sealWithKey(recipientKey, 'exact reply: riverglass 42');
    expect(await openDm(peer.publicB64, peerEnvelope)).toBe('exact reply: riverglass 42');

    const proofFromSender = await sealWithKey(senderKey, 'same material across directions');
    expect(await openEnvelopeWithKey(recipientKey, proofFromSender)).toBe('same material across directions');
    const proofFromRecipient = await sealWithKey(recipientKey, 'same material back');
    expect(await openEnvelopeWithKey(senderKey, proofFromRecipient)).toBe('same material back');
  });

  it('keeps the wire envelope ciphertext-only and rejects wrong version tags', async () => {
    const peer = await makePeerDevice();
    const plaintext = 'plaintext must never ride the wire';
    const envelope = requireValue(await sealDm(peer.publicB64, plaintext), 'sealed envelope');

    expect(isEnvelope(envelope)).toBe(true);
    expect(envelope.startsWith(ENVELOPE_PREFIX)).toBe(true);
    expect(envelope).not.toContain(plaintext);
    expect(envelopeBody(envelope).slice(12).length).toBeGreaterThan(0);

    const wrongVersion = envelope.replace(ENVELOPE_PREFIX, 'ONYXDM0 ');
    expect(isEnvelope(wrongVersion)).toBe(false);
    expect(await openDm(peer.publicB64, wrongVersion)).toBeNull();
  });

  it('fails closed for the wrong key, tampered ciphertext, and truncated envelopes', async () => {
    const peer = await makePeerDevice();
    const wrongPeer = await makePeerDevice();
    const plaintext = 'the safe path is null, not this text';
    const envelope = requireValue(await sealDm(peer.publicB64, plaintext), 'sealed envelope');

    expect(await openDm(wrongPeer.publicB64, envelope)).toBeNull();

    const tampered = envelopeBody(envelope).slice();
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0x01;
    expect(await openDm(peer.publicB64, `${ENVELOPE_PREFIX}${toB64url(tampered)}`)).toBeNull();

    const truncatedBody = envelopeBody(envelope).slice(0, 12);
    expect(await openDm(peer.publicB64, `${ENVELOPE_PREFIX}${toB64url(truncatedBody)}`)).toBeNull();
    expect(await openDm(peer.publicB64, `${ENVELOPE_PREFIX}`)).toBeNull();
  });

  it('derives a stable shared key for a fixed keypair pair', async () => {
    const peer = await makePeerDevice();
    const firstKey = requireValue(await sharedKeyWith(peer.publicB64), 'first shared key');
    const envelope = await sealWithKey(firstKey, 'stable fixed-pair key material');

    _resetSharedKeysForTests();
    const secondKey = requireValue(await sharedKeyWith(peer.publicB64), 'second shared key');

    expect(await openEnvelopeWithKey(secondKey, envelope)).toBe('stable fixed-pair key material');
  });

  it('LRU-bounds retained shared keys and evicts failed derivations', async () => {
    const peers = await Promise.all(Array.from({ length: 65 }, () => makePeerDevice()));
    const retainedKeys: CryptoKey[] = [];
    for (const peer of peers.slice(0, 64)) {
      retainedKeys.push(requireValue(await sharedKeyWith(peer.publicB64), 'cached shared key'));
    }
    expect(_sharedKeyCacheSizeForTests()).toBe(64);

    // Refresh peer 0 so adding peer 64 evicts peer 1 as the least-recently used.
    expect(await sharedKeyWith(peers[0]!.publicB64)).toBe(retainedKeys[0]);
    await sharedKeyWith(peers[64]!.publicB64);
    expect(_sharedKeyCacheSizeForTests()).toBe(64);
    expect(await sharedKeyWith(peers[0]!.publicB64)).toBe(retainedKeys[0]);
    expect(await sharedKeyWith(peers[1]!.publicB64)).not.toBe(retainedKeys[1]);
    expect(_sharedKeyCacheSizeForTests()).toBe(64);

    // Malformed points never consume a slot; structurally valid points that
    // WebCrypto rejects are removed as soon as the failed derivation settles.
    _resetSharedKeysForTests();
    await expect(sharedKeyWith('malformed')).resolves.toBeNull();
    expect(_sharedKeyCacheSizeForTests()).toBe(0);
    await expect(sharedKeyWith(toB64url(new Uint8Array([0x04, ...new Uint8Array(64)])))).resolves.toBeNull();
    expect(_sharedKeyCacheSizeForTests()).toBe(0);
  });

  it('uses a fresh AES-GCM nonce for repeated seals of the same plaintext', async () => {
    const peer = await makePeerDevice();
    const first = requireValue(await sealDm(peer.publicB64, 'repeatable text'), 'first envelope');
    const second = requireValue(await sealDm(peer.publicB64, 'repeatable text'), 'second envelope');

    expect(first).not.toBe(second);
    expect(envelopeBody(first).slice(0, 12)).not.toEqual(envelopeBody(second).slice(0, 12));
    expect(await openDm(peer.publicB64, first)).toBe('repeatable text');
    expect(await openDm(peer.publicB64, second)).toBe('repeatable text');
  });
});
