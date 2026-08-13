// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  openGroupWelcome,
  prepareGroupWelcome,
} from './groupWelcome';
import { GroupSession } from './groupSession';
import type { ResolveResult } from './trustedGroupSigner';

const bytes = (value: number, length = 32) => new Uint8Array(length).fill(value);

function session(requireWelcome = false): GroupSession {
  return GroupSession.create({ room: '#Room', account: 'Alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2), requireWelcome })!;
}

function verified(body: Uint8Array, kind: 'commit' | 'welcome', account = 'alice', deviceId = 'phone'): Extract<ResolveResult, { status: 'verified' }> {
  return {
    status: 'verified', trust: 'first-use',
    parts: { version: 2, kind, epoch: 1, body, signerPub: bytes(8), signature: bytes(7, 64) },
    signer: bytes(8), directoryKey: 'key', account, deviceId,
  };
}

const commitRoute = { channel: '#room', kind: 'commit' as const, fromAccount: 'alice', fromDevice: 'phone' };

async function openedWelcome(input: {
  epochKey: Uint8Array;
  membershipDigest?: Uint8Array;
  commitId?: Uint8Array;
  toAccount?: string;
  toDevice?: string;
}) {
  const toAccount = input.toAccount ?? 'alice';
  const toDevice = input.toDevice ?? 'phone';
  const commitId = input.commitId ?? bytes(4);
  const membershipDigest = input.membershipDigest ?? bytes(3);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const prepared = await prepareGroupWelcome({
    room: '#room',
    fromAccount: 'alice',
    fromDevice: 'sender',
    toAccount,
    toDevice,
    epoch: 1,
    commitId,
    membershipDigest,
    epochKey: input.epochKey,
    recipientWrapPublicKey: publicRaw,
  });
  const body = prepared!.bytes.slice();
  const resolution = verified(body, 'welcome', 'alice', 'sender');
  const opened = await openGroupWelcome({
    wire: body,
    room: '#room',
    fromAccount: 'alice',
    fromDevice: 'sender',
    toAccount,
    toDevice,
    epoch: 1,
    commitId,
    membershipDigest,
    recipientPrivateKey: pair.privateKey,
    resolution,
  });
  expect(opened).not.toBeNull();
  return { opened: opened!, resolution };
}

describe('pure GroupSession state machine', () => {
  it('applies one prepared commit transactionally and zeroizes retired key material', async () => {
    const state = session();
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    expect(prepared).not.toBeNull();
    expect(await state.applyPrepared(prepared!)).toEqual({ ok: false, reason: 'welcome-required' });
    expect((await state.applyPreparedLocal(prepared!, bytes(5))).ok).toBe(true);
    expect(state.epoch).toBe(1n);
    expect(state.currentEpochKey()).toEqual(bytes(5));
    expect(state.membershipDigest()).toEqual(bytes(3));
    expect(state.currentEpochKey()).not.toEqual(bytes(1));
  });

  it('rejects stale/gap epochs, duplicate ids, and same-epoch equivocation', async () => {
    const state = session();
    const [first, second] = await Promise.all([
      state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) }),
      state.prepareCommit({ membershipDigest: bytes(6), commitId: bytes(7), newEpochKey: bytes(8) }),
    ]);
    expect((await state.applyPreparedLocal(first!, bytes(5))).ok).toBe(true);
    expect(await state.applyPreparedLocal(first!, bytes(5))).toEqual({ ok: false, reason: 'duplicate-commit' });
    expect(await state.applyPreparedLocal(second!, bytes(8))).toEqual({ ok: false, reason: 'equivocation' });
    const gap = await state.prepareCommit({ membershipDigest: bytes(9), commitId: bytes(10), newEpochKey: bytes(11) });
    expect(gap).not.toBeNull();
  });

  it('serializes concurrent applications so the first admitted commit wins deterministically', async () => {
    const state = session();
    const first = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const second = await state.prepareCommit({ membershipDigest: bytes(6), commitId: bytes(7), newEpochKey: bytes(8) });
    const results = await Promise.all([state.applyPreparedLocal(first!, bytes(5)), state.applyPreparedLocal(second!, bytes(8))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, reason: 'equivocation' });
    expect(state.epoch).toBe(1n);
  });

  it('accepts inbound controls only from a verified OGC1-v2 resolution and binds room/account/device', async () => {
    const state = session();
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const route = { ...commitRoute };
    expect(await state.applyVerifiedCommit({ status: 'locked', reason: 'device-absent' }, route)).toEqual({ ok: false, reason: 'unverified-control' });
    expect(await state.applyVerifiedCommit(verified(prepared!.body, 'commit', 'mallory'), route)).toEqual({ ok: false, reason: 'committer-mismatch' });
    expect(await state.applyVerifiedCommit(verified(prepared!.body, 'commit'), { ...route, channel: '#other' })).toEqual({ ok: false, reason: 'room-mismatch' });
    const welcome = await openedWelcome({ epochKey: bytes(5) });
    expect((await state.stageVerifiedWelcome(welcome.opened, welcome.resolution, { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'alice', toDevice: 'phone' })).ok).toBe(true);
    expect((await state.applyVerifiedCommit(verified(prepared!.body, 'commit', 'alice', 'sender'), { ...route, fromDevice: 'sender' })).ok).toBe(true);
  });

  it('requires a verified target welcome before applying a recipient commit', async () => {
    const state = session(true);
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const senderRoute = { ...commitRoute, fromDevice: 'sender' };
    const resolution = verified(prepared!.body, 'commit', 'alice', 'sender');
    expect(await state.applyVerifiedCommit(resolution, senderRoute)).toEqual({ ok: false, reason: 'welcome-required' });
    const welcome = await openedWelcome({ epochKey: bytes(5) });
    expect((await state.stageVerifiedWelcome(welcome.opened, welcome.resolution, { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'alice', toDevice: 'phone' })).ok).toBe(true);
    expect((await state.applyVerifiedCommit(resolution, senderRoute)).ok).toBe(true);
  });

  it('rejects wrong targets, structural welcome forgeries, and unusable state after destroy', async () => {
    const state = session(true);
    const welcome = await openedWelcome({ epochKey: bytes(5), toAccount: 'bob', toDevice: 'tablet' });
    expect(await state.stageVerifiedWelcome(welcome.opened, welcome.resolution, { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet' })).toEqual({ ok: false, reason: 'welcome-target-mismatch' });
    const forged = { ...welcome.opened };
    expect(await state.stageVerifiedWelcome(forged, welcome.resolution, { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'bob', toDevice: 'tablet' })).toEqual({ ok: false, reason: 'invalid-welcome' });
    const provenance = await openedWelcome({ epochKey: bytes(5) });
    expect(() => { provenance.opened.epoch = 99n; }).toThrow();
    expect(() => { provenance.opened.commitId = bytes(9); }).toThrow();
    expect(() => { provenance.opened.membershipDigest = bytes(9); }).toThrow();
    expect(() => { provenance.opened.epochKey = bytes(9); }).toThrow();
    expect(() => { provenance.opened.context = bytes(9); }).toThrow();
    expect(() => { provenance.opened.bodyDigest = bytes(9); }).toThrow();
    provenance.opened.commitId.fill(0);
    provenance.opened.membershipDigest.fill(0);
    provenance.opened.epochKey.fill(0);
    provenance.opened.context.fill(0);
    provenance.opened.bodyDigest.fill(0);
    expect((await state.stageVerifiedWelcome(provenance.opened, provenance.resolution, { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'alice', toDevice: 'phone' })).ok).toBe(true);
    state.destroy();
    expect(state.currentEpochKey()).toBeNull();
    await expect(state.prepareCommit({ membershipDigest: bytes(3), newEpochKey: bytes(3) })).resolves.toBeNull();
    await expect(state.applyVerifiedCommit({ status: 'locked', reason: 'device-absent' }, commitRoute)).resolves.toEqual({ ok: false, reason: 'destroyed' });
  });

  it('rejects mismatched welcome commitments atomically and rejects a non-genesis zero anchor', async () => {
    expect(GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epoch: 1, epochKey: bytes(1), membershipDigest: bytes(2), commitHash: new Uint8Array(32) })).toBeNull();
    const state = session(true);
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const welcome = await openedWelcome({ epochKey: bytes(6) });
    expect((await state.stageVerifiedWelcome(welcome.opened, welcome.resolution, { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: 'sender', toAccount: 'alice', toDevice: 'phone' })).ok).toBe(true);
    expect(await state.applyVerifiedCommit(verified(prepared!.body, 'commit', 'alice', 'sender'), { ...commitRoute, fromDevice: 'sender' })).toEqual({ ok: false, reason: 'welcome-mismatch' });
    expect(state.epoch).toBe(0n);
    expect(state.currentEpochKey()).toEqual(bytes(1));
  });

  it('consumes a failed atomic welcome pair so a corrected retry can apply', async () => {
    const state = session(true);
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const badWelcome = await openedWelcome({ epochKey: bytes(6) });
    const commitResolution = verified(prepared!.body, 'commit', 'alice', 'sender');
    const commitRouting = { ...commitRoute, fromDevice: 'sender' };
    const welcomeRouting = { channel: '#room', kind: 'welcome' as const, fromAccount: 'alice', fromDevice: 'sender', toAccount: 'alice', toDevice: 'phone' };
    expect(await state.applyVerifiedPair({
      opened: badWelcome.opened,
      welcomeResolution: badWelcome.resolution,
      welcomeRouting,
      commitResolution,
      commitRouting,
    })).toEqual({ ok: false, reason: 'welcome-mismatch' });
    const goodWelcome = await openedWelcome({ epochKey: bytes(5) });
    expect((await state.applyVerifiedPair({
      opened: goodWelcome.opened,
      welcomeResolution: goodWelcome.resolution,
      welcomeRouting,
      commitResolution,
      commitRouting,
    })).ok).toBe(true);
    expect(state.epoch).toBe(1n);
  });

  it('rejects cross-room local application before any state swap', async () => {
    const source = session();
    const prepared = await source.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const other = GroupSession.create({ room: '#other', account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) })!;
    expect(await other.applyPreparedLocal(prepared!, bytes(5))).toEqual({ ok: false, reason: 'invalid-commit' });
    expect(other.epoch).toBe(0n);
    expect(other.currentEpochKey()).toEqual(bytes(1));
  });

  it('snapshots a local key at invocation before queued mutation can observe caller changes', async () => {
    const state = session();
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const localKey = bytes(5);
    const apply = state.applyPreparedLocal(prepared!, localKey);
    localKey.fill(6);
    expect((await apply).ok).toBe(true);
    expect(state.currentEpochKey()).toEqual(bytes(5));
  });
});
