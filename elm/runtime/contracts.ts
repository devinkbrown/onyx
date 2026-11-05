import type { PasskeyView } from './private-passkey-management';
import type { RecoveryOutcome, RecoveryReason, RecoveryStatus } from './session-recovery-controller';
import type { SessionInventoryView, SessionRevocationView } from './session-mesh-control';
import type { CommunityView } from './account-community-service';
import type { IntegrationView } from './integration-operations';
import type { MediaControlSnapshot } from './media-control-types';

const utf8Encoder = new TextEncoder();

/** Shared Elm/browser-runtime boundary. Brand casts and runtime validation are
 * confined to this module; domain services import these public types. */
declare const networkBrand: unique symbol;
declare const endpointBrand: unique symbol;
declare const accountBrand: unique symbol;
declare const conversationBrand: unique symbol;
declare const messageBrand: unique symbol;
declare const groupBrand: unique symbol;
declare const attachmentBrand: unique symbol;
declare const localPhysicalEpochBrand: unique symbol;
declare const localDropBrand: unique symbol;
declare const requestBrand: unique symbol;
declare const connectionGenerationBrand: unique symbol;
declare const accountGenerationBrand: unique symbol;
declare const ownerBrand: unique symbol;
declare const credentialRefBrand: unique symbol;
declare const credentialHandleBrand: unique symbol;

export type NetworkId = string & { readonly [networkBrand]: true };
export type EndpointId = string & { readonly [endpointBrand]: true };
export type AccountId = string & { readonly [accountBrand]: true };
export type ConversationId = string & { readonly [conversationBrand]: true };
export type MessageId = string & { readonly [messageBrand]: true };
export type LogicalGroupId = string & { readonly [groupBrand]: true };
export type AttachmentId = string & { readonly [attachmentBrand]: true };
/** Browser-local socket attachment epoch; never a server AID or drop selector. */
export type LocalPhysicalEpoch = string & { readonly [localPhysicalEpochBrand]: true };
export type LocalDropSid = string & { readonly [localDropBrand]: true };
export type RequestId = string & { readonly [requestBrand]: true };
export type ConnectionGeneration = number & { readonly [connectionGenerationBrand]: true };
export type AccountGeneration = number & { readonly [accountGenerationBrand]: true };
export type OwnerRef = string & { readonly [ownerBrand]: true };
/** Public opaque reference, not a bearer or index that can retrieve one directly. */
export type CredentialRef = string & { readonly [credentialRefBrand]: true };
/** Private worker-only capability. Never serialized, rendered, or passed to Elm. */
export type CredentialHandle = symbol & { readonly [credentialHandleBrand]: true };
declare const unsignedDecimalBrand: unique symbol;
declare const nodeIdBrand: unique symbol;
declare const wireTimestampBrand: unique symbol;
declare const readMarkerTimestampBrand: unique symbol;
declare const historyTimestampBrand: unique symbol;
declare const publicLineBrand: unique symbol;
declare const epochRefBrand: unique symbol;
declare const wireBodyRefBrand: unique symbol;
declare const mediaCallRefBrand: unique symbol;
export type UnsignedDecimal = string & { readonly [unsignedDecimalBrand]: true };
export type NodeId = string & { readonly [nodeIdBrand]: true };
export type WireTimestamp = string & { readonly [wireTimestampBrand]: true };
export type ReadMarkerTimestamp = string & { readonly [readMarkerTimestampBrand]: true };
export type HistoryTimestamp = string & { readonly [historyTimestampBrand]: true };
export type SanitizedPublicLine = string & { readonly [publicLineBrand]: true };
export type EpochRef = string & { readonly [epochRefBrand]: true };
/** Reference to original authenticated wire bytes held only in private runtime memory. */
export type OpaqueWireBodyRef = symbol & { readonly [wireBodyRefBrand]: true };
export type MediaCallRef = string & { readonly [mediaCallRefBrand]: true };
export type PersistableReplyContext = { readonly id: string; readonly from: string; readonly text: string | null };
export type PersistableRow = Readonly<Record<string, string | number | boolean | null | PersistableReplyContext>>;
export type PersistenceReason = 'owner-unproven' | 'policy-unknown' | 'encryption-required' | 'missing-wire-body' | 'invalid-envelope' | 'stale-owner';
export type PersistenceProjection =
  | { readonly kind: 'persistable'; readonly row: PersistableRow; readonly policyRevision: string }
  | { readonly kind: 'blocked'; readonly reason: PersistenceReason };
export function makeOpaqueWireBodyRef(): OpaqueWireBodyRef { return Symbol('wire-body') as OpaqueWireBodyRef }

export interface OwnerSnapshot {
  readonly networkId: NetworkId;
  readonly accountId: AccountId | null;
  readonly accountGeneration: AccountGeneration;
  readonly connectionGeneration: ConnectionGeneration;
  readonly physicalRef: LocalPhysicalEpoch | null;
  readonly ownerRef: OwnerRef;
}
export interface RequestContext {
  readonly schemaVersion: 1;
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
}

/** Versioned, allowlisted UI-to-runtime commands. The domain/action pair is
 * decoded by the composition root; payloads never accept arbitrary wire lines
 * or secret material. Opaque refs resolve only in their owning service. */
