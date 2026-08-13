// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { toB64url } from './dmCipher';
import { parseGroupControlDeliveryLine } from './groupControlInbound';
import { signGroupControlPayload, type GroupControlRouting } from './groupControlPayload';
import { decodeGroupDeviceDirectoryEntry, deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry } from './groupDeviceDirectory';
import { createInMemoryTrustedGroupSignerStore, resolveTrustedGroupControl } from './trustedGroupSigner';

const P256_GENERATOR_HEX = '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5';

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function fixture() {
  const keyPair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const signer = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const publicKey = encodeGroupDeviceDirectoryEntry({ signerPub: signer, encryptionPub: fromHex(P256_GENERATOR_HEX) })!;
  const entry = decodeGroupDeviceDirectoryEntry(publicKey)!;
  const deviceId = (await deriveGroupDeviceId(entry))!;
  const route: GroupControlRouting = { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: deviceId };
  const payload = await signGroupControlPayload({ routing: route, epoch: 1, body: new TextEncoder().encode('public'), signerPub: signer, privateKey: keyPair.privateKey });
  const directory = new Map([[toB64url(signer), { account: 'alice', deviceId, algorithm: 'onyx-ogc1-v1', publicKey, signerPub: signer, trusted: true, entry }]]);
  return { route, signer, payload: payload!, directory, deviceId };
}

describe('trusted group signer adversarial boundaries', () => {
  it('does not let a directory lookup by device id substitute for the wire signer key', async () => {
    const value = await fixture();
    const impostor = new Uint8Array(32).fill(0x52);
    const resolved = await resolveTrustedGroupControl({ account: 'alice', deviceId: value.deviceId, wireSigner: impostor, payload: value.payload, routing: value.route, directory: value.directory, store: createInMemoryTrustedGroupSignerStore() });
    expect(resolved).toEqual(expect.objectContaining({ status: 'locked', reason: 'signer-mismatch' }));
  });

  it('never pins after signature failure or storage write failure', async () => {
    const value = await fixture();
    const tampered = `${value.payload.slice(0, -1)}${value.payload.endsWith('A') ? 'B' : 'A'}`;
    const store = createInMemoryTrustedGroupSignerStore();
    const bad = await resolveTrustedGroupControl({ account: 'alice', deviceId: value.deviceId, wireSigner: value.signer, payload: tampered, routing: value.route, directory: value.directory, store });
    expect(bad).toEqual(expect.objectContaining({ status: 'locked', reason: 'bad-signature' }));
    const after = await resolveTrustedGroupControl({ account: 'alice', deviceId: value.deviceId, wireSigner: value.signer, payload: value.payload, routing: value.route, directory: value.directory, store });
    expect(after.status).toBe('verified');
    if (after.status === 'verified') expect(after.trust).toBe('first-use');

    const failing = await resolveTrustedGroupControl({ account: 'alice', deviceId: value.deviceId, wireSigner: value.signer, payload: value.payload, routing: value.route, directory: value.directory, store: { async get() { return null; }, async put() { throw new Error('quota'); } } });
    expect(failing).toEqual(expect.objectContaining({ status: 'locked', reason: 'trust-store-unavailable' }));
    expect('signer' in failing).toBe(false);
  });

  it('keeps legacy account-less deliveries locked even with an explicit fallback account', async () => {
    const value = await fixture();
    const legacy = parseGroupControlDeliveryLine(
      `:server E2EE.COMMIT #room ${value.deviceId} :${value.payload}`,
      'alice',
    );
    expect(legacy).toEqual(expect.objectContaining({ locked: true, lockReason: 'missing-account' }));
    const resolved = await resolveTrustedGroupControl({
      account: 'alice',
      deviceId: value.deviceId,
      wireSigner: value.signer,
      delivery: legacy!,
      directory: value.directory,
      store: createInMemoryTrustedGroupSignerStore(),
    });
    expect(resolved).toEqual(expect.objectContaining({ status: 'locked', reason: 'missing-account' }));
  });
});
