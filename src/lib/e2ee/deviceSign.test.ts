// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * deviceSign.test.ts — the account-attribution device signing key.
 *
 * Runs on Node's WebCrypto (Ed25519). The transcript KAT literals below were
 * computed INDEPENDENTLY of the module (Buffer concatenation) and match the
 * daemon's account_identity.zig wire byte-for-byte — they are the contract.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  _resetDeviceSigningForTests,
  buildIdentityTranscript,
  buildResidenceMessage,
  deviceLabel,
  deviceSigningKeys,
  residenceUnsignedWire,
  signHex,
  toHex,
} from './deviceSign';

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceSigningForTests();
});

// ── residence wire KAT (mirrors the daemon Zig KAT: kain / 0xA1B2C3D4E5F60718 / 7 / 1e6)
const KAT_BINDING = { account: 'kain', nodeHex: 'a1b2c3d4e5f60718', epoch: 7, expiryMs: 1_000_000 };
const KAT_UNSIGNED_HEX =
  '41525031046b61696ea1b2c3d4e5f60718000000000000000700000000000f4240';
const KAT_MESSAGE_HEX =
  '4f524f4348492d4143434f554e542d5245534944454e43452d7631004152503104' +
  '6b61696ea1b2c3d4e5f60718000000000000000700000000000f4240';
// ── identity transcript KAT (account=kain, label=onyx-0001020304050607, pub=00..1f)
const KAT_IDENTITY_HEX =
  '4f524f4348492d4143434f554e542d4944454e544954592d7631006b61696e006f' +
  '6e79782d3030303130323033303430353036303700000102030405060708090a0b' +
  '0c0d0e0f101112131415161718191a1b1c1d1e1f';

describe('residence wire (byte-exact daemon contract)', () => {
  it('produces the exact unsigned wire for the fixed vector', () => {
    const wire = residenceUnsignedWire(KAT_BINDING);
    expect(wire).not.toBeNull();
    expect(toHex(wire!)).toBe(KAT_UNSIGNED_HEX);
    expect(wire!.length).toBe(4 + 1 + 4 + 8 + 8 + 8);
  });

  it('produces the exact domain-separated signing message', () => {
    const msg = buildResidenceMessage(KAT_BINDING);
    expect(msg).not.toBeNull();
    expect(toHex(msg!)).toBe(KAT_MESSAGE_HEX);
  });

  it('encodes all integers big-endian', () => {
    const wire = residenceUnsignedWire({ account: 'a', nodeHex: '0000000000000001', epoch: 1, expiryMs: 256 })!;
    // node u64 BE ends in ...01; epoch u64 BE ends in ...01; expiry 256 = ...0100
    expect(toHex(wire)).toBe('4152503101' + '61' + '0000000000000001' + '0000000000000001' + '0000000000000100');
  });

  it('rejects invalid bindings fail-closed (null, never a wrong wire)', () => {
    expect(residenceUnsignedWire({ ...KAT_BINDING, account: '' })).toBeNull();
    expect(residenceUnsignedWire({ ...KAT_BINDING, account: 'x'.repeat(65) })).toBeNull();
    expect(residenceUnsignedWire({ ...KAT_BINDING, nodeHex: 'A1B2C3D4E5F60718' })).toBeNull(); // upper
    expect(residenceUnsignedWire({ ...KAT_BINDING, nodeHex: 'a1b2c3d4e5f6071' })).toBeNull(); // 15
    expect(residenceUnsignedWire({ ...KAT_BINDING, nodeHex: 'a1b2c3d4e5f607181' })).toBeNull(); // 17
    expect(residenceUnsignedWire({ ...KAT_BINDING, nodeHex: 'a1b2c3d4e5f6071g' })).toBeNull(); // non-hex
    expect(residenceUnsignedWire({ ...KAT_BINDING, epoch: -1 })).toBeNull();
    expect(residenceUnsignedWire({ ...KAT_BINDING, epoch: 1.5 })).toBeNull();
    expect(residenceUnsignedWire({ ...KAT_BINDING, expiryMs: Number.MAX_SAFE_INTEGER + 2 })).toBeNull();
    expect(buildResidenceMessage({ ...KAT_BINDING, account: '' })).toBeNull();
  });

  it('accepts a 64-byte account (the daemon max) and length-prefixes it', () => {
    const account = 'k'.repeat(64);
    const wire = residenceUnsignedWire({ ...KAT_BINDING, account })!;
    expect(wire[4]).toBe(64);
    expect(wire.length).toBe(4 + 1 + 64 + 24);
  });
});