type DomainPayloads = {
  'session.new-attachment': Record<string, never>;
  'session.resume': { readonly credentialRef: CredentialRef; readonly acceptLegacyNewAttachment?: true };
  'session.retry': { readonly credentialRef: CredentialRef; readonly acceptLegacyNewAttachment?: true };
  'session.forget': { readonly credentialRef: CredentialRef };
  'session.remember': { readonly enabled: boolean };
  'session.local-list': Record<string, never>;
  'session.local-drop': { readonly rowRef: string; readonly confirm: true };
  'session.mesh-list': Record<string, never>;
  'session.mesh-next': { readonly scanRef: string };
  'session.mesh-revoke': { readonly groupRef: string; readonly confirm: true };
  'session.mesh-reconcile': { readonly revokeRef: string };
  'session.mesh-dismiss': { readonly revokeRef: string };
  'account-community.autojoin-list': Record<string, never>;
  'account-community.autojoin-add': { readonly channel: string };
  'account-community.autojoin-remove': { readonly channel: string; readonly confirm: true };
  'account-community.group-list': Record<string, never>;
  'account-community.group-add': { readonly nick: string };
  'account-community.group-remove': { readonly nick: string; readonly confirm: true };
  'account-community.group-primary': { readonly nick: string; readonly confirm: true };
  'account-security.begin': { readonly action: 'totp-status' | 'totp-enroll' | 'totp-disable' | 'totp-confirm' | 'recovery-status' | 'recovery-generate' | 'recovery-clear' | 'recovery-login' | 'account-email' | 'account-password' | 'account-certificate-reset' | 'account-drop' | 'password-reset-request' | 'password-reset-confirm' | 'account-register' | 'account-verify'; readonly formRef?: string; readonly account?: string; readonly confirm?: true };
  'account-security.present': { readonly presentationRef: string; readonly action: 'present' | 'copy' | 'dismiss'; readonly selection?: 'secret' | 'uri' | 'codes' };
  'account-security.passkey-list': Record<string, never>;
  'account-security.passkey-rename': { readonly credentialRef: CredentialRef; readonly label: string };
  'account-security.passkey-remove': { readonly credentialRef: CredentialRef; readonly confirm: true };
  'webauthn.begin': { readonly ceremony: 'register' | 'authenticate'; readonly account: AccountId | null };
  'webauthn.cancel': { readonly ceremonyRef: string };
  'continuation.list': Record<string, never>;
  'continuation.remember': { readonly continuationRef: string; readonly enabled: boolean };
  'continuation.forget': { readonly continuationRef: string };
  'continuation.select': { readonly continuationRef: string; readonly confirm: true };
  'continuation.use': { readonly continuationRef: string };
  'workspace.select': { readonly workspaceRef: string };
  'workspace.list': Record<string, never>;
  'workspace.remember': { readonly enabled: boolean; readonly confirm: true };
  'workspace.lock': Record<string, never>;
  'draft.load': { readonly conversationId: ConversationId };
  'draft.save': { readonly conversationId: ConversationId; readonly text: string; readonly revision: number };
  'draft.discard': { readonly conversationId: ConversationId; readonly revision: number };
  'draft.recover': { readonly draftRef: string };
  'draft.recovery-list': Record<string, never>;
  'journal.queue': { readonly clientIntentId: RequestId; readonly conversationId: ConversationId; readonly intent: 'chat' | 'memo'; readonly text: string; readonly replyTo: string | null; readonly messageKind?: 'message' | 'action'; readonly audiencePrefix?: string | null };
  'journal.list': Record<string, never>;
  'journal.retry': { readonly entryRef: string; readonly confirmDuplicateRisk: boolean };
  'journal.cancel': { readonly entryRef: string };
  'journal.reconcile': { readonly entryRef: string };
  'scheduled.create': { readonly inputRef: string; readonly operationId: string; readonly clientIntentId: RequestId; readonly conversationId: ConversationId; readonly dueAtMs: number; readonly messageKind: 'message' | 'action'; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null };
  'scheduled.edit': { readonly inputRef: string; readonly scheduleRef: string; readonly expectedRevision: number; readonly dueAtMs: number; readonly messageKind: 'message' | 'action'; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null };
  'scheduled.list': Record<string, never>;
  'scheduled.cancel': { readonly scheduleRef: string; readonly expectedRevision: number };
  'scheduled.dispatch': { readonly scheduleRef: string; readonly expectedRevision: number };
  'scheduled.reconcile': { readonly scheduleRef: string; readonly expectedRevision: number };
  'anchor.viewed': { readonly conversationId: ConversationId; readonly messageId: string | null; readonly timestamp: string | null };
  'anchor.load': { readonly conversationId: ConversationId };
  'settings.preview': { readonly inputRef: string };
  'settings.apply': { readonly previewRef: string; readonly enabledOptIns: readonly string[] };
  'settings.export': { readonly outputRef: string };
  'storage.export': { readonly selectionRef: string; readonly outputRef: string };
  'storage.clear': { readonly selectionRef: string; readonly confirm: true };
  'eviction.preview': { readonly conversationIds: readonly ConversationId[] };
  'eviction.apply': { readonly planRef: string; readonly confirm: true };
  'group.directory-refresh': { readonly conversationId: ConversationId };
  'group.trust-preview': { readonly conversationId: ConversationId; readonly accountId: AccountId; readonly deviceId: string };
  'group.trust-confirm': { readonly previewRef: string; readonly confirm: true };
  'group.author-plan': { readonly conversationId: ConversationId; readonly expectedEpoch: number; readonly expectedCommitHash: string; readonly excludeDevice: { readonly accountId: AccountId; readonly deviceId: string } | null };
  'group.author-commit': { readonly planRef: string; readonly confirmMembershipRevision: string; readonly confirmBackupEnabled: true };
  'group.enroll': { readonly conversationId: ConversationId; readonly confirm: true };
  'group.welcome-request': { readonly conversationId: ConversationId; readonly expectedEpoch: number; readonly expectedCommitHash: string };
  'group.remove-device': { readonly conversationId: ConversationId; readonly accountId: AccountId; readonly deviceId: string; readonly expectedEpoch: number; readonly expectedCommitHash: string; readonly confirm: true };
  'group.backup-export': { readonly conversationId: ConversationId; readonly epoch: number; readonly commitHashHex: string; readonly outputRef: string; readonly passwordRef: string };
  'group.backup-import': { readonly conversationId: ConversationId; readonly inputRef: string; readonly passwordRef: string; readonly configuredNetworkId: NetworkId };
  'group.backup-approve': { readonly previewRef: string; readonly confirmHistoryOnly: true; readonly confirmFingerprint: string };
  'group.backup-cancel': { readonly previewRef: string };
  'group.cancel': { readonly operationRef: string };
  'group.bootstrap-preview': { readonly conversationId: ConversationId };
  'group.bootstrap-approve': { readonly previewRef: string; readonly confirm: true };
  'group.bootstrap-cancel': { readonly previewRef: string };
  'media.inspect': Record<string, never>;
  'media.roster-refresh': { readonly conversationId: ConversationId; readonly callRef: MediaCallRef };
  'media.devices-refresh': Record<string, never>;
  'media.soundcheck': { readonly captureRef: string; readonly durationMs: number };
  'media.join': { readonly conversationId: ConversationId; readonly kind: 'voice' | 'video'; readonly captureRef: string };
  'media.leave': { readonly conversationId: string | null };
  'media.input': { readonly deviceRef: string | null; readonly conversationId: ConversationId | null; readonly callRef: MediaCallRef | null; readonly captureRef: string | null };
  'media.output': { readonly deviceRef: string | null; readonly volumePercent: number };
  'media.mute': { readonly muted: boolean };
  'media.deafen': { readonly deafened: boolean };
  'media.camera-preview': { readonly conversationId: ConversationId; readonly captureRef: string };
  'media.preview-attach': { readonly previewRef: string; readonly elementRef: string };
  'media.preview-retire': { readonly previewRef: string };
  'media.camera-publish': { readonly conversationId: ConversationId; readonly previewRef: string };
  'media.screen-start': { readonly conversationId: ConversationId; readonly captureRef: string };
  'media.screen-stop': { readonly conversationId: ConversationId };
  'media.consent': { readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly consent: 'granted' | 'denied'; readonly policyRevision: string | null };
  'media.record': { readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly action: 'start' | 'stop'; readonly consentRevision: string | null };
  'media.caption-prepare': { readonly conversationId: ConversationId; readonly callRef: string; readonly language: string };
  'media.caption-start': { readonly conversationId: ConversationId; readonly callRef: string; readonly language: string; readonly mode: 'local' | 'browser-service'; readonly browserServiceConsent: boolean };
  'media.caption-stop': { readonly conversationId: ConversationId; readonly callRef: string };
  'media.quality': { readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly policy: 'auto' | 'balanced' | 'audio-priority' };
  'media.audio-recover': { readonly conversationId: ConversationId; readonly callRef: MediaCallRef };
  'media.webrtc-run': { readonly captureRef: string; readonly kind: 'voice' | 'video' };
  'media.webrtc-stop': { readonly experimentRef: string };
  'media.fingerprint-compare': { readonly experimentRef: string; readonly comparisonRef: string };
  'platform.worker-register': Record<string, never>;
  'platform.worker-activate': { readonly targetRef: string; readonly confirm: true };
  'platform.worker-cancel': { readonly activationRef: string };
  'platform.push-inspect': Record<string, never>;
  'platform.push-enable': { readonly consentRef: string };
  'platform.push-disable': { readonly confirm: true };
  'platform.push-reconcile': Record<string, never>;
  'platform.notification-route': { readonly routeRef: string };
  'tab-intent.fresh': { readonly confirm: true };
  'tab-intent.list': Record<string, never>;
  'tab-intent.restore': { readonly intentRef: string; readonly confirm: true };
  'tab-intent.retire': { readonly intentRef: string; readonly confirm: true };
  'operator-import.preview': { readonly inputRef: string };
  'operator-import.get': { readonly previewRef: string };
  'operator-import.dismiss': { readonly previewRef: string };
  'integration.reconnect-media': { readonly confirm: true };
  'integration.webtransport-connect': { readonly endpointRef: string; readonly confirm: true };
  'integration.webtransport-fallback': { readonly attemptRef: string; readonly confirm: true };
  'service-integration.refresh': { readonly feature: import('./integration-operations').IntegrationFeature };
  'service-integration.botgrant-list': { readonly account?: string };
  'service-integration.botgrant-add': { readonly account: string; readonly grant: 'speak' | 'webhook' | 'history'; readonly channel: string; readonly ttlSeconds: number };
  'service-integration.botgrant-remove': { readonly account: string; readonly grant: 'speak' | 'webhook' | 'history'; readonly channel: string; readonly confirm: true };
  'service-integration.botcmd-list': Record<string, never>;
  'service-integration.botcmd-add': { readonly name: string; readonly argc: number; readonly help: string };
  'service-integration.botcmd-run': { readonly name: string; readonly args: readonly string[] };
  'service-integration.defer-at': { readonly unixMs: number; readonly channel: string; readonly text: string };
  'service-integration.defer-cron': { readonly minute: string; readonly hour: string; readonly dayOfMonth: string; readonly month: string; readonly dayOfWeek: string; readonly channel: string; readonly text: string };
  'service-integration.defer-oper-at': { readonly unixMs: number; readonly channel: string; readonly mode: string };
  'service-integration.defer-oper-cron': { readonly minute: string; readonly hour: string; readonly dayOfMonth: string; readonly month: string; readonly dayOfWeek: string; readonly channel: string; readonly mode: string };
  'service-integration.outhook-input': Record<string, never>;
  'service-integration.outhook-add': { readonly inputRef: string };
  'service-integration.outhook-list': Record<string, never>;
  'service-integration.outhook-inspect': { readonly urlRef: string };
  'service-integration.outhook-remove': { readonly urlRef: string; readonly confirm: true };
  'service-integration.unfurl-off': Record<string, never>;
  'service-integration.unfurl-on': Record<string, never>;
  'service-integration.unfurl-preview': { readonly url: string };
  'service-integration.memo-send': { readonly account: string; readonly text: string };
  'service-integration.memo-list': Record<string, never>;
  'service-integration.memo-clear': { readonly confirm: true };
  'service-integration.memo-forward': { readonly account: string | null };
  'service-integration.memo-ignore-list': Record<string, never>;
  'service-integration.memo-ignore-add': { readonly account: string };
  'service-integration.memo-ignore-remove': { readonly account: string; readonly confirm: true };
};
export type RuntimeDomainCommand = {
  [K in keyof DomainPayloads]: {
    readonly schemaVersion: 1;
    readonly requestId: RequestId;
    readonly ownerRef: OwnerRef;
    readonly accountGeneration: AccountGeneration;
    readonly connectionGeneration: ConnectionGeneration;
    readonly domain: K extends `${infer D}.${string}` ? D : never;
    readonly action: K extends `${string}.${infer A}` ? A : never;
    readonly payload: DomainPayloads[K];
  }
}[keyof DomainPayloads];
export type RuntimeDomainStatus = 'pending' | 'held' | 'transport-admitted' | 'accepted' | 'unknown' | 'blocked' | 'failed' | 'cancelled';
export type RuntimeDomainResult = {
  readonly schemaVersion: 1;
  readonly requestId: RequestId;
  readonly ownerRef: string;
  readonly accountGeneration: number;
  readonly connectionGeneration: number;
  readonly domain: string;
  readonly action: string;
  readonly status: RuntimeDomainStatus;
  readonly completionScope: 'local' | 'transport' | 'server';
  readonly reason: string | null;
  readonly view: DomainView | null;
};
export type RuntimeDomainObservation = {
  readonly schemaVersion: 1;
  readonly ownerRef: string;
  readonly accountGeneration: number;
  readonly connectionGeneration: number;
  readonly domain: string;
  readonly sequence: number;
  readonly view: DomainView;
};
export type PublicMediaSnapshot = Omit<MediaControlSnapshot, 'owner' | 'caption' | 'webRtc'> & {
  readonly caption: Omit<NonNullable<MediaControlSnapshot['caption']>, 'owner'> | null;
  readonly webRtc: Omit<NonNullable<MediaControlSnapshot['webRtc']>, 'owner'> | null;
};
export type DomainView =
  | { readonly kind: 'session'; readonly credentials: readonly CredentialMetadata[]; readonly issuance: 'idle' | 'pending' | 'unknown'; readonly remembered: boolean }
  | SessionInventoryView
  | SessionRevocationView
  | { readonly kind: 'session-recovery'; readonly requestId: RequestId; readonly credentialRef: CredentialRef; readonly status: RecoveryStatus; readonly outcome: RecoveryOutcome | null; readonly reason: RecoveryReason | null; readonly redirectNode: string | null; readonly hopCount: number; readonly transferFrom: { readonly ownerRef: OwnerRef; readonly accountGeneration: AccountGeneration; readonly connectionGeneration: ConnectionGeneration } | null }
  | CommunityView
  | { readonly kind: 'draft-recovery'; readonly requestId: RequestId; readonly status: 'ready' | 'pending' | 'unavailable' | 'stale' | 'invalid'; readonly items: readonly { readonly draftRef: string; readonly conversationId: ConversationId; readonly revision: number; readonly updatedAtMs: number; readonly ciphertextBytes: number }[]; readonly truncated: boolean; readonly recovered: { readonly draftRef: string; readonly conversationId: ConversationId; readonly revision: number; readonly text: string } | null; readonly reason: 'workspace-unavailable' | 'owner-changed' | 'selection-expired' | 'revision-changed' | 'storage-unavailable' | 'invalid-ciphertext' | null }
  | { readonly kind: 'passkey-management'; readonly requestId: RequestId; readonly status: PasskeyView['status']; readonly operation: PasskeyView['operation']; readonly rows: PasskeyView['rows']; readonly reason: PasskeyView['reason'] }
  | { readonly kind: 'account-security'; readonly schemaVersion: 1; readonly requestId: RequestId; readonly operationRef: string; readonly ownerRef: OwnerRef; readonly accountGeneration: AccountGeneration; readonly connectionGeneration: ConnectionGeneration; readonly action: 'totp-status' | 'totp-enroll' | 'totp-disable' | 'totp-confirm' | 'recovery-status' | 'recovery-generate' | 'recovery-clear' | 'recovery-login' | 'account-email' | 'account-password' | 'account-certificate-reset' | 'account-drop' | 'password-reset-request' | 'password-reset-confirm' | 'account-register' | 'account-verify' | 'present' | 'copy' | 'dismiss'; readonly phase: 'pending' | 'accepted' | 'unknown' | 'blocked' | 'failed' | 'dismissed'; readonly reason: string | null; readonly totpState: 'unknown' | 'disabled' | 'pending' | 'active'; readonly remainingCodes: number | null; readonly presentationRef: string | null; readonly accountOutcome: 'none' | 'email-updated' | 'password-changed' | 'certificate-password-reset' | 'account-dropped' | 'reset-request-acknowledged' | 'password-reset' | 'account-registered' | 'email-verified' | 'no-pending-verification'; readonly targetAccount: string | null; readonly requiresLogin: boolean }
  | { readonly kind: 'webauthn'; readonly requestId: RequestId; readonly ceremonyRef: string | null; readonly ceremony: 'register' | 'authenticate'; readonly phase: 'pending' | 'transport-admitted' | 'blocked' | 'unknown'; readonly reason: 'invalid-ceremony' | 'stale-owner' | 'unsupported' | 'cancelled' | 'rp-mismatch' | 'invalid-response' | 'transport-blocked' | 'transport-unknown' | null }
  | { readonly kind: 'continuation'; readonly items: readonly ContinuationMetadata[]; readonly selectedContinuationRef: string | null }
  | { readonly kind: 'workspace'; readonly items: readonly WorkspaceMetadata[]; readonly selectedWorkspaceRef: string | null }
  | { readonly kind: 'settings'; readonly preview: SettingsPreviewView | null }
  | { readonly kind: 'storage'; readonly draft: DraftPublicView | null; readonly rows: readonly PublicMessageRow[]; readonly items: readonly StorageItemMetadata[]; readonly plan: StoragePlanView | null }
  | { readonly kind: 'journal'; readonly entries: readonly JournalPublicEntry[]; readonly entryRef: string | null }
  | { readonly kind: 'scheduled'; readonly items: readonly ScheduledSummary[]; readonly mode: 'durable' | 'volatile'; readonly legacyHeldCount: number; readonly legacyReviewUnavailable: boolean }
  | { readonly kind: 'anchor'; readonly conversationId: ConversationId; readonly acceptedTimestamp: ReadMarkerTimestamp | null; readonly viewedCandidate: ReadMarkerTimestamp | null }
  | { readonly kind: 'group'; readonly phase: string; readonly conversationId: string | null; readonly epoch: number | null; readonly currentCommitHashHex: string | null; readonly plan: PublicGroupPlan | null; readonly devices: readonly PublicDeviceMetadata[]; readonly operationRef: string | null; readonly historyOnly: boolean; readonly bootstrap: PublicGroupBootstrapPreview | null; readonly backupPreview: PublicPortableBackupPreview | null; readonly backupOutcome: 'none' | 'preview' | 'encrypted-export' | 'installed-history-only' }
  | { readonly kind: 'platform'; readonly worker: WorkerView | null; readonly push: PushView | null }
  | (PublicMediaSnapshot & { readonly kind: 'media'; readonly state: 'idle' | 'preparing' | 'ready' | 'in-call' | 'degraded' | 'failed'; readonly previewRef: string | null; readonly screenRef: string | null; readonly experimentRef: string | null; readonly experiment: WebRtcView | null })
  | { readonly kind: 'media-quality'; readonly requestId: RequestId; readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly desiredPolicy: 'auto' | 'balanced' | 'audio-priority'; readonly observedNetworkTier: 0 | 1 | 2 | 3 | null; readonly observedAudioQuality: 0 | 1 | 2 | null; readonly videoState: 'inactive' | 'encoding' | 'audio-only' | 'unknown' }
  | { readonly kind: 'operator-import'; readonly previewRef: string | null; readonly plan: import('./operator-import').SafeOperatorPlan | null }
  | { readonly kind: 'tab-intent'; readonly intents: readonly TabIntentView[] }
  | { readonly kind: 'integration'; readonly transport: 'wss' | 'webtransport'; readonly phase: 'idle' | 'connecting' | 'ready' | 'failed' | 'unknown'; readonly attemptRef: string | null }
  | IntegrationView;
