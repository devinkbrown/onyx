/** Owner-scoped private WebCrypto custody for the Elm client runtime.
 *
 * Public contract: createPrivateCryptoProvider(deps) returns privateIdentity,
 * sealWorkspaceLocal/openWorkspaceLocal, prepareQueuedPayload/prepareDispatch,
 * groupProviders, retire and dispose. CryptoKeys and identity descriptors are
 * closure-owned and never appear in events or Elm values. Main supplies the
 * authenticated policy/directory/transport adapters; this module owns key
 * creation, local AEAD, durable private key custody, and generation fencing.
 */
import type {
  AccountId, ConversationId, ConversationKeyScheme, OwnerSnapshot, PrivateIdentity, Transport, RequestContext,
  RequestId, MessageId,
} from './contracts';
import { makeMessageId, makeNetworkId, makeRequestId } from './contracts';
import { prepareGroupWelcome } from '../../src/lib/e2ee/groupWelcome';
import { RoomEpochKeyring } from '../../src/lib/e2ee/groupKeyring';
import { GroupSession, type VerifiedGroupEpochMaterial } from '../../src/lib/e2ee/groupSession';
import { createGroupControlSessionAdapter, type GroupControlSessionAdapter, type GroupControlAdapterOutcome, type GroupControlAppliedEvidence } from '../../src/lib/e2ee/groupControlSessionAdapter';
import { decodeGroupDeviceDirectoryEntry, deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry, type GroupDeviceDirectorySnapshot } from '../../src/lib/e2ee/groupDeviceDirectory';
import type { TrustedGroupSignerPin } from '../../src/lib/e2ee/trustedGroupSigner';
import { ENVELOPE_PREFIX, MULTI_ENVELOPE_PREFIX, fromB64url, isValidDmEnvelope, openDmWithDeviceKey, toB64url } from '../../src/lib/e2ee/dmCipher';
import { openGroupMessage, parseGroupEnvelope } from '../../src/lib/e2ee/groupEnvelope';
import { isValidP256UncompressedPublicKey } from '../../src/lib/e2ee/groupDeviceDirectory';
import { createGroupAuthoring, type GroupAuthoringDeps, type GroupHead } from './group-authoring';
import { buildMembershipDigest, type VerifiedGroupDirectory, type VerifiedGroupDevice } from './group-directory-trust';
import { createGroupRecovery, type GroupRecoveryDeps } from './group-recovery';
import { decryptPortableGroupBackup, encryptGroupBackup, encryptPortableGroupBackup, type PortableGroupBackup, type BackupMetadata } from './crypto-backup';
import { localOwnerStableKey, type LocalOwnerGrant as WorkspaceOwnerGrant, type LocalWorkspaceScope } from './local-workspace-owner';
import { buildGroupCommitContext, computeGroupEpochKeyCommitment, decodeGroupCommit, hashGroupCommit } from '../../src/lib/e2ee/groupCommit';
import { parseGroupControlPayload, signGroupControlPayload, verifyGroupControlPayload } from '../../src/lib/e2ee/groupControlPayload';
import { normalizeCase } from '../../src/lib/irc/parser';

const DB_NAME = 'onyx-elm-private';
const DB_VERSION = 2;
const STORES = ['identity', 'local-aead', 'epoch-backups', 'trusted-signers', 'accepted-controls', 'room-author-intents'] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_LOCAL_BYTES = 1024 * 1024;
const MAX_QUEUED_BYTES = 64 * 1024;
const MAX_QUEUED_RECORD_BYTES = 262_144;
const MAX_QUEUED_CIPHERTEXT_BYTES = 262_172;
const LOCAL_QUEUE_POLICY = 'local-sealed-intent-v1';
const CONTROL = /[\u0000-\u001f\u007f]/u;

type KeyPairRecord = { readonly scope: string; readonly deviceId: string; readonly signing: CryptoKeyPair; readonly wrapping: CryptoKeyPair };
type LocalKeyRecord = { readonly scope: string; readonly key: CryptoKey };
type IntentMacKeyRecord = { readonly kind: 'intent-mac-key'; readonly scope: string; readonly key: CryptoKey };
type BackupRecord = { readonly key: string; readonly scope: string; readonly room: string; readonly epoch: number; readonly bytes: Uint8Array };
type PrivateDB = { db: IDBDatabase; durable: boolean };
type AcceptedControlRecord = { readonly owner: OwnerSnapshot; readonly evidence: GroupControlAppliedEvidence; readonly acceptedMembershipRevision: string; readonly acceptedMappingScheme: 'ascii' | 'rfc1459' | 'strict-rfc1459'; readonly acceptedMappingRevision: string };
type RestoredAcceptedControl = { readonly evidence: GroupControlAppliedEvidence; readonly acceptedMembershipRevision: string; readonly acceptedMappingScheme: 'ascii' | 'rfc1459' | 'strict-rfc1459'; readonly acceptedMappingRevision: string };
type HistoricalAcceptedControl = RestoredAcceptedControl & { readonly scope: string };
export type LocalCryptoResult = { readonly kind: 'sealed' | 'opened' | 'unavailable' | 'stale-owner' | 'invalid'; readonly bytes?: Uint8Array };
/** Private main-minted context. It grants local custody only; it is never a live send credential. */
export type CryptoPolicy = {
  readonly revision: string;
  readonly encryption: 'plain' | 'dm-required' | 'room-required' | 'unknown';
  readonly eligible: boolean;
  readonly room: string | null;
  readonly epoch: number | null;
};
export type SafeGroupIngressResult = { readonly status: GroupControlAdapterOutcome['status']; readonly reason: GroupControlAdapterOutcome['reason'] | null; readonly room: string | null; readonly epoch: number | null; readonly fromAccount: string | null; readonly fromDevice: string | null; readonly commitId: Uint8Array | null; readonly commitHash: Uint8Array | null; readonly membershipDigest: Uint8Array | null; readonly inputKind: 'commit' | 'welcome' | null; readonly receiptRef: symbol | null };
export type BootstrapPreview = { readonly previewRef: string; readonly epoch: number; readonly commitHashHex: string; readonly signerAccountId: AccountId; readonly signerDeviceId: string; readonly signerFingerprint: string; readonly recipientDeviceId: string; readonly historyVerified: false };
export type ProviderGroupServices = {
  readonly authoring: ReturnType<typeof createGroupAuthoring>;
  readonly recovery: ReturnType<typeof createGroupRecovery>;
  readonly ingestGroupControl: PrivateGroupOperations['ingestGroupControl'];
  readonly sealRoom: (owner: OwnerSnapshot, conversationId: ConversationId, plaintext: string) => Promise<string | null>;
  readonly openRoom: (owner: OwnerSnapshot, conversationId: ConversationId, envelope: string) => Promise<string | null>;
  /** Opens direct-message ciphertext only after authenticated account routing and pinned-device verification. */
  readonly openDmFromCurrentPeer: (input: { context: RequestContext; conversationId: ConversationId; envelope: string }) => Promise<string | null>;
  /** Decrypts stored history only from a locally accepted/recovered epoch. */
  readonly openHistoricalRoom: (input: { context: RequestContext; grant: WorkspaceOwnerGrant; conversationId: ConversationId; room: string; envelope: string }) => Promise<string | null>;
  readonly currentAcceptedHead: (owner: OwnerSnapshot, conversationId: ConversationId) => {
    readonly kind: 'established'; readonly epoch: number; readonly commitHashHex: string;
    readonly membershipRevision: string; readonly mappingRevision: string; readonly accountId: AccountId; readonly deviceId: string;
  } | null;
  readonly retire: (owner: OwnerSnapshot, conversationId: ConversationId) => void;
  readonly membershipChanged: (owner: OwnerSnapshot, conversationId: ConversationId) => void;
};
export type PrivateCryptoProvider = ReturnType<typeof createPrivateCryptoProvider>;
export type FreshGenesisFact = Omit<Extract<GroupHead, { kind: 'new-room-genesis' }>, 'membershipDigest'> & { readonly membershipDigest?: Uint8Array };
export type PortableBackupReason = 'stale-owner' | 'workspace-locked' | 'epoch-material-unavailable' | 'evidence-unavailable' | 'wrong-network' | 'wrong-account' | 'wrong-room' | 'invalid-container' | 'wrong-password-or-corrupt' | 'unsupported-version' | 'checkpoint-conflict' | 'explicit-trust-required' | 'storage-unavailable' | 'cancelled';
export type PortableBackupPreview = { readonly previewRef: string; readonly networkId: string; readonly accountId: string; readonly conversationId: ConversationId; readonly epoch: number; readonly commitHashHex: string; readonly signerAccountId: string; readonly signerDeviceId: string; readonly signerFingerprintHex: string; readonly trust: 'matches-local-receipt' | 'new-history-checkpoint'; readonly historyOnly: true };
export type PortableBackupResult = { readonly kind: 'encrypted'; readonly bytes: Uint8Array } | { readonly kind: 'blocked'; readonly reason: PortableBackupReason };
export interface PrivateCryptoDeps {
  readonly transport: Transport;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly validateWorkspaceGrant?: (grant: WorkspaceOwnerGrant) => boolean;
  /** Current selected local workspace grant, only when it matches this UI owner. */
  readonly workspaceGrantForOwner?: (owner: OwnerSnapshot) => WorkspaceOwnerGrant | null;
  /** Opaque local selection identity, including a selected workspace that does not match the live UI owner. */
  readonly workspaceSelectionRef?: () => string | null;
  readonly ensureImportedHistoryWorkspace?: (input: { context: RequestContext; networkId: import('./contracts').NetworkId; accountId: AccountId; checkpointRef: symbol; explicit: true }) => Promise<WorkspaceOwnerGrant | null>;
  readonly indexedDB: IDBFactory | null;
  readonly canonicalConversationKey: (owner: OwnerSnapshot, conversationId: ConversationId) => string | null;
  /** Uses only the captured selected-workspace ticket/scheme; grants no live wire authority. */
  readonly canonicalWorkspaceTarget?: (context: RequestContext, grant: WorkspaceOwnerGrant, conversationId: ConversationId) => string | null;
  readonly conversationKeyScheme: (owner: OwnerSnapshot) => ConversationKeyScheme | null;
  readonly conversationPolicy: (owner: OwnerSnapshot, conversationId: ConversationId) => CryptoPolicy | null;
  readonly authorizePurpose: (input: { readonly owner: OwnerSnapshot; readonly purpose: string; readonly requestId?: RequestId }) => boolean;
  readonly identityPurposes: Pick<PrivateIdentity,
    'proveAccount' | 'verifyServerProof' | 'verifyTrustedDevice'>;
  /** Device identity registration and authenticated directory are main-owned. */
  readonly ensureRegisteredDevice: (owner: OwnerSnapshot, deviceId: string, signingPublic: Uint8Array, wrappingPublic: Uint8Array) => Promise<boolean>;
  /** Peer identity must come from complete current WHOX/WHOIS account proof, never nickname casing. */
  readonly resolvePeerConversation: (owner: OwnerSnapshot, conversationId: ConversationId) => {
    readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly canonicalTarget: string; readonly accountId: AccountId;
    readonly mappingGeneration: number; readonly routingRevision: string; readonly source: 'authenticated-server';
  } | null;
  readonly directoryRevision: (owner: OwnerSnapshot, conversationId: ConversationId) => string | null;
  readonly authenticatedDirectory: (owner: OwnerSnapshot, accountId: AccountId) => Promise<{
    readonly owner: OwnerSnapshot; readonly accountId: AccountId; readonly revision: string;
    readonly provenance: 'authenticated-exact-server'; readonly trusted: false; readonly snapshot: GroupDeviceDirectorySnapshot;
  } | null>;
  readonly conversationForRoom: (owner: OwnerSnapshot, room: string) => ConversationId | null;
  readonly roomPolicyFacts?: (owner: OwnerSnapshot, conversationId: ConversationId) => { readonly owner?: OwnerSnapshot; readonly canonicalTarget?: string | null; readonly scheme?: 'ascii' | 'rfc1459' | 'strict-rfc1459' | null; readonly mappingRevision: string; readonly joined: boolean } | null;
  readonly roomMembershipFacts: (owner: OwnerSnapshot, conversationId: ConversationId) => {
    readonly owner?: OwnerSnapshot; readonly target?: ConversationId; readonly canonicalTarget?: string; readonly scheme?: 'ascii' | 'rfc1459' | 'strict-rfc1459';
    readonly mappingGeneration?: number; readonly membershipGeneration?: number; readonly complete?: boolean; readonly memberCount?: number;
    readonly memberAccounts?: readonly AccountId[]; readonly members?: readonly unknown[]; readonly ownNick?: string;
    readonly ownModes?: readonly string[]; readonly hiddenOrAuditorium?: boolean; readonly sourceRevision?: string;
    readonly joined: boolean; readonly mappingRevision: string;
  } | null;
  readonly resolveMediaPeer: (owner: OwnerSnapshot, peerNick: string, attachmentId: Uint8Array) => Promise<{ readonly accountId: AccountId; readonly deviceId: string } | null>;
  /** Main may authorize only a newly CREATEd room genesis; established heads are provider-derived. */
  readonly freshGenesisFact?: (owner: OwnerSnapshot, conversationId: ConversationId) => Promise<FreshGenesisFact | null>;
  readonly authorizeGroupAuthor: GroupAuthoringDeps['authorizeAuthor'];
  /** Current server-authorized membership/role fact for a remote commit signer. */
  readonly authorizeRemoteGroupAuthor: (owner: OwnerSnapshot, room: string, accountId: AccountId, deviceId: string) => boolean | Promise<boolean>;
  readonly reserveFreshCreateProof?: GroupAuthoringDeps['reserveGenesisProof'];
  readonly validateFreshCreateReservation?: GroupAuthoringDeps['validateGenesisReservation'];
  readonly setRoomSendGate: GroupAuthoringDeps['setRoomSendGate'];
  readonly readBackupPassword: (owner: OwnerSnapshot, conversationId: ConversationId, epoch: number) => Promise<Uint8Array | null>;
  readonly writePrivateBackupSelection: GroupRecoveryDeps['writePrivateBackupSelection'];
  readonly readPrivateImport: (inputRef: symbol, passwordRef: symbol, context: RequestContext) => Promise<{ readonly bytes: Uint8Array; readonly password: Uint8Array } | null>;
  readonly configuredNetwork: (networkId: string) => boolean;
  readonly readPrivatePassword: (ref: symbol, context: RequestContext) => Promise<Uint8Array | null>;
  readonly authorizeRemovalIntent: GroupRecoveryDeps['authorizeRemovalIntent'];
  readonly onReadiness?: (owner: OwnerSnapshot, state: 'ready' | 'volatile' | 'unavailable' | 'stale') => void;
}
export interface PrivateGroupOperations {
  readonly ownerCurrent: (owner: OwnerSnapshot) => boolean;
  readonly getSigningPublic: (owner: OwnerSnapshot, conversationId: ConversationId) => Promise<{ deviceId: string; signerPublicKey: Uint8Array; wrapPublicKey: Uint8Array; revision: string } | null>;
  readonly sign: (input: { owner: OwnerSnapshot; conversationId: ConversationId; requestId: RequestId; canonicalControl: Uint8Array }) => Promise<Uint8Array | null>;
  readonly prepareWelcome: typeof prepareGroupWelcome;
  readonly ingestGroupControl: (input: { context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }; line: string }) => Promise<SafeGroupIngressResult>;
  readonly verifyIngressReceipt: GroupAuthoringDeps['verifyIngressReceipt'];
  readonly consumeIngressReceipt: (receiptRef: symbol, owner: OwnerSnapshot, room: string, epoch: number, accountId: string, deviceId: string, inputKind: 'commit' | 'welcome', commitId: Uint8Array, commitHash: Uint8Array, membershipDigest: Uint8Array) => boolean;
  readonly retireRoom: (owner: OwnerSnapshot, room: string) => void;
  readonly membershipChanged: (owner: OwnerSnapshot, room: string) => void;
}

function equalOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let delta = 0; for (let i = 0; i < a.length; i++) delta |= a[i]! ^ b[i]!;
  return delta === 0;
}
type QueuedMessageKind = 'message' | 'action';
type CanonicalQueuedIntent = { readonly operation: 'privmsg' | 'memo-send'; readonly targetKey: string; readonly messageKind: QueuedMessageKind; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null; readonly body: string; readonly bytes: Uint8Array };
function canonicalQueuedIntent(input: { operation: 'privmsg' | 'memo-send'; targetKey: string; messageKind: QueuedMessageKind; replyTo: string | null; audiencePrefix: string | null; body: Uint8Array }): CanonicalQueuedIntent | null {
  if (!(input.body instanceof Uint8Array) || input.body.byteLength > MAX_QUEUED_BYTES
    || !/^[^\s\u0000-\u001f\u007f]{1,512}$/u.test(input.targetKey)
    || (input.messageKind !== 'message' && input.messageKind !== 'action')
    || input.replyTo !== null && (!makeMessageId(input.replyTo) || input.replyTo.length > 512)
    || input.audiencePrefix !== null && !/^[!-~]$/u.test(input.audiencePrefix)
    || input.operation === 'memo-send' && (input.messageKind !== 'message' || input.replyTo !== null || input.audiencePrefix !== null)) return null;
  let body: string;
  try { body = decoder.decode(input.body); } catch { return null; }
  const canonicalBody = encoder.encode(body);
  if (!equalBytes(canonicalBody, input.body)) { canonicalBody.fill(0); return null; }
  canonicalBody.fill(0);
  for (const char of body) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a || cp === 0x7f || cp === 0x0d) return null;
  }
  const record = encoder.encode(JSON.stringify([2, input.operation, input.targetKey, input.messageKind, input.replyTo, input.audiencePrefix, body]));
  if (record.byteLength > MAX_QUEUED_RECORD_BYTES) { record.fill(0); return null; }
  return { operation: input.operation, targetKey: input.targetKey, messageKind: input.messageKind,
    replyTo: input.replyTo as MessageId | null, audiencePrefix: input.audiencePrefix, body, bytes: record };
}
function validLegacyQueueBody(bytes: Uint8Array): boolean {
  if (bytes.byteLength > MAX_QUEUED_BYTES) return false;
  try {
    const value = decoder.decode(bytes); const roundtrip = encoder.encode(value);
    const same = equalBytes(roundtrip, bytes); roundtrip.fill(0);
    return same && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value);
  } catch { return false; }
}
function wipeEvidence(evidence: GroupControlAppliedEvidence | undefined): void {
  if (!evidence) return;
  evidence.commitId.fill(0); evidence.commitHash.fill(0); evidence.priorCommitHash.fill(0);
  evidence.membershipDigest.fill(0); evidence.newEpochKeyCommitment.fill(0);
  evidence.acceptedSignerPublicKey?.fill(0);
}
function stableScope(owner: OwnerSnapshot, deviceId = ''): string | null {
  if (!owner.networkId || CONTROL.test(owner.networkId) || owner.accountId && CONTROL.test(owner.accountId)) return null;
  if (owner.accountId) return `account\0${owner.networkId}\0${owner.accountId}\0${deviceId}`;
  return owner.physicalRef ? `guest\0${owner.networkId}\0${owner.physicalRef}` : null;
}
function legacyWorkspaceKey(scope: LocalWorkspaceScope): string {
  return `${scope.kind}\0${scope.networkId}\0${scope.kind === 'account' ? scope.accountId : scope.physicalRef}\0${scope.installationDeviceId}`;
}
function identityLookupScope(owner: OwnerSnapshot): string | null {
  if (!owner.networkId || CONTROL.test(owner.networkId)) return null;
  return owner.accountId && !CONTROL.test(owner.accountId) ? `account\0${owner.networkId}\0${owner.accountId}\0installation`
    : owner.physicalRef ? `guest\0${owner.networkId}\0${owner.physicalRef}` : null;
}
function requestId(): RequestId { return [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('') as RequestId; }
function copy(buf: ArrayBuffer): Uint8Array { return new Uint8Array(buf.slice(0)); }
function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> { return Uint8Array.from(bytes); }
function hex(bytes: Uint8Array): string { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function verifyPortableCheckpoint(payload: PortableGroupBackup, epochKey: Uint8Array, signer: Uint8Array): Promise<GroupControlAppliedEvidence | null> {
  const route = { channel: payload.room, kind: 'commit' as const, fromAccount: payload.receipt.fromAccount, fromDevice: payload.receipt.fromDevice };
  const parts = parseGroupControlPayload(payload.receipt.signedCommitPayload);
  if (!parts || parts.kind !== 'commit' || parts.epoch !== payload.epoch || !equalBytes(parts.signerPub, signer)) return null;
  const verified = await verifyGroupControlPayload(payload.receipt.signedCommitPayload, route, signer);
  if (!verified) return null;
  const record = decodeGroupCommit(verified.body);
  if (!record) { verified.body.fill(0); return null; }
  const expectedDigest = fromHex(payload.membershipDigestHex);
  try {
    if (Number(record.nextEpoch) !== payload.epoch || !expectedDigest || !equalBytes(record.membershipDigest, expectedDigest)) return null;
    const commitContext = buildGroupCommitContext({ room: payload.room, fromAccount: payload.receipt.fromAccount,
      fromDevice: payload.receipt.fromDevice, priorEpoch: record.priorEpoch, nextEpoch: record.nextEpoch, commitId: record.commitId });
    if (!commitContext) return null;
    let hash: Uint8Array | null = null;
    try {
      hash = await hashGroupCommit(record, commitContext);
      if (!hash || hex(hash) !== payload.commitHashHex) return null;
      const commitment = await computeGroupEpochKeyCommitment({ room: payload.room, nextEpoch: record.nextEpoch,
        commitId: record.commitId, membershipDigest: record.membershipDigest, epochKey });
      if (!commitment) return null;
      try {
        if (!equalBytes(commitment, record.newEpochKeyCommitment)) return null;
        const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoBytes(signer)));
        let fingerprintHex: string;
        try { fingerprintHex = hex(fingerprint); } finally { fingerprint.fill(0); }
        if (fingerprintHex !== payload.receipt.signerFingerprintHex) return null;
        return { room: payload.room, fromAccount: payload.receipt.fromAccount, fromDevice: payload.receipt.fromDevice,
          epoch: payload.epoch, commitId: record.commitId.slice(), commitHash: hash.slice(), priorEpoch: Number(record.priorEpoch),
          priorCommitHash: record.priorCommitHash.slice(), membershipDigest: record.membershipDigest.slice(),
          newEpochKeyCommitment: record.newEpochKeyCommitment.slice(), inputKind: 'commit', signedCommitPayload: payload.receipt.signedCommitPayload,
          acceptedSignerPublicKey: signer.slice(), acceptedSignerTrust: payload.receipt.acceptanceTrust };
      } finally { commitment.fill(0); }
    } finally { hash?.fill(0); commitContext.fill(0); }
  } finally {
    expectedDigest?.fill(0); verified.body.fill(0); record.commitId.fill(0); record.priorCommitHash.fill(0);
    record.membershipDigest.fill(0); record.newEpochKeyCommitment.fill(0);
  }
}
function validIntentMacKey(key: CryptoKey | undefined): key is CryptoKey {
  if (!key || key.type !== 'secret' || key.algorithm.name !== 'HMAC' || key.extractable || !key.usages.includes('sign')) return false;
  return (key.algorithm as HmacKeyAlgorithm).hash.name === 'SHA-256';
}
function fromHex(value: string): Uint8Array | null { if (!/^(?:[0-9a-f]{2})+$/u.test(value)) return null; return Uint8Array.from(value.match(/../gu)!.map((byte) => Number.parseInt(byte, 16))); }
function requestResult(db: IDBDatabase, store: string, mode: IDBTransactionMode, key: IDBValidKey, value?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(store, mode); } catch (error) { reject(error); return; }
    const objectStore = tx.objectStore(store);
    const req = value === undefined ? objectStore.get(key) : objectStore.put(value, key);
    let result: unknown;
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => reject(req.error ?? new Error('idb-request'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('idb-transaction'));
    tx.onabort = () => reject(tx.error ?? new Error('idb-abort'));
  });
}
function persistAcceptedAndPromoteEscrow(db: IDBDatabase, acceptedKey: string, acceptedRow: unknown, escrowKey: string, expected: { scope: string; room: string; epoch: number; commitHashHex: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction; try { tx = db.transaction(['accepted-controls', 'epoch-backups'], 'readwrite'); } catch { resolve(false); return; }
    const accepted = tx.objectStore('accepted-controls'); const backups = tx.objectStore('epoch-backups');
    accepted.put(acceptedRow, acceptedKey);
    const get = backups.get(escrowKey); let promoted = false;
    get.onsuccess = () => {
      const row = get.result as { scope?: unknown; room?: unknown; epoch?: unknown; commitHashHex?: unknown; state?: unknown; ciphertext?: unknown } | undefined;
      if (row?.scope === expected.scope && row.room === expected.room && row.epoch === expected.epoch
        && row.commitHashHex === expected.commitHashHex && row.state === 'staged' && row.ciphertext instanceof Uint8Array) {
        backups.put({ ...row, state: 'accepted', receiptLink: acceptedKey }, escrowKey); promoted = true;
      }
    };
    tx.oncomplete = () => resolve(promoted); tx.onerror = tx.onabort = () => resolve(false);
  });
}
function addIfAbsent(db: IDBDatabase, store: string, key: IDBValidKey, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(store, 'readwrite'); } catch { resolve(false); return; }
    const req = tx.objectStore(store).add(value, key);
    let added = true;
    req.onerror = (event) => { if (req.error?.name === 'ConstraintError') { added = false; event.preventDefault(); event.stopPropagation(); } else added = false; };
    tx.oncomplete = () => resolve(added); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false);
  });
}
function deleteIfNonce(db: IDBDatabase, store: string, key: IDBValidKey, nonce: string): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction; try { tx = db.transaction(store, 'readwrite'); } catch { resolve(false); return; }
    const objectStore = tx.objectStore(store); const get = objectStore.get(key); let deleted = false;
    get.onsuccess = () => { if ((get.result as { nonce?: unknown } | undefined)?.nonce === nonce) { objectStore.delete(key); deleted = true; } };
    tx.oncomplete = () => resolve(deleted); tx.onerror = tx.onabort = () => resolve(false);
  });
}
function transitionAuthorIntent(db: IDBDatabase, key: IDBValidKey, nonce: string, expected: Record<string, unknown>, stage: 'admitted' | 'unknown'): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction; try { tx = db.transaction('room-author-intents', 'readwrite'); } catch { resolve(false); return; }
    const store = tx.objectStore('room-author-intents'); const get = store.get(key); let updated = false;
    get.onsuccess = () => {
      const prior = get.result as Record<string, unknown> | undefined;
      if (!prior || prior.kind !== 'author-intent' || prior.nonce !== nonce
        || prior.scope !== expected.scope || prior.room !== expected.room || prior.priorEpoch !== expected.priorEpoch
        || prior.priorHash !== expected.priorHash || prior.nextEpoch !== expected.nextEpoch
        || prior.commitId !== expected.commitId || prior.commitHash !== expected.commitHash
        || (prior.stage !== 'prepared' && prior.stage !== stage)
        || (prior.stage === 'unknown' && stage === 'admitted')) return;
      store.put({ ...expected, stage }, key); updated = true;
    };
    tx.oncomplete = () => resolve(updated); tx.onerror = tx.onabort = () => resolve(false);
  });
}
function claimLease(db: IDBDatabase, key: IDBValidKey, nonce: string, now: number): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction; try { tx = db.transaction('room-author-intents', 'readwrite'); } catch { resolve(false); return; }
    const store = tx.objectStore('room-author-intents'); const get = store.get(key); let claimed = false;
    get.onsuccess = () => {
      const existing = get.result as { readonly expiresAt?: unknown; readonly nonce?: unknown } | undefined;
      if (!get.result) {
        store.put({ kind: 'lease', nonce, expiresAt: now + 30_000 }, key); claimed = true;
      } else if (existing && typeof existing.expiresAt === 'number' && Number.isSafeInteger(existing.expiresAt)
        && existing.expiresAt <= now && typeof existing.nonce === 'string') {
        store.put({ kind: 'lease', nonce, expiresAt: now + 30_000 }, key); claimed = true;
      }
    };
    tx.oncomplete = () => resolve(claimed); tx.onerror = tx.onabort = () => resolve(false);
  });
}
function renewLease(db: IDBDatabase, key: IDBValidKey, nonce: string, now: number): Promise<number | null> {
  return new Promise((resolve) => {
    let tx: IDBTransaction; try { tx = db.transaction('room-author-intents', 'readwrite'); } catch { resolve(null); return; }
    const store = tx.objectStore('room-author-intents'); const get = store.get(key); let renewed = false;
    get.onsuccess = () => { const result = get.result as { nonce?: unknown; expiresAt?: unknown } | undefined; if (result?.nonce === nonce && typeof result.expiresAt === 'number' && Number.isSafeInteger(result.expiresAt) && result.expiresAt > now) { store.put({ kind: 'lease', nonce, expiresAt: now + 30_000 }, key); renewed = true; } };
    tx.oncomplete = () => resolve(renewed ? now + 30_000 : null); tx.onerror = tx.onabort = () => resolve(null);
  });
}
function backupUsage(db: IDBDatabase, scope: string): Promise<{ count: number; bytes: number } | null> {
  return new Promise((resolve) => {
    let tx: IDBTransaction; try { tx = db.transaction('epoch-backups', 'readonly'); } catch { resolve(null); return; }
    const req = tx.objectStore('epoch-backups').openCursor(); let count = 0; let bytes = 0; let failed = false;
    req.onsuccess = () => {
      const cursor = req.result; if (!cursor) return;
      const row = cursor.value as Partial<BackupRecord>;
      if (row.scope === scope) { count++; bytes += row.bytes?.byteLength ?? 0; }
      if (count > 128 || bytes > 64 * 1024 * 1024) { failed = true; try { tx.abort(); } catch { /* already finishing */ } return; }
      cursor.continue();
    };
    req.onerror = () => { failed = true; try { tx.abort(); } catch { /* already finishing */ } };
    tx.oncomplete = () => resolve(failed ? null : { count, bytes }); tx.onerror = tx.onabort = () => resolve(null);
  });
}
function openPrivateDatabase(factory: IDBFactory | null): Promise<PrivateDB | null> {
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PrivateDB | null) => { if (!settled) { settled = true; resolve(value); } };
    let request: IDBOpenDBRequest;
    try { request = factory.open(DB_NAME, DB_VERSION); } catch { finish(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      if (db.version !== DB_VERSION || STORES.some((store) => !db.objectStoreNames.contains(store))) { db.close(); finish(null); return; }
      db.onversionchange = () => db.close();
      finish({ db, durable: true });
    };
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
    setTimeout(() => finish(null), 3000);
  });
}