describe('identity transcript (byte-exact daemon contract)', () => {
  it('produces the exact enroll transcript for the fixed vector', () => {
    const pub = new Uint8Array(32).map((_, i) => i);
    const t = buildIdentityTranscript('kain', 'onyx-0001020304050607', pub);
    expect(t).not.toBeNull();
    expect(toHex(t!)).toBe(KAT_IDENTITY_HEX);
  });

  it('rejects invalid accounts, labels, and key sizes', () => {
    const pub = new Uint8Array(32);
    expect(buildIdentityTranscript('', 'lbl', pub)).toBeNull();
    expect(buildIdentityTranscript('x'.repeat(65), 'lbl', pub)).toBeNull();
    expect(buildIdentityTranscript('kain', '', pub)).toBeNull();
    expect(buildIdentityTranscript('kain', 'bad label', pub)).toBeNull();
    expect(buildIdentityTranscript('kain', 'l'.repeat(33), pub)).toBeNull();
    expect(buildIdentityTranscript('kain', 'lbl', new Uint8Array(31))).toBeNull();
    expect(buildIdentityTranscript('kain', 'lbl', new Uint8Array(33))).toBeNull();
  });

  it('deviceLabel is daemon-valid and per-device distinct', () => {
    const label = deviceLabel('ab'.repeat(32));
    expect(label).toBe('onyx-abababababababab');
    expect(/^[A-Za-z0-9._-]{1,32}$/.test(label)).toBe(true);
  });
});

describe('deviceSigningKeys', () => {
  it('generates once and reloads the SAME key from onyx-keys', async () => {
    const first = await deviceSigningKeys();
    expect(first).not.toBeNull();
    expect(first!.publicHex).toMatch(/^[0-9a-f]{64}$/);
    expect(first!.publicRaw.length).toBe(ED25519_PUBLIC_KEY_BYTES);

    // Same IndexedDB, fresh module cache — must load, not regenerate.
    _resetDeviceSigningForTests();
    const second = await deviceSigningKeys();
    expect(second!.publicHex).toBe(first!.publicHex);
  });

  it('is a DIFFERENT record from the E2EE ECDH key (sign-v1 vs dm-v1)', async () => {
    const { deviceKeys } = await import('./dmCipher');
    const dm = await deviceKeys();
    const sign = await deviceSigningKeys();
    expect(dm).not.toBeNull();
    expect(sign).not.toBeNull();
    expect(sign!.keyPair.privateKey.algorithm.name).toBe('Ed25519');
    expect(dm!.keyPair.privateKey.algorithm.name).toBe('ECDH');
  });

  it('returns null when IndexedDB is unavailable (fail-closed, never throws)', async () => {
    // @ts-expect-error — simulate a private-window/no-IDB environment
    delete globalThis.indexedDB;
    expect(await deviceSigningKeys()).toBeNull();
    expect(await signHex(new Uint8Array([1]))).toBeNull();
  });
});

describe('signHex round-trip', () => {
  it('signs the residence message verifiably (independent WebCrypto verify)', async () => {
    const keys = await deviceSigningKeys();
    const msg = buildResidenceMessage(KAT_BINDING)!;
    const sigHex = await signHex(msg);
    expect(sigHex).toMatch(/^[0-9a-f]{128}$/);
    const sig = fromHex(sigHex!);
    expect(sig.length).toBe(ED25519_SIGNATURE_BYTES);

    // Verify with a freshly-imported public key — no shared state with the module.
    const pub = await crypto.subtle.importKey(
      'raw',
      keys!.publicRaw.slice().buffer as ArrayBuffer,
      'Ed25519',
      true,
      ['verify'],
    );
    expect(await crypto.subtle.verify('Ed25519', pub, sig as BufferSource, msg as BufferSource)).toBe(true);

    // A single flipped message byte must not verify.
    const tampered = msg.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(await crypto.subtle.verify('Ed25519', pub, sig as BufferSource, tampered as BufferSource)).toBe(false);
  });

  it('signs the identity transcript verifiably', async () => {
    const keys = await deviceSigningKeys();
    const t = buildIdentityTranscript('kain', deviceLabel(keys!.publicHex), keys!.publicRaw)!;
    const sigHex = await signHex(t);
    const pub = await crypto.subtle.importKey(
      'raw',
      keys!.publicRaw.slice().buffer as ArrayBuffer,
      'Ed25519',
      true,
      ['verify'],
    );
    expect(await crypto.subtle.verify('Ed25519', pub, fromHex(sigHex!) as BufferSource, t as BufferSource)).toBe(true);
  });
});
