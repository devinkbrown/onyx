// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  deriveGroupDeviceId,
  encodeGroupDeviceDirectoryEntry,
  type GroupDeviceDirectorySnapshot,
} from './groupDeviceDirectory';
import { prepareGroupCommit } from './groupCommit';
import {
  createGroupControlRuntime,
  GROUP_CONTROL_RUNTIME_MAX_REGISTRY,
  GROUP_CONTROL_RUNTIME_MAX_SESSIONS,
  type GroupControlRuntime,
} from './groupControlRuntime';
import { GroupSession } from './groupSession';
import { prepareGroupWelcome } from './groupWelcome';
import { signGroupControlPayload } from './groupControlPayload';
import { createInMemoryTrustedGroupSignerStore } from './trustedGroupSigner';
import { toB64url } from './dmCipher';

const bytes = (value: number, length = 32) => new Uint8Array(length).fill(value);

async function edSigner(): Promise<{ privateKey: CryptoKey; publicRaw: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

async function ecdhPair(): Promise<{ privateKey: CryptoKey; publicRaw: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

type Fixture = {
  signer: Awaited<ReturnType<typeof edSigner>>;
  recipient: Awaited<ReturnType<typeof ecdhPair>>;
  directory: GroupDeviceDirectorySnapshot;
  session: GroupSession;
  commitLine: string;
  welcomeLine: string;
  commitPayload: string;
  welcomePayload: string;
  deviceId: string;
  commitBody: Uint8Array;
  welcomeBody: Uint8Array;
  commitHash: Uint8Array;
};

let runtimeSequence = 0;

async function fixture(): Promise<Fixture> {
  const signer = await edSigner();
  const senderEncryption = await ecdhPair();
  const recipient = await ecdhPair();
  const publicKey = encodeGroupDeviceDirectoryEntry({
    signerPub: signer.publicRaw,
    encryptionPub: senderEncryption.publicRaw,
  });
  expect(publicKey).not.toBeNull();
  const deviceId = await deriveGroupDeviceId(publicKey!);
  expect(deviceId).not.toBeNull();
  const row = {
    account: 'alice',
    deviceId: deviceId!,
    algorithm: 'onyx-ogc1-v1',
    publicKey: publicKey!,
    directoryKey: toB64url(signer.publicRaw),
    trusted: true,
    legacy: false,
    entry: { signerPub: signer.publicRaw, encryptionPub: senderEncryption.publicRaw },
  };
  const directory: GroupDeviceDirectorySnapshot = {
    account: 'alice',
    devices: [row],
    trusted: [row],
    bySigner: new Map([[row.directoryKey, row]]),
  };
  const session = GroupSession.create({
    room: '#room',
    account: 'alice',
    deviceId: 'phone',
    epochKey: bytes(1),
    membershipDigest: bytes(2),
  });
  expect(session).not.toBeNull();
  const preparedCommit = await prepareGroupCommit({
    room: '#room',
    fromAccount: 'alice',
    fromDevice: deviceId!,
    priorEpoch: 0,
    priorCommitHash: new Uint8Array(32),
    membershipDigest: bytes(3),
    commitId: bytes(4),
    newEpochKey: bytes(5),
  });
  expect(preparedCommit).not.toBeNull();
  const preparedWelcome = await prepareGroupWelcome({
    room: '#room',
    fromAccount: 'alice',
    fromDevice: deviceId!,
    toAccount: 'alice',
    toDevice: 'phone',
    epoch: 1,
    commitId: bytes(4),
    membershipDigest: bytes(3),
    epochKey: bytes(5),
    recipientWrapPublicKey: recipient.publicRaw,
  });
  expect(preparedWelcome).not.toBeNull();
  const commitPayload = await signGroupControlPayload({
    routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: deviceId! },
    epoch: 1,
    body: preparedCommit!.body,
    signerPub: signer.publicRaw,
    privateKey: signer.privateKey,
  });
  const welcomePayload = await signGroupControlPayload({
    routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: deviceId!, toAccount: 'alice', toDevice: 'phone' },
    epoch: 1,
    body: preparedWelcome!.bytes,
    signerPub: signer.publicRaw,
    privateKey: signer.privateKey,
  });
  expect(commitPayload).not.toBeNull();
  expect(welcomePayload).not.toBeNull();
  return {
    signer,
    recipient,
    directory,
    session: session!,
    commitPayload: commitPayload!,
    welcomePayload: welcomePayload!,
    commitBody: preparedCommit!.body,
    welcomeBody: preparedWelcome!.bytes,
    commitHash: preparedCommit!.commitHash,
    deviceId: deviceId!,
    commitLine: `:server E2EE.COMMIT #room alice ${deviceId} :${commitPayload}`,
    welcomeLine: `:server E2EE.WELCOME #room alice ${deviceId} alice phone :${welcomePayload}`,
  };
}

async function epochTwoPair(value: Fixture): Promise<{ commitLine: string; welcomeLine: string }> {
  const commit = await prepareGroupCommit({ room: '#room', fromAccount: 'alice', fromDevice: value.deviceId, priorEpoch: 1, priorCommitHash: value.commitHash, membershipDigest: bytes(13), commitId: bytes(14), newEpochKey: bytes(15) });
  const welcome = await prepareGroupWelcome({ room: '#room', fromAccount: 'alice', fromDevice: value.deviceId, toAccount: 'alice', toDevice: 'phone', epoch: 2, commitId: bytes(14), membershipDigest: bytes(13), epochKey: bytes(15), recipientWrapPublicKey: value.recipient.publicRaw });
  const commitPayload = await signGroupControlPayload({ routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId }, epoch: 2, body: commit!.body, signerPub: value.signer.publicRaw, privateKey: value.signer.privateKey });
  const welcomePayload = await signGroupControlPayload({ routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: value.deviceId, toAccount: 'alice', toDevice: 'phone' }, epoch: 2, body: welcome!.bytes, signerPub: value.signer.publicRaw, privateKey: value.signer.privateKey });
  return { commitLine: `:server E2EE.COMMIT #room alice ${value.deviceId} :${commitPayload}`, welcomeLine: `:server E2EE.WELCOME #room alice ${value.deviceId} alice phone :${welcomePayload}` };
}