export type CredentialMetadata = { readonly credentialRef: CredentialRef; readonly credentialKind: 'local-logical' | 'local-exact' | 'mesh-logical' | 'mesh-exact' | 'unknown'; readonly issuerEndpointId: EndpointId; readonly expiresAtMs: number | null; readonly restorable: boolean; readonly remembered: boolean };
export type ContinuationMetadata = { readonly continuationRef: string; readonly networkId: NetworkId; readonly accountId: AccountId; readonly issuerEndpointId: EndpointId; readonly expiresAtMs: number; readonly remembered: boolean; readonly usable: boolean };
export type WorkspaceMetadata = { readonly workspaceRef: string; readonly networkId: NetworkId; readonly accountId: string | null; readonly remembered: boolean; readonly selected: boolean; readonly locked: boolean };
export type SettingsPreviewView = { readonly previewRef: string; readonly values: readonly { readonly key: 'theme' | 'motion' | 'language' | 'layout' | 'showTimestamps' | 'showJoinPart' | 'linkPreviews' | 'notificationPreviews'; readonly value: string | boolean | number }[]; readonly requiresOptInConfirmation: readonly ('linkPreviews' | 'notificationPreviews')[] };
export type TabIntentView = { readonly intentRef: string; readonly state: 'fresh' | 'restore-required' | 'busy' | 'retired'; readonly createdAtMs: number };
export type PublicPortableBackupPreview = { readonly previewRef: string; readonly networkId: NetworkId; readonly accountId: AccountId; readonly conversationId: ConversationId; readonly epoch: number; readonly commitHashHex: string; readonly signerAccountId: AccountId; readonly signerDeviceId: string; readonly signerFingerprintHex: string; readonly trust: 'matches-local-receipt' | 'new-history-checkpoint'; readonly historyOnly: true };
/** `text` is present only on the direct, owner-fenced draft.load result. It
 * must never appear in unsolicited observations or telemetry. */
