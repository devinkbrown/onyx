// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { fromB64url } from './dmCipher';

import {
  GROUP_DEVICE_DIRECTORY_MAGIC,
  GROUP_DEVICE_DIRECTORY_SUITE,
  MAX_GROUP_DEVICE_DIRECTORY_ENTRIES,
  GroupDeviceDirectoryCollector,
  collectGroupDeviceDirectorySnapshot,
  decodeGroupDeviceDirectoryEntry,
  deriveGroupDeviceId,
  encodeGroupDeviceDirectoryEntry,
  isValidP256UncompressedPublicKey,
  type GroupDeviceDirectoryEntry,
} from './groupDeviceDirectory';

const KAT_SIGNER_HEX = '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0';
const KAT_WRAP_HEX = '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5';
const KAT_ODD1 = 'T0REMQENdVB1TggApdI37vWCYDV2a5s-WhWGipQKsomVh4jjsARrF9Hy4SxCR_i85uVjpEDydwN9gS3rM6D0oTlF2JjClk_jQuL-Gn-bjufrSnwPnhYrzjNXazFezsu2QGg3v1H1';
const KAT_DEVICE_ID = 'ogc1-MPEyCFzdqv8BZ2wUbf_uKD';

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const P256_GENERATOR = fromHex(KAT_WRAP_HEX);

function sampleEntry(seed = 1): GroupDeviceDirectoryEntry {
  return {
    signerPub: new Uint8Array(32).map((_, i) => (i + seed) & 0xff),
    encryptionPub: P256_GENERATOR.slice(),
  };
}

describe('ODD1 group device directory codec', () => {
  it('encodes exactly 102 bytes and round-trips canonical base64url', async () => {
    const entry = sampleEntry();
    const wire = encodeGroupDeviceDirectoryEntry(entry);
    expect(wire).not.toBeNull();
    const raw = fromB64url(wire!)!;
    expect(raw.byteLength).toBe(102);
    expect(Array.from(raw.slice(0, 4))).toEqual(Array.from(new TextEncoder().encode(GROUP_DEVICE_DIRECTORY_MAGIC)));
    expect(raw[4]).toBe(GROUP_DEVICE_DIRECTORY_SUITE);
    expect(raw[37]).toBe(0x04);
    expect(decodeGroupDeviceDirectoryEntry(wire!)).toEqual(entry);
  });

  it('derives a stable compact id from the exact ODD1 bytes', async () => {
    const wire = encodeGroupDeviceDirectoryEntry(sampleEntry(4))!;
    const id = await deriveGroupDeviceId(wire);
    expect(id).toMatch(/^ogc1-[A-Za-z0-9_-]{22}$/);
    expect(await deriveGroupDeviceId(wire)).toBe(id);
    expect(await deriveGroupDeviceId(encodeGroupDeviceDirectoryEntry(sampleEntry(5))!)).not.toBe(id);
  });

  it('matches the fixed cross-language ODD1 KAT and deterministic id', async () => {
    const entry = {
      signerPub: fromHex(KAT_SIGNER_HEX),
      encryptionPub: P256_GENERATOR,
    };
    expect(isValidP256UncompressedPublicKey(entry.encryptionPub)).toBe(true);
    expect(encodeGroupDeviceDirectoryEntry(entry)).toBe(KAT_ODD1);
    expect(decodeGroupDeviceDirectoryEntry(KAT_ODD1)).toEqual(entry);
    expect(await deriveGroupDeviceId(KAT_ODD1)).toBe(KAT_DEVICE_ID);
  });

  it('rejects malformed suite, point shape, length, and noncanonical wire', () => {
    const wire = encodeGroupDeviceDirectoryEntry(sampleEntry())!;
    expect(decodeGroupDeviceDirectoryEntry(`${wire}=`)).toBeNull();
    const raw = new Uint8Array(102);
    raw.set(new TextEncoder().encode('ODD1'));
    raw[4] = 0x02;
    raw[37] = 0x03;
    expect(decodeGroupDeviceDirectoryEntry(raw)).toBeNull();
    expect(decodeGroupDeviceDirectoryEntry(new Uint8Array(101))).toBeNull();

    const offCurve = P256_GENERATOR.slice();
    offCurve[64] = (offCurve[64]! ^ 0x01);
    expect(isValidP256UncompressedPublicKey(offCurve)).toBe(false);
    expect(encodeGroupDeviceDirectoryEntry({ signerPub: sampleEntry().signerPub, encryptionPub: offCurve })).toBeNull();

    expect(encodeGroupDeviceDirectoryEntry({ signerPub: new Uint8Array(32), encryptionPub: P256_GENERATOR })).toBeNull();
  });
});

