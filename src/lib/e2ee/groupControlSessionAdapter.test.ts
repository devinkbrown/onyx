// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry, type GroupDeviceDirectorySnapshot } from './groupDeviceDirectory';
import { prepareGroupCommit } from './groupCommit';
import { signGroupControlPayload } from './groupControlPayload';
import { GroupSession } from './groupSession';
import { prepareGroupWelcome } from './groupWelcome';
import {
  createGroupControlSessionAdapter,
  GROUP_CONTROL_ADAPTER_MAX_PENDING_PER_SENDER,
} from './groupControlSessionAdapter';
import { createInMemoryTrustedGroupSignerStore } from './trustedGroupSigner';
import { fromB64url, toB64url } from './dmCipher';

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

async function fixture() {
  const signer = await edSigner();
  const senderEncryption = await ecdhPair();
  const recipient = await ecdhPair();
  const publicKey = encodeGroupDeviceDirectoryEntry({ signerPub: signer.publicRaw, encryptionPub: senderEncryption.publicRaw });
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
  const session = GroupSession.create({ room: '#room', account: 'alice', deviceId: 'phone', epochKey: bytes(1), membershipDigest: bytes(2) });
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
  const commitRoute = { channel: '#room', kind: 'commit' as const, fromAccount: 'alice', fromDevice: deviceId! };
  const welcomeRoute = {
    channel: '#room', kind: 'welcome' as const, fromAccount: 'alice', fromDevice: deviceId!, toAccount: 'alice', toDevice: 'phone',
  };
  const commitPayload = await signGroupControlPayload({ routing: commitRoute, epoch: 1, body: preparedCommit!.body, signerPub: signer.publicRaw, privateKey: signer.privateKey });
  const welcomePayload = await signGroupControlPayload({ routing: welcomeRoute, epoch: 1, body: preparedWelcome!.bytes, signerPub: signer.publicRaw, privateKey: signer.privateKey });
  expect(commitPayload).not.toBeNull();
  expect(welcomePayload).not.toBeNull();
  const store = createInMemoryTrustedGroupSignerStore();
  const adapter = createGroupControlSessionAdapter({
    sessionForRoom: () => session,
    directoryForAccount: () => directory,
    trustedSignerStore: store,
    recipientPrivateKeyFor: () => recipient.privateKey,
  });
  return {
    adapter,
    session: session!,
    commitLine: `:server E2EE.COMMIT #room alice ${deviceId} :${commitPayload}`,
    welcomeLine: `:server E2EE.WELCOME #room alice ${deviceId} alice phone :${welcomePayload}`,
    commitPayload: commitPayload!,
    welcomePayload: welcomePayload!,
    directory,
    signer,
    recipient,
    preparedCommit: preparedCommit!,
    preparedWelcome: preparedWelcome!,
    deviceId: deviceId!,
  };
}

async function signedWelcome(value: Awaited<ReturnType<typeof fixture>>, input: {
  room?: string;
  toAccount?: string;
  toDevice?: string;
  epoch?: number;
  commitId?: Uint8Array;
  membershipDigest?: Uint8Array;
  epochKey?: Uint8Array;
  recipientPublicRaw?: Uint8Array;
}) {
  const room = input.room ?? '#room';
  const toAccount = input.toAccount ?? 'alice';
  const toDevice = input.toDevice ?? 'phone';
  const epoch = input.epoch ?? 1;
  const commitId = input.commitId ?? bytes(4);
  const membershipDigest = input.membershipDigest ?? bytes(3);
  const prepared = await prepareGroupWelcome({
    room,
    fromAccount: 'alice',
    fromDevice: value.deviceId,
    toAccount,
    toDevice,
    epoch,
    commitId,
    membershipDigest,
    epochKey: input.epochKey ?? bytes(5),
    recipientWrapPublicKey: input.recipientPublicRaw ?? value.recipient.publicRaw,
  });
  const payload = await signGroupControlPayload({
    routing: { channel: room, kind: 'welcome', fromAccount: 'alice', fromDevice: value.deviceId, toAccount, toDevice },
    epoch,
    body: prepared!.bytes,
    signerPub: value.signer.publicRaw,
    privateKey: value.signer.privateKey,
  });
  return {
    prepared: prepared!,
    payload: payload!,
    line: `:server E2EE.WELCOME ${room} alice ${value.deviceId} ${toAccount} ${toDevice} :${payload}`,
  };
}