export type DraftPublicView = { readonly conversationId: ConversationId; readonly revision: number; readonly updatedAtMs: number; readonly state: 'saved-encrypted' | 'memory-only-unsaved' | 'unavailable'; readonly text: string | null };
export type PublicMessageRow = { readonly conversationId: ConversationId; readonly messageId: MessageId | null; readonly sender: string; readonly body: string; readonly timestamp: WireTimestamp | null; readonly privacy: 'plain' | 'dm-ciphertext' | 'room-ciphertext' | 'locked' };
export type StorageItemMetadata = { readonly recordRef: string; readonly label: string; readonly state: 'legacy' | 'quarantined' | 'admitted' | 'recoverable' };
export type StoragePlanView = { readonly planRef: string; readonly selectedCount: number; readonly retainedCount: number };
export type JournalPublicEntry = { readonly entryRef: string; readonly clientIntentId: RequestId; readonly conversationId: ConversationId; readonly intent: 'chat' | 'memo'; readonly durability: 'durable' | 'volatile'; readonly state: 'queued' | 'held' | 'dispatching' | 'transport-admitted' | 'server-accepted' | 'delivery-unknown' | 'review-required' | 'cancelled'; readonly createdAtMs: number };
export type ScheduledSummary = { readonly scheduleRef: string; readonly operationId: string | null; readonly clientIntentId: RequestId | null; readonly conversationId: ConversationId | null; readonly dueAtMs: number | null; readonly messageKind: 'message' | 'action' | null; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null; readonly revision: number | null; readonly mode: 'durable' | 'volatile'; readonly state: 'scheduled' | 'dispatching' | 'delivery-unknown' | 'legacy-review' | 'policy-review' };
export type PublicGroupPlan = { readonly planRef: string; readonly conversationId: ConversationId; readonly priorEpoch: number; readonly nextEpoch: number; readonly membershipRevision: string; readonly recipientCount: number; readonly backupRequired: boolean };
export type PublicGroupBootstrapPreview = { readonly previewRef: string; readonly epoch: number; readonly commitHashHex: string; readonly signerAccountId: AccountId; readonly signerDeviceId: string; readonly signerFingerprint: string; readonly recipientDeviceId: string; readonly historyVerified: false };
export type PublicDeviceMetadata = { readonly accountId: AccountId | null; readonly deviceId: string; readonly trusted: 'trusted' | 'untrusted' | 'unknown'; readonly current: boolean };
export type WorkerView = { readonly status: import('./worker-lifecycle').WorkerStatusKind; readonly reason: import('./worker-lifecycle').WorkerReason; readonly pendingClientCount: number; readonly buildId: string; readonly targetRef: string | null; readonly activationRef: string | null };
export type PushView = { readonly state: string | null; readonly permission: NotificationPermission | 'unsupported'; readonly browserSubscription: 'none' | 'present' | 'unknown'; readonly serverRegistration: 'none' | 'pending' | 'registered' | 'removal-pending' | 'unknown' | 'failed'; readonly delivery: 'unobserved' | 'observed'; readonly boundNode: EndpointId | null; readonly consentRef: string | null };
export type WebRtcView = { readonly phase: string; readonly audioCodec: string | null; readonly videoCodec: string | null; readonly iceState: string; readonly dtlsState: string; readonly transportClass: string };
export type CaptionView = { readonly state: 'idle' | 'preparing' | 'ready' | 'listening' | 'unavailable' | 'failed'; readonly mode: 'local' | 'browser-service' | null; readonly language: string | null; readonly serverVisible: true };
export interface RuntimeEventEnvelope<TPayload = unknown> extends RequestContext {
  readonly payload: TPayload;
}
export interface AuthenticatedServerEvent {
  readonly line: string;
  readonly networkId: NetworkId;
  readonly accountId: AccountId | null;
  /** Identifies IRC source provenance, never local account login state. */
  readonly authentication: 'server';
  readonly connectionGeneration: ConnectionGeneration;
  readonly accountGeneration: AccountGeneration;
  readonly serverEndpointId: EndpointId;
}
/** Private parser/authority ingress after credential and key interception but
 * before the line is projected to Elm. It may include source-authenticated
 * peer events; `sourceKind` does not imply account identity or trust. */
