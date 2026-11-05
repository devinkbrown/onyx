/** Explicit device enrollment, welcome recovery, removal rotation and key-backup workflows. */
import type { AccountId, ConversationId, OwnerSnapshot, RequestContext, Transport } from './contracts';
import type { BackupMetadata } from './crypto-backup';
import type { GroupMembershipIntent } from './group-authoring';

export type RecoveryPhase = 'idle' | 'ready' | 'request-admitted' | 'delivery-unknown' | 'verified' | 'installed' | 'blocked' | 'failed';
export type RecoveryReason = 'stale-owner' | 'device-unavailable' | 'membership-unverified' | 'wrong-owner' | 'wrong-room' | 'wrong-epoch' | 'backup-invalid' | 'backup-password' | 'install-rejected' | 'transport-blocked' | 'transport-unknown' | 'operation-unavailable';
export interface RecoveryStatus extends Pick<RequestContext, 'requestId' | 'owner'> { readonly phase: RecoveryPhase; readonly reason: RecoveryReason | string | null; readonly room: ConversationId | null; readonly epoch: number | null; readonly accountId: AccountId | null; readonly preview?: PortablePreview | null; readonly backupOutcome?: 'none'|'preview'|'encrypted-export'|'installed-history-only'; }
export interface DeviceEnrollmentIntent extends RequestContext { readonly explicitUserIntent: true; readonly conversationId: ConversationId; }
export interface WelcomeRecoveryIntent extends RequestContext { readonly explicitUserIntent: true; readonly conversationId: ConversationId; readonly expectedEpoch: number; readonly expectedCommitHash: Uint8Array; }
export interface RemovalIntent extends GroupMembershipIntent { readonly removedAccountId: AccountId; readonly removedDeviceId: string; }
export interface PrivateExportIntent extends RequestContext { readonly selection: 'current-room-epoch'; readonly conversationId: ConversationId; readonly epoch: number; readonly outputRef: symbol; readonly passwordRef?: symbol; readonly commitHashHex?: string; }
export interface PrivateImportIntent extends RequestContext { readonly conversationId: ConversationId; readonly inputRef: symbol; readonly passwordRef: symbol; readonly configuredNetworkId?: string; }
export type PortablePreview = { readonly previewRef: string; readonly networkId: string; readonly accountId: string; readonly conversationId: ConversationId; readonly epoch: number; readonly commitHashHex: string; readonly signerAccountId: string; readonly signerDeviceId: string; readonly signerFingerprintHex: string; readonly trust: 'matches-local-receipt' | 'new-history-checkpoint'; readonly historyOnly: true };
export type RecoveryContext = RequestContext & { readonly signal: AbortSignal };
export interface RecoveryIdentityResult { readonly deviceId: string; readonly accountId: AccountId; readonly directoryRevision: string; readonly verified: true; }
export interface ImportedKeyMaterial { readonly bytes: Uint8Array; readonly metadata: BackupMetadata; }
export interface GroupRecoveryDeps {
  readonly transport: Transport;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentDeviceId: (owner: OwnerSnapshot) => Promise<string | null>;
  /** Local UI generation fence for history import; it does not grant wire authority. */
  readonly isLocalCurrent?: (owner: OwnerSnapshot) => boolean;
  readonly enrollVerifiedDevice: (req: DeviceEnrollmentIntent & RecoveryContext) => Promise<RecoveryIdentityResult | null>;
  readonly createWelcomeRequest: (req: WelcomeRecoveryIntent & RecoveryContext) => Promise<{ readonly line: string; readonly owner: OwnerSnapshot; readonly epoch: number } | null>;
  readonly authoring: ReturnType<typeof import('./group-authoring').createGroupAuthoring>;
  readonly exportPortableBackup: (input: { readonly context: RecoveryContext; readonly conversationId: ConversationId; readonly epoch: number; readonly commitHashHex?: string; readonly passwordRef: symbol }) => Promise<{ readonly kind: 'encrypted'; readonly bytes: Uint8Array } | { readonly kind: 'blocked'; readonly reason: string }>;
  readonly writePrivateBackupSelection: (ref: symbol, bytes: Uint8Array, context: RecoveryContext) => Promise<boolean>;
  readonly previewPortableBackup: (input: { readonly context: RecoveryContext; readonly conversationId: ConversationId; readonly inputRef: symbol; readonly passwordRef: symbol; readonly configuredNetworkId: string }) => Promise<{ readonly kind: 'preview'; readonly preview: PortablePreview } | { readonly kind: 'blocked'; readonly reason: string }>;
  readonly approvePortableBackup: (input: { readonly context: RecoveryContext; readonly previewRef: string; readonly confirmHistoryOnly: true; readonly confirmFingerprint: string }) => Promise<{ readonly kind: 'installed-history-only'; readonly conversationId: ConversationId; readonly epoch: number; readonly commitHashHex: string } | { readonly kind: 'blocked'; readonly reason: string }>;
  readonly cancelPortableBackup: (input: { readonly context: RecoveryContext; readonly previewRef: string }) => void;
  readonly authorizeRemovalIntent: (intent: RemovalIntent & RecoveryContext) => Promise<boolean>;
}
const makeStatus = (req: RequestContext, phase: RecoveryPhase, reason: string | null, room: ConversationId | null, epoch: number | null, accountId: AccountId | null): RecoveryStatus => ({ requestId: req.requestId, owner: Object.freeze({ ...req.owner }), phase, reason, room, epoch, accountId });
function ownerEqual(a: OwnerSnapshot, b: OwnerSnapshot): boolean { return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef; }