describe('E2EEKEY snapshot collector', () => {
  const entryA = encodeGroupDeviceDirectoryEntry(sampleEntry())!;
  const entryB = encodeGroupDeviceDirectoryEntry(sampleEntry(2))!;

  function deviceLine(account: string, id: string, key: string, alg = 'ogc1'): string {
    return `E2EEKEY DEVICE account=${account} id=${id} alg=${alg} key=${key}`;
  }

  it('requires an exact completed account/count snapshot and retains unknown legacy rows', async () => {
    const lines = [
      deviceLine('Alice', 'first', entryA),
      deviceLine('Alice', 'legacy', 'legacy-key', 'mls-x25519'),
      'E2EEKEY END account=Alice devices=2',
    ];
    const snapshot = await collectGroupDeviceDirectorySnapshot(lines);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.account).toBe('Alice');
    expect(snapshot!.devices).toHaveLength(2);
    expect(snapshot!.devices.find((row) => row.deviceId === 'legacy')?.trusted).toBe(false);
    expect(snapshot!.trusted).toHaveLength(0); // id "first" is not its deterministic ODD1 id
  });

  it('recognizes only the exact onyx-ogc1-v1 algorithm identifier', async () => {
    const deterministicId = await deriveGroupDeviceId(entryA);
    expect(deterministicId).not.toBeNull();
    const exact = await collectGroupDeviceDirectorySnapshot([
      deviceLine('Alice', deterministicId!, entryA, 'onyx-ogc1-v1'),
      'E2EEKEY END account=Alice devices=1',
    ]);
    expect(exact?.trusted).toHaveLength(1);

    const alias = await collectGroupDeviceDirectorySnapshot([
      deviceLine('Alice', deterministicId!, entryA, 'ogc1-v1'),
      'E2EEKEY END account=Alice devices=1',
    ]);
    expect(alias?.trusted).toHaveLength(0);
    expect(alias?.devices[0]?.legacy).toBe(true);
  });

  it.each([
    ['missing END', [deviceLine('Alice', 'first', entryA)]],
    ['duplicate device', [deviceLine('Alice', 'first', entryA), deviceLine('Alice', 'first', entryB), 'E2EEKEY END account=Alice devices=2']],
    ['account drift', [deviceLine('Alice', 'first', entryA), deviceLine('Bob', 'second', entryB), 'E2EEKEY END account=Alice devices=2']],
    ['count drift', [deviceLine('Alice', 'first', entryA), 'E2EEKEY END account=Alice devices=2']],
  ])('fails closed on %s', async (_name, lines) => {
    await expect(collectGroupDeviceDirectorySnapshot(lines)).resolves.toBeNull();
  });

  it('caps snapshots at 64 and rejects anything beyond the cap', () => {
    const collector = new GroupDeviceDirectoryCollector();
    for (let i = 0; i < MAX_GROUP_DEVICE_DIRECTORY_ENTRIES; i += 1) {
      expect(collector.accept(deviceLine('Alice', `d${i}`, 'legacy', 'old'))).toBe(true);
    }
    expect(collector.accept(deviceLine('Alice', 'overflow', 'legacy', 'old'))).toBe(false);
    expect(collector.finish()).toBeNull();
  });

  it('rejects raw prefixed NOTICE text instead of treating it as an authenticated snapshot', () => {
    const collector = new GroupDeviceDirectoryCollector();
    expect(collector.accept(':server NOTICE Alice :E2EEKEY DEVICE account=Alice id=d alg=old key=x')).toBe(false);
    expect(collector.isFailed).toBe(true);
  });
});
