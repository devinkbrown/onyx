import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPrivateCryptoProvider, type PrivateCryptoDeps } from './private-crypto-provider';
import type { AccountId, ConversationId, OwnerSnapshot } from './contracts';
import type { LocalOwnerGrant as WorkspaceOwnerGrant } from './local-workspace-owner';
import { createLocalWorkspaceOwner, localOwnerStableKey } from './local-workspace-owner';
import { GROUP_COMMIT_HASH_BYTES, GROUP_COMMIT_ID_BYTES, GROUP_COMMIT_KEY_BYTES, prepareGroupCommit } from '../../src/lib/e2ee/groupCommit';
import { prepareGroupWelcome } from '../../src/lib/e2ee/groupWelcome';
import { signGroupControlPayload } from '../../src/lib/e2ee/groupControlPayload';
import { sealGroupMessage } from '../../src/lib/e2ee/groupEnvelope';
import { deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry, type GroupDeviceDirectorySnapshot } from '../../src/lib/e2ee/groupDeviceDirectory';
import { toB64url } from '../../src/lib/e2ee/dmCipher';
import { buildMembershipDigest, type VerifiedGroupDirectory } from './group-directory-trust';
import { encryptPortableGroupBackup, type PortableGroupBackup } from './crypto-backup';

const owner: OwnerSnapshot = {
  networkId: 'net' as OwnerSnapshot['networkId'], accountId: null,
  accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-1' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-1' as OwnerSnapshot['ownerRef'],
};
const identityPurposes: PrivateCryptoDeps['identityPurposes'] = {
  async proveAccount() { return null; }, async verifyServerProof() { return false; }, async verifyTrustedDevice() { return false; },
};
const deps = (): PrivateCryptoDeps => ({
  transport: { ownerSnapshot: () => owner, isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef, sendLine: () => ({ kind: 'blocked', reason: 'offline' }), sendLineGroup: ({ lines }) => lines.map(() => ({ kind: 'blocked' as const, reason: 'offline' as const })), sendBinary: () => ({ kind: 'blocked', reason: 'offline' }), onAuthenticatedServerEvent: () => ({ dispose() {} }), onPrivateIngress: () => ({ dispose() {} }), onBinary: () => ({ dispose() {} }), dispose() {} },
  conversationKeyScheme: () => null,
  ownerSnapshot: () => owner, isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef,
  indexedDB: null, configuredNetwork: (networkId) => networkId === owner.networkId,
  canonicalConversationKey: (_owner, conversation) => conversation,
  conversationPolicy: () => ({ revision: 'r1', encryption: 'plain', eligible: true, room: null, epoch: null }),
  authorizePurpose: () => true, identityPurposes,
  async ensureRegisteredDevice() { return false; }, resolvePeerConversation: () => null,
  directoryRevision: () => null, async authenticatedDirectory() { return null; }, conversationForRoom: () => null,
  roomMembershipFacts: () => null, resolveMediaPeer: async () => null,
  freshGenesisFact: async () => null,
  authorizeGroupAuthor: () => false, authorizeRemoteGroupAuthor: () => false, setRoomSendGate: () => undefined,
  async readBackupPassword() { return null; },
  async writePrivateBackupSelection() { return false; }, async readPrivateImport() { return null; },
  async readPrivatePassword() { return null; },
  authorizeRemovalIntent: async () => false,
});