export function createPrivateCryptoProvider(deps: PrivateCryptoDeps) {
  let disposed = false;
  let generation = 0;
  let opening: Promise<PrivateDB | null> | null = null;
  let db: PrivateDB | null = null;
  let identity: KeyPairRecord | null = null;
  let identityPromise: Promise<boolean> | null = null;
  let identityPromiseScope: string | null = null;
  const historicalKeyrings = new Map<string, RoomEpochKeyring>();
  const registeredScopes = new Set<string>();
  const sessions = new Map<string, GroupSession>();
  const acceptedCommits = new Map<string, AcceptedControlRecord>();
  const historicalAccepted = new Map<string, HistoricalAcceptedControl>();
  // This is a local history checkpoint binding, not accepted live-head
  // authority. It only associates a verified history key with its exact hash.
  const historyCheckpointBindings = new Map<string, { readonly scope: string; readonly room: string; readonly epoch: number;
    readonly commitHashHex: string; readonly escrowState: 'accepted' | 'history-only' }>();
  const retiredOwners = new Set<string>();
  const verifiedForkCandidates = new Map<string, { owner: OwnerSnapshot; priorEpoch: number; priorHash: Uint8Array; commitHash: Uint8Array }>();
  const bootstrapCandidates = new Map<string, { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly room: string; readonly preview: BootstrapPreview; readonly mappingRevision: string; readonly directoryRevision: string; readonly membershipDigestHex: string; readonly priorHashHex: string; readonly expiresAt: number; approved: boolean }>();
  const portablePreviews = new Map<string, { readonly owner: OwnerSnapshot; readonly grantRef: symbol | null; readonly selectionRef: string | null; readonly checkpointRef: symbol; readonly expiresAt: number; readonly payload: PortableGroupBackup; readonly epochKey: Uint8Array; readonly signerPublicKey: Uint8Array; readonly preview: PortableBackupPreview; timer: ReturnType<typeof setTimeout> | null }>();
  const approvedHistoryCheckpoints = new Map<symbol, { networkId: string; accountId: string; owner: OwnerSnapshot; expiresAt: number }>();
  const ingressReceipts = new Map<symbol, { owner: OwnerSnapshot; evidence: GroupControlAppliedEvidence; outcome: GroupControlAdapterOutcome }>();
  let groupAdapter: GroupControlSessionAdapter | null = null;
  let adapterOwner: OwnerSnapshot | null = null;
  let ingestTail: Promise<void> = Promise.resolve();
  let ingestQueued = 0;
  const sharedAgreements = new Map<symbol, CryptoKey>();
  const workspaceLocalKeys = new Map<string, CryptoKey>();
  const intentMacKeys = new Map<string, CryptoKey>();
  const authorLeases = new Map<{ isCurrent: () => boolean; release: () => void }, OwnerSnapshot>();
  const ownerLifecycleKey = (owner: OwnerSnapshot): string => JSON.stringify([owner.networkId, owner.accountId,
    owner.accountGeneration, owner.connectionGeneration, owner.physicalRef, owner.ownerRef]);
  const active = (owner: OwnerSnapshot, token = generation) => !disposed && token === generation
    && !retiredOwners.has(ownerLifecycleKey(owner)) && equalOwner(owner, deps.ownerSnapshot()) && deps.isCurrent(owner);
  function historyKeyringFor(grant: WorkspaceOwnerGrant): RoomEpochKeyring {
    const key = grant.stableLocalOwnerKey;
    let value = historicalKeyrings.get(key);
    if (!value) {
      value = new RoomEpochKeyring(); historicalKeyrings.set(key, value);
      while (historicalKeyrings.size > 32) {
        const oldest = historicalKeyrings.keys().next().value as string | undefined;
        if (!oldest) break;
        historicalKeyrings.get(oldest)?.clear(); historicalKeyrings.delete(oldest);
      }
    }
    return value;
  }
  const historicalEvidenceKey = (scope: string, room: string, epoch: number, hash: string): string => `${scope}\0${room}\0${epoch}\0${hash}`;
  const portableEscrowKey = (scope: string, room: string, epoch: number, hash: string): string => JSON.stringify(['epoch-escrow-v1', scope, room, epoch, hash]);
  function clearPortablePreview(ref: string): void {
    const item = portablePreviews.get(ref); if (!item) return;
    if (item.timer) clearTimeout(item.timer);
    item.epochKey.fill(0); item.signerPublicKey.fill(0); portablePreviews.delete(ref);
  }
  async function writeEpochEscrow(owner: OwnerSnapshot, evidence: GroupControlAppliedEvidence, material: VerifiedGroupEpochMaterial): Promise<boolean> {
    const context = { schemaVersion: 1 as const, requestId: requestId(), owner };
    const grant = deps.workspaceGrantForOwner?.(owner);
    if (!grant || !workspaceGrantValid(grant) || grant.scope.kind !== 'account' || !owner.accountId || grant.scope.accountId !== owner.accountId
      || !active(owner) || material.epoch !== BigInt(evidence.epoch) || !equalBytes(material.commitHash, evidence.commitHash)) return false;
    const signer = evidence.acceptedSignerPublicKey;
    if (!signer || signer.length !== 32 || !evidence.signedCommitPayload || !evidence.acceptedSignerTrust) return false;
    const facts = deps.roomMembershipFacts(owner, deps.conversationForRoom(owner, evidence.room) ?? ('' as ConversationId));
    if (!facts?.joined || (facts.scheme !== 'ascii' && facts.scheme !== 'rfc1459' && facts.scheme !== 'strict-rfc1459')) return false;
    const hash = hex(evidence.commitHash); const scope = grant.stableLocalOwnerKey;
    const signerFingerprintBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoBytes(signer)));
    if (!active(owner) || !workspaceGrantValid(grant) || !localRequestCurrent(context)) { signerFingerprintBytes.fill(0); return false; }
    const signerFingerprintHex = hex(signerFingerprintBytes); signerFingerprintBytes.fill(0);
    const payload: PortableGroupBackup = { version: 2, kind: 'room-epoch-history', networkId: String(owner.networkId), accountId: String(owner.accountId),
      exportingDeviceId: identity?.deviceId ?? evidence.fromDevice, room: evidence.room, epoch: evidence.epoch,
      commitHashHex: hash, membershipDigestHex: hex(evidence.membershipDigest),
      epochKeyB64url: toB64url(material.epochKey),
      receipt: { signedCommitPayload: evidence.signedCommitPayload, fromAccount: evidence.fromAccount, fromDevice: evidence.fromDevice,
        signerPublicKeyB64url: toB64url(signer), signerFingerprintHex, acceptanceTrust: evidence.acceptedSignerTrust,
        acceptedMembershipRevision: `accepted:${hash}`, acceptedMappingScheme: facts.scheme,
        provenance: 'source-observed-acceptance' } };
    const plaintext = encoder.encode(JSON.stringify(payload));
    if (plaintext.byteLength > 64 * 1024) { plaintext.fill(0); return false; }
    const sealed = await workspaceCrypt({ context, grant, conversationId: deps.conversationForRoom(owner, evidence.room)!, exactBinding: evidence.room,
      purpose: `epoch-escrow:${evidence.room}:${evidence.epoch}:${hash}`, bytes: plaintext, opening: false });
    plaintext.fill(0);
    if (sealed.kind !== 'sealed' || !sealed.bytes || !active(owner) || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { sealed.bytes?.fill(0); return false; }
    const privateDb = await ensureDB();
    if (!privateDb || !active(owner) || !workspaceGrantValid(grant)) { sealed.bytes.fill(0); return false; }
    const key = portableEscrowKey(scope, evidence.room, evidence.epoch, hash);
    const row = { key, scope, room: evidence.room, epoch: evidence.epoch, commitHashHex: hash, state: 'staged' as const, ciphertext: sealed.bytes.slice() };
    try {
      const usage = await backupUsage(privateDb.db, scope);
      if (!usage || usage.count >= 128 || usage.bytes + row.ciphertext.byteLength > 8 * 1024 * 1024 || !active(owner)) return false;
      const inserted = await addIfAbsent(privateDb.db, 'epoch-backups', key, row);
      if (!inserted) {
        const existing = await requestResult(privateDb.db, 'epoch-backups', 'readonly', key) as { scope?: unknown; state?: unknown; commitHashHex?: unknown } | undefined;
        if (!existing || existing.scope !== scope || existing.state !== 'accepted' || existing.commitHashHex !== hash) return false;
      }
      return active(owner) && workspaceGrantValid(grant);
    } catch { return false; }
    finally { sealed.bytes.fill(0); row.ciphertext.fill(0); }
  }
  async function coordinationKey(owner: OwnerSnapshot, room: string): Promise<string | null> {
    const scheme = deps.conversationKeyScheme(owner);
    if (!scheme || !room || CONTROL.test(room)) return null;
    const material = encoder.encode(`${owner.networkId}\0${room}\0${scheme.name}\0${scheme.revision}`);
    try { return `author-intent:${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', material)))}`; }
    catch { return null; }
    finally { material.fill(0); }
  }
  function trackLease(owner: OwnerSnapshot, isCurrent: () => boolean, releaseRaw: () => void) {
    let released = false;
    const lease = {
      isCurrent: () => !released && isCurrent(),
      release: () => { if (released) return; released = true; authorLeases.delete(lease); releaseRaw(); },
    };
    authorLeases.set(lease, Object.freeze({ ...owner }));
    return lease;
  }
  function releaseAuthorLeases(owner?: OwnerSnapshot): void {
    for (const [lease, heldOwner] of authorLeases) if (!owner || equalOwner(owner, heldOwner)) lease.release();
  }
  async function ensureDB(): Promise<PrivateDB | null> {
    if (disposed) return null;
    if (db) return db;
    opening ??= openPrivateDatabase(deps.indexedDB);
    const pending = opening;
    const opened = await pending; opening = null;
    if (disposed) { opened?.db.close(); return null; }
    db = opened;
    return opened;
  }
  async function persistEncryptedBackup(owner: OwnerSnapshot, conversationId: ConversationId, room: string, epoch: number, bytes: Uint8Array): Promise<boolean> {
    if (!active(owner) || bytes.length > 8 * 1024 * 1024) return false;
    const privateDb = await ensureDB();
    if (!privateDb || !active(owner) || !identity) return false;
    const scope = stableScope(owner, identity.deviceId);
    if (!scope) return false;
    const key = `${scope}\0${room}\0${epoch}`;
    const record = { key, scope, room, epoch, bytes: bytes.slice() };
    try {
      const usage = await backupUsage(privateDb.db, scope);
      if (!usage || !active(owner) || usage.count >= 128 || usage.bytes + bytes.length > 64 * 1024 * 1024) return false;
      if (await addIfAbsent(privateDb.db, 'epoch-backups', key, record)) return active(owner);
      const existing = await requestResult(privateDb.db, 'epoch-backups', 'readonly', key) as typeof record | undefined;
      if (!active(owner) || !existing || existing.scope !== scope || existing.room !== room || existing.epoch !== epoch || existing.bytes.length !== bytes.length) return false;
      return equalBytes(existing.bytes, bytes);
    } catch { return false; }
    finally { record.bytes.fill(0); }
  }
  async function persistAcceptedEvidence(owner: OwnerSnapshot, evidence: GroupControlAppliedEvidence): Promise<void> {
    const conversationId = deps.conversationForRoom(owner, evidence.room);
    const acceptedSignerPublicKey = evidence.acceptedSignerPublicKey;
    if (!conversationId || !active(owner) || !evidence.signedCommitPayload || evidence.signedCommitPayload.length > 4096
      || !acceptedSignerPublicKey || acceptedSignerPublicKey.byteLength !== 32 || !evidence.acceptedSignerTrust) return;
    const directoryRevision = deps.directoryRevision(owner, conversationId);
    const facts = deps.roomMembershipFacts(owner, conversationId);
    if (!directoryRevision || !facts?.joined || (facts.scheme !== 'ascii' && facts.scheme !== 'rfc1459' && facts.scheme !== 'strict-rfc1459')) return;
    const acceptedMembershipRevision = `accepted:${hex(evidence.commitHash)}`;
    const acceptedMappingRevision = `irc-casemapping-v1:${facts.scheme}`;
    const fingerprintBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoBytes(acceptedSignerPublicKey)));
    if (!active(owner)) { fingerprintBytes.fill(0); return; }
    const signerFingerprint = hex(fingerprintBytes); fingerprintBytes.fill(0);
    const plain = encoder.encode(JSON.stringify({ version: 1, room: evidence.room, epoch: evidence.epoch, fromAccount: evidence.fromAccount, fromDevice: evidence.fromDevice,
      commitId: hex(evidence.commitId), commitHash: hex(evidence.commitHash), priorEpoch: evidence.priorEpoch, priorCommitHash: hex(evidence.priorCommitHash),
      membershipDigest: hex(evidence.membershipDigest), newEpochKeyCommitment: hex(evidence.newEpochKeyCommitment), signedCommitPayload: evidence.signedCommitPayload,
      acceptedSignerPublicKey: toB64url(acceptedSignerPublicKey), acceptedSignerFingerprint: signerFingerprint,
      acceptedSignerTrust: evidence.acceptedSignerTrust, acceptedAuthorization: 'current-room-authorized',
      directoryRevision, mappingRevision: facts.mappingRevision, acceptedMembershipRevision, acceptedMappingScheme: facts.scheme, acceptedMappingRevision }));
    if (plain.byteLength > 32 * 1024) { plain.fill(0); return; }
    const grant = deps.workspaceGrantForOwner?.(owner);
    const context = { schemaVersion: 1 as const, requestId: requestId(), owner };
    if (!grant || !workspaceGrantValid(grant) || grant.scope.networkId !== owner.networkId
      || grant.scope.accountId !== owner.accountId || !requestCurrent(context)) { plain.fill(0); return; }
    const sealed = await workspaceCrypt({ context, grant, conversationId, exactBinding: evidence.room,
      purpose: `accepted-control:${evidence.room}:${evidence.epoch}`, bytes: plain, opening: false });
    plain.fill(0);
    if (sealed.kind !== 'sealed' || !sealed.bytes || !requestCurrent(context) || !workspaceGrantValid(grant)) { sealed.bytes?.fill(0); return; }
    const privateDb = await ensureDB(); const scope = grant.stableLocalOwnerKey;
    if (!privateDb || !requestCurrent(context) || !workspaceGrantValid(grant)) { sealed.bytes.fill(0); return; }
    const hash = hex(evidence.commitHash);
    const key = `${scope}\0${evidence.room}\0${evidence.epoch}\0${hash}`;
    const escrowKey = portableEscrowKey(scope, evidence.room, evidence.epoch, hash);
    const row = { key, scope, room: evidence.room, epoch: evidence.epoch, ciphertext: sealed.bytes.slice() };
    try { await persistAcceptedAndPromoteEscrow(privateDb.db, key, row, escrowKey, { scope, room: evidence.room, epoch: evidence.epoch, commitHashHex: hash }); }
    catch { /* accepted in memory; absence after reload remains recovery-locked */ }
    finally { sealed.bytes.fill(0); row.ciphertext.fill(0); }
    if (active(owner)) {
      const evidenceKey = historicalEvidenceKey(scope, evidence.room, evidence.epoch, hex(evidence.commitHash));
      wipeEvidence(historicalAccepted.get(evidenceKey)?.evidence);
      historicalAccepted.set(evidenceKey, { scope, evidence: cloneEvidence(evidence), acceptedMembershipRevision,
        acceptedMappingScheme: facts.scheme, acceptedMappingRevision });
      while (historicalAccepted.size > 256) {
        const oldest = historicalAccepted.keys().next().value as string | undefined;
        if (!oldest) break;
        wipeEvidence(historicalAccepted.get(oldest)?.evidence); historicalAccepted.delete(oldest);
      }
    }
  }
  async function restoreAcceptedEvidence(context: RequestContext, room: string, conversationId: ConversationId, expectedEpoch: number, expectedHashHex?: string): Promise<RestoredAcceptedControl | null> {
    const owner = context.owner;
    const grant = deps.workspaceGrantForOwner?.(owner);
    if (!localRequestCurrent(context) || !grant || !workspaceGrantValid(grant) || grant.scope.kind !== 'account'
      || grant.scope.networkId !== owner.networkId || owner.accountId !== null && grant.scope.accountId !== owner.accountId) return null;
    const privateDb = await ensureDB();
    const scope = grant.stableLocalOwnerKey;
    const cacheKey = expectedHashHex ? historicalEvidenceKey(scope, room, expectedEpoch, expectedHashHex) : null;
    const cached = cacheKey ? historicalAccepted.get(cacheKey) : undefined;
    if (cached && cached.scope === scope && localRequestCurrent(context) && workspaceGrantValid(grant)) {
      return { evidence: cloneEvidence(cached.evidence), acceptedMembershipRevision: cached.acceptedMembershipRevision,
        acceptedMappingScheme: cached.acceptedMappingScheme, acceptedMappingRevision: cached.acceptedMappingRevision };
    }
    if (!privateDb || !localRequestCurrent(context) || !workspaceGrantValid(grant)) return null;
    const candidates: Array<{ key: IDBValidKey; row: unknown }> = [];
    const collected = await new Promise<boolean>((resolve) => {
      let tx: IDBTransaction; try { tx = privateDb.db.transaction('accepted-controls', 'readonly'); } catch { resolve(false); return; }
      let count = 0; let valid = true;
      const request = tx.objectStore('accepted-controls').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (++count > 2048) { valid = false; try { tx.abort(); } catch { /* already complete */ } return; }
        const value = cursor.value as { key?: unknown; scope?: unknown; room?: unknown; epoch?: unknown; ciphertext?: unknown };
        if (value?.scope === scope && value.room === room && value.epoch === expectedEpoch
          && typeof value.key === 'string' && (!expectedHashHex || value.key.endsWith(`\0${expectedHashHex}`))
          && value.ciphertext instanceof Uint8Array && value.ciphertext.byteLength <= 40 * 1024) candidates.push({ key: cursor.key, row: value });
        cursor.continue();
      };
      request.onerror = () => { valid = false; try { tx.abort(); } catch { /* already complete */ } };
      tx.oncomplete = () => resolve(valid); tx.onerror = tx.onabort = () => resolve(false);
    });
    if (!collected || !localRequestCurrent(context) || !workspaceGrantValid(grant)) return null;
    if (!expectedHashHex && candidates.length !== 1) return null;
    candidates.sort((a, b) => Number((b.row as { epoch: number }).epoch) - Number((a.row as { epoch: number }).epoch));
    for (const candidate of candidates.slice(0, 64)) {
      const row = candidate.row as { scope: string; room: string; epoch: number; ciphertext: Uint8Array };
      const ciphertext = row.ciphertext.slice();
      const opened = await workspaceCrypt({ context, grant, conversationId, exactBinding: room,
        purpose: `accepted-control:${room}:${row.epoch}`, bytes: ciphertext, opening: true });
      ciphertext.fill(0);
      if (opened.kind !== 'opened' || !opened.bytes || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { opened.bytes?.fill(0); continue; }
      let decoded: Record<string, unknown> | null = null;
      try {
        const value: unknown = JSON.parse(decoder.decode(opened.bytes));
        if (value && typeof value === 'object' && !Array.isArray(value)) decoded = value as Record<string, unknown>;
      } catch { /* corrupt ciphertext/plaintext is ignored */ }
      opened.bytes.fill(0);
      if (!decoded || decoded.version !== 1 || decoded.room !== room || decoded.epoch !== row.epoch
        || typeof decoded.fromAccount !== 'string' || typeof decoded.fromDevice !== 'string' || typeof decoded.signedCommitPayload !== 'string'
        || typeof decoded.commitId !== 'string' || typeof decoded.commitHash !== 'string' || typeof decoded.priorCommitHash !== 'string'
        || typeof decoded.membershipDigest !== 'string' || typeof decoded.newEpochKeyCommitment !== 'string'
        || typeof decoded.directoryRevision !== 'string' || typeof decoded.mappingRevision !== 'string'
        || typeof decoded.acceptedSignerPublicKey !== 'string' || !/^[a-f0-9]{64}$/u.test(String(decoded.acceptedSignerFingerprint))
        || (decoded.acceptedSignerTrust !== 'first-use' && decoded.acceptedSignerTrust !== 'pinned')
        || decoded.acceptedAuthorization !== 'current-room-authorized'
        || typeof decoded.acceptedMembershipRevision !== 'string' || (decoded.acceptedMappingScheme !== 'ascii' && decoded.acceptedMappingScheme !== 'rfc1459' && decoded.acceptedMappingScheme !== 'strict-rfc1459')
        || decoded.acceptedMappingRevision !== `irc-casemapping-v1:${decoded.acceptedMappingScheme}`
        || Object.keys(decoded).some((key) => !['version','room','epoch','fromAccount','fromDevice','commitId','commitHash','priorEpoch','priorCommitHash','membershipDigest','newEpochKeyCommitment','signedCommitPayload','directoryRevision','mappingRevision','acceptedMembershipRevision','acceptedMappingScheme','acceptedMappingRevision','acceptedSignerPublicKey','acceptedSignerFingerprint','acceptedSignerTrust','acceptedAuthorization'].includes(key))) continue;
      const fromAccount = decoded.fromAccount;
      const fromDevice = decoded.fromDevice;
      const wire = decoded.signedCommitPayload;
      const parts = parseGroupControlPayload(wire);
      const bytes32 = (key: string): Uint8Array | null => {
        const text = decoded![key];
        if (typeof text !== 'string' || !/^[a-f0-9]{64}$/u.test(text)) return null;
        return Uint8Array.from(text.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
      };
      const commitId = bytes32('commitId'); const expectedHash = bytes32('commitHash'); const priorCommitHash = bytes32('priorCommitHash');
      const membershipDigest = bytes32('membershipDigest'); const commitment = bytes32('newEpochKeyCommitment');
      const priorEpoch = decoded.priorEpoch;
      if (!parts || parts.kind !== 'commit' || parts.epoch !== row.epoch || !commitId || !expectedHash || !priorCommitHash
        || !membershipDigest || !commitment || !Number.isSafeInteger(priorEpoch) || Number(priorEpoch) + 1 !== row.epoch
        || !localRequestCurrent(context)) { commitId?.fill(0); expectedHash?.fill(0); priorCommitHash?.fill(0); membershipDigest?.fill(0); commitment?.fill(0); continue; }
      const signerPub = fromB64url(decoded.acceptedSignerPublicKey);
      const signerFingerprint = signerPub ? new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoBytes(signerPub))) : null;
      const signerFingerprintHex = signerFingerprint ? hex(signerFingerprint) : '';
      signerFingerprint?.fill(0);
      const routed = signerPub && toB64url(signerPub) === decoded.acceptedSignerPublicKey && signerFingerprintHex === decoded.acceptedSignerFingerprint
        ? await verifyGroupControlPayload(wire, { channel: room, kind: 'commit', fromAccount, fromDevice }, signerPub) : null;
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant) || signerPub?.byteLength !== 32 || !routed || routed.kind !== 'commit') {
        signerPub?.fill(0);
        commitId.fill(0); expectedHash.fill(0); priorCommitHash.fill(0); membershipDigest.fill(0); commitment.fill(0); continue;
      }
      const record = decodeGroupCommit(routed.body);
      const commitContext = record && buildGroupCommitContext({ room, fromAccount, fromDevice, priorEpoch: record.priorEpoch, nextEpoch: record.nextEpoch, commitId: record.commitId });
      const calculated = record && commitContext ? await hashGroupCommit(record, commitContext) : null;
      commitContext?.fill(0);
      const valid = !!record && record.nextEpoch === BigInt(row.epoch) && record.priorEpoch === BigInt(priorEpoch as number)
        && equalBytes(record.commitId, commitId) && equalBytes(record.priorCommitHash, priorCommitHash)
        && equalBytes(record.membershipDigest, membershipDigest) && equalBytes(record.newEpochKeyCommitment, commitment)
        && !!calculated && equalBytes(calculated, expectedHash);
      calculated?.fill(0);
      if (!valid || !record || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { signerPub.fill(0); commitId.fill(0); expectedHash.fill(0); priorCommitHash.fill(0); membershipDigest.fill(0); commitment.fill(0); continue; }
      const evidence: GroupControlAppliedEvidence = { room, epoch: row.epoch, fromAccount, fromDevice, commitId, commitHash: expectedHash,
        priorEpoch: Number(priorEpoch), priorCommitHash, membershipDigest, newEpochKeyCommitment: commitment, inputKind: 'commit', signedCommitPayload: wire,
        acceptedSignerPublicKey: signerPub, acceptedSignerTrust: decoded.acceptedSignerTrust };
      const restored = { evidence, acceptedMembershipRevision: decoded.acceptedMembershipRevision,
        acceptedMappingScheme: decoded.acceptedMappingScheme as AcceptedControlRecord['acceptedMappingScheme'], acceptedMappingRevision: decoded.acceptedMappingRevision };
      if (expectedHashHex && hex(evidence.commitHash) !== expectedHashHex) { wipeEvidence(evidence); continue; }
      const resolvedKey = historicalEvidenceKey(scope, room, expectedEpoch, hex(evidence.commitHash));
      historicalAccepted.set(resolvedKey, { ...restored, evidence: cloneEvidence(evidence), scope });
      return restored;
    }
    return null;
  }
  function validIdentityRecord(value: unknown, owner: OwnerSnapshot): value is KeyPairRecord {
    if (!value || typeof value !== 'object') return false;
    const r = value as KeyPairRecord;
    const expectedScope = typeof r.deviceId === 'string' ? stableScope(owner, r.deviceId) : null;
    return typeof r.scope === 'string' && !!expectedScope && r.scope === expectedScope && /^ogc1-[A-Za-z0-9_-]{22}$/u.test(r.deviceId)
      && r.signing?.privateKey?.type === 'private' && r.signing.privateKey.algorithm.name === 'Ed25519' && !r.signing.privateKey.extractable && r.signing.privateKey.usages.includes('sign')
      && r.signing.publicKey?.algorithm.name === 'Ed25519' && r.wrapping?.privateKey?.type === 'private'
      && r.wrapping.privateKey.algorithm.name === 'ECDH' && !r.wrapping.privateKey.extractable && r.wrapping.privateKey.usages.includes('deriveBits')
      && r.wrapping.publicKey?.algorithm.name === 'ECDH';
  }
  async function identityPublicBinding(record: KeyPairRecord): Promise<boolean> {
    try {
      const signerPub = new Uint8Array(await crypto.subtle.exportKey('raw', record.signing.publicKey));
      const encryptionPub = new Uint8Array(await crypto.subtle.exportKey('raw', record.wrapping.publicKey));
      const encoded = encodeGroupDeviceDirectoryEntry({ signerPub, encryptionPub });
      const deviceId = encoded ? await deriveGroupDeviceId(encoded) : null;
      signerPub.fill(0); encryptionPub.fill(0);
      return deviceId === record.deviceId;
    } catch { return false; }
  }
  async function ensureIdentity(owner: OwnerSnapshot, register = true): Promise<boolean> {
    if (!active(owner)) return false;
    if (identity && validIdentityRecord(identity, owner)) return !register || registerIdentity(owner, identity);
    const targetScope = identityLookupScope(owner);
    if (identityPromise) {
      if (identityPromiseScope === targetScope) return identityPromise;
      await identityPromise;
      return active(owner) ? ensureIdentity(owner, register) : false;
    }
    const token = generation;
    identityPromiseScope = targetScope;
    identityPromise = (async () => {
      const privateDb = await ensureDB();
      if (!active(owner, token)) return false;
      if (deps.indexedDB && !privateDb) return false;
      const lookupScope = identityLookupScope(owner);
      if (!lookupScope) return false;
      let record: KeyPairRecord | null = null;
      if (privateDb) {
        try { const loaded = await requestResult(privateDb.db, 'identity', 'readonly', lookupScope); if (loaded !== undefined) { if (!validIdentityRecord(loaded, owner) || !await identityPublicBinding(loaded)) return false; record = loaded; } }
        catch { return false; }
      }
      if (!active(owner, token)) return false;
      if (!record) {
        try {
          const [signing, wrapping] = await Promise.all([
            crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']),
            crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
          ]) as [CryptoKeyPair, CryptoKeyPair];
          const signerPub = new Uint8Array(await crypto.subtle.exportKey('raw', signing.publicKey));
          const encryptionPub = new Uint8Array(await crypto.subtle.exportKey('raw', wrapping.publicKey));
          const encoded = encodeGroupDeviceDirectoryEntry({ signerPub, encryptionPub });
          const deviceId = encoded ? await deriveGroupDeviceId(encoded) : null;
          signerPub.fill(0); encryptionPub.fill(0);
          if (!deviceId) return false;
          const scope = stableScope(owner, deviceId);
          if (!scope) return false;
          const candidate: KeyPairRecord = { scope, deviceId, signing, wrapping };
          if (privateDb) {
            if (await addIfAbsent(privateDb.db, 'identity', lookupScope, candidate)) record = candidate;
            else {
              const winner = await requestResult(privateDb.db, 'identity', 'readonly', lookupScope);
              if (!validIdentityRecord(winner, owner) || !await identityPublicBinding(winner)) return false;
              record = winner;
            }
          } else record = candidate;
        } catch { return false; }
      }
      if (!active(owner, token)) return false;
      identity = record;
      return !register || registerIdentity(owner, record);
    })().finally(() => { identityPromise = null; identityPromiseScope = null; });
    return identityPromise;
  }
  async function registerIdentity(owner: OwnerSnapshot, record: KeyPairRecord): Promise<boolean> {
    if (!active(owner)) return false;
    if (registeredScopes.has(record.scope)) return true;
    try {
      const [signer, wrap] = await Promise.all([crypto.subtle.exportKey('raw', record.signing.publicKey), crypto.subtle.exportKey('raw', record.wrapping.publicKey)]);
      if (!active(owner)) return false;
      const registered = await deps.ensureRegisteredDevice(owner, record.deviceId, copy(signer), copy(wrap));
      if (!active(owner) || !registered) { deps.onReadiness?.(owner, 'unavailable'); return false; }
      registeredScopes.add(record.scope);
      deps.onReadiness?.(owner, db ? 'ready' : 'volatile');
      return true;
    } catch { return false; }
  }
  async function providerVerifiedDirectory(context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot; conversationId: ConversationId }): Promise<VerifiedGroupDirectory | null> {
    const owner = context.owner;
    if (!owner.accountId || !await ensureIdentity(owner) || !active(owner)) return null;
    const facts = deps.roomMembershipFacts(owner, context.conversationId);
    if (!facts?.joined || facts.complete !== true || !facts.canonicalTarget || !facts.scheme || !facts.mappingRevision
      || !facts.sourceRevision || !Array.isArray(facts.memberAccounts) || !facts.memberAccounts.length || facts.memberAccounts.length > 256) return null;
    const membershipAccounts = [...new Set(facts.memberAccounts.map((account) => String(account).toLowerCase()))].sort();
    if (membershipAccounts.length !== facts.memberAccounts.length || membershipAccounts.some((account) => !/^[a-z0-9_.@-]{1,64}$/u.test(account))) return null;
    const privateDb = await ensureDB();
    if (!privateDb || !identity || !active(owner)) return null;
    const local = identity;
    const scope = stableScope(owner, local.deviceId);
    if (!scope) return null;
    const devices: VerifiedGroupDevice[] = [];
    const revisions: string[] = [];
    for (const account of membershipAccounts) {
      const accountId = account as AccountId;
      const result = await deps.authenticatedDirectory(owner, accountId);
      if (!active(owner) || !result || result.provenance !== 'authenticated-exact-server' || result.trusted !== false
        || !equalOwner(result.owner, owner) || String(result.accountId).toLowerCase() !== account || result.snapshot.account !== account
        || result.snapshot.devices.length > 64 || !result.revision) return null;
      const removed: string[] = [];
      for (const row of result.snapshot.devices) {
        if (row.account.toLowerCase() !== account || !row.trusted || row.legacy || !row.entry || !row.directoryKey) return null;
        const parsed = decodeGroupDeviceDirectoryEntry(row.publicKey);
        if (!parsed || !equalBytes(parsed.signerPub, row.entry.signerPub) || !equalBytes(parsed.encryptionPub, row.entry.encryptionPub)
          || await deriveGroupDeviceId(parsed) !== row.deviceId) return null;
        const signer = toB64url(parsed.signerPub);
        if (row.directoryKey !== signer) return null;
        const isLocalDevice = account === owner.accountId.toLowerCase() && row.deviceId === local.deviceId;
        if (isLocalDevice) {
          const localSigner = new Uint8Array(await crypto.subtle.exportKey('raw', local.signing.publicKey));
          const localWrap = new Uint8Array(await crypto.subtle.exportKey('raw', local.wrapping.publicKey));
          const matches = equalBytes(localSigner, parsed.signerPub) && equalBytes(localWrap, parsed.encryptionPub);
          localSigner.fill(0); localWrap.fill(0);
          if (!matches) return null;
        } else {
          const pinKey = `${scope}\0${account}\0${row.deviceId}`;
          const pin = await requestResult(privateDb.db, 'trusted-signers', 'readonly', pinKey).catch(() => null) as TrustedGroupSignerPin | null;
          // A device removed from this room by explicit user action carries a
          // local tombstone pin: it is excluded from recipients (it receives no
          // new epoch keys). An unpinned or mismatched device still fails closed.
          if (active(owner) && pin?.deleted === true && pin.account.toLowerCase() === account && pin.deviceId === row.deviceId) { removed.push(row.deviceId); continue; }
          if (!active(owner) || !pin || pin.deleted === true || pin.account.toLowerCase() !== account || pin.deviceId !== row.deviceId || pin.signerPub !== signer) return null;
        }
        devices.push({ accountId, deviceId: row.deviceId, signerPublicKey: parsed.signerPub.slice(), wrapPublicKey: parsed.encryptionPub.slice(), trusted: true });
      }
      revisions.push(`${account}:${result.revision}${removed.length ? `:removed=${removed.sort().join(',')}` : ''}`);
    }
    if (!active(owner) || devices.length === 0 || devices.length > 256
      || !devices.some((device) => device.accountId.toLowerCase() === owner.accountId!.toLowerCase() && device.deviceId === local.deviceId)) return null;
    const mappingGeneration = facts.mappingGeneration;
    const current = deps.roomMembershipFacts(owner, context.conversationId);
    if (!current?.joined || current.mappingRevision !== facts.mappingRevision || current.mappingGeneration !== mappingGeneration
      || current.membershipGeneration !== facts.membershipGeneration || !active(owner)) {
      for (const device of devices) { device.signerPublicKey.fill(0); device.wrapPublicKey.fill(0); }
      return null;
    }
    return { complete: true, revision: `${facts.sourceRevision}|${revisions.join('|')}`, mappingRevision: facts.mappingRevision,
      canonicalRoom: facts.canonicalTarget, scheme: facts.scheme, devices };
  }

  async function sealDmToCurrentPeer(input: { owner: OwnerSnapshot; conversationId: ConversationId; requestId: RequestId; plaintext: Uint8Array }): Promise<Uint8Array | null> {
    const owner = input.owner;
    const route = deps.resolvePeerConversation(owner, input.conversationId);
    const peerAccount = route?.accountId;
    if (!route || !equalOwner(route.owner, owner) || route.conversationId !== input.conversationId || route.source !== 'authenticated-server'
      || !peerAccount || peerAccount === owner.accountId || input.plaintext.byteLength > 32 * 1024
      || !await ensureIdentity(owner) || !active(owner) || !identity) return null;
    const policy = deps.conversationPolicy(owner, input.conversationId);
    if (!policy || policy.encryption !== 'dm-required' || !policy.eligible || !route.routingRevision || route.routingRevision.length > 256 || CONTROL.test(route.routingRevision)) return null;
    const privateDb = await ensureDB(); const local = identity; const scope = stableScope(owner, local.deviceId);
    if (!privateDb || !scope || !active(owner)) return null;
    const directory = await deps.authenticatedDirectory(owner, peerAccount);
    if (!directory || directory.provenance !== 'authenticated-exact-server' || directory.trusted !== false || !equalOwner(directory.owner, owner)
      || String(directory.accountId).toLowerCase() !== peerAccount.toLowerCase() || directory.snapshot.account.toLowerCase() !== peerAccount.toLowerCase()
      || directory.snapshot.devices.length === 0 || directory.snapshot.devices.length > 16 || !active(owner)) return null;
    const peerKeys: Array<{ publicKey: Uint8Array; b64: string }> = [];
    for (const row of directory.snapshot.devices) {
      const entry = row.trusted && !row.legacy && row.entry ? decodeGroupDeviceDirectoryEntry(row.publicKey) : null;
      if (!entry || row.account.toLowerCase() !== peerAccount.toLowerCase() || await deriveGroupDeviceId(entry) !== row.deviceId) { peerKeys.forEach((x) => x.publicKey.fill(0)); return null; }
      const signerB64 = toB64url(entry.signerPub);
      const pinKey = `${scope}\0${peerAccount.toLowerCase()}\0${row.deviceId}`;
      const pin = await requestResult(privateDb.db, 'trusted-signers', 'readonly', pinKey).catch(() => null) as TrustedGroupSignerPin | null;
      if (!active(owner) || !pin || pin.deleted === true || pin.signerPub !== signerB64 || !isValidP256UncompressedPublicKey(entry.encryptionPub)) {
        peerKeys.forEach((x) => x.publicKey.fill(0)); return null;
      }
      peerKeys.push({ publicKey: entry.encryptionPub.slice(), b64: toB64url(entry.encryptionPub) });
    }
    const nonceBodies: Uint8Array[] = [];
    try {
      const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.wrapping.publicKey));
      const localB64 = toB64url(localPublic); localPublic.fill(0);
      for (const peer of peerKeys) {
        const peerKey = await crypto.subtle.importKey('raw', cryptoBytes(peer.publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const sharedBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, local.wrapping.privateKey, 256));
        let hkdf: CryptoKey | null = null;
        try { hkdf = await crypto.subtle.importKey('raw', cryptoBytes(sharedBits), 'HKDF', false, ['deriveKey']); }
        finally { sharedBits.fill(0); }
        if (!hkdf || !active(owner)) return null;
        const pair = [localB64, peer.b64].sort();
        const info = encoder.encode(`onyx-dm:${pair[0]}:${pair[1]}`);
        const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('onyx-dm-v1'), info }, hkdf,
          { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        info.fill(0);
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: cryptoBytes(nonce), tagLength: 128 }, key, cryptoBytes(input.plaintext)));
        const body = new Uint8Array(nonce.length + encrypted.length); body.set(nonce); body.set(encrypted, nonce.length);
        nonce.fill(0); encrypted.fill(0); nonceBodies.push(body);
        const after = await deps.authenticatedDirectory(owner, peerAccount);
        const freshPolicy = deps.conversationPolicy(owner, input.conversationId);
        const freshRoute = deps.resolvePeerConversation(owner, input.conversationId);
        if (!active(owner) || !after || after.revision !== directory.revision || freshPolicy?.revision !== policy.revision
          || freshPolicy.encryption !== 'dm-required' || !freshRoute || !equalOwner(freshRoute.owner, owner)
          || freshRoute.accountId !== peerAccount || freshRoute.routingRevision !== route.routingRevision
          || freshRoute.mappingGeneration !== route.mappingGeneration) return null;
      }
      let output: Uint8Array;
      if (nonceBodies.length === 1) output = new TextEncoder().encode(`${ENVELOPE_PREFIX}${toB64url(nonceBodies[0]!)}`);
      else {
        let size = 2; for (const body of nonceBodies) size += 2 + body.byteLength;
        const packed = new Uint8Array(size); const view = new DataView(packed.buffer); view.setUint16(0, nonceBodies.length, false);
        let offset = 2; for (const body of nonceBodies) { view.setUint16(offset, body.byteLength, false); offset += 2; packed.set(body, offset); offset += body.byteLength; }
        output = new TextEncoder().encode(`${MULTI_ENVELOPE_PREFIX}${toB64url(packed)}`); packed.fill(0);
      }
      const resultText = decoder.decode(output);
      if (!isValidDmEnvelope(resultText) || !active(owner)) { output.fill(0); return null; }
      return output;
    } catch { return null; }
    finally { for (const peer of peerKeys) peer.publicKey.fill(0); for (const body of nonceBodies) body.fill(0); }
  }

  async function ensureGroupAdapter(owner: OwnerSnapshot): Promise<boolean> {
    if (!await ensureIdentity(owner) || !active(owner)) return false;
    if (groupAdapter && adapterOwner && equalOwner(adapterOwner, owner)) return true;
    if (groupAdapter) { void groupAdapter.destroy(); groupAdapter = null; adapterOwner = null; }
    const privateDb = await ensureDB();
    if (!active(owner) || !identity) return false;
    const local = identity;
    const store = {
      async get(account: string, deviceId: string): Promise<TrustedGroupSignerPin | null> {
        if (!privateDb || !active(owner)) return null;
        const key = `${stableScope(owner, local.deviceId)}\0${account}\0${deviceId}`;
        return await requestResult(privateDb.db, 'trusted-signers', 'readonly', key).catch(() => null) as TrustedGroupSignerPin | null;
      },
      async put(pin: TrustedGroupSignerPin): Promise<void> {
        if (!privateDb || !active(owner) || !pin.account || !pin.deviceId || !pin.signerPub) throw new Error('trusted-store-unavailable');
        const key = `${stableScope(owner, local.deviceId)}\0${pin.account}\0${pin.deviceId}`;
        await requestResult(privateDb.db, 'trusted-signers', 'readwrite', key, { ...pin });
        if (!active(owner)) throw new Error('stale-owner');
      },
      async delete(account: string, deviceId: string): Promise<void> {
        if (!privateDb || !active(owner)) throw new Error('trusted-store-unavailable');
        const key = `${stableScope(owner, local.deviceId)}\0${account}\0${deviceId}`;
        const prior = await requestResult(privateDb.db, 'trusted-signers', 'readonly', key).catch(() => null) as TrustedGroupSignerPin | null;
        if (!active(owner)) throw new Error('stale-owner');
        if (prior) await requestResult(privateDb.db, 'trusted-signers', 'readwrite', key, { ...prior, deleted: true });
      },
    };
    groupAdapter = createGroupControlSessionAdapter({
      ...(owner.accountId ? { localIdentity: { account: owner.accountId, deviceId: local.deviceId } } : {}),
      async onVerifiedEpochMaterial({ material, evidence }) {
        if (!active(owner)) throw new Error('stale-owner');
        const saved = await writeEpochEscrow(owner, evidence, material);
        if (!active(owner)) throw new Error('stale-owner');
        deps.onReadiness?.(owner, saved ? 'ready' : 'volatile');
        if (!saved) throw new Error('escrow-unavailable');
      },
      sessionForRoom: (room) => {
        const conversationId = deps.conversationForRoom(owner, room);
        if (!conversationId) return null;
        const facts = conversationId ? deps.roomMembershipFacts(owner, conversationId) : null;
        const session = sessions.get(`${ownerLifecycleKey(owner)}\0${room}`);
        if (!active(owner) || !facts?.joined || !session || session.account !== owner.accountId || session.deviceId !== local.deviceId) return null;
        const mappingRevision = facts.mappingRevision;
        const current = () => active(owner) && deps.roomMembershipFacts(owner, conversationId)?.joined === true
          && deps.roomMembershipFacts(owner, conversationId)?.mappingRevision === mappingRevision
          && sessions.get(`${ownerLifecycleKey(owner)}\0${room}`) === session;
        return {
          room: session.room, account: session.account, deviceId: session.deviceId,
          async stageVerifiedWelcome(...args: Parameters<GroupSession['stageVerifiedWelcome']>) {
            if (!current()) return { ok: false as const, reason: 'destroyed' as const };
            const result = await session.stageVerifiedWelcome(...args);
            return current() ? result : { ok: false as const, reason: 'destroyed' as const };
          },
          async applyVerifiedCommit(...args: Parameters<GroupSession['applyVerifiedCommit']>) {
            if (!current()) return { ok: false as const, reason: 'destroyed' as const };
            const result = await session.applyVerifiedCommit(...args);
            return current() ? result : { ok: false as const, reason: 'destroyed' as const };
          },
          async applyVerifiedPair(...args: Parameters<NonNullable<GroupSession['applyVerifiedPair']>>) {
            if (!current() || !session.applyVerifiedPair) return { ok: false as const, reason: 'destroyed' as const };
            const result = await session.applyVerifiedPair(...args);
            return current() ? result : { ok: false as const, reason: 'destroyed' as const };
          },
        };
      },
      async directoryForAccount(account) {
        if (!active(owner)) return null;
        const result = await deps.authenticatedDirectory(owner, account as AccountId);
        if (!active(owner) || !result || result.provenance !== 'authenticated-exact-server' || result.trusted !== false
          || !equalOwner(result.owner, owner) || String(result.accountId).toLowerCase() !== account.toLowerCase()
          || result.snapshot.account.toLowerCase() !== account.toLowerCase()) return null;
        return result.snapshot;
      },
      trustedSignerStore: store,
      recipientPrivateKeyFor: (account, deviceId) => active(owner) && owner.accountId === account && local.deviceId === deviceId ? local.wrapping.privateKey : null,
      async onVerifiedCommit(candidate) {
        const conversationId = deps.conversationForRoom(owner, candidate.room);
        const facts = conversationId ? deps.roomMembershipFacts(owner, conversationId) : null;
        const initialSession = sessions.get(`${ownerLifecycleKey(owner)}\0${candidate.room}`);
        if (!conversationId || !facts?.joined || !active(owner)) return false;
        const mappingRevision = facts.mappingRevision;
        const authorized = await deps.authorizeRemoteGroupAuthor(owner, candidate.room, candidate.fromAccount as AccountId, candidate.fromDevice);
        const after = deps.roomMembershipFacts(owner, conversationId);
        if (!authorized || !active(owner) || !after?.joined || after.mappingRevision !== mappingRevision
          || after.membershipGeneration !== facts.membershipGeneration) return false;
        // Ingress can be delayed across a valid prior-branch install. Keep
        // processing against the current head so a signed sibling is retained
        // as a fork instead of being discarded as stale session state.
        const session = sessions.get(`${ownerLifecycleKey(owner)}\0${candidate.room}`);
        const priorEpoch = Number(candidate.commit.priorEpoch);
        if (!Number.isSafeInteger(priorEpoch)) return false;
        const priorKey = `${ownerLifecycleKey(owner)}\0${candidate.room}\0${priorEpoch + 1}`;
        const known = acceptedCommits.get(priorKey);
        if (known && equalBytes(known.evidence.commitHash, candidate.commitHash)) return true;
        const forkKey = `${ownerLifecycleKey(owner)}\0${candidate.room}\0${priorEpoch}`;
        const priorCandidate = verifiedForkCandidates.get(forkKey);
        if ((known && equalBytes(known.evidence.priorCommitHash, candidate.commit.priorCommitHash)
          && known.evidence.priorEpoch === priorEpoch && !equalBytes(known.evidence.commitHash, candidate.commitHash))
          || (priorCandidate && equalBytes(priorCandidate.priorHash, candidate.commit.priorCommitHash)
            && !equalBytes(priorCandidate.commitHash, candidate.commitHash))) {
          deps.setRoomSendGate(owner, conversationId, 'recovery-required');
          if (!priorCandidate) verifiedForkCandidates.set(forkKey, { owner: Object.freeze({ ...owner }), priorEpoch, priorHash: candidate.commit.priorCommitHash.slice(), commitHash: candidate.commitHash.slice() });
          return false;
        }
        let genesisProof: FreshGenesisFact | null = null;
        const parentEvidence = acceptedCommits.get(`${ownerLifecycleKey(owner)}\0${candidate.room}\0${priorEpoch}`)?.evidence;
        let validParent = !!parentEvidence && equalBytes(parentEvidence.commitHash, candidate.commit.priorCommitHash);
        if (session && session.epoch === candidate.commit.priorEpoch) {
          const liveHash = session.commitHash();
          validParent ||= !!liveHash && equalBytes(liveHash, candidate.commit.priorCommitHash);
          liveHash?.fill(0);
        }
        if (priorEpoch === 0 && candidate.commit.priorCommitHash.every((byte) => byte === 0)
          && deps.freshGenesisFact && deps.validateFreshCreateReservation) {
          genesisProof = await deps.freshGenesisFact(owner, conversationId) ?? await reservedGenesisFact(owner, conversationId);
          validParent ||= !!genesisProof && genesisProof.kind === 'new-room-genesis' && genesisProof.epoch === 0
            && equalBytes(genesisProof.commitHash, candidate.commit.priorCommitHash) && active(owner)
            && await validGenesisProof(owner, conversationId, genesisProof);
        }
        if (!validParent && !session && !initialSession) {
          const localIdentity = identity;
          const directoryRevision = deps.directoryRevision(owner, conversationId);
          const verifiedDirectory = await providerVerifiedDirectory({ schemaVersion: 1, requestId: requestId(), owner, conversationId });
          const stagedDigest = localIdentity && owner.accountId && verifiedDirectory ? await buildMembershipDigest({ networkId: String(owner.networkId), priorEpoch,
            priorCommitHash: candidate.commit.priorCommitHash, localAccount: String(owner.accountId), localDeviceId: localIdentity.deviceId, directory: verifiedDirectory! }) : null;
          if (!active(owner) || !localIdentity || !directoryRevision || !verifiedDirectory
            || !stagedDigest || !equalBytes(stagedDigest, candidate.commit.membershipDigest)
            || !verifiedDirectory.devices.some((device) => device.accountId === owner.accountId && device.deviceId === localIdentity.deviceId)) return false;
          const signer = verifiedDirectory.devices.find((device) => device.accountId === candidate.fromAccount && device.deviceId === candidate.fromDevice);
          if (!signer) return false;
          const fingerprintBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoBytes(signer.signerPublicKey)));
          const fingerprint = hex(fingerprintBytes); fingerprintBytes.fill(0);
          const existing = [...bootstrapCandidates.entries()].find(([, saved]) => saved.owner.ownerRef === owner.ownerRef
            && saved.room === candidate.room && saved.preview.commitHashHex === hex(candidate.commitHash));
          if (existing) {
            const saved = existing[1];
            if (saved.approved && saved.mappingRevision === mappingRevision && saved.directoryRevision === directoryRevision
              && active(owner) && deps.roomMembershipFacts(owner, conversationId)?.mappingRevision === mappingRevision) return true;
            return 'checkpoint-required';
          }
          const previewRef = [...crypto.getRandomValues(new Uint8Array(24))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
          if (candidate.commit.nextEpoch > BigInt(Number.MAX_SAFE_INTEGER)) return false;
          const preview: BootstrapPreview = { previewRef, epoch: Number(candidate.commit.nextEpoch), commitHashHex: hex(candidate.commitHash),
            signerAccountId: candidate.fromAccount as AccountId, signerDeviceId: candidate.fromDevice, signerFingerprint: fingerprint,
            recipientDeviceId: localIdentity.deviceId, historyVerified: false };
          bootstrapCandidates.set(previewRef, { owner: Object.freeze({ ...owner }), conversationId, room: candidate.room, preview,
            mappingRevision, directoryRevision, membershipDigestHex: hex(candidate.commit.membershipDigest), priorHashHex: hex(candidate.commit.priorCommitHash), expiresAt: Date.now() + 5 * 60_000, approved: false });
          stagedDigest.fill(0);
          while (bootstrapCandidates.size > 16) bootstrapCandidates.delete(bootstrapCandidates.keys().next().value!);
          return 'checkpoint-required';
        }
        const finalFacts = deps.roomMembershipFacts(owner, conversationId);
        const finalAccepted = acceptedCommits.get(priorKey)?.evidence;
        const finalPriorCandidate = verifiedForkCandidates.get(forkKey);
        if ((finalAccepted && finalAccepted.priorEpoch === priorEpoch
          && equalBytes(finalAccepted.priorCommitHash, candidate.commit.priorCommitHash)
          && !equalBytes(finalAccepted.commitHash, candidate.commitHash))
          || (finalPriorCandidate && equalBytes(finalPriorCandidate.priorHash, candidate.commit.priorCommitHash)
            && !equalBytes(finalPriorCandidate.commitHash, candidate.commitHash))) {
          deps.setRoomSendGate(owner, conversationId, 'recovery-required');
          if (!finalPriorCandidate) verifiedForkCandidates.set(forkKey, { owner: Object.freeze({ ...owner }), priorEpoch,
            priorHash: candidate.commit.priorCommitHash.slice(), commitHash: candidate.commitHash.slice() });
          return false;
        }
        const finalSession = sessions.get(`${ownerLifecycleKey(owner)}\0${candidate.room}`);
        if (!validParent || !active(owner) || !finalFacts?.joined || finalFacts.mappingRevision !== mappingRevision
          || finalFacts.membershipGeneration !== facts.membershipGeneration || finalSession !== session) return false;
        // Do not count an arbitrary prior-hash mismatch as a sibling. The
        // exact prior must be a retained accepted head or fresh CREATE proof.
        if (session && session.epoch === candidate.commit.priorEpoch) {
          const liveHash = session.commitHash();
          const matchesCurrent = !!liveHash && equalBytes(liveHash, candidate.commit.priorCommitHash);
          liveHash?.fill(0);
          if (!matchesCurrent && !parentEvidence) return false;
        }
        // A verified, authorized sibling remains a fork even after this tab
        // advanced its session. Retain its public hashes and pause sealing.
        if (!priorCandidate) verifiedForkCandidates.set(forkKey, { owner: Object.freeze({ ...owner }), priorEpoch, priorHash: candidate.commit.priorCommitHash.slice(), commitHash: candidate.commitHash.slice() });
        while (verifiedForkCandidates.size > 128) {
          const oldest = verifiedForkCandidates.keys().next().value as string | undefined;
          if (!oldest) break;
          const removed = verifiedForkCandidates.get(oldest); removed?.priorHash.fill(0); removed?.commitHash.fill(0); verifiedForkCandidates.delete(oldest);
        }
        if (!active(owner) || deps.roomMembershipFacts(owner, conversationId)?.mappingRevision !== mappingRevision) return false;
        if (known && equalBytes(known.evidence.commitHash, candidate.commitHash)) return true;
        if (session) return session.epoch === candidate.commit.priorEpoch
          && equalBytes(session.commitHash() ?? new Uint8Array(), candidate.commit.priorCommitHash);
        return !!genesisProof && active(owner) && deps.roomMembershipFacts(owner, conversationId)?.mappingRevision === mappingRevision
          && sessions.get(`${ownerLifecycleKey(owner)}\0${candidate.room}`) === undefined;
      },
      adoptBootstrappedSession: (session) => {
        const conversationId = deps.conversationForRoom(owner, session.room);
        const facts = conversationId ? deps.roomMembershipFacts(owner, conversationId) : null;
        if (!active(owner) || !conversationId || !facts?.joined || session.account !== owner.accountId || session.deviceId !== local.deviceId) { session.destroy(); return false; }
        const scope = `${ownerLifecycleKey(owner)}\0${session.room}`;
        const existing = sessions.get(scope);
        if (existing && existing.epoch >= session.epoch) { session.destroy(); return existing.epoch === session.epoch; }
        existing?.destroy(); sessions.set(scope, session);
        return active(owner) && deps.roomMembershipFacts(owner, conversationId)?.mappingRevision === facts.mappingRevision;
      },
      async onAppliedEvidence(evidence) {
        if (!active(owner)) { evidence.commitId.fill(0); evidence.commitHash.fill(0); evidence.priorCommitHash.fill(0); evidence.membershipDigest.fill(0); evidence.newEpochKeyCommitment.fill(0); return; }
        const conversationId = deps.conversationForRoom(owner, evidence.room);
        const acceptedFacts = conversationId ? deps.roomMembershipFacts(owner, conversationId) : null;
        if (!conversationId || !acceptedFacts?.joined || (acceptedFacts.scheme !== 'ascii' && acceptedFacts.scheme !== 'rfc1459' && acceptedFacts.scheme !== 'strict-rfc1459')) {
          if (conversationId) deps.setRoomSendGate(owner, conversationId, 'recovery-required');
          return;
        }
        const acceptedMembershipRevision = `accepted:${hex(evidence.commitHash)}`;
        const acceptedMappingRevision = `irc-casemapping-v1:${acceptedFacts.scheme}`;
        const evidenceKey = `${ownerLifecycleKey(owner)}\0${evidence.room}\0${evidence.epoch}`;
        const prior = acceptedCommits.get(evidenceKey);
        if (prior && !equalBytes(prior.evidence.commitHash, evidence.commitHash)) {
          // A cryptographically accepted second branch is a hard room conflict.
          const conversationId = deps.conversationForRoom(owner, evidence.room);
          if (conversationId) deps.setRoomSendGate(owner, conversationId, 'recovery-required');
          wipeEvidence(prior.evidence); acceptedCommits.delete(evidenceKey);
        }
        acceptedCommits.set(evidenceKey, { owner: Object.freeze({ ...owner }), evidence: cloneEvidence(evidence), acceptedMembershipRevision,
          acceptedMappingScheme: acceptedFacts.scheme, acceptedMappingRevision });
        while (acceptedCommits.size > 256) { const oldest = acceptedCommits.keys().next().value as string | undefined; if (!oldest) break; const expired = acceptedCommits.get(oldest); wipeEvidence(expired?.evidence); acceptedCommits.delete(oldest); }
        const receiptRef = Symbol('verified-group-control-receipt');
        ingressReceipts.set(receiptRef, { owner: Object.freeze({ ...owner }), evidence, outcome: { status: 'applied', room: evidence.room, epoch: evidence.epoch } });
        while (ingressReceipts.size > 128) {
          const oldest = ingressReceipts.keys().next().value as symbol | undefined;
          if (!oldest) break;
          const removed = ingressReceipts.get(oldest); wipeEvidence(removed?.evidence); ingressReceipts.delete(oldest);
        }
        await persistAcceptedEvidence(owner, evidence);
      },
    });
    adapterOwner = Object.freeze({ ...owner });
    return true;
  }
  function cloneEvidence(evidence: GroupControlAppliedEvidence): GroupControlAppliedEvidence {
    return { ...evidence, commitId: evidence.commitId.slice(), commitHash: evidence.commitHash.slice(), priorCommitHash: evidence.priorCommitHash.slice(), membershipDigest: evidence.membershipDigest.slice(), newEpochKeyCommitment: evidence.newEpochKeyCommitment.slice(),
      ...(evidence.acceptedSignerPublicKey ? { acceptedSignerPublicKey: evidence.acceptedSignerPublicKey.slice() } : {}) };
  }
  async function ingestGroupControlNow(input: { context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }; line: string }): Promise<SafeGroupIngressResult> {
    if (typeof input.line !== 'string' || input.line.length > 64 * 1024 || /[\r\n\u0000]/u.test(input.line) || !active(input.context.owner)) return { status: 'ignored', reason: 'stale', room: null, epoch: null, fromAccount: null, fromDevice: null, commitId: null, commitHash: null, membershipDigest: null, inputKind: null, receiptRef: null };
    if (!await ensureGroupAdapter(input.context.owner) || !active(input.context.owner) || !groupAdapter) return { status: 'locked', reason: 'session-unavailable', room: null, epoch: null, fromAccount: null, fromDevice: null, commitId: null, commitHash: null, membershipDigest: null, inputKind: null, receiptRef: null };
    const before = new Set(ingressReceipts.keys());
    const outcome = await groupAdapter.accept(input.line);
    if (!active(input.context.owner)) return { status: 'ignored', reason: 'stale', room: null, epoch: null, fromAccount: null, fromDevice: null, commitId: null, commitHash: null, membershipDigest: null, inputKind: null, receiptRef: null };
    const room = outcome.room ?? null; const epoch = outcome.epoch ?? null;
    if (outcome.status !== 'applied' || !room || epoch === null) return { status: outcome.status, reason: outcome.reason ?? null, room, epoch, fromAccount: null, fromDevice: null, commitId: null, commitHash: null, membershipDigest: null, inputKind: null, receiptRef: null };
    const found = [...ingressReceipts.entries()].reverse().find(([ref, receipt]) => !before.has(ref) && equalOwner(receipt.owner, input.context.owner) && receipt.evidence.room === room && receipt.evidence.epoch === epoch);
    if (!found) return { status: 'locked', reason: 'session-unavailable', room, epoch, fromAccount: null, fromDevice: null, commitId: null, commitHash: null, membershipDigest: null, inputKind: null, receiptRef: null };
    const [receiptRef, receipt] = found;
    return { status: outcome.status, reason: null, room, epoch, fromAccount: receipt.evidence.fromAccount, fromDevice: receipt.evidence.fromDevice, commitId: receipt.evidence.commitId.slice(), commitHash: receipt.evidence.commitHash.slice(), membershipDigest: receipt.evidence.membershipDigest.slice(), inputKind: receipt.evidence.inputKind, receiptRef };
  }
  /**
   * An applied, receipt-backed control may complete this tab's own authoring
   * operation: the relayed commit is observed and the self-addressed welcome
   * installs the epoch, which reopens the room send gate. The authoring
   * runtime re-verifies the single-use receipt and the exact operation match;
   * controls from other authors only consume their receipt here.
   */
  /**
   * After a verified welcome/bootstrap install, a non-author has no authoring
   * operation that would reopen the required-room send gate. Reopen it only
   * when the accepted epoch is this tab's current head and its membership
   * digest still equals one rebuilt from the current verified directory, i.e.
   * the installed key covers exactly today's verified members.
   */
  async function openSendGateAfterInstall(owner: OwnerSnapshot, room: string, epoch: number): Promise<void> {
    const conversationId = deps.conversationForRoom(owner, room);
    const evidence = acceptedCommits.get(`${ownerLifecycleKey(owner)}\0${room}\0${epoch}`)?.evidence;
    if (!conversationId || !evidence || !owner.accountId || !identity || !active(owner)) return;
    if (groupProviders.currentAcceptedHead(owner, conversationId)?.epoch !== epoch) return;
    const directory = await providerVerifiedDirectory({ schemaVersion: 1, requestId: requestId(), owner, conversationId });
    const localDevice = identity?.deviceId;
    if (!directory || !localDevice || !active(owner)) return;
    const digest = await buildMembershipDigest({ networkId: String(owner.networkId), priorEpoch: evidence.priorEpoch, priorCommitHash: evidence.priorCommitHash,
      localAccount: String(owner.accountId), localDeviceId: localDevice, directory });
    const same = !!digest && equalBytes(digest, evidence.membershipDigest); digest?.fill(0);
    if (same && active(owner) && groupProviders.currentAcceptedHead(owner, conversationId)?.epoch === epoch) deps.setRoomSendGate(owner, conversationId, 'ready');
  }
  async function settleOwnAuthoring(context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }, result: SafeGroupIngressResult): Promise<void> {
    const owner = context.owner;
    if (result.status !== 'applied' || !result.receiptRef || !result.inputKind || !result.room || result.epoch === null || !result.fromAccount || !result.fromDevice
      || !result.commitId || !result.commitHash || !result.membershipDigest || !owner.accountId || !identity || !active(owner)) return;
    const conversationId = deps.conversationForRoom(owner, result.room);
    if (!conversationId) return;
    await authoring.onAuthenticatedControl({ context, receiptRef: result.receiptRef, conversationId, room: result.room, kind: result.inputKind, inputKind: result.inputKind,
      accountId: result.fromAccount as AccountId, deviceId: result.fromDevice, epoch: result.epoch,
      ...(result.inputKind === 'welcome' ? { toAccount: owner.accountId, toDevice: identity.deviceId } : {}),
      commitId: result.commitId, commitHash: result.commitHash, membershipDigest: result.membershipDigest });
    if (result.inputKind === 'welcome') await openSendGateAfterInstall(owner, result.room, result.epoch);
  }
  function ingestGroupControl(input: { context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }; line: string }): Promise<SafeGroupIngressResult> {
    if (ingestQueued >= 64) return Promise.resolve({ status: 'locked', reason: 'evicted', room: null, epoch: null, fromAccount: null, fromDevice: null, commitId: null, commitHash: null, membershipDigest: null, inputKind: null, receiptRef: null });
    ingestQueued++;
    const next = ingestTail.then(() => ingestGroupControlNow(input), () => ingestGroupControlNow(input))
      .then(async (result) => { await settleOwnAuthoring(input.context, result); return result; });
    ingestTail = next.then(() => undefined, () => undefined);
    return next.finally(() => { ingestQueued--; });
  }
  function verifyIngressReceipt(receiptRef: symbol, owner: OwnerSnapshot, conversationId: ConversationId, room: string, epoch: number, accountId: AccountId, deviceId: string, inputKind: 'commit' | 'welcome', commitId: Uint8Array, commitHash: Uint8Array, membershipDigest: Uint8Array): boolean {
    const receipt = ingressReceipts.get(receiptRef);
    return !!receipt && active(owner) && equalOwner(receipt.owner, owner) && deps.conversationForRoom(owner, room) === conversationId && receipt.evidence.room === room && receipt.evidence.epoch === epoch
      && receipt.evidence.fromAccount === accountId && receipt.evidence.fromDevice === deviceId && receipt.evidence.inputKind === inputKind
      && equalBytes(receipt.evidence.commitId, commitId) && equalBytes(receipt.evidence.commitHash, commitHash) && equalBytes(receipt.evidence.membershipDigest, membershipDigest);
  }
  function consumeIngressReceipt(receiptRef: symbol, owner: OwnerSnapshot, room: string, epoch: number, accountId: string, deviceId: string, inputKind: 'commit' | 'welcome', commitId: Uint8Array, commitHash: Uint8Array, membershipDigest: Uint8Array): boolean {
    const conversationId = deps.conversationForRoom(owner, room);
    if (!conversationId || !verifyIngressReceipt(receiptRef, owner, conversationId, room, epoch, accountId as AccountId, deviceId, inputKind, commitId, commitHash, membershipDigest)) return false;
    const receipt = ingressReceipts.get(receiptRef)!;
    ingressReceipts.delete(receiptRef);
    wipeEvidence(receipt.evidence);
    return true;
  }
  const privateIdentity: PrivateIdentity = {
    async proveAccount(input) {
      if (!active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'prove-account', requestId: input.requestId })) return null;
      const proof = await deps.identityPurposes.proveAccount(input);
      if (!active(input.owner)) { proof?.fill(0); return null; }
      return proof;
    },
    async verifyServerProof(input) { return active(input.owner) && await deps.identityPurposes.verifyServerProof(input) && active(input.owner); },
    async verifyTrustedDevice(input) { return active(input.owner) && await deps.identityPurposes.verifyTrustedDevice(input) && active(input.owner); },
    async encryptForConversation(input) {
      if (!active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'encrypt-conversation', requestId: input.requestId })) return null;
      const policy = deps.conversationPolicy(input.owner, input.conversationId);
      if (!policy || policy.encryption === 'unknown' || !policy.eligible) return null;
      if (policy.encryption === 'plain') return null;
      if (policy.encryption === 'dm-required') {
        const sealed = await sealDmToCurrentPeer(input);
        const fresh = deps.conversationPolicy(input.owner, input.conversationId);
        const text = sealed ? decoder.decode(sealed) : '';
        if (!active(input.owner) || !fresh || fresh.revision !== policy.revision || fresh.encryption !== 'dm-required' || fresh.epoch !== policy.epoch || fresh.room !== policy.room || !fresh.eligible || !sealed || !isValidDmEnvelope(text)) { sealed?.fill(0); return null; }
        return sealed;
      }
      if (policy.encryption === 'room-required' && policy.room && policy.epoch !== null) {
        const session = sessions.get(`${ownerLifecycleKey(input.owner)}\0${policy.room}`);
        if (!session || session.epoch !== BigInt(policy.epoch) || !active(input.owner)) return null;
        const plaintext = decoder.decode(input.plaintext);
        const result = await session.sealRoomMessage(policy.room, plaintext);
        const fresh = deps.conversationPolicy(input.owner, input.conversationId);
        const parsed = result.ok ? parseGroupEnvelope(result.envelope) : null;
        if (!active(input.owner) || !fresh || fresh.revision !== policy.revision || fresh.encryption !== 'room-required' || fresh.room !== policy.room || fresh.epoch !== policy.epoch || !result.ok || result.epoch !== policy.epoch || !parsed || parsed.keyEpoch !== policy.epoch) return null;
        return encoder.encode(result.envelope);
      }
      return null;
    },
    async signGroupControl(input) {
      if (!active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'group-author', requestId: input.requestId }) || !await ensureIdentity(input.owner) || !active(input.owner)) return null;
      const key = identity?.signing.privateKey;
      if (!key || key.extractable || key.algorithm.name !== 'Ed25519') return null;
      try { const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, cryptoBytes(input.canonicalControl))); if (!active(input.owner)) { signature.fill(0); return null; } return signature; } catch { return null; }
    },
    async signMediaHandshake(input) {
      if (!active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'sign-media-handshake', requestId: input.requestId }) || !await ensureIdentity(input.owner)) return null;
      try { const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', identity!.signing.privateKey, cryptoBytes(input.canonicalHandshake))); if (!active(input.owner)) { signature.fill(0); return null; } return signature; } catch { return null; }
    },
    async signMediaFrame(input) {
      if (!active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'sign-media-frame', requestId: input.requestId }) || !await ensureIdentity(input.owner)) return null;
      try { const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', identity!.signing.privateKey, cryptoBytes(input.frame))); if (!active(input.owner)) { signature.fill(0); return null; } return signature; } catch { return null; }
    },
    async getMediaPublicIdentity(input) {
      if (!active(input.owner) || !await ensureIdentity(input.owner)) return null;
      const record = identity!;
      const [ecdh, signing] = await Promise.all([crypto.subtle.exportKey('raw', record.wrapping.publicKey), crypto.subtle.exportKey('raw', record.signing.publicKey)]);
      const directoryRevision = deps.directoryRevision(input.owner, input.conversationId);
      return active(input.owner) && directoryRevision ? { deviceId: record.deviceId, ecdhPublicRaw: copy(ecdh), signingPublicRaw: copy(signing), directoryRevision } : null;
    },
    async verifyMediaPeerBinding(input) {
      if (!active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'verify-media-peer', requestId: input.requestId })) return null;
      const peer = await deps.resolveMediaPeer(input.owner, input.peerNick, input.attachmentId);
      if (!peer) return null;
      const targetDirectoryRevision = deps.directoryRevision(input.owner, input.conversationId);
      const directory = await deps.authenticatedDirectory(input.owner, peer.accountId);
      if (!active(input.owner) || !directory || !targetDirectoryRevision) return null;
      const privateDb = await ensureDB(); const local = identity;
      const scope = local ? stableScope(input.owner, local.deviceId) : null;
      const device = directory.snapshot.devices.find((d) => d.account.toLowerCase() === peer.accountId.toLowerCase() && d.deviceId === peer.deviceId && !d.legacy && !!d.entry);
      if (!privateDb || !scope || !device?.entry || !equalBytes(device.entry.encryptionPub, input.ecdhPublicRaw)
        || !equalBytes(device.entry.signerPub, input.signingPublicRaw) || !isValidP256UncompressedPublicKey(input.ecdhPublicRaw)
        || await deriveGroupDeviceId(device.entry) !== peer.deviceId) return null;
      const pin = await requestResult(privateDb.db, 'trusted-signers', 'readonly', `${scope}\0${peer.accountId.toLowerCase()}\0${peer.deviceId}`)
        .catch(() => null) as TrustedGroupSignerPin | null;
      if (!active(input.owner) || !pin || pin.deleted === true || pin.signerPub !== toB64url(device.entry.signerPub)) return null;
      try {
        const key = await crypto.subtle.importKey('raw', cryptoBytes(input.signingPublicRaw), { name: 'Ed25519' }, false, ['verify']);
        const valid = await crypto.subtle.verify('Ed25519', key, cryptoBytes(input.signature), cryptoBytes(input.handshakeTranscript));
        const currentDirectoryRevision = deps.directoryRevision(input.owner, input.conversationId);
        const currentDirectory = await deps.authenticatedDirectory(input.owner, peer.accountId);
        const currentPeer = await deps.resolveMediaPeer(input.owner, input.peerNick, input.attachmentId);
        return active(input.owner) && valid && currentDirectoryRevision === targetDirectoryRevision
          && currentDirectory?.revision === directory.revision && currentPeer?.accountId === peer.accountId
          && currentPeer.deviceId === peer.deviceId ? { ...peer, directoryRevision: targetDirectoryRevision } : null;
      } catch { return null; }
    },
    async establishKeyAgreement(input) {
      if (!isValidP256UncompressedPublicKey(input.peerPublicKey) || !active(input.owner) || !deps.authorizePurpose({ owner: input.owner, purpose: 'establish-key-agreement' }) || !await ensureIdentity(input.owner)) return null;
      try {
        const peer = await crypto.subtle.importKey('raw', cryptoBytes(input.peerPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const raw = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, identity!.wrapping.privateKey, 256);
        if (!active(input.owner)) { new Uint8Array(raw).fill(0); return null; }
        const key = await crypto.subtle.importKey('raw', cryptoBytes(new Uint8Array(raw)), { name: 'HKDF' }, false, ['deriveKey']);
        new Uint8Array(raw).fill(0);
        if (!active(input.owner)) return null;
        const handle = Symbol('private-shared-key'); sharedAgreements.set(handle, key);
        while (sharedAgreements.size > 128) sharedAgreements.delete(sharedAgreements.keys().next().value as symbol);
        return { publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', identity!.wrapping.publicKey)), sharedKeyHandle: handle };
      } catch { return null; }
    },
  };
  /**
   * Explicit device trust (no automatic or first-use trust).
   * SECURITY: requires independent security review before release.
   * preview: binds a room member's device, as listed by the authenticated
   * exact-server directory with a key-derived ODD1 id, to the SHA-256
   * fingerprint of its signer key for the user to compare out of band.
   * confirm: only with that previewRef and an explicit confirm, re-reads the
   * directory and writes the pin into the existing trusted-signer store. It
   * never overwrites a different or removed pin.
   */
  const deviceTrustPreviews = new Map<string, { owner: OwnerSnapshot; conversationId: ConversationId; accountId: string; deviceId: string; signerB64: string; expiresAt: number }>();
  async function memberDirectoryDevice(owner: OwnerSnapshot, conversationId: ConversationId, accountId: string, deviceId: string) {
    if (!active(owner) || !owner.accountId || !/^[A-Za-z0-9_.-]{1,32}$/u.test(deviceId) || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(accountId)) return null;
    const facts = deps.roomMembershipFacts(owner, conversationId);
    const account = accountId.toLowerCase();
    if (!facts?.joined || facts.complete !== true || !facts.memberAccounts?.some((member) => String(member).toLowerCase() === account)) return null;
    if (!await ensureIdentity(owner, false) || !active(owner) || !identity) return null;
    if (account === owner.accountId.toLowerCase() && deviceId === identity.deviceId) return null;
    const directory = await deps.authenticatedDirectory(owner, account as AccountId);
    if (!active(owner) || !directory || directory.provenance !== 'authenticated-exact-server' || !equalOwner(directory.owner, owner)
      || directory.snapshot.account.toLowerCase() !== account) return null;
    const row = directory.snapshot.devices.find((candidate) => candidate.account.toLowerCase() === account && candidate.deviceId === deviceId);
    if (!row?.trusted || row.legacy || !row.entry || !row.directoryKey) return null;
    const parsed = decodeGroupDeviceDirectoryEntry(row.publicKey);
    if (!parsed || await deriveGroupDeviceId(parsed) !== row.deviceId || toB64url(parsed.signerPub) !== row.directoryKey || !active(owner)) return null;
    return { account, signerB64: row.directoryKey, signerPub: parsed.signerPub };
  }
  async function previewDeviceTrust(input: { context: RequestContext; conversationId: ConversationId; accountId: string; deviceId: string }): Promise<{ previewRef: string; accountId: string; deviceId: string; fingerprintHex: string } | null> {
    const owner = input.context.owner;
    const device = await memberDirectoryDevice(owner, input.conversationId, input.accountId, input.deviceId);
    if (!device) return null;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoBytes(device.signerPub)));
    const fingerprintHex = hex(digest); digest.fill(0); device.signerPub.fill(0);
    if (!active(owner)) return null;
    const previewRef = hex(crypto.getRandomValues(new Uint8Array(24)));
    deviceTrustPreviews.set(previewRef, { owner: Object.freeze({ ...owner }), conversationId: input.conversationId, accountId: device.account, deviceId: input.deviceId, signerB64: device.signerB64, expiresAt: Date.now() + 5 * 60_000 });
    while (deviceTrustPreviews.size > 16) deviceTrustPreviews.delete(deviceTrustPreviews.keys().next().value as string);
    return { previewRef, accountId: device.account, deviceId: input.deviceId, fingerprintHex };
  }
  async function confirmDeviceTrust(input: { context: RequestContext; previewRef: string; confirm: true }): Promise<'pinned' | 'already-pinned' | 'blocked'> {
    const owner = input.context.owner;
    const saved = deviceTrustPreviews.get(input.previewRef);
    deviceTrustPreviews.delete(input.previewRef);
    if (input.confirm !== true || !saved || saved.expiresAt <= Date.now() || !equalOwner(saved.owner, owner) || !active(owner)) return 'blocked';
    const device = await memberDirectoryDevice(owner, saved.conversationId, saved.accountId, saved.deviceId);
    device?.signerPub.fill(0);
    if (!device || device.signerB64 !== saved.signerB64 || !identity) return 'blocked';
    const privateDb = await ensureDB(); const scope = stableScope(owner, identity.deviceId);
    if (!privateDb || !scope || !active(owner)) return 'blocked';
    const key = `${scope}\0${saved.accountId}\0${saved.deviceId}`;
    const prior = await requestResult(privateDb.db, 'trusted-signers', 'readonly', key).catch(() => null) as TrustedGroupSignerPin | null;
    if (!active(owner)) return 'blocked';
    if (prior) return prior.deleted !== true && prior.signerPub === saved.signerB64 ? 'already-pinned' : 'blocked';
    try { await requestResult(privateDb.db, 'trusted-signers', 'readwrite', key, { account: saved.accountId, deviceId: saved.deviceId, signerPub: saved.signerB64 } satisfies TrustedGroupSignerPin); }
    catch { return 'blocked'; }
    return active(owner) ? 'pinned' : 'blocked';
  }
  async function tombstoneDevicePin(owner: OwnerSnapshot, accountId: string, deviceId: string): Promise<boolean> {
    if (!active(owner) || !/^[A-Za-z0-9_.-]{1,32}$/u.test(deviceId) || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(accountId) || !await ensureIdentity(owner, false) || !identity) return false;
    const account = accountId.toLowerCase();
    if (owner.accountId && account === owner.accountId.toLowerCase() && deviceId === identity.deviceId) return false;
    const directory = await deps.authenticatedDirectory(owner, account as AccountId);
    const row = directory?.snapshot.devices.find((candidate) => candidate.account.toLowerCase() === account && candidate.deviceId === deviceId);
    const privateDb = await ensureDB(); const scope = identity ? stableScope(owner, identity.deviceId) : null;
    if (!row || !privateDb || !scope || !active(owner)) return false;
    const key = `${scope}\0${account}\0${deviceId}`;
    const prior = await requestResult(privateDb.db, 'trusted-signers', 'readonly', key).catch(() => null) as TrustedGroupSignerPin | null;
    try { await requestResult(privateDb.db, 'trusted-signers', 'readwrite', key, { account, deviceId, signerPub: prior?.signerPub ?? row.directoryKey ?? '', deleted: true } satisfies TrustedGroupSignerPin); }
    catch { return false; }
    return active(owner);
  }
  async function isTrustedDevicePinned(owner: OwnerSnapshot, accountId: AccountId, deviceId: string): Promise<boolean> {
    if (!active(owner) || !/^[A-Za-z0-9_.-]{1,32}$/u.test(deviceId) || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(accountId)
      || !await ensureIdentity(owner, false) || !active(owner) || !identity) return false;
    const record = identity;
    const directory = await deps.authenticatedDirectory(owner, accountId);
    const scope = stableScope(owner, record.deviceId);
    const directoryDevice = directory?.snapshot.devices.find((candidate) => candidate.account.toLowerCase() === accountId.toLowerCase()
      && candidate.deviceId === deviceId && !candidate.legacy && !!candidate.entry);
    const expectedRevision = directory?.revision;
    if (!directory || directory.provenance !== 'authenticated-exact-server' || directory.trusted !== false
      || !directoryDevice?.entry || !scope || !deps.isCurrent(owner)) return false;
    const derived = await deriveGroupDeviceId(directoryDevice.entry);
    if (!active(owner) || derived !== deviceId) return false;
    const privateDb = await ensureDB();
    if (!privateDb || !active(owner)) return false;
    const pin = await requestResult(privateDb.db, 'trusted-signers', 'readonly', `${scope}\0${accountId.toLowerCase()}\0${deviceId}`)
      .catch(() => null) as TrustedGroupSignerPin | null;
    const current = await deps.authenticatedDirectory(owner, accountId);
    return active(owner) && identity === record && !!pin && pin.deleted !== true
      && pin.signerPub === toB64url(directoryDevice.entry.signerPub)
      && current?.revision === expectedRevision && deps.isCurrent(owner);
  }
  const privateOps: PrivateGroupOperations = {
    ownerCurrent: (owner) => active(owner),
    async getSigningPublic(owner, conversationId) {
      if (!await ensureIdentity(owner) || !active(owner)) return null;
      const record = identity!; const [signer, wrap] = await Promise.all([crypto.subtle.exportKey('raw', record.signing.publicKey), crypto.subtle.exportKey('raw', record.wrapping.publicKey)]);
      const revision = deps.directoryRevision(owner, conversationId);
      return active(owner) ? { deviceId: record.deviceId, signerPublicKey: copy(signer), wrapPublicKey: copy(wrap), revision: revision ?? record.scope } : null;
    },
    async sign(input) { return privateIdentity.signGroupControl(input); },
    prepareWelcome: prepareGroupWelcome,
    ingestGroupControl,
    verifyIngressReceipt,
    consumeIngressReceipt,
    retireRoom(owner, room) {
      if (!active(owner)) return;
      const session = sessions.get(`${ownerLifecycleKey(owner)}\0${room}`); session?.destroy(); sessions.delete(`${ownerLifecycleKey(owner)}\0${room}`);
      if (groupAdapter) { void groupAdapter.destroy(); groupAdapter = null; adapterOwner = null; }
      for (const [ref, receipt] of ingressReceipts) if (equalOwner(receipt.owner, owner) && receipt.evidence.room === room) { wipeEvidence(receipt.evidence); ingressReceipts.delete(ref); }
    },
    membershipChanged(owner, room) {
      if (!active(owner)) return;
      const session = sessions.get(`${ownerLifecycleKey(owner)}\0${room}`); session?.destroy(); sessions.delete(`${ownerLifecycleKey(owner)}\0${room}`);
      if (groupAdapter) { void groupAdapter.destroy(); groupAdapter = null; adapterOwner = null; }
      for (const [ref, receipt] of ingressReceipts) if (equalOwner(receipt.owner, owner) && receipt.evidence.room === room) { wipeEvidence(receipt.evidence); ingressReceipts.delete(ref); }
    },
  };
  async function acquireAuthorLease(input: { owner: OwnerSnapshot; room: string; nonce: string }): Promise<{ isCurrent: () => boolean; release: () => void } | null> {
    if (!active(input.owner) || !/^[a-f0-9]{32,128}$/u.test(input.nonce)) return null;
    const intentKey = await coordinationKey(input.owner, input.room);
    if (!intentKey || !active(input.owner)) return null;
    const lockName = `onyx-group-author-${intentKey.slice('author-intent:'.length)}`;
    const privateDb = await ensureDB();
    if (!privateDb || !identity || !active(input.owner)) return null;
    const markerKey = intentKey;
    let existing: unknown;
    try { existing = await requestResult(privateDb.db, 'room-author-intents', 'readonly', markerKey); }
    catch { return null; }
    if (existing !== undefined || !active(input.owner)) return null;
    if (typeof navigator === 'undefined' || !navigator.locks) {
      const leaseKey = `lease:${intentKey}`;
      if (!await claimLease(privateDb.db, leaseKey, input.nonce, Date.now()) || !active(input.owner)) return null;
      let lost = false; let expiresAt = Date.now() + 30_000;
      const heartbeat = setInterval(() => { const now = Date.now(); if (now >= expiresAt) { lost = true; return; } void renewLease(privateDb.db, leaseKey, input.nonce, now).then((nextExpiry) => { if (nextExpiry === null) lost = true; else expiresAt = nextExpiry; }); }, 10_000);
      return trackLease(input.owner, () => !lost && Date.now() < expiresAt && active(input.owner), () => { clearInterval(heartbeat); void deleteIfNonce(privateDb.db, 'room-author-intents', leaseKey, input.nonce); });
    }
    let resolveLease!: (lease: { isCurrent: () => boolean; release: () => void } | null) => void;
    const acquired = new Promise<{ isCurrent: () => boolean; release: () => void } | null>((resolve) => { resolveLease = resolve; });
    let releaseHold!: () => void;
    const held = new Promise<void>((resolve) => { releaseHold = resolve; });
    let lockHeld = false; let released = false;
    void navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || !active(input.owner)) { resolveLease(null); return; }
      let marker: unknown;
      try { marker = await requestResult(privateDb.db, 'room-author-intents', 'readonly', markerKey); }
      catch { resolveLease(null); return; }
      if (marker !== undefined || !active(input.owner)) { resolveLease(null); return; }
      lockHeld = true;
      resolveLease(trackLease(input.owner, () => lockHeld && !released && active(input.owner), () => { released = true; releaseHold(); }));
      await held;
      lockHeld = false;
    }).catch(() => resolveLease(null));
    return acquired;
  }
  async function persistAuthorIntent(input: { owner: OwnerSnapshot; room: string; nonce: string; priorEpoch: number; priorHash: Uint8Array; nextEpoch: number; commitId: Uint8Array; commitHash: Uint8Array; stage: 'prepared' | 'admitted' | 'unknown' | 'resolved' | 'cancelled' }): Promise<boolean> {
    if (!active(input.owner) || !identity || !Number.isSafeInteger(input.priorEpoch) || !Number.isSafeInteger(input.nextEpoch)
      || input.priorHash.byteLength !== 32 || input.commitId.byteLength !== 32 || input.commitHash.byteLength !== 32) return false;
    const privateDb = await ensureDB(); const scope = stableScope(input.owner, identity.deviceId);
    const key = await coordinationKey(input.owner, input.room);
    if (!privateDb || !scope || !key || !active(input.owner)) return false;
    const value = { kind: 'author-intent', nonce: input.nonce, scope, room: input.room, priorEpoch: input.priorEpoch, priorHash: hex(input.priorHash), nextEpoch: input.nextEpoch,
      commitId: hex(input.commitId), commitHash: hex(input.commitHash), stage: input.stage };
    if (input.stage === 'resolved' || input.stage === 'cancelled') {
      if (input.stage === 'cancelled') {
        // Only a still-prepared intent is definitively safe to cancel.
        return await new Promise<boolean>((resolve) => {
          let tx: IDBTransaction; try { tx = privateDb.db.transaction('room-author-intents', 'readwrite'); } catch { resolve(false); return; }
          const store = tx.objectStore('room-author-intents'); const get = store.get(key); let removed = false;
          get.onsuccess = () => { const prior = get.result as { nonce?: unknown; stage?: unknown; kind?: unknown } | undefined;
            if (prior?.nonce === input.nonce && prior.kind === 'author-intent' && prior.stage === 'prepared') { store.delete(key); removed = true; } };
          tx.oncomplete = () => resolve(removed && active(input.owner)); tx.onerror = tx.onabort = () => resolve(false);
        });
      }
      return await deleteIfNonce(privateDb.db, 'room-author-intents', key, input.nonce) && active(input.owner);
    }
    if (input.stage === 'prepared') return await addIfAbsent(privateDb.db, 'room-author-intents', key, value) && active(input.owner);
    const written = await transitionAuthorIntent(privateDb.db, key, input.nonce, value, input.stage);
    return written && active(input.owner);
  }
  /**
   * A fresh-create genesis proof is single use: planning reserves it, after
   * which bootstrap no longer offers the unreserved fact. Commit and the
   * author's own commit observation must still re-derive the genesis head, so
   * the reservation is remembered here and re-validated by bootstrap on every
   * use. Nothing here widens authority: an invalid reservation yields null.
   */
  const genesisCandidates = new Map<symbol, { owner: OwnerSnapshot; conversationId: ConversationId; deviceId: string; mappingRevision: string }>();
  const genesisReservations = new Map<string, { owner: OwnerSnapshot; conversationId: ConversationId; proofRef: symbol; reservation: symbol; deviceId: string; mappingRevision: string }>();
  const genesisKey = (owner: OwnerSnapshot, conversationId: ConversationId) => `${ownerLifecycleKey(owner)}\0${conversationId}`;
  async function reserveGenesis(owner: OwnerSnapshot, conversationId: ConversationId, proofRef: symbol): Promise<symbol | null> {
    if (!deps.reserveFreshCreateProof) return null;
    const reservation = await deps.reserveFreshCreateProof(owner, conversationId, proofRef);
    const candidate = genesisCandidates.get(proofRef);
    genesisCandidates.delete(proofRef);
    if (reservation && candidate && equalOwner(candidate.owner, owner) && candidate.conversationId === conversationId && active(owner)) {
      genesisReservations.set(genesisKey(owner, conversationId), { owner: candidate.owner, conversationId, proofRef, reservation, deviceId: candidate.deviceId, mappingRevision: candidate.mappingRevision });
      while (genesisReservations.size > 32) genesisReservations.delete(genesisReservations.keys().next().value as string);
    }
    return reservation;
  }
  async function reservedGenesisFact(owner: OwnerSnapshot, conversationId: ConversationId): Promise<FreshGenesisFact | null> {
    const key = genesisKey(owner, conversationId);
    const reserved = genesisReservations.get(key);
    if (!reserved || !owner.accountId || !equalOwner(reserved.owner, owner) || !deps.validateFreshCreateReservation) return null;
    if (!await deps.validateFreshCreateReservation(owner, conversationId, reserved.reservation) || !active(owner)) { genesisReservations.delete(key); return null; }
    return { kind: 'new-room-genesis', epoch: 0, commitHash: new Uint8Array(32), membershipRevision: 'reserved-genesis', mappingRevision: reserved.mappingRevision,
      accountId: owner.accountId, deviceId: reserved.deviceId, proofRef: reserved.proofRef };
  }
  async function validGenesisProof(owner: OwnerSnapshot, conversationId: ConversationId, proof: FreshGenesisFact): Promise<boolean> {
    const reserved = genesisReservations.get(genesisKey(owner, conversationId));
    if (reserved && reserved.proofRef === proof.proofRef && equalOwner(reserved.owner, owner) && deps.validateFreshCreateReservation)
      return await deps.validateFreshCreateReservation(owner, conversationId, reserved.reservation);
    return !!deps.validateFreshCreateReservation && await deps.validateFreshCreateReservation(owner, conversationId, proof.proofRef);
  }
  async function currentGroupHead(owner: OwnerSnapshot, conversationId: ConversationId): Promise<GroupHead | null> {
    if (!active(owner)) return null;
    const room = deps.conversationPolicy(owner, conversationId)?.room;
    const facts = deps.roomMembershipFacts(owner, conversationId);
    if (!room || !facts?.joined) return null;
    const session = sessions.get(`${ownerLifecycleKey(owner)}\0${room}`);
    if (!session || session.isDestroyed || !owner.accountId || !identity || !validIdentityRecord(identity, owner)) {
      if (!owner.accountId || !deps.freshGenesisFact) return null;
      const candidate = await deps.freshGenesisFact(owner, conversationId) ?? await reservedGenesisFact(owner, conversationId);
      if (!candidate || candidate.kind !== 'new-room-genesis' || candidate.epoch !== 0 || typeof candidate.proofRef !== 'symbol'
        || candidate.accountId !== owner.accountId || candidate.commitHash.byteLength !== 32 || candidate.commitHash.some((byte) => byte !== 0)
        || !active(owner)) return null;
      const context: RequestContext = { schemaVersion: 1, requestId: requestId(), owner };
      if (!await ensureIdentity(owner) || !active(owner) || !identity || candidate.deviceId !== identity.deviceId) return null;
      const directory = await providerVerifiedDirectory({ ...context, conversationId });
      if (!directory || !active(owner) || directory.canonicalRoom !== room || directory.mappingRevision !== facts.mappingRevision
        || candidate.mappingRevision !== facts.mappingRevision) return null;
      const zeroHash = new Uint8Array(32);
      const digest = await buildMembershipDigest({ networkId: owner.networkId, priorEpoch: 0, priorCommitHash: zeroHash,
        localAccount: owner.accountId, localDeviceId: identity.deviceId, directory });
      zeroHash.fill(0);
      if (!digest || !active(owner) || deps.roomMembershipFacts(owner, conversationId)?.mappingRevision !== facts.mappingRevision) {
        digest?.fill(0); return null;
      }
      if (candidate.membershipDigest && !equalBytes(candidate.membershipDigest, digest)) { digest.fill(0); return null; }
      const genesis: GroupHead = { kind: 'new-room-genesis', epoch: 0, commitHash: new Uint8Array(32),
        membershipDigest: digest, membershipRevision: directory.revision, mappingRevision: directory.mappingRevision,
        accountId: owner.accountId, deviceId: identity.deviceId, proofRef: candidate.proofRef };
      genesisCandidates.set(candidate.proofRef, { owner: Object.freeze({ ...owner }), conversationId, deviceId: identity.deviceId, mappingRevision: directory.mappingRevision });
      while (genesisCandidates.size > 32) genesisCandidates.delete(genesisCandidates.keys().next().value as symbol);
      return genesis;
    }
    const accepted = acceptedCommits.get(`${ownerLifecycleKey(owner)}\0${room}\0${session.epoch}`);
    const evidence = accepted?.evidence;
    const commitHash = session.commitHash(); const membershipDigest = session.membershipDigest();
    if (!commitHash || !membershipDigest || !active(owner) || !accepted || !evidence
      || !equalBytes(evidence.commitHash, commitHash) || !equalBytes(evidence.membershipDigest, membershipDigest)
      || facts.scheme !== accepted.acceptedMappingScheme || accepted.acceptedMappingRevision !== `irc-casemapping-v1:${facts.scheme}`) {
      commitHash?.fill(0); membershipDigest?.fill(0); return null;
    }
    const head: GroupHead = { kind: 'established', epoch: Number(session.epoch), commitHash, membershipDigest,
      membershipRevision: accepted.acceptedMembershipRevision, mappingRevision: accepted.acceptedMappingRevision, accountId: owner.accountId, deviceId: identity.deviceId };
    return head;
  }
  const authoring = createGroupAuthoring({
    transport: deps.transport,
    privateIdentity,
    isCurrent: active,
    currentHead: currentGroupHead,
    ...(deps.reserveFreshCreateProof ? { reserveGenesisProof: reserveGenesis } : {}),
    ...(deps.validateFreshCreateReservation ? { validateGenesisReservation: deps.validateFreshCreateReservation } : {}),
    authorizeAuthor: deps.authorizeGroupAuthor,
    setRoomSendGate: deps.setRoomSendGate,
    directory: providerVerifiedDirectory,
    async signingPublic(context) { return privateOps.getSigningPublic(context.owner, context.conversationId); },
    async prepareRecoverableEpoch(context) {
      const token = generation;
      if (!active(context.owner, token) || context.owner.accountId === null || !await ensureIdentity(context.owner) || !active(context.owner, token)) return false;
      const password = await deps.readBackupPassword(context.owner, context.conversationId, context.epoch);
      if (!password || !active(context.owner, token)) { password?.fill(0); return false; }
      const metadata: BackupMetadata = { kind: 'room-epoch-key', networkId: context.owner.networkId, accountId: context.owner.accountId,
        deviceId: identity!.deviceId, room: context.room, epoch: context.epoch, commitHash: hex(context.commitHash), membershipDigest: hex(context.membershipDigest) };
      const key = context.epochKey.slice();
      let encrypted: Uint8Array | null = null;
      try {
        encrypted = await encryptGroupBackup({ metadata, epochKey: key, password });
        if (!encrypted || !active(context.owner, token) || !await persistEncryptedBackup(context.owner, context.conversationId, context.room, context.epoch, encrypted)) return false;
        return active(context.owner, token);
      } finally { key.fill(0); password.fill(0); encrypted?.fill(0); }
    },
    async applyAuthenticatedControl(event) {
      if (!verifyIngressReceipt(event.receiptRef, event.context.owner, event.conversationId, event.room, event.epoch, event.accountId, event.deviceId,
        event.inputKind, event.commitId, event.commitHash, event.membershipDigest)) return { kind: 'rejected', reason: 'stale-owner' };
      const accepted = consumeIngressReceipt(event.receiptRef, event.context.owner, event.room, event.epoch, event.accountId, event.deviceId,
        event.inputKind, event.commitId, event.commitHash, event.membershipDigest);
      return accepted ? { kind: event.inputKind === 'commit' ? 'commit-observed' : 'local-installed' } : { kind: 'rejected', reason: 'stale-owner' };
    },
    verifyIngressReceipt,
    acquireAuthorLease,
    persistAuthorIntent,
  });
  const recovery = createGroupRecovery({
    transport: deps.transport,
    isCurrent: active,
    async currentDeviceId(owner) { return await ensureIdentity(owner) && active(owner) ? identity?.deviceId ?? null : null; },
    isLocalCurrent(owner) { return !disposed && equalOwner(owner, deps.ownerSnapshot()) && deps.isCurrent(owner); },
    async enrollVerifiedDevice(req) {
      const owner = req.owner; const token = generation;
      if (req.explicitUserIntent !== true || !owner.accountId || !active(owner, token)
        || !await ensureIdentity(owner, false) || !active(owner, token) || !identity) return null;
      const record = identity;
      if (!await identityPublicBinding(record) || !active(owner, token) || !await registerIdentity(owner, record) || !active(owner, token)) return null;
      const [signerPublic, wrappingPublic] = await Promise.all([
        crypto.subtle.exportKey('raw', record.signing.publicKey), crypto.subtle.exportKey('raw', record.wrapping.publicKey),
      ]);
      const directory = await deps.authenticatedDirectory(owner, owner.accountId);
      const row = directory?.snapshot.devices.find((device) => device.deviceId === record.deviceId && device.account.toLowerCase() === owner.accountId!.toLowerCase());
      const signerBytes = new Uint8Array(signerPublic); const wrappingBytes = new Uint8Array(wrappingPublic);
      const binding = row?.entry && equalBytes(row.entry.signerPub, signerBytes) && equalBytes(row.entry.encryptionPub, wrappingBytes)
        && await deriveGroupDeviceId({ signerPub: signerBytes, encryptionPub: wrappingBytes }) === record.deviceId;
      signerBytes.fill(0); wrappingBytes.fill(0);
      const revision = deps.directoryRevision(owner, req.conversationId);
      const currentDirectory = await deps.authenticatedDirectory(owner, owner.accountId);
      if (!active(owner, token) || identity !== record || !binding || !revision || !currentDirectory
        || currentDirectory.revision !== directory?.revision || !currentDirectory.snapshot.devices.some((device) => device.deviceId === record.deviceId)) return null;
      return { deviceId: record.deviceId, accountId: owner.accountId, directoryRevision: revision, verified: true };
    },
    async createWelcomeRequest(req) {
      const owner = req.owner; const token = generation;
      const room = deps.conversationPolicy(owner, req.conversationId)?.room;
      const evidence = room ? acceptedCommits.get(`${ownerLifecycleKey(owner)}\0${room}\0${req.expectedEpoch}`)?.evidence : undefined;
      if (req.explicitUserIntent !== true || !room || !evidence || !equalBytes(evidence.commitHash, req.expectedCommitHash)
        || !active(owner, token) || !await ensureIdentity(owner, true) || !active(owner, token) || !identity || !owner.accountId) return null;
      const record = identity;
      const [signerPublicRaw, wrappingPublicRaw] = await Promise.all([
        crypto.subtle.exportKey('raw', record.signing.publicKey), crypto.subtle.exportKey('raw', record.wrapping.publicKey),
      ]);
      const signerPublic = new Uint8Array(signerPublicRaw); const wrappingPublic = new Uint8Array(wrappingPublicRaw);
      const encoded = encodeGroupDeviceDirectoryEntry({ signerPub: signerPublic, encryptionPub: wrappingPublic });
      const body = encoded ? fromB64url(encoded) : null;
      signerPublic.fill(0); wrappingPublic.fill(0);
      if (!body || !active(owner, token) || identity !== record) { body?.fill(0); return null; }
      let signerForWire: Uint8Array | null = null;
      try {
        signerForWire = new Uint8Array(await crypto.subtle.exportKey('raw', record.signing.publicKey));
        const payload = await signGroupControlPayload({ routing: { channel: room, kind: 'key-package', fromAccount: owner.accountId,
          fromDevice: record.deviceId }, epoch: req.expectedEpoch, body, signerPub: signerForWire,
        privateKey: record.signing.privateKey });
        const currentEvidence = acceptedCommits.get(`${ownerLifecycleKey(owner)}\0${room}\0${req.expectedEpoch}`)?.evidence;
        const currentPolicy = deps.conversationPolicy(owner, req.conversationId);
        if (!payload || !active(owner, token) || identity !== record || currentEvidence !== evidence
          || !currentEvidence || !equalBytes(currentEvidence.commitHash, req.expectedCommitHash) || currentPolicy?.room !== room) return null;
        return { line: `E2EEGROUP ${room} key-package ${record.deviceId} :${payload}`, owner: Object.freeze({ ...owner }), epoch: req.expectedEpoch };
      } finally { signerForWire?.fill(0); body.fill(0); }
    },
    authoring,
    async exportPortableBackup(input) {
      const room = deps.conversationPolicy(input.context.owner, input.conversationId)?.room;
      const accepted = room ? acceptedCommits.get(`${ownerLifecycleKey(input.context.owner)}\0${room}\0${input.epoch}`)?.evidence : undefined;
      const commitHashHex = input.commitHashHex ?? (accepted ? hex(accepted.commitHash) : null);
      if (!commitHashHex) return { kind: 'blocked', reason: 'accepted-epoch-unavailable' };
      return exportPortableGroupBackup({ ...input, commitHashHex, context: input.context });
    },
    writePrivateBackupSelection: deps.writePrivateBackupSelection,
    async previewPortableBackup(input) { return previewPortableGroupBackup({ ...input, configuredNetworkId: input.configuredNetworkId }); },
    async approvePortableBackup(input) { return approvePortableGroupBackup(input); },
    cancelPortableBackup(input) { cancelPortableGroupBackup(input); },
    // Removal is the user's explicit decision: after the runtime authorizes it,
    // tombstone the device's local pin so the verified directory (and so the
    // next epoch's recipients and membership digest) excludes it.
    async authorizeRemovalIntent(intent) {
      if (!await deps.authorizeRemovalIntent(intent) || !active(intent.owner)) return false;
      return await tombstoneDevicePin(intent.owner, intent.removedAccountId, intent.removedDeviceId);
    },
  });
  const groupProviders: ProviderGroupServices = {
    authoring, recovery, ingestGroupControl,
    async openDmFromCurrentPeer(input) {
      const { context, conversationId, envelope } = input;
      const owner = context.owner;
      if (!requestCurrent(context) || !owner.accountId || !isValidDmEnvelope(envelope)
        || envelope.length > MAX_QUEUED_BYTES) return null;
      const route = deps.resolvePeerConversation(owner, conversationId);
      if (!route || !equalOwner(route.owner, owner) || route.conversationId !== conversationId
        || route.source !== 'authenticated-server') return null;
      if (!await ensureIdentity(owner, false) || !active(owner)) return null;
      const own = identity;
      if (!own || !validIdentityRecord(own, owner)) return null;
      const dbState = await ensureDB();
      if (!dbState || !active(owner) || identity !== own) return null;
      const scope = stableScope(owner, own.deviceId);
      const directory = await deps.authenticatedDirectory(owner, route.accountId);
      if (!scope || !directory || directory.provenance !== 'authenticated-exact-server' || directory.trusted !== false
        || !equalOwner(directory.owner, owner) || String(directory.accountId).toLowerCase() !== String(route.accountId).toLowerCase()
        || directory.snapshot.account !== String(route.accountId).toLowerCase() || directory.snapshot.devices.length > 64
        || !active(owner)) return null;
      const ownPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', own.wrapping.publicKey));
      const ownPublic = toB64url(ownPublicRaw);
      ownPublicRaw.fill(0);
      const candidates: Array<{ deviceId: string; publicB64: string }> = [];
      try {
        for (const row of directory.snapshot.devices) {
          if (row.account.toLowerCase() !== String(route.accountId).toLowerCase() || row.legacy || !row.entry) continue;
          const parsed = decodeGroupDeviceDirectoryEntry(row.publicKey);
          if (!parsed || !equalBytes(parsed.signerPub, row.entry.signerPub) || !equalBytes(parsed.encryptionPub, row.entry.encryptionPub)
            || await deriveGroupDeviceId(parsed) !== row.deviceId) continue;
          const signerB64 = toB64url(parsed.signerPub);
          const pinKey = `${scope}\0${String(route.accountId).toLowerCase()}\0${row.deviceId}`;
          let pin: TrustedGroupSignerPin | null = null;
          try { pin = await requestResult(dbState.db, 'trusted-signers', 'readonly', pinKey) as TrustedGroupSignerPin | null; }
          catch { return null; }
          if (!active(owner) || !pin || pin.deleted === true || pin.signerPub !== signerB64
            || pin.account.toLowerCase() !== String(route.accountId).toLowerCase() || pin.deviceId !== row.deviceId) continue;
          if (!isValidP256UncompressedPublicKey(parsed.encryptionPub)) continue;
          candidates.push({ deviceId: row.deviceId, publicB64: toB64url(parsed.encryptionPub) });
        }
        if (!active(owner) || identity !== own || !candidates.length) return null;
        const clear = await Promise.all(candidates.map(async (candidate) => ({ candidate,
          plaintext: await openDmWithDeviceKey(own.wrapping.privateKey, ownPublic, candidate.publicB64, envelope) })));
        const freshRoute = deps.resolvePeerConversation(owner, conversationId);
        const freshDirectory = await deps.authenticatedDirectory(owner, route.accountId);
        if (!requestCurrent(context) || !active(owner) || identity !== own || !freshRoute
          || freshRoute.routingRevision !== route.routingRevision || freshRoute.mappingGeneration !== route.mappingGeneration
          || !freshDirectory || freshDirectory.revision !== directory.revision) {
          for (const item of clear) item.plaintext = null;
          return null;
        }
        const opened = clear.filter((item) => item.plaintext !== null);
        return opened.length === 1 ? opened[0]!.plaintext : null;
      } finally {
        candidates.length = 0;
      }
    },
    async sealRoom(owner, conversationId, plaintext) {
      const policy = deps.conversationPolicy(owner, conversationId);
      const membership = deps.roomMembershipFacts(owner, conversationId);
      if (!active(owner) || !policy || policy.encryption !== 'room-required' || !policy.eligible || !policy.room || policy.epoch === null
        || !membership?.joined || !membership.complete) return null;
      const session = sessions.get(`${ownerLifecycleKey(owner)}\0${policy.room}`);
      if (!session || session.epoch !== BigInt(policy.epoch)) return null;
      const result = await session.sealRoomMessage(policy.room, plaintext);
      const fresh = deps.conversationPolicy(owner, conversationId);
      const freshMembership = deps.roomMembershipFacts(owner, conversationId);
      return active(owner) && fresh?.revision === policy.revision && fresh.encryption === 'room-required' && fresh.epoch === policy.epoch
        && freshMembership?.joined === true && freshMembership.complete === true
        && freshMembership.membershipGeneration === membership.membershipGeneration && freshMembership.mappingRevision === membership.mappingRevision
        && sessions.get(`${ownerLifecycleKey(owner)}\0${policy.room}`) === session && session.epoch === BigInt(policy.epoch)
        && result.ok && result.epoch === policy.epoch ? result.envelope : null;
    },
    async openRoom(owner, conversationId, envelope) {
      const policy = deps.conversationPolicy(owner, conversationId);
      const membership = deps.roomMembershipFacts(owner, conversationId);
      if (!active(owner) || !policy?.room || policy.encryption !== 'room-required' || !membership?.joined) return null;
      const session = sessions.get(`${ownerLifecycleKey(owner)}\0${policy.room}`);
      if (!session || policy.epoch !== null && session.epoch !== BigInt(policy.epoch)) return null;
      const epoch = session.epoch;
      const result = await session.openRoomMessage(policy.room, envelope);
      const fresh = deps.conversationPolicy(owner, conversationId);
      const freshMembership = deps.roomMembershipFacts(owner, conversationId);
      return active(owner) && result.ok && fresh?.revision === policy.revision && fresh.room === policy.room
        && fresh.encryption === 'room-required' && (fresh.epoch === null || BigInt(fresh.epoch) === epoch)
        && freshMembership?.joined === true && freshMembership.mappingRevision === membership.mappingRevision
        && freshMembership.membershipGeneration === membership.membershipGeneration
        && sessions.get(`${ownerLifecycleKey(owner)}\0${policy.room}`) === session && session.epoch === epoch ? result.plaintext : null;
    },
    async openHistoricalRoom(input) {
      const { context, grant, conversationId, room, envelope } = input;
      const owner = context.owner;
      const parsed = parseGroupEnvelope(envelope);
      const policyRoom = deps.conversationPolicy(owner, conversationId)?.room;
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant) || grant.scope.kind !== 'account'
        || grant.scope.networkId !== owner.networkId || owner.accountId !== null && grant.scope.accountId !== owner.accountId
        || !/^#[^\s\u0000-\u001f\u007f]{1,128}$/u.test(room) || !parsed
        || policyRoom !== null && policyRoom !== undefined && policyRoom !== room
        || !policyRoom && String(conversationId) !== room) return null;
      const prefix = `${grant.stableLocalOwnerKey}\0${room}\0${parsed.keyEpoch}\0`;
      let cachedEvidence: HistoricalAcceptedControl | undefined;
      for (const [key, value] of historicalAccepted) if (key.startsWith(prefix) && value.scope === grant.stableLocalOwnerKey) {
        if (cachedEvidence) return null;
        cachedEvidence = value;
      }
      if (!cachedEvidence) {
        const loaded = await restoreAcceptedEvidence(context, room, conversationId, parsed.keyEpoch);
        if (loaded) wipeEvidence(loaded.evidence);
        for (const [key, value] of historicalAccepted) if (key.startsWith(prefix) && value.scope === grant.stableLocalOwnerKey) {
          if (cachedEvidence) return null;
          cachedEvidence = value;
        }
      }
      const restored = cachedEvidence;
      const evidence = restored?.evidence;
      const historyKeyring = historyKeyringFor(grant);
      const bindingPrefix = `${grant.stableLocalOwnerKey}\0${room}\0${parsed.keyEpoch}\0`;
      const checkpointBinding = [...historyCheckpointBindings.entries()].find(([key, value]) => key.startsWith(bindingPrefix)
        && value.scope === grant.stableLocalOwnerKey && value.room === room && value.epoch === parsed.keyEpoch)?.[1];
      let acceptedHash = evidence?.commitHash ? hex(evidence.commitHash) : checkpointBinding?.commitHashHex ?? null;
      const cachedKey = historyKeyring.get(room, parsed.keyEpoch);
      if (!cachedKey || !acceptedHash) {
        const privateDb = await ensureDB();
        if (!privateDb || !localRequestCurrent(context) || !workspaceGrantValid(grant)) return null;
        const rows = await new Promise<Array<{ commitHashHex: string; state: 'accepted' | 'history-only'; ciphertext: Uint8Array }> | null>((resolve) => {
          let tx: IDBTransaction; try { tx = privateDb.db.transaction('epoch-backups', 'readonly'); } catch { resolve(null); return; }
          const found: Array<{ commitHashHex: string; state: 'accepted' | 'history-only'; ciphertext: Uint8Array }> = []; let count = 0;
          const request = tx.objectStore('epoch-backups').openCursor();
          request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (++count > 1024) { try { tx.abort(); } catch { /* ended */ } return; }
            const row = cursor.value as { scope?: unknown; room?: unknown; epoch?: unknown; state?: unknown; commitHashHex?: unknown; ciphertext?: unknown };
            if (row.scope === grant.stableLocalOwnerKey && row.room === room && row.epoch === parsed.keyEpoch
              && (row.state === 'history-only' || row.state === 'accepted')
              && (!evidence || row.state === 'accepted' && row.commitHashHex === acceptedHash)
              && (!checkpointBinding || row.commitHashHex === checkpointBinding.commitHashHex && row.state === checkpointBinding.escrowState)
              && typeof row.commitHashHex === 'string' && /^[a-f0-9]{64}$/u.test(row.commitHashHex)
              && row.ciphertext instanceof Uint8Array && row.ciphertext.byteLength <= 64 * 1024) {
              found.push({ commitHashHex: row.commitHashHex, state: row.state as 'accepted' | 'history-only', ciphertext: row.ciphertext.slice() });
            }
            cursor.continue(); };
          request.onerror = () => { try { tx.abort(); } catch { /* ended */ } };
          tx.oncomplete = () => resolve(found.length === 1 ? found : found.length === 0 ? [] : null);
          tx.onerror = tx.onabort = () => { for (const item of found) item.ciphertext.fill(0); resolve(null); };
        });
        if (!rows || rows.length !== 1) { rows?.forEach((item) => item.ciphertext.fill(0)); return null; }
        const row = rows[0]!;
        try {
          const opened = await workspaceCrypt({ context, grant, conversationId, exactBinding: room,
            purpose: `epoch-escrow:${room}:${parsed.keyEpoch}:${row.commitHashHex}`, bytes: row.ciphertext, opening: true });
          if (opened.kind !== 'opened' || !opened.bytes || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { opened.bytes?.fill(0); return null; }
          let payload: PortableGroupBackup;
          try { payload = JSON.parse(decoder.decode(opened.bytes)) as PortableGroupBackup; }
          catch { opened.bytes.fill(0); return null; }
          opened.bytes.fill(0);
          if (payload.networkId !== grant.scope.networkId || payload.accountId !== grant.scope.accountId || payload.room !== room
            || payload.epoch !== parsed.keyEpoch || payload.commitHashHex !== row.commitHashHex) return null;
          const rawKey = fromB64url(payload.epochKeyB64url); const signer = fromB64url(payload.receipt.signerPublicKeyB64url);
          if (!rawKey || !signer || rawKey.length !== 32 || signer.length !== 32) { rawKey?.fill(0); signer?.fill(0); return null; }
          const verifiedEvidence = await verifyPortableCheckpoint(payload, rawKey, signer);
          if (!verifiedEvidence || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { wipeEvidence(verifiedEvidence ?? undefined); rawKey.fill(0); signer.fill(0); return null; }
          if (evidence && (row.commitHashHex !== acceptedHash || verifiedEvidence.signedCommitPayload !== evidence.signedCommitPayload
            || !equalBytes(verifiedEvidence.commitHash, evidence.commitHash))) {
            wipeEvidence(verifiedEvidence); rawKey.fill(0); signer.fill(0); return null;
          }
          if (row.state === 'history-only' && payload.receipt.provenance !== 'user-approved-history-checkpoint'
            || row.state === 'accepted' && payload.receipt.provenance !== 'source-observed-acceptance') {
            wipeEvidence(verifiedEvidence); rawKey.fill(0); signer.fill(0); return null;
          }
          const historyKey = await crypto.subtle.importKey('raw', cryptoBytes(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
          rawKey.fill(0); signer.fill(0); wipeEvidence(verifiedEvidence);
          if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return null;
          // RoomEpochKeyring's authenticated ID grammar is base64url-like; keep
          // the exact commit hash as the identity. The separate binding map
          // records whether this verified key came from observed acceptance or
          // an explicitly approved portable history checkpoint.
          const install = historyKeyring.install(room, parsed.keyEpoch, historyKey, row.commitHashHex);
          if (install !== 'installed' && install !== 'unchanged') return null;
          acceptedHash = row.commitHashHex;
          const key = historicalEvidenceKey(grant.stableLocalOwnerKey, room, parsed.keyEpoch, row.commitHashHex);
          historyCheckpointBindings.set(key, { scope: grant.stableLocalOwnerKey, room, epoch: parsed.keyEpoch,
            commitHashHex: row.commitHashHex, escrowState: row.state });
          while (historyCheckpointBindings.size > 512) {
            const oldest = historyCheckpointBindings.keys().next().value as string | undefined;
            if (!oldest) break;
            historyCheckpointBindings.delete(oldest);
          }
        } finally { row.ciphertext.fill(0); }
      }
      const key = historyKeyring.get(room, parsed.keyEpoch);
      if (!acceptedHash || evidence && (evidence.room !== room || evidence.epoch !== parsed.keyEpoch) || !key) return null;
      const plaintext = await openGroupMessage(key, room, envelope, parsed.keyEpoch);
      const freshEvidence = evidence ? historicalAccepted.get(historicalEvidenceKey(grant.stableLocalOwnerKey, room, parsed.keyEpoch, acceptedHash))?.evidence : null;
      const freshPolicyRoom = deps.conversationPolicy(owner, conversationId)?.room;
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant)
        || evidence && freshEvidence !== evidence || historyKeyring.get(room, parsed.keyEpoch) !== key
        || freshPolicyRoom !== policyRoom || owner.accountId !== null && grant.scope.accountId !== owner.accountId) return null;
      return plaintext;
    },
    currentAcceptedHead(owner, conversationId) {
      if (!active(owner) || !owner.accountId) return null;
      // Policy projection calls this per stored row; don't copy the roster here.
      const facts = deps.roomPolicyFacts ? deps.roomPolicyFacts(owner, conversationId) : deps.roomMembershipFacts(owner, conversationId);
      if (!facts?.joined || facts.owner && !equalOwner(facts.owner, owner)
        || !facts.scheme || !facts.canonicalTarget
        || facts.mappingRevision !== `irc-casemapping-v1:${facts.scheme}`
        || !identity || !validIdentityRecord(identity, owner)) return null;
      // The supplied conversation ID and the source-authenticated folded room
      // are both candidate keys: the former preserves exact accepted wire
      // spelling, while the latter resolves aliases after CASEMAPPING. Never
      // use the policy callback here; bootstrap's policy projection itself
      // consults this accepted-head observation.
      const canonical = normalizeCase(facts.canonicalTarget, facts.scheme);
      const roomCandidates = [...new Set([String(conversationId), facts.canonicalTarget])]
        .filter((candidate) => normalizeCase(candidate, facts.scheme!) === canonical);
      if (roomCandidates.length === 0 || !active(owner)) return null;
      const candidateSessions = roomCandidates.flatMap((room) => {
        const candidate = sessions.get(`${ownerLifecycleKey(owner)}\0${room}`);
        return candidate && !candidate.isDestroyed ? [candidate] : [];
      });
      const distinctSessions = [...new Set(candidateSessions)];
      if (distinctSessions.length !== 1) return null;
      const session = distinctSessions[0]!;
      const room = session.room;
      if (!roomCandidates.includes(room) || normalizeCase(room, facts.scheme) !== canonical || !active(owner)) return null;
      const accepted = acceptedCommits.get(`${ownerLifecycleKey(owner)}\0${room}\0${session.epoch}`);
      const commitHash = session.commitHash(); const membershipDigest = session.membershipDigest();
      try {
        if (!accepted || !commitHash || !membershipDigest || !equalBytes(accepted.evidence.commitHash, commitHash)
          || !equalBytes(accepted.evidence.membershipDigest, membershipDigest) || accepted.acceptedMappingScheme !== facts.scheme
          || accepted.acceptedMappingRevision !== facts.mappingRevision || !active(owner)) return null;
        return { kind: 'established' as const, epoch: Number(session.epoch), commitHashHex: hex(commitHash),
          membershipRevision: accepted.acceptedMembershipRevision, mappingRevision: accepted.acceptedMappingRevision,
          accountId: owner.accountId, deviceId: identity.deviceId };
      } finally { commitHash?.fill(0); membershipDigest?.fill(0); }
    },
    retire(owner, conversationId) { const room = deps.conversationPolicy(owner, conversationId)?.room; if (room) privateOps.retireRoom(owner, room); },
    membershipChanged(owner, conversationId) { const room = deps.conversationPolicy(owner, conversationId)?.room; if (room) privateOps.membershipChanged(owner, room); },
  };
  const prepareQueuedPayload = async (input: { owner: OwnerSnapshot; conversationId: ConversationId; requestId: RequestId; clientIntentId: RequestId; operation: 'privmsg' | 'memo-send'; targetKey: string; body: Uint8Array; messageKind?: QueuedMessageKind; replyTo?: string | null; audiencePrefix?: string | null; policyRevision?: string }): Promise<{ kind: 'sealed-local' | 'blocked'; bytes?: Uint8Array; policyRevision?: string; payloadCommitment?: string; reason?: 'stale-owner' | 'policy' | 'invalid' }> => {
    if (!makeRequestId(input.clientIntentId) || !localRequestCurrent({ schemaVersion: 1, requestId: input.requestId, owner: input.owner })) return { kind: 'blocked', reason: 'invalid' };
    const grant = deps.workspaceGrantForOwner?.(input.owner);
    if (!grant) return { kind: 'blocked', reason: 'stale-owner' };
    const context: RequestContext = { schemaVersion: 1, requestId: input.requestId, owner: input.owner };
    const workspaceTarget = deps.canonicalWorkspaceTarget
      ? deps.canonicalWorkspaceTarget(context, grant, input.conversationId)
      : deps.canonicalConversationKey(input.owner, input.conversationId);
    if (workspaceTarget !== input.targetKey) return { kind: 'blocked', reason: 'policy' };
    const canonical = canonicalQueuedIntent({ operation: input.operation, targetKey: input.targetKey,
      messageKind: input.messageKind ?? 'message', replyTo: input.replyTo ?? null,
      audiencePrefix: input.audiencePrefix ?? null, body: input.body });
    if (!canonical) return { kind: 'blocked', reason: 'invalid' };
    const observedPolicy = input.operation === 'memo-send' ? null : deps.conversationPolicy(input.owner, input.conversationId);
    if (canonical.audiencePrefix !== null && (input.operation !== 'privmsg' || !String(input.conversationId).startsWith('#')
      || observedPolicy?.encryption !== 'plain' || !observedPolicy.eligible)) { canonical.bytes.fill(0); return { kind: 'blocked', reason: 'policy' }; }
    const expectedPolicyRevision = observedPolicy && observedPolicy.encryption !== 'unknown'
      ? observedPolicy.revision : LOCAL_QUEUE_POLICY;
    const sealed = await workspaceCrypt({ context, grant, conversationId: input.conversationId,
      exactBinding: input.targetKey, purpose: `outbox:${input.clientIntentId}`, bytes: canonical.bytes, opening: false });
    canonical.bytes.fill(0);
    const after = deps.workspaceGrantForOwner?.(input.owner);
    if (sealed.kind !== 'sealed' || !sealed.bytes || !localRequestCurrent(context) || after !== grant || !workspaceGrantValid(grant)) {
      sealed.bytes?.fill(0);
      return { kind: 'blocked', reason: sealed.kind === 'stale-owner' || !localRequestCurrent(context) ? 'stale-owner' : 'policy' };
    }
    const contextAfterSeal: RequestContext = { schemaVersion: 1, requestId: input.requestId, owner: input.owner };
    const hmacTuple = canonicalQueuedIntent({ operation: input.operation, targetKey: input.targetKey,
      messageKind: input.messageKind ?? 'message', replyTo: input.replyTo ?? null,
      audiencePrefix: input.audiencePrefix ?? null, body: input.body });
    const payloadCommitment = hmacTuple ? await queuedIntentCommitment({ context: contextAfterSeal, grant, canonicalBytes: hmacTuple.bytes }) : null;
    hmacTuple?.bytes.fill(0);
    if (!payloadCommitment || !localRequestCurrent(inputContext(input)) || !workspaceGrantValid(grant)) { sealed.bytes.fill(0); return { kind: 'blocked', reason: !localRequestCurrent(inputContext(input)) ? 'stale-owner' : 'policy' }; }
    return { kind: 'sealed-local', bytes: sealed.bytes, policyRevision: expectedPolicyRevision, payloadCommitment };
  };
  const inputContext = (input: { owner: OwnerSnapshot; requestId: RequestId }): RequestContext => ({ schemaVersion: 1, requestId: input.requestId, owner: input.owner });
  const prepareDispatch = async (input: { owner: OwnerSnapshot; conversationId: ConversationId; requestId: RequestId; clientIntentId: RequestId; operation: 'privmsg' | 'memo-send'; targetKey: string; messageKind?: QueuedMessageKind; replyTo?: string | null; audiencePrefix?: string | null; payload: Uint8Array; policyRevision: string }): Promise<{ kind: 'ready' | 'held'; body?: Uint8Array; messageKind?: QueuedMessageKind; replyTo?: MessageId | null; audiencePrefix?: string | null; reason?: 'stale-owner' | 'policy' | 'legacy-review' }> => {
    if (!active(input.owner)) return { kind: 'held', reason: 'stale-owner' };
    const policy = input.operation === 'memo-send'
      ? { revision: input.policyRevision, encryption: 'plain' as const, eligible: true, room: null, epoch: null }
      : deps.conversationPolicy(input.owner, input.conversationId);
    if (!policy || (input.operation !== 'memo-send' && input.policyRevision !== LOCAL_QUEUE_POLICY && policy.revision !== input.policyRevision)
      || !policy.eligible || policy.encryption === 'unknown' || !input.owner.accountId) return { kind: 'held', reason: 'policy' };
    const grant = deps.workspaceGrantForOwner?.(input.owner);
    if (!grant || grant.scope.kind !== 'account' || grant.scope.accountId !== input.owner.accountId
      || grant.scope.networkId !== input.owner.networkId) return { kind: 'held', reason: 'stale-owner' };
    const context: RequestContext = { schemaVersion: 1, requestId: input.requestId, owner: input.owner };
    const canonicalTarget = deps.canonicalWorkspaceTarget
      ? deps.canonicalWorkspaceTarget(context, grant, input.conversationId)
      : deps.canonicalConversationKey(input.owner, input.conversationId);
    // targetKey is the captured workspace CASEMAPPING key for both operations.
    // A MEMO recipient remains the separate account ID in conversationId; never
    // compare that account ID to the canonical tuple/index key.
    const targetValid = canonicalTarget !== null && canonicalTarget === input.targetKey
      && (input.operation !== 'memo-send' || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(String(input.conversationId)));
    if (!makeRequestId(input.clientIntentId) || !(input.payload instanceof Uint8Array) || input.payload.byteLength > MAX_QUEUED_CIPHERTEXT_BYTES
      || !targetValid) return { kind: 'held', reason: 'policy' };
    let opened = await workspaceCrypt({ context, grant, conversationId: input.conversationId,
      exactBinding: input.targetKey, purpose: `outbox:${input.clientIntentId}`, bytes: input.payload, opening: true });
    if (opened.kind !== 'opened' && input.operation === 'privmsg' && input.messageKind === undefined
      && input.replyTo === undefined && input.audiencePrefix === undefined && String(input.conversationId) !== input.targetKey) {
      const legacy = await workspaceCrypt({ context, grant, conversationId: input.conversationId,
        exactBinding: String(input.conversationId), purpose: `outbox:${input.clientIntentId}`, bytes: input.payload, opening: true });
      if (legacy.kind === 'opened' && legacy.bytes) {
        const validLegacyBody = validLegacyQueueBody(legacy.bytes);
        legacy.bytes.fill(0);
        return validLegacyBody ? { kind: 'held', reason: 'legacy-review' } : { kind: 'held', reason: 'policy' };
      }
    }
    if (opened.kind !== 'opened' || !opened.bytes || !active(input.owner)) { opened.bytes?.fill(0); return { kind: 'held', reason: opened.kind === 'stale-owner' ? 'stale-owner' : 'policy' }; }
    let decoded: unknown = null;
    try { decoded = JSON.parse(decoder.decode(opened.bytes)); } catch { /* invalid private payload */ }
    if (!Array.isArray(decoded) || decoded.length !== 7 || decoded[0] !== 2 || decoded[1] !== input.operation || decoded[2] !== input.targetKey
      || (decoded[3] !== 'message' && decoded[3] !== 'action')
      || decoded[4] !== null && typeof decoded[4] !== 'string'
      || decoded[5] !== null && typeof decoded[5] !== 'string' || typeof decoded[6] !== 'string'
      || input.messageKind !== undefined && decoded[3] !== input.messageKind
      || input.replyTo !== undefined && decoded[4] !== input.replyTo
      || input.audiencePrefix !== undefined && decoded[5] !== input.audiencePrefix) {
      const legacyBody = input.operation === 'privmsg' && input.messageKind === undefined
        && input.replyTo === undefined && input.audiencePrefix === undefined && validLegacyQueueBody(opened.bytes);
      opened.bytes.fill(0); return { kind: 'held', reason: legacyBody ? 'legacy-review' : 'policy' };
    }
    const kind = decoded[3] as QueuedMessageKind;
    const replyTo = decoded[4] as string | null;
    const audiencePrefix = decoded[5] as string | null;
    const messageBytes = encoder.encode(decoded[6]);
    const canonical = canonicalQueuedIntent({ operation: input.operation, targetKey: input.targetKey,
      messageKind: kind, replyTo, audiencePrefix, body: messageBytes });
    if (!canonical || !equalBytes(canonical.bytes, opened.bytes)) {
      canonical?.bytes.fill(0); messageBytes.fill(0); opened.bytes.fill(0); return { kind: 'held', reason: 'policy' };
    }
    canonical.bytes.fill(0);
    opened.bytes.fill(0);
    const wireText = kind === 'action' ? `\u0001ACTION ${decoded[6]}\u0001` : decoded[6];
    const semanticBytes = encoder.encode(wireText);
    messageBytes.fill(0);
    let body: Uint8Array | null = null;
    if (policy.encryption === 'plain') body = semanticBytes.slice();
    else if (audiencePrefix === null) body = await privateIdentity.encryptForConversation({ owner: input.owner, conversationId: input.conversationId, requestId: input.requestId, plaintext: semanticBytes });
    semanticBytes.fill(0);
    const fresh = input.operation === 'memo-send' ? policy : deps.conversationPolicy(input.owner, input.conversationId);
    const validEnvelope = policy.encryption === 'plain' || policy.encryption === 'dm-required'
      ? policy.encryption === 'plain' || (!!body && isValidDmEnvelope(decoder.decode(body)))
      : !!body && policy.room !== null && policy.epoch !== null && parseGroupEnvelope(decoder.decode(body))?.keyEpoch === policy.epoch;
    if (!body || !validEnvelope || !active(input.owner) || !fresh?.eligible || (input.operation !== 'memo-send' && fresh.revision !== policy.revision)
      || fresh.encryption !== policy.encryption || fresh.epoch !== policy.epoch || fresh.room !== policy.room) { body?.fill(0); return { kind: 'held', reason: !active(input.owner) ? 'stale-owner' : 'policy' }; }
    if (policy.encryption !== 'plain' && audiencePrefix !== null) { body.fill(0); return { kind: 'held', reason: 'policy' }; }
    return { kind: 'ready', body, messageKind: kind, replyTo: replyTo as MessageId | null, audiencePrefix };
  };
  function previewBootstrap(input: { context: RequestContext; conversationId: ConversationId }): BootstrapPreview | null {
    if (!active(input.context.owner)) return null;
    for (const saved of bootstrapCandidates.values()) if (equalOwner(saved.owner, input.context.owner)
      && saved.expiresAt > Date.now()
      && saved.conversationId === input.conversationId && deps.roomMembershipFacts(input.context.owner, input.conversationId)?.mappingRevision === saved.mappingRevision
      && deps.directoryRevision(input.context.owner, input.conversationId) === saved.directoryRevision) return { ...saved.preview };
    return null;
  }
  async function approveBootstrap(input: { context: RequestContext; previewRef: string; confirm: true }): Promise<boolean> {
    const saved = bootstrapCandidates.get(input.previewRef); const owner = input.context.owner;
    if (!saved || saved.expiresAt <= Date.now() || input.confirm !== true || !equalOwner(saved.owner, owner) || !active(owner)
      || !/^[0-9a-f]{64}$/u.test(saved.membershipDigestHex)) return false;
    const facts = deps.roomMembershipFacts(owner, saved.conversationId);
    if (!facts?.joined || !facts.complete || facts.mappingRevision !== saved.mappingRevision
      || deps.directoryRevision(owner, saved.conversationId) !== saved.directoryRevision) return false;
    const verifiedDirectory = await providerVerifiedDirectory({ ...input.context, conversationId: saved.conversationId });
    const parentEpoch = saved.preview.epoch - 1;
    const parentHash = fromHex(saved.priorHashHex);
    const digest = verifiedDirectory && owner.accountId && parentHash
      ? await buildMembershipDigest({ networkId: String(owner.networkId), priorEpoch: parentEpoch, priorCommitHash: parentHash,
        localAccount: String(owner.accountId), localDeviceId: saved.preview.recipientDeviceId, directory: verifiedDirectory }) : null;
    parentHash?.fill(0);
    const after = deps.roomMembershipFacts(owner, saved.conversationId);
    if (!active(owner) || !verifiedDirectory || !equalOwner(input.context.owner, owner)
      || !digest || hex(digest) !== saved.membershipDigestHex
      || !after?.joined || !after.complete || after.mappingRevision !== saved.mappingRevision
      || deps.directoryRevision(owner, saved.conversationId) !== saved.directoryRevision) {
      digest?.fill(0);
      return false;
    }
    digest.fill(0);
    saved.approved = true;
    const replay = await groupAdapter?.retryPendingBootstrap(saved.preview.commitHashHex);
    if (!active(owner) || !replay || (replay.status !== 'queued' && replay.status !== 'applied' && replay.status !== 'ignored')) {
      saved.approved = false; return false;
    }
    if (replay.status === 'applied') await openSendGateAfterInstall(owner, saved.room, saved.preview.epoch);
    return true;
  }
  function cancelBootstrap(input: { context: RequestContext; previewRef: string }): boolean {
    const saved = bootstrapCandidates.get(input.previewRef);
    if (!saved || !equalOwner(saved.owner, input.context.owner)) return false;
    bootstrapCandidates.delete(input.previewRef); return true;
  }
  const workspaceGrantValid = (grant: WorkspaceOwnerGrant): boolean => !disposed && !!grant && typeof grant === 'object'
    && typeof grant.ref === 'symbol' && !!grant.scope && (grant.scope.kind === 'account' || grant.scope.kind === 'guest')
    && typeof grant.scope.networkId === 'string' && !CONTROL.test(grant.scope.networkId)
    && Number.isSafeInteger(grant.scope.localWorkspaceEpoch)
    && grant.scope.localWorkspaceEpoch >= 0 && typeof grant.stableLocalOwnerKey === 'string' && grant.stableLocalOwnerKey.length > 0 && grant.stableLocalOwnerKey.length <= 512
    && grant.stableLocalOwnerKey === localOwnerStableKey(grant.scope) && !!deps.validateWorkspaceGrant?.(grant);
  const requestCurrent = (context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }): boolean => !disposed
    && context.schemaVersion === 1 && context.requestId.length >= 22 && active(context.owner);
  const localRequestCurrent = (context: RequestContext): boolean => !disposed && context.schemaVersion === 1
    && context.requestId.length >= 22 && equalOwner(context.owner, deps.ownerSnapshot()) && deps.isCurrent(context.owner);
  async function workspaceKey(grant: WorkspaceOwnerGrant): Promise<CryptoKey | null> {
    if (!workspaceGrantValid(grant)) return null;
    const scope = grant.stableLocalOwnerKey;
    const cached = workspaceLocalKeys.get(scope); if (cached) return workspaceGrantValid(grant) ? cached : null;
    const privateDb = await ensureDB();
    if (!workspaceGrantValid(grant) || (deps.indexedDB && !privateDb)) return null;
    if (privateDb) {
      let loaded: unknown;
      try { loaded = await requestResult(privateDb.db, 'local-aead', 'readonly', scope); }
      catch { return null; }
      if (!workspaceGrantValid(grant)) return null;
      const legacyScope = legacyWorkspaceKey(grant.scope);
      if (loaded === undefined && legacyScope !== scope) {
        try { loaded = await requestResult(privateDb.db, 'local-aead', 'readonly', legacyScope); }
        catch { return null; }
      }
      if (loaded !== undefined) {
        const stored = loaded as Partial<LocalKeyRecord>;
        if ((stored.scope !== scope && stored.scope !== legacyScope) || stored.key?.type !== 'secret' || stored.key.algorithm.name !== 'AES-GCM' || stored.key.extractable
          || !stored.key.usages.includes('encrypt') || !stored.key.usages.includes('decrypt')) return null;
        if (stored.scope === legacyScope && legacyScope !== scope) {
          const copied = await addIfAbsent(privateDb.db, 'local-aead', scope, { scope, key: stored.key } satisfies LocalKeyRecord);
          if (!workspaceGrantValid(grant)) return null;
          if (!copied) {
            let winner: unknown;
            try { winner = await requestResult(privateDb.db, 'local-aead', 'readonly', scope); } catch { return null; }
            const current = winner as Partial<LocalKeyRecord> | undefined;
            if (!workspaceGrantValid(grant) || current?.scope !== scope || current.key?.type !== 'secret'
              || current.key.algorithm.name !== 'AES-GCM' || current.key.extractable
              || !current.key.usages.includes('encrypt') || !current.key.usages.includes('decrypt')) return null;
            workspaceLocalKeys.set(scope, current.key); return current.key;
          }
        }
        workspaceLocalKeys.set(scope, stored.key); return stored.key;
      }
    }
    let candidate: CryptoKey;
    try { candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
    catch { return null; }
    if (!workspaceGrantValid(grant)) return null;
    if (privateDb) {
      const row: LocalKeyRecord = { scope, key: candidate };
      if (await addIfAbsent(privateDb.db, 'local-aead', scope, row)) {
        if (!workspaceGrantValid(grant)) return null;
        workspaceLocalKeys.set(scope, candidate); return candidate;
      }
      let winner: unknown;
      try { winner = await requestResult(privateDb.db, 'local-aead', 'readonly', scope); } catch { return null; }
      const stored = winner as Partial<LocalKeyRecord> | undefined;
      if (!workspaceGrantValid(grant) || stored?.scope !== scope || stored.key?.type !== 'secret' || stored.key.algorithm.name !== 'AES-GCM'
        || stored.key.extractable || !stored.key.usages.includes('encrypt') || !stored.key.usages.includes('decrypt')) return null;
      workspaceLocalKeys.set(scope, stored.key); return stored.key;
    }
    workspaceLocalKeys.set(scope, candidate); return candidate;
  }
  function intentMacCacheKey(stableLocalOwnerKey: string): string {
    return `${stableLocalOwnerKey}\0intent-mac-v1`;
  }
  async function intentMacKey(grant: WorkspaceOwnerGrant): Promise<CryptoKey | null> {
    if (!workspaceGrantValid(grant)) return null;
    const scope = grant.stableLocalOwnerKey;
    const keyName = intentMacCacheKey(scope);
    const cached = intentMacKeys.get(keyName);
    if (cached) return workspaceGrantValid(grant) ? cached : null;
    const privateDb = await ensureDB();
    if (!workspaceGrantValid(grant) || !privateDb && deps.indexedDB) return null;
    if (!privateDb) {
      try {
        const volatile = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
        if (!workspaceGrantValid(grant)) return null;
        intentMacKeys.set(keyName, volatile); return volatile;
      } catch { return null; }
    }
    let loaded: unknown;
    try { loaded = await requestResult(privateDb.db, 'local-aead', 'readonly', keyName); }
    catch { return null; }
    if (!workspaceGrantValid(grant)) return null;
    const legacyName = `${legacyWorkspaceKey(grant.scope)}\0intent-mac-v1`;
    if (loaded === undefined && legacyName !== keyName) {
      try { loaded = await requestResult(privateDb.db, 'local-aead', 'readonly', legacyName); }
      catch { return null; }
    }
    if (loaded !== undefined) {
      const saved = loaded as Partial<IntentMacKeyRecord>;
      if (saved.kind !== 'intent-mac-key' || (saved.scope !== scope && saved.scope !== legacyWorkspaceKey(grant.scope)) || !validIntentMacKey(saved.key)) return null;
      let selectedKey = saved.key;
      if (saved.scope !== scope) {
        const copied = await addIfAbsent(privateDb.db, 'local-aead', keyName,
          { kind: 'intent-mac-key', scope, key: saved.key } satisfies IntentMacKeyRecord);
        if (!copied) {
          let winner: unknown;
          try { winner = await requestResult(privateDb.db, 'local-aead', 'readonly', keyName); } catch { return null; }
          const current = winner as Partial<IntentMacKeyRecord> | undefined;
          if (current?.kind !== 'intent-mac-key' || current.scope !== scope || !validIntentMacKey(current.key)) return null;
          selectedKey = current.key;
        }
      }
      if (!workspaceGrantValid(grant)) return null;
      intentMacKeys.set(keyName, selectedKey);
      return selectedKey;
    }
    let candidate: CryptoKey;
    try { candidate = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']); }
    catch { return null; }
    if (!workspaceGrantValid(grant)) return null;
    const row: IntentMacKeyRecord = { kind: 'intent-mac-key', scope, key: candidate };
    if (await addIfAbsent(privateDb.db, 'local-aead', keyName, row)) {
      if (!workspaceGrantValid(grant)) return null;
      intentMacKeys.set(keyName, candidate); return candidate;
    }
    let winner: unknown;
    try { winner = await requestResult(privateDb.db, 'local-aead', 'readonly', keyName); }
    catch { return null; }
    const saved = winner as Partial<IntentMacKeyRecord> | undefined;
    if (!workspaceGrantValid(grant) || saved?.kind !== 'intent-mac-key' || saved.scope !== scope || !validIntentMacKey(saved.key)) return null;
    intentMacKeys.set(keyName, saved.key); return saved.key;
  }
  async function queuedIntentCommitment(input: { context: RequestContext; grant: WorkspaceOwnerGrant; canonicalBytes: Uint8Array }): Promise<string | null> {
    if (!localRequestCurrent(input.context) || !workspaceGrantValid(input.grant) || !(input.canonicalBytes instanceof Uint8Array)
      || input.canonicalBytes.byteLength > MAX_QUEUED_RECORD_BYTES) return null;
    const key = await intentMacKey(input.grant);
    if (!key || !localRequestCurrent(input.context) || !workspaceGrantValid(input.grant)) return null;
    const scope = encoder.encode(input.grant.stableLocalOwnerKey);
    const domain = encoder.encode('onyx-outbox-intent-commitment-v2');
    const bytes = new Uint8Array(12 + domain.length + scope.length + input.canonicalBytes.length);
    const view = new DataView(bytes.buffer); let offset = 0;
    const append = (value: Uint8Array): void => { view.setUint32(offset, value.length, false); offset += 4; bytes.set(value, offset); offset += value.length; };
    try {
      append(domain); append(scope); append(input.canonicalBytes);
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes.subarray(0, offset)));
      if (!localRequestCurrent(input.context) || !workspaceGrantValid(input.grant)) { mac.fill(0); return null; }
      const result = hex(mac); mac.fill(0); return result;
    } catch { return null; }
    finally { bytes.fill(0); scope.fill(0); domain.fill(0); }
  }
  const workspacePurpose = (purpose: string): boolean => /^(?:draft:[A-Za-z0-9_.:-]{1,128}|outbox:[A-Za-z0-9_.:_-]{1,128}|scheduled:[A-Za-z0-9_-]{1,96}:[1-9][0-9]{0,8}|accepted-control:[^\u0000-\u001f\u007f]{1,256}:[0-9]{1,12}|epoch-escrow:#[^\s\u0000-\u001f\u007f]{1,128}:[0-9]{1,10}:[a-f0-9]{64}|private-backup:[A-Za-z0-9_.:-]{1,128})$/u.test(purpose);
  async function workspaceCrypt(input: { context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }; grant: WorkspaceOwnerGrant; conversationId: ConversationId; exactBinding?: string; purpose: string; bytes: Uint8Array; opening: boolean }): Promise<LocalCryptoResult> {
    const { context, grant } = input;
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > MAX_LOCAL_BYTES || !workspacePurpose(input.purpose)) return { kind: 'invalid' };
    if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'stale-owner' };
    const resolvedTarget = deps.canonicalWorkspaceTarget
      ? deps.canonicalWorkspaceTarget(context, grant, input.conversationId)
      : deps.canonicalConversationKey(context.owner, input.conversationId);
    const target = input.exactBinding && (input.purpose.startsWith('accepted-control:') || input.purpose.startsWith('outbox:') || input.purpose.startsWith('scheduled:') || input.purpose.startsWith('epoch-escrow:'))
      ? input.exactBinding : deps.canonicalWorkspaceTarget
        ? deps.canonicalWorkspaceTarget(context, grant, input.conversationId)
        : deps.canonicalConversationKey(context.owner, input.conversationId);
    if (!target || CONTROL.test(target) || target.length > 256
      || input.purpose.startsWith('scheduled:') && (input.exactBinding !== resolvedTarget || !/^[^\s\u0000-\u001f\u007f]{1,256}$/u.test(target))
      || input.exactBinding !== undefined && (input.purpose.startsWith('accepted-control:')
        ? !/^#[^\s\u0000-\u001f\u007f]{1,128}$/u.test(input.exactBinding)
        : input.purpose.startsWith('epoch-escrow:') ? !/^#[^\s\u0000-\u001f\u007f]{1,128}$/u.test(input.exactBinding)
          : !/^[^\s\u0000-\u001f\u007f]{1,256}$/u.test(input.exactBinding))) return { kind: 'invalid' };
    if (input.opening && (input.bytes.byteLength < 28 || input.bytes.byteLength > MAX_LOCAL_BYTES + 28)) return { kind: 'invalid' };
    const key = await workspaceKey(grant);
    if (!key || !workspaceGrantValid(grant) || !localRequestCurrent(context)) return { kind: workspaceGrantValid(grant) ? 'unavailable' : 'stale-owner' };
    const scope: LocalWorkspaceScope = grant.scope;
    const makeAad = (ownerKey: string) => encoder.encode(JSON.stringify({ domain: 'onyx-workspace-local-v1', version: 1, ownerKey,
      networkId: scope.networkId, accountId: scope.accountId, physicalRef: scope.physicalRef, conversation: target, purpose: input.purpose }));
    const aadBytes = makeAad(grant.stableLocalOwnerKey);
    const oldScope = legacyWorkspaceKey(scope);
    const legacyAad = oldScope !== grant.stableLocalOwnerKey ? makeAad(oldScope) : null;
    let iv = new Uint8Array(12); let buffer: Uint8Array | null = null;
    try {
      if (input.opening) {
        iv = input.bytes.slice(0, 12); buffer = input.bytes.slice(12);
        let opened: Uint8Array;
        try { opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(iv), additionalData: cryptoBytes(aadBytes), tagLength: 128 }, key, cryptoBytes(buffer))); }
        catch (error) {
          if (!legacyAad) throw error;
          opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(iv), additionalData: cryptoBytes(legacyAad), tagLength: 128 }, key, cryptoBytes(buffer)));
        }
        if (!workspaceGrantValid(grant) || !localRequestCurrent(context)) { opened.fill(0); return { kind: 'stale-owner' }; }
        return { kind: 'opened', bytes: opened };
      }
      crypto.getRandomValues(iv); buffer = input.bytes.slice();
      const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: cryptoBytes(iv), additionalData: cryptoBytes(aadBytes), tagLength: 128 }, key, cryptoBytes(buffer)));
      if (!workspaceGrantValid(grant) || !localRequestCurrent(context)) { encrypted.fill(0); return { kind: 'stale-owner' }; }
      const output = new Uint8Array(iv.length + encrypted.length); output.set(iv); output.set(encrypted, iv.length); encrypted.fill(0);
      return { kind: 'sealed', bytes: output };
    } catch { return { kind: workspaceGrantValid(grant) && localRequestCurrent(context) ? 'invalid' : 'stale-owner' }; }
    finally { aadBytes.fill(0); legacyAad?.fill(0); iv.fill(0); buffer?.fill(0); }
  }
  async function exportPortableGroupBackup(input: { context: RequestContext; conversationId: ConversationId; epoch: number; commitHashHex: string; passwordRef: symbol }): Promise<PortableBackupResult> {
    const { context, conversationId, epoch, commitHashHex } = input; const owner = context.owner;
    if (!localRequestCurrent(context)) return { kind: 'blocked', reason: 'stale-owner' };
    const grant = deps.workspaceGrantForOwner?.(owner);
    if (!grant || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'workspace-locked' };
    if (!owner.accountId || grant.scope.kind !== 'account' || grant.scope.networkId !== owner.networkId || grant.scope.accountId !== owner.accountId) return { kind: 'blocked', reason: 'wrong-account' };
    if (!Number.isSafeInteger(epoch) || epoch < 1 || !/^[a-f0-9]{64}$/u.test(commitHashHex)) return { kind: 'blocked', reason: 'evidence-unavailable' };
    const room = deps.conversationPolicy(owner, conversationId)?.room ?? String(conversationId);
    const privateDb = await ensureDB();
    if (!privateDb || !localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'storage-unavailable' };
    const key = portableEscrowKey(grant.stableLocalOwnerKey, room, epoch, commitHashHex);
    let row: { scope?: unknown; room?: unknown; epoch?: unknown; commitHashHex?: unknown; state?: unknown; ciphertext?: unknown } | undefined;
    try { row = await requestResult(privateDb.db, 'epoch-backups', 'readonly', key) as typeof row; } catch { return { kind: 'blocked', reason: 'storage-unavailable' }; }
    if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
    if (!row || row.scope !== grant.stableLocalOwnerKey || row.room !== room || row.epoch !== epoch || row.commitHashHex !== commitHashHex || row.state !== 'accepted' || !(row.ciphertext instanceof Uint8Array)) return { kind: 'blocked', reason: 'epoch-material-unavailable' };
    const encryptedAtRest = row.ciphertext.slice();
    const opened = await workspaceCrypt({ context, grant, conversationId, exactBinding: room,
      purpose: `epoch-escrow:${room}:${epoch}:${commitHashHex}`, bytes: encryptedAtRest, opening: true });
    encryptedAtRest.fill(0);
    if (opened.kind !== 'opened' || !opened.bytes) return { kind: 'blocked', reason: opened.kind === 'stale-owner' ? 'stale-owner' : 'storage-unavailable' };
    let password: Uint8Array | null = null;
    try {
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
      let payload: PortableGroupBackup;
      try { payload = JSON.parse(decoder.decode(opened.bytes)) as PortableGroupBackup; }
      catch { return { kind: 'blocked', reason: 'evidence-unavailable' }; }
      if (payload.networkId !== grant.scope.networkId || payload.accountId !== grant.scope.accountId || payload.room !== room
        || payload.epoch !== epoch || payload.commitHashHex !== commitHashHex) return { kind: 'blocked', reason: 'evidence-unavailable' };
      const epochKey = fromB64url(payload.epochKeyB64url); const signer = fromB64url(payload.receipt.signerPublicKeyB64url);
      if (!epochKey || !signer || epochKey.length !== 32 || signer.length !== 32) { epochKey?.fill(0); signer?.fill(0); return { kind: 'blocked', reason: 'evidence-unavailable' }; }
      try {
        const evidence = await verifyPortableCheckpoint(payload, epochKey, signer);
        if (!evidence || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { wipeEvidence(evidence ?? undefined); return { kind: 'blocked', reason: 'evidence-unavailable' }; }
        const accepted = await restoreAcceptedEvidence(context, room, conversationId, epoch, commitHashHex);
        if (!accepted || !equalBytes(accepted.evidence.commitHash, evidence.commitHash)
          || accepted.evidence.signedCommitPayload !== evidence.signedCommitPayload) { wipeEvidence(evidence); return { kind: 'blocked', reason: 'evidence-unavailable' }; }
        wipeEvidence(accepted.evidence); wipeEvidence(evidence);
      } finally { epochKey.fill(0); signer.fill(0); }
      password = await deps.readPrivatePassword(input.passwordRef, context);
      if (!password || !localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
      const bytes = await encryptPortableGroupBackup(payload, password);
      if (!bytes) return { kind: 'blocked', reason: 'evidence-unavailable' };
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) { bytes.fill(0); return { kind: 'blocked', reason: 'stale-owner' }; }
      return { kind: 'encrypted', bytes };
    } finally { password?.fill(0); opened.bytes.fill(0); }
  }

  async function previewPortableGroupBackup(input: { context: RequestContext; inputRef: symbol; passwordRef: symbol; configuredNetworkId: string; conversationId: ConversationId }): Promise<{ kind: 'preview'; preview: PortableBackupPreview } | { kind: 'blocked'; reason: PortableBackupReason }> {
    const { context } = input; const owner = context.owner;
    if (!localRequestCurrent(context)) return { kind: 'blocked', reason: 'stale-owner' };
    if (!deps.configuredNetwork(input.configuredNetworkId)) return { kind: 'blocked', reason: 'wrong-network' };
    let source: Awaited<ReturnType<PrivateCryptoDeps['readPrivateImport']>> | null = null;
    let opened: Awaited<ReturnType<typeof decryptPortableGroupBackup>> = null;
    try {
      source = await deps.readPrivateImport(input.inputRef, input.passwordRef, context);
      if (!source || !localRequestCurrent(context)) return { kind: 'blocked', reason: 'stale-owner' };
      opened = await decryptPortableGroupBackup(source.bytes, source.password);
      if (!localRequestCurrent(context)) return { kind: 'blocked', reason: 'stale-owner' };
      if (!opened) return { kind: 'blocked', reason: 'wrong-password-or-corrupt' };
      const payload = opened.payload;
      if (payload.networkId !== input.configuredNetworkId) return { kind: 'blocked', reason: 'wrong-network' };
      if (payload.accountId !== owner.accountId && owner.accountId !== null) return { kind: 'blocked', reason: 'wrong-account' };
      const requestedRoom = deps.conversationPolicy(owner, input.conversationId)?.room ?? String(input.conversationId);
      if (payload.room !== requestedRoom) return { kind: 'blocked', reason: 'wrong-room' };
      const verifiedEvidence = await verifyPortableCheckpoint(payload, opened.epochKey, opened.signerPublicKey);
      if (!verifiedEvidence || !localRequestCurrent(context)) { wipeEvidence(verifiedEvidence ?? undefined); return { kind: 'blocked', reason: 'evidence-unavailable' }; }
      const grant = deps.workspaceGrantForOwner?.(owner);
      let matches = false;
      if (grant && workspaceGrantValid(grant) && grant.scope.kind === 'account' && grant.scope.networkId === payload.networkId && grant.scope.accountId === payload.accountId) {
        const accepted = await restoreAcceptedEvidence(context, payload.room, input.conversationId, payload.epoch, payload.commitHashHex);
        matches = !!accepted && equalBytes(accepted.evidence.commitHash, verifiedEvidence.commitHash)
          && accepted.evidence.signedCommitPayload === verifiedEvidence.signedCommitPayload;
        if (accepted) wipeEvidence(accepted.evidence);
      }
      const ref = requestId(); const preview: PortableBackupPreview = Object.freeze({ previewRef: ref, networkId: payload.networkId,
        accountId: payload.accountId, conversationId: input.conversationId, epoch: payload.epoch, commitHashHex: payload.commitHashHex,
        signerAccountId: payload.receipt.fromAccount, signerDeviceId: payload.receipt.fromDevice,
        signerFingerprintHex: payload.receipt.signerFingerprintHex, trust: matches ? 'matches-local-receipt' : 'new-history-checkpoint', historyOnly: true });
      const candidate = { owner: Object.freeze({ ...owner }), grantRef: grant?.ref ?? null,
        selectionRef: deps.workspaceSelectionRef?.() ?? grant?.scope.workspaceRef ?? null,
        checkpointRef: Symbol('portable-history-checkpoint'), expiresAt: Date.now() + 300_000,
        payload, epochKey: opened.epochKey.slice(), signerPublicKey: opened.signerPublicKey.slice(), preview, timer: null as ReturnType<typeof setTimeout> | null };
      candidate.timer = setTimeout(() => clearPortablePreview(ref), 300_000);
      portablePreviews.set(ref, candidate);
      while (portablePreviews.size > 1) { const oldest = portablePreviews.keys().next().value as string | undefined; if (!oldest) break; clearPortablePreview(oldest); }
      wipeEvidence(verifiedEvidence);
      return { kind: 'preview', preview };
    } catch { return { kind: 'blocked', reason: 'invalid-container' }; }
    finally { source?.bytes.fill(0); source?.password.fill(0); opened?.epochKey.fill(0); opened?.signerPublicKey.fill(0); }
  }

  async function approvePortableGroupBackup(input: { context: RequestContext; previewRef: string; confirmHistoryOnly: true; confirmFingerprint: string }): Promise<{ kind: 'installed-history-only'; conversationId: ConversationId; epoch: number; commitHashHex: string } | { kind: 'blocked'; reason: PortableBackupReason }> {
    const candidate = portablePreviews.get(input.previewRef); const { context } = input;
    if (!candidate || candidate.expiresAt <= Date.now()) return { kind: 'blocked', reason: 'cancelled' };
    if (!localRequestCurrent(context) || !equalOwner(candidate.owner, context.owner)) return { kind: 'blocked', reason: 'stale-owner' };
    if (candidate.selectionRef !== (deps.workspaceSelectionRef?.() ?? deps.workspaceGrantForOwner?.(context.owner)?.scope.workspaceRef ?? null)) return { kind: 'blocked', reason: 'stale-owner' };
    if (input.confirmHistoryOnly !== true || input.confirmFingerprint !== candidate.preview.signerFingerprintHex) return { kind: 'blocked', reason: 'explicit-trust-required' };
    // One-use consume before awaits prevents duplicate approval/install races.
    if (candidate.timer) clearTimeout(candidate.timer);
    portablePreviews.delete(input.previewRef);
    try {
    let grant = deps.workspaceGrantForOwner?.(context.owner);
    const capturedGrantValid = candidate.grantRef !== null && !!grant && workspaceGrantValid(grant)
      && grant.ref === candidate.grantRef && grant.scope.networkId === candidate.payload.networkId
      && (grant.scope.kind === 'account'
        ? grant.scope.accountId === candidate.payload.accountId
        : context.owner.accountId === null && context.owner.physicalRef !== null
          && grant.scope.physicalRef === context.owner.physicalRef);
    if (candidate.grantRef !== null && !capturedGrantValid) return { kind: 'blocked', reason: 'workspace-locked' };
    if (candidate.grantRef === null && grant && workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
    // A connected guest grant is only a fence proving the same physical UI
    // owner. It never becomes account authority; explicit approval creates a
    // separate history-only account workspace below.
    if (candidate.grantRef === null || grant?.scope.kind === 'guest') {
      approvedHistoryCheckpoints.set(candidate.checkpointRef, { networkId: candidate.payload.networkId, accountId: candidate.payload.accountId, owner: candidate.owner, expiresAt: Date.now() + 30_000 });
      try { grant = await deps.ensureImportedHistoryWorkspace?.({ context, networkId: candidate.payload.networkId as import('./contracts').NetworkId,
        accountId: candidate.payload.accountId as AccountId, checkpointRef: candidate.checkpointRef, explicit: true }) ?? null; }
      finally { approvedHistoryCheckpoints.delete(candidate.checkpointRef); }
    }
    if (!grant || !workspaceGrantValid(grant) || grant.scope.kind !== 'account' || grant.scope.networkId !== candidate.payload.networkId
      || grant.scope.accountId !== candidate.payload.accountId || !localRequestCurrent(context)) {
      candidate.epochKey.fill(0); candidate.signerPublicKey.fill(0); return { kind: 'blocked', reason: 'workspace-locked' };
    }
    const evidence = await verifyPortableCheckpoint(candidate.payload, candidate.epochKey, candidate.signerPublicKey);
    if (!evidence || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { wipeEvidence(evidence ?? undefined); return { kind: 'blocked', reason: 'stale-owner' }; }
    try {
      // Reject an already-known sibling before touching the history keyring.
      const privateDb = await ensureDB();
      if (!privateDb || !localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'storage-unavailable' };
      for (const item of historicalAccepted.values()) if (item.scope === grant.stableLocalOwnerKey
        && item.evidence.room === candidate.payload.room && item.evidence.epoch === candidate.payload.epoch
        && hex(item.evidence.commitHash) !== candidate.payload.commitHashHex) return { kind: 'blocked', reason: 'checkpoint-conflict' };
      for (const item of acceptedCommits.values()) if (item.owner.networkId === candidate.payload.networkId && item.owner.accountId === candidate.payload.accountId
        && item.evidence.room === candidate.payload.room && item.evidence.epoch === candidate.payload.epoch
        && hex(item.evidence.commitHash) !== candidate.payload.commitHashHex) return { kind: 'blocked', reason: 'checkpoint-conflict' };
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
      const importedPayload: PortableGroupBackup = { ...candidate.payload,
        receipt: { ...candidate.payload.receipt, provenance: 'user-approved-history-checkpoint' } };
      const plaintext = encoder.encode(JSON.stringify(importedPayload));
      const sealed = await workspaceCrypt({ context, grant, conversationId: candidate.preview.conversationId, exactBinding: candidate.payload.room,
        purpose: `epoch-escrow:${candidate.payload.room}:${candidate.payload.epoch}:${candidate.preview.commitHashHex}`, bytes: plaintext, opening: false });
      plaintext.fill(0);
      if (sealed.kind !== 'sealed' || !sealed.bytes || !localRequestCurrent(context) || !workspaceGrantValid(grant)) { sealed.bytes?.fill(0); return { kind: 'blocked', reason: 'storage-unavailable' }; }
      const rowKey = portableEscrowKey(grant.stableLocalOwnerKey, candidate.payload.room, candidate.payload.epoch, candidate.preview.commitHashHex);
      const row = { key: rowKey, scope: grant.stableLocalOwnerKey, room: candidate.payload.room, epoch: candidate.payload.epoch,
        commitHashHex: candidate.preview.commitHashHex, state: 'history-only' as const, ciphertext: sealed.bytes.slice() };
      try {
        // Sibling detection and reservation share one read/write transaction.
        // IndexedDB serializes these transactions across tabs, so two distinct
        // valid checkpoints cannot both become the local branch.
        const persisted = await new Promise<'saved' | 'same-checkpoint' | 'conflict' | 'unavailable'>((resolve) => {
          let tx: IDBTransaction; try { tx = privateDb.db.transaction('epoch-backups', 'readwrite'); } catch { resolve('unavailable'); return; }
          const store = tx.objectStore('epoch-backups'); let result: 'saved' | 'same-checkpoint' | 'conflict' | 'unavailable' = 'unavailable';
          let sibling = false; let exact: typeof row | undefined; let count = 0;
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              if (++count > 1024) { try { tx.abort(); } catch { /* transaction ended */ } return; }
              const prior = cursor.value as typeof row;
              if (prior.scope === row.scope && prior.room === row.room && prior.epoch === row.epoch) {
                if (prior.commitHashHex !== row.commitHashHex) sibling = true;
                else exact = prior;
              }
              cursor.continue();
              return;
            }
            if (sibling) { result = 'conflict'; return; }
            if (exact) { result = exact.state === 'history-only' || exact.state === 'accepted' ? 'same-checkpoint' : 'conflict'; return; }
            const add = store.add(row, rowKey);
            add.onsuccess = () => { result = 'saved'; };
            add.onerror = () => { try { tx.abort(); } catch { /* transaction ended */ } };
          };
          cursorRequest.onerror = () => { try { tx.abort(); } catch { /* transaction ended */ } };
          tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => resolve('unavailable');
        });
        if (persisted === 'conflict') return { kind: 'blocked', reason: 'checkpoint-conflict' };
        if (persisted !== 'saved' && persisted !== 'same-checkpoint') return { kind: 'blocked', reason: 'storage-unavailable' };
      } catch { return { kind: 'blocked', reason: 'storage-unavailable' }; }
      finally { row.ciphertext.fill(0); sealed.bytes.fill(0); }
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
      const key = await crypto.subtle.importKey('raw', cryptoBytes(candidate.epochKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      if (!localRequestCurrent(context) || !workspaceGrantValid(grant)) return { kind: 'blocked', reason: 'stale-owner' };
      const keyring = historyKeyringFor(grant);
      const installed = keyring.install(candidate.payload.room, candidate.payload.epoch, key, candidate.preview.commitHashHex);
      if (installed !== 'installed' && installed !== 'unchanged') return { kind: 'blocked', reason: 'checkpoint-conflict' };
      const bindingKey = historicalEvidenceKey(grant.stableLocalOwnerKey, candidate.payload.room,
        candidate.payload.epoch, candidate.preview.commitHashHex);
      historyCheckpointBindings.set(bindingKey, { scope: grant.stableLocalOwnerKey, room: candidate.payload.room,
        epoch: candidate.payload.epoch, commitHashHex: candidate.preview.commitHashHex, escrowState: 'history-only' });
      while (historyCheckpointBindings.size > 512) {
        const oldest = historyCheckpointBindings.keys().next().value as string | undefined;
        if (!oldest) break;
        historyCheckpointBindings.delete(oldest);
      }
      return { kind: 'installed-history-only', conversationId: candidate.preview.conversationId, epoch: candidate.preview.epoch, commitHashHex: candidate.preview.commitHashHex };
    } finally { candidate.epochKey.fill(0); candidate.signerPublicKey.fill(0); wipeEvidence(evidence); }
    } catch { return { kind: 'blocked', reason: 'storage-unavailable' }; }
    finally { candidate.epochKey.fill(0); candidate.signerPublicKey.fill(0); }
  }

  function cancelPortableGroupBackup(input: { context: RequestContext; previewRef: string }): void {
    const candidate = portablePreviews.get(input.previewRef);
    if (!candidate || !equalOwner(candidate.owner, input.context.owner)) return;
    clearPortablePreview(input.previewRef);
  }

  return {
    exportPortableGroupBackup,
    previewPortableGroupBackup,
    approvePortableGroupBackup,
    cancelPortableGroupBackup,
    isApprovedHistoryCheckpoint(input: { checkpointRef: symbol; networkId: string; accountId: string; context: RequestContext }): boolean {
      const saved = approvedHistoryCheckpoints.get(input.checkpointRef);
      return !!saved && saved.expiresAt > Date.now() && saved.networkId === input.networkId && saved.accountId === input.accountId
        && equalOwner(saved.owner, input.context.owner) && localRequestCurrent(input.context);
    },
    retireWorkspace(grant: WorkspaceOwnerGrant): void {
      if (!grant || typeof grant !== 'object') return;
      workspaceLocalKeys.delete(grant.stableLocalOwnerKey);
      intentMacKeys.delete(intentMacCacheKey(grant.stableLocalOwnerKey));
      historicalKeyrings.get(grant.stableLocalOwnerKey)?.clear(); historicalKeyrings.delete(grant.stableLocalOwnerKey);
      for (const [key, value] of historyCheckpointBindings) if (value.scope === grant.stableLocalOwnerKey) historyCheckpointBindings.delete(key);
      for (const [ref, candidate] of portablePreviews) if (candidate.grantRef === grant.ref) clearPortablePreview(ref);
    },
    privateIdentity,
    isTrustedDevicePinned,
    previewDeviceTrust,
    confirmDeviceTrust,
    previewBootstrap,
    approveBootstrap,
    cancelBootstrap,
    async ensureWorkspaceCustody(grant: WorkspaceOwnerGrant): Promise<'ready' | 'volatile' | 'unavailable' | 'stale'> {
      if (!workspaceGrantValid(grant)) return 'stale';
      const key = await workspaceKey(grant); if (!workspaceGrantValid(grant)) return 'stale';
      if (!key) return 'unavailable';
      const privateDb = await ensureDB(); if (!workspaceGrantValid(grant)) return 'stale';
      return privateDb ? 'ready' : 'volatile';
    },
    sealWorkspaceLocal(input: { context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }; grant: WorkspaceOwnerGrant; conversationId: ConversationId; exactBinding?: string; purpose: string; plaintext: Uint8Array }) {
      return workspaceCrypt({ ...input, bytes: input.plaintext, opening: false });
    },
    openWorkspaceLocal(input: { context: { schemaVersion: 1; requestId: RequestId; owner: OwnerSnapshot }; grant: WorkspaceOwnerGrant; conversationId: ConversationId; exactBinding?: string; purpose: string; ciphertext: Uint8Array }) {
      return workspaceCrypt({ ...input, bytes: input.ciphertext, opening: true });
    },
    ensureEnrolledIdentity: (owner: OwnerSnapshot) => ensureIdentity(owner, true),
    prepareQueuedPayload,
    prepareDispatch,
    groupProviders,
    ingestGroupControl,
    verifyIngressReceipt,
    consumeIngressReceipt,
    retireOwner(owner: OwnerSnapshot): void {
      if (disposed) return;
      retiredOwners.add(ownerLifecycleKey(owner));
      releaseAuthorLeases(owner);
      authoring.retireOwner(owner);
      recovery.retireOwner(owner);
      if (groupAdapter && adapterOwner && equalOwner(adapterOwner, owner)) {
        void groupAdapter.destroy(); groupAdapter = null; adapterOwner = null;
      }
      for (const [key, session] of sessions) {
        if (key.startsWith(`${ownerLifecycleKey(owner)}\0`)) { session.destroy(); sessions.delete(key); }
      }
      for (const [ref, receipt] of ingressReceipts) if (equalOwner(receipt.owner, owner)) {
        wipeEvidence(receipt.evidence); ingressReceipts.delete(ref);
      }
      for (const [key, accepted] of acceptedCommits) if (equalOwner(accepted.owner, owner)) {
        wipeEvidence(accepted.evidence); acceptedCommits.delete(key);
      }
      for (const [ref, candidate] of bootstrapCandidates) if (equalOwner(candidate.owner, owner)) bootstrapCandidates.delete(ref);
      for (const [ref, candidate] of genesisCandidates) if (equalOwner(candidate.owner, owner)) genesisCandidates.delete(ref);
      for (const [key, reserved] of genesisReservations) if (equalOwner(reserved.owner, owner)) genesisReservations.delete(key);
      for (const [ref, preview] of deviceTrustPreviews) if (equalOwner(preview.owner, owner)) deviceTrustPreviews.delete(ref);
      for (const [ref, candidate] of portablePreviews) if (equalOwner(candidate.owner, owner)) clearPortablePreview(ref);
      for (const [key, fork] of verifiedForkCandidates) if (equalOwner(fork.owner, owner)) {
        fork.priorHash.fill(0); fork.commitHash.fill(0); verifiedForkCandidates.delete(key);
      }
      if (identity && stableScope(owner, identity.deviceId) === identity.scope) {
        registeredScopes.delete(identity.scope); identity = null;
      }
      sharedAgreements.clear();
      deps.onReadiness?.(owner, 'stale');
    },
    async retire(owner?: OwnerSnapshot): Promise<void> {
      disposed = true;
      generation++;
      releaseAuthorLeases();
      authoring.dispose(); recovery.dispose();
      if (groupAdapter) { void groupAdapter.destroy(); groupAdapter = null; adapterOwner = null; }
      for (const session of sessions.values()) session.destroy(); sessions.clear(); for (const receipt of ingressReceipts.values()) wipeEvidence(receipt.evidence); ingressReceipts.clear();
      for (const accepted of acceptedCommits.values()) wipeEvidence(accepted.evidence); acceptedCommits.clear(); bootstrapCandidates.clear();
      for (const fork of verifiedForkCandidates.values()) { fork.priorHash.fill(0); fork.commitHash.fill(0); } verifiedForkCandidates.clear();
      if (!owner || identity && stableScope(owner, identity.deviceId) === identity.scope) identity = null;
      workspaceLocalKeys.clear(); intentMacKeys.clear(); for (const value of historicalKeyrings.values()) value.clear(); historicalKeyrings.clear();
      for (const ref of [...portablePreviews.keys()]) clearPortablePreview(ref); approvedHistoryCheckpoints.clear();
      for (const value of historicalAccepted.values()) wipeEvidence(value.evidence); historicalAccepted.clear(); sharedAgreements.clear();
      historyCheckpointBindings.clear();
      db?.db.close(); db = null;
      deps.onReadiness?.(owner ?? deps.ownerSnapshot(), 'stale');
    },
    dispose(): void { disposed = true; generation++; releaseAuthorLeases(); authoring.dispose(); recovery.dispose(); identity = null; workspaceLocalKeys.clear(); intentMacKeys.clear(); for (const value of historicalKeyrings.values()) value.clear(); historicalKeyrings.clear(); historyCheckpointBindings.clear(); for (const ref of [...portablePreviews.keys()]) clearPortablePreview(ref); approvedHistoryCheckpoints.clear(); for (const value of historicalAccepted.values()) wipeEvidence(value.evidence); historicalAccepted.clear(); sharedAgreements.clear(); for (const receipt of ingressReceipts.values()) wipeEvidence(receipt.evidence); ingressReceipts.clear(); for (const accepted of acceptedCommits.values()) wipeEvidence(accepted.evidence); acceptedCommits.clear(); bootstrapCandidates.clear(); for (const fork of verifiedForkCandidates.values()) { fork.priorHash.fill(0); fork.commitHash.fill(0); } verifiedForkCandidates.clear(); for (const session of sessions.values()) session.destroy(); sessions.clear(); if (groupAdapter) void groupAdapter.destroy(); groupAdapter = null; db?.db.close(); db = null; },
  };
}