export interface PrivateIngressEvent {
  readonly line: string;
  readonly owner: OwnerSnapshot;
  readonly sourceKind: 'server' | 'user' | 'prefixless-protocol';
}

/** Explicit serialization allowlist. Private credential/key/MAC material and
 * arbitrary URLs cannot be represented by this union. */
export type PublicRuntimeEvent =
  | RuntimeEventEnvelope<{ readonly kind: 'server-line'; readonly line: SanitizedPublicLine }>
  | RuntimeEventEnvelope<{ readonly kind: 'connection-state'; readonly state: 'offline' | 'connecting' | 'live' }>
  | RuntimeEventEnvelope<{ readonly kind: 'account-proof'; readonly accountId: AccountId; readonly proven: boolean }>
  | RuntimeEventEnvelope<{ readonly kind: 'feature-readiness'; readonly roundRef: RequestId; readonly ownerRef: OwnerRef; readonly accountGeneration: AccountGeneration; readonly connectionGeneration: ConnectionGeneration; readonly e2ee: boolean; readonly media: boolean; readonly newCapabilities: readonly string[] }>
  | RuntimeEventEnvelope<{ readonly kind: 'credential-state'; readonly credentialRef: CredentialRef; readonly credentialKind: 'local-logical' | 'local-exact' | 'mesh-logical' | 'mesh-exact' | 'unknown'; readonly issuerEndpointId: EndpointId; readonly expiresAtMs: number | null; readonly restorable: boolean; readonly remembered: boolean }>
  | RuntimeEventEnvelope<{ readonly kind: 'worker-state'; readonly state: 'unsupported' | 'unregistered' | 'installing' | 'waiting' | 'blocked-by-clients' | 'activating' | 'ready' | 'failed'; readonly reason: 'api-unavailable' | 'registration-failed' | 'version-mismatch' | 'client-not-ready' | 'activation-failed' | 'stale-owner' | 'unknown-clients' | null; readonly pendingClientCount: number; readonly buildId: string }>
  | RuntimeEventEnvelope<{ readonly kind: 'push-state'; readonly state: 'unsupported' | 'guest' | 'offline' | 'permission-denied' | 'subscription-failed' | 'binding-failed' | 'server-rejected' | 'timeout-unknown' | 'node-changed' | 'stale-owner' | 'storage-unavailable' | null; readonly permission: NotificationPermission | 'unsupported'; readonly browserSubscription: 'none' | 'present' | 'unknown'; readonly serverRegistration: 'none' | 'pending' | 'registered' | 'removal-pending' | 'unknown' | 'failed'; readonly delivery: 'unobserved' | 'observed'; readonly boundNode: EndpointId | null }>
  | RuntimeEventEnvelope<{ readonly kind: 'metric-snapshot'; readonly contextRef: string; readonly sampledAtMonotonicMs: number; readonly metrics: readonly { readonly name: string; readonly value: number | null; readonly unit: string; readonly sampleCount: number; readonly availability: 'observed' | 'unavailable'; readonly reason: string | null }[] }>
  | RuntimeEventEnvelope<{ readonly kind: 'storage-state'; readonly state: 'ready' | 'unavailable' | 'blocked-upgrade' | 'stale-owner' | 'quota' | 'invalid'; readonly pendingQuarantine: number }>
  | RuntimeEventEnvelope<{ readonly kind: 'notification-route'; readonly routeRef: string; readonly opened: boolean }>
  | RuntimeEventEnvelope<{ readonly kind: 'browser-lifecycle'; readonly state: 'visible' | 'hidden' | 'frozen' | 'resumed' | 'storage-lost' }>
  | RuntimeEventEnvelope<{ readonly kind: 'runtime-error'; readonly code: RuntimeErrorCode }>;

