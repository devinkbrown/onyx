import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPrivateCryptoProvider, type FreshGenesisFact, type PrivateCryptoDeps } from './private-crypto-provider';
import type { AccountId, ConversationId, OwnerSnapshot, RequestContext } from './contracts';
import { deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry, type GroupDeviceDirectorySnapshot } from '../../src/lib/e2ee/groupDeviceDirectory';
import { GROUP_COMMIT_HASH_BYTES, GROUP_COMMIT_ID_BYTES, GROUP_COMMIT_KEY_BYTES, prepareGroupCommit } from '../../src/lib/e2ee/groupCommit';
import { prepareGroupWelcome } from '../../src/lib/e2ee/groupWelcome';
import { signGroupControlPayload } from '../../src/lib/e2ee/groupControlPayload';
import { buildMembershipDigest, type VerifiedGroupDirectory } from './group-directory-trust';
import { toB64url } from '../../src/lib/e2ee/dmCipher';

const owner: OwnerSnapshot = { networkId: 'net' as OwnerSnapshot['networkId'], accountId: 'alice' as AccountId,
  accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-1' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-1' as OwnerSnapshot['ownerRef'] };
const room = '#room' as ConversationId;
const mappingRevision = 'irc-casemapping-v1:rfc1459';
const context = (id: string): RequestContext => ({ schemaVersion: 1, requestId: id.padEnd(24, '0') as RequestContext['requestId'], owner });
const current = (candidate: OwnerSnapshot) => candidate.ownerRef === owner.ownerRef;

function baseDeps(overrides: Partial<PrivateCryptoDeps>): PrivateCryptoDeps {
  return {
    transport: { ownerSnapshot: () => owner, isCurrent: current, sendLine: () => ({ kind: 'blocked', reason: 'offline' }), sendLineGroup: ({ lines }) => lines.map(() => ({ kind: 'blocked' as const, reason: 'offline' as const })), sendBinary: () => ({ kind: 'blocked', reason: 'offline' }), onAuthenticatedServerEvent: () => ({ dispose() {} }), onPrivateIngress: () => ({ dispose() {} }), onBinary: () => ({ dispose() {} }), dispose() {} },
    conversationKeyScheme: () => ({ name: 'rfc1459', revision: mappingRevision }), ownerSnapshot: () => owner, isCurrent: current,
    indexedDB: new IDBFactory(), configuredNetwork: (networkId) => networkId === owner.networkId,
    canonicalConversationKey: (_owner, conversation) => conversation,
    conversationPolicy: () => ({ revision: 'policy-v1', encryption: 'room-required', eligible: false, room: '#room', epoch: null }),
    authorizePurpose: () => true,
    identityPurposes: { async proveAccount() { return null; }, async verifyServerProof() { return false; }, async verifyTrustedDevice() { return false; } },
    async ensureRegisteredDevice() { return true; }, resolvePeerConversation: () => null,
    directoryRevision: () => null, async authenticatedDirectory() { return null; }, conversationForRoom: () => null,
    roomMembershipFacts: () => null, resolveMediaPeer: async () => null,
    authorizeGroupAuthor: () => false, authorizeRemoteGroupAuthor: () => false, setRoomSendGate: () => undefined,
    async readBackupPassword() { return null; }, async writePrivateBackupSelection() { return false; },
    async readPrivateImport() { return null; }, async readPrivatePassword() { return null; }, authorizeRemovalIntent: async () => false,
    ...overrides,
  };
}

