/** Owner- and membership-fenced room group authoring runtime. */
import type { AccountId, ConversationId, OwnerSnapshot, PrivateIdentity, RequestContext, Transport } from './contracts';
import { computeGroupEpochKeyCommitment, prepareGroupCommit } from '../../src/lib/e2ee/groupCommit';
import { prepareGroupWelcome } from '../../src/lib/e2ee/groupWelcome';
import { buildGroupControlLine } from '../../src/lib/e2ee/groupControl';
import { buildGroupControlTranscript, packGroupControlPayload, type GroupControlRouting } from '../../src/lib/e2ee/groupControlPayload';
import { buildMembershipDigest, type VerifiedGroupDirectory, type VerifiedGroupDevice } from './group-directory-trust';

export type GroupOperationPhase = 'idle' | 'planned' | 'staged' | 'transport-admitted' | 'commit-observed' | 'local-installed' | 'recipient-delivery-unknown' | 'conflict' | 'failed' | 'cancelled';
export type GroupOperationStatus = { readonly phase: GroupOperationPhase; readonly room: ConversationId | null; readonly epoch: number | null; readonly reason: GroupOperationReason | null; readonly recipientCount: number; readonly deliveryUnknown: boolean };
export type GroupOperationReason = 'stale-owner' | 'directory-incomplete' | 'membership-changed' | 'invalid-chain' | 'capacity-exceeded' | 'backup-required' | 'signing-unavailable' | 'send-blocked' | 'send-unknown' | 'commit-conflict' | 'cancelled' | 'internal-failure';
export type GroupHead =
  | { readonly kind: 'established'; readonly epoch: number; readonly commitHash: Uint8Array; readonly membershipRevision: string; readonly mappingRevision: string; readonly membershipDigest: Uint8Array; readonly accountId: AccountId; readonly deviceId: string }
  | { readonly kind: 'new-room-genesis'; readonly epoch: 0; readonly commitHash: Uint8Array; readonly membershipRevision: string; readonly mappingRevision: string; readonly membershipDigest: Uint8Array; readonly accountId: AccountId; readonly deviceId: string; readonly proofRef: symbol };
