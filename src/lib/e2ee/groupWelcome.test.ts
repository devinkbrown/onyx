// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  GROUP_WELCOME_MAGIC,
  GROUP_WELCOME_MAX_BYTES,
  buildGroupWelcomeContext,
  consumeOpenedGroupWelcome,
  decodeGroupWelcome,
  encodeGroupWelcomePlaintext,
  isOpenedGroupWelcome,
  openGroupWelcome,
  prepareGroupWelcome,
} from './groupWelcome';
import { toB64url } from './dmCipher';
import type { ResolveResult } from './trustedGroupSigner';

const bytes = (value: number, length = 32) => new Uint8Array(length).fill(value);

function verified(body: Uint8Array, kind: 'welcome' | 'commit' = 'welcome'): ResolveResult {
  return {
    status: 'verified',
    trust: 'first-use',
    parts: {
      version: 2,
      kind,
      epoch: 1,
      body,
      signerPub: bytes(9),
      signature: bytes(8, 64),
    },
    signer: bytes(9),
    directoryKey: 'signer',
    account: 'alice',
    deviceId: 'sender',
  };
}

async function recipientKeys(): Promise<{ privateKey: CryptoKey; publicRaw: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicRaw };
}

async function extractableRecipientKeys(): Promise<{ privateKey: CryptoKey; publicRaw: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicRaw };
}

async function welcomeFixture() {
  const recipient = await recipientKeys();
  const prepared = await prepareGroupWelcome({
    room: ' #Room ',
    fromAccount: 'Alice',
    fromDevice: 'sender',
    toAccount: 'Bob',
    toDevice: 'tablet',
    epoch: 1n,
    commitId: bytes(1),
    membershipDigest: bytes(2),
    epochKey: bytes(3),
    recipientWrapPublicKey: recipient.publicRaw,
  });
  return { recipient, prepared: prepared! };
}