export function createGroupRecovery(deps: GroupRecoveryDeps) {
  let disposed = false;
  let generation = 0;
  let kdfBusy = false;
  const jobs = new Map<string, { token: number; owner: OwnerSnapshot; controller: AbortController }>();
  function start(req: RequestContext): number | null {
    if (disposed || jobs.size >= 16 || jobs.has(req.requestId)) return null;
    const token = generation; jobs.set(req.requestId, { token, owner: Object.freeze({ ...req.owner }), controller: new AbortController() }); return token;
  }
  function active(req: RequestContext, token: number): boolean { const job = jobs.get(req.requestId); return !disposed && generation === token && job?.token === token && !job.controller.signal.aborted && deps.isCurrent(req.owner) && deps.transport.isCurrent(req.owner); }
  function localActive(req: RequestContext, token: number): boolean { const job = jobs.get(req.requestId); return !disposed && generation === token && job?.token === token && !job.controller.signal.aborted && (deps.isLocalCurrent?.(req.owner) ?? deps.isCurrent(req.owner)); }
  function context<T extends RequestContext>(req: T): T & { signal: AbortSignal } { return { ...req, signal: jobs.get(req.requestId)?.controller.signal ?? new AbortController().signal }; }
  function finish(req: RequestContext, token: number): void { if (jobs.get(req.requestId)?.token === token) jobs.delete(req.requestId); }
  return {
    async enroll(req: DeviceEnrollmentIntent): Promise<RecoveryStatus> {
      const token = start(req); if (token === null) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, null, req.owner.accountId);
      if (req.explicitUserIntent !== true || !active(req, token)) { finish(req, token); return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, null, req.owner.accountId); }
      try {
        const identity = await deps.enrollVerifiedDevice(context(req));
        if (!active(req, token)) return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, null, req.owner.accountId);
        if (!identity?.verified || identity.accountId !== req.owner.accountId || !identity.directoryRevision) return makeStatus(req, 'failed', 'device-unavailable', req.conversationId, null, req.owner.accountId);
        return makeStatus(req, 'verified', null, req.conversationId, null, identity.accountId);
      } catch { return makeStatus(req, 'failed', 'device-unavailable', req.conversationId, null, req.owner.accountId); }
      finally { finish(req, token); }
    },
    async requestWelcome(req: WelcomeRecoveryIntent): Promise<RecoveryStatus> {
      const token = start(req); if (token === null) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, req.expectedEpoch, req.owner.accountId);
      if (req.explicitUserIntent !== true || !active(req, token)) { finish(req, token); return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, req.expectedEpoch, req.owner.accountId); }
      try {
        const request = await deps.createWelcomeRequest(context(req));
        if (!request || !ownerEqual(request.owner, req.owner) || request.epoch !== req.expectedEpoch || !active(req, token)) return makeStatus(req, 'blocked', 'membership-unverified', req.conversationId, req.expectedEpoch, req.owner.accountId);
        const admission = deps.transport.sendLine({ line: request.line, requestId: req.requestId, owner: req.owner });
        if (!active(req, token)) return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, req.expectedEpoch, req.owner.accountId);
        if (admission.kind === 'transport-admitted') return makeStatus(req, 'request-admitted', null, req.conversationId, req.expectedEpoch, req.owner.accountId);
        return admission.kind === 'blocked'
          ? makeStatus(req, 'blocked', 'transport-blocked', req.conversationId, req.expectedEpoch, req.owner.accountId)
          : makeStatus(req, 'delivery-unknown', 'transport-unknown', req.conversationId, req.expectedEpoch, req.owner.accountId);
      } catch { return makeStatus(req, 'failed', 'operation-unavailable', req.conversationId, req.expectedEpoch, req.owner.accountId); }
      finally { finish(req, token); }
    },
    async rotateAfterRemoval(req: RemovalIntent): Promise<RecoveryStatus> {
      const token = start(req); if (token === null) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, req.expectedEpoch, req.owner.accountId);
      const currentDeviceId = await deps.currentDeviceId(req.owner);
      if (!req.removedDeviceId || !active(req, token) || (req.removedAccountId === req.owner.accountId && req.removedDeviceId === currentDeviceId)) { finish(req, token); return makeStatus(req, 'blocked', 'wrong-owner', req.conversationId, req.expectedEpoch, req.owner.accountId); }
      try {
        if (!await deps.authorizeRemovalIntent(context(req)) || !active(req, token)) return makeStatus(req, 'blocked', 'membership-unverified', req.conversationId, req.expectedEpoch, req.owner.accountId);
        const plan = await deps.authoring.plan({ ...req, excludeDevice: { accountId: req.removedAccountId, deviceId: req.removedDeviceId } });
        if (!plan || !active(req, token)) return makeStatus(req, 'blocked', 'membership-unverified', req.conversationId, null, req.owner.accountId);
        const result = await deps.authoring.commit({ schemaVersion: 1, requestId: req.requestId, owner: req.owner, planRef: plan.planRef, confirmMembershipRevision: plan.membershipRevision, confirmBackupEnabled: true });
        if (!active(req, token)) return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, plan.nextEpoch, req.owner.accountId);
        return makeStatus(req, result.phase === 'transport-admitted' || result.phase === 'commit-observed' || result.phase === 'local-installed' || result.phase === 'recipient-delivery-unknown' ? 'request-admitted' : 'failed', result.phase === 'failed' ? 'operation-unavailable' : null, req.conversationId, plan.nextEpoch, req.owner.accountId);
      } catch { return makeStatus(req, 'failed', 'operation-unavailable', req.conversationId, req.expectedEpoch, req.owner.accountId); }
      finally { finish(req, token); }
    },
    async exportBackup(req: PrivateExportIntent): Promise<RecoveryStatus> {
      const token = start(req); if (token === null) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, req.epoch, req.owner.accountId);
      if (!active(req, token) || req.selection !== 'current-room-epoch') { finish(req, token); return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, req.epoch, req.owner.accountId); }
      let bytes: Uint8Array | null = null;
      try {
        if (!req.passwordRef || kdfBusy) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, req.epoch, req.owner.accountId);
        kdfBusy = true;
        const result = await deps.exportPortableBackup({ context: context(req), conversationId: req.conversationId, epoch: req.epoch,
          ...(req.commitHashHex ? { commitHashHex: req.commitHashHex } : {}), passwordRef: req.passwordRef });
        kdfBusy = false;
        if (!active(req, token)) { if (result.kind === 'encrypted') result.bytes.fill(0); return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, req.epoch, req.owner.accountId); }
        if (result.kind !== 'encrypted') return makeStatus(req, 'blocked', result.reason, req.conversationId, req.epoch, req.owner.accountId);
        bytes = result.bytes;
        const saved = await deps.writePrivateBackupSelection(req.outputRef, bytes, context(req));
        if (!active(req, token)) return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, req.epoch, req.owner.accountId);
        return { ...makeStatus(req, saved ? 'ready' : 'failed', saved ? null : 'backup-invalid', req.conversationId, req.epoch, req.owner.accountId), backupOutcome: saved ? 'encrypted-export' : 'none' };
      } catch { kdfBusy = false; return makeStatus(req, 'failed', 'backup-invalid', req.conversationId, req.epoch, req.owner.accountId); }
      finally { bytes?.fill(0); finish(req, token); }
    },
    async importBackup(req: PrivateImportIntent): Promise<RecoveryStatus> {
      const token = start(req); if (token === null) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, null, req.owner.accountId);
      if (!localActive(req, token)) { finish(req, token); return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, null, req.owner.accountId); }
      try {
        if (kdfBusy) return makeStatus(req, 'blocked', 'operation-unavailable', req.conversationId, null, req.owner.accountId);
        kdfBusy = true;
        const result = await deps.previewPortableBackup({ context: context(req), conversationId: req.conversationId,
          inputRef: req.inputRef, passwordRef: req.passwordRef, configuredNetworkId: req.configuredNetworkId ?? String(req.owner.networkId) });
        kdfBusy = false;
        if (!localActive(req, token)) return makeStatus(req, 'blocked', 'stale-owner', req.conversationId, null, req.owner.accountId);
        return result.kind === 'preview'
          ? { ...makeStatus(req, 'ready', null, req.conversationId, result.preview.epoch, req.owner.accountId), preview: result.preview, backupOutcome: 'preview' }
          : makeStatus(req, 'blocked', result.reason, req.conversationId, null, req.owner.accountId);
      } catch { kdfBusy = false; return makeStatus(req, 'failed', 'backup-invalid', req.conversationId, null, req.owner.accountId); }
      finally { finish(req, token); }
    },
    async approveBackup(req: RequestContext & { previewRef: string; confirmHistoryOnly: true; confirmFingerprint: string }): Promise<RecoveryStatus> {
      const token = start(req); if (token === null) return makeStatus(req, 'blocked', 'operation-unavailable', null, null, req.owner.accountId);
      try {
        const result = await deps.approvePortableBackup({ context: context(req), previewRef: req.previewRef,
          confirmHistoryOnly: req.confirmHistoryOnly, confirmFingerprint: req.confirmFingerprint });
        if (!localActive(req, token)) return makeStatus(req, 'blocked', 'stale-owner', null, null, req.owner.accountId);
        return result.kind === 'installed-history-only'
          ? { ...makeStatus(req, 'ready', null, result.conversationId, result.epoch, req.owner.accountId), backupOutcome: 'installed-history-only' }
          : makeStatus(req, 'blocked', result.reason, null, null, req.owner.accountId);
      } catch { return makeStatus(req, 'failed', 'backup-invalid', null, null, req.owner.accountId); }
      finally { finish(req, token); }
    },
    cancelBackup(req: RequestContext & { previewRef: string }): void { deps.cancelPortableBackup({ context: context(req), previewRef: req.previewRef }); },
    retireOwner(owner: OwnerSnapshot): void {
      for (const [id, job] of jobs) if (ownerEqual(job.owner, owner)) {
        job.controller.abort(); jobs.delete(id);
      }
    },
    dispose(): void { disposed = true; generation += 1; for (const job of jobs.values()) job.controller.abort(); jobs.clear(); },
  };
}