describe('private crypto provider', () => {
  it('derives accepted-head observations from authenticated room facts without re-entering policy', () => {
    const authenticatedOwner: OwnerSnapshot = { ...owner, accountId: 'acct' as AccountId };
    const input = deps();
    let policyReads = 0;
    const provider = createPrivateCryptoProvider({
      ...input,
      ownerSnapshot: () => authenticatedOwner,
      isCurrent: (candidate) => candidate.ownerRef === authenticatedOwner.ownerRef,
      conversationPolicy: () => { policyReads += 1; throw new Error('accepted-head lookup re-entered policy'); },
      roomMembershipFacts: () => ({
        owner: authenticatedOwner, target: '#ROOM' as ConversationId, canonicalTarget: '#room', scheme: 'rfc1459',
        mappingGeneration: 1, membershipGeneration: 1, complete: true, memberCount: 1,
        memberAccounts: ['acct' as AccountId], members: [], joined: true,
        mappingRevision: 'irc-casemapping-v1:rfc1459',
      }),
    });
    expect(provider.groupProviders.currentAcceptedHead(authenticatedOwner, '#ROOM' as ConversationId)).toBeNull();
    expect(policyReads).toBe(0);
    provider.dispose();
  });

  it('does not return a room plaintext when the owner retires during real async decryption', async () => {
    const indexedDB = new IDBFactory();
    const liveOwner: OwnerSnapshot = { ...owner, accountId: 'alice' as AccountId };
    const conversationId = '#room' as ConversationId;
    const mappingRevision = 'irc-casemapping-v1:rfc1459';
    const enrolled: { current: { deviceId: string; signerPublicKey: Uint8Array; wrappingPublicKey: Uint8Array } | null } = { current: null };
    let directorySnapshot: GroupDeviceDirectorySnapshot | null = null;
    let releaseDecrypt: () => void = () => undefined;
    let restoreDecrypt: (() => void) | null = null;
    const decryptedClearBytes: { current: Uint8Array | null } = { current: null };
    const provider = createPrivateCryptoProvider({
      ...deps(), indexedDB,
      ownerSnapshot: () => liveOwner,
      isCurrent: (candidate) => candidate.ownerRef === liveOwner.ownerRef,
      ensureRegisteredDevice: async (_candidate, deviceId, signerPublicKey, wrappingPublicKey) => {
        enrolled.current = { deviceId, signerPublicKey: signerPublicKey.slice(), wrappingPublicKey: wrappingPublicKey.slice() };
        return true;
      },
      conversationPolicy: () => ({ revision: 'room-policy-v1', encryption: 'room-required', eligible: true, room: '#room', epoch: 1 }),
      conversationForRoom: (_candidate, room) => room === '#room' ? conversationId : null,
      directoryRevision: (_candidate, target) => target === conversationId ? 'directory-v1' : null,
      authenticatedDirectory: async (_candidate, accountId) => directorySnapshot && accountId === liveOwner.accountId
        ? { owner: liveOwner, accountId, revision: 'directory-v1', provenance: 'authenticated-exact-server', trusted: false, snapshot: directorySnapshot }
        : null,
      roomMembershipFacts: (_candidate, target) => target === conversationId ? {
        owner: liveOwner, target: conversationId, canonicalTarget: '#room', scheme: 'rfc1459', mappingGeneration: 1,
        membershipGeneration: 1, complete: true, memberCount: 1, memberAccounts: [liveOwner.accountId!], members: [],
        sourceRevision: 'membership-v1', joined: true, mappingRevision,
      } : null,
      authorizeRemoteGroupAuthor: () => true,
    });

    try {
      expect(await provider.ensureEnrolledIdentity(liveOwner)).toBe(true);
      expect(enrolled.current).not.toBeNull();
      const local = enrolled.current;
      if (!local) throw new Error('provider did not expose its enrolled public identity to the registration adapter');

      const remoteSigner = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
      const remoteWrapping = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
      const remoteSignerPublic = new Uint8Array(await crypto.subtle.exportKey('raw', remoteSigner.publicKey));
      const remoteWrappingPublic = new Uint8Array(await crypto.subtle.exportKey('raw', remoteWrapping.publicKey));
      const makeRecord = (deviceId: string, signerPublicKey: Uint8Array, wrappingPublicKey: Uint8Array) => {
        const entry = { signerPub: signerPublicKey.slice(), encryptionPub: wrappingPublicKey.slice() };
        const publicKey = encodeGroupDeviceDirectoryEntry(entry);
        expect(publicKey).not.toBeNull();
        return {
          account: 'alice', deviceId, algorithm: 'onyx-ogc1-v1', publicKey: publicKey!,
          directoryKey: toB64url(entry.signerPub), trusted: true, legacy: false, entry,
        };
      };
      const localRecord = makeRecord(local.deviceId, local.signerPublicKey, local.wrappingPublicKey);
      const remotePublicKey = encodeGroupDeviceDirectoryEntry({ signerPub: remoteSignerPublic, encryptionPub: remoteWrappingPublic });
      expect(remotePublicKey).not.toBeNull();
      const remoteDeviceId = await deriveGroupDeviceId(remotePublicKey!);
      expect(remoteDeviceId).not.toBeNull();
      const remoteRecord = makeRecord(remoteDeviceId!, remoteSignerPublic, remoteWrappingPublic);
      const records = [localRecord, remoteRecord];
      directorySnapshot = {
        account: 'alice', devices: records, trusted: records,
        bySigner: new Map(records.map((record) => [record.directoryKey!, record])),
      };
      const verifiedDirectory: VerifiedGroupDirectory = {
        complete: true, revision: 'membership-v1|alice:directory-v1', mappingRevision, canonicalRoom: '#room', scheme: 'rfc1459',
        devices: records.map((record) => ({ accountId: record.account as AccountId, deviceId: record.deviceId,
          signerPublicKey: record.entry!.signerPub, wrapPublicKey: record.entry!.encryptionPub, trusted: true as const })),
      };
      const priorCommitHash = new Uint8Array(GROUP_COMMIT_HASH_BYTES);
      const membershipDigest = await buildMembershipDigest({ networkId: String(liveOwner.networkId), priorEpoch: 0,
        priorCommitHash, localAccount: String(liveOwner.accountId), localDeviceId: local.deviceId, directory: verifiedDirectory });
      expect(membershipDigest).toHaveLength(GROUP_COMMIT_HASH_BYTES);

      const epochKey = new Uint8Array(GROUP_COMMIT_KEY_BYTES).fill(71);
      const commitId = new Uint8Array(GROUP_COMMIT_ID_BYTES).fill(72);
      const commit = await prepareGroupCommit({ room: '#room', fromAccount: 'alice', fromDevice: remoteDeviceId!,
        priorEpoch: 0, priorCommitHash, membershipDigest: membershipDigest!, commitId, newEpochKey: epochKey });
      const welcome = await prepareGroupWelcome({ room: '#room', fromAccount: 'alice', fromDevice: remoteDeviceId!,
        toAccount: 'alice', toDevice: local.deviceId, epoch: 1, commitId, membershipDigest: membershipDigest!, epochKey,
        recipientWrapPublicKey: local.wrappingPublicKey });
      expect(commit).not.toBeNull();
      expect(welcome).not.toBeNull();
      const commitPayload = await signGroupControlPayload({
        routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: remoteDeviceId! },
        epoch: 1, body: commit!.body, signerPub: remoteSignerPublic, privateKey: remoteSigner.privateKey,
      });
      const welcomePayload = await signGroupControlPayload({
        routing: { channel: '#room', kind: 'welcome', fromAccount: 'alice', fromDevice: remoteDeviceId!, toAccount: 'alice', toDevice: local.deviceId },
        epoch: 1, body: welcome!.bytes, signerPub: remoteSignerPublic, privateKey: remoteSigner.privateKey,
      });
      expect(commitPayload).not.toBeNull();
      expect(welcomePayload).not.toBeNull();
      const context = { schemaVersion: 1 as const, requestId: 'roomRetirementRaceRequest0001' as never, owner: liveOwner };
      await provider.groupProviders.ingestGroupControl({ context, line: `:server E2EE.COMMIT #room alice ${remoteDeviceId} :${commitPayload}` });
      await provider.groupProviders.ingestGroupControl({ context, line: `:server E2EE.WELCOME #room alice ${remoteDeviceId} alice ${local.deviceId} :${welcomePayload}` });
      const preview = provider.previewBootstrap({ context, conversationId });
      expect(preview).not.toBeNull();
      await expect(provider.approveBootstrap({ context, previewRef: preview!.previewRef, confirm: true })).resolves.toBe(true);
      const envelope = await provider.groupProviders.sealRoom(liveOwner, conversationId, 'must not escape after retirement');
      expect(envelope).not.toBeNull();

      const realDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      let markDecryptStarted!: () => void;
      const decryptGate = new Promise<void>((resolve) => { releaseDecrypt = resolve; });
      const decryptStarted = new Promise<void>((resolve) => { markDecryptStarted = resolve; });
      let realDecryptProducedPlaintext = false;
      const decryptSpy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (algorithm, key, data) => {
        markDecryptStarted();
        await decryptGate;
        const clear = await realDecrypt(algorithm, key, data);
        realDecryptProducedPlaintext = clear.byteLength > 0;
        decryptedClearBytes.current = new Uint8Array(clear);
        return clear;
      });
      restoreDecrypt = () => decryptSpy.mockRestore();
      const opening = provider.groupProviders.openRoom(liveOwner, conversationId, envelope!);
      await decryptStarted;
      provider.retireOwner(liveOwner);
      releaseDecrypt();
      await expect(opening).resolves.toBeNull();
      expect(decryptSpy).toHaveBeenCalledTimes(1);
      expect(realDecryptProducedPlaintext).toBe(true);
      priorCommitHash.fill(0); membershipDigest?.fill(0); epochKey.fill(0); commitId.fill(0);
      remoteSignerPublic.fill(0); remoteWrappingPublic.fill(0); local.signerPublicKey.fill(0); local.wrappingPublicKey.fill(0);
    } finally {
      releaseDecrypt();
      decryptedClearBytes.current?.fill(0);
      try { restoreDecrypt?.(); } finally { provider.dispose(); }
    }
  });

  it('uses workspace AEAD without device registration and fences it from the UI owner generation', async () => {
    const input = deps();
    const workspaceGrant: WorkspaceOwnerGrant = {
      scope: { kind: 'guest', networkId: owner.networkId, accountId: null, physicalRef: owner.physicalRef!,
        workspaceRef: 'workspace-a', installationDeviceId: 'install-a', localWorkspaceEpoch: 1 },
      stableLocalOwnerKey: localOwnerStableKey({ kind: 'guest', networkId: owner.networkId, accountId: null,
        physicalRef: owner.physicalRef!, workspaceRef: 'workspace-a', installationDeviceId: 'install-a', localWorkspaceEpoch: 1 }),
      ref: Symbol('workspace-grant'),
    };
    let current = owner;
    let activeGrant = workspaceGrant;
    const provider = createPrivateCryptoProvider({ ...input,
      ownerSnapshot: () => current, isCurrent: (candidate) => candidate.ownerRef === current.ownerRef,
      validateWorkspaceGrant: (candidate) => candidate === activeGrant });
    const context = { schemaVersion: 1 as const, requestId: '0123456789abcdef0123456789abcdef' as never, owner };
    const plaintext = new TextEncoder().encode('offline local draft');
    const sealed = await provider.sealWorkspaceLocal({ context, grant: workspaceGrant, conversationId: 'room-1' as never, purpose: 'draft:revision-1', plaintext });
    expect(sealed.kind).toBe('sealed');
    const opened = await provider.openWorkspaceLocal({ context, grant: workspaceGrant, conversationId: 'room-1' as never, purpose: 'draft:revision-1', ciphertext: sealed.bytes! });
    expect(opened.kind).toBe('opened');
    expect(new TextDecoder().decode(opened.bytes)).toBe('offline local draft');
    const nextGrant: WorkspaceOwnerGrant = { ...workspaceGrant,
      scope: { ...workspaceGrant.scope, localWorkspaceEpoch: 2 }, ref: Symbol('workspace-grant-reselected') };
    activeGrant = nextGrant;
    const lateOldGrant = await provider.openWorkspaceLocal({ context, grant: workspaceGrant, conversationId: 'room-1' as never, purpose: 'draft:revision-1', ciphertext: sealed.bytes! });
    expect(lateOldGrant.kind).toBe('stale-owner');
    const reopenedAfterReselect = await provider.openWorkspaceLocal({ context, grant: nextGrant, conversationId: 'room-1' as never, purpose: 'draft:revision-1', ciphertext: sealed.bytes! });
    expect(reopenedAfterReselect.kind).toBe('opened');
    expect(new TextDecoder().decode(reopenedAfterReselect.bytes)).toBe('offline local draft');
    const scheduledPlain = new TextEncoder().encode('scheduled intent revision two');
    const scheduledCipher = await provider.sealWorkspaceLocal({ context, grant: nextGrant, conversationId: '#room' as never,
      exactBinding: '#room', purpose: 'scheduled:operation-1:2', plaintext: scheduledPlain });
    expect(scheduledCipher.kind).toBe('sealed');
    const scheduledOpen = await provider.openWorkspaceLocal({ context, grant: nextGrant, conversationId: '#room' as never,
      exactBinding: '#room', purpose: 'scheduled:operation-1:2', ciphertext: scheduledCipher.bytes! });
    expect(scheduledOpen.kind).toBe('opened');
    expect(new TextDecoder().decode(scheduledOpen.bytes)).toBe('scheduled intent revision two');
    const priorRevision = await provider.openWorkspaceLocal({ context, grant: nextGrant, conversationId: '#room' as never,
      exactBinding: '#room', purpose: 'scheduled:operation-1:1', ciphertext: scheduledCipher.bytes! });
    expect(priorRevision.kind).not.toBe('opened');
    const wrongTarget = await provider.openWorkspaceLocal({ context, grant: nextGrant, conversationId: '#room' as never,
      exactBinding: '#other', purpose: 'scheduled:operation-1:2', ciphertext: scheduledCipher.bytes! });
    expect(wrongTarget.kind).toBe('invalid');
    const dmSealed = await provider.sealWorkspaceLocal({ context, grant: nextGrant, conversationId: 'peer' as never,
      exactBinding: 'peer', purpose: 'scheduled:operation-1:3', plaintext: scheduledPlain });
    expect(dmSealed.kind).toBe('sealed');
    const dmOpened = await provider.openWorkspaceLocal({ context, grant: nextGrant, conversationId: 'peer' as never,
      exactBinding: 'peer', purpose: 'scheduled:operation-1:3', ciphertext: dmSealed.bytes! });
    expect(dmOpened.kind).toBe('opened');
    expect(new TextDecoder().decode(dmOpened.bytes)).toBe('scheduled intent revision two');
    current = { ...owner, ownerRef: 'owner-b' as OwnerSnapshot['ownerRef'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'] };
    const stale = await provider.openWorkspaceLocal({ context, grant: workspaceGrant, conversationId: 'room-1' as never, purpose: 'draft:revision-1', ciphertext: sealed.bytes! });
    expect(stale.kind).toBe('stale-owner');
    plaintext.fill(0); sealed.bytes?.fill(0); opened.bytes?.fill(0); reopenedAfterReselect.bytes?.fill(0);
    scheduledPlain.fill(0); scheduledCipher.bytes?.fill(0); scheduledOpen.bytes?.fill(0);
    dmSealed.bytes?.fill(0); dmOpened.bytes?.fill(0); provider.dispose();
  });

  it('keeps selected local custody usable after live-owner retirement while refusing live enrollment', async () => {
    const input = deps();
    const workspaceGrant: WorkspaceOwnerGrant = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: 'acct' as AccountId, physicalRef: null,
        workspaceRef: 'workspace-offline', installationDeviceId: 'install-offline', localWorkspaceEpoch: 7 },
      stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', 'net', 'acct', 'install-offline']), ref: Symbol('workspace-offline'),
    };
    const provider = createPrivateCryptoProvider({ ...input, workspaceGrantForOwner: () => workspaceGrant,
      validateWorkspaceGrant: (candidate) => candidate === workspaceGrant });
    const context = { schemaVersion: 1 as const, requestId: 'domainRequest000000000010' as never, owner };
    const sealed = await provider.sealWorkspaceLocal({ context, grant: workspaceGrant, conversationId: 'room-1' as never,
      purpose: 'draft:revision-1', plaintext: new TextEncoder().encode('kept while offline') });
    expect(sealed.kind).toBe('sealed');
    provider.retireOwner(owner);
    const opened = await provider.openWorkspaceLocal({ context, grant: workspaceGrant, conversationId: 'room-1' as never,
      purpose: 'draft:revision-1', ciphertext: sealed.bytes! });
    expect(opened.kind).toBe('opened');
    expect(new TextDecoder().decode(opened.bytes)).toBe('kept while offline');
    expect(await provider.ensureEnrolledIdentity(owner)).toBe(false);
    opened.bytes?.fill(0); sealed.bytes?.fill(0); provider.dispose();
  });

  it('uses a real workspace grant across remember toggles and a workspace reload', async () => {
    const indexedDB = new IDBFactory();
    const liveOwner = { ...owner, accountId: 'acct' as AccountId };
    const workspaceDeps = () => ({ indexedDB, configuredNetworks: () => [liveOwner.networkId],
      isProvenLiveOwner: (candidate: OwnerSnapshot) => candidate.ownerRef === liveOwner.ownerRef,
      isRequestCurrent: (request: { owner: OwnerSnapshot }) => request.owner.ownerRef === liveOwner.ownerRef,
      onAuthorityLost: () => undefined });
    let workspace = createLocalWorkspaceOwner(workspaceDeps());
    await workspace.rememberProvenOwner(liveOwner, false);
    const firstGrant = workspace.grant()!;
    const providerDeps = { ...deps(), indexedDB, ownerSnapshot: () => liveOwner,
      isCurrent: (candidate: OwnerSnapshot) => candidate.ownerRef === liveOwner.ownerRef,
      workspaceGrantForOwner: () => workspace.grant(), validateWorkspaceGrant: (grant: WorkspaceOwnerGrant) => workspace.validateGrant(grant) };
    let provider = createPrivateCryptoProvider(providerDeps);
    const context = { schemaVersion: 1 as const, requestId: 'domainRequest000000000031' as never, owner: liveOwner };
    const plaintext = new TextEncoder().encode('survives remember changes');
    const sealed = await provider.sealWorkspaceLocal({ context, grant: firstGrant, conversationId: 'room-1' as never,
      purpose: 'draft:remember-toggle', plaintext });
    expect(sealed.kind).toBe('sealed');

    await workspace.rememberProvenOwner(liveOwner, true);
    const rememberedGrant = workspace.grant()!;
    expect(rememberedGrant.stableLocalOwnerKey).toBe(firstGrant.stableLocalOwnerKey);
    await workspace.rememberProvenOwner(liveOwner, false);
    const forgottenGrant = workspace.grant()!;
    expect(forgottenGrant.stableLocalOwnerKey).toBe(firstGrant.stableLocalOwnerKey);
    expect(await workspace.list()).toEqual([]);
    await workspace.rememberProvenOwner(liveOwner, true);
    const metadata = (await workspace.list())[0]!;
    workspace.dispose(); provider.dispose();

    workspace = createLocalWorkspaceOwner(workspaceDeps());
    await workspace.select({ workspaceRef: metadata.workspaceRef, explicitUserAction: true });
    const reloadedGrant = workspace.grant()!;
    expect(reloadedGrant.stableLocalOwnerKey).toBe(firstGrant.stableLocalOwnerKey);
    provider = createPrivateCryptoProvider({ ...providerDeps,
      workspaceGrantForOwner: () => workspace.grant(), validateWorkspaceGrant: (grant) => workspace.validateGrant(grant) });
    const reopened = await provider.openWorkspaceLocal({ context, grant: reloadedGrant, conversationId: 'room-1' as never,
      purpose: 'draft:remember-toggle', ciphertext: sealed.bytes! });
    expect(reopened.kind).toBe('opened');
    expect(new TextDecoder().decode(reopened.bytes)).toBe('survives remember changes');
    plaintext.fill(0); sealed.bytes?.fill(0); reopened.bytes?.fill(0); provider.dispose(); workspace.dispose();
  });

  it('binds queued plaintext to stable intent identity rather than the enqueue request', async () => {
    const indexedDB = new IDBFactory();
    const input = { ...deps(), indexedDB };
    const workspaceGrant: WorkspaceOwnerGrant = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: 'acct' as AccountId, physicalRef: null,
        workspaceRef: 'workspace-queue', installationDeviceId: 'install-queue', localWorkspaceEpoch: 1 },
      stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', 'net', 'acct', 'install-queue']), ref: Symbol('workspace-queue'),
    };
    let activeOwner = owner;
    let currentPolicy: ReturnType<PrivateCryptoDeps['conversationPolicy']> = null;
    const provider = createPrivateCryptoProvider({ ...input, ownerSnapshot: () => activeOwner,
      isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef,
      workspaceGrantForOwner: () => workspaceGrant, validateWorkspaceGrant: (candidate) => candidate === workspaceGrant,
      conversationPolicy: () => currentPolicy });
    const intent = 'domainRequest000000000001' as never;
    const queuedText = new TextEncoder().encode('offline message');
    const queued = await provider.prepareQueuedPayload({ owner, conversationId: 'room-1' as never,
      requestId: '11111111111111111111111111111111' as never, clientIntentId: intent,
      operation: 'privmsg', targetKey: 'room-1', body: queuedText });
    expect(queued.kind).toBe('sealed-local');
    expect(queued.policyRevision).toBe('local-sealed-intent-v1');
    const duplicate = await provider.prepareQueuedPayload({ owner, conversationId: 'room-1' as never,
      requestId: '33333333333333333333333333333333' as never, clientIntentId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as never,
      operation: 'privmsg', targetKey: 'room-1', body: queuedText });
    expect(duplicate.payloadCommitment).toBe(queued.payloadCommitment);
    expect(duplicate.bytes).not.toEqual(queued.bytes);
    const changed = await provider.prepareQueuedPayload({ owner, conversationId: 'room-1' as never,
      requestId: '44444444444444444444444444444444' as never, clientIntentId: 'cccccccccccccccccccccccccccccccc' as never,
      operation: 'privmsg', targetKey: 'room-1', body: new TextEncoder().encode('different message') });
    expect(changed.payloadCommitment).not.toBe(queued.payloadCommitment);
    const changedTarget = await provider.prepareQueuedPayload({ owner, conversationId: 'room-2' as never,
      requestId: '66666666666666666666666666666666' as never, clientIntentId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as never,
      operation: 'privmsg', targetKey: 'room-2', body: queuedText });
    expect(changedTarget.payloadCommitment).not.toBe(queued.payloadCommitment);
    const changedOperation = await provider.prepareQueuedPayload({ owner, conversationId: 'room-1' as never,
      requestId: '77777777777777777777777777777777' as never, clientIntentId: 'ffffffffffffffffffffffffffffffff' as never,
      operation: 'memo-send', targetKey: 'room-1', body: queuedText });
    expect(changedOperation.payloadCommitment).not.toBe(queued.payloadCommitment);
    const currentOwner = { ...owner, accountId: 'acct' as AccountId };
    activeOwner = currentOwner;
    currentPolicy = { revision: 'current', encryption: 'plain', eligible: true, room: null, epoch: null };
    const dispatch = await provider.prepareDispatch({ owner: currentOwner, conversationId: 'room-1' as never,
      requestId: '22222222222222222222222222222222' as never, clientIntentId: intent, operation: 'privmsg', targetKey: 'room-1',
      payload: queued.bytes!, policyRevision: queued.policyRevision! });
    expect(dispatch.kind).toBe('ready');
    expect(new TextDecoder().decode(dispatch.body)).toBe('offline message');
    const previousCommitment = queued.payloadCommitment;
    queuedText.fill(0); queued.bytes?.fill(0); duplicate.bytes?.fill(0); changed.bytes?.fill(0); changedTarget.bytes?.fill(0);
    changedOperation.bytes?.fill(0); dispatch.body?.fill(0); provider.dispose();
    const reselectedGrant: WorkspaceOwnerGrant = { ...workspaceGrant,
      scope: { ...workspaceGrant.scope, localWorkspaceEpoch: 2 }, ref: Symbol('workspace-queue-reselected') };
    const reloaded = createPrivateCryptoProvider({ ...input, ownerSnapshot: () => currentOwner,
      isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef,
      workspaceGrantForOwner: () => reselectedGrant, validateWorkspaceGrant: (candidate) => candidate === reselectedGrant });
    const afterReload = await reloaded.prepareQueuedPayload({ owner: currentOwner, conversationId: 'room-1' as never,
      requestId: '55555555555555555555555555555555' as never, clientIntentId: 'dddddddddddddddddddddddddddddddd' as never,
      operation: 'privmsg', targetKey: 'room-1', body: new TextEncoder().encode('offline message') });
    expect(afterReload.payloadCommitment).toBe(previousCommitment);
    afterReload.bytes?.fill(0); reloaded.dispose();
  });

  it('retires volatile intent-MAC custody on workspace lock without evicting another workspace key', async () => {
    const input = deps();
    const grantFor = (workspaceRef: string, installationDeviceId: string, localWorkspaceEpoch: number): WorkspaceOwnerGrant => {
      const scope = { kind: 'account' as const, networkId: owner.networkId, accountId: 'acct' as AccountId, physicalRef: null,
        workspaceRef, installationDeviceId, localWorkspaceEpoch };
      return { scope, stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', String(owner.networkId), 'acct', installationDeviceId]),
        ref: Symbol(workspaceRef) };
    };
    const originalGrant = grantFor('volatile-workspace', 'volatile-install', 1);
    const replacementGrant = grantFor('volatile-workspace', 'volatile-install', 2);
    const otherGrant = grantFor('other-workspace', 'other-install', 1);
    let activeGrant: WorkspaceOwnerGrant | null = originalGrant;
    const provider = createPrivateCryptoProvider({ ...input,
      workspaceGrantForOwner: () => activeGrant,
      validateWorkspaceGrant: (candidate) => candidate === activeGrant });
    const context = { schemaVersion: 1 as const, requestId: '11111111111111111111111111111111' as never, owner };
    const body = new TextEncoder().encode('same canonical intent');
    const queue = (requestId: string) => provider.prepareQueuedPayload({ owner, conversationId: 'room-1' as never,
      requestId: requestId as never, clientIntentId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as never,
      operation: 'privmsg', targetKey: 'room-1', body });

    const first = await queue('11111111111111111111111111111111');
    expect(first.kind).toBe('sealed-local');
    activeGrant = otherGrant;
    const otherBeforeLock = await queue('22222222222222222222222222222222');
    expect(otherBeforeLock.kind).toBe('sealed-local');

    activeGrant = null;
    provider.retireWorkspace(originalGrant);
    const staleUse = await provider.sealWorkspaceLocal({ context, grant: originalGrant, conversationId: 'room-1' as never,
      purpose: 'draft:retired', plaintext: body });
    expect(staleUse.kind).toBe('stale-owner');

    activeGrant = replacementGrant;
    const afterRegrant = await queue('33333333333333333333333333333333');
    expect(afterRegrant.kind).toBe('sealed-local');
    expect(afterRegrant.payloadCommitment).not.toBe(first.payloadCommitment);

    activeGrant = otherGrant;
    const otherAfterLock = await queue('44444444444444444444444444444444');
    expect(otherAfterLock.payloadCommitment).toBe(otherBeforeLock.payloadCommitment);

    body.fill(0); first.bytes?.fill(0); otherBeforeLock.bytes?.fill(0); afterRegrant.bytes?.fill(0); otherAfterLock.bytes?.fill(0);
    provider.dispose();
  });

  it('binds reply, ACTION, audience and LF/TAB to the v2 intent and never auto-sends a legacy v1 row', async () => {
    const indexedDB = new IDBFactory();
    const input = deps();
    const grant: WorkspaceOwnerGrant = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: 'acct' as AccountId, physicalRef: null,
        workspaceRef: 'workspace-rich', installationDeviceId: 'install-rich', localWorkspaceEpoch: 1 },
      stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', 'net', 'acct', 'install-rich']), ref: Symbol('workspace-rich'),
    };
    let activeOwner = { ...owner, accountId: 'acct' as AccountId };
    let policy = { revision: 'plain-v1', encryption: 'plain' as const, eligible: true, room: null, epoch: null };
    const provider = createPrivateCryptoProvider({ ...input, indexedDB, ownerSnapshot: () => activeOwner,
      isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef,
      workspaceGrantForOwner: () => grant, validateWorkspaceGrant: (candidate) => candidate === grant,
      conversationPolicy: () => policy });
    const content = new TextEncoder().encode('first line\nsecond\tline');
    const queued = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000001' as never, clientIntentId: 'domainRequest000000000002' as never,
      operation: 'privmsg', targetKey: '#room', messageKind: 'action', replyTo: 'msgid-1', audiencePrefix: '@', body: content,
      policyRevision: policy.revision });
    expect(queued.kind).toBe('sealed-local');
    const changedAudience = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000003' as never, clientIntentId: 'domainRequest000000000004' as never,
      operation: 'privmsg', targetKey: '#room', messageKind: 'action', replyTo: 'msgid-1', audiencePrefix: '.', body: content,
      policyRevision: policy.revision });
    expect(changedAudience.payloadCommitment).not.toBe(queued.payloadCommitment);
    const changedReply = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000011' as never, clientIntentId: 'domainRequest000000000012' as never,
      operation: 'privmsg', targetKey: '#room', messageKind: 'action', replyTo: 'msgid-2', audiencePrefix: '@', body: content,
      policyRevision: policy.revision });
    expect(changedReply.payloadCommitment).not.toBe(queued.payloadCommitment);
    const changedKind = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000013' as never, clientIntentId: 'domainRequest000000000014' as never,
      operation: 'privmsg', messageKind: 'message', targetKey: '#room', replyTo: 'msgid-1', audiencePrefix: '@', body: content,
      policyRevision: policy.revision });
    expect(changedKind.payloadCommitment).not.toBe(queued.payloadCommitment);
    const dispatch = await provider.prepareDispatch({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000005' as never, clientIntentId: 'domainRequest000000000002' as never,
      operation: 'privmsg', targetKey: '#room', payload: queued.bytes!, policyRevision: policy.revision });
    expect(dispatch.kind).toBe('ready');
    expect(dispatch.messageKind).toBe('action'); expect(dispatch.replyTo).toBe('msgid-1'); expect(dispatch.audiencePrefix).toBe('@');
    expect(new TextDecoder().decode(dispatch.body)).toBe('\u0001ACTION first line\nsecond\tline\u0001');

    const bangPrefix = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000018' as never, clientIntentId: 'domainRequest000000000019' as never,
      operation: 'privmsg', targetKey: '#room', messageKind: 'message', audiencePrefix: '!', body: content,
      policyRevision: policy.revision });
    const plusPrefix = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000020' as never, clientIntentId: 'domainRequest000000000025' as never,
      operation: 'privmsg', targetKey: '#room', messageKind: 'message', audiencePrefix: '+', body: content,
      policyRevision: policy.revision });
    const additionalPrefix = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: '#room' as never,
      requestId: 'domainRequest000000000026' as never, clientIntentId: 'domainRequest000000000027' as never,
      operation: 'privmsg', targetKey: '#room', audiencePrefix: '~', body: content, policyRevision: policy.revision });
    expect(bangPrefix.kind).toBe('sealed-local'); expect(plusPrefix.kind).toBe('sealed-local');
    expect(additionalPrefix.kind).toBe('sealed-local'); // Live STATUSMSG authority is checked by the source planner.

    const staleIntent = await provider.prepareQueuedPayload({ owner: activeOwner, conversationId: 'room-1' as never,
      requestId: 'domainRequest000000000015' as never, clientIntentId: 'domainRequest000000000016' as never,
      operation: 'privmsg', targetKey: 'room-1', body: new TextEncoder().encode('policy-bound') });
    policy = { ...policy, revision: 'plain-v2' };
    const staleDispatch = await provider.prepareDispatch({ owner: activeOwner, conversationId: 'room-1' as never,
      requestId: 'domainRequest000000000017' as never, clientIntentId: 'domainRequest000000000016' as never,
      operation: 'privmsg', targetKey: 'room-1', payload: staleIntent.bytes!, policyRevision: staleIntent.policyRevision! });
    expect(staleDispatch.kind).toBe('held');
    policy = { ...policy, revision: 'plain-v1' };

    const oldPlaintext = new TextEncoder().encode('legacy message');
    const legacy = await provider.sealWorkspaceLocal({ context: { schemaVersion: 1, requestId: 'domainRequest000000000006' as never, owner: activeOwner },
      grant, conversationId: 'room-1' as never, purpose: 'outbox:domainRequest000000000007', plaintext: oldPlaintext });
    expect(legacy.kind).toBe('sealed');
    const legacyDispatch = await provider.prepareDispatch({ owner: activeOwner, conversationId: 'room-1' as never,
      requestId: 'domainRequest000000000008' as never, clientIntentId: 'domainRequest000000000007' as never,
      operation: 'privmsg', targetKey: 'room-1', payload: legacy.bytes!, policyRevision: policy.revision });
    expect(legacyDispatch.kind).toBe('held'); expect(legacyDispatch.reason).toBe('legacy-review');
    expect(legacyDispatch.body).toBeUndefined();
    content.fill(0); oldPlaintext.fill(0); queued.bytes?.fill(0); changedAudience.bytes?.fill(0); changedReply.bytes?.fill(0); changedKind.bytes?.fill(0);
    dispatch.body?.fill(0); staleIntent.bytes?.fill(0); staleDispatch.body?.fill(0); legacy.bytes?.fill(0); provider.dispose();
  });

  it('dispatches MEMO against the captured workspace target key while retaining recipient account identity', async () => {
    const input = deps();
    const liveOwner = { ...owner, accountId: 'sender' as AccountId };
    const grant: WorkspaceOwnerGrant = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: 'sender' as AccountId, physicalRef: null,
        workspaceRef: 'workspace-memo', installationDeviceId: 'install-memo', localWorkspaceEpoch: 1 },
      stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', 'net', 'sender', 'install-memo']), ref: Symbol('workspace-memo'),
    };
    const provider = createPrivateCryptoProvider({ ...input, ownerSnapshot: () => liveOwner,
      isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef,
      workspaceGrantForOwner: () => grant, validateWorkspaceGrant: (candidate) => candidate === grant,
      canonicalWorkspaceTarget: (_context, _grant, conversationId) => `workspace-key:${String(conversationId).toLowerCase()}` });
    const body = new TextEncoder().encode('private memo');
    const queued = await provider.prepareQueuedPayload({ owner: liveOwner, conversationId: 'Recipient.Account' as never,
      requestId: 'domainRequest000000000021' as never, clientIntentId: 'domainRequest000000000022' as never,
      operation: 'memo-send', targetKey: 'workspace-key:recipient.account', body });
    expect(queued.kind).toBe('sealed-local');
    const dispatched = await provider.prepareDispatch({ owner: liveOwner, conversationId: 'Recipient.Account' as never,
      requestId: 'domainRequest000000000023' as never, clientIntentId: 'domainRequest000000000022' as never,
      operation: 'memo-send', targetKey: 'workspace-key:recipient.account', payload: queued.bytes!, policyRevision: queued.policyRevision! });
    expect(dispatched.kind).toBe('ready');
    expect(new TextDecoder().decode(dispatched.body)).toBe('private memo');
    const wrongTarget = await provider.prepareDispatch({ owner: liveOwner, conversationId: 'Other.Account' as never,
      requestId: 'domainRequest000000000024' as never, clientIntentId: 'domainRequest000000000022' as never,
      operation: 'memo-send', targetKey: 'workspace-key:recipient.account', payload: queued.bytes!, policyRevision: queued.policyRevision! });
    expect(wrongTarget.kind).toBe('held');
    body.fill(0); queued.bytes?.fill(0); dispatched.body?.fill(0); provider.dispose();
  });

  it('reopens an accepted epoch escrow after provider/workspace reload without a live account', async () => {
    const indexedDB = new IDBFactory(); const grant: WorkspaceOwnerGrant = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: 'alice' as AccountId, physicalRef: null,
        workspaceRef: 'history-workspace', installationDeviceId: 'new-installation-device', localWorkspaceEpoch: 1 },
      stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', 'net', 'alice', 'new-installation-device']), ref: Symbol('history-grant-1'),
    };
    const reselectedGrant: WorkspaceOwnerGrant = { ...grant,
      scope: { ...grant.scope, localWorkspaceEpoch: 2 }, ref: Symbol('history-grant-2') };
    let activeGrant = grant;
    const currentPolicy = { revision: 'offline', encryption: 'unknown' as const, eligible: false, room: '#room', epoch: null };
    const providerDeps = { ...deps(), indexedDB, workspaceGrantForOwner: () => activeGrant,
      validateWorkspaceGrant: (candidate: WorkspaceOwnerGrant) => candidate === activeGrant,
      canonicalConversationKey: (_owner: OwnerSnapshot, conversationId: ConversationId) => String(conversationId),
      conversationPolicy: () => currentPolicy };

    const signer = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const signerPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey));
    const epochKey = new Uint8Array(32).fill(41); const membershipDigest = new Uint8Array(32).fill(42);
    const commitId = new Uint8Array(32).fill(43);
    const prepared = await prepareGroupCommit({ room: '#room', fromAccount: 'alice', fromDevice: 'device-01', priorEpoch: 0,
      priorCommitHash: new Uint8Array(32), membershipDigest, commitId, newEpochKey: epochKey, nextEpoch: 1 });
    expect(prepared).not.toBeNull();
    const signed = await signGroupControlPayload({ routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: 'device-01' },
      epoch: 1, body: prepared!.body, signerPub: signerPublicKey, privateKey: signer.privateKey });
    expect(signed).not.toBeNull();
    const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', signerPublicKey));
    const b64 = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, ''); };
    const payload = { version: 2 as const, kind: 'room-epoch-history' as const, networkId: String(owner.networkId), accountId: 'alice',
      exportingDeviceId: 'device-01', room: '#room', epoch: 1, commitHashHex: [...prepared!.commitHash].map((b) => b.toString(16).padStart(2, '0')).join(''),
      membershipDigestHex: [...membershipDigest].map((b) => b.toString(16).padStart(2, '0')).join(''), epochKeyB64url: b64(epochKey),
      receipt: { signedCommitPayload: signed!, fromAccount: 'alice', fromDevice: 'device-01', signerPublicKeyB64url: b64(signerPublicKey),
        signerFingerprintHex: [...fingerprint].map((b) => b.toString(16).padStart(2, '0')).join(''), acceptanceTrust: 'first-use' as const,
        acceptedMembershipRevision: `accepted:${[...prepared!.commitHash].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
        acceptedMappingScheme: 'rfc1459' as const, provenance: 'source-observed-acceptance' as const } };
    const context = { schemaVersion: 1 as const, requestId: 'domainRequest000000000051' as never, owner };
    const provider = createPrivateCryptoProvider(providerDeps);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await provider.sealWorkspaceLocal({ context, grant, conversationId: '#room' as never,
      purpose: `epoch-escrow:#room:1:${payload.commitHashHex}`, plaintext });
    expect(encrypted.kind).toBe('sealed');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('onyx-elm-private', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const rowKey = JSON.stringify(['epoch-escrow-v1', grant.stableLocalOwnerKey, '#room', 1, payload.commitHashHex]);
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('epoch-backups', 'readwrite');
      tx.objectStore('epoch-backups').put({ key: rowKey, scope: grant.stableLocalOwnerKey, room: '#room', epoch: 1,
        commitHashHex: payload.commitHashHex, state: 'accepted', ciphertext: encrypted.bytes!.slice() }, rowKey);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
    const roomKey = await crypto.subtle.importKey('raw', epochKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const envelope = await sealGroupMessage(roomKey, '#room', 1, 'history remains readable');
    expect(envelope).not.toBeNull();
    database.close(); provider.dispose();

    activeGrant = reselectedGrant;
    const reloaded = createPrivateCryptoProvider(providerDeps);
    const opened = await reloaded.groupProviders.openHistoricalRoom({ context, grant: reselectedGrant, conversationId: '#room' as never,
      room: '#room', envelope: envelope! });
    expect(opened, `accepted escrow reopen returned ${String(opened)}`).toBe('history remains readable');
    plaintext.fill(0); encrypted.bytes?.fill(0); epochKey.fill(0); membershipDigest.fill(0); commitId.fill(0);
    signerPublicKey.fill(0); fingerprint.fill(0); prepared?.destroy(); reloaded.dispose();
  });

  it('imports a fresh portable checkpoint from a connected guest into read-only history custody', async () => {
    const indexedDB = new IDBFactory();
    const context = { schemaVersion: 1 as const, requestId: 'guestImportRequest000000001' as never, owner };
    let provider!: ReturnType<typeof createPrivateCryptoProvider>;
    const workspaceOwner = createLocalWorkspaceOwner({ indexedDB, configuredNetworks: () => [owner.networkId],
      isProvenLiveOwner: () => false, isCurrentGuestOwner: (candidate) => candidate.ownerRef === owner.ownerRef,
      isRequestCurrent: (request) => request.owner.ownerRef === owner.ownerRef, isOfflineRequest: () => false,
      validateHistoryCheckpoint: (request) => provider?.isApprovedHistoryCheckpoint(request) ?? false,
      onAuthorityLost: () => undefined });
    await workspaceOwner.ensureCurrentWorkspace(owner);
    const password = new TextEncoder().encode('long-test-password');
    let encryptedInput: Uint8Array = new Uint8Array();
    const providerDeps: PrivateCryptoDeps = { ...deps(), indexedDB,
      workspaceGrantForOwner: () => workspaceOwner.grant(),
      workspaceSelectionRef: () => workspaceOwner.current()?.workspaceRef ?? null,
      validateWorkspaceGrant: (grant) => workspaceOwner.validateGrant(grant),
      ensureImportedHistoryWorkspace: (request) => workspaceOwner.ensureImportedHistoryWorkspace(request),
      async readPrivateImport() { return { bytes: encryptedInput.slice(), password: password.slice() }; },
      conversationPolicy: () => ({ revision: 'history-only', encryption: 'unknown', eligible: false, room: '#room', epoch: null }),
    };
    provider = createPrivateCryptoProvider(providerDeps);
    const signer = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const signerPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey));
    const epochKey = new Uint8Array(32).fill(61); const membershipDigest = new Uint8Array(32).fill(62);
    const prepared = await prepareGroupCommit({ room: '#room', fromAccount: 'alice', fromDevice: 'device-guest-import', priorEpoch: 0,
      priorCommitHash: new Uint8Array(32), membershipDigest, commitId: new Uint8Array(32).fill(63), newEpochKey: epochKey, nextEpoch: 1 });
    expect(prepared).not.toBeNull();
    const signedCommitPayload = await signGroupControlPayload({ routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: 'device-guest-import' },
      epoch: 1, body: prepared!.body, signerPub: signerPublicKey, privateKey: signer.privateKey });
    expect(signedCommitPayload).not.toBeNull();
    const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', signerPublicKey));
    const b64 = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, ''); };
    const hash = [...prepared!.commitHash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const payload: PortableGroupBackup = { version: 2, kind: 'room-epoch-history', networkId: String(owner.networkId), accountId: 'alice',
      exportingDeviceId: 'device-guest-import', room: '#room', epoch: 1, commitHashHex: hash,
      membershipDigestHex: [...membershipDigest].map((byte) => byte.toString(16).padStart(2, '0')).join(''), epochKeyB64url: b64(epochKey),
      receipt: { signedCommitPayload: signedCommitPayload!, fromAccount: 'alice', fromDevice: 'device-guest-import',
        signerPublicKeyB64url: b64(signerPublicKey), signerFingerprintHex: [...fingerprint].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        acceptanceTrust: 'first-use', acceptedMembershipRevision: 'accepted-' + hash, acceptedMappingScheme: 'rfc1459',
        provenance: 'user-approved-history-checkpoint' } };
    encryptedInput = (await encryptPortableGroupBackup(payload, password))!;
    const inputRef = Symbol('private-input');
    const previewStatus = await provider.groupProviders.recovery.importBackup({ ...context, conversationId: '#room' as never,
      inputRef, passwordRef: Symbol('private-password'), configuredNetworkId: String(owner.networkId) });
    expect(previewStatus.phase).toBe('ready');
    if (previewStatus.preview) {
      const approved = await provider.groupProviders.recovery.approveBackup({ ...context, previewRef: previewStatus.preview.previewRef,
        confirmHistoryOnly: true, confirmFingerprint: previewStatus.preview.signerFingerprintHex });
      expect(approved.backupOutcome, `checkpoint approval status: ${JSON.stringify(approved)}`).toBe('installed-history-only');
    }
    expect(workspaceOwner.current()).toMatchObject({ kind: 'account', accountId: 'alice', historyOnly: true });
    expect(workspaceOwner.namespaceForRequest(context)?.access).toBe('read-only');
    const historyGrant = workspaceOwner.grant()!;
    const roomKey = await crypto.subtle.importKey('raw', epochKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const envelope = await sealGroupMessage(roomKey, '#room', 1, 'approved history opens immediately');
    const immediate = await provider.groupProviders.openHistoricalRoom({ context, grant: historyGrant,
      conversationId: '#room' as never, room: '#room', envelope: envelope! });
    expect(immediate).toBe('approved history opens immediately');
    provider.dispose(); workspaceOwner.lock();
    const storedWorkspace = (await workspaceOwner.list()).find((item) => item.historyOnly === true)!;
    await workspaceOwner.select({ workspaceRef: storedWorkspace.workspaceRef, explicitUserAction: true });
    provider = createPrivateCryptoProvider(providerDeps);
    const reopened = await provider.groupProviders.openHistoricalRoom({ context, grant: workspaceOwner.grant()!,
      conversationId: '#room' as never, room: '#room', envelope: envelope! });
    expect(reopened).toBe('approved history opens immediately');
    provider.dispose(); workspaceOwner.dispose(); encryptedInput.fill(0); password.fill(0);
    epochKey.fill(0); membershipDigest.fill(0); signerPublicKey.fill(0); fingerprint.fill(0); prepared?.destroy();
  });

  it('serializes competing portable sibling checkpoints across provider instances', async () => {
    const indexedDB = new IDBFactory(); const grant: WorkspaceOwnerGrant = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: 'alice' as AccountId, physicalRef: null,
        workspaceRef: 'shared-history', installationDeviceId: 'shared-installation', localWorkspaceEpoch: 1 },
      stableLocalOwnerKey: JSON.stringify(['local-owner-v1', 'account', owner.networkId, 'alice', 'shared-installation']), ref: Symbol('shared-history'),
    };
    const password = new TextEncoder().encode('long-test-password');
    const signer = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const signerPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', signer.publicKey));
    const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', signerPublicKey));
    const b64 = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, ''); };
    const backups = new Map<symbol, Uint8Array>();
    for (const seed of [71, 81]) {
      const epochKey = new Uint8Array(32).fill(seed); const membershipDigest = new Uint8Array(32).fill(seed + 1);
      const prepared = await prepareGroupCommit({ room: '#room', fromAccount: 'alice', fromDevice: 'device-import-race', priorEpoch: 0,
        priorCommitHash: new Uint8Array(32), membershipDigest, commitId: new Uint8Array(32).fill(seed + 2), newEpochKey: epochKey, nextEpoch: 1 });
      expect(prepared).not.toBeNull();
      const signed = await signGroupControlPayload({ routing: { channel: '#room', kind: 'commit', fromAccount: 'alice', fromDevice: 'device-import-race' },
        epoch: 1, body: prepared!.body, signerPub: signerPublicKey, privateKey: signer.privateKey });
      expect(signed).not.toBeNull();
      const hash = [...prepared!.commitHash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const payload: PortableGroupBackup = { version: 2, kind: 'room-epoch-history', networkId: String(owner.networkId), accountId: 'alice',
        exportingDeviceId: 'device-import-race', room: '#room', epoch: 1, commitHashHex: hash,
        membershipDigestHex: [...membershipDigest].map((byte) => byte.toString(16).padStart(2, '0')).join(''), epochKeyB64url: b64(epochKey),
        receipt: { signedCommitPayload: signed!, fromAccount: 'alice', fromDevice: 'device-import-race',
          signerPublicKeyB64url: b64(signerPublicKey), signerFingerprintHex: [...fingerprint].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
          acceptanceTrust: 'first-use', acceptedMembershipRevision: 'accepted-' + hash, acceptedMappingScheme: 'rfc1459',
          provenance: 'user-approved-history-checkpoint' } };
      const inputRef = Symbol('private-backup'); backups.set(inputRef, (await encryptPortableGroupBackup(payload, password))!);
      prepared?.destroy(); epochKey.fill(0); membershipDigest.fill(0);
    }
    const makeProvider = () => createPrivateCryptoProvider({ ...deps(), indexedDB,
      workspaceGrantForOwner: () => grant, workspaceSelectionRef: () => grant.scope.workspaceRef,
      validateWorkspaceGrant: (candidate) => candidate === grant,
      async readPrivateImport(inputRef) { const bytes = backups.get(inputRef); return bytes ? { bytes: bytes.slice(), password: password.slice() } : null; },
      conversationPolicy: () => ({ revision: 'history-only', encryption: 'unknown', eligible: false, room: '#room', epoch: null }),
    });
    const firstProvider = makeProvider(); const secondProvider = makeProvider();
    const refs = [...backups.keys()];
    const firstPreview = await firstProvider.groupProviders.recovery.importBackup({ schemaVersion: 1, requestId: 'racePreviewRequest00000001' as never, owner,
      inputRef: refs[0]!, passwordRef: Symbol('password'), configuredNetworkId: String(owner.networkId), conversationId: '#room' as never });
    const secondPreview = await secondProvider.groupProviders.recovery.importBackup({ schemaVersion: 1, requestId: 'racePreviewRequest00000002' as never, owner,
      inputRef: refs[1]!, passwordRef: Symbol('password'), configuredNetworkId: String(owner.networkId), conversationId: '#room' as never });
    expect(firstPreview.phase).toBe('ready'); expect(secondPreview.phase).toBe('ready');
    if (!firstPreview.preview || !secondPreview.preview) return;
    const [firstResult, secondResult] = await Promise.all([
      firstProvider.groupProviders.recovery.approveBackup({ schemaVersion: 1, requestId: 'raceApproveRequest00000001' as never, owner,
        previewRef: firstPreview.preview.previewRef, confirmHistoryOnly: true, confirmFingerprint: firstPreview.preview.signerFingerprintHex }),
      secondProvider.groupProviders.recovery.approveBackup({ schemaVersion: 1, requestId: 'raceApproveRequest00000002' as never, owner,
        previewRef: secondPreview.preview.previewRef, confirmHistoryOnly: true, confirmFingerprint: secondPreview.preview.signerFingerprintHex }),
    ]);
    expect([firstResult.backupOutcome, secondResult.backupOutcome].filter((outcome) => outcome === 'installed-history-only'),
      `checkpoint approval statuses: ${JSON.stringify([firstResult, secondResult])}`).toHaveLength(1);
    expect([firstResult, secondResult].filter((result) => result.reason === 'checkpoint-conflict')).toHaveLength(1);
    firstProvider.dispose(); secondProvider.dispose(); password.fill(0); signerPublicKey.fill(0); fingerprint.fill(0);
    for (const bytes of backups.values()) bytes.fill(0);
  });
});
