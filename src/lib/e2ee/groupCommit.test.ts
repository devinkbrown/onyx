// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  GROUP_COMMIT_BYTES,
  GROUP_COMMIT_MAGIC,
  GROUP_COMMIT_VERSION,
  buildGroupCommitContext,
  computeGroupEpochKeyCommitment,
  decodeGroupCommit,
  encodeGroupCommit,
  encodeGroupCommitBase64url,
  hashGroupCommit,
  prepareGroupCommit,
} from './groupCommit';

const bytes = (value: number, length = 32) => new Uint8Array(length).fill(value);
const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  for (let offset = 0; offset + needle.length <= haystack.length; offset += 1) {
    if (needle.every((value, index) => haystack[offset + index] === value)) return true;
  }
  return false;
};

const record = {
  priorEpoch: 0n,
  nextEpoch: 1n,
  priorCommitHash: new Uint8Array(32),
  commitId: bytes(1),
  membershipDigest: bytes(2),
  newEpochKeyCommitment: bytes(3),
};

describe('OGCMT2 group commit codec', () => {
  it('uses the exact fixed-width magic/version and round-trips raw/base64url forms', () => {
    const raw = encodeGroupCommit(record)!;
    expect(raw.byteLength).toBe(GROUP_COMMIT_BYTES);
    expect(new TextDecoder().decode(raw.slice(0, 6))).toBe(GROUP_COMMIT_MAGIC);
    expect(raw[6]).toBe(GROUP_COMMIT_VERSION);
    expect(decodeGroupCommit(raw)).toEqual(record);
    const wire = encodeGroupCommitBase64url(record)!;
    expect(decodeGroupCommit(wire)).toEqual(record);
    expect(decodeGroupCommit(new Uint8Array([...raw, 0]))).toBeNull();
    expect(decodeGroupCommit(`${wire}=`)).toBeNull();
  });

  it('binds canonical room/account/device context into the commit hash', async () => {
    const context = buildGroupCommitContext({
      room: ' #Room ',
      fromAccount: 'Alice',
      fromDevice: 'Phone.1',
      priorEpoch: 0,
      nextEpoch: 1,
      commitId: bytes(1),
    })!;
    const hash = await hashGroupCommit(record, context);
    expect(hash).not.toBeNull();
    const changed = buildGroupCommitContext({
      room: '#room',
      fromAccount: 'Mallory',
      fromDevice: 'Phone.1',
      priorEpoch: 0,
      nextEpoch: 1,
      commitId: bytes(1),
    })!;
    expect(await hashGroupCommit(record, changed)).not.toEqual(hash);
  });

  it('commits only a key commitment and zeroizes prepared copies on destroy', async () => {
    const epochKey = bytes(3);
    const prepared = await prepareGroupCommit({
      room: '#room',
      fromAccount: 'Alice',
      fromDevice: 'phone',
      priorEpoch: 0n,
      priorCommitHash: new Uint8Array(32),
      membershipDigest: bytes(4),
      newEpochKey: epochKey,
    });
    expect(prepared).not.toBeNull();
    expect(prepared!.record.nextEpoch).toBe(1n);
    expect(prepared!.record.commitId).toHaveLength(32);
    expect(prepared!.record.newEpochKeyCommitment).toHaveLength(32);
    expect(contains(prepared!.body, epochKey)).toBe(false);
    expect(prepared!.record).not.toHaveProperty('newEpochKey');
    prepared!.destroy();
    expect(prepared!.record.commitId.every((value) => value === 0)).toBe(true);
    expect(prepared!.record.newEpochKeyCommitment.every((value) => value === 0)).toBe(true);
    expect(encodeGroupCommit(prepared!.record)).toBeNull();
  });

  it('derives the frozen room/epoch/id/digest/key commitment and rejects invalid values', async () => {
    const commitment = await computeGroupEpochKeyCommitment({
      room: ' #Room ',
      nextEpoch: 1,
      commitId: bytes(1),
      membershipDigest: bytes(2),
      epochKey: bytes(3),
    });
    expect(commitment).toHaveLength(32);
    expect(encodeGroupCommit({ ...record, newEpochKeyCommitment: commitment! })).not.toBeNull();
    expect(encodeGroupCommit({ ...record, commitId: new Uint8Array(32) })).toBeNull();
    expect(encodeGroupCommit({ ...record, newEpochKeyCommitment: new Uint8Array(32) })).toBeNull();
    expect(encodeGroupCommit({ ...record, nextEpoch: -1n })).toBeNull();
    expect(encodeGroupCommit({ ...record, nextEpoch: 1n << 64n })).toBeNull();
    expect(encodeGroupCommit({ ...record, priorEpoch: 1n, priorCommitHash: new Uint8Array(32) })).toBeNull();
  });
});