export type RuntimeErrorCode = 'unsupported' | 'permission-denied' | 'storage-unavailable' | 'quota-exceeded' | 'invalid-response' | 'stale-owner' | 'timeout' | 'network-failed' | 'internal-failure';

export interface ValidatedLineIntent {
  /** One IRC command, no CR/LF, validated against the current socket owner. */
  readonly line: string;
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
}
export type SendAdmission =
  | { readonly kind: 'transport-admitted' }
  | { readonly kind: 'blocked'; readonly reason: 'owner-changed' | 'offline' | 'backpressure' | 'policy' | 'invalid-intent' }
  | { readonly kind: 'unknown'; readonly reason: 'transport-error' };
export type ConversationKeyScheme = { readonly name: 'ascii' | 'rfc1459' | 'strict-rfc1459'; readonly revision: string };
export type PolicySnapshot = {
  readonly owner: OwnerSnapshot;
  readonly policyGeneration: number;
  readonly channelMembership: 'joined' | 'not-joined' | 'unknown';
  readonly encryption: 'plain' | 'dm-required' | 'room-required' | 'unknown';
  readonly epochRef: EpochRef | null;
  readonly canSend: boolean | 'unknown';
  readonly networkReady: boolean;
};
export interface BinaryIntent {
  readonly bytes: Uint8Array;
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
}
/** A journal-owned ordered IRC message group (for example one negotiated
 * multiline BATCH). The transport admits it synchronously so unrelated
 * sends cannot interleave between its lines. Partial admission is still an
 * unknown delivery outcome and must never be replayed automatically. */