describe('OGW1 welcome wrapping', () => {
  it('round-trips recipient-targeted P-256 ECDH/HKDF/AES-GCM bytes', async () => {
    const fixture = await welcomeFixture();
    expect(fixture.prepared.bytes.byteLength).toBe(GROUP_WELCOME_MAX_BYTES);
    expect(new TextDecoder().decode(fixture.prepared.bytes.slice(0, 4))).toBe(GROUP_WELCOME_MAGIC);
    const opened = await openGroupWelcome({
      wire: fixture.prepared.wire,
      room: '#room',
      fromAccount: 'alice',
      fromDevice: 'sender',
      toAccount: 'bob',
      toDevice: 'tablet',
      epoch: 1,
      commitId: bytes(1),
      membershipDigest: bytes(2),
      recipientPrivateKey: fixture.recipient.privateKey,
      resolution: verified(fixture.prepared.bytes),
    });
    expect(opened?.epoch).toBe(1n);
    expect(opened?.epochKey).toEqual(bytes(3));
    expect(opened?.bodyDigest).toHaveLength(32);
    expect(isOpenedGroupWelcome(opened)).toBe(true);
    expect(isOpenedGroupWelcome({ ...opened! })).toBe(false);
    const consumed = consumeOpenedGroupWelcome(opened);
    expect(consumed?.epochKey).toEqual(bytes(3));
    expect(isOpenedGroupWelcome(opened)).toBe(false);
    expect(consumeOpenedGroupWelcome(opened)).toBeNull();
  });

  it('randomizes ciphertext and rejects target substitution, wrong key, tamper, and trailing bytes', async () => {
    const first = await welcomeFixture();
    const second = await welcomeFixture();
    expect(first.prepared.wire).not.toBe(second.prepared.wire);
    const base = {
      wire: first.prepared.wire,
      room: '#room',
      fromAccount: 'alice',
      fromDevice: 'sender',
      toAccount: 'bob',
      toDevice: 'tablet',
      epoch: 1,
      commitId: bytes(1),
      membershipDigest: bytes(2),
      recipientPrivateKey: first.recipient.privateKey,
      resolution: verified(first.prepared.bytes),
    } as const;
    await expect(openGroupWelcome({ ...base, toDevice: 'phone' })).resolves.toBeNull();
    await expect(openGroupWelcome({ ...base, recipientPrivateKey: second.recipient.privateKey })).resolves.toBeNull();
    const tampered = first.prepared.bytes.slice();
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 1;
    await expect(openGroupWelcome({ ...base, wire: tampered })).resolves.toBeNull();
    await expect(openGroupWelcome({ ...base, wire: new Uint8Array([...first.prepared.bytes, 0]) })).resolves.toBeNull();
  });

  it('requires a verified OGC1-v2 welcome resolution and exact body binding', async () => {
    const fixture = await welcomeFixture();
    const base = {
      wire: fixture.prepared.wire,
      room: '#room', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet',
      epoch: 1, commitId: bytes(1), membershipDigest: bytes(2), recipientPrivateKey: fixture.recipient.privateKey,
    } as const;
    await expect(openGroupWelcome({ ...base, resolution: { status: 'locked', reason: 'device-absent' } })).resolves.toBeNull();
    await expect(openGroupWelcome({ ...base, resolution: verified(fixture.prepared.bytes, 'commit') })).resolves.toBeNull();
    await expect(openGroupWelcome({ ...base, resolution: verified(new Uint8Array([1, 2, 3])) })).resolves.toBeNull();
  });

  it('rejects an extractable recipient private key', async () => {
    const recipient = await extractableRecipientKeys();
    const prepared = await prepareGroupWelcome({
      room: '#room', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet',
      epoch: 1, commitId: bytes(1), membershipDigest: bytes(2), epochKey: bytes(3), recipientWrapPublicKey: recipient.publicRaw,
    });
    await expect(openGroupWelcome({
      wire: prepared!.wire, room: '#room', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet',
      epoch: 1, commitId: bytes(1), membershipDigest: bytes(2), recipientPrivateKey: recipient.privateKey, resolution: verified(prepared!.bytes),
    })).resolves.toBeNull();
  });

  it('rejects invalid recipient and sender inputs before plaintext preparation', async () => {
    const recipient = await recipientKeys();
    const input = {
      room: '#room', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet',
      epoch: 1, commitId: bytes(1), membershipDigest: bytes(2), epochKey: bytes(3),
      recipientWrapPublicKey: recipient.publicRaw,
    } as const;
    await expect(prepareGroupWelcome({ ...input, recipientWrapPublicKey: new Uint8Array(65) })).resolves.toBeNull();
    await expect(prepareGroupWelcome({ ...input, senderResolution: { status: 'locked', reason: 'bad-signature' } })).resolves.toBeNull();
  });

  it('encodes the fixed plaintext with no trailing fields', () => {
    const plain = encodeGroupWelcomePlaintext({ epoch: 1n, commitId: bytes(1), membershipDigest: bytes(2), epochKey: bytes(3) })!;
    expect(plain.byteLength).toBe(109);
    expect(buildGroupWelcomeContext({ room: '#room', fromAccount: 'Alice', fromDevice: 'sender', toAccount: 'Bob', toDevice: 'tablet', epoch: 1, commitId: bytes(1) })).not.toBeNull();
    expect(decodeGroupWelcome(new Uint8Array(10))).toBeNull();
  });

  it('rejects non-canonical raw P-256 base64url pad bits', async () => {
    const recipient = await recipientKeys();
    const canonical = toB64url(recipient.publicRaw);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const index = alphabet.indexOf(canonical.at(-1)!);
    const alternate = (index & 0b110000) | ((index + 1) & 0b001111);
    const nonCanonical = `${canonical.slice(0, -1)}${alphabet[alternate]}`;
    expect(nonCanonical).not.toBe(canonical);
    expect(await prepareGroupWelcome({
      room: '#room', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet',
      epoch: 1, commitId: bytes(1), membershipDigest: bytes(2), epochKey: bytes(3),
      recipientWrapPublicKey: nonCanonical,
    })).toBeNull();
  });
});