export interface GroupSigningPublic { readonly deviceId: string; readonly signerPublicKey: Uint8Array; readonly wrapPublicKey: Uint8Array; readonly revision: string; }
export interface PublicGroupPlan extends RequestContext { readonly planRef: string; readonly conversationId: ConversationId; readonly room: string; readonly priorEpoch: number; readonly nextEpoch: number; readonly membershipRevision: string; readonly mappingRevision: string; readonly recipientCount: number; readonly backupRequired: true; }
interface InternalGroupPlan { readonly requestId: RequestContext['requestId']; readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly room: string; readonly authorAccount: AccountId; readonly authorDevice: string; readonly priorEpoch: number; readonly nextEpoch: number; readonly priorCommitHash: Uint8Array; readonly membershipDigest: Uint8Array; readonly priorMembershipRevision: string; readonly priorMappingRevision: string; readonly priorMembershipDigest: Uint8Array; readonly membershipRevision: string; readonly mappingRevision: string; readonly recipients: readonly VerifiedGroupDevice[]; readonly operationNonce: string; readonly genesisReservation: symbol | null; }
export interface GroupMembershipIntent extends RequestContext { readonly conversationId: ConversationId; readonly explicitUserIntent: true; readonly expectedEpoch: number; readonly expectedCommitHash: Uint8Array; readonly excludeDevice?: { readonly accountId: AccountId; readonly deviceId: string }; }
export interface CommitPlanIntent extends RequestContext { readonly planRef: string; readonly confirmMembershipRevision: string; readonly confirmBackupEnabled: true; }
export interface GroupControlEvent { readonly context: RequestContext; readonly receiptRef: symbol; readonly conversationId: ConversationId; readonly room: string; readonly kind: 'commit' | 'welcome'; readonly inputKind: 'commit' | 'welcome'; readonly accountId: AccountId; readonly deviceId: string; readonly toAccount?: AccountId; readonly toDevice?: string; readonly epoch: number; readonly commitId: Uint8Array; readonly commitHash: Uint8Array; readonly membershipDigest: Uint8Array; readonly operationNonce?: string; }
export interface GroupApplyResult { readonly kind: 'commit-observed' | 'local-installed' | 'rejected'; readonly reason?: GroupOperationReason; }
export interface GroupAuthoringDeps {
  readonly transport: Transport; readonly privateIdentity: PrivateIdentity;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentHead: (owner: OwnerSnapshot, conversationId: ConversationId) => Promise<GroupHead | null>;
  readonly reserveGenesisProof?: (owner: OwnerSnapshot, conversationId: ConversationId, proofRef: symbol) => symbol | null | Promise<symbol | null>;
  readonly validateGenesisReservation?: (owner: OwnerSnapshot, conversationId: ConversationId, reservation: symbol) => boolean | Promise<boolean>;
  readonly authorizeAuthor: (owner: OwnerSnapshot, conversationId: ConversationId, accountId: AccountId, deviceId: string) => boolean | Promise<boolean>;
  /** Required-room PRIVMSG must remain paused while membership is ahead of installed keys. */
  readonly setRoomSendGate: (owner: OwnerSnapshot, conversationId: ConversationId, state: 'paused-membership-change' | 'ready' | 'recovery-required') => void;
  readonly directory: (context: RequestContext & { conversationId: ConversationId }) => Promise<VerifiedGroupDirectory | null>;
  readonly signingPublic: (context: RequestContext & { conversationId: ConversationId }) => Promise<GroupSigningPublic | null>;
  /** Must create and privately persist a password-protected backup before commit admission. */
  readonly prepareRecoverableEpoch: (context: RequestContext & { conversationId: ConversationId; room: string; epoch: number; commitId: Uint8Array; commitHash: Uint8Array; membershipDigest: Uint8Array; epochKey: Uint8Array }) => Promise<boolean>;
  /** Authenticated ingress adapter verifies OGC1 + directory + chain and handles own commit/welcome pairing. */
  readonly applyAuthenticatedControl: (event: GroupControlEvent) => Promise<GroupApplyResult>;
  readonly verifyIngressReceipt: (receiptRef: symbol, owner: OwnerSnapshot, conversationId: ConversationId, room: string, epoch: number, accountId: AccountId, deviceId: string, inputKind: 'commit' | 'welcome', commitId: Uint8Array, commitHash: Uint8Array, membershipDigest: Uint8Array) => boolean;
  readonly acquireAuthorLease: (input: { readonly owner: OwnerSnapshot; readonly room: string; readonly nonce: string }) => Promise<{ readonly isCurrent: () => boolean; readonly release: () => void } | null>;
  readonly persistAuthorIntent: (input: { readonly owner: OwnerSnapshot; readonly room: string; readonly nonce: string; readonly priorEpoch: number; readonly priorHash: Uint8Array; readonly nextEpoch: number; readonly commitId: Uint8Array; readonly commitHash: Uint8Array; readonly stage: 'prepared' | 'admitted' | 'unknown' | 'resolved' | 'cancelled' }) => Promise<boolean>;
  readonly onStatus?: (status: GroupOperationStatus) => void;
  readonly randomId?: () => string;
}
type ActiveOp = { plan: InternalGroupPlan; status: GroupOperationStatus; cancelled: boolean; lockKey: string; operationNonce: string; commitId: Uint8Array | null; commitHash: Uint8Array | null };
const U32_MAX = 0xffffffff;
const clone = (b: Uint8Array) => new Uint8Array(b);
function eq(a: Uint8Array, b: Uint8Array): boolean { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!; return x === 0; }
function authorMatchesDirectory(directory: VerifiedGroupDirectory, accountId: AccountId, deviceId: string, signing: GroupSigningPublic): boolean {
  const device = directory.devices.find((candidate) => candidate.accountId === accountId && candidate.deviceId === deviceId);
  return !!device && signing.deviceId === deviceId && signing.revision.length > 0
    && eq(device.signerPublicKey, signing.signerPublicKey) && eq(device.wrapPublicKey, signing.wrapPublicKey);
}
function status(phase: GroupOperationPhase, room: ConversationId | null, epoch: number | null, reason: GroupOperationReason | null, count = 0): GroupOperationStatus { return { phase, room, epoch, reason, recipientCount: count, deliveryUnknown: phase === 'recipient-delivery-unknown' }; }
function randomHex(bytes = 16): string { return [...crypto.getRandomValues(new Uint8Array(bytes))].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function ownerRoomKey(owner: OwnerSnapshot, room: string): string { return `${owner.networkId}\0${owner.accountId ?? ''}\0${room}`; }

export function createGroupAuthoring(deps: GroupAuthoringDeps) {
  let disposed = false;
  const operations = new Map<string, ActiveOp>();
  const operationsByNonce = new Map<string, ActiveOp>();
  const issuedPlans = new Map<string, InternalGroupPlan>();
  const roomLocks = new Map<string, string>();
  const ownerEqual = (a: OwnerSnapshot, b: OwnerSnapshot) => a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
  const transitionAllowed = (before: GroupOperationPhase, after: GroupOperationPhase): boolean => {
    if (before === after) return true;
    if (before === 'local-installed' || before === 'failed' || before === 'cancelled') return false;
    if (before === 'idle' || before === 'planned') return after === 'staged' || after === 'failed' || after === 'cancelled';
    if (before === 'staged') return after === 'transport-admitted' || after === 'recipient-delivery-unknown' || after === 'failed' || after === 'cancelled';
    if (before === 'transport-admitted') return after === 'commit-observed' || after === 'local-installed' || after === 'recipient-delivery-unknown';
    if (before === 'commit-observed' || before === 'recipient-delivery-unknown') return after === 'commit-observed' || after === 'local-installed' || after === 'recipient-delivery-unknown';
    return after === 'failed' || after === 'cancelled';
  };
  const publish = (op: ActiveOp, phase: GroupOperationPhase, reason: GroupOperationReason | null = null) => {
    if (disposed || !transitionAllowed(op.status.phase, phase)) return;
    op.status = status(phase, op.plan.conversationId, op.plan.nextEpoch, reason, op.plan.recipients.length);
    if (deps.isCurrent(op.plan.owner) && deps.transport.isCurrent(op.plan.owner)) deps.onStatus?.(op.status);
  };
  const current = (op: ActiveOp) => !disposed && !op.cancelled && deps.isCurrent(op.plan.owner)
    && deps.transport.isCurrent(op.plan.owner) && operations.get(op.plan.requestId) === op;
  function erasePlan(plan: InternalGroupPlan) { plan.priorCommitHash.fill(0); plan.membershipDigest.fill(0); plan.priorMembershipDigest.fill(0); for (const r of plan.recipients) { r.signerPublicKey.fill(0); r.wrapPublicKey.fill(0); } }
  function clearIssuedPlans() { for (const plan of issuedPlans.values()) erasePlan(plan); issuedPlans.clear(); }
  function pruneOperations(): boolean {
    for (const [id, op] of operations) {
      if (op.status.phase === 'failed' || op.status.phase === 'cancelled' || op.status.phase === 'local-installed') {
        operations.delete(id); operationsByNonce.delete(op.operationNonce); op.commitId?.fill(0); op.commitHash?.fill(0);
      }
    }
    return operations.size < 64;
  }

  return {
    async plan(req: GroupMembershipIntent): Promise<PublicGroupPlan | null> {
      if (disposed || req.explicitUserIntent !== true || !deps.isCurrent(req.owner) || !deps.transport.isCurrent(req.owner)) return null;
      const [head, directory] = await Promise.all([
        deps.currentHead(req.owner, req.conversationId),
        deps.directory({ ...req, conversationId: req.conversationId }),
      ]);
      if (disposed || !deps.isCurrent(req.owner) || !deps.transport.isCurrent(req.owner) || !head || !directory || !directory.complete) return null;
      const genesisReservation = head.kind === 'new-room-genesis'
        ? await deps.reserveGenesisProof?.(req.owner, req.conversationId, head.proofRef) ?? null : null;
      if (disposed || !deps.isCurrent(req.owner) || !deps.transport.isCurrent(req.owner)) return null;
      if (head.kind === 'new-room-genesis' && !genesisReservation) return null;
      if (!Number.isSafeInteger(head.epoch) || head.epoch < 0 || head.epoch >= U32_MAX
        || req.expectedEpoch !== head.epoch || !eq(req.expectedCommitHash, head.commitHash)
        || head.accountId !== req.owner.accountId) return null;
      const signer = await deps.signingPublic({ ...req, conversationId: req.conversationId });
      if (!signer || disposed || !deps.isCurrent(req.owner) || !authorMatchesDirectory(directory, head.accountId, head.deviceId, signer)) return null;
      if (!await deps.authorizeAuthor(req.owner, req.conversationId, head.accountId, head.deviceId) || !deps.isCurrent(req.owner)) return null;
      const membershipDigest = await buildMembershipDigest({ networkId: req.owner.networkId, priorEpoch: head.epoch, priorCommitHash: head.commitHash, localAccount: head.accountId, localDeviceId: head.deviceId, directory });
      if (!membershipDigest || disposed || !deps.isCurrent(req.owner) || !deps.transport.isCurrent(req.owner)) return null;
      if (req.excludeDevice && directory.devices.some((d) => d.accountId === req.excludeDevice!.accountId && d.deviceId === req.excludeDevice!.deviceId)) { membershipDigest.fill(0); return null; }
      if (directory.revision !== head.membershipRevision || directory.mappingRevision !== head.mappingRevision
        || !eq(membershipDigest, head.membershipDigest)) deps.setRoomSendGate(req.owner, req.conversationId, 'paused-membership-change');
      const internalPlan: InternalGroupPlan = {
        requestId: req.requestId, owner: Object.freeze({ ...req.owner }), conversationId: req.conversationId, room: directory.canonicalRoom,
        authorAccount: head.accountId, authorDevice: head.deviceId,
        priorEpoch: head.epoch, nextEpoch: head.epoch + 1, priorCommitHash: clone(head.commitHash), membershipDigest,
        priorMembershipRevision: head.membershipRevision, priorMappingRevision: head.mappingRevision, priorMembershipDigest: clone(head.membershipDigest), membershipRevision: directory.revision, mappingRevision: directory.mappingRevision,
        recipients: directory.devices.map((d) => ({ ...d, signerPublicKey: clone(d.signerPublicKey), wrapPublicKey: clone(d.wrapPublicKey) })),
        operationNonce: deps.randomId?.() ?? randomHex(),
        genesisReservation,
      };
      if (issuedPlans.size >= 64) {
        const oldest = issuedPlans.keys().next().value as string | undefined;
        if (oldest) { const prior = issuedPlans.get(oldest); if (prior) erasePlan(prior); issuedPlans.delete(oldest); }
      }
      const planRef = randomHex(32);
      issuedPlans.set(planRef, internalPlan);
      if (disposed || !deps.isCurrent(req.owner)) { issuedPlans.delete(planRef); erasePlan(internalPlan); return null; }
      const publicPlan: PublicGroupPlan = Object.freeze({ schemaVersion: 1, requestId: req.requestId, owner: Object.freeze({ ...req.owner }), planRef,
        conversationId: req.conversationId, room: directory.canonicalRoom, priorEpoch: head.epoch, nextEpoch: head.epoch + 1,
        membershipRevision: directory.revision, mappingRevision: directory.mappingRevision, recipientCount: directory.devices.length, backupRequired: true });
      return publicPlan;
    },
    async commit(req: CommitPlanIntent): Promise<GroupOperationStatus> {
      const plan = issuedPlans.get(req.planRef);
      issuedPlans.delete(req.planRef);
      if (!plan) return status('failed', null, null, 'invalid-chain');
      const base = status('failed', plan.conversationId, plan.nextEpoch, 'stale-owner', plan.recipients.length);
      // The single-use, owner-bound planRef is the capability. The explicit
      // confirmation is a separate user request with its own requestId; the
      // operation keeps the plan's requestId for locks and cancellation.
      if (disposed || !ownerEqual(req.owner, plan.owner) || req.confirmMembershipRevision !== plan.membershipRevision || req.confirmBackupEnabled !== true
        || !deps.isCurrent(plan.owner) || !deps.transport.isCurrent(plan.owner)) { erasePlan(plan); return base; }
      const lockKey = ownerRoomKey(plan.owner, plan.room);
      if (roomLocks.has(lockKey) || operations.has(plan.requestId)) { erasePlan(plan); return status('conflict', plan.conversationId, plan.nextEpoch, 'commit-conflict', plan.recipients.length); }
      const authorLease = await deps.acquireAuthorLease({ owner: plan.owner, room: plan.room, nonce: plan.operationNonce });
      if (!authorLease || !authorLease.isCurrent() || disposed || !deps.isCurrent(plan.owner)) { authorLease?.release(); erasePlan(plan); return status('conflict', plan.conversationId, plan.nextEpoch, 'commit-conflict', plan.recipients.length); }
      if (!pruneOperations()) { authorLease.release(); erasePlan(plan); return status('failed', plan.conversationId, plan.nextEpoch, 'capacity-exceeded', plan.recipients.length); }
      const op: ActiveOp = { plan, status: status('planned', plan.conversationId, plan.nextEpoch, null, plan.recipients.length), cancelled: false, lockKey, operationNonce: plan.operationNonce, commitId: null, commitHash: null };
      roomLocks.set(lockKey, plan.requestId); operations.set(plan.requestId, op);
      operationsByNonce.set(op.operationNonce, op);
      let epochKey: Uint8Array | null = null; let commitId: Uint8Array | null = null; let preparedCommit: Awaited<ReturnType<typeof prepareGroupCommit>> = null;
      const welcomes: Awaited<ReturnType<typeof prepareGroupWelcome>>[] = [];
      const planStillCurrent = async (): Promise<boolean> => {
        if (!authorLease.isCurrent() || !current(op)) return false;
        const context: RequestContext & { conversationId: ConversationId } = { schemaVersion: 1, requestId: plan.requestId, owner: plan.owner, conversationId: plan.conversationId };
        const [latestHead, latestDirectory] = await Promise.all([deps.currentHead(plan.owner, plan.conversationId), deps.directory(context)]);
        const priorStillCurrent = !!latestHead && latestHead.epoch === plan.priorEpoch && eq(latestHead.commitHash, plan.priorCommitHash)
          && latestHead.membershipRevision === plan.priorMembershipRevision && latestHead.mappingRevision === plan.priorMappingRevision
          && eq(latestHead.membershipDigest, plan.priorMembershipDigest);
        const acceptedCommitCurrent = !!latestHead && !!op.commitHash && latestHead.epoch === plan.nextEpoch && eq(latestHead.commitHash, op.commitHash)
          && latestHead.membershipRevision === plan.membershipRevision && latestHead.mappingRevision === plan.mappingRevision
          && eq(latestHead.membershipDigest, plan.membershipDigest);
        if (!current(op) || !latestHead || !latestDirectory || !latestDirectory.complete
          || (!priorStillCurrent && !acceptedCommitCurrent) || latestDirectory.revision !== plan.membershipRevision
          || latestDirectory.mappingRevision !== plan.mappingRevision || latestDirectory.canonicalRoom !== plan.room) {
          if (deps.isCurrent(plan.owner)) deps.setRoomSendGate(plan.owner, plan.conversationId, 'paused-membership-change');
          return false;
        }
        const digest = await buildMembershipDigest({ networkId: plan.owner.networkId, priorEpoch: latestHead.epoch, priorCommitHash: latestHead.commitHash, localAccount: latestHead.accountId, localDeviceId: latestHead.deviceId, directory: latestDirectory });
        if (!digest) return false;
        const same = eq(digest, plan.membershipDigest); digest.fill(0);
        if (!same) deps.setRoomSendGate(plan.owner, plan.conversationId, 'paused-membership-change');
        return same && authorLease.isCurrent() && current(op) && await deps.authorizeAuthor(plan.owner, plan.conversationId, latestHead.accountId, latestHead.deviceId) && authorLease.isCurrent() && current(op);
      };
      let authorIntentRecorded = false;
      try {
        const [head, directory, signing] = await Promise.all([
          deps.currentHead(plan.owner, plan.conversationId),
          deps.directory({ ...req, conversationId: plan.conversationId }),
          deps.signingPublic({ ...req, conversationId: plan.conversationId }),
        ]);
        if (!current(op)) return op.status;
        if (!head || !directory || !signing || !authorMatchesDirectory(directory, head.accountId, head.deviceId, signing) || head.epoch !== plan.priorEpoch || !eq(head.commitHash, plan.priorCommitHash)
          || head.membershipRevision !== plan.priorMembershipRevision || head.mappingRevision !== plan.priorMappingRevision || !eq(head.membershipDigest, plan.priorMembershipDigest) || directory.revision !== plan.membershipRevision
          || directory.mappingRevision !== plan.mappingRevision || signing.revision.length === 0) {
          publish(op, 'failed', 'membership-changed'); return op.status;
        }
        if (head.kind === 'new-room-genesis' && (!plan.genesisReservation || !deps.validateGenesisReservation || !await deps.validateGenesisReservation(plan.owner, plan.conversationId, plan.genesisReservation))) { publish(op, 'failed', 'membership-changed'); return op.status; }
        if (!await deps.authorizeAuthor(plan.owner, plan.conversationId, head.accountId, head.deviceId) || !current(op)) { publish(op, 'failed', 'membership-changed'); return op.status; }
        const freshDigest = await buildMembershipDigest({ networkId: plan.owner.networkId, priorEpoch: head.epoch, priorCommitHash: head.commitHash, localAccount: head.accountId, localDeviceId: head.deviceId, directory });
        if (!freshDigest || !eq(freshDigest, plan.membershipDigest)) { freshDigest?.fill(0); deps.setRoomSendGate(plan.owner, plan.conversationId, 'paused-membership-change'); publish(op, 'failed', 'membership-changed'); return op.status; }
        freshDigest.fill(0);
        epochKey = crypto.getRandomValues(new Uint8Array(32));
        commitId = crypto.getRandomValues(new Uint8Array(32));
        const commitment = await computeGroupEpochKeyCommitment({ room: plan.room, nextEpoch: plan.nextEpoch, commitId, membershipDigest: plan.membershipDigest, epochKey });
        if (!commitment || !current(op)) { publish(op, 'failed', 'stale-owner'); return op.status; }
        preparedCommit = await prepareGroupCommit({ room: plan.room, fromAccount: head.accountId, fromDevice: head.deviceId, priorEpoch: plan.priorEpoch, nextEpoch: plan.nextEpoch, priorCommitHash: plan.priorCommitHash, membershipDigest: plan.membershipDigest, commitId, newEpochKeyCommitment: commitment });
        commitment.fill(0);
        if (!preparedCommit || !current(op)) { publish(op, 'failed', preparedCommit ? 'stale-owner' : 'invalid-chain'); return op.status; }
        op.commitId = clone(preparedCommit.record.commitId); op.commitHash = clone(preparedCommit.commitHash);
        const signerPub = clone(signing.signerPublicKey);
        const commitHash = clone(preparedCommit.commitHash);
        const backupKey = clone(epochKey);
        let backedUp = false;
        try { backedUp = await deps.prepareRecoverableEpoch({ ...req, conversationId: plan.conversationId, room: plan.room, epoch: plan.nextEpoch, commitId, commitHash, membershipDigest: plan.membershipDigest, epochKey: backupKey }); }
        finally { backupKey.fill(0); commitHash.fill(0); signerPub.fill(0); }
        if (!backedUp || !current(op)) { publish(op, 'failed', backedUp ? 'stale-owner' : 'backup-required'); return op.status; }

        const routing: GroupControlRouting = { channel: plan.room, kind: 'commit', fromDevice: head.deviceId, fromAccount: head.accountId };
        const transcript = buildGroupControlTranscript(routing, 2, plan.nextEpoch, preparedCommit.body, signing.signerPublicKey);
        if (!transcript) { publish(op, 'failed', 'signing-unavailable'); return op.status; }
        const signature = await deps.privateIdentity.signGroupControl({ owner: plan.owner, conversationId: plan.conversationId, requestId: plan.requestId, canonicalControl: transcript });
        transcript.fill(0);
        if (!signature || signature.length !== 64 || !current(op)) { signature?.fill(0); publish(op, 'failed', 'signing-unavailable'); return op.status; }
        const commitPayload = packGroupControlPayload({ version: 2, kind: 'commit', epoch: plan.nextEpoch, body: preparedCommit.body, signerPub: signing.signerPublicKey, signature });
        signature.fill(0);
        if (!commitPayload) { publish(op, 'failed', 'signing-unavailable'); return op.status; }
        for (const recipient of plan.recipients) {
          if (!current(op)) { publish(op, 'cancelled', 'stale-owner'); return op.status; }
          const welcome = await prepareGroupWelcome({ room: plan.room, fromAccount: head.accountId, fromDevice: head.deviceId, toAccount: recipient.accountId, toDevice: recipient.deviceId, epoch: plan.nextEpoch, commitId, membershipDigest: plan.membershipDigest, epochKey, recipientWrapPublicKey: recipient.wrapPublicKey });
          if (!welcome || !current(op)) { welcome?.destroy(); publish(op, 'failed', 'internal-failure'); return op.status; }
          welcomes.push(welcome);
        }
        publish(op, 'staged');
        const commitLine = buildGroupControlLine({ channel: plan.room, kind: 'commit', fromDevice: head.deviceId, payload: commitPayload });
        if (!commitLine || !authorLease.isCurrent() || !await planStillCurrent() || !authorLease.isCurrent()) { publish(op, 'failed', 'membership-changed'); return op.status; }
        authorIntentRecorded = await deps.persistAuthorIntent({ owner: plan.owner, room: plan.room, nonce: plan.operationNonce, priorEpoch: plan.priorEpoch,
          priorHash: plan.priorCommitHash, nextEpoch: plan.nextEpoch, commitId, commitHash: preparedCommit.commitHash, stage: 'prepared' });
        if (!authorIntentRecorded || !current(op)) { publish(op, 'failed', 'membership-changed'); return op.status; }
        const commitAdmission = deps.transport.sendLine({ line: commitLine.replace(/\r\n$/u, ''), requestId: plan.requestId, owner: plan.owner });
        if (commitAdmission.kind === 'blocked') { await deps.persistAuthorIntent({ owner: plan.owner, room: plan.room, nonce: plan.operationNonce, priorEpoch: plan.priorEpoch, priorHash: plan.priorCommitHash, nextEpoch: plan.nextEpoch, commitId, commitHash: preparedCommit.commitHash, stage: 'cancelled' }); authorIntentRecorded = false; publish(op, 'failed', 'send-blocked'); return op.status; }
        const recordedAdmission = await deps.persistAuthorIntent({ owner: plan.owner, room: plan.room, nonce: plan.operationNonce, priorEpoch: plan.priorEpoch, priorHash: plan.priorCommitHash, nextEpoch: plan.nextEpoch, commitId, commitHash: preparedCommit.commitHash, stage: commitAdmission.kind === 'unknown' ? 'unknown' : 'admitted' });
        if (commitAdmission.kind === 'unknown') { publish(op, 'recipient-delivery-unknown', 'send-unknown'); return op.status; }
        publish(op, 'transport-admitted');
        if (!recordedAdmission) { deps.setRoomSendGate(plan.owner, plan.conversationId, 'recovery-required'); publish(op, 'recipient-delivery-unknown', 'send-unknown'); return op.status; }
        for (let i = 0; i < plan.recipients.length; i++) {
          if (!current(op) || !authorLease.isCurrent()) { publish(op, 'recipient-delivery-unknown', 'stale-owner'); return op.status; }
          const recipient = plan.recipients[i]!; const welcome = welcomes[i]!;
          const welcomeTranscript = buildGroupControlTranscript({ channel: plan.room, kind: 'welcome', fromDevice: head.deviceId, fromAccount: head.accountId, toAccount: recipient.accountId, toDevice: recipient.deviceId }, 2, plan.nextEpoch, welcome.bytes, signing.signerPublicKey);
          if (!welcomeTranscript) { publish(op, 'recipient-delivery-unknown', 'signing-unavailable'); return op.status; }
          const welcomeSignature = await deps.privateIdentity.signGroupControl({ owner: plan.owner, conversationId: plan.conversationId, requestId: plan.requestId, canonicalControl: welcomeTranscript });
          welcomeTranscript.fill(0);
          if (!welcomeSignature || welcomeSignature.length !== 64 || !current(op)) { welcomeSignature?.fill(0); publish(op, 'recipient-delivery-unknown', 'signing-unavailable'); return op.status; }
          const payload = packGroupControlPayload({ version: 2, kind: 'welcome', epoch: plan.nextEpoch, body: welcome.bytes, signerPub: signing.signerPublicKey, signature: welcomeSignature });
          welcomeSignature.fill(0);
          const line = payload && buildGroupControlLine({ channel: plan.room, kind: 'welcome', fromDevice: head.deviceId, toAccount: recipient.accountId, toDevice: recipient.deviceId, payload });
          if (!line || !authorLease.isCurrent() || !await planStillCurrent() || !authorLease.isCurrent()) { publish(op, 'recipient-delivery-unknown', 'membership-changed'); return op.status; }
          const admission = deps.transport.sendLine({ line: line.replace(/\r\n$/u, ''), requestId: plan.requestId, owner: plan.owner });
          if (admission.kind !== 'transport-admitted') { publish(op, 'recipient-delivery-unknown', admission.kind === 'blocked' ? 'send-blocked' : 'send-unknown'); return op.status; }
        }
        publish(op, 'recipient-delivery-unknown');
        return op.status;
      } catch {
        publish(op, op.status.phase === 'transport-admitted' || op.status.phase === 'commit-observed' || op.status.phase === 'recipient-delivery-unknown' ? 'recipient-delivery-unknown' : 'failed', current(op) ? 'internal-failure' : 'stale-owner'); return op.status;
      } finally {
        epochKey?.fill(0); commitId?.fill(0); preparedCommit?.destroy(); for (const welcome of welcomes) welcome?.destroy();
        const terminal = op.status.phase === 'failed' || op.status.phase === 'cancelled' || op.status.phase === 'local-installed';
        if (terminal) { if (roomLocks.get(lockKey) === plan.requestId) roomLocks.delete(lockKey); }
        if (terminal && authorIntentRecorded) await deps.persistAuthorIntent({ owner: plan.owner, room: plan.room, nonce: plan.operationNonce, priorEpoch: plan.priorEpoch, priorHash: plan.priorCommitHash,
          nextEpoch: plan.nextEpoch, commitId: op.commitId ?? new Uint8Array(), commitHash: op.commitHash ?? new Uint8Array(), stage: op.status.phase === 'local-installed' ? 'resolved' : 'cancelled' });
        authorLease.release();
      }
    },
    async onAuthenticatedControl(event: GroupControlEvent): Promise<void> {
      let op = event.operationNonce ? operationsByNonce.get(event.operationNonce) : undefined;
      if (!op) op = [...operations.values()].find((candidate) => candidate.commitId && candidate.commitHash
        && candidate.plan.room === event.room && candidate.plan.nextEpoch === event.epoch
        && ownerEqual(candidate.plan.owner, event.context.owner) && eq(candidate.commitId, event.commitId)
        && eq(candidate.commitHash, event.commitHash) && eq(candidate.plan.membershipDigest, event.membershipDigest));
      if (disposed || !deps.isCurrent(event.context.owner) || !deps.transport.isCurrent(event.context.owner)
        || !deps.verifyIngressReceipt(event.receiptRef, event.context.owner, event.conversationId, event.room, event.epoch, event.accountId, event.deviceId, event.inputKind, event.commitId, event.commitHash, event.membershipDigest)) return;
      if (op && (!ownerEqual(op.plan.owner, event.context.owner) || op.plan.conversationId !== event.conversationId || op.plan.room !== event.room || op.plan.nextEpoch !== event.epoch
        || !op.commitId || !op.commitHash || !eq(op.commitId, event.commitId) || !eq(op.commitHash, event.commitHash)
        || !eq(op.plan.membershipDigest, event.membershipDigest) || event.accountId !== op.plan.authorAccount || event.deviceId !== op.plan.authorDevice
        || (event.kind === 'welcome' && (event.toAccount !== op.plan.authorAccount || event.toDevice !== op.plan.authorDevice)))) return;
      try {
        const result = await deps.applyAuthenticatedControl(event);
        if (!deps.isCurrent(event.context.owner) || !deps.transport.isCurrent(event.context.owner)) return;
        if (op && result.kind === 'commit-observed') publish(op, 'commit-observed');
        else if (op && result.kind === 'local-installed') {
          publish(op, 'local-installed');
          await deps.persistAuthorIntent({ owner: op.plan.owner, room: op.plan.room, nonce: op.operationNonce, priorEpoch: op.plan.priorEpoch, priorHash: op.plan.priorCommitHash,
            nextEpoch: op.plan.nextEpoch, commitId: op.commitId ?? new Uint8Array(), commitHash: op.commitHash ?? new Uint8Array(), stage: 'resolved' });
          deps.setRoomSendGate(op.plan.owner, op.plan.conversationId, 'ready');
          if (roomLocks.get(op.lockKey) === op.plan.requestId) roomLocks.delete(op.lockKey);
          erasePlan(op.plan); op.commitId?.fill(0); op.commitHash?.fill(0);
        }
        else if (op && result.kind === 'rejected') {
          deps.setRoomSendGate(op.plan.owner, op.plan.conversationId, 'recovery-required');
          publish(op, op.status.phase === 'transport-admitted' || op.status.phase === 'commit-observed' || op.status.phase === 'recipient-delivery-unknown' ? 'recipient-delivery-unknown' : 'failed', result.reason ?? 'internal-failure');
        }
      } catch { if (op) publish(op, 'failed', 'internal-failure'); }
    },
    status(owner: OwnerSnapshot, room: ConversationId): GroupOperationStatus {
        if (disposed) return status('idle', room, null, null);
        for (const op of [...operations.values()].reverse()) if (ownerEqual(op.plan.owner, owner) && op.plan.conversationId === room) return op.status;
      return status('idle', room, null, null);
    },
    cancel(requestId: RequestContext['requestId']): void {
      const op = operations.get(requestId); if (!op) return;
      const ambiguous = op.status.phase === 'transport-admitted' || op.status.phase === 'recipient-delivery-unknown' || op.status.phase === 'commit-observed';
      op.cancelled = true; publish(op, ambiguous ? 'recipient-delivery-unknown' : 'cancelled', ambiguous ? 'send-unknown' : 'cancelled');
      if (ambiguous) for (const recipient of op.plan.recipients) { recipient.signerPublicKey.fill(0); recipient.wrapPublicKey.fill(0); }
      else erasePlan(op.plan);
      if (!ambiguous) { op.commitId?.fill(0); op.commitHash?.fill(0); operations.delete(requestId); operationsByNonce.delete(op.operationNonce); if (roomLocks.get(op.lockKey) === requestId) roomLocks.delete(op.lockKey); }
    },
    retireOwner(owner: OwnerSnapshot): void {
      for (const [id, op] of operations) {
        if (!ownerEqual(op.plan.owner, owner)) continue;
        const ambiguous = op.status.phase === 'transport-admitted' || op.status.phase === 'recipient-delivery-unknown' || op.status.phase === 'commit-observed';
        op.cancelled = true;
        if (ambiguous) deps.setRoomSendGate(op.plan.owner, op.plan.conversationId, 'recovery-required');
        else if (op.commitId && op.commitHash) {
          const priorHash = clone(op.plan.priorCommitHash); const commitId = clone(op.commitId); const commitHash = clone(op.commitHash);
          void deps.persistAuthorIntent({ owner: op.plan.owner, room: op.plan.room, nonce: op.operationNonce,
            priorEpoch: op.plan.priorEpoch, priorHash, nextEpoch: op.plan.nextEpoch, commitId, commitHash, stage: 'cancelled' })
            .finally(() => { priorHash.fill(0); commitId.fill(0); commitHash.fill(0); });
        }
        erasePlan(op.plan); op.commitId?.fill(0); op.commitHash?.fill(0);
        operations.delete(id); operationsByNonce.delete(op.operationNonce);
        if (roomLocks.get(op.lockKey) === id) roomLocks.delete(op.lockKey);
      }
      for (const [ref, plan] of issuedPlans) if (ownerEqual(plan.owner, owner)) { erasePlan(plan); issuedPlans.delete(ref); }
    },
      dispose(): void {
      disposed = true;
      clearIssuedPlans();
      for (const op of operations.values()) {
        if (op.status.phase === 'transport-admitted' || op.status.phase === 'commit-observed' || op.status.phase === 'recipient-delivery-unknown') deps.setRoomSendGate(op.plan.owner, op.plan.conversationId, 'recovery-required');
        op.cancelled = true; erasePlan(op.plan); op.commitId?.fill(0); op.commitHash?.fill(0);
      }
      operations.clear(); operationsByNonce.clear(); roomLocks.clear();
    },
  };
}