export interface ValidatedLineGroupIntent {
  readonly lines: readonly string[];
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
}
export interface RuntimeSubscription { dispose(): void }
export interface Transport {
  ownerSnapshot(): OwnerSnapshot;
  isCurrent(snapshot: OwnerSnapshot): boolean;
  sendLine(intent: ValidatedLineIntent): SendAdmission;
  sendLineGroup(intent: ValidatedLineGroupIntent): readonly SendAdmission[];
  sendBinary(intent: BinaryIntent): SendAdmission;
  /** Private authenticated stream. Credential-bearing NOTICE and MACKEY
   * records must be consumed before any event reaches Elm. */
  onAuthenticatedServerEvent(listener: (event: AuthenticatedServerEvent) => void): RuntimeSubscription;
  /** Return true only when a private owner consumed the line and it must not
   * be projected to Elm. A source label alone never authorizes effects. */
  onPrivateIngress(listener: (event: RuntimeEventEnvelope<PrivateIngressEvent>) => boolean | void): RuntimeSubscription;
  onBinary(listener: (event: RuntimeEventEnvelope<Uint8Array>) => void): RuntimeSubscription;
  dispose(): void;
}
export interface PrivateIdentity {
  proveAccount(input: { readonly owner: OwnerSnapshot; readonly method: 'sasl-session-token' | 'sasl-external' | 'passkey' | 'certificate'; readonly requestId: RequestId; readonly challenge: Uint8Array }): Promise<Uint8Array | null>;
  encryptForConversation(input: { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly requestId: RequestId; readonly plaintext: Uint8Array }): Promise<Uint8Array | null>;
  verifyServerProof(input: { readonly owner: OwnerSnapshot; readonly endpointId: EndpointId; readonly proof: Uint8Array }): Promise<boolean>;
  signGroupControl(input: { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly requestId: RequestId; readonly canonicalControl: Uint8Array }): Promise<Uint8Array | null>;
  signMediaHandshake(input: { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly requestId: RequestId; readonly callRef: MediaCallRef; readonly canonicalHandshake: Uint8Array }): Promise<Uint8Array | null>;
  signMediaFrame(input: { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly requestId: RequestId; readonly callRef: MediaCallRef; readonly frame: Uint8Array }): Promise<Uint8Array | null>;
  getMediaPublicIdentity(input: { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly requestId: RequestId; readonly callRef: MediaCallRef }): Promise<{ readonly deviceId: string; readonly ecdhPublicRaw: Uint8Array; readonly signingPublicRaw: Uint8Array; readonly directoryRevision: string } | null>;
  verifyMediaPeerBinding(input: { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly requestId: RequestId; readonly callRef: MediaCallRef; readonly peerNick: string; readonly attachmentId: Uint8Array; readonly ecdhPublicRaw: Uint8Array; readonly signingPublicRaw: Uint8Array; readonly handshakeTranscript: Uint8Array; readonly signature: Uint8Array }): Promise<{ readonly accountId: AccountId; readonly deviceId: string; readonly directoryRevision: string } | null>;
  verifyTrustedDevice(input: { readonly owner: OwnerSnapshot; readonly accountId: AccountId; readonly deviceId: string; readonly proof: Uint8Array }): Promise<boolean>;
  establishKeyAgreement(input: { readonly owner: OwnerSnapshot; readonly accountId: AccountId; readonly peerPublicKey: Uint8Array }): Promise<{ readonly publicKey: Uint8Array; readonly sharedKeyHandle: symbol } | null>;
}
export interface RuntimeFactoryContext {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (snapshot: OwnerSnapshot) => boolean;
  readonly transport: Transport;
  readonly privateIdentity: PrivateIdentity;
  readonly emit: (event: PublicRuntimeEvent) => void;
  readonly platform: PlatformDeps;
}
export interface PlatformDeps {
  readonly serviceWorker: ServiceWorkerContainer | null;
  readonly notifications: import('./push-lifecycle').PrivateNotificationAdapter;
  readonly privateStore: import('./push-lifecycle').PlatformPrivateStore;
  readonly now: () => number;
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly build: import('./worker-lifecycle').BuildCompatibility;
  readonly endpoint: () => EndpointId;
  readonly getPushConfig: () => { readonly enabled: boolean; readonly vapidPublicKey: Uint8Array | null; readonly node: EndpointId };
  readonly privateSendWebPush: (intent: import('./push-lifecycle').PrivatePushWireIntent) => SendAdmission;
}
export interface RuntimeService { dispose(): void }
export type RuntimeFactory<TService extends RuntimeService> = (context: RuntimeFactoryContext) => TService;