describe('private crypto provider group authoring wiring', () => {
  it('requests the group-author purpose that the Elm bootstrap authorizes when signing group controls', async () => {
    const purposes: string[] = [];
    // Mirrors the bootstrap allowlist: group control signing is authorized as `group-author`.
    const provider = createPrivateCryptoProvider(baseDeps({ authorizePurpose: ({ purpose }) => { purposes.push(purpose); return purpose === 'group-author'; } }));
    try {
      const signature = await provider.privateIdentity.signGroupControl({ owner, conversationId: room, requestId: context('signRequest').requestId, canonicalControl: new Uint8Array([1, 2, 3]) });
      expect(purposes).toContain('group-author');
      expect(signature).toHaveLength(64);
    } finally { provider.dispose(); }
  });

  it('keeps re-deriving a reserved fresh-create genesis head so the confirmed commit passes its head check', async () => {
    const enrolled: { current: { deviceId: string; signer: Uint8Array; wrap: Uint8Array } | null } = { current: null };
    let directory: GroupDeviceDirectorySnapshot | null = null;
    const proofRef = Symbol('fresh-create-proof'); const reservation = Symbol('fresh-create-reservation');
    let consumed = false;
    const provider = createPrivateCryptoProvider(baseDeps({
      ensureRegisteredDevice: async (_owner, deviceId, signer, wrap) => { enrolled.current = { deviceId, signer: signer.slice(), wrap: wrap.slice() }; return true; },
      directoryRevision: (_owner, target) => target === room ? 'directory-v1' : null,
      authenticatedDirectory: async (_owner, accountId) => directory && accountId === owner.accountId
        ? { owner, accountId, revision: 'directory-v1', provenance: 'authenticated-exact-server', trusted: false, snapshot: directory } : null,
      conversationForRoom: (_owner, target) => target === '#room' ? room : null,
      roomMembershipFacts: (_owner, target) => target === room ? { owner, target: room, canonicalTarget: '#room', scheme: 'rfc1459', mappingGeneration: 1,
        membershipGeneration: 1, complete: true, memberCount: 1, memberAccounts: [owner.accountId!], members: [], ownModes: ['q'],
        sourceRevision: 'membership-v1', joined: true, mappingRevision } : null,
      authorizeGroupAuthor: () => true,
      // Bootstrap semantics: the unreserved fact is offered once; planning consumes it.
      freshGenesisFact: async () => consumed || !enrolled.current ? null : {
        kind: 'new-room-genesis', epoch: 0, commitHash: new Uint8Array(32), membershipRevision: 'fresh:op', mappingRevision,
        accountId: owner.accountId!, deviceId: enrolled.current.deviceId, proofRef } satisfies FreshGenesisFact,
      reserveFreshCreateProof: async (_owner, _conversation, ref) => { if (ref !== proofRef || consumed) return null; consumed = true; return reservation; },
      validateFreshCreateReservation: async (_owner, _conversation, ref) => ref === reservation,
    }));
    try {
      expect(await provider.ensureEnrolledIdentity(owner)).toBe(true);
      const local = enrolled.current!;
      const entry = { signerPub: local.signer, encryptionPub: local.wrap };
      const record = { account: 'alice', deviceId: local.deviceId, algorithm: 'onyx-ogc1-v1', publicKey: encodeGroupDeviceDirectoryEntry(entry)!,
        directoryKey: toB64url(local.signer), trusted: true, legacy: false, entry };
      directory = { account: 'alice', devices: [record], trusted: [record], bySigner: new Map([[record.directoryKey, record]]) };
      const plan = await provider.groupProviders.authoring.plan({ ...context('planRequest'), conversationId: room, explicitUserIntent: true, expectedEpoch: 0, expectedCommitHash: new Uint8Array(32) });
      expect(plan).toMatchObject({ priorEpoch: 0, nextEpoch: 1 });
      expect(consumed).toBe(true);
      // Without a backup password the commit stops at the backup gate — after
      // the genesis head, reservation and author checks have all passed.
      const result = await provider.groupProviders.authoring.commit({ ...context('planRequest'), planRef: plan!.planRef, confirmMembershipRevision: plan!.membershipRevision, confirmBackupEnabled: true });
      expect(result).toMatchObject({ phase: 'failed', reason: 'backup-required' });
    } finally { provider.dispose(); }
  });

  it('does not re-derive a genesis head once bootstrap stops validating the reservation', async () => {
    const enrolled: { current: { deviceId: string; signer: Uint8Array; wrap: Uint8Array } | null } = { current: null };
    let directory: GroupDeviceDirectorySnapshot | null = null;
    const proofRef = Symbol('fresh-create-proof'); const reservation = Symbol('fresh-create-reservation');
    let consumed = false; let reservationValid = true;
    const provider = createPrivateCryptoProvider(baseDeps({
      ensureRegisteredDevice: async (_owner, deviceId, signer, wrap) => { enrolled.current = { deviceId, signer: signer.slice(), wrap: wrap.slice() }; return true; },
      directoryRevision: (_owner, target) => target === room ? 'directory-v1' : null,
      authenticatedDirectory: async (_owner, accountId) => directory && accountId === owner.accountId
        ? { owner, accountId, revision: 'directory-v1', provenance: 'authenticated-exact-server', trusted: false, snapshot: directory } : null,
      roomMembershipFacts: (_owner, target) => target === room ? { owner, target: room, canonicalTarget: '#room', scheme: 'rfc1459', mappingGeneration: 1,
        membershipGeneration: 1, complete: true, memberCount: 1, memberAccounts: [owner.accountId!], members: [], ownModes: ['q'],
        sourceRevision: 'membership-v1', joined: true, mappingRevision } : null,
      authorizeGroupAuthor: () => true,
      freshGenesisFact: async () => consumed || !enrolled.current ? null : {
        kind: 'new-room-genesis', epoch: 0, commitHash: new Uint8Array(32), membershipRevision: 'fresh:op', mappingRevision,
        accountId: owner.accountId!, deviceId: enrolled.current.deviceId, proofRef } satisfies FreshGenesisFact,
      reserveFreshCreateProof: async () => { consumed = true; return reservation; },
      validateFreshCreateReservation: async (_owner, _conversation, ref) => reservationValid && ref === reservation,
    }));
    try {
      expect(await provider.ensureEnrolledIdentity(owner)).toBe(true);
      const local = enrolled.current!;
      const entry = { signerPub: local.signer, encryptionPub: local.wrap };
      const record = { account: 'alice', deviceId: local.deviceId, algorithm: 'onyx-ogc1-v1', publicKey: encodeGroupDeviceDirectoryEntry(entry)!,
        directoryKey: toB64url(local.signer), trusted: true, legacy: false, entry };
      directory = { account: 'alice', devices: [record], trusted: [record], bySigner: new Map([[record.directoryKey, record]]) };
      const plan = await provider.groupProviders.authoring.plan({ ...context('planRequest'), conversationId: room, explicitUserIntent: true, expectedEpoch: 0, expectedCommitHash: new Uint8Array(32) });
      expect(plan).not.toBeNull();
      reservationValid = false; // e.g. membership changed after planning
      const result = await provider.groupProviders.authoring.commit({ ...context('planRequest'), planRef: plan!.planRef, confirmMembershipRevision: plan!.membershipRevision, confirmBackupEnabled: true });
      expect(result).toMatchObject({ phase: 'failed', reason: 'membership-changed' });
    } finally { provider.dispose(); }
  });
  it('reopens the required-room send gate for a non-author after a verified bootstrap install (fix H)', async () => {
    const gates: Array<[string, string]> = [];
    const indexedDB = new IDBFactory();
    const liveOwner: OwnerSnapshot = { ...owner, accountId: 'alice' as AccountId };
    const conversationId = '#room' as ConversationId;
    const mappingRevision = 'irc-casemapping-v1:rfc1459';
    const enrolled: { current: { deviceId: string; signerPublicKey: Uint8Array; wrappingPublicKey: Uint8Array } | null } = { current: null };
    let directorySnapshot: GroupDeviceDirectorySnapshot | null = null;
    const provider = createPrivateCryptoProvider({
      ...baseDeps({}), indexedDB,
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
      setRoomSendGate: (_owner, target, state) => { gates.push([String(target), state]); },
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
      expect(gates).toContainEqual(['#room', 'ready']);
    } finally { provider.dispose(); }
  });
  it('removes an installed device by tombstoning its pin so the next epoch can be planned without it', async () => {
    const gates: Array<[string, string]> = [];
    const indexedDB = new IDBFactory();
    const liveOwner: OwnerSnapshot = { ...owner, accountId: 'alice' as AccountId };
    const conversationId = '#room' as ConversationId;
    const mappingRevision = 'irc-casemapping-v1:rfc1459';
    const enrolled: { current: { deviceId: string; signerPublicKey: Uint8Array; wrappingPublicKey: Uint8Array } | null } = { current: null };
    let directorySnapshot: GroupDeviceDirectorySnapshot | null = null;
    const provider = createPrivateCryptoProvider({
      ...baseDeps({}), indexedDB,
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
      authorizeRemoteGroupAuthor: () => true, authorizeGroupAuthor: () => true, authorizeRemovalIntent: async () => true,
      setRoomSendGate: (_owner, target, state) => { gates.push([String(target), state]); },
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
      const head = provider.groupProviders.currentAcceptedHead(liveOwner, conversationId);
      expect(head?.epoch).toBe(1);
      const hash = new Uint8Array(head!.commitHashHex.match(/../gu)!.map((byte) => Number.parseInt(byte, 16)));
      const removal = await provider.groupProviders.recovery.rotateAfterRemoval({ ...context, conversationId, explicitUserIntent: true, expectedEpoch: 1, expectedCommitHash: hash,
        removedAccountId: 'alice' as AccountId, removedDeviceId: remoteDeviceId! });
      // The plan for epoch 2 now excludes the removed device; without a backup password the commit stops at the backup gate.
      expect(removal).toMatchObject({ phase: 'failed', epoch: 2 });
      expect(await provider.isTrustedDevicePinned(liveOwner, 'alice' as AccountId, remoteDeviceId!)).toBe(false);
    } finally { provider.dispose(); }
  });
  it('pins a member device only after an explicit fingerprint review and confirm (fix G)', async () => {
    const enrolled: { current: { deviceId: string; signer: Uint8Array; wrap: Uint8Array } | null } = { current: null };
    const bobPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const bobEntry = { signerPub: new Uint8Array(32).fill(11), encryptionPub: new Uint8Array(await crypto.subtle.exportKey('raw', bobPair.publicKey)) };
    const bobWire = encodeGroupDeviceDirectoryEntry(bobEntry)!;
    const bobDevice = (await deriveGroupDeviceId(bobWire))!;
    const bobRecord = { account: 'bob', deviceId: bobDevice, algorithm: 'onyx-ogc1-v1', publicKey: bobWire, directoryKey: toB64url(bobEntry.signerPub), trusted: true, legacy: false, entry: bobEntry };
    const bobDirectory: GroupDeviceDirectorySnapshot = { account: 'bob', devices: [bobRecord], trusted: [bobRecord], bySigner: new Map([[bobRecord.directoryKey, bobRecord]]) };
    const provider = createPrivateCryptoProvider(baseDeps({
      ensureRegisteredDevice: async (_owner, deviceId, signer, wrap) => { enrolled.current = { deviceId, signer: signer.slice(), wrap: wrap.slice() }; return true; },
      authenticatedDirectory: async (_owner, accountId) => accountId === 'bob' ? { owner, accountId, revision: 'bob-v1', provenance: 'authenticated-exact-server', trusted: false, snapshot: bobDirectory } : null,
      roomMembershipFacts: (_owner, target) => target === room ? { owner, target: room, canonicalTarget: '#room', scheme: 'rfc1459', mappingGeneration: 1,
        membershipGeneration: 1, complete: true, memberCount: 2, memberAccounts: [owner.accountId!, 'bob' as AccountId], members: [], ownModes: ['q'],
        sourceRevision: 'membership-v1', joined: true, mappingRevision } : null,
    }));
    try {
      expect(await provider.ensureEnrolledIdentity(owner)).toBe(true);
      expect(await provider.isTrustedDevicePinned(owner, 'bob' as AccountId, bobDevice)).toBe(false);
      // Not a member, and the local device itself, cannot be reviewed.
      expect(await provider.previewDeviceTrust({ context: context('previewRequest'), conversationId: room, accountId: 'carol', deviceId: bobDevice })).toBeNull();
      expect(await provider.previewDeviceTrust({ context: context('previewRequest'), conversationId: room, accountId: 'alice', deviceId: enrolled.current!.deviceId })).toBeNull();
      const preview = await provider.previewDeviceTrust({ context: context('previewRequest'), conversationId: room, accountId: 'Bob', deviceId: bobDevice });
      const expected = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bobEntry.signerPub))].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(preview).toMatchObject({ accountId: 'bob', deviceId: bobDevice, fingerprintHex: expected });
      // Reviewing alone never pins.
      expect(await provider.isTrustedDevicePinned(owner, 'bob' as AccountId, bobDevice)).toBe(false);
      expect(await provider.confirmDeviceTrust({ context: context('confirmRequest'), previewRef: 'f'.repeat(48), confirm: true })).toBe('blocked');
      expect(await provider.confirmDeviceTrust({ context: context('confirmRequest'), previewRef: preview!.previewRef, confirm: true })).toBe('pinned');
      expect(await provider.isTrustedDevicePinned(owner, 'bob' as AccountId, bobDevice)).toBe(true);
      // The preview ref is single use.
      expect(await provider.confirmDeviceTrust({ context: context('confirmRequest'), previewRef: preview!.previewRef, confirm: true })).toBe('blocked');
    } finally { provider.dispose(); }
  });
});