async function roomPair(value: Fixture, room: string): Promise<{ commitLine: string; welcomeLine: string }> {
  const commit = await prepareGroupCommit({
    room,
    fromAccount: 'alice',
    fromDevice: value.deviceId,
    priorEpoch: 0,
    priorCommitHash: new Uint8Array(32),
    membershipDigest: bytes(3),
    commitId: bytes(4),
    newEpochKey: bytes(5),
  });
  const welcome = await prepareGroupWelcome({
    room,
    fromAccount: 'alice',
    fromDevice: value.deviceId,
    toAccount: 'alice',
    toDevice: 'phone',
    epoch: 1,
    commitId: bytes(4),
    membershipDigest: bytes(3),
    epochKey: bytes(5),
    recipientWrapPublicKey: value.recipient.publicRaw,
  });
  const commitPayload = await signGroupControlPayload({
    routing: { channel: room, kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
    epoch: 1,
    body: commit!.body,
    signerPub: value.signer.publicRaw,
    privateKey: value.signer.privateKey,
  });
  const welcomePayload = await signGroupControlPayload({
    routing: { channel: room, kind: 'welcome', fromAccount: 'alice', fromDevice: value.deviceId, toAccount: 'alice', toDevice: 'phone' },
    epoch: 1,
    body: welcome!.bytes,
    signerPub: value.signer.publicRaw,
    privateKey: value.signer.privateKey,
  });
  return {
    commitLine: `:server E2EE.COMMIT ${room} alice ${value.deviceId} :${commitPayload}`,
    welcomeLine: `:server E2EE.WELCOME ${room} alice ${value.deviceId} alice phone :${welcomePayload}`,
  };
}

function runtimeFor(value: Fixture, extra: Partial<Parameters<typeof createGroupControlRuntime>[0]> = {}): GroupControlRuntime {
  return createGroupControlRuntime({
    identity: {
      clientId: `runtime-${++runtimeSequence}`,
      endpoint: 'wss://eshmaki.me',
      account: 'alice',
      deviceId: 'phone',
    },
    directoryForAccount: () => value.directory,
    trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
    recipientPrivateKeyFor: () => value.recipient.privateKey,
    ...extra,
  });
}

async function waitApplied(session: GroupSession, runtime: GroupControlRuntime, room = '#room'): Promise<void> {
  await vi.waitFor(() => {
    expect(session.epoch).toBe(1n);
    expect(runtime.state.rooms.find((entry) => entry.room === room)).toMatchObject({
      status: 'control-applied',
      provisioned: true,
      epoch: 1,
    });
  });
}

async function expectUnapplied(session: GroupSession, runtime: GroupControlRuntime, room = '#room'): Promise<void> {
  const apply = vi.spyOn(session, 'applyVerifiedPair');
  await new Promise<void>((resolve) => setTimeout(resolve, 75));
  expect(apply).not.toHaveBeenCalled();
  expect(session.isDestroyed || session.epoch === 0n).toBe(true);
  expect(runtime.state.rooms.find((entry) => entry.room === room)?.status).not.toBe('control-applied');
}

async function completeGenesis(runtime: GroupControlRuntime, value: Fixture, order: 'commit-first' | 'welcome-first' = 'commit-first') {
  const first = order === 'commit-first' ? value.commitLine : value.welcomeLine;
  const second = order === 'commit-first' ? value.welcomeLine : value.commitLine;
  await expect(runtime.accept(first)).resolves.toMatchObject({ status: 'queued', room: '#room' });
  await expect(runtime.accept(second)).resolves.toMatchObject({
    status: 'applied',
    room: '#room',
    epoch: 1,
  });
}

async function completeHigherEpoch(runtime: GroupControlRuntime, value: Fixture) {
  const second = await epochTwoPair(value);
  await expect(runtime.accept(second.commitLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
  await expect(runtime.accept(second.welcomeLine)).resolves.toMatchObject({
    status: 'locked',
    reason: 'recovery-required',
    room: '#room',
    epoch: 2,
  });
  return second;
}

async function startBlockedGenesis(value: Fixture, extra: Partial<Parameters<typeof createGroupControlRuntime>[0]> = {}) {
  let release!: () => void;
  let started!: () => void;
  let directoryCalls = 0;
  const startedP = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runtime = runtimeFor(value, {
    ...extra,
    directoryForAccount: async () => {
      directoryCalls += 1;
      started();
      await gate;
      return value.directory;
    },
  });
  return {
    runtime,
    release: () => { release(); },
    started: startedP,
    directoryCalls: () => directoryCalls,
  };
}

async function waitGenesisApplied(runtime: GroupControlRuntime, room = '#room'): Promise<void> {
  await vi.waitFor(() => {
    expect(runtime.state.rooms.find((entry) => entry.room === room)).toMatchObject({
      status: 'control-applied',
      provisioned: true,
      epoch: 1,
    });
    expect(runtime.state.sessionCount).toBeGreaterThanOrEqual(1);
    expect(runtime.state.activation).toBe('active');
  });
}

async function divergentCommitLine(value: Fixture): Promise<string> {
  const alternateCommit = await prepareGroupCommit({
    room: '#room',
    fromAccount: 'alice',
    fromDevice: value.deviceId,
    priorEpoch: 0,
    priorCommitHash: new Uint8Array(32),
    membershipDigest: bytes(9),
    commitId: bytes(4),
    newEpochKey: bytes(6),
  });
  const alternatePayload = await signGroupControlPayload({
    routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
    epoch: 1,
    body: alternateCommit!.body,
    signerPub: value.signer.publicRaw,
    privateKey: value.signer.privateKey,
  });
  return `:server E2EE.COMMIT #room alice ${value.deviceId} :${alternatePayload}`;
}

async function divergentWelcomeLine(value: Fixture): Promise<string> {
  const alternateWelcome = await prepareGroupWelcome({
    room: '#room',
    fromAccount: 'alice',
    fromDevice: value.deviceId,
    toAccount: 'alice',
    toDevice: 'phone',
    epoch: 1,
    commitId: bytes(7),
    membershipDigest: bytes(8),
    epochKey: bytes(6),
    recipientWrapPublicKey: value.recipient.publicRaw,
  });
  const alternatePayload = await signGroupControlPayload({
    routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: value.deviceId, toAccount: 'alice', toDevice: 'phone' },
    epoch: 1,
    body: alternateWelcome!.bytes,
    signerPub: value.signer.publicRaw,
    privateKey: value.signer.privateKey,
  });
  return `:server E2EE.WELCOME #room alice ${value.deviceId} alice phone :${alternatePayload}`;
}

describe('Packet-B group-control runtime', () => {
  it('exposes message crypto only for a live control-applied room session', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    await expect(runtime.sealRoomMessage('#room', 'before')).resolves.toMatchObject({ ok: false, reason: 'session-not-provisioned' });
    await completeGenesis(runtime, value);
    await waitGenesisApplied(runtime);
    const sealed = await runtime.sealRoomMessage('#room', 'transient plaintext');
    expect(sealed).toMatchObject({ ok: true, status: 'sealed', room: '#room', epoch: 1 });
    if (sealed.ok) await expect(runtime.openRoomMessage('#room', sealed.envelope)).resolves.toMatchObject({ ok: true, status: 'opened', plaintext: 'transient plaintext' });
    await expect(runtime.openRoomMessage('#other', sealed.ok ? sealed.envelope : 'bad')).resolves.toMatchObject({ ok: false, reason: 'session-not-provisioned' });
    runtime.onRoomPart('#room');
    await expect(runtime.sealRoomMessage('#room', 'after part')).resolves.toMatchObject({ ok: false, reason: 'session-not-provisioned' });
    await runtime.destroy();
  });

  it('never reports ready when identity or trust substrate is missing', async () => {
    const pending = createGroupControlRuntime({
      identity: { clientId: 'pending-client', endpoint: 'wss://node' },
    });
    expect(pending.state.lifecycle).toBe('identity-pending');
    await expect(pending.accept('not a control')).resolves.toMatchObject({ status: 'locked', reason: 'identity-pending' });
    await pending.destroy();

    const locked = createGroupControlRuntime({
      identity: { clientId: 'locked-client', endpoint: 'wss://node', account: 'alice', deviceId: 'phone' },
    });
    expect(locked.state.lifecycle).toBe('recovery-required');
    await expect(locked.accept('not a control')).resolves.toMatchObject({ status: 'locked', reason: 'trust-path-unreachable' });
    await locked.destroy();
  });

  it('bootstraps a verified genesis pair and activates message protection', async () => {
    const value = await fixture();
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    const runtime = runtimeFor(value);
    await completeGenesis(runtime, value);
    await waitGenesisApplied(runtime);
    expect(runtime.activationHeld).toBe(false);
    expect(runtime.state.activation).toBe('active');
    expect(runtime.state.sessionCount).toBe(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(value.session.epoch).toBe(0n);
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(JSON.stringify(runtime.state)).not.toContain(value.welcomePayload);
    bootstrap.mockRestore();
    apply.mockRestore();
    await runtime.destroy();
  });

  it('applies a genesis pair exactly once and does not double-apply on the same session', async () => {
    const value = await fixture();
    let directoryCalls = 0;
    const runtime = runtimeFor(value, {
      directoryForAccount: () => {
        directoryCalls += 1;
        return value.directory;
      },
    });
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    await completeGenesis(runtime, value, 'commit-first');
    await waitGenesisApplied(runtime);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(directoryCalls).toBeGreaterThan(0);
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(JSON.stringify(runtime.state)).not.toContain(value.welcomePayload);
    bootstrap.mockRestore();
    apply.mockRestore();
    await runtime.destroy();
  });

  it('bootstraps welcome-then-commit the same way and coalesces exact duplicates', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    await completeGenesis(runtime, value, 'welcome-first');
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await waitGenesisApplied(runtime);
    expect(apply).not.toHaveBeenCalled();
    apply.mockRestore();
    await runtime.destroy();
  });

  it('marks a divergent pair as equivocation after genesis bootstrap', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    await completeGenesis(runtime, value);
    await expect(runtime.accept(await divergentCommitLine(value)))
      .resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      status: 'rejected',
      provisioned: true,
    });
    expect(runtime.state.activation).toBe('hold');
    await runtime.destroy();
  });

  it('does not let a later welcome complete a divergent commit-before-welcome half-pair', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const apply = vi.spyOn(value.session, 'applyVerifiedPair');
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
    await expect(runtime.accept(await divergentCommitLine(value)))
      .resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true, room: '#room', replaced: false });
    await expectUnapplied(value.session, runtime);
    expect(apply).not.toHaveBeenCalled();
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      status: 'rejected',
      provisioned: true,
    });
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(JSON.stringify(runtime.state)).not.toContain(value.welcomePayload);
    await runtime.destroy();
  });

  it('does not let a later commit complete a divergent welcome-before-commit half-pair', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const apply = vi.spyOn(value.session, 'applyVerifiedPair');
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
    await expect(runtime.accept(await divergentWelcomeLine(value)))
      .resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true, room: '#room', replaced: false });
    await expectUnapplied(value.session, runtime);
    expect(apply).not.toHaveBeenCalled();
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      status: 'rejected',
      provisioned: true,
    });
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(JSON.stringify(runtime.state)).not.toContain(value.welcomePayload);
    await runtime.destroy();
  });

  it('does not bind a bootstrapped genesis session onto the wrong room or identity tuple', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    await completeGenesis(runtime, value);
    await waitGenesisApplied(runtime);
    const other = GroupSession.create({
      room: '#other',
      account: 'alice',
      deviceId: 'phone',
      epochKey: bytes(1),
      membershipDigest: bytes(2),
    });
    expect(other).not.toBeNull();
    expect(runtime.registerProvisionedSession(other!)).toMatchObject({ ok: true, room: '#other', replaced: false });
    await expectUnapplied(other!, runtime, '#other');
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      status: 'control-applied',
      provisioned: true,
      epoch: 1,
    });
    const foreign = GroupSession.create({
      room: '#room',
      account: 'bob',
      deviceId: 'tablet',
      epochKey: bytes(1),
      membershipDigest: bytes(2),
    });
    expect(foreign).not.toBeNull();
    expect(runtime.registerProvisionedSession(foreign!)).toMatchObject({ ok: false, reason: 'identity-mismatch' });
    expect(other!.epoch).toBe(0n);
    await runtime.destroy();
  });

  it('does not consume the job queue for a higher-epoch pair without a session', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value, { maxQueue: 1 });
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    await completeHigherEpoch(runtime, value);
    expect(runtime.state.queueDepth).toBe(0);
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      status: 'recovery-required',
      provisioned: false,
      epoch: 2,
    });
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(apply).not.toHaveBeenCalled();
    apply.mockRestore();
    await runtime.destroy();
  });

  it('invalidates a bootstrapped genesis session when a replacement is registered', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    await completeGenesis(runtime, value);
    await waitGenesisApplied(runtime);
    const replacement = GroupSession.create({
      room: '#room',
      account: 'alice',
      deviceId: 'phone',
      epochKey: bytes(7),
      membershipDigest: bytes(8),
    });
    expect(replacement).not.toBeNull();
    expect(runtime.registerProvisionedSession(replacement!)).toMatchObject({ ok: true, replaced: true });
    await expectUnapplied(replacement!, runtime);
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      provisioned: true,
    });
    await runtime.destroy();
  });

  it('releases retained higher-epoch pairs on PART, KICK, disconnect, identity switch, destroy, and TTL', async () => {
    const value = await fixture();

    const partedSession = GroupSession.create({
      room: '#room',
      account: 'alice',
      deviceId: 'phone',
      epochKey: bytes(2),
      membershipDigest: bytes(3),
    });
    expect(partedSession).not.toBeNull();
    const parted = runtimeFor(value);
    await completeHigherEpoch(parted, value);
    parted.onRoomPart('#room');
    expect(parted.registerProvisionedSession(partedSession!)).toMatchObject({ ok: true });
    await expectUnapplied(partedSession!, parted);
    await parted.destroy();

    const kickedSession = GroupSession.create({
      room: '#room',
      account: 'alice',
      deviceId: 'phone',
      epochKey: bytes(3),
      membershipDigest: bytes(4),
    });
    expect(kickedSession).not.toBeNull();
    const kicked = runtimeFor(value);
    await completeHigherEpoch(kicked, value);
    kicked.onRoomKick('#room');
    expect(kicked.registerProvisionedSession(kickedSession!)).toMatchObject({ ok: true });
    await expectUnapplied(kickedSession!, kicked);
    await kicked.destroy();

    const disconnectedSession = GroupSession.create({
      room: '#room',
      account: 'alice',
      deviceId: 'phone',
      epochKey: bytes(5),
      membershipDigest: bytes(6),
    });
    expect(disconnectedSession).not.toBeNull();
    const disconnected = runtimeFor(value);
    await completeHigherEpoch(disconnected, value);
    disconnected.reconnect();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(disconnected.markRecovered()).toBe(true);
    expect(disconnected.registerProvisionedSession(disconnectedSession!)).toMatchObject({ ok: true });
    await expectUnapplied(disconnectedSession!, disconnected);
    await disconnected.destroy();

    const switchedSession = GroupSession.create({
      room: '#room',
      account: 'bob',
      deviceId: 'tablet',
      epochKey: bytes(1),
      membershipDigest: bytes(2),
    });
    expect(switchedSession).not.toBeNull();
    const switched = runtimeFor(value);
    await completeHigherEpoch(switched, value);
    await expect(switched.setIdentity({
      clientId: 'switched-client',
      endpoint: 'wss://other',
      account: 'bob',
      deviceId: 'tablet',
    })).resolves.toBe(true);
    expect(switched.registerProvisionedSession(value.session)).toMatchObject({ ok: false, reason: 'identity-mismatch' });
    expect(switched.registerProvisionedSession(switchedSession!)).toMatchObject({ ok: true });
    await expectUnapplied(switchedSession!, switched);
    expect(JSON.stringify(switched.state)).not.toContain(value.commitPayload);
    await switched.destroy();

    const destroyed = runtimeFor(value);
    await completeHigherEpoch(destroyed, value);
    await destroyed.destroy();
    expect(destroyed.registerProvisionedSession(value.session)).toMatchObject({ ok: false, reason: 'runtime-inactive' });
    expect(JSON.stringify(destroyed.state)).not.toContain(value.commitPayload);
    expect(JSON.stringify(destroyed.state)).not.toContain(value.welcomePayload);

    let clock = 1000;
    const expiredSession = GroupSession.create({
      room: '#room',
      account: 'alice',
      deviceId: 'phone',
      epochKey: bytes(8),
      membershipDigest: bytes(9),
    });
    expect(expiredSession).not.toBeNull();
    const expiring = runtimeFor(value, { now: () => clock, halfPairTtlMs: 10 });
    await completeHigherEpoch(expiring, value);
    clock += 20;
    expiring.expire();
    expect(expiring.state.counters.expired).toBe(1);
    expect(expiring.registerProvisionedSession(expiredSession!)).toMatchObject({ ok: true });
    await expectUnapplied(expiredSession!, expiring);
    await expiring.destroy();
  });

  it('does not publish a late bootstrap apply after kick or destroy', async () => {
    const value = await fixture();
    let releaseDirectory!: () => void;
    let directoryStarted!: () => void;
    const started = new Promise<void>((resolve) => { directoryStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseDirectory = resolve; });
    const runtime = runtimeFor(value, {
      directoryForAccount: async () => {
        directoryStarted();
        await gate;
        return value.directory;
      },
    });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    const pending = runtime.accept(value.welcomeLine);
    await started;
    runtime.onRoomKick('#room');
    releaseDirectory();
    await expect(pending).resolves.toMatchObject({ status: 'ignored' });
    expect(runtime.state.rooms).toHaveLength(0);
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(runtime.state.sessionCount).toBe(0);
    await runtime.destroy();

    let lateRelease!: () => void;
    let lateStarted!: () => void;
    const lateStart = new Promise<void>((resolve) => { lateStarted = resolve; });
    const lateGate = new Promise<void>((resolve) => { lateRelease = resolve; });
    const late = runtimeFor(value, {
      directoryForAccount: async () => {
        lateStarted();
        await lateGate;
        return value.directory;
      },
    });
    await expect(late.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    const latePending = late.accept(value.welcomeLine);
    await lateStart;
    const destroying = late.destroy();
    lateRelease();
    await expect(latePending).resolves.toMatchObject({ status: 'ignored' });
    await destroying;
    expect(late.state.lifecycle).toBe('inactive');
    expect(JSON.stringify(late.state)).not.toContain(value.welcomePayload);
    expect(late.state.sessionCount).toBe(0);
  });

  it('applies a complete pair through exactly the registered GroupSession', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    expect(runtime.registerProvisionedSession(value.session)).toEqual({ ok: true, room: '#room', replaced: false });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    expect(value.session.epoch).toBe(1n);
    expect(runtime.state.rooms).toEqual([{ room: '#room', status: 'control-applied', provisioned: true, epoch: 1 }]);
    await runtime.destroy();
  });

  it('rejects fake sessions, identity mismatches, destroyed sessions, and caps registry at 64', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    expect(runtime.registerProvisionedSession({} as GroupSession)).toMatchObject({ ok: false, reason: 'invalid-session' });
    const wrong = GroupSession.create({ room: '#wrong', account: 'bob', deviceId: 'tablet', epochKey: bytes(1), membershipDigest: bytes(2) });
    expect(wrong).not.toBeNull();
    expect(runtime.registerProvisionedSession(wrong!)).toMatchObject({ ok: false, reason: 'identity-mismatch' });
    const destroyed = GroupSession.create({ room: '#destroyed', account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
    destroyed!.destroy();
    expect(runtime.registerProvisionedSession(destroyed!)).toMatchObject({ ok: false, reason: 'invalid-session' });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    for (let index = 1; index < GROUP_CONTROL_RUNTIME_MAX_SESSIONS; index += 1) {
      const session = GroupSession.create({ room: `#room-${index}`, account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
      expect(session).not.toBeNull();
      expect(runtime.registerProvisionedSession(session!)).toMatchObject({ ok: true });
    }
    const overflow = GroupSession.create({ room: '#overflow', account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
    expect(runtime.registerProvisionedSession(overflow!)).toMatchObject({ ok: false, reason: 'session-capacity' });
    expect(runtime.state.sessionCount).toBe(GROUP_CONTROL_RUNTIME_MAX_SESSIONS);
    await runtime.destroy();
  });

  it('coalesces duplicates, marks equivocation, and expires half-pairs on an injected clock', async () => {
    const value = await fixture();
    let clock = 1000;
    const runtime = runtimeFor(value, { now: () => clock, halfPairTtlMs: 10 });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(runtime.accept(`@label=outer-variant :different.server E2EE.COMMIT #room alice ${value.deviceId} :${value.commitPayload}`))
      .resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(runtime.accept(await divergentCommitLine(value)))
      .resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    clock += 20;
    runtime.expire();
    expect(runtime.state.counters.expired).toBe(1);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued' });
    expect(value.session.epoch).toBe(0n);
    await runtime.destroy();
  });

  it('increments generation synchronously, destroys on reconnect, and guards late completion', async () => {
    const value = await fixture();
    let releaseDirectory!: () => void;
    const entered = new Promise<void>((resolve) => { releaseDirectory = resolve; });
    let directoryStarted!: () => void;
    const started = new Promise<void>((resolve) => { directoryStarted = resolve; });
    const runtime = runtimeFor(value, {
      directoryForAccount: async () => {
        directoryStarted();
        await entered;
        return value.directory;
      },
    });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    const pending = runtime.accept(value.welcomeLine);
    await started;
    const before = runtime.generation;
    const detached = runtime.detach();
    expect(runtime.generation).toBe(before + 1);
    expect(runtime.state.lifecycle).toBe('inactive');
    releaseDirectory();
    await detached;
    await expect(pending).resolves.toMatchObject({ status: 'ignored', reason: 'runtime-inactive' });
    expect(runtime.isDetached).toBe(true);
    await runtime.destroy();

    const reconnecting = runtimeFor(value);
    reconnecting.reconnect();
    expect(reconnecting.state.lifecycle).toBe('recovery-required');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(reconnecting.state.lifecycle).toBe('recovery-required');
    expect(reconnecting.markRecovered()).toBe(true);
    expect(reconnecting.state.lifecycle).toBe('ready');
    await reconnecting.destroy();
  });

  it('keeps registry ownership unique when switching the identity tuple', async () => {
    const value = await fixture();
    const options = {
      identity: { clientId: 'registry-client', endpoint: 'wss://eshmaki.me', account: 'alice', deviceId: 'phone' },
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    };
    const first = createGroupControlRuntime(options);
    const same = createGroupControlRuntime(options);
    expect(same).toBe(first);
    await expect(first.setIdentity({ clientId: 'registry-client', endpoint: 'wss://other', account: 'bob', deviceId: 'tablet' })).resolves.toBe(true);
    const acquiredNew = createGroupControlRuntime({
      ...options,
      identity: { clientId: 'registry-client', endpoint: 'wss://other', account: 'bob', deviceId: 'tablet' },
    });
    expect(acquiredNew).toBe(first);
    const acquiredOld = createGroupControlRuntime(options);
    expect(acquiredOld).not.toBe(first);
    await acquiredOld.destroy();
    await first.destroy();
  });

  it('suppresses in-flight completion and prevents a removed room from being resurrected', async () => {
    const value = await fixture();
    let releaseDirectory!: () => void;
    let directoryStarted!: () => void;
    const started = new Promise<void>((resolve) => { directoryStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseDirectory = resolve; });
    const runtime = runtimeFor(value, {
      directoryForAccount: async () => {
        directoryStarted();
        await gate;
        return value.directory;
      },
    });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    const applying = runtime.accept(value.welcomeLine);
    await started;
    runtime.onRoomKick('#room');
    expect(runtime.state.rooms).toHaveLength(0);
    releaseDirectory();
    await expect(applying).resolves.toMatchObject({ status: 'ignored', reason: 'room-removed' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const replacement = GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
    expect(replacement).not.toBeNull();
    expect(runtime.registerProvisionedSession(replacement!)).toMatchObject({ ok: true });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued' });
    expect(replacement!.epoch).toBe(0n);
    await runtime.destroy();
  });

  it('keeps another room pending/appliable when one room is PARTed', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const other = GroupSession.create({ room: '#other', account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
    expect(other).not.toBeNull();
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    expect(runtime.registerProvisionedSession(other!)).toMatchObject({ ok: true });
    const controls = await roomPair(value, '#other');
    await expect(runtime.accept(controls.commitLine)).resolves.toMatchObject({ status: 'queued', room: '#other' });
    runtime.onRoomPart('#room');
    expect(runtime.state.rooms.find((room) => room.room === '#other')).toMatchObject({ status: 'pair-pending', provisioned: true });
    await expect(runtime.accept(controls.welcomeLine)).resolves.toMatchObject({ status: 'applied', room: '#other', epoch: 1 });
    expect(other!.epoch).toBe(1n);
    await runtime.destroy();
  });

  it('removes PART/KICK rooms, supports account/device switching, and never projects secrets', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    expect(runtime.state.rooms[0]?.room).toBe('#room');
    runtime.onRoomPart('#room');
    expect(runtime.state.rooms).toHaveLength(0);
    const generation = runtime.generation;
    const switched = runtime.setIdentity({ clientId: 'new-client', endpoint: 'wss://other', account: 'bob', deviceId: 'tablet' });
    expect(runtime.generation).toBe(generation + 1);
    expect(runtime.state.lifecycle).toBe('inactive');
    await expect(switched).resolves.toBe(true);
    expect(runtime.state.identity).toMatchObject({ clientId: 'new-client', endpoint: 'wss://other', account: 'bob', deviceId: 'tablet' });
    expect(runtime.state.activation).toBe('hold');
    const safe = JSON.stringify(runtime.state);
    expect(safe).not.toContain(value.commitPayload);
    expect(safe).not.toContain(value.welcomePayload);
    expect(safe).not.toContain('commitId');
    await runtime.destroy();
  });

  it('keeps counters bounded and listener snapshots immutable by copy', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value, { maxQueue: 1 });
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    expect(listener).toHaveBeenCalled();
    const snapshot = runtime.getState();
    snapshot.counters.accepted = Number.MAX_SAFE_INTEGER;
    expect(runtime.state.counters.accepted).not.toBe(Number.MAX_SAFE_INTEGER);
    unsubscribe();
    await runtime.destroy();
  });

  it('keeps destroy terminal across same-tick reconnect and identity commands', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const generation = runtime.generation;
    runtime.reconnect();
    const switching = runtime.setIdentity({ clientId: 'terminal-client', endpoint: 'wss://other', account: 'bob', deviceId: 'tablet' });
    const destroying = runtime.destroy();
    expect(runtime.isDestroyed).toBe(true);
    expect(runtime.isDetached).toBe(true);
    expect(runtime.state.lifecycle).toBe('inactive');
    expect(runtime.generation).toBeGreaterThan(generation);
    await expect(switching).resolves.toBe(false);
    await destroying;
    expect(runtime.markRecovered()).toBe(false);
    await expect(runtime.setIdentity({ clientId: 'revive', endpoint: 'wss://x', account: 'alice', deviceId: 'phone' })).resolves.toBe(false);
    runtime.reconnect();
    expect(runtime.isDestroyed).toBe(true);
  });

  it('does not apply an admitted job to a replacement GroupSession after directory release', async () => {
    const value = await fixture();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = runtimeFor(value, {
      directoryForAccount: async () => {
        started();
        await gate;
        return value.directory;
      },
    });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    const pending = runtime.accept(value.welcomeLine);
    await started;
    const replacement = GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epochKey: bytes(7), membershipDigest: bytes(8) });
    expect(replacement).not.toBeNull();
    expect(runtime.registerProvisionedSession(replacement!)).toMatchObject({ ok: true, replaced: true });
    release();
    await expect(pending).resolves.toMatchObject({ status: 'ignored', reason: 'room-removed' });
    expect(value.session.epoch).toBe(0n);
    expect(replacement!.epoch).toBe(0n);
    await runtime.destroy();
  });

  it('holds explicit room capacity and does not let unknown PART names grow metadata', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    for (let index = 0; index < 64; index += 1) {
      const session = GroupSession.create({ room: `#capacity-${index}`, account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
      expect(session).not.toBeNull();
      expect(runtime.registerProvisionedSession(session!)).toMatchObject({ ok: true });
    }
    expect(runtime.state.sessionCount).toBe(64);
    expect(runtime.state.rooms).toHaveLength(64);
    for (let index = 0; index < 100; index += 1) runtime.onRoomPart(`#unknown-${index}`);
    expect(runtime.state.rooms).toHaveLength(64);
    const extra = await roomPair(value, '#beyond-cap');
    await expect(runtime.accept(extra.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'queue-full' });
    expect(runtime.state.rooms).toHaveLength(64);
    await runtime.destroy();
  });

  it('filters foreign welcomes and isolates observer failures', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const throwing = vi.fn(() => { throw new Error('observer'); });
    const healthy = vi.fn();
    runtime.subscribe(throwing);
    runtime.subscribe(healthy);
    expect(throwing).toHaveBeenCalledTimes(1);
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    expect(healthy).toHaveBeenCalled();
    const foreign = await prepareGroupWelcome({
      room: '#room',
      fromAccount: 'alice',
      fromDevice: value.deviceId,
      toAccount: 'bob',
      toDevice: 'tablet',
      epoch: 1,
      commitId: bytes(4),
      membershipDigest: bytes(3),
      epochKey: bytes(5),
      recipientWrapPublicKey: value.recipient.publicRaw,
    });
    const foreignPayload = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: value.deviceId, toAccount: 'bob', toDevice: 'tablet' },
      epoch: 1,
      body: foreign!.bytes,
      signerPub: value.signer.publicRaw,
      privateKey: value.signer.privateKey,
    });
    await expect(runtime.accept(`:other E2EE.WELCOME #room alice ${value.deviceId} bob tablet :${foreignPayload}`)).resolves.toMatchObject({ status: 'ignored', reason: 'foreign-recipient' });
    expect(runtime.state.rooms[0]?.status).toBe('pair-pending');
    await runtime.destroy();
    const count = healthy.mock.calls.length;
    await runtime.accept(value.commitLine);
    expect(healthy.mock.calls.length).toBe(count);
  });

  it('aborts a hanging transport directory request and admits work on the new generation', async () => {
    const value = await fixture();
    let calls = 0;
    let firstSignal!: AbortSignal;
    let directoryStarted!: () => void;
    const started = new Promise<void>((resolve) => { directoryStarted = resolve; });
    const runtime = runtimeFor(value, {
      directoryForAccount: undefined,
      transport: {
        isConnected: () => true,
        requestDirectory: async (_account, signal) => {
          calls += 1;
          if (calls === 1) {
            firstSignal = signal;
            directoryStarted();
            return await new Promise<GroupDeviceDirectorySnapshot>(() => undefined);
          }
          return value.directory;
        },
      },
    });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    const pending = runtime.accept(value.welcomeLine);
    await started;

    runtime.reconnect();
    await expect(pending).resolves.toMatchObject({ status: 'ignored', reason: 'runtime-inactive' });
    expect(firstSignal.aborted).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(runtime.state.lifecycle).toBe('recovery-required');
    expect(runtime.markRecovered()).toBe(true);

    const replacement = GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epochKey: bytes(7), membershipDigest: bytes(8) });
    expect(replacement).not.toBeNull();
    expect(runtime.registerProvisionedSession(replacement!)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied', room: '#room' });
    expect(calls).toBeGreaterThan(1);
    expect(replacement!.epoch).toBe(1n);
    await runtime.destroy();
  });

  it('keeps the transitional registry owner canonical and makes the last identity switch win', async () => {
    const value = await fixture();
    let releaseKey!: () => void;
    let keyStarted!: () => void;
    const keyGate = new Promise<void>((resolve) => { releaseKey = resolve; });
    const started = new Promise<void>((resolve) => { keyStarted = resolve; });
    const store = createInMemoryTrustedGroupSignerStore();
    const base = { clientId: 'overlap-runtime', endpoint: 'wss://eshmaki.me', account: 'alice', deviceId: 'phone' };
    const firstTarget = { clientId: 'overlap-runtime', endpoint: 'wss://first', account: 'bob', deviceId: 'tablet' };
    const secondTarget = { clientId: 'overlap-runtime', endpoint: 'wss://second', account: 'carol', deviceId: 'laptop' };
    const runtime = runtimeFor(value, {
      identity: base,
      trustedSignerStore: store,
      recipientPrivateKeyFor: async () => {
        keyStarted();
        await keyGate;
        return value.recipient.privateKey;
      },
    });
    const options = {
      directoryForAccount: () => value.directory,
      trustedSignerStore: store,
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    };
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    const pending = runtime.accept(value.welcomeLine);
    await started;

    const firstSwitch = runtime.setIdentity(firstTarget);
    expect(runtime.state.lifecycle).toBe('inactive');
    expect(createGroupControlRuntime({ ...options, identity: base })).toBe(runtime);
    const reservedFirst = createGroupControlRuntime({ ...options, identity: firstTarget });
    expect(reservedFirst).not.toBe(runtime);
    expect(reservedFirst.state.lifecycle).toBe('inactive');
    const secondSwitch = runtime.setIdentity(secondTarget);
    const reservedSecond = createGroupControlRuntime({ ...options, identity: secondTarget });
    expect(reservedSecond).not.toBe(runtime);
    expect(reservedSecond.state.lifecycle).toBe('inactive');

    releaseKey();
    await expect(pending).resolves.toMatchObject({ status: 'ignored', reason: 'runtime-inactive' });
    await expect(firstSwitch).resolves.toBe(false);
    await expect(secondSwitch).resolves.toBe(true);
    expect(runtime.state.identity).toMatchObject(secondTarget);
    expect(createGroupControlRuntime({ ...options, identity: secondTarget })).toBe(runtime);

    const oldOwner = createGroupControlRuntime({ ...options, identity: base });
    expect(oldOwner).not.toBe(runtime);
    await oldOwner.destroy();
    await runtime.destroy();
  });

  it('does not register incomplete identities or consume tuple capacity', async () => {
    const pending = Array.from({ length: GROUP_CONTROL_RUNTIME_MAX_REGISTRY }, (_, index) => createGroupControlRuntime({
      identity: {
        clientId: `incomplete-${index}`,
        endpoint: 'wss://pending',
        account: null,
        deviceId: null,
      },
    }));
    expect(new Set(pending).size).toBe(GROUP_CONTROL_RUNTIME_MAX_REGISTRY);
    const complete = createGroupControlRuntime({
      identity: {
        clientId: 'incomplete-valid',
        endpoint: 'wss://pending',
        account: 'alice',
        deviceId: 'phone',
      },
    });
    expect(complete.state.lifecycle).toBe('recovery-required');
    await Promise.all(pending.map((runtime) => runtime.destroy()));
    await complete.destroy();
  });

  it('keeps tuple generations monotonic across terminal destroy and reacquire', async () => {
    const identity = {
      clientId: 'generation-tombstone',
      endpoint: 'wss://generation',
      account: 'alice',
      deviceId: 'phone',
    };
    const first = createGroupControlRuntime({ identity });
    const firstGeneration = first.generation;
    await first.destroy();
    expect(first.isDestroySettled).toBe(true);
    const second = createGroupControlRuntime({ identity });
    expect(second).not.toBe(first);
    expect(second.generation).toBeGreaterThan(firstGeneration);
    await second.destroy();
  });

  it('commits one last target at full registry capacity without leaking aliases', async () => {
    const live: GroupControlRuntime[] = [];
    let base: GroupControlRuntime | null = null;
    const targetOne = {
      clientId: 'capacity-switch',
      endpoint: 'wss://target-one',
      account: 'bob',
      deviceId: 'tablet',
    };
    const targetTwo = {
      clientId: 'capacity-switch',
      endpoint: 'wss://target-two',
      account: 'carol',
      deviceId: 'laptop',
    };
    try {
      for (let index = 0; index < GROUP_CONTROL_RUNTIME_MAX_REGISTRY - 1; index += 1) {
        live.push(createGroupControlRuntime({
          identity: {
            clientId: `switch-live-${index}`,
            endpoint: 'wss://switch-live',
            account: 'alice',
            deviceId: 'phone',
          },
        }));
      }
      base = createGroupControlRuntime({
        identity: {
          clientId: 'capacity-switch',
          endpoint: 'wss://base',
          account: 'alice',
          deviceId: 'phone',
        },
      });
      const first = base.setIdentity(targetOne);
      const targetOneDuring = createGroupControlRuntime({ identity: targetOne });
      expect(targetOneDuring).not.toBe(base);
      expect(targetOneDuring.state.lifecycle).toBe('inactive');
      const second = base.setIdentity(targetTwo);
      const targetTwoDuring = createGroupControlRuntime({ identity: targetTwo });
      expect(targetTwoDuring).not.toBe(base);
      expect(targetTwoDuring.state.lifecycle).toBe('inactive');
      await expect(first).resolves.toBe(false);
      await expect(second).resolves.toBe(true);
      expect(base.state.identity).toMatchObject(targetTwo);
      expect(createGroupControlRuntime({ identity: targetTwo })).toBe(base);
      const targetOneAfter = createGroupControlRuntime({ identity: targetOne });
      expect(targetOneAfter).not.toBe(base);
      expect(targetOneAfter.state.lifecycle).toBe('inactive');
    } finally {
      await Promise.all(live.map((runtime) => runtime.destroy()));
      if (base) await base.destroy();
    }
  });

  it('returns a bounded inert runtime when the global tuple registry is full', async () => {
    const runtimes: GroupControlRuntime[] = [];
    let overflow: GroupControlRuntime | null = null;
    try {
      for (let index = 0; index < GROUP_CONTROL_RUNTIME_MAX_REGISTRY; index += 1) {
        runtimes.push(createGroupControlRuntime({
          identity: {
            clientId: `capacity-${index}`,
            endpoint: 'wss://capacity',
            account: 'alice',
            deviceId: 'phone',
          },
        }));
      }
      expect(new Set(runtimes).size).toBe(GROUP_CONTROL_RUNTIME_MAX_REGISTRY);
      overflow = createGroupControlRuntime({
        identity: {
          clientId: 'capacity-overflow',
          endpoint: 'wss://capacity',
          account: 'alice',
          deviceId: 'phone',
        },
      });
      expect(overflow.state.lifecycle).toBe('inactive');
      await expect(overflow.accept('not a control')).resolves.toMatchObject({ status: 'ignored', reason: 'runtime-capacity' });
      expect(createGroupControlRuntime({
        identity: {
          clientId: 'capacity-overflow',
          endpoint: 'wss://capacity',
          account: 'alice',
          deviceId: 'phone',
        },
      })).toBe(overflow);
    } finally {
      await Promise.all(runtimes.map((runtime) => runtime.destroy()));
      if (overflow) await overflow.destroy();
    }
    const recycled = createGroupControlRuntime({
      identity: {
        clientId: 'capacity-recycled',
        endpoint: 'wss://capacity',
        account: 'alice',
        deviceId: 'phone',
      },
    });
    expect(recycled.state.lifecycle).toBe('recovery-required');
    await recycled.destroy();
  });

  it('settles and releases adapter work after many completed room jobs', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    try {
      for (let index = 0; index < 130; index += 1) {
        const session = GroupSession.create({
          room: '#room',
          account: 'alice',
          deviceId: 'phone',
          epochKey: bytes(index + 1),
          membershipDigest: bytes(index + 2),
        });
        expect(session).not.toBeNull();
        expect(runtime.registerProvisionedSession(session!)).toMatchObject({ ok: true });
        await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
        await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied', room: '#room' });
        runtime.onRoomPart('#room');
      }
      expect(runtime.state.queueDepth).toBe(0);
      expect(runtime.state.sessionCount).toBe(0);
    } finally {
      await runtime.destroy();
    }
    expect(runtime.isDestroySettled).toBe(true);
    expect(runtime.state.queueDepth).toBe(0);
  });

  it('expires idle retained controls before a late registration and retains canonical raw bytes', async () => {
    const value = await fixture();
    let clock = 10;
    const runtime = runtimeFor(value, { now: () => clock, halfPairTtlMs: 5 });
    const mutable = {
      raw: value.commitLine,
      command: 'E2EE.WELCOME',
      params: ['#wrong', 'mallory', 'wrong', 'mallory', 'wrong', 'not-the-raw-payload'],
      prefix: 'server', tags: {}, nick: null, host: null,
    } as never;
    await expect(runtime.accept(mutable)).resolves.toMatchObject({ status: 'queued' });
    // Caller-owned parsed objects may be reused/mutated after acceptance.
    (mutable as { raw: string; params: string[] }).raw = ':bad E2EE.COMMIT #room alice broken :bad';
    (mutable as { params: string[] }).params.splice(0);
    clock += 10;
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued' });
    expect(value.session.epoch).toBe(0n);
    expect(runtime.state.counters.expired).toBe(1);
    await runtime.destroy();
  });

  it('coalesces exact post-apply retransmissions and quarantines divergent completed controls', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied' });
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    expect(JSON.stringify(runtime.state)).not.toContain(value.welcomePayload);
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(runtime.accept(await divergentCommitLine(value))).resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    expect(value.session.epoch).toBe(1n);
    await runtime.destroy();
  });

  it('tears down retained recipient-key retries across a generation boundary', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value, { recipientPrivateKeyFor: () => null });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'locked', reason: 'recipient-key-unavailable' });
    expect(runtime.state.queueDepth).toBe(1);
    runtime.reconnect();
    expect(runtime.state.queueDepth).toBe(0);
    expect(JSON.stringify(runtime.state)).not.toContain(value.commitPayload);
    await runtime.destroy();
  });

  it('bounds retained recipient-key retries with deterministic oldest eviction', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value, { maxQueue: 1, recipientPrivateKeyFor: () => null });
    const other = GroupSession.create({ room: '#other', account: 'alice', deviceId: 'phone', epochKey: bytes(9), membershipDigest: bytes(9) });
    expect(other).not.toBeNull();
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    expect(runtime.registerProvisionedSession(other!)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ reason: 'recipient-key-unavailable' });
    const second = await roomPair(value, '#other');
    await runtime.accept(second.commitLine);
    await expect(runtime.accept(second.welcomeLine)).resolves.toMatchObject({ reason: 'queue-full' });
    expect(runtime.state.queueDepth).toBe(1);
    expect(runtime.state.counters.evicted).toBeGreaterThanOrEqual(1);
    await runtime.destroy();
  });

  it('clears completed fingerprints on PART so a clean rejoin can accept the same control', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied' });
    runtime.onRoomPart('#room');
    const rejoined = GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epochKey: bytes(8), membershipDigest: bytes(8) });
    expect(rejoined).not.toBeNull();
    expect(runtime.registerProvisionedSession(rejoined!)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied' });
    expect(rejoined!.epoch).toBe(1n);
    await runtime.destroy();
  });

  it('retries only a retained recipient-key failure when the key becomes available', async () => {
    const value = await fixture();
    let available = false;
    const runtime = runtimeFor(value, { recipientPrivateKeyFor: () => available ? value.recipient.privateKey : null });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ reason: 'recipient-key-unavailable' });
    available = true;
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await waitApplied(value.session, runtime);
    await runtime.destroy();
  });

  it('never retains directory or trust failures as retry work', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value, { directoryForAccount: () => null });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'locked', reason: 'directory-incomplete' });
    expect(runtime.state.queueDepth).toBe(0);
    await runtime.destroy();
  });

  it('expires retained retry state on its TTL', async () => {
    const value = await fixture();
    let clock = 1;
    const runtime = runtimeFor(value, { now: () => clock, halfPairTtlMs: 5, recipientPrivateKeyFor: () => null });
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(value.commitLine);
    await runtime.accept(value.welcomeLine);
    expect(runtime.state.queueDepth).toBe(1);
    clock += 10;
    runtime.expire();
    expect(runtime.state.queueDepth).toBe(0);
    expect(runtime.state.counters.expired).toBeGreaterThanOrEqual(1);
    await runtime.destroy();
  });

  it('keeps one epoch-gap successor while a maxQueue=1 predecessor applies', async () => {
    const value = await fixture();
    const second = await epochTwoPair(value);
    const runtime = runtimeFor(value, { maxQueue: 1 });
    const apply = vi.spyOn(value.session, 'applyVerifiedPair');
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true });
    await runtime.accept(second.commitLine);
    await expect(runtime.accept(second.welcomeLine)).resolves.toMatchObject({ status: 'queued', reason: 'epoch-gap', epoch: 2 });
    await runtime.accept(value.commitLine);
    await expect(runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied', epoch: 1 });
    await vi.waitFor(() => expect(value.session.epoch).toBe(2n));
    const applied = apply.mock.calls.length;
    await expect(runtime.accept(second.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(runtime.accept(second.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    expect(apply).toHaveBeenCalledTimes(applied);
    expect(runtime.state.queueDepth).toBeLessThanOrEqual(2); // one active predecessor plus one retained successor
    await runtime.destroy();
  });

  it('invalidates an in-flight genesis ticket on PART, identity switch, disconnect, and destroy', async () => {
    const value = await fixture();

    const startInFlight = async () => {
      let release!: () => void;
      let started!: () => void;
      const startedP = new Promise<void>((resolve) => { started = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const runtime = runtimeFor(value, {
        directoryForAccount: async () => {
          started();
          await gate;
          return value.directory;
        },
      });
      await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
      const pending = runtime.accept(value.welcomeLine);
      await startedP;
      return { runtime, pending, release };
    };

    const parted = await startInFlight();
    parted.runtime.onRoomPart('#room');
    parted.release();
    await expect(parted.pending).resolves.toMatchObject({ status: 'ignored' });
    expect(parted.runtime.state.sessionCount).toBe(0);
    expect(parted.runtime.state.rooms.find((entry) => entry.room === '#room')?.status).not.toBe('control-applied');
    await parted.runtime.destroy();

    const switched = await startInFlight();
    const switching = switched.runtime.setIdentity({
      clientId: 'ticket-switch',
      endpoint: 'wss://other',
      account: 'bob',
      deviceId: 'tablet',
    });
    switched.release();
    await expect(switched.pending).resolves.toMatchObject({ status: 'ignored' });
    await expect(switching).resolves.toBe(true);
    expect(switched.runtime.state.sessionCount).toBe(0);
    await switched.runtime.destroy();

    const disconnected = await startInFlight();
    disconnected.runtime.reconnect();
    disconnected.release();
    await expect(disconnected.pending).resolves.toMatchObject({ status: 'ignored' });
    expect(disconnected.runtime.state.sessionCount).toBe(0);
    await disconnected.runtime.destroy();

    const destroyed = await startInFlight();
    const destroying = destroyed.runtime.destroy();
    destroyed.release();
    await expect(destroyed.pending).resolves.toMatchObject({ status: 'ignored' });
    await destroying;
    expect(destroyed.runtime.state.sessionCount).toBe(0);
  });

  it('keeps only one session when a provisioned session arrives during genesis bootstrap', async () => {
    const value = await fixture();
    let release!: () => void;
    let started!: () => void;
    const startedP = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = runtimeFor(value, {
      directoryForAccount: async () => {
        started();
        await gate;
        return value.directory;
      },
    });
    await expect(runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    const pending = runtime.accept(value.welcomeLine);
    await startedP;
    expect(runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true, room: '#room' });
    release();
    await expect(pending).resolves.toMatchObject({ status: 'ignored', reason: 'stale' });
    expect(runtime.state.sessionCount).toBe(1);
    expect(value.session.isDestroyed).toBe(false);
    expect(value.session.epoch).toBe(0n);
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')?.status).not.toBe('control-applied');
    await runtime.destroy();
  });

  it('coalesces exact in-flight genesis retransmissions onto one reserved bootstrap', async () => {
    const value = await fixture();
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    const blocked = await startBlockedGenesis(value);
    await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
    const pending = blocked.runtime.accept(value.welcomeLine);
    await blocked.started;
    blocked.runtime.expire();
    await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(blocked.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(blocked.runtime.accept(`@label=inflight-dup :other.server E2EE.COMMIT #room alice ${value.deviceId} :${value.commitPayload}`))
      .resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    expect(bootstrap).not.toHaveBeenCalled();
    blocked.release();
    await expect(pending).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    await waitGenesisApplied(blocked.runtime);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(blocked.directoryCalls()).toBe(2);
    expect(blocked.runtime.state.sessionCount).toBe(1);
    await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(blocked.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(blocked.runtime.state.sessionCount).toBe(1);
    bootstrap.mockRestore();
    apply.mockRestore();
    await blocked.runtime.destroy();
  });

  it('coalesces reordered in-flight genesis parts without a second bootstrap', async () => {
    const value = await fixture();
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    const blocked = await startBlockedGenesis(value);
    await expect(blocked.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
    const pending = blocked.runtime.accept(value.commitLine);
    await blocked.started;
    await expect(blocked.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(blocked.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    expect(bootstrap).not.toHaveBeenCalled();
    blocked.release();
    await expect(pending).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    await waitGenesisApplied(blocked.runtime);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(blocked.directoryCalls()).toBe(2);
    expect(blocked.runtime.state.sessionCount).toBe(1);
    bootstrap.mockRestore();
    apply.mockRestore();
    await blocked.runtime.destroy();
  });

  it('rejects divergent in-flight commit/welcome without replacing the reservation', async () => {
    const value = await fixture();
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    const blocked = await startBlockedGenesis(value);
    await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued', room: '#room' });
    const pending = blocked.runtime.accept(value.welcomeLine);
    await blocked.started;
    await expect(blocked.runtime.accept(await divergentCommitLine(value)))
      .resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    await expect(blocked.runtime.accept(await divergentWelcomeLine(value)))
      .resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
    await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    await expect(blocked.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
    expect(bootstrap).not.toHaveBeenCalled();
    blocked.release();
    await expect(pending).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    await waitGenesisApplied(blocked.runtime);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(blocked.directoryCalls()).toBe(2);
    expect(blocked.runtime.state.sessionCount).toBe(1);
    bootstrap.mockRestore();
    apply.mockRestore();
    await blocked.runtime.destroy();
  });

  it('clears in-flight reservations on teardown and allows a subsequent valid retry', async () => {
    const value = await fixture();
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    try {
    const startInFlight = async () => {
      const blocked = await startBlockedGenesis(value);
      await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
      const pending = blocked.runtime.accept(value.welcomeLine);
      await blocked.started;
      await expect(blocked.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'coalesced' });
      return { ...blocked, pending };
    };

    const parted = await startInFlight();
    parted.runtime.onRoomPart('#room');
    parted.release();
    await expect(parted.pending).resolves.toMatchObject({ status: 'ignored' });
    expect(parted.runtime.state.sessionCount).toBe(0);
    await completeGenesis(parted.runtime, value);
    await waitGenesisApplied(parted.runtime);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(parted.runtime.state.sessionCount).toBe(1);
    await parted.runtime.destroy();

    const kicked = await startInFlight();
    kicked.runtime.onRoomKick('#room');
    kicked.release();
    await expect(kicked.pending).resolves.toMatchObject({ status: 'ignored' });
    expect(kicked.runtime.state.sessionCount).toBe(0);
    await kicked.runtime.destroy();

    const disconnected = await startInFlight();
    disconnected.runtime.reconnect();
    disconnected.release();
    await expect(disconnected.pending).resolves.toMatchObject({ status: 'ignored' });
    expect(disconnected.runtime.state.sessionCount).toBe(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(disconnected.runtime.markRecovered()).toBe(true);
    await completeGenesis(disconnected.runtime, value);
    await waitGenesisApplied(disconnected.runtime);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(disconnected.runtime.state.sessionCount).toBe(1);
    await disconnected.runtime.destroy();

    const switched = await startInFlight();
    const switching = switched.runtime.setIdentity({
      clientId: 'inflight-switch',
      endpoint: 'wss://other',
      account: 'bob',
      deviceId: 'tablet',
    });
    switched.release();
    await expect(switched.pending).resolves.toMatchObject({ status: 'ignored' });
    await expect(switching).resolves.toBe(true);
    expect(switched.runtime.state.sessionCount).toBe(0);
    await expect(switched.runtime.setIdentity({
      clientId: 'inflight-switch-back',
      endpoint: 'wss://eshmaki.me',
      account: 'alice',
      deviceId: 'phone',
    })).resolves.toBe(true);
    expect(switched.runtime.markRecovered()).toBe(true);
    await completeGenesis(switched.runtime, value);
    await waitGenesisApplied(switched.runtime);
    expect(bootstrap).toHaveBeenCalledTimes(3);
    expect(switched.runtime.state.sessionCount).toBe(1);
    await switched.runtime.destroy();

    const replaced = await startInFlight();
    expect(replaced.runtime.registerProvisionedSession(value.session)).toMatchObject({ ok: true, room: '#room' });
    replaced.release();
    await expect(replaced.pending).resolves.toMatchObject({ status: 'ignored', reason: 'stale' });
    expect(replaced.runtime.state.sessionCount).toBe(1);
    await expect(replaced.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    await expect(replaced.runtime.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    expect(value.session.epoch).toBe(1n);
    expect(replaced.runtime.state.sessionCount).toBe(1);
    await replaced.runtime.destroy();

    const destroyed = await startInFlight();
    const destroying = destroyed.runtime.destroy();
    destroyed.release();
    await expect(destroyed.pending).resolves.toMatchObject({ status: 'ignored' });
    await destroying;
    expect(destroyed.runtime.state.sessionCount).toBe(0);
    await expect(destroyed.runtime.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'runtime-inactive' });

    // Three adopted genesis retries plus the doomed in-flight bootstrap that
    // already started before room replacement; only the provisioned session
    // is applied afterward.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(4);
    } finally {
      bootstrap.mockRestore();
      apply.mockRestore();
    }
  });

  it('recovers a retained higher-epoch pair only after genesis bootstrap creates the room session', async () => {
    const value = await fixture();
    const runtime = runtimeFor(value);
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    await completeHigherEpoch(runtime, value);
    expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
      status: 'recovery-required',
      provisioned: false,
      epoch: 2,
    });
    expect(apply).not.toHaveBeenCalled();
    await completeGenesis(runtime, value);
    await vi.waitFor(() => {
      expect(runtime.state.rooms.find((entry) => entry.room === '#room')).toMatchObject({
        status: 'control-applied',
        provisioned: true,
        epoch: 2,
      });
    });
    expect(apply).toHaveBeenCalled();
    expect(runtime.state.activation).toBe('active');
    apply.mockRestore();
    await runtime.destroy();
  });
});