const CONTROL = /[\u0000-\u0020\u007f]/u;
const PRINTABLE_ASCII_ID = /^[\u0021-\u007e]+$/u;
const HEX_32 = /^[0-9a-fA-F]{32}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const BASE64URL_REF = /^[A-Za-z0-9_-]{22,128}$/;
const PRIVATE_SERVER_MATERIAL = /(?:^|\s)(?:MACKEY|SESSIONTOKEN|SESSION\s+(?:TOKEN|MTOKEN)|SASL(?:\s|$)|AUTHENTICATE|RECOVERY\s+(?:CODE|CODES)|PASSKEY\s+(?:CHALLENGE|ASSERTION)|KEYTRANS\s+(?:PROOF|CHALLENGE))(?=\s|$)/i;
function identity(value: unknown, max = 512): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return null;
  if (PRINTABLE_ASCII_ID.test(value)) return value;
  // A UTF-16 unit encodes to at most 3 bytes, so short strings skip encoding.
  return (value.length * 3 <= max || utf8Encoder.encode(value).byteLength <= max) && !CONTROL.test(value) ? value : null;
}
function brandedString<T extends string>(value: string | null): T | null { return value === null ? null : value as T }
export const makeNetworkId = (value: unknown): NetworkId | null => brandedString<NetworkId>(identity(value, 128));
export const makeEndpointId = (value: unknown): EndpointId | null => brandedString<EndpointId>(identity(value, 256));
export const makeAccountId = (value: unknown): AccountId | null => brandedString<AccountId>(identity(value, 64));
export const makeConversationId = (value: unknown): ConversationId | null => brandedString<ConversationId>(identity(value));
export const makeMessageId = (value: unknown): MessageId | null => brandedString<MessageId>(identity(value));
const nonzeroHex32 = (value: unknown): value is string => typeof value === 'string' && HEX_32.test(value) && !/^0{32}$/i.test(value);
export const makeLogicalGroupId = (value: unknown): LogicalGroupId | null => nonzeroHex32(value) ? value.toLowerCase() as LogicalGroupId : null;
export const makeAttachmentId = (value: unknown): AttachmentId | null => nonzeroHex32(value) ? value.toLowerCase() as AttachmentId : null;
export const makeLocalPhysicalEpoch = (value: unknown): LocalPhysicalEpoch | null => nonzeroHex32(value) ? value.toLowerCase() as LocalPhysicalEpoch : null;
export const makeLocalDropSid = (value: unknown): LocalDropSid | null => nonzeroHex32(value) ? value.toLowerCase() as LocalDropSid : null;
export const makeRequestId = (value: unknown): RequestId | null => typeof value === 'string' && BASE64URL_REF.test(value) ? value as RequestId : null;
export const makeOwnerRef = (value: unknown): OwnerRef | null => typeof value === 'string' && BASE64URL_REF.test(value) ? value as OwnerRef : null;
export const makeCredentialRef = (value: unknown): CredentialRef | null => typeof value === 'string' && BASE64URL_REF.test(value) ? value as CredentialRef : null;
export function makeCredentialHandle(value: symbol): CredentialHandle { return value as CredentialHandle }
/** Call only after credential-owner has consumed private ingress first. */
export function makeSanitizedPublicLine(value: unknown): SanitizedPublicLine | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 * 1024 || /[\r\n\u0000]/.test(value) || PRIVATE_SERVER_MATERIAL.test(value)) return null;
  return value as SanitizedPublicLine;
}
export const makeConnectionGeneration = (value: unknown): ConnectionGeneration | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value as ConnectionGeneration : null;
export const makeAccountGeneration = (value: unknown): AccountGeneration | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value as AccountGeneration : null;
export function makeUnsignedDecimal(value: unknown): UnsignedDecimal | null {
  if (typeof value !== 'string' || value.length > 20 || !UINT.test(value)) return null;
  if (value.length === 20 && value > '18446744073709551615') return null;
  return value as UnsignedDecimal;
}
export const makeNodeId = (value: unknown): NodeId | null => {
  const decimal = makeUnsignedDecimal(value);
  return decimal === null || decimal === '0' ? null : decimal as unknown as NodeId;
};
function validCalendarTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= (monthDays[month - 1] ?? 0)
    && hour <= 23 && minute <= 59 && second <= 59;
}
export const makeWireTimestamp = (value: unknown): WireTimestamp | null => typeof value === 'string' && value.length <= 64 && validCalendarTimestamp(value) ? value as WireTimestamp : null;
export const makeReadMarkerTimestamp = (value: unknown): ReadMarkerTimestamp | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && validCalendarTimestamp(value) ? value as ReadMarkerTimestamp : null;
export const makeHistoryTimestamp = (value: unknown): HistoryTimestamp | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !validCalendarTimestamp(value) || value.slice(0, 4) < '1970') return null;
  return value as HistoryTimestamp;
};
export function makeOwnerSnapshot(value: unknown): OwnerSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const networkId = makeNetworkId(candidate.networkId);
  const accountId = candidate.accountId === null ? null : makeAccountId(candidate.accountId);
  const accountGeneration = makeAccountGeneration(candidate.accountGeneration);
  const connectionGeneration = makeConnectionGeneration(candidate.connectionGeneration);
  const physicalRef = candidate.physicalRef === null ? null : makeLocalPhysicalEpoch(candidate.physicalRef);
  const ownerRef = makeOwnerRef(candidate.ownerRef);
  if (!networkId || (candidate.accountId !== null && !accountId) || accountGeneration === null
    || connectionGeneration === null || (candidate.physicalRef !== null && !physicalRef) || !ownerRef) return null;
  return Object.freeze({ networkId, accountId, accountGeneration, connectionGeneration, physicalRef, ownerRef });
}
/** Canonical JSON tuple avoids delimiter-collision in scoped storage keys. */
export const canonicalTupleKey = (parts: readonly string[]): string => JSON.stringify(parts);
export const networkAccountKey = (networkId: NetworkId, accountId: AccountId): string => canonicalTupleKey([networkId, accountId]);
export const ownerScopedKey = (ownerRef: OwnerRef, recordId: string): string => canonicalTupleKey([ownerRef, recordId]);
