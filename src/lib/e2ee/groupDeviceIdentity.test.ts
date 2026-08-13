import { describe, expect, it } from 'vitest';
import { projectGroupDeviceIdentity } from './groupDeviceIdentity';
import { decodeGroupDeviceDirectoryEntry } from './groupDeviceDirectory';

describe('group device identity projection', () => {
  it('projects existing public keys without asking either seam to create another identity', async () => {
    let signingCalls = 0; let dmCalls = 0;
    const signing = crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as Promise<CryptoKeyPair>;
    const dm = crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>;
    const [sign, ecdh] = await Promise.all([signing, dm]);
    const signingRaw = new Uint8Array(await crypto.subtle.exportKey('raw', sign.publicKey));
    const dmRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ecdh.publicKey));
    const result = await projectGroupDeviceIdentity({
      signingKeys: async () => { signingCalls++; return { keyPair: sign, publicRaw: signingRaw, publicHex: '' }; },
      dmKeys: async () => { dmCalls++; return { keyPair: ecdh, publicB64: btoa(String.fromCharCode(...dmRaw)).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_') }; },
    });
    expect(signingCalls).toBe(1); expect(dmCalls).toBe(1);
    expect(result?.deviceId).toMatch(/^ogc1-/u);
    expect(decodeGroupDeviceDirectoryEntry(result!.directory)?.signerPub).toEqual(signingRaw);
  });
  it('fails closed when an existing identity cannot be read', async () => {
    await expect(projectGroupDeviceIdentity({ signingKeys: async () => null, dmKeys: async () => null })).resolves.toBeNull();
  });
});
