import { describe, expect, it } from 'vitest';
import { decryptGroupBackup, decryptPortableGroupBackup, encryptGroupBackup, encryptPortableGroupBackup, type BackupMetadata, type PortableGroupBackup } from './crypto-backup';

const metadata: BackupMetadata = {
  kind: 'room-epoch-key', networkId: 'local-net', accountId: 'alice', deviceId: 'phone', room: '#private', epoch: 7,
  commitHash: '11'.repeat(32), membershipDigest: '22'.repeat(32),
};

describe('explicit encrypted group-key backup', () => {
  it('round-trips only the selected 32-byte epoch key with canonical metadata', async () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const password = new TextEncoder().encode('correct horse battery staple');
    const bytes = await encryptGroupBackup({ metadata, epochKey: key, password });
    expect(bytes).not.toBeNull();
    const opened = await decryptGroupBackup(bytes!, password);
    expect(opened?.metadata).toEqual(metadata);
    expect(opened?.epochKey).toEqual(key);
    opened?.epochKey.fill(0);
    bytes?.fill(0);
  });

  it('rejects wrong passwords, altered authenticated metadata, and unlisted metadata fields', async () => {
    const epochKey = new Uint8Array(32).fill(9);
    const password = new TextEncoder().encode('correct horse battery staple');
    const bytes = await encryptGroupBackup({ metadata: { ...metadata, extraSecret: 'must-not-be-serialized' } as BackupMetadata, epochKey, password });
    expect(bytes).toBeNull();
    const valid = await encryptGroupBackup({ metadata, epochKey, password });
    expect(valid).not.toBeNull();
    const wrongPassword = await decryptGroupBackup(valid!, new TextEncoder().encode('incorrect password value'));
    expect(wrongPassword).toBeNull();
    const damaged = new Uint8Array(valid!);
    damaged[30] = damaged[30]! ^ 1;
    expect(await decryptGroupBackup(damaged, password)).toBeNull();
    damaged.fill(0); valid?.fill(0); epochKey.fill(0);
  });

  it('accepts configured custom WSS network identifiers using the shared NetworkId validator', async () => {
    const customMetadata = { ...metadata, networkId: 'wss://relay.example:7443/irc' };
    const key = new Uint8Array(32).fill(3);
    const password = new TextEncoder().encode('custom network backup password');
    const bytes = await encryptGroupBackup({ metadata: customMetadata, epochKey: key, password });
    expect(bytes).not.toBeNull();
    const opened = await decryptGroupBackup(bytes!, password);
    expect(opened?.metadata.networkId).toBe(customMetadata.networkId);
    opened?.epochKey.fill(0); bytes?.fill(0); key.fill(0); password.fill(0);
  });
});

function b64url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

const portable: PortableGroupBackup = {
  version: 2, kind: 'room-epoch-history', networkId: 'wss://relay.example:7443/irc', accountId: 'alice',
  exportingDeviceId: 'device-01', room: '#private', epoch: 7, commitHashHex: '11'.repeat(32), membershipDigestHex: '22'.repeat(32),
  epochKeyB64url: b64url(new Uint8Array(32).fill(7)),
  receipt: { signedCommitPayload: 'bounded-opaque-signed-payload', fromAccount: 'alice', fromDevice: 'device-01',
    signerPublicKeyB64url: b64url(new Uint8Array(32).fill(8)), signerFingerprintHex: '33'.repeat(32), acceptanceTrust: 'pinned',
    acceptedMembershipRevision: 'accepted:commit-7', acceptedMappingScheme: 'rfc1459', provenance: 'source-observed-acceptance' },
};

describe('portable ONYXGBK2 history backup', () => {
  it('round trips a fixed evidence bundle with the complete header authenticated', async () => {
    const password = new TextEncoder().encode('portable backup password');
    const encrypted = await encryptPortableGroupBackup(portable, password);
    expect(encrypted).not.toBeNull();
    expect(new TextDecoder().decode(encrypted!.subarray(0, 8))).toBe('ONYXGBK2');
    expect(encrypted!.byteLength).toBeGreaterThan(47);
    const opened = await decryptPortableGroupBackup(encrypted!, password);
    expect(opened?.payload).toEqual(portable);
    expect(opened?.epochKey).toEqual(new Uint8Array(32).fill(7));
    opened?.epochKey.fill(0); opened?.signerPublicKey.fill(0); encrypted?.fill(0); password.fill(0);
  });

  it('rejects an authenticated-header mutation, wrong password, and unlisted receipt fields', async () => {
    const password = new TextEncoder().encode('another portable backup password');
    const encrypted = await encryptPortableGroupBackup(portable, password);
    expect(encrypted).not.toBeNull();
    const damaged = new Uint8Array(encrypted!); damaged[14] = damaged[14]! ^ 1;
    expect(await decryptPortableGroupBackup(damaged, password)).toBeNull();
    expect(await decryptPortableGroupBackup(encrypted!, new TextEncoder().encode('wrong portable password'))).toBeNull();
    expect(await encryptPortableGroupBackup({ ...portable, receipt: { ...portable.receipt, harmless: 'secret-canary' } } as PortableGroupBackup, password)).toBeNull();
    damaged.fill(0); encrypted?.fill(0); password.fill(0);
  });
});
