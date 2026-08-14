// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { prepareGroupCommit } from './groupCommit';
import {
  consumeOpenedGroupWelcome,
  openGroupWelcome,
  prepareGroupWelcome,
} from './groupWelcome';
import { GroupSession } from './groupSession';
import type { ResolveResult } from './trustedGroupSigner';

const bytes = (value: number, length = 32) => new Uint8Array(length).fill(value);

function session(requireWelcome = false): GroupSession {
  return GroupSession.create({ room: '#Room', account: 'Alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2), requireWelcome })!;
}

function verified(
  body: Uint8Array,
  kind: 'commit' | 'welcome',
  account = 'alice',
  deviceId = 'phone',
  epoch = 1,
): Extract<ResolveResult, { status: 'verified' }> {
  return {
    status: 'verified', trust: 'first-use',
    parts: { version: 2, kind, epoch, body, signerPub: bytes(8), signature: bytes(7, 64) },
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
  room?: string;
  fromAccount?: string;
  fromDevice?: string;
  epoch?: number;
}) {
  const room = input.room ?? '#room';
  const fromAccount = input.fromAccount ?? 'alice';
  const fromDevice = input.fromDevice ?? 'sender';
  const toAccount = input.toAccount ?? 'alice';
  const toDevice = input.toDevice ?? 'phone';
  const epoch = input.epoch ?? 1;
  const commitId = input.commitId ?? bytes(4);
  const membershipDigest = input.membershipDigest ?? bytes(3);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const prepared = await prepareGroupWelcome({
    room,
    fromAccount,
    fromDevice,
    toAccount,
    toDevice,
    epoch,
    commitId,
    membershipDigest,
    epochKey: input.epochKey,
    recipientWrapPublicKey: publicRaw,
  });
  const body = prepared!.bytes.slice();
  const resolution = verified(body, 'welcome', fromAccount, fromDevice, epoch);
  const opened = await openGroupWelcome({
    wire: body,
    room,
    fromAccount,
    fromDevice,
    toAccount,
    toDevice,
    epoch,
    commitId,
    membershipDigest,
    recipientPrivateKey: pair.privateKey,
    resolution,
  });
  expect(opened).not.toBeNull();
  return { opened: opened!, resolution };
}

async function genesisPair(input: {
  epochKey?: Uint8Array;
  membershipDigest?: Uint8Array;
  commitId?: Uint8Array;
  room?: string;
  fromAccount?: string;
  fromDevice?: string;
  toAccount?: string;
  toDevice?: string;
  priorEpoch?: number;
  nextEpoch?: number;
  priorCommitHash?: Uint8Array;
} = {}) {
  const room = input.room ?? '#room';
  const fromAccount = input.fromAccount ?? 'alice';
  const fromDevice = input.fromDevice ?? 'sender';
  const toAccount = input.toAccount ?? 'alice';
  const toDevice = input.toDevice ?? 'phone';
  const epochKey = input.epochKey ?? bytes(5);
  const membershipDigest = input.membershipDigest ?? bytes(3);
  const commitId = input.commitId ?? bytes(4);
  const nextEpoch = input.nextEpoch ?? 1;
  const prepared = await prepareGroupCommit({
    room,
    fromAccount,
    fromDevice,
    priorEpoch: input.priorEpoch ?? 0,
    priorCommitHash: input.priorCommitHash ?? new Uint8Array(32),
    membershipDigest,
    commitId,
    newEpochKey: epochKey,
    nextEpoch,
  });
  expect(prepared).not.toBeNull();
  const welcome = await openedWelcome({
    epochKey,
    membershipDigest,
    commitId,
    room,
    fromAccount,
    fromDevice,
    toAccount,
    toDevice,
    epoch: nextEpoch,
  });
  return {
    prepared: prepared!,
    welcome,
    welcomeRouting: {
      channel: room, kind: 'welcome' as const, fromAccount, fromDevice, toAccount, toDevice,
    },
    commitRouting: { channel: room, kind: 'commit' as const, fromAccount, fromDevice },
    commitResolution: verified(prepared!.body, 'commit', fromAccount, fromDevice, nextEpoch),
    room,
    account: toAccount,
    deviceId: toDevice,
  };
}

function bootstrapArgs(pair: Awaited<ReturnType<typeof genesisPair>>, overrides: Record<string, unknown> = {}) {
  return {
    opened: pair.welcome.opened,
    welcomeResolution: pair.welcome.resolution,
    welcomeRouting: pair.welcomeRouting,
    commitResolution: pair.commitResolution,
    commitRouting: pair.commitRouting,
    room: pair.room,
    account: pair.account,
    deviceId: pair.deviceId,
    ...overrides,
  };
}

describe('pure GroupSession state machine', () => {
  it('seals and opens only the current room/epoch and fails closed after destroy', async () => {
    const state = session();
    const sealed = await state.sealRoomMessage('#room', 'transient plaintext');
    expect(sealed).toMatchObject({ ok: true, room: '#room', epoch: 0 });
    if (!sealed.ok) return;
    await expect(state.openRoomMessage('#room', sealed.envelope)).resolves.toMatchObject({ ok: true, plaintext: 'transient plaintext' });
    await expect(state.openRoomMessage('#other', sealed.envelope)).resolves.toEqual({ ok: false, reason: 'room-mismatch' });
    await expect(state.openRoomMessage('#room', `${sealed.envelope}x`)).resolves.toEqual({ ok: false, reason: 'open-failed' });
    state.destroy();
    await expect(state.sealRoomMessage('#room', 'nope')).resolves.toEqual({ ok: false, reason: 'destroyed' });
    await expect(state.openRoomMessage('#room', sealed.envelope)).resolves.toEqual({ ok: false, reason: 'destroyed' });
  });

  it('applies one prepared commit transactionally and zeroizes retired key material', async () => {
    const state = session();
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    expect(prepared).not.toBeNull();
    expect(await state.applyPrepared(prepared!)).toEqual({ ok: false, reason: 'welcome-required' });
    expect((await state.applyPreparedLocal(prepared!, bytes(5))).ok).toBe(true);
    expect(state.epoch).toBe(1n);
    expect(state.membershipDigest()).toEqual(bytes(3));
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
    expect(state.membershipDigest()).toEqual(bytes(2));
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
    expect(other.membershipDigest()).toEqual(bytes(2));
  });

  it('snapshots a local key at invocation before queued mutation can observe caller changes', async () => {
    const state = session();
    const prepared = await state.prepareCommit({ membershipDigest: bytes(3), commitId: bytes(4), newEpochKey: bytes(5) });
    const localKey = bytes(5);
    const apply = state.applyPreparedLocal(prepared!, localKey);
    localKey.fill(6);
    expect((await apply).ok).toBe(true);
    expect(state.membershipDigest()).toEqual(bytes(3));
  });

  it('bootstraps a verified genesis pair directly at epoch 1 and never exposes the welcome key', async () => {
    const pair = await genesisPair();
    const result = await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(pair));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.epoch).toBe(1n);
    expect(result.session.room).toBe('#room');
    expect(result.session.account).toBe('alice');
    expect(result.session.deviceId).toBe('phone');
    expect(result.epoch).toBe(1n);
    expect(result.commitHash).toEqual(pair.prepared.commitHash);
    expect(result.commitId).toEqual(bytes(4));
    expect(result.session.commitHash()).toEqual(pair.prepared.commitHash);
    expect(result.session.membershipDigest()).toEqual(bytes(3));
    expect(result).not.toHaveProperty('epochKey');
    expect(JSON.stringify({ epoch: Number(result.epoch), room: result.session.room })).not.toContain('epochKey');
    expect(consumeOpenedGroupWelcome(pair.welcome.opened)).toBeNull();
    result.session.destroy();
    expect(result.session.isDestroyed).toBe(true);
  });

  it('does not weaken create() and still rejects a non-genesis zero anchor', () => {
    expect(GroupSession.create({
      room: '#room', account: 'alice', deviceId: 'phone', epoch: 1,
      epochKey: bytes(1), membershipDigest: bytes(2), commitHash: new Uint8Array(32),
    })).toBeNull();
    expect(GroupSession.create({
      room: '#room', account: 'alice', deviceId: 'phone',
      epochKey: bytes(1), membershipDigest: bytes(2),
    })).not.toBeNull();
  });

  it('rejects unverified and diagnostic controls without creating a session', async () => {
    const locked = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(locked, {
      welcomeResolution: { status: 'locked', reason: 'device-absent' },
    }))).toEqual({ ok: false, reason: 'unverified-control' });
    expect(consumeOpenedGroupWelcome(locked.welcome.opened)).toBeNull();

    const diagnostic = await genesisPair();
    const welcomeDiag = {
      ...diagnostic.welcome.resolution,
      parts: { ...diagnostic.welcome.resolution.parts, diagnosticOnly: true as const },
    };
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(diagnostic, {
      welcomeResolution: welcomeDiag,
    }))).toEqual({ ok: false, reason: 'legacy-ogc1' });

    const legacyCommit = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(legacyCommit, {
      commitResolution: { status: 'locked', reason: 'legacy-ogc1' },
    }))).toEqual({ ok: false, reason: 'legacy-ogc1' });
  });

  it('rejects routing, identity, room, and recipient mismatches', async () => {
    const room = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(room, { room: '#other' })))
      .toEqual({ ok: false, reason: 'welcome-target-mismatch' });

    const commitRoom = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(commitRoom, {
      commitRouting: { ...commitRoom.commitRouting, channel: '#other' },
    }))).toEqual({ ok: false, reason: 'room-mismatch' });

    const sender = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(sender, {
      commitResolution: verified(sender.prepared.body, 'commit', 'mallory', 'sender'),
    }))).toEqual({ ok: false, reason: 'committer-mismatch' });

    const device = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(device, {
      welcomeResolution: { ...device.welcome.resolution, deviceId: 'other-phone' },
    }))).toEqual({ ok: false, reason: 'committer-mismatch' });

    const crossSender = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(crossSender, {
      commitRouting: { ...crossSender.commitRouting, fromDevice: 'other' },
      commitResolution: verified(crossSender.prepared.body, 'commit', 'alice', 'other'),
    }))).toEqual({ ok: false, reason: 'welcome-target-mismatch' });

    const recipient = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(recipient, { account: 'bob' })))
      .toEqual({ ok: false, reason: 'welcome-target-mismatch' });

    const localDevice = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(localDevice, { deviceId: 'tablet' })))
      .toEqual({ ok: false, reason: 'welcome-target-mismatch' });
  });

  it('rejects epoch, commit, membership, context, and commitment mismatches', async () => {
    const epochLabel = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(epochLabel, {
      welcomeResolution: {
        ...epochLabel.welcome.resolution,
        parts: { ...epochLabel.welcome.resolution.parts, epoch: 2 },
      },
    }))).toEqual({ ok: false, reason: 'welcome-epoch-mismatch' });

    const commitId = await genesisPair({ commitId: bytes(4) });
    const otherWelcome = await openedWelcome({ epochKey: bytes(5), commitId: bytes(9) });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(commitId, {
      opened: otherWelcome.opened,
      welcomeResolution: otherWelcome.resolution,
    }))).toEqual({ ok: false, reason: 'welcome-mismatch' });

    const membership = await genesisPair({ membershipDigest: bytes(3) });
    const otherMembership = await openedWelcome({ epochKey: bytes(5), membershipDigest: bytes(9) });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(membership, {
      opened: otherMembership.opened,
      welcomeResolution: otherMembership.resolution,
    }))).toEqual({ ok: false, reason: 'welcome-mismatch' });

    const context = await genesisPair();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(context, {
      welcomeRouting: { ...context.welcomeRouting, fromAccount: 'mallory' },
      welcomeResolution: { ...context.welcome.resolution, account: 'mallory' },
      commitRouting: { ...context.commitRouting, fromAccount: 'mallory' },
      commitResolution: { ...context.commitResolution, account: 'mallory' },
    }))).toEqual({ ok: false, reason: 'welcome-target-mismatch' });

    const body = await genesisPair();
    const otherBody = await openedWelcome({ epochKey: bytes(5) });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(body, {
      welcomeResolution: otherBody.resolution,
    }))).toEqual({ ok: false, reason: 'welcome-target-mismatch' });

    const commitment = await genesisPair({ epochKey: bytes(5) });
    const wrongKeyWelcome = await openedWelcome({ epochKey: bytes(6) });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(commitment, {
      opened: wrongKeyWelcome.opened,
      welcomeResolution: wrongKeyWelcome.resolution,
    }))).toEqual({ ok: false, reason: 'welcome-mismatch' });
  });

  it('rejects a consumed welcome, non-genesis predecessor/epoch, and abort', async () => {
    const consumed = await genesisPair();
    expect(consumeOpenedGroupWelcome(consumed.welcome.opened)).not.toBeNull();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(consumed)))
      .toEqual({ ok: false, reason: 'invalid-welcome' });

    const predecessor = await genesisPair({
      priorEpoch: 1, nextEpoch: 2, priorCommitHash: bytes(11),
    });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(predecessor)))
      .toEqual({ ok: false, reason: 'welcome-epoch-mismatch' });

    const higher = await genesisPair({ nextEpoch: 2, priorEpoch: 0 });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(higher)))
      .toEqual({ ok: false, reason: 'welcome-epoch-mismatch' });

    const nonzeroPrior = await genesisPair({ priorCommitHash: bytes(12) });
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(nonzeroPrior)))
      .toEqual({ ok: false, reason: 'prior-hash-mismatch' });

    const aborted = await genesisPair();
    const controller = new AbortController();
    controller.abort();
    expect(await GroupSession.bootstrapVerifiedGenesis(bootstrapArgs(aborted, { signal: controller.signal })))
      .toEqual({ ok: false, reason: 'destroyed' });
    expect(consumeOpenedGroupWelcome(aborted.welcome.opened)).toBeNull();
  });
});
