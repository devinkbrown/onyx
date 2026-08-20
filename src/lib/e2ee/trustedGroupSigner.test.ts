// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { toB64url } from './dmCipher';
import { signGroupControlPayload, type GroupControlRouting } from './groupControlPayload';
import { decodeGroupDeviceDirectoryEntry, deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry } from './groupDeviceDirectory';
import {
  createInMemoryTrustedGroupSignerStore,
  resolveTrustedGroupControl,
  type TrustedGroupSignerStore,
} from './trustedGroupSigner';

const P256_GENERATOR_HEX = '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5';

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function signedCase(account = 'Alice') {
  const keyPair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const signerPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const encryptionPub = fromHex(P256_GENERATOR_HEX);
  const publicKey = encodeGroupDeviceDirectoryEntry({ signerPub, encryptionPub })!;
  const entry = decodeGroupDeviceDirectoryEntry(publicKey)!;
  const deviceId = (await deriveGroupDeviceId(entry))!;
  const route: GroupControlRouting = { channel: '#room', kind: 'commit', fromAccount: account, fromDevice: deviceId };
  const payload = await signGroupControlPayload({ routing: route, epoch: 1, body: new TextEncoder().encode('public-control'), signerPub, privateKey: keyPair.privateKey });
  const directory = new Map([[toB64url(signerPub), { account, deviceId, algorithm: 'onyx-ogc1-v1', publicKey, signerPub, trusted: true, entry }]]);
  return { payload: payload!, signerPub, directory, route };
}

describe('owner-scoped trusted group signer resolver', () => {
  it('pins first use, then requires exact owner and wire signer', async () => {
    const fixture = await signedCase();
    const store = createInMemoryTrustedGroupSignerStore();
    const first = await resolveTrustedGroupControl({ account: 'ALICE', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: fixture.directory, store });
    expect(first.status).toBe('verified');
    if (first.status === 'verified') expect(first.trust).toBe('first-use');

    const second = await resolveTrustedGroupControl({ account: 'alice', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: fixture.directory, store });
    expect(second.status).toBe('verified');
    if (second.status === 'verified') expect(second.trust).toBe('pinned');

    const other = await resolveTrustedGroupControl({ account: 'bob', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: { ...fixture.route, fromAccount: 'bob' }, directory: fixture.directory, store });
    expect(other.status).toBe('locked');
  });

  it('serializes concurrent first-use calls so a key change cannot win the race', async () => {
    const a = await signedCase();
    const b = await signedCase();
    const store = createInMemoryTrustedGroupSignerStore({ delayMs: 1 });
    const directory = new Map([
      ...a.directory.entries(),
      [toB64url(b.signerPub), { ...b.directory.get(toB64url(b.signerPub))!, deviceId: a.route.fromDevice, account: 'Alice' }],
    ]);
    const [first, second] = await Promise.all([
      resolveTrustedGroupControl({ account: 'Alice', deviceId: a.route.fromDevice, wireSigner: a.signerPub, payload: a.payload, routing: a.route, directory, store }),
      resolveTrustedGroupControl({ account: 'Alice', deviceId: a.route.fromDevice, wireSigner: b.signerPub, payload: b.payload, routing: { ...b.route, fromDevice: a.route.fromDevice }, directory, store }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['locked', 'verified']);
  });

  it('locks absent, deleted, unsupported, key-changed, and storage-failure states', async () => {
    const fixture = await signedCase();
    const deletedStore = createInMemoryTrustedGroupSignerStore();
    await deletedStore.put({ account: 'alice', deviceId: fixture.route.fromDevice, signerPub: toB64url(fixture.signerPub), deleted: true });
    expect((await resolveTrustedGroupControl({ account: 'Alice', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: fixture.directory, store: deletedStore })).status).toBe('locked');

    const changedStore = createInMemoryTrustedGroupSignerStore();
    await changedStore.put({ account: 'alice', deviceId: fixture.route.fromDevice, signerPub: toB64url(new Uint8Array(32).fill(0x42)) });
    expect((await resolveTrustedGroupControl({ account: 'Alice', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: fixture.directory, store: changedStore })).status).toBe('locked');

    const failing: TrustedGroupSignerStore = { async get() { throw new Error('IDB unavailable'); }, async put() { throw new Error('IDB unavailable'); } };
    expect((await resolveTrustedGroupControl({ account: 'Alice', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: fixture.directory, store: failing })).status).toBe('locked');

    const unsupported = new Map([[toB64url(fixture.signerPub), { ...fixture.directory.get(toB64url(fixture.signerPub))!, algorithm: 'mls-x25519', trusted: false }]]);
    expect((await resolveTrustedGroupControl({ account: 'Alice', deviceId: fixture.route.fromDevice, wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: unsupported, store: createInMemoryTrustedGroupSignerStore() })).status).toBe('locked');

    const absent = await resolveTrustedGroupControl({ account: 'Alice', deviceId: 'missing', wireSigner: fixture.signerPub, payload: fixture.payload, routing: fixture.route, directory: fixture.directory, store: createInMemoryTrustedGroupSignerStore() });
    expect(absent.status).toBe('locked');
  });
});