describe('Packet-B group control session adapter', () => {
  it('pairs welcome-before-commit and applies through one session lane', async () => {
    const value = await fixture();
    await expect(value.adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued' });
    await expect(value.adapter.accept(value.commitLine)).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    expect(value.session.epoch).toBe(1n);
    expect(value.session.currentEpochKey()).toEqual(bytes(5));
  });

  it('pairs commit-before-welcome', async () => {
    const value = await fixture();
    await expect(value.adapter.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    await expect(value.adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied' });
    expect(value.session.epoch).toBe(1n);
  });

  it('accepts canonical OGCMT2 and OGW1 bodies independent of raw/base64 body prefix', async () => {
    const value = await fixture();
    const commitBody = toB64url(value.preparedCommit.body);
    const welcomeBody = toB64url(value.preparedWelcome.bytes);
    const commitPayload = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
      epoch: 1,
      body: new TextEncoder().encode(commitBody),
      signerPub: value.signer.publicRaw,
      privateKey: value.signer.privateKey,
    });
    const welcomePayload = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: value.deviceId, toAccount: 'alice', toDevice: 'phone' },
      epoch: 1,
      body: new TextEncoder().encode(welcomeBody),
      signerPub: value.signer.publicRaw,
      privateKey: value.signer.privateKey,
    });
    await expect(value.adapter.accept(`:server E2EE.COMMIT #room alice ${value.deviceId} :${commitPayload}`)).resolves.toMatchObject({ status: 'queued' });
    await expect(value.adapter.accept(`:server E2EE.WELCOME #room alice ${value.deviceId} alice phone :${welcomePayload}`)).resolves.toMatchObject({ status: 'applied' });
  });

  it('is idempotent for exact duplicates and rejects same-key equivocation', async () => {
    const value = await fixture();
    await value.adapter.accept(value.commitLine);
    await expect(value.adapter.accept(value.commitLine)).resolves.toMatchObject({ status: 'ignored', reason: 'duplicate' });
    await value.adapter.accept(value.welcomeLine);
    await expect(value.adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'duplicate' });
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
    const conflicting = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
      epoch: 1,
      body: alternateCommit!.body,
      signerPub: value.signer.publicRaw,
      privateKey: value.signer.privateKey,
    });
    expect(conflicting).not.toBeNull();
    await expect(value.adapter.accept(`:server E2EE.COMMIT #room alice ${value.deviceId} :${conflicting}`)).resolves.toMatchObject({ status: 'rejected', reason: 'equivocation' });
  });

  it('authenticates before key-package ignore and does not call the room session', async () => {
    const value = await fixture();
    const sessionForRoom = vi.fn(() => value.session);
    const keyPackage = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'key-package', fromAccount: 'alice', fromDevice: value.deviceId },
      epoch: 1,
      body: new TextEncoder().encode('public-key-package'),
      signerPub: value.signer.publicRaw,
      privateKey: value.signer.privateKey,
    });
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await expect(adapter.accept(`:server E2EE.KEYPACKAGE #room alice ${value.deviceId} :${keyPackage}`)).resolves.toMatchObject({ status: 'ignored', reason: 'key-package' });
    expect(sessionForRoom).not.toHaveBeenCalled();
  });

  it('returns locked outcomes for malformed, legacy, incomplete, and trust failures', async () => {
    const value = await fixture();
    await expect(value.adapter.accept('not an E2EE control')).resolves.toMatchObject({ status: 'ignored' });
    const legacy = new Uint8Array(109);
    legacy.set(new TextEncoder().encode('OGC1'));
    legacy[4] = 1;
    legacy[5] = 3;
    legacy[11] = 1;
    legacy[12] = 1;
    const legacyWire = btoa(String.fromCharCode(...legacy)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
    await expect(value.adapter.accept(`:server E2EE.COMMIT #room alice ${value.deviceId} :${legacyWire}`)).resolves.toMatchObject({ status: 'locked' });
    const locked = createGroupControlSessionAdapter({
      sessionForRoom: () => value.session,
      directoryForAccount: () => null,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await expect(locked.accept(value.commitLine)).resolves.toMatchObject({ status: 'locked', reason: 'directory-incomplete' });

    const badSigner = createGroupControlSessionAdapter({
      sessionForRoom: () => value.session,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    const badRaw = fromB64url(value.commitPayload)!;
    badRaw[badRaw.length - 1] = badRaw[badRaw.length - 1]! ^ 1;
    const badWire = toB64url(badRaw);
    await expect(badSigner.accept(`:server E2EE.COMMIT #room alice ${value.deviceId} :${badWire}`)).resolves.toMatchObject({ status: 'locked' });
    const noSession = createGroupControlSessionAdapter({
      sessionForRoom: () => { throw new Error('directory lookup exploded'); },
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await noSession.accept(value.commitLine);
    await expect(noSession.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'locked', reason: 'session-unavailable' });
  });

  it('rejects wrong target, wrong recipient key, and decrypt failures without applying', async () => {
    const value = await fixture();
    const wrongTarget = await signedWelcome(value, { toAccount: 'bob', toDevice: 'tablet' });
    await value.adapter.accept(value.commitLine);
    await expect(value.adapter.accept(wrongTarget.line)).resolves.toMatchObject({ status: 'rejected', reason: 'welcome-stage-failed' });
    const wrongKeyValue = await fixture();
    const wrongKey = await ecdhPair();
    const wrongKeyAdapter = createGroupControlSessionAdapter({
      sessionForRoom: () => wrongKeyValue.session,
      directoryForAccount: () => wrongKeyValue.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => wrongKey.privateKey,
    });
    await wrongKeyAdapter.accept(wrongKeyValue.commitLine);
    await expect(wrongKeyAdapter.accept(wrongKeyValue.welcomeLine)).resolves.toMatchObject({ status: 'rejected', reason: 'welcome-open-failed' });

    const tampered = await fixture();
    const raw = tampered.preparedWelcome.bytes.slice();
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    const tamperedPayload = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: tampered.deviceId, toAccount: 'alice', toDevice: 'phone' },
      epoch: 1,
      body: raw,
      signerPub: tampered.signer.publicRaw,
      privateKey: tampered.signer.privateKey,
    });
    await tampered.adapter.accept(tampered.commitLine);
    await expect(tampered.adapter.accept(`:server E2EE.WELCOME #room alice ${tampered.deviceId} alice phone :${tamperedPayload}`)).resolves.toMatchObject({ status: 'rejected', reason: 'welcome-open-failed' });
  });

  it('does not apply after stage failure', async () => {
    const value = await fixture();
    const apply = vi.fn(async () => ({ ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) }));
    const stage = vi.fn(async () => ({ ok: false as const, reason: 'welcome-target-mismatch' as const }));
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => ({ room: '#room', account: 'alice', deviceId: 'phone', stageVerifiedWelcome: stage, applyVerifiedCommit: apply }),
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await adapter.accept(value.commitLine);
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'rejected', reason: 'welcome-stage-failed' });
    expect(stage).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it('contains a throwing stage callback and still never applies', async () => {
    const value = await fixture();
    const apply = vi.fn(async () => ({ ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) }));
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => ({
        room: '#room', account: 'alice', deviceId: 'phone',
        stageVerifiedWelcome: async () => { throw new Error('stage fault'); },
        applyVerifiedCommit: apply,
      }),
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await adapter.accept(value.commitLine);
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'rejected', reason: 'welcome-stage-failed' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('classifies an exact duplicate during apply as ignored and mutates once', async () => {
    const value = await fixture();
    let applyStarted!: () => void;
    const applyHasStarted = new Promise<void>((resolve) => { applyStarted = resolve; });
    let releaseApply!: () => void;
    const gate = new Promise<void>((resolve) => { releaseApply = resolve; });
    const apply = vi.fn(async () => {
      applyStarted();
      await gate;
      return { ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) };
    });
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => ({
        room: '#room', account: 'alice', deviceId: 'phone',
        stageVerifiedWelcome: async () => ({ ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) }),
        applyVerifiedCommit: apply,
      }),
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await adapter.accept(value.commitLine);
    const first = adapter.accept(value.welcomeLine);
    await applyHasStarted;
    const duplicate = adapter.accept(value.welcomeLine);
    releaseApply();
    await expect(first).resolves.toMatchObject({ status: 'applied' });
    await expect(duplicate).resolves.toMatchObject({ status: 'ignored', reason: 'duplicate' });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does not poison the pair cache on a transient recipient-key miss', async () => {
    const value = await fixture();
    let attempts = 0;
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => value.session,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => {
        attempts += 1;
        return attempts === 1 ? null : value.recipient.privateKey;
      },
    });
    await adapter.accept(value.commitLine);
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'locked', reason: 'recipient-key-unavailable' });
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied' });
    expect(value.session.epoch).toBe(1n);
  });

  it('requeues an ahead-epoch pair for a later exact retry', async () => {
    const value = await fixture();
    let applyAttempts = 0;
    const apply = vi.fn(async () => {
      applyAttempts += 1;
      return applyAttempts === 1
        ? { ok: false as const, reason: 'epoch-gap' as const }
        : { ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) };
    });
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => ({
        room: '#room', account: 'alice', deviceId: 'phone',
        stageVerifiedWelcome: async () => ({ ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) }),
        applyVerifiedCommit: apply,
      }),
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await adapter.accept(value.commitLine);
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'queued', reason: 'epoch-gap' });
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied' });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent complete pairs through one room lane', async () => {
    const value = await fixture();
    const secondCommit = await prepareGroupCommit({
      room: '#room',
      fromAccount: 'alice',
      fromDevice: value.deviceId,
      priorEpoch: 1,
      priorCommitHash: value.preparedCommit.commitHash,
      membershipDigest: bytes(8),
      commitId: bytes(7),
      newEpochKey: bytes(9),
      nextEpoch: 2,
    });
    const secondWelcome = await signedWelcome(value, {
      epoch: 2,
      commitId: bytes(7),
      membershipDigest: bytes(8),
      epochKey: bytes(9),
    });
    const secondCommitPayload = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
      epoch: 2,
      body: secondCommit!.body,
      signerPub: value.signer.publicRaw,
      privateKey: value.signer.privateKey,
    });
    const secondCommitLine = `:server E2EE.COMMIT #room alice ${value.deviceId} :${secondCommitPayload}`;
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => value.session,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    const results = await Promise.all([
      adapter.accept(value.commitLine),
      adapter.accept(value.welcomeLine),
      adapter.accept(secondCommitLine),
      adapter.accept(secondWelcome.line),
    ]);
    expect(results.filter((result) => result.status === 'applied')).toHaveLength(2);
    expect(value.session.epoch).toBe(2n);
  });

  it('serializes adapter callbacks even when the supplied session double has no lane', async () => {
    const value = await fixture();
    const secondCommit = await prepareGroupCommit({
      room: '#room', fromAccount: 'alice', fromDevice: value.deviceId,
      priorEpoch: 1, priorCommitHash: value.preparedCommit.commitHash,
      membershipDigest: bytes(8), commitId: bytes(7), newEpochKey: bytes(9), nextEpoch: 2,
    });
    const secondWelcome = await signedWelcome(value, { epoch: 2, commitId: bytes(7), membershipDigest: bytes(8), epochKey: bytes(9) });
    const secondCommitPayload = await signGroupControlPayload({
      routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
      epoch: 2, body: secondCommit!.body, signerPub: value.signer.publicRaw, privateKey: value.signer.privateKey,
    });
    const secondCommitLine = `:server E2EE.COMMIT #room alice ${value.deviceId} :${secondCommitPayload}`;
    let stageStarted!: () => void;
    const firstStageStarted = new Promise<void>((resolve) => { stageStarted = resolve; });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let stageCalls = 0;
    const stage = vi.fn(async () => {
      stageCalls += 1;
      if (stageCalls === 1) {
        stageStarted();
        await firstGate;
      }
      return { ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) };
    });
    const apply = vi.fn(async () => ({ ok: true as const, epoch: 1n, commitHash: bytes(6), commitId: bytes(4) }));
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => ({ room: '#room', account: 'alice', deviceId: 'phone', stageVerifiedWelcome: stage, applyVerifiedCommit: apply }),
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    await adapter.accept(value.commitLine);
    const first = adapter.accept(value.welcomeLine);
    await firstStageStarted;
    await adapter.accept(secondCommitLine);
    const second = adapter.accept(secondWelcome.line);
    await Promise.resolve();
    expect(stage).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ status: 'applied' });
    await expect(second).resolves.toMatchObject({ status: 'applied' });
    expect(stage).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest pending controls per sender and clears on destroy', async () => {
    const value = await fixture();
    const lines: string[] = [];
    for (let epoch = 1; epoch <= GROUP_CONTROL_ADAPTER_MAX_PENDING_PER_SENDER + 1; epoch += 1) {
      const prepared = await prepareGroupCommit({
        room: '#room',
        fromAccount: 'alice',
        fromDevice: value.deviceId,
        priorEpoch: epoch - 1,
        priorCommitHash: epoch === 1 ? new Uint8Array(32) : bytes(epoch + 20),
        membershipDigest: bytes(epoch + 30),
        commitId: bytes(epoch + 40),
        newEpochKey: bytes(epoch + 50),
        nextEpoch: epoch,
      });
      const payload = await signGroupControlPayload({
        routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
        epoch,
        body: prepared!.body,
        signerPub: value.signer.publicRaw,
        privateKey: value.signer.privateKey,
      });
      lines.push(`:server E2EE.COMMIT #room alice ${value.deviceId} :${payload}`);
    }
    for (const line of lines) await expect(value.adapter.accept(line)).resolves.toMatchObject({ status: 'queued' });
    await value.adapter.destroy();
    await expect(value.adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'destroyed' });
    expect(value.adapter.isDestroyed).toBe(true);
  });

  it('enforces the sender cap globally across rooms and evicts the oldest slot', async () => {
    const value = await fixture();
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: (room) => room === '#room' ? value.session : null,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    for (let index = 0; index < GROUP_CONTROL_ADAPTER_MAX_PENDING_PER_SENDER + 1; index += 1) {
      const room = `#global-${index}`;
      const payload = await signGroupControlPayload({
        routing: { channel: room, kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
        epoch: 1,
        body: value.preparedCommit.body,
        signerPub: value.signer.publicRaw,
        privateKey: value.signer.privateKey,
      });
      await expect(adapter.accept(`:server E2EE.COMMIT ${room} alice ${value.deviceId} :${payload}`))
        .resolves.toMatchObject({ status: 'queued' });
    }
    const firstWelcome = await signedWelcome(value, { room: '#global-0' });
    // If the cap were incorrectly room-scoped this would complete and reach
    // the null-session lock. Global sender scoping evicts #global-0, so the
    // welcome starts a fresh incomplete pair and remains queued.
    await expect(adapter.accept(firstWelcome.line)).resolves.toMatchObject({ status: 'queued' });
  });

  it('caps total pending controls at 64 with deterministic oldest-room eviction', async () => {
    const value = await fixture();
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: (room) => room === '#room' ? value.session : null,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
    });
    const firstRoom = '#room-0';
    for (let index = 0; index < 65; index += 1) {
      const room = `#room-${index}`;
      const payload = await signGroupControlPayload({
        routing: { channel: room, kind: 'commit', fromAccount: 'alice', fromDevice: value.deviceId },
        epoch: 1,
        body: value.preparedCommit.body,
        signerPub: value.signer.publicRaw,
        privateKey: value.signer.privateKey,
      });
      await expect(adapter.accept(`:server E2EE.COMMIT ${room} alice ${value.deviceId} :${payload}`)).resolves.toMatchObject({ status: 'queued' });
    }
    const firstWelcome = await signedWelcome(value, { room: firstRoom });
    // The first room was evicted; its welcome starts a fresh, incomplete pair
    // instead of reaching the null-session path for an existing pair.
    await expect(adapter.accept(firstWelcome.line)).resolves.toMatchObject({ status: 'queued' });
  });

  it('never exposes payload bytes, plaintext, or key material in outcomes', async () => {
    const value = await fixture();
    const first = await value.adapter.accept(value.commitLine);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(value.commitPayload);
    expect(serialized).not.toContain('epochKey');
    expect(serialized).not.toContain('plaintext');
    expect(serialized).not.toContain('privateKey');
  });

  it('destroy rejects an in-flight pair and clears its transient lane', async () => {
    const value = await fixture();
    let keyRequested!: () => void;
    const requested = new Promise<void>((resolve) => { keyRequested = resolve; });
    let releaseKey!: (key: CryptoKey) => void;
    const heldKey = new Promise<CryptoKey>((resolve) => { releaseKey = resolve; });
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => value.session,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => {
        keyRequested();
        return heldKey;
      },
    });
    await adapter.accept(value.commitLine);
    const welcomePromise = adapter.accept(value.welcomeLine);
    await requested;
    const destroying = adapter.destroy();
    releaseKey(value.recipient.privateKey);
    await destroying;
    await expect(welcomePromise).resolves.toMatchObject({ status: 'ignored', reason: 'destroyed' });
    expect(value.adapter.isDestroyed).toBe(false);
    expect(adapter.isDestroyed).toBe(true);
  });

  it('bootstraps a missing session exactly once and never also applies the pair', async () => {
    const value = await fixture();
    const adopted: GroupSession[] = [];
    const bootstrap = vi.spyOn(GroupSession, 'bootstrapVerifiedGenesis');
    const apply = vi.spyOn(GroupSession.prototype, 'applyVerifiedPair');
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => null,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
      localIdentity: { account: 'alice', deviceId: 'phone' },
      adoptBootstrappedSession: (session) => {
        adopted.push(session);
        return true;
      },
    });
    await expect(adapter.accept(value.commitLine)).resolves.toMatchObject({ status: 'queued' });
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'applied', room: '#room', epoch: 1 });
    expect(adopted).toHaveLength(1);
    expect(adopted[0]?.epoch).toBe(1n);
    expect(adopted[0]?.currentEpochKey()).toEqual(bytes(5));
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'duplicate' });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    adopted[0]?.destroy();
    bootstrap.mockRestore();
    apply.mockRestore();
  });

  it('does not apply bootstrap when adopt rejects, and destroys the new session', async () => {
    const value = await fixture();
    let created: GroupSession | undefined;
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => null,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
      localIdentity: { account: 'alice', deviceId: 'phone' },
      adoptBootstrappedSession: (session) => {
        created = session;
        return false;
      },
    });
    await adapter.accept(value.commitLine);
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({ status: 'ignored', reason: 'stale' });
    expect(created).toBeDefined();
    expect(created?.isDestroyed).toBe(true);
  });

  it('rejects a local-identity mismatch before transferring a bootstrapped session', async () => {
    const value = await fixture();
    const adopt = vi.fn(() => true);
    const adapter = createGroupControlSessionAdapter({
      sessionForRoom: () => null,
      directoryForAccount: () => value.directory,
      trustedSignerStore: createInMemoryTrustedGroupSignerStore(),
      recipientPrivateKeyFor: () => value.recipient.privateKey,
      localIdentity: { account: 'bob', deviceId: 'tablet' },
      adoptBootstrappedSession: adopt,
    });
    await adapter.accept(value.commitLine);
    await expect(adapter.accept(value.welcomeLine)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'welcome-stage-failed',
    });
    expect(adopt).not.toHaveBeenCalled();
  });
});
