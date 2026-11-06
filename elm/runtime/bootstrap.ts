import { createCredentialOwner, type CredentialMetadata } from './credential-owner';
import { createSessionRecoveryController, type RecoveryEvent } from './session-recovery-controller';
import { createPrivatePasskeyManagement, type PasskeyResult, type WebAuthnOperationLease } from './private-passkey-management';
import { validateClientLine } from './client-line-validator';
import { createAuthenticatedFacts } from './authenticated-facts';
import { createTabIntentOwner, type TabIntentAuthorityLost, type TabIntentResult } from './tab-intent-owner';
import { createOperatorImport } from './operator-import';
import { createLocalWorkspaceOwner } from './local-workspace-owner';
import { createIdentityOwner } from './identity-owner';
import { createPrivateAccountSecurity, createPrivateWebAuthnCeremonies, type PrivateAccountSecurityStatus, type PrivateFormKind, type PrivateAccountManagementForm, type PrivateWebAuthnInput, type PrivateWebAuthnStatus } from './private-account-security';
import { createBrowserLifecycle } from './browser-lifecycle';
import type { BrowserPlatform } from './browser-platform';
import { createMetrics } from './metrics';
import { createMediaCapture, type CaptureKind, type CaptureReadiness } from './media-capture';
import { createNotificationRouter, type AllowedNotificationRoute } from './notification-router';
import { createOwnedStorage, type OwnedMessageInput, type OwnedMessageRow, type OwnedTargetRequest } from './owned-storage';
import { createDraftStore } from './draft-store';
import { createSessionOperationOwner, type SessionOperationLease } from './session-operation-owner';
import { createSessionMeshControl, type SessionControlResult } from './session-mesh-control';
import { createAccountCommunityService, type CommunityResult } from './account-community-service';
import { createIntegrationOperations, type IntegrationAction, type IntegrationResult, type IntegrationView } from './integration-operations';
import { createOutboxJournal, type QueueIntent, type JournalRow } from './outbox-journal';
import { createReadAnchorStore } from './read-anchor-store';
import { createSettingsStore } from './settings-store';
import { createEvictionPolicy } from './eviction-policy';
import { createPrivateCryptoProvider } from './private-crypto-provider';
import { createPrivateBackupStorage } from './private-backup-storage';
import { createMemorySendOwner, type MemoryChatIntent, type MemorySendPolicy } from './memory-send-owner';
import { createSendAcceptanceRegistry } from './send-acceptance-registry';
import { createScheduledCustody, type ScheduledPolicySnapshot, type ScheduledResult, type ScheduledListResult, type ScheduledCreateAdmissionRef } from './scheduled-custody';
import { createScheduledDuePump, selectDueScheduledRows } from './scheduled-due-pump';
import { createMediaEngine, type CapturePurpose, type MediaStatus } from './media-engine';
import { createMediaRecordingControl } from './media-recording-control';
import { createCadenceTransportAdapter } from './cadence-transport-adapter';
import { createCaptionProducer } from './caption-producer';
import { createWebRtcExperiment } from './webrtc-experiment';
import { createWebTransportAdapter } from './webtransport-adapter';
import type { MediaIdentityAdapter, MediaIdentityContext } from '../../src/lib/cadence-media/types';
import type { LocalNamespaceTicket, LocalOwnerGrant } from './local-workspace-owner';
import type { CryptoPolicy, FreshGenesisFact } from './private-crypto-provider';
import { createWorkerLifecycle, type BuildCompatibility, type ClientActivationState, type WorkerStatus } from './worker-lifecycle';
import { createBrowserNotificationAdapter, createPlatformPrivateStore, createPushLifecycle, type PushSnapshot, type PushIntent } from './push-lifecycle';
import {
  makeAccountGeneration, makeAccountId, makeConnectionGeneration,
  makeConversationId, makeMessageId, makeReadMarkerTimestamp, makeWireTimestamp, makeEndpointId, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeOwnerSnapshot, makeRequestId, canonicalTupleKey,
  type AccountGeneration, type AccountId, type ConnectionGeneration, type EndpointId, type OwnerRef,
  type ConversationId, type ConversationKeyScheme, type MediaCallRef, type NetworkId, type OwnerSnapshot, type RequestId, type RequestContext, type SendAdmission,
  type CredentialRef,
  type RuntimeDomainCommand, type RuntimeDomainResult, type RuntimeDomainObservation, type DomainView,
  type TabIntentView,
} from './contracts';
import { createTransportOwner } from './transport-owner';
import { createPublicIngressBatcher, type PublicIngressFrame } from './public-ingress-batcher';
import { formatIRCLine, formatTaggedLine, normalizeCase, parseIRCMessage } from '../../src/lib/irc/parser';
import { buildMultilineLines, parseMultilineLimits, planMultilineBatches } from '../../src/lib/irc/multiline';
import { isWebhookCreationReply, parseWebhookCreationReply } from './private-webhook-reply';
import { parsePrivateWebAuthnReply } from './private-webauthn-reply';
import { GROUP_ENVELOPE_PREFIX, MAX_GROUP_ENVELOPE_WIRE_BYTES, parseGroupEnvelope } from '../../src/lib/e2ee/groupEnvelope';
import { isEnvelope, isValidDmEnvelope } from '../../src/lib/e2ee/dmCipher';

const RUNTIME_CAPS = new Set([
  'account-notify','account-tag','away-notify','batch','cap-notify','chghost','channel-rename','draft/channel-rename',
  'metadata-2',
  'chathistory','draft/chathistory','multiline','draft/multiline','read-marker','draft/read-marker','draft/no-implicit-names',
  'no-implicit-names','draft/search','draft/typing','draft/react','draft/reply','draft/message-editing','draft/message-redaction',
  'typing','react','reply','message-editing','message-redaction','msgid','draft/webpush','echo-message','extended-join',
  'invite-notify','labeled-response','message-tags','multi-prefix','draft/netsplit','draft/netjoin','server-time','setname',
  'standard-replies','userhost-in-names','account-extban','utf8-only','onyx/session-sync','onyx/e2ee','onyx/media',
]);

const DOMAIN_PAYLOAD_KEYS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = Object.freeze({
  session: { 'new-attachment': [], resume: ['credentialRef','acceptLegacyNewAttachment'], retry: ['credentialRef','acceptLegacyNewAttachment'], forget: ['credentialRef'], remember: ['enabled'],
    'local-list':[],'local-drop':['rowRef','confirm'],'mesh-list':[],'mesh-next':['scanRef'],'mesh-revoke':['groupRef','confirm'],'mesh-reconcile':['revokeRef'],'mesh-dismiss':['revokeRef'] },
  'account-community': {'autojoin-list':[],'autojoin-add':['channel'],'autojoin-remove':['channel','confirm'],'group-list':[],'group-add':['nick'],'group-remove':['nick','confirm'],'group-primary':['nick','confirm']},
  'account-security': {begin:['action','formRef','account','confirm'],present:['presentationRef','action','selection'],
    'passkey-list':[],'passkey-rename':['credentialRef','label'],'passkey-remove':['credentialRef','confirm']},
  webauthn:{begin:['ceremony','account'],cancel:['ceremonyRef']},
  continuation:{list:[],remember:['continuationRef','enabled'],forget:['continuationRef'],select:['continuationRef','confirm'],use:['continuationRef']},
  workspace: { list: [], remember: ['enabled','confirm'], select: ['workspaceRef'], lock: [] },
  draft: { load: ['conversationId'], save: ['conversationId','text','revision'], discard: ['conversationId','revision'], recover: ['draftRef'], 'recovery-list':[] },
  journal: { queue: ['clientIntentId','conversationId','intent','text','replyTo','messageKind','audiencePrefix'], list: [], retry: ['entryRef','confirmDuplicateRisk'], cancel: ['entryRef'], reconcile: ['entryRef'] },
  scheduled:{create:['inputRef','operationId','clientIntentId','conversationId','dueAtMs','messageKind','replyTo','audiencePrefix'],edit:['inputRef','scheduleRef','expectedRevision','dueAtMs','messageKind','replyTo','audiencePrefix'],list:[],cancel:['scheduleRef','expectedRevision'],dispatch:['scheduleRef','expectedRevision'],reconcile:['scheduleRef','expectedRevision']},
  anchor: { viewed: ['conversationId','messageId','timestamp'], load: ['conversationId'] },
  settings: { preview: ['inputRef'], apply: ['previewRef','enabledOptIns'], export: ['outputRef'] },
  storage: { export: ['selectionRef','outputRef'], clear: ['selectionRef','confirm'] },
  eviction: { preview: ['conversationIds'], apply: ['planRef','confirm'] },
  group: { 'directory-refresh':['conversationId'],'trust-preview':['conversationId','accountId','deviceId'],'trust-confirm':['previewRef','confirm'],
    'author-plan':['conversationId','expectedEpoch','expectedCommitHash','excludeDevice'],'author-commit':['planRef','confirmMembershipRevision','confirmBackupEnabled'],
    enroll:['conversationId','confirm'],'welcome-request':['conversationId','expectedEpoch','expectedCommitHash'],'remove-device':['conversationId','accountId','deviceId','expectedEpoch','expectedCommitHash','confirm'],
    'backup-export':['conversationId','epoch','commitHashHex','outputRef','passwordRef'],'backup-import':['conversationId','inputRef','passwordRef','configuredNetworkId'],
    'backup-approve':['previewRef','confirmHistoryOnly','confirmFingerprint'],'backup-cancel':['previewRef'],cancel:['operationRef'],
    'bootstrap-preview':['conversationId'],'bootstrap-approve':['previewRef','confirm'],'bootstrap-cancel':['previewRef'] },
  media: { inspect:[], 'roster-refresh':['conversationId','callRef'], 'devices-refresh':[], soundcheck:['captureRef','durationMs'],join:['conversationId','kind','captureRef'],leave:['conversationId'],input:['deviceRef','conversationId','callRef','captureRef'],output:['deviceRef','volumePercent'],mute:['muted'],deafen:['deafened'],
    'camera-preview':['conversationId','captureRef'],'preview-attach':['previewRef','elementRef'],'preview-retire':['previewRef'],'camera-publish':['conversationId','previewRef'],
    'screen-start':['conversationId','captureRef'],'screen-stop':['conversationId'],consent:['conversationId','callRef','consent','policyRevision'],record:['conversationId','callRef','action','consentRevision'],
    'caption-prepare':['conversationId','callRef','language'],'caption-start':['conversationId','callRef','language','mode','browserServiceConsent'],'caption-stop':['conversationId','callRef'],quality:['conversationId','callRef','policy'],
    'webrtc-run':['captureRef','kind'],'webrtc-stop':['experimentRef'],'fingerprint-compare':['experimentRef','comparisonRef'],'audio-recover':['conversationId','callRef'] },
  platform: { 'worker-register':[],'worker-activate':['targetRef','confirm'],'worker-cancel':['activationRef'],'push-inspect':[],'push-enable':['consentRef'],'push-disable':['confirm'],'push-reconcile':[],'notification-route':['routeRef'] },
  'tab-intent': { fresh:['confirm'],list:[],restore:['intentRef','confirm'],retire:['intentRef','confirm'] },
  'operator-import': { preview:['inputRef'],get:['previewRef'],dismiss:['previewRef'] },
  integration: { 'reconnect-media':['confirm'],'webtransport-connect':['endpointRef','confirm'],'webtransport-fallback':['attemptRef','confirm'] },
  'service-integration': {
    refresh:['feature'],'botgrant-list':['account'],'botgrant-add':['account','grant','channel','ttlSeconds'],
    'botgrant-remove':['account','grant','channel','confirm'],'botcmd-list':[],'botcmd-add':['name','argc','help'],
    'botcmd-run':['name','args'],'defer-at':['unixMs','channel','text'],
    'defer-cron':['minute','hour','dayOfMonth','month','dayOfWeek','channel','text'],
    'defer-oper-at':['unixMs','channel','mode'],
    'defer-oper-cron':['minute','hour','dayOfMonth','month','dayOfWeek','channel','mode'],
    'outhook-input':[],'outhook-add':['inputRef'],'outhook-list':[],'outhook-inspect':['urlRef'],'outhook-remove':['urlRef','confirm'],
    'unfurl-off':[],'unfurl-on':[],'unfurl-preview':['url'],'memo-send':['account','text'],'memo-list':[],'memo-clear':['confirm'],
    'memo-forward':['account'],'memo-ignore-list':[],'memo-ignore-add':['account'],'memo-ignore-remove':['account','confirm'],
  },
});
const DOMAIN_COMMAND_ENVELOPE_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'ownerRef', 'accountGeneration', 'connectionGeneration', 'domain', 'action', 'payload',
] as const);
const OPTIONAL_DOMAIN_PAYLOAD_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'service-integration.botgrant-list': ['account'],
});

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function commandPayloadBounded(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength <= 1024 * 1024 && !/[\u0000\u0001]/u.test(value);
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (typeof value === 'boolean' || value === null) return true;
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => commandPayloadBounded(item, depth + 1));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([key, item]) => key.length <= 128 && commandPayloadBounded(item, depth + 1));
}

export interface BrowserRuntimeConfig {
  readonly networkId: string;
  readonly endpointId: string;
  readonly trustedEndpoints: readonly string[];
  readonly endpointRegistry?: readonly { readonly url: string; readonly networkId: string; readonly endpointId: string; readonly nodeName?: string }[];
  /** Explicit reviewed deployment opt-in for the not-yet-deployed SESSION mesh candidate. */
  readonly sessionMeshControlEnabled?: boolean;
  /** Shell-verified browser capability facade; never replaced with a permissive fallback. */
  readonly browserPlatform?: BrowserPlatform;
  readonly initialUrl: string;
  /** Explicit trusted WebTransport bridge URL; never derived from IRC text. */
  readonly webTransportUrl?: string;
  readonly onLines: (lines: readonly string[], at: number) => void;
  /** Optional bounded channel-chat presentation path. When absent, public lines
   * continue to be delivered immediately through onLines. */
  readonly onFrames?: (batch: { readonly owner: { readonly ownerRef: string; readonly networkId: string; readonly accountId: string | null;
    readonly accountGeneration: number; readonly connectionGeneration: number }; readonly frames: readonly PublicIngressFrame[] }) => void;
  readonly onConnectionState?: (state: 'offline' | 'connecting' | 'live', url: string) => void;
  readonly onCredentialState?: (state: { readonly credentials: readonly CredentialMetadata[]; readonly issuance: 'idle' | 'pending' | 'unknown'; readonly remembered: boolean }) => void;
  readonly onOwnerState?: (state: { readonly ownerRef: string; readonly networkId: string; readonly accountId: string | null; readonly accountGeneration: number; readonly connectionGeneration: number }) => void;
  readonly onFeatureReadiness?: (state: { readonly roundRef: string; readonly ownerRef: string; readonly accountGeneration: number; readonly connectionGeneration: number; readonly e2ee: boolean; readonly media: boolean; readonly newCapabilities: readonly string[] }) => void;
  readonly onCapabilityResolution?: (state: { readonly roundRef: string; readonly names: readonly string[]; readonly result: 'ack' | 'nak' | 'del'; readonly ownerRef: string; readonly accountGeneration: number; readonly connectionGeneration: number }) => void;
  readonly mediaReady?: () => boolean;
  /** Exact staged shell compatibility projection injected by the site builder. */
  readonly buildCompatibility?: BuildCompatibility;
  readonly getWorkerClientState?: () => Omit<ClientActivationState, 'clientRef' | 'buildId' | 'protocolVersion' | 'storageSchemas'>;
  readonly onNotificationNavigation?: (event: { readonly requestId: string; readonly ownerRef: string; readonly accountGeneration: number;
    readonly connectionGeneration: number; readonly kind: AllowedNotificationRoute['kind']; readonly conversationId: string | null }) => void;
  readonly acquireActivationLease?: (input: { readonly targetBuildId: string; readonly requestId: RequestId }) => Promise<(() => void) | null>;
  readonly audioContextFactory?: () => AudioContext;
  readonly encodeNotificationRoute?: (route: AllowedNotificationRoute) => string | null;
  readonly navigateNotificationRoute?: (path: string) => Promise<boolean> | boolean;
  readonly onTabIntentAuthorityLost?: (event: TabIntentAuthorityLost) => void;
  readonly onPrivateWebhookResult?: (event:{readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number;readonly requestId:string;readonly room:string;readonly status:'created'|'blocked'})=>void;
  readonly onReadMarkerResult?: (event:{readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number;readonly requestId:string;readonly conversationId:string;readonly timestamp:string;readonly status:'persisted-accepted'|'unchanged'|'stale-owner'|'invalid'|'unavailable'})=>void;
}

/** A camera publish is successful only when the backend and inspected live
 * call both identify the exact requested video scope. A surviving voice call
 * after a failed upgrade is not a successful publication. */
export function resolveCameraPublication(
  result: Pick<MediaStatus, 'state' | 'reason' | 'kind'> & { readonly conversationId: string | null },
  inspected: { readonly call: { readonly conversationId: string; readonly callRef: string } | null } | null,
  conversationId: string,
  callRef: string,
  previous: { readonly conversationId: string; readonly callRef: string } | null,
): { readonly accepted: boolean; readonly refreshRoster: boolean; readonly restorePrevious: boolean } {
  const accepted = result.state === 'in-call' && result.reason === null && result.kind === 'video'
    && result.conversationId === conversationId && inspected?.call?.conversationId === conversationId
    && inspected.call.callRef === callRef;
  const restorePrevious = !accepted && previous !== null && inspected?.call?.conversationId === previous.conversationId
    && inspected.call.callRef === previous.callRef;
  return { accepted, refreshRoster: accepted, restorePrevious };
}

interface ClientSafetyState {
  readonly ownerRef: string;
  readonly accountGeneration: number;
  readonly connectionGeneration: number;
  readonly hasUnsavedDraft: boolean;
  readonly composing: boolean;
  readonly pendingAuthoring: boolean;
}

function randomRef(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function randomHex32(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Browser-private composition root. It is created before socket effects and
 * remains the sole authority for owner generations and credential custody. */
const GROUP_DELIVERY_LINE = /^(?:@\S+\s+)?:\S+\s+E2EE\.(?:KEYPACKAGE|COMMIT|WELCOME)(?:\s|$)/u;

export function createBrowserRuntime(config: BrowserRuntimeConfig) {
  const parsedNetworkId = makeNetworkId(config.networkId);
  const parsedEndpointId = makeEndpointId(config.endpointId);
  if (!parsedNetworkId || !parsedEndpointId) throw new Error('invalid runtime registry identity');
  let networkId: NetworkId = parsedNetworkId;
  let endpointId: EndpointId = parsedEndpointId;
  let accountId: AccountId | null = null;
  let accountGeneration: AccountGeneration = makeAccountGeneration(0)!;
  let connectionGeneration: ConnectionGeneration = makeConnectionGeneration(0)!;
  let physicalRef = makeLocalPhysicalEpoch(randomHex32());
  let ownerRef:OwnerRef = makeOwnerRef(randomRef())!;
  let learnedPrefix: string | null = null;
  let tentativeServerPrefix: string | null = null;
  let pendingAccountProof: { readonly ownerRef: string; readonly accountGeneration: number; readonly connectionGeneration: number; readonly physicalRef: string | null; readonly serverPrefix: string; readonly recipient: string; readonly account: AccountId } | null = null;
  let currentNick: string | null = null;
  let caseMapping: ConversationKeyScheme['name'] | null = null;
  let mappingGeneration = 0;
  let advertisedVapidKey: Uint8Array | null = null;
  let currentUrl = config.initialUrl;
  let disposed = false;
  let disposingRuntime = false;
  let physicalStarted = false;
  let scheduledDueWorkActive = false;
  let clientSafetyState: ClientSafetyState | null = null;
  let activePrivateIntegrationForms = 0;
  let activePrivatePickers = 0;
  let activationBarrier: { readonly owner: OwnerSnapshot; readonly targetBuildId: string; readonly token: symbol; releaseFreeze: () => void } | null = null;
  let authorizedWorkerActivation: { readonly owner: OwnerSnapshot; readonly requestId: RequestId; readonly targetRef: string; readonly targetBuildId: string } | null = null;
  // A click message can arrive before this listener is installed. The worker
  // persists claims, so perform one bounded discovery after account proof.
  let pendingNotificationClick = config.browserPlatform !== undefined;
  let claimPendingNotificationRoute: () => void = () => {};
  const notificationNavigationClaims = new Map<string, { readonly owner: OwnerSnapshot; readonly context: RequestContext; readonly route: import('./browser-platform').PendingNotificationRoute; readonly timer: ReturnType<typeof setTimeout> }>();
  let retirePhysicalOwner: (expected:OwnerSnapshot, closeTransport?:boolean, preserveWorkspaceSelection?:boolean, nextNetwork?:NetworkId, nextEndpoint?:EndpointId) => void = () => {};
  let retireVaultPumpsForOwner: (expected?: OwnerSnapshot) => void = () => {};
  let retireVaultPumpsForWorkspace: (scope: LocalNamespaceTicket['scope']) => void = () => {};
  const saslContexts = new Map<string, OwnerSnapshot>();
  let selectedContinuationRef: string | null = null;
  const pendingContinuationSasl = new Map<string,{readonly owner:OwnerSnapshot;readonly continuationRef:string;readonly requestId:RequestId;phase:'challenge'|'result'}>();
  const featureRounds = new Map<string, { readonly owner: OwnerSnapshot; readonly e2ee: boolean; readonly media: boolean; readonly newCapabilities: readonly string[]; readonly requested: Set<string>; readonly unresolved: Set<string>; emittedRequest: boolean; ended: boolean }>();
  let activeFeatureRoundRef: string | null = null;
  let pendingFeatureReadiness: { readonly owner: OwnerSnapshot; readonly e2ee: boolean; readonly media: boolean; readonly newCapabilities: readonly string[] } | null = null;
  const advertisedCapabilities = new Set<string>();
  const negotiatedCapabilities = new Set<string>();
  const capabilityValues = new Map<string, string>();
  let statusMessagePrefixes = new Set<string>();
  const pendingNewCapabilities = new Set<string>();
  const MAX_CAPABILITIES=256,MAX_CAP_NAME_BYTES=128,MAX_CAP_VALUE_BYTES=4096,MAX_CAP_STAGE_BYTES=256*(128+1+4096);
  let stagedCapabilityInventory:Map<string,string|null>|null=null;
  let stagedCapabilityBytes=0;
  let stagedCapabilityOwner:OwnerSnapshot|null=null;
  let capabilityInventoryPoisoned=false;
  let capabilityStageTimer:ReturnType<typeof setTimeout>|null=null;
  let closeForCapabilityFailure:()=>void=()=>{};
  const clearCapabilityStage=():void=>{if(capabilityStageTimer!==null)clearTimeout(capabilityStageTimer);capabilityStageTimer=null;stagedCapabilityInventory=null;stagedCapabilityBytes=0;stagedCapabilityOwner=null;};
  const validCapToken=(token:string):{readonly name:string;readonly value:string|null;readonly bytes:number}|null=>{
    const eq=token.indexOf('=');const name=eq<0?token:token.slice(0,eq);const value=eq<0?null:token.slice(eq+1);
    if(!/^[A-Za-z0-9./-]{1,128}$/u.test(name)||value!==null&&/[\u0000-\u0020\u007f]/u.test(value))return null;
    for(let i=0;i<token.length;i+=1){const code=token.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=token.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff))return null;i+=1;}else if(code>=0xdc00&&code<=0xdfff)return null;}
    const encoder=new TextEncoder();const nameBytes=encoder.encode(name).byteLength;const valueBytes=value===null?0:encoder.encode(value).byteLength;
    if(nameBytes>MAX_CAP_NAME_BYTES||valueBytes>MAX_CAP_VALUE_BYTES)return null;
    return {name,value,bytes:nameBytes+(value===null?0:1+valueBytes)};
  };
  const capInventoryBytes=(inventory:ReadonlyMap<string,string|null>):number=>{
    const encoder=new TextEncoder();let total=0;
    for(const [name,value] of inventory)total+=encoder.encode(name).byteLength+(value===null?0:1+encoder.encode(value).byteLength);
    return total;
  };
  const parseVapidIsupport=(value:string):Uint8Array|null=>{
    if(!/^[A-Za-z0-9_-]{1,128}$/u.test(value))return null;
    try{
      const base64=value.replaceAll('-','+').replaceAll('_','/');
      const binary=atob(base64+'='.repeat((4-base64.length%4)%4));
      if(binary.length!==65||binary.charCodeAt(0)!==4)return null;
      const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
      let encoded='';for(const byte of bytes)encoded+=String.fromCharCode(byte);
      const canonical=btoa(encoded).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
      return canonical===value?bytes:null;
    }catch{return null;}
  };
  const applyCapToken=(inventory:Map<string,string|null>,token:string,currentBytes:number):number|null=>{
    const parsed=validCapToken(token);if(!parsed)return null;
    const had=inventory.has(parsed.name);if(!had&&inventory.size>=MAX_CAPABILITIES)return null;
    const previous=inventory.get(parsed.name);
    const oldBytes=had?new TextEncoder().encode(parsed.name).byteLength+(previous===null?0:1+new TextEncoder().encode(previous??'').byteLength):0;
    const nextBytes=currentBytes-oldBytes+parsed.bytes;
    if(nextBytes>MAX_CAP_STAGE_BYTES)return null;
    inventory.set(parsed.name,parsed.value);return nextBytes;
  };
  const poisonCapabilityInventory=(owner:OwnerSnapshot):void=>{
    clearCapabilityStage();capabilityInventoryPoisoned=true;
    if(isCurrent(owner)&&owner.physicalRef===physicalRef)closeForCapabilityFailure();
  };
  let facts: ReturnType<typeof createAuthenticatedFacts> | null = null;
  const multilineCapabilityNames = ['draft/multiline', 'multiline'] as const;
  const hasNegotiatedMultiline = (): boolean => multilineCapabilityNames.some(name => negotiatedCapabilities.has(name));
  const negotiatedMultilineLimits = () => {
    const active = multilineCapabilityNames.filter(name => negotiatedCapabilities.has(name));
    const parsed = active.map(name => parseMultilineLimits(capabilityValues.get(name)));
    if (parsed.length === 0) return parseMultilineLimits(undefined);
    return parsed.slice(1).reduce((limits, next) => ({
      maxBytes: Math.min(limits.maxBytes, next.maxBytes),
      maxLines: Math.min(limits.maxLines, next.maxLines),
    }), parsed[0]!);
  };
  let privateAccountSecurity: ReturnType<typeof createPrivateAccountSecurity> | null = null;
  let privateCrypto!: ReturnType<typeof createPrivateCryptoProvider>;
  let credentialProjection: { readonly credentials: readonly CredentialMetadata[]; readonly issuance: 'idle'|'pending'|'unknown'; readonly remembered: boolean } = { credentials: [], issuance: 'idle', remembered: false };
  const domainListeners = new Set<(event: RuntimeDomainObservation) => void>();
  const sessionTokenSaslListeners = new Set<(event:{readonly requestId:string;readonly status:'accepted'|'rejected'|'unknown'|'aborted';readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number})=>void>();
  const captureListeners = new Set<(event: { readonly intentRef: string; readonly ownerRef: string; readonly conversationId: string; readonly captureRef: string; readonly callRef?:string; readonly available: boolean; readonly reason: string | null }) => void>();
  const disposeListeners = new Set<() => void>();
  const domainSequence = new Map<string, number>();
  const publishSessionTokenSaslStatus=(entry:{readonly owner:OwnerSnapshot;readonly requestId:RequestId},status:'accepted'|'rejected'|'unknown'|'aborted')=>{
    const event={requestId:entry.requestId,status,ownerRef:entry.owner.ownerRef,accountGeneration:Number(entry.owner.accountGeneration),connectionGeneration:Number(entry.owner.connectionGeneration)} as const;
    for(const listener of [...sessionTokenSaslListeners]){try{listener(event);}catch{/* listener isolation */}}
  };
  const abortPendingContinuations=()=>{
    for(const [authContextRef,entry] of pendingContinuationSasl){
      identity.settleSessionTokenSasl({authContextRef,result:'unknown'});
      publishSessionTokenSaslStatus(entry,'aborted');
      pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);
    }
    selectedContinuationRef=null;
  };
  const pendingWebhookCreates=new Map<string,{readonly owner:OwnerSnapshot;readonly requestId:RequestId;readonly room:string;readonly expiresAt:number}>();
  const pendingIdentify=new Map<string,{readonly owner:OwnerSnapshot;readonly requestId:RequestId;readonly account:string;readonly timer:ReturnType<typeof setTimeout>}>();
  type PendingWebAuthn={owner:OwnerSnapshot;context:import('./contracts').RequestContext;action:'register'|'authenticate';account:string;ceremonyRef:string;challenge:Uint8Array|null;rpId:string|null;allowCredentials:Uint8Array[];allowMalformed:boolean;sent:boolean;timer:ReturnType<typeof setTimeout>|null;lease:WebAuthnOperationLease};
  const pendingWebAuthn=new Map<string,PendingWebAuthn>();
  let sessionOperations: ReturnType<typeof createSessionOperationOwner> | null = null;
  let sessionMeshControl: ReturnType<typeof createSessionMeshControl> | null = null;
  let accountCommunity: ReturnType<typeof createAccountCommunityService> | null = null;
  let integrationOperations: ReturnType<typeof createIntegrationOperations> | null = null;
  let integrationIngress: { dispose(): void } | null = null;
  const privateOutHookPresentations = new Map<string, Set<() => void>>();
  let credentialIssuanceLease: SessionOperationLease | null = null;
  let draftStoreForRetirement: ReturnType<typeof createDraftStore> | null = null;
  const clearPendingWebAuthn=(pending:PendingWebAuthn):void=>{
    if(pending.timer)clearTimeout(pending.timer);pending.timer=null;pending.challenge?.fill(0);pending.challenge=null;
    pending.allowCredentials.forEach(value=>value.fill(0));pending.allowCredentials.length=0;pending.lease.release();
  };
  let webAuthn:ReturnType<typeof createPrivateWebAuthnCeremonies>|null=null;
  let recoveryController: ReturnType<typeof createSessionRecoveryController> | null = null;
  let passkeyManagement: ReturnType<typeof createPrivatePasskeyManagement> | null = null;
  let webAuthnOperation: { readonly context: RequestContext; readonly leaseId: string } | null = null;
  let recoveryTransfer: { readonly requestId: RequestId; readonly credentialRef: CredentialRef; readonly fromOwner: OwnerSnapshot; readonly destinationOwner: OwnerSnapshot | null; readonly targetNetwork: NetworkId; readonly targetEndpoint: EndpointId; readonly targetUrl: string; readonly acceptLegacyNewAttachment:boolean; observationTransferFrom: OwnerSnapshot | null } | null = null;
  const recoveryViews = new Map<string, Extract<DomainView,{kind:'session-recovery'}>>();
  const recoveryLegacyIntentKeys = new Set<string>();
  const recoveryIssuanceKeys = new Map<string, OwnerSnapshot>();
  const sameOwnerSnapshot=(a:OwnerSnapshot,b:OwnerSnapshot):boolean=>a.networkId===b.networkId&&a.accountId===b.accountId
    &&a.accountGeneration===b.accountGeneration&&a.connectionGeneration===b.connectionGeneration&&a.physicalRef===b.physicalRef&&a.ownerRef===b.ownerRef;
  const recoveryIntentKey=(requestId:string,credentialRef:string):string=>JSON.stringify([requestId,credentialRef]);
  const retireRecoveryIssuanceForOwner=(owner:OwnerSnapshot):void=>{
    for(const [key,issuedOwner] of recoveryIssuanceKeys)if(sameOwnerSnapshot(issuedOwner,owner))recoveryIssuanceKeys.delete(key);
  };
  let runtimeConnect:(url:string)=>SendAdmission=()=>({kind:'blocked',reason:'offline'});
  const privateWebhookUrls=new Map<string,{readonly ownerRef:string;readonly room:string;url:string;readonly expiresAt:number;timer:ReturnType<typeof setTimeout>}>();
  let clearPrivateWebhookPresentation=():void=>{};
  const requestCache = new Map<string, { payloadKey: string; pending: Promise<RuntimeDomainResult> | null; result: RuntimeDomainResult | null }>();
  type PrivateInputPurpose = 'operator-import'|'settings-import'|'group-backup-import';
  type PrivateOutputPurpose = 'settings-export'|'storage-export'|'group-backup-export';
  type PrivatePasswordPurpose = 'group-backup-export'|'group-backup-import';
  type PrivateSecurityFormKind = PrivateFormKind;
  type PrivateScheduledMessageRequest={readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number;readonly kind:'create'|'edit';readonly operationId:string;readonly conversationId:string;readonly initialDueAtMs:number;readonly prefillFromComposer:boolean};
  type PrivateScheduledMessageReady=PrivateScheduledMessageRequest&{readonly inputRef:string;readonly dueAtMs:number;readonly prefilledComposer:boolean};
  type PrivateAccountFormRequest={readonly kind:PrivateSecurityFormKind;readonly action:string;readonly account:string|null;readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number};
  type PrivateAccountFormReady={readonly kind:PrivateSecurityFormKind;readonly action:string;readonly formRef:string;readonly account:string|null;readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number};
  const privateInputs = new Map<string,{ownerRef:string;owner:OwnerSnapshot;purpose:PrivateInputPurpose;file:File;expiresAt:number}>();
  const privateOutputs = new Map<string,{ownerRef:string;purpose:PrivateOutputPurpose;handle:FileSystemFileHandle;expiresAt:number}>();
  const privatePickerCancels=new Set<()=>void>();
  const privatePasswords = new Map<string,{ownerRef:string;purpose:PrivatePasswordPurpose;bytes:Uint8Array;expiresAt:number}>();
  const privateSecurityForms = new Map<string,{ownerRef:string;accountGeneration:number;connectionGeneration:number;requestId:RequestId;kind:PrivateSecurityFormKind;bytes:Uint8Array|PrivateAccountManagementForm|null;account:string|null;expiresAt:number;used:boolean}>();
  const privateScheduledMessages=new Map<string,{readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number;readonly requestId:RequestId;readonly kind:'create'|'edit';readonly operationId:string;readonly admissionRef:ScheduledCreateAdmissionRef|null;bytes:Uint8Array;expiresAt:number;used:boolean;timer:ReturnType<typeof setTimeout>|null}>();
  const wipePrivateSecurityValue=(value:Uint8Array|PrivateAccountManagementForm|null):void=>{
    if(value instanceof Uint8Array)value.fill(0);else if(value)for(const field of Object.values(value))if(field instanceof Uint8Array)field.fill(0);
  };
  const privateInputTokens = new Map<symbol,{ref:string;ownerRef:string}>();
  const privateOutputTokens = new Map<symbol,{ref:string;ownerRef:string}>();
  const privatePasswordTokens = new Map<symbol,{ref:string;ownerRef:string;purpose:PrivatePasswordPurpose}>();
  const backupOperationRefs = new Map<string,{ownerRef:string;purpose:PrivatePasswordPurpose;conversationId:ConversationId;epoch:number|null}>();
  const backupPasswordTokenByOutput = new Map<string,symbol>();
  const portableBackupPreviews = new Map<string,{readonly ownerRef:string;readonly preview:import('./private-crypto-provider').PortableBackupPreview}>();
  let pendingPasswordDialog:{ownerRef:string;token:symbol;cancel:()=>void}|null=null;
  let pendingSecurityForm:{ownerRef:string;token:symbol;cancel:()=>void}|null=null;
  const cancelPendingPrivateDialogs=():void=>{pendingPasswordDialog?.cancel();pendingSecurityForm?.cancel();};
  const operatorInputTokens = new Map<string,symbol>();
  const newTabIntentOwner = (network: NetworkId) => createTabIntentOwner({ networkId: network, lifecycle: typeof window === 'undefined' ? null : window,
    onAuthorityLost: event => {
      if(activeTabIntentRef===event.intentRef)activeTabIntentRef=null;
      try{config.onTabIntentAuthorityLost?.(event);}catch{/* authority observers are isolated */}
    } });
  let tabIntents = newTabIntentOwner(networkId);
  let activeTabIntentRef: string | null = null;
  let lastWorkspaceGrant: LocalOwnerGrant | null = null;
  let localWorkspaces = createLocalWorkspaceOwner({ indexedDB: typeof indexedDB === 'undefined' ? null : indexedDB,
    configuredNetworks: () => [...new Set([networkId,...(config.endpointRegistry ?? []).map(entry=>makeNetworkId(entry.networkId)).filter((value):value is NetworkId=>value!==null)])],
    isProvenLiveOwner: owner => isCurrent(owner) && owner.accountId !== null && learnedPrefix !== null,
    isCurrentGuestOwner: owner => isCurrent(owner) && owner.accountId === null && owner.physicalRef !== null && learnedPrefix !== null,
    isRequestCurrent: request => isCurrent(request.owner) && request.schemaVersion === 1,
    isOfflineRequest: request => learnedPrefix === null && isCurrent(request.owner),
    validateHistoryCheckpoint:input=>privateCrypto?.isApprovedHistoryCheckpoint(input)===true,
    onAuthorityLost: scope => { retireVaultPumpsForWorkspace(scope);draftStoreForRetirement?.retireScope(scope);roomGates.clear();if(lastWorkspaceGrant?.scope.workspaceRef===scope.workspaceRef){privateCrypto?.retireWorkspace(lastWorkspaceGrant);lastWorkspaceGrant=null;} },
    onConversationSchemeChanged:()=>{roomGates.clear();featureReady={...featureReady,e2ee:false};publishFeatureReadiness();} });
  // Called many times per inbound line; re-validating unchanged identifiers
  // dominated ingest on slow devices. Snapshots are frozen, so sharing is safe.
  let cachedSnapshot: OwnerSnapshot | null = null;
  const snapshot = (): OwnerSnapshot => {
    if (cachedSnapshot && cachedSnapshot.networkId === networkId && cachedSnapshot.accountId === accountId
      && cachedSnapshot.accountGeneration === accountGeneration && cachedSnapshot.connectionGeneration === connectionGeneration
      && cachedSnapshot.physicalRef === physicalRef && cachedSnapshot.ownerRef === ownerRef) return cachedSnapshot;
    cachedSnapshot = makeOwnerSnapshot({ networkId, endpointId, accountId, accountGeneration, connectionGeneration, physicalRef, ownerRef })!;
    return cachedSnapshot;
  };
  let workspaceInitGeneration = 0;
  const workspaceInitializations = new Map<string, Promise<boolean>>();
  const workspaceInitializationKey = (owner: OwnerSnapshot): string => JSON.stringify([owner.ownerRef, owner.accountId,
    owner.networkId, owner.accountGeneration, owner.connectionGeneration, owner.physicalRef]);
  const initializeDefaultWorkspace = (owner: OwnerSnapshot): Promise<boolean> => {
    const ownerKey = workspaceInitializationKey(owner);
    const existing = workspaceInitializations.get(ownerKey);
    if (existing) return existing;
    const generation = ++workspaceInitGeneration;
    const operation = (async (): Promise<boolean> => {
      try {
        const scope = await localWorkspaces.ensureCurrentWorkspace(owner);
        if (!scope || generation !== workspaceInitGeneration || !isCurrent(owner)) return false;
        // 005 may arrive while workspace selection is still opening IndexedDB.
        // The initial persistence attempt can precede a selected scope, so
        // apply the current source-authenticated scheme after selection too.
        let persistedScheme: string | null = null;
        while (generation === workspaceInitGeneration && isCurrent(owner)) {
          const authenticatedScheme = facts?.conversationKeyScheme(owner);
          if (!authenticatedScheme) break;
          const schemeKey = JSON.stringify([authenticatedScheme.name, authenticatedScheme.revision]);
          if (schemeKey === persistedScheme) break;
          const persisted = await localWorkspaces.recordAuthenticatedConversationScheme(owner, authenticatedScheme);
          if (!persisted || generation !== workspaceInitGeneration || !isCurrent(owner)) return false;
          persistedScheme = schemeKey;
          const latestScheme = facts?.conversationKeyScheme(owner);
          if (!latestScheme || latestScheme.name === authenticatedScheme.name && latestScheme.revision === authenticatedScheme.revision) break;
        }
        lastWorkspaceGrant=localWorkspaces.grant();
        if(owner.physicalRef!==null)for(const target of joinedTargetsByPhysical.get(String(owner.physicalRef))??[]){
          const fact=facts?.policySnapshot(owner,target);if(fact?.complete&&fact.ephemeralKnown)refreshRetentionObservation?.(owner,target);
        }
        return lastWorkspaceGrant !== null;
      } catch { /* storage may remain unavailable until an explicit retry */ return false; }
    })();
    workspaceInitializations.set(ownerKey, operation);
    void operation.finally(() => {
      if (workspaceInitializations.get(ownerKey) === operation) workspaceInitializations.delete(ownerKey);
    });
    return operation;
  };
  const captureBroker = createMediaCapture({ ownerSnapshot: snapshot, isCurrent: owner => isCurrent(owner),
    mediaDevices: typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null,
    audioContextFactory: config.audioContextFactory ?? (() => new AudioContext({ sampleRate: 48_000 })) });
  const captureIntentRefs = new Map<string, { readonly ownerRef: string; readonly conversationId: ConversationId; readonly kind: CaptureKind; readonly purpose: CapturePurpose; readonly deviceRef?:string|null; readonly callRef?:string }>();

  let featureReady = { e2ee: false, media: false };
  function publishFeatureRound(state: { readonly owner: OwnerSnapshot; readonly e2ee: boolean; readonly media: boolean; readonly newCapabilities?: readonly string[] }): void {
    const roundRef = randomRef();
    const { owner, e2ee, media } = state;
    featureRounds.clear();
    activeFeatureRoundRef = roundRef;
    const newCapabilities = [...new Set(state.newCapabilities ?? [])];
    featureRounds.set(roundRef, { owner, e2ee, media, newCapabilities, requested: new Set<string>(), unresolved: new Set<string>(), emittedRequest: false, ended: false });
    config.onFeatureReadiness?.({ roundRef, ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration), e2ee, media, newCapabilities });
  }
  function advanceFeatureRound(roundRef: string): void {
    if (activeFeatureRoundRef !== roundRef) return;
    featureRounds.delete(roundRef);
    activeFeatureRoundRef = null;
    const queued = pendingFeatureReadiness;
    pendingFeatureReadiness = null;
    if (!queued && pendingNewCapabilities.size > 0) {
      const owner = snapshot();
      publishFeatureRound({ owner, ...featureReady, newCapabilities: [...pendingNewCapabilities] });
    } else if (queued && !disposed && queued.owner.connectionGeneration === connectionGeneration && queued.owner.physicalRef === physicalRef) {
      publishFeatureRound({ ...queued, newCapabilities: [...pendingNewCapabilities] });
    } else if (pendingNewCapabilities.size > 0 && !disposed) {
      publishFeatureRound({ owner: snapshot(), ...featureReady, newCapabilities: [...pendingNewCapabilities] });
    }
  }
  function publishFeatureReadiness(): void {
    const owner = snapshot();
    config.onOwnerState?.({ ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration) });
    const active = activeFeatureRoundRef ? featureRounds.get(activeFeatureRoundRef) : undefined;
    if (active && !active.ended && (active.unresolved.size > 0 || active.emittedRequest)) {
      pendingFeatureReadiness = { owner, ...featureReady, newCapabilities: [...new Set([...(pendingFeatureReadiness?.newCapabilities ?? []), ...pendingNewCapabilities])] };
      return;
    }
    publishFeatureRound({ owner, ...featureReady, newCapabilities: [...pendingNewCapabilities] });
  }
  const ownerMatchesSnapshot = (expected: OwnerSnapshot): boolean => {
    const live = snapshot();
    return !disposed && expected.networkId === live.networkId && expected.accountId === live.accountId
      && expected.accountGeneration === live.accountGeneration && expected.connectionGeneration === live.connectionGeneration
      && expected.physicalRef === live.physicalRef && expected.ownerRef === live.ownerRef;
  };
  // Stop new work as soon as disposal begins. Only the pending public-frame
  // drain below uses ownerMatchesSnapshot so already-received rows can be
  // delivered before their queue is discarded.
  const isCurrent = (expected: OwnerSnapshot): boolean => !disposingRuntime && ownerMatchesSnapshot(expected);
  const publicIngressOwnerStamp = (owner: OwnerSnapshot) => ({
    ownerRef: owner.ownerRef,
    networkId: owner.networkId,
    accountId: owner.accountId,
    accountGeneration: Number(owner.accountGeneration),
    connectionGeneration: Number(owner.connectionGeneration),
  });
  const publicIngressBatcher = typeof config.onFrames === 'function'
    ? createPublicIngressBatcher({
      ownerSnapshot: snapshot,
      isCurrent: ownerMatchesSnapshot,
      emit: (frames, owner) => {
        if (!ownerMatchesSnapshot(owner)) return;
        config.onFrames?.({ owner: publicIngressOwnerStamp(owner), frames });
      },
    })
    : null;
  type ParsedPublicIngress = ReturnType<typeof parseIRCMessage>;
  let isBatchablePublicIngress = (_line: string, _owner: OwnerSnapshot, _parsed?: ParsedPublicIngress): boolean => false;
  const flushPublicIngress = (owner: OwnerSnapshot): void => {
    if (!publicIngressBatcher || !ownerMatchesSnapshot(owner)) return;
    try { publicIngressBatcher.flush(); } catch { /* presentation failure cannot strand an owner or domain boundary */ }
  };
  const beforePublicIngressLine = (line: string, owner: OwnerSnapshot): void => {
    if (!publicIngressBatcher || !isCurrent(owner) || isBatchablePublicIngress(line, owner)) return;
    publicIngressBatcher.flush();
  };
  const beforePublicIngressSend = (owner: OwnerSnapshot): void => {
    if (publicIngressBatcher && isCurrent(owner)) publicIngressBatcher.flush();
  };
  const publishPublicIngressLine = (line: string, owner: OwnerSnapshot, at: number, parsed?: ParsedPublicIngress): void => {
    if (!publicIngressBatcher) {
      config.onLines([line], at);
      return;
    }
    if (!isCurrent(owner)) return;
    if (!isBatchablePublicIngress(line, owner, parsed)) {
      publicIngressBatcher.flush();
      if (isCurrent(owner)) config.onLines([line], at);
      return;
    }
    const frame: PublicIngressFrame = { at, lines: [line] };
    let accepted: boolean;
    try { accepted = publicIngressBatcher.enqueue(frame, owner); }
    catch { return; } // Overflow delivery already cleared its batch; drop this frame without replay.
    if (accepted) return;
    // A false enqueue can mean an oversized frame or a temporary capacity miss
    // after reentrant delivery refilled the queue; stale owners are also false.
    // Deliver immediately only while this complete owner remains current.
    if (!isCurrent(owner)) return;
    try { config.onFrames?.({ owner: publicIngressOwnerStamp(owner), frames: [frame] }); }
    catch { /* the oversized frame was already removed from batching; never replay it */ }
  };
  const ensurePrivatePresentationHost=(id:'onyx-private-runtime-presentation'|'onyx-private-account-security'):HTMLElement|null=>{
    if(typeof document==='undefined'||!document.body)return null;
    const appRoot=document.getElementById('app');let host=document.getElementById(id);
    // Browser.application can replace #app's children after index startup.
    // Keep sensitive dialogs in a stable body-level sibling.
    if(host&&(!document.body.contains(host)||appRoot?.contains(host)))document.body.append(host);
    if(!host){host=document.createElement('div');host.id=id;host.setAttribute('aria-live','polite');document.body.append(host);}
    return host;
  };
  const clearPrivateOutHookPresentations=(ownerRef?:string):void=>{
    for(const [key,closers] of privateOutHookPresentations){
      if(ownerRef!==undefined&&key!==ownerRef)continue;
      for(const close of [...closers]){try{close();}catch{/* isolate private UI cleanup */}}
      privateOutHookPresentations.delete(key);
    }
  };
  const clearWebhookPresentationForOwner=(ownerRef?:string):void=>{
    for(const [ref,entry] of privateWebhookUrls){if(ownerRef&&entry.ownerRef!==ownerRef)continue;clearTimeout(entry.timer);entry.url='';privateWebhookUrls.delete(ref);}
    if(!ownerRef||![...privateWebhookUrls.values()].some(entry=>entry.ownerRef===ownerRef)){clearPrivateWebhookPresentation();clearPrivateWebhookPresentation=()=>{};}
    for(const [key,pending] of pendingWebhookCreates)if(!ownerRef||pending.owner.ownerRef===ownerRef)pendingWebhookCreates.delete(key);
  };
  const clearPrivatePasswords=(ownerRef?:string):void=>{
    for(const [ref,entry] of privatePasswords){if(ownerRef&&entry.ownerRef!==ownerRef)continue;entry.bytes.fill(0);privatePasswords.delete(ref);}
    for(const [token,entry] of privatePasswordTokens){if(!ownerRef||entry.ownerRef===ownerRef)privatePasswordTokens.delete(token);}
    for(const [ref,entry] of backupOperationRefs){if(!ownerRef||entry.ownerRef===ownerRef){backupOperationRefs.delete(ref);backupPasswordTokenByOutput.delete(ref);}}
    for(const [token,entry] of privateInputTokens){if(!ownerRef||entry.ownerRef===ownerRef)privateInputTokens.delete(token);}
    for(const [token,entry] of privateOutputTokens){if(!ownerRef||entry.ownerRef===ownerRef)privateOutputTokens.delete(token);}
    if(pendingPasswordDialog&&(!ownerRef||pendingPasswordDialog.ownerRef===ownerRef))pendingPasswordDialog.cancel();
    for(const [ref,entry] of privateSecurityForms){if(!ownerRef||entry.ownerRef===ownerRef){wipePrivateSecurityValue(entry.bytes);privateSecurityForms.delete(ref);}}
    if(pendingSecurityForm&&(!ownerRef||pendingSecurityForm.ownerRef===ownerRef))pendingSecurityForm.cancel();
  };
  const privatePromptAllowed=(owner:OwnerSnapshot):boolean=>!disposed&&activationBarrier===null&&isCurrent(owner);
  const requestPrivatePassword=(input:{readonly purpose:PrivatePasswordPurpose;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}):Promise<{readonly purpose:PrivatePasswordPurpose;readonly passwordRef:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}|null>=>{
    const owner=snapshot();
    if(!privatePromptAllowed(owner)||typeof document==='undefined'||input.ownerRef!==owner.ownerRef||input.accountGeneration!==Number(owner.accountGeneration)
      ||input.connectionGeneration!==Number(owner.connectionGeneration)||owner.accountId===null)return Promise.resolve(null);
    const host=ensurePrivatePresentationHost('onyx-private-account-security');if(!host)return Promise.resolve(null);
    cancelPendingPrivateDialogs();
    clearPrivatePasswords(owner.ownerRef);
    const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label','Private group backup password');
    const heading=document.createElement('h2');heading.textContent='Group backup password';
    const description=document.createElement('p');description.textContent='Enter the password used to protect this backup. It stays in this browser session and is cleared after use.';
    const form=document.createElement('form');const label=document.createElement('label');label.textContent='Password';
    const field=document.createElement('input');field.type='password';field.autocomplete='new-password';field.required=true;field.minLength=12;field.maxLength=1024;
    label.append(field);const submit=document.createElement('button');submit.type='submit';submit.textContent='Continue';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';form.append(label,submit,cancel);dialog.append(heading,description,form);host.replaceChildren(dialog);field.focus();
    return new Promise<{readonly purpose:PrivatePasswordPurpose;readonly passwordRef:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}|null>(resolve=>{
      const dialogToken=Symbol('password-dialog');
      let settled=false;const finish=(value:{readonly purpose:PrivatePasswordPurpose;readonly passwordRef:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}|null)=>{if(settled)return;settled=true;clearTimeout(timer);dialog.remove();if(pendingPasswordDialog?.token===dialogToken)pendingPasswordDialog=null;resolve(value);};
      const timer=setTimeout(()=>finish(null),120_000);
      pendingPasswordDialog={ownerRef:owner.ownerRef,token:dialogToken,cancel:()=>finish(null)};
      cancel.addEventListener('click',()=>finish(null),{once:true});
      form.addEventListener('submit',event=>{
        event.preventDefault();const ownerNow=snapshot();let value=field.value;field.value='';
        const bytes=new TextEncoder().encode(value);value='';
        const hasControl=Array.from(new TextDecoder().decode(bytes),character=>character.codePointAt(0)??0).some(code=>code<0x20||code===0x7f);
        if(!isCurrent(owner)||ownerNow.ownerRef!==owner.ownerRef||bytes.byteLength<12||bytes.byteLength>1024||hasControl){bytes.fill(0);finish(null);return;}
        const passwordRef=randomRef();privatePasswords.set(passwordRef,{ownerRef:owner.ownerRef,purpose:input.purpose,bytes,expiresAt:Date.now()+3*60_000});
        while(privatePasswords.size>8){const oldest=privatePasswords.keys().next().value as string|undefined;if(!oldest)break;const stale=privatePasswords.get(oldest);stale?.bytes.fill(0);privatePasswords.delete(oldest);}
        finish({purpose:input.purpose,passwordRef,ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration)});
      },{once:true});
    });
  };
  const consumePrivatePassword=(ref:string,owner:OwnerSnapshot,purpose:PrivatePasswordPurpose):Uint8Array|null=>{
    const entry=privatePasswords.get(ref);if(!entry||entry.ownerRef!==owner.ownerRef||entry.purpose!==purpose||entry.expiresAt<=Date.now()||!isCurrent(owner))return null;
    privatePasswords.delete(ref);const bytes=entry.bytes.slice();entry.bytes.fill(0);return bytes;
  };
  const requestPrivateManagementForm=(input:PrivateAccountFormRequest,owner:OwnerSnapshot,requestId:RequestId):Promise<PrivateAccountFormReady|null>=>{
    const schema:Record<string,readonly {name:string;label:string;type:'text'|'password';max:number;required:boolean}[]>={
      'account-email':[{name:'email',label:'New email',type:'text',max:254,required:true},{name:'currentPassword',label:'Current password',type:'password',max:512,required:true}],
      'account-password':[{name:'currentPassword',label:'Current password',type:'password',max:512,required:true},{name:'newPassword',label:'New password',type:'password',max:512,required:true},{name:'confirmPassword',label:'Confirm new password',type:'password',max:512,required:true}],
      'account-certificate-reset':[{name:'newPassword',label:'New password',type:'password',max:512,required:true},{name:'confirmPassword',label:'Confirm new password',type:'password',max:512,required:true}],
      'account-drop':[{name:'confirmAccount',label:'Type the exact account name to confirm deletion',type:'text',max:64,required:true},{name:'currentPassword',label:'Current password',type:'password',max:512,required:true}],
      'password-reset-confirm':[{name:'resetCode',label:'Reset code',type:'text',max:32,required:true},{name:'newPassword',label:'New password',type:'password',max:512,required:true},{name:'confirmPassword',label:'Confirm new password',type:'password',max:512,required:true}],
      'account-register':[{name:'email',label:'Email address (or * for no email)',type:'text',max:254,required:true},{name:'password',label:'Password',type:'password',max:512,required:true},{name:'confirmPassword',label:'Confirm password',type:'password',max:512,required:true}],
      'account-verify':[{name:'verificationCode',label:'Verification code',type:'text',max:128,required:true}],
    };
    const fields=schema[input.kind];if(!privatePromptAllowed(owner)||typeof document==='undefined'||!requestId||input.ownerRef!==owner.ownerRef
      ||input.accountGeneration!==Number(owner.accountGeneration)||input.connectionGeneration!==Number(owner.connectionGeneration)
      ||!fields||input.action!==input.kind||!isCurrent(owner))return Promise.resolve(null);
    const accountNeeded=input.kind==='password-reset-confirm'||input.kind==='account-register'||input.kind==='account-verify';
    if(accountNeeded&&input.account!==null&&!/^[A-Za-z0-9_.-]{1,64}$/u.test(input.account))return Promise.resolve(null);
    const host=ensurePrivatePresentationHost('onyx-private-account-security');if(!host)return Promise.resolve(null);
    cancelPendingPrivateDialogs();
    const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',input.action);
    const heading=document.createElement('h2');heading.textContent=input.action.replaceAll('-',' ');const form=document.createElement('form');
    const inputs=new Map<string,HTMLInputElement>();
    if(accountNeeded){const label=document.createElement('label');label.textContent='Account';const accountInput=document.createElement('input');accountInput.type='text';accountInput.autocomplete='username';accountInput.maxLength=64;accountInput.required=true;if(input.account)accountInput.value=input.account;label.append(accountInput);form.append(label);inputs.set('account',accountInput);}
    for(const spec of fields){const label=document.createElement('label');label.textContent=spec.label;const field=document.createElement('input');field.type=spec.type;field.maxLength=spec.max;field.required=spec.required;field.autocomplete=spec.type==='password'?'new-password':'off';label.append(field);form.append(label);inputs.set(spec.name,field);}
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Continue';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';form.append(submit,cancel);dialog.append(heading,form);host.replaceChildren(dialog);
    return new Promise(resolve=>{
      const dialogToken=Symbol('security-dialog');
      let settled=false;const finish=(value:PrivateAccountFormReady|null)=>{if(settled)return;settled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);for(const field of inputs.values())field.value='';dialog.remove();if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;resolve(value);};
      const visibility=()=>{if(document.visibilityState!=='visible')finish(null);};const timer=setTimeout(()=>finish(null),120_000);pendingSecurityForm={ownerRef:owner.ownerRef,token:dialogToken,cancel:()=>finish(null)};
      document.addEventListener('visibilitychange',visibility);cancel.addEventListener('click',()=>finish(null),{once:true});
      form.addEventListener('submit',event=>{
        event.preventDefault();const current=snapshot();if(!isCurrent(owner)||current.ownerRef!==owner.ownerRef){finish(null);return;}
        const enc=new TextEncoder();const values=new Map<string,Uint8Array>();let invalid=false;
        const hasUnpairedSurrogate=(value:string):boolean=>{for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);
          if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff))return true;i++;}
          else if(code>=0xdc00&&code<=0xdfff)return true;}return false;};
        for(const spec of fields){const field=inputs.get(spec.name)!;const value=field.value;field.value='';const bytes=enc.encode(value);
          if(bytes.byteLength===0&&spec.required||bytes.byteLength>spec.max||/[\u0000-\u001f\u007f]/u.test(value)||hasUnpairedSurrogate(value))invalid=true;
          values.set(spec.name,bytes);
        }
        const accountInput=inputs.get('account');let account:string|null=null;
        if(accountInput){account=accountInput.value;accountInput.value='';if(!/^[A-Za-z0-9_.-]{1,64}$/u.test(account))invalid=true;}
        const make=(name:string)=>values.get(name)??new Uint8Array(0);let formValue:PrivateAccountManagementForm|null=null;
        switch(input.kind){
          case 'account-email':formValue={kind:input.kind,email:make('email'),currentPassword:make('currentPassword')};break;
          case 'account-password':formValue={kind:input.kind,currentPassword:make('currentPassword'),newPassword:make('newPassword'),confirmPassword:make('confirmPassword')};break;
          case 'account-certificate-reset':formValue={kind:input.kind,newPassword:make('newPassword'),confirmPassword:make('confirmPassword')};break;
          case 'account-drop':formValue={kind:input.kind,confirmAccount:make('confirmAccount'),currentPassword:make('currentPassword')};break;
          case 'password-reset-confirm':formValue={kind:input.kind,resetCode:make('resetCode'),newPassword:make('newPassword'),confirmPassword:make('confirmPassword')};break;
          case 'account-register':formValue={kind:input.kind,email:make('email'),password:make('password'),confirmPassword:make('confirmPassword')};break;
          case 'account-verify':formValue={kind:input.kind,verificationCode:make('verificationCode')};break;
          default:invalid=true;
        }
        if(invalid||!formValue){wipePrivateSecurityValue(formValue);for(const bytes of values.values())bytes.fill(0);finish(null);return;}
        const formRef=randomRef();privateSecurityForms.set(formRef,{ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),requestId,kind:input.kind,bytes:formValue,account,expiresAt:Date.now()+120_000,used:false});
        finish({kind:input.kind,action:input.action,formRef,account,requestId,ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration)});
      },{once:true});
    });
  };
  const clearPrivateScheduledMessages=(ownerRef?:string,kind?:'create'|'edit'):void=>{
    for(const [ref,entry] of privateScheduledMessages){if((ownerRef===undefined||entry.ownerRef===ownerRef)&&(kind===undefined||entry.kind===kind)){if(entry.timer)clearTimeout(entry.timer);entry.bytes.fill(0);if(entry.admissionRef)scheduledCustody?.retireCreateAdmission(entry.admissionRef);privateScheduledMessages.delete(ref);}}
  };
  const requestPrivateScheduledMessage=async(input:PrivateScheduledMessageRequest):Promise<PrivateScheduledMessageReady|null>=>{
    const owner=snapshot(),requestId=makeRequestId(input?.requestId);
    if(!privatePromptAllowed(owner)||typeof document==='undefined'||!requestId||(input.kind!=='create'&&input.kind!=='edit')||input.ownerRef!==owner.ownerRef
      ||input.accountGeneration!==Number(owner.accountGeneration)||input.connectionGeneration!==Number(owner.connectionGeneration)||!isCurrent(owner)
      ||typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{1,96}$/u.test(input.operationId)
      ||typeof input.prefillFromComposer!=='boolean'||(input.kind==='edit'&&input.prefillFromComposer)
      ||typeof input.conversationId!=='string'||!makeConversationId(input.conversationId)||!Number.isSafeInteger(input.initialDueAtMs)
      ||input.initialDueAtMs<Date.now()||input.initialDueAtMs>Date.now()+366*24*60*60*1000)return null;
    const host=ensurePrivatePresentationHost('onyx-private-account-security');if(!host)return null;
    cancelPendingPrivateDialogs();
    const dialogToken=Symbol('scheduled-dialog');let reservationCancelled=false;
    pendingSecurityForm={ownerRef:owner.ownerRef,token:dialogToken,cancel:()=>{reservationCancelled=true;if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;}};
    const context:RequestContext={schemaVersion:1,requestId,owner};
    // Capture the cross-tab cancellation generation before exposing the editor.
    // The opaque admission remains in this closure and is only bound to the
    // private broker's inputRef after a valid submit.
    let admissionRef:ScheduledCreateAdmissionRef|null=null;
    try{admissionRef=input.kind==='create'?await scheduledCustody?.captureCreateAdmission(context,input.operationId)??null:null;}
    catch{if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;return null;}
    if(reservationCancelled||pendingSecurityForm?.token!==dialogToken||input.kind==='create'&&(!admissionRef||!isCurrent(owner))){if(admissionRef)scheduledCustody?.retireCreateAdmission(admissionRef);if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;return null;}
    if(!privatePromptAllowed(owner)){if(admissionRef)scheduledCustody?.retireCreateAdmission(admissionRef);if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;return null;}
    const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Schedule a private message');
    const heading=document.createElement('h2');heading.textContent=input.kind==='edit'?'Edit scheduled message':'Message to schedule';const form=document.createElement('form');
    const targetLabel=document.createElement('p');targetLabel.textContent=`Conversation: ${input.conversationId}`;
    const dueLabel=document.createElement('label');dueLabel.textContent='Send at';const dueField=document.createElement('input');dueField.type='datetime-local';dueField.required=true;dueField.step='60';
    const dueDate=new Date(input.initialDueAtMs);if(!Number.isFinite(dueDate.getTime())){if(admissionRef)scheduledCustody?.retireCreateAdmission(admissionRef);if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;return null;}
    const localDue=new Date(dueDate.getTime()-dueDate.getTimezoneOffset()*60_000);dueField.value=localDue.toISOString().slice(0,16);dueLabel.append(dueField);
    const label=document.createElement('label');label.textContent=input.kind==='edit'?'Replacement message':'Message';const field=document.createElement('textarea');field.maxLength=65_536;field.required=true;field.rows=6;label.append(field);form.append(targetLabel,dueLabel,label);
    field.addEventListener('input',()=>field.setCustomValidity(''));
    dueField.addEventListener('input',()=>dueField.setCustomValidity(''));
    let capturedComposerValue:string|null=null;let copiedFromComposer=false;
    if(input.kind==='create'&&input.prefillFromComposer){
      const composerField=document.querySelector('.onyx-composer textarea[aria-label="Message"], .onyx-composer input[aria-label="Message"]');
      if((composerField instanceof HTMLInputElement||composerField instanceof HTMLTextAreaElement)&&composerField.value){capturedComposerValue=composerField.value;field.value=capturedComposerValue;copiedFromComposer=true;}
    }
    const previous=[...privateScheduledMessages.values()].find(entry=>entry.ownerRef===owner.ownerRef&&entry.kind===input.kind&&entry.expiresAt>Date.now());
    if(previous){try{field.value=new TextDecoder('utf-8',{fatal:true}).decode(previous.bytes);copiedFromComposer=false;capturedComposerValue=null;}catch{previous.bytes.fill(0);}}
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Continue';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';form.append(submit,cancel);dialog.append(heading,form);host.replaceChildren(dialog);field.focus();
    return new Promise(resolve=>{
      let settled=false;let admissionBound=false;const finish=(value:PrivateScheduledMessageReady|null)=>{if(settled)return;settled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);field.value='';dueField.value='';dialog.remove();if(!admissionBound&&admissionRef)scheduledCustody?.retireCreateAdmission(admissionRef);if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;resolve(value);};
      const visibility=()=>{if(document.visibilityState!=='visible')finish(null);};const timer=setTimeout(()=>finish(null),120_000);
      pendingSecurityForm={ownerRef:owner.ownerRef,token:dialogToken,cancel:()=>finish(null)};document.addEventListener('visibilitychange',visibility);cancel.addEventListener('click',()=>{
        clearPrivateScheduledMessages(owner.ownerRef,input.kind);finish(null);
      },{once:true});
      form.addEventListener('submit',event=>{
        event.preventDefault();const current=snapshot();const value=field.value;
        const dueAtMs=new Date(dueField.value).getTime();
        if(!Number.isSafeInteger(dueAtMs)||dueAtMs<=Date.now()||dueAtMs>Date.now()+366*24*60*60*1000){dueField.setCustomValidity('Choose a future time within one year.');dueField.reportValidity();return;}
        dueField.setCustomValidity('');
        const bytes=new TextEncoder().encode(value);let malformedSurrogate=false;
        for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff)){malformedSurrogate=true;break;}i++;}else if(code>=0xdc00&&code<=0xdfff){malformedSurrogate=true;break;}}
        if(!isCurrent(owner)||current.ownerRef!==owner.ownerRef){bytes.fill(0);finish(null);return;}
        if(bytes.byteLength===0||bytes.byteLength>65_536||/[\u0000-\u0008\u000b-\u001f\u007f\r]/u.test(value)||malformedSurrogate){
          bytes.fill(0);field.setCustomValidity('Enter a message within the supported length without control characters.');field.reportValidity();return;
        }
        const prefilledComposer=copiedFromComposer&&capturedComposerValue!==null&&value===capturedComposerValue&&(()=>{const currentComposer=document.querySelector('.onyx-composer textarea[aria-label="Message"], .onyx-composer input[aria-label="Message"]');return (currentComposer instanceof HTMLInputElement||currentComposer instanceof HTMLTextAreaElement)&&currentComposer.value===capturedComposerValue;})();
        field.value='';
        const inputRef=randomRef();
        if(input.kind==='create'&&(!admissionRef||!scheduledCustody?.bindCreateAdmission(inputRef,admissionRef,context))){bytes.fill(0);finish(null);return;}
        admissionBound=input.kind==='create';
        clearPrivateScheduledMessages(owner.ownerRef,input.kind);const entry:{ownerRef:string;accountGeneration:number;connectionGeneration:number;requestId:RequestId;kind:'create'|'edit';operationId:string;admissionRef:ScheduledCreateAdmissionRef|null;bytes:Uint8Array;expiresAt:number;used:boolean;timer:ReturnType<typeof setTimeout>|null}={ownerRef:owner.ownerRef,
          accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),requestId,kind:input.kind,operationId:input.operationId,admissionRef:input.kind==='create'?admissionRef:null,bytes,expiresAt:Date.now()+120_000,used:false,timer:null};
        entry.timer=setTimeout(()=>{if(privateScheduledMessages.get(inputRef)===entry){entry.bytes.fill(0);if(entry.admissionRef)scheduledCustody?.retireCreateAdmission(entry.admissionRef);privateScheduledMessages.delete(inputRef);}},120_000);
        privateScheduledMessages.set(inputRef,entry);
        finish({...input,inputRef,dueAtMs,prefilledComposer,ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration)});
      });
    });
  };
  const readPrivateScheduledMessage=async(inputRef:string,context:RequestContext,kind:'create'|'edit'):Promise<Uint8Array|null>=>{
    const entry=privateScheduledMessages.get(inputRef);if(!entry||entry.used||entry.requestId!==context.requestId||entry.ownerRef!==context.owner.ownerRef
      ||entry.accountGeneration!==Number(context.owner.accountGeneration)||entry.connectionGeneration!==Number(context.owner.connectionGeneration)
      ||entry.kind!==kind||entry.expiresAt<=Date.now()||!isCurrent(context.owner))return null;
    entry.used=true;return entry.bytes.slice();
  };
  const settlePrivateScheduledMessage=(inputRef:string,context:RequestContext,saved:boolean):void=>{
    const entry=privateScheduledMessages.get(inputRef);if(!entry||entry.requestId!==context.requestId||entry.ownerRef!==context.owner.ownerRef)return;
    if(saved){if(entry.timer)clearTimeout(entry.timer);entry.bytes.fill(0);if(entry.admissionRef)scheduledCustody?.retireCreateAdmission(entry.admissionRef);privateScheduledMessages.delete(inputRef);}
  };
  const requestPrivateAccountForm=(input:PrivateAccountFormRequest):Promise<PrivateAccountFormReady|null>=>{
    const owner=snapshot(),requestId=makeRequestId(input.requestId);
    const managementKinds=['account-email','account-password','account-certificate-reset','account-drop','password-reset-confirm','account-register','account-verify'];
    if(managementKinds.includes(input.kind))return requestPrivateManagementForm(input,owner,requestId!);
    const compatible=(input.kind==='totp-code'&&input.action==='totp-confirm')||(input.kind==='recovery-password'&&(input.action==='recovery-generate'||input.action==='recovery-clear'))
      ||(input.kind==='recovery-code'&&input.action==='recovery-login');
    if(!privatePromptAllowed(owner)||typeof document==='undefined'||!requestId||input.ownerRef!==owner.ownerRef||input.accountGeneration!==Number(owner.accountGeneration)
      ||input.connectionGeneration!==Number(owner.connectionGeneration)||owner.accountId===null||!compatible||input.account!==null)return Promise.resolve(null);
    const host=ensurePrivatePresentationHost('onyx-private-account-security');if(!host)return Promise.resolve(null);
    cancelPendingPrivateDialogs();
    clearPrivatePasswords(owner.ownerRef);
    const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label',input.kind==='totp-code'?'Two-factor authentication code':input.kind==='recovery-code'?'Recovery code':'Recovery code password');
    const heading=document.createElement('h2');heading.textContent=input.kind==='totp-code'?'Enter your authenticator code':input.kind==='recovery-code'?'Use a recovery code':'Set a recovery-code password';
    const form=document.createElement('form');const label=document.createElement('label');label.textContent=input.kind==='recovery-password'?'Optional password':'Code';
    const field=document.createElement('input');field.type=input.kind==='recovery-password'?'password':'text';field.autocomplete=input.kind==='totp-code'?'one-time-code':'off';
    field.maxLength=input.kind==='totp-code'?8:input.kind==='recovery-code'?128:1024;field.required=input.kind!=='recovery-password';
    label.append(field);form.append(label);
    let accountField:HTMLInputElement|null=null;
    if(input.kind==='recovery-code'){const accountLabel=document.createElement('label');accountLabel.textContent='Account';accountField=document.createElement('input');accountField.type='text';accountField.autocomplete='username';accountField.maxLength=64;accountField.required=true;accountLabel.append(accountField);form.append(accountLabel);}
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Continue';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';form.append(submit,cancel);dialog.append(heading,form);host.replaceChildren(dialog);field.focus();
    return new Promise<{readonly kind:PrivateSecurityFormKind;readonly action:typeof input.action;readonly formRef:string;readonly account:string|null;readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}|null>(resolve=>{
      const dialogToken=Symbol('security-dialog');
      let settled=false;const finish=(value:{readonly kind:PrivateSecurityFormKind;readonly action:typeof input.action;readonly formRef:string;readonly account:string|null;readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}|null)=>{
        if(settled)return;settled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);field.value='';if(accountField)accountField.value='';dialog.remove();if(pendingSecurityForm?.token===dialogToken)pendingSecurityForm=null;resolve(value);
      };
      const visibility=()=>{if(document.visibilityState!=='visible')finish(null);};
      const timer=setTimeout(()=>finish(null),120_000);pendingSecurityForm={ownerRef:owner.ownerRef,token:dialogToken,cancel:()=>finish(null)};
      document.addEventListener('visibilitychange',visibility);cancel.addEventListener('click',()=>finish(null),{once:true});
      form.addEventListener('submit',event=>{
        event.preventDefault();const value=field.value;field.value='';const bytes=new TextEncoder().encode(value);const account=accountField?.value.trim()??null;if(accountField)accountField.value='';
        const current=snapshot();const controls=Array.from(value,character=>character.codePointAt(0)??0).some(code=>code<0x20||code===0x7f);
        if(!isCurrent(owner)||current.ownerRef!==owner.ownerRef||!isVisibleFormValue(input.kind,bytes.byteLength,controls)
          ||(input.kind==='recovery-code'&&(!account||!/^[A-Za-z0-9_.-]{1,64}$/u.test(account)))){bytes.fill(0);finish(null);return;}
        const formRef=randomRef();privateSecurityForms.set(formRef,{ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),requestId,kind:input.kind,bytes:bytes.byteLength?bytes:null,account,expiresAt:Date.now()+120_000,used:false});
        while(privateSecurityForms.size>8){const oldest=privateSecurityForms.keys().next().value as string|undefined;if(!oldest)break;const stale=privateSecurityForms.get(oldest);if(stale)wipePrivateSecurityValue(stale.bytes);privateSecurityForms.delete(oldest);}
        finish({kind:input.kind,action:input.action,formRef,account,requestId,ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration)});
      },{once:true});
    });
  };
  const isVisibleFormValue=(kind:PrivateSecurityFormKind,length:number,controls:boolean):boolean=>!controls&&length<=(kind==='recovery-password'?1024:128)
    &&(kind==='recovery-password'||length>0);
  const readAndClearPrivateForm=async(formRef:string,context:RequestContext,kind:PrivateSecurityFormKind):Promise<Uint8Array|PrivateAccountManagementForm|null>=>{
    const entry=privateSecurityForms.get(formRef);
    if(!entry||entry.used||entry.kind!==kind||entry.ownerRef!==context.owner.ownerRef||entry.requestId!==context.requestId
      ||entry.accountGeneration!==Number(context.owner.accountGeneration)||entry.connectionGeneration!==Number(context.owner.connectionGeneration)
      ||entry.expiresAt<=Date.now()||!isCurrent(context.owner))return null;
    entry.used=true;privateSecurityForms.delete(formRef);
    const value=entry.bytes instanceof Uint8Array?entry.bytes.slice():entry.bytes?Object.fromEntries(Object.entries(entry.bytes).map(([key,bytes])=>[key,bytes.slice()])) as unknown as PrivateAccountManagementForm:kind==='recovery-password'?new Uint8Array(0):null;
    wipePrivateSecurityValue(entry.bytes);entry.bytes=null;return value;
  };
  const privatePasswordToken=(ref:string,owner:OwnerSnapshot,purpose:PrivatePasswordPurpose):symbol|null=>{
    const entry=privatePasswords.get(ref);
    if(!entry||entry.ownerRef!==owner.ownerRef||entry.purpose!==purpose||entry.expiresAt<=Date.now()||!isCurrent(owner))return null;
    const token=Symbol('private-password');privatePasswordTokens.set(token,{ref,ownerRef:owner.ownerRef,purpose});return token;
  };
  const presentPrivateWebhook=(owner:OwnerSnapshot,room:string,url:string):boolean=>{
    if(typeof document==='undefined'||!privatePromptAllowed(owner))return false;
    let parsed:URL;try{parsed=new URL(url);}catch{return false;}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||url.length>4096)return false;
    clearWebhookPresentationForOwner(owner.ownerRef);
    const host=ensurePrivatePresentationHost('onyx-private-runtime-presentation');if(!host)return false;
    const section=document.createElement('section');section.setAttribute('aria-label','One-time webhook URL');
    const heading=document.createElement('h2');heading.textContent='Webhook URL';
    const message=document.createElement('p');message.textContent=`Created for ${room}. This URL is shown once. Store it somewhere private.`;
    const secret=document.createElement('code');secret.setAttribute('dir','ltr');secret.textContent=url;
    const copy=document.createElement('button');copy.type='button';copy.textContent='Copy URL';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Dismiss';
    section.append(heading,message,secret,copy,dismiss);host.replaceChildren(section);
    const ref=randomRef();const timer=setTimeout(()=>clearWebhookPresentationForOwner(owner.ownerRef),60_000);
    privateWebhookUrls.set(ref,{ownerRef:owner.ownerRef,room,url,expiresAt:Date.now()+60_000,timer});
    const clear=()=>{clearTimeout(timer);url='';secret.textContent='';section.remove();privateWebhookUrls.delete(ref);};
    clearPrivateWebhookPresentation=clear;
    copy.addEventListener('click',()=>{if(!isCurrent(owner)||!url)return;void navigator.clipboard?.writeText(url).then(()=>{copy.textContent='Copied';clear();}).catch(()=>{copy.textContent='Copy unavailable';});});
    dismiss.addEventListener('click',clear);
    return true;
  };
  const openPrivateOutHookInput=(input:{readonly context:RequestContext;
    readonly onSubmit:(value:{readonly url:string;readonly secret:string;readonly categories:string})=>void;
    readonly onCancel:()=>void}):(()=>void)|null=>{
    const {context}=input;const owner=context.owner;
    if(typeof document==='undefined'||activationBarrier||activePrivateIntegrationForms>0||!isCurrent(owner)||!transport.isOpen()||!learnedPrefix)return null;
    cancelPendingPrivateDialogs();
    const host=ensurePrivatePresentationHost('onyx-private-runtime-presentation');if(!host)return null;
    const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label','Add outbound hook');
    const heading=document.createElement('h2');heading.textContent='Add outbound hook';
    const description=document.createElement('p');description.textContent='The URL and secret stay in this browser and are sent only to the connected Onyx Server.';
    const form=document.createElement('form');
    const urlLabel=document.createElement('label');urlLabel.textContent='Webhook URL';
    const urlField=document.createElement('input');urlField.type='text';urlField.inputMode='url';urlField.setAttribute('autocomplete','url');urlField.required=true;urlField.maxLength=2048;
    urlLabel.append(urlField);
    const secretLabel=document.createElement('label');secretLabel.textContent='Webhook secret';
    const secretField=document.createElement('input');secretField.type='password';secretField.autocomplete='new-password';secretField.required=true;secretField.maxLength=4096;
    secretLabel.append(secretField);
    const categoriesLabel=document.createElement('label');categoriesLabel.textContent='Categories (comma separated)';
    const categoriesField=document.createElement('input');categoriesField.type='text';categoriesField.autocomplete='off';categoriesField.maxLength=512;
    categoriesLabel.append(categoriesField);
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Continue';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
    form.append(urlLabel,secretLabel,categoriesLabel,submit,cancel);dialog.append(heading,description,form);host.replaceChildren(dialog);
    activePrivateIntegrationForms+=1;
    let settled=false;let timer:ReturnType<typeof setTimeout>|null=null;
    const finish=(cancelled:boolean):void=>{
      if(settled)return;settled=true;if(timer!==null)clearTimeout(timer);timer=null;
      urlField.value='';secretField.value='';categoriesField.value='';dialog.remove();
      activePrivateIntegrationForms=Math.max(0,activePrivateIntegrationForms-1);
      if(cancelled)try{input.onCancel();}catch{/* isolate private form observer */}
    };
    timer=setTimeout(()=>finish(true),120_000);
    form.addEventListener('submit',event=>{
      event.preventDefault();const url=urlField.value;const secret=secretField.value;
      const categories=categoriesField.value;
      urlField.value='';secretField.value='';categoriesField.value='';
      if(!isCurrent(owner)||activationBarrier||context.requestId.length<22){finish(true);return;}
      finish(false);
      try{input.onSubmit({url,secret,categories});}catch{/* rejected private values are not surfaced */}
    },{once:true});
    cancel.addEventListener('click',()=>finish(true),{once:true});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();finish(true);}});
    urlField.focus();
    return ()=>finish(true);
  };
  const presentPrivateOutHook=(input:{readonly context:RequestContext;readonly url:string;readonly onClose:()=>void}):(()=>void)|null=>{
    const {context}=input;const owner=context.owner;const url=input.url;
    if(typeof document==='undefined'||activationBarrier||activePrivateIntegrationForms>0||!isCurrent(owner)||!transport.isOpen()||!learnedPrefix
      ||new TextEncoder().encode(url).byteLength>512||/[\u0000-\u001f\u007f]/u.test(url))return null;
    let parsed:URL;try{parsed=new URL(url);}catch{return null;}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)return null;
    cancelPendingPrivateDialogs();
    const host=ensurePrivatePresentationHost('onyx-private-runtime-presentation');if(!host)return null;
    const section=document.createElement('section');section.setAttribute('role','dialog');section.setAttribute('aria-modal','true');
    section.setAttribute('aria-label','Outbound hook URL');
    const heading=document.createElement('h2');heading.textContent='Outbound hook URL';
    const description=document.createElement('p');description.textContent='This private URL is shown only in this browser. Copy it only to a trusted destination.';
    const value=document.createElement('code');value.setAttribute('dir','ltr');value.textContent=url;
    const copy=document.createElement('button');copy.type='button';copy.textContent='Copy URL';
    const close=document.createElement('button');close.type='button';close.textContent='Close';
    section.append(heading,description,value,copy,close);host.replaceChildren(section);activePrivateIntegrationForms+=1;
    let closed=false;let timer:ReturnType<typeof setTimeout>|null=null;
    const finish=():void=>{if(closed)return;closed=true;if(timer!==null)clearTimeout(timer);timer=null;value.textContent='';section.remove();
      activePrivateIntegrationForms=Math.max(0,activePrivateIntegrationForms-1);
      const owned=privateOutHookPresentations.get(owner.ownerRef);owned?.delete(finish);if(owned?.size===0)privateOutHookPresentations.delete(owner.ownerRef);
      try{input.onClose();}catch{/* private observer isolation */}};
    let owned=privateOutHookPresentations.get(owner.ownerRef);if(!owned){owned=new Set();privateOutHookPresentations.set(owner.ownerRef,owned);}owned.add(finish);
    timer=setTimeout(finish,60_000);
    copy.addEventListener('click',()=>{if(!isCurrent(owner)||closed)return;void navigator.clipboard?.writeText(url).then(()=>{copy.textContent='Copied';finish();}).catch(()=>{copy.textContent='Copy unavailable';});});
    close.addEventListener('click',finish);
    return finish;
  };
  const trustedEndpoints = new Set(config.trustedEndpoints.map(value => makeEndpointId(value)).filter((value): value is EndpointId => value !== null));
  const storage = (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const identity = createIdentityOwner({ ownerSnapshot: snapshot, isCurrent,storage,
    issuerEndpointId:()=>endpointId,isTrustedIssuer:(network,endpoint)=>network===networkId&&endpoint===endpointId&&trustedEndpoints.has(endpoint),
    isAuthContextCurrent:(ref,context)=>{const saved=saslContexts.get(ref);const mechanisms=capabilityValues.get('sasl')??'';
      return !!saved&&isCurrent(context.owner)&&isCurrent(saved)&&saved.ownerRef===context.owner.ownerRef&&saved.physicalRef===context.owner.physicalRef
        &&advertisedCapabilities.has('sasl')&&/(?:^|[\s,])SESSION-TOKEN(?:$|[\s,])/iu.test(mechanisms)&&transport.isCurrent(context.owner);},randomRef,
    onPrivateAccountLine:(line,owner)=>{const prefix=learnedPrefix;if(prefix)privateAccountSecurity?.ingest({line,owner,serverPrefix:prefix});} });
  let credentials: ReturnType<typeof createCredentialOwner>;
  const transport = createTransportOwner({
    currentOwner: snapshot,
    isCurrentOwner: isCurrent,
    authenticatedPrefix: () => learnedPrefix,
    onWelcomeCandidate: (line, owner) => {
      const welcome = /^:([^\s]+) 001\s+(\S+)/u.exec(line);
      if (!welcome?.[1] || !welcome[2] || /[!@\u0000-\u001f\u007f]/u.test(welcome[1])
        || owner.connectionGeneration !== connectionGeneration || owner.physicalRef !== physicalRef) return;
      if (learnedPrefix !== null && learnedPrefix !== welcome[1]) { pendingAccountProof = null; transport.close(); return; }
      if (tentativeServerPrefix !== null && tentativeServerPrefix !== welcome[1]) { pendingAccountProof = null; transport.close(); return; }
      learnedPrefix = welcome[1]; currentNick = welcome[2];
      const currentOwner = snapshot();
      identity.learnServerPrefix(learnedPrefix,currentOwner);
      credentials.learnServerPrefix(learnedPrefix,currentOwner);
    },
    endpoint: () => endpointId,
    ...(config.mediaReady ? { mediaReady: config.mediaReady } : {}),
    beforeIngressLine: beforePublicIngressLine,
    beforeSend: beforePublicIngressSend,
    consumePrivateLine: (line, prefix, owner) => credentials.consumePrivateLine(line, prefix, owner),
    onPublicLine: (line, owner) => {
      const parsed = parseIRCMessage(line);
      let publishLine = true;
      let capabilityResolution: { roundRef: string; names: string[]; result: 'ack' | 'nak' | 'del'; owner: OwnerSnapshot } | null = null;
      if (parsed.command === 'CAP' && owner.connectionGeneration === connectionGeneration && owner.physicalRef === physicalRef) {
        const source = parsed.prefix;
        const subcommand = parsed.params[1]?.toUpperCase();
        const serverShaped = !!source && source.length <= 512 && !/[!@\s\u0000-\u001f\u007f]/u.test(source);
        const sourceMatches = serverShaped && (learnedPrefix !== null ? source === learnedPrefix : tentativeServerPrefix !== null ? source === tentativeServerPrefix : subcommand === 'LS');
        publishLine = !!sourceMatches;
        if (sourceMatches && source) {
          if (tentativeServerPrefix === null) tentativeServerPrefix = source;
          const lsContinuation = subcommand === 'LS' && parsed.params[2] === '*';
          const tail = parsed.params.slice(lsContinuation ? 3 : 2).join(' ').trim();
          const rawCapTokens = tail.split(/\s+/u).filter(Boolean);
          const tokens = rawCapTokens.map(token => validCapToken(token)?.name ?? '').filter(Boolean);
          if (subcommand === 'LS') {
            if(capabilityInventoryPoisoned){publishLine=false;}
            else {
              if(!stagedCapabilityInventory){
                stagedCapabilityInventory=new Map();stagedCapabilityBytes=0;stagedCapabilityOwner=owner;
                capabilityStageTimer=setTimeout(()=>{
                  if(stagedCapabilityInventory&&stagedCapabilityOwner&&isCurrent(stagedCapabilityOwner)
                    &&stagedCapabilityOwner.physicalRef===physicalRef)poisonCapabilityInventory(stagedCapabilityOwner);
                },30_000);
              }
              if(!stagedCapabilityOwner||stagedCapabilityOwner.ownerRef!==owner.ownerRef||stagedCapabilityOwner.physicalRef!==owner.physicalRef){
                poisonCapabilityInventory(owner);publishLine=false;
              }else{
                let valid=true;let nextBytes=stagedCapabilityBytes;
                for(const token of rawCapTokens){const parsedToken=validCapToken(token);const changed=parsedToken?applyCapToken(stagedCapabilityInventory,token,nextBytes):null;if(changed===null){valid=false;break;}nextBytes=changed;}
                stagedCapabilityBytes=nextBytes;
                if(!valid){poisonCapabilityInventory(owner);publishLine=false;}
                else if(!lsContinuation){
                  const complete=stagedCapabilityInventory;
                  clearCapabilityStage();advertisedCapabilities.clear();capabilityValues.clear();
                  for(const [name,value] of complete){advertisedCapabilities.add(name);if(value!==null)capabilityValues.set(name,value);}
                  if (learnedPrefix !== null) {
                    pendingNewCapabilities.clear();
                    [...advertisedCapabilities].filter(name => RUNTIME_CAPS.has(name) && !negotiatedCapabilities.has(name)).forEach(name => pendingNewCapabilities.add(name));
                    publishFeatureReadiness();
                  }
                }
              }
            }
          } else if (subcommand === 'NEW') {
            if(capabilityInventoryPoisoned){publishLine=false;}
            else {
              const next=new Map<string,string|null>([...advertisedCapabilities].map(name=>[name,capabilityValues.get(name)??null]));
              let valid=true;let nextBytes=capInventoryBytes(next);for(const token of rawCapTokens){const changed=applyCapToken(next,token,nextBytes);if(changed===null){valid=false;break;}nextBytes=changed;}
              if(!valid){poisonCapabilityInventory(owner);publishLine=false;}
              else {advertisedCapabilities.clear();capabilityValues.clear();for(const [name,value] of next){advertisedCapabilities.add(name);if(value!==null)capabilityValues.set(name,value);}
                [...next.keys()].filter(name => rawCapTokens.some(token=>validCapToken(token)?.name===name)&&RUNTIME_CAPS.has(name)&&!negotiatedCapabilities.has(name)).forEach(name => pendingNewCapabilities.add(name));
                publishFeatureReadiness();}
            }
          } else if (subcommand === 'DEL') {
            tokens.forEach(name => {advertisedCapabilities.delete(name);capabilityValues.delete(name);});
            tokens.forEach(name => negotiatedCapabilities.delete(name));
            tokens.forEach(name => pendingNewCapabilities.delete(name));
            const round = activeFeatureRoundRef ? featureRounds.get(activeFeatureRoundRef) : undefined;
            if (round && !round.ended && round.emittedRequest) {
              const retired = tokens.filter(name => round.unresolved.delete(name));
              if (retired.length > 0) capabilityResolution = { roundRef: activeFeatureRoundRef!, names: retired, result: 'del', owner: round.owner };
            }
            if (featureReady.e2ee || featureReady.media) globalThis.setTimeout(() => { if (!disposed && owner.connectionGeneration === connectionGeneration && owner.physicalRef === physicalRef) publishFeatureReadiness(); }, 0);
          } else if (subcommand === 'ACK' || subcommand === 'NAK') {
            if(subcommand==='ACK')tokens.filter(name=>!name.startsWith('-')&&advertisedCapabilities.has(name)).forEach(name=>negotiatedCapabilities.add(name));
            if(subcommand==='NAK')tokens.forEach(name=>negotiatedCapabilities.delete(name));
            const round = activeFeatureRoundRef ? featureRounds.get(activeFeatureRoundRef) : undefined;
            if (round && !round.ended && round.emittedRequest) {
              if (subcommand === 'ACK') {
                const acknowledged = tokens.filter(name => round.unresolved.has(name) && !name.startsWith('-') && advertisedCapabilities.has(name));
                acknowledged.forEach(name => round.unresolved.delete(name));
                acknowledged.forEach(name => pendingNewCapabilities.delete(name));
                acknowledged.forEach(name => negotiatedCapabilities.add(name));
                if (acknowledged.length > 0) capabilityResolution = { roundRef: activeFeatureRoundRef!, names: acknowledged, result: 'ack', owner: round.owner };
              } else {
                const requested = [...round.requested].sort();
                const rejected = [...tokens].sort();
                if (tokens.every(name => !name.startsWith('-')) && requested.length === rejected.length && requested.every((name, index) => name === rejected[index])) {
                  round.unresolved.clear();
                  round.requested.forEach(name => pendingNewCapabilities.delete(name));
                  capabilityResolution = { roundRef: activeFeatureRoundRef!, names: [...round.requested], result: 'nak', owner: round.owner };
                }
              }
            }
          }
        }
      }
      const welcome = /^:([^\s]+) 001(?:\s|$)/u.exec(line);
      if (welcome?.[1] && !/[!@\u0000-\u001f\u007f]/u.test(welcome[1]) && owner.connectionGeneration === connectionGeneration && owner.physicalRef === physicalRef) {
        if (learnedPrefix === null) {
          if (tentativeServerPrefix !== null && tentativeServerPrefix !== welcome[1]) { pendingAccountProof = null; transport.close(); return; }
          learnedPrefix = welcome[1];
          currentNick = parsed.params[0] ?? currentNick;
          const currentOwner = snapshot();
          identity.learnServerPrefix(learnedPrefix, currentOwner);
          credentials.learnServerPrefix(learnedPrefix, currentOwner);
        } else if (learnedPrefix !== welcome[1]) {
          pendingAccountProof = null;
          transport.close();
          return;
        }
        if (learnedPrefix === welcome[1]) {
          currentNick = parsed.params[0] ?? currentNick;
          const stagedProof = pendingAccountProof;
          pendingAccountProof = null;
          if (stagedProof
            && stagedProof.ownerRef === owner.ownerRef
            && stagedProof.accountGeneration === Number(owner.accountGeneration)
            && stagedProof.connectionGeneration === Number(owner.connectionGeneration)
            && stagedProof.physicalRef === owner.physicalRef
            && stagedProof.serverPrefix === learnedPrefix
            && !!currentNick
            && normalizeCase(stagedProof.recipient, caseMapping ?? 'ascii') === normalizeCase(currentNick, caseMapping ?? 'ascii')) {
            applyProvenAccount(stagedProof.account);
          }
          facts?.onRegistered({ owner: snapshot() });
          if (accountId === null) initializeDefaultWorkspace(snapshot());
          startScheduledDuePump();
        }
      }
      // RPL_LOGGEDIN precedes 001 during SASL. Stage a success only against
      // the tentative server source/current physical owner, then grant account
      // authority once 001 confirms that exact server prefix and recipient.
      // Once registered, the same complete source-shaped reply can apply now.
      const loggedInRecipient=parsed.command==='900'?parsed.params[0]:null;
      const loggedInDisplayName=parsed.command==='900'?parsed.params[1]:null;
      const loggedInAccount=parsed.command==='900'?parsed.params[2]:null;
      const loggedInHasTrailingText=parsed.command==='900'&&parsed.params.length>=4&&parsed.params[3]!.length>0;
      const serverPrefix=parsed.prefix;
      const validServerSource=!!serverPrefix&&!/[!@\s\u0000-\u001f\u007f]/u.test(serverPrefix)
        &&(learnedPrefix!==null?serverPrefix===learnedPrefix:tentativeServerPrefix===null||serverPrefix===tentativeServerPrefix);
      const currentNickMatches=!!loggedInRecipient&&!!currentNick
        &&normalizeCase(loggedInRecipient,caseMapping??'ascii')===normalizeCase(currentNick,caseMapping??'ascii');
      if(parsed.command==='900'&&validServerSource&&serverPrefix&&isCurrent(owner)
        &&owner.connectionGeneration===connectionGeneration&&owner.physicalRef===physicalRef
        &&!!loggedInDisplayName&&!!loggedInAccount&&loggedInHasTrailingText){
        const account=makeAccountId(loggedInAccount);
        if(account&&learnedPrefix!==null&&serverPrefix===learnedPrefix&&currentNickMatches)applyProvenAccount(account);
        else if(account&&learnedPrefix===null&&loggedInRecipient&&serverPrefix===tentativeServerPrefix){
          pendingAccountProof={ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),physicalRef:owner.physicalRef,serverPrefix,recipient:loggedInRecipient,account};
        }
      }
      const loggedOut = /^:([^\s]+) 901(?:\s|$)/u.exec(line);
      if (loggedOut?.[1] && learnedPrefix === loggedOut[1] && owner.connectionGeneration === connectionGeneration) {
        applyProvenAccount(null);
      }
      if (parsed.command === 'NICK' && parsed.nick && parsed.params[0] && parsed.nick.toLowerCase() === currentNick?.toLowerCase()) currentNick = parsed.params[0];
      // CASEMAPPING is a server-authoritative part of target identity. Persisted
      // key scheme revisions stay stable across reconnects; this independent
      // generation fences asynchronous work across changes, including ABA.
      if (parsed.command === '005' && learnedPrefix !== null && parsed.prefix === learnedPrefix
        && owner.connectionGeneration === connectionGeneration && owner.physicalRef === physicalRef) {
        const tokens = parsed.params.slice(1).flatMap(value => value.split(/\s+/u));
        for (const token of tokens) {
          if (/^-?VAPID(?:=|$)/iu.test(token)) {
            const nextKey = token.startsWith('-') ? null
              : token.includes('=') ? parseVapidIsupport(token.slice(token.indexOf('=') + 1)) : null;
            const priorKey = advertisedVapidKey;
            const sameKey = priorKey === null && nextKey === null || priorKey !== null && nextKey !== null
              && priorKey.length === nextKey.length && priorKey.every((byte,index)=>byte===nextKey[index]);
            advertisedVapidKey = nextKey;
            if (!sameKey) pushConsentRefs.clear();
          }
          if (/^-?STATUSMSG(?:=|$)/iu.test(token)) {
            const raw=token.startsWith('-')?null:token.includes('=')?token.slice(token.indexOf('=')+1):'';
            statusMessagePrefixes=new Set(Array.from(raw??'').filter(char=>/^[!.@+]$/u.test(char)));
          }
          if (/^-?CASEMAPPING(?:=|$)/iu.test(token)) {
            const raw = token.startsWith('-') ? null : token.includes('=') ? token.slice(token.indexOf('=') + 1).toLowerCase() : null;
            const next: ConversationKeyScheme['name'] | null = raw === 'ascii' || raw === 'rfc1459' || raw === 'strict-rfc1459' ? raw : null;
            if (next !== caseMapping) {
              caseMapping = next;
              mappingGeneration += 1;
              featureReady = { ...featureReady, e2ee: false };
              publishFeatureReadiness();
              if (next !== null) void initializeDefaultWorkspace(snapshot());
            }
          }
        }
      }
      if (publishLine) publishPublicIngressLine(line, owner, Date.now(), parsed);
      if (capabilityResolution) config.onCapabilityResolution?.({ roundRef: capabilityResolution.roundRef, names: capabilityResolution.names, result: capabilityResolution.result, ownerRef: capabilityResolution.owner.ownerRef, accountGeneration: Number(capabilityResolution.owner.accountGeneration), connectionGeneration: Number(capabilityResolution.owner.connectionGeneration) });
    },
    onBinary: () => {},
    onState: (state, sourceOwner) => {
      if(state==='offline'&&physicalStarted&&isCurrent(sourceOwner))retirePhysicalOwner(sourceOwner);
      config.onConnectionState?.(state, currentUrl);
    },
  });
  closeForCapabilityFailure=()=>retirePhysicalOwner(snapshot(),true);
  const runtimeSendSaslPayload=(payload:string,authContextRef:string):SendAdmission=>{
    const owner=saslContexts.get(authContextRef);
    if(!owner||!isCurrent(owner)||typeof payload!=='string'||payload.length<1||payload.length>32_768||!/^[A-Za-z0-9+/=]+$/u.test(payload))return {kind:'blocked',reason:'invalid-intent'};
    const chunks:string[]=[];for(let offset=0;offset<payload.length;offset+=400)chunks.push(payload.slice(offset,offset+400));
    if(payload.length%400===0)chunks.push('+');
    for(const chunk of chunks){const requestId=makeRequestId(randomRef());if(!requestId)return {kind:'blocked',reason:'invalid-intent'};
      const result=transport.sendLine({line:`AUTHENTICATE ${chunk}`,owner,requestId});if(result.kind!=='transport-admitted')return result;}
    return {kind:'transport-admitted'};
  };
  const browserLifecycle = createBrowserLifecycle();
  const metrics = createMetrics();
  metrics.start({ contextRef: snapshot().ownerRef });
  const browserLifecycleSubscription = browserLifecycle.subscribe((state, event) => {
    if (event.kind === 'pagehide' || event.kind === 'freeze' || (event.kind === 'visibility' && !state.visibility)) {
      const current = snapshot();
      captureBroker.retireOwner(current);
      captureIntentRefs.clear();
    }
  });
  const platformStore = createPlatformPrivateStore(typeof indexedDB === 'undefined' ? null : indexedDB,isCurrent);
  const notificationAdapter = createBrowserNotificationAdapter(typeof navigator === 'undefined' ? null : navigator.serviceWorker ?? null);
  const buildCompatibility = config.buildCompatibility ?? null;
  const runtimePushConfig = () => ({
    enabled: advertisedVapidKey !== null && !!buildCompatibility
      && typeof navigator !== 'undefined' && !!navigator.serviceWorker
      && typeof Notification !== 'undefined' && typeof PushManager !== 'undefined',
    vapidPublicKey: advertisedVapidKey?.slice() ?? null,
    node: endpointId,
  });
  const platform = buildCompatibility ? {
    serviceWorker: typeof navigator === 'undefined' ? null : navigator.serviceWorker ?? null,
    notifications: notificationAdapter,
    privateStore: platformStore,
    now: () => Date.now(),
    schedule: (fn:()=>void,ms:number) => { const timer=globalThis.setTimeout(fn,ms); return () => globalThis.clearTimeout(timer); },
    build: buildCompatibility,
    endpoint: () => endpointId,
    getPushConfig: runtimePushConfig,
    privateSendWebPush: (intent: import('./push-lifecycle').PrivatePushWireIntent): SendAdmission => {
      const owner=intent.owner; const node=runtimePushConfig().node;
      if(!isCurrent(owner)||intent.node!==node||owner.accountId===null)return {kind:'blocked',reason:'owner-changed'};
      let line:string;
      if(intent.verb==='subscribe'){
        const payload=intent.subscription.toJSON();const endpoint=intent.subscription.endpoint;const p256dh=payload.keys?.p256dh;const auth=payload.keys?.auth;
        if(!endpoint||!p256dh||!auth||/\s|[\u0000-\u001f\u007f]/u.test(endpoint)||!/^[A-Za-z0-9_-]{1,256}$/u.test(p256dh)||!/^[A-Za-z0-9_-]{1,256}$/u.test(auth))return {kind:'blocked',reason:'invalid-intent'};
        line=`WEBPUSH SUBSCRIBE ${endpoint} ${p256dh} ${auth}`;
      }else{
        if(!intent.endpoint||/\s|[\u0000-\u001f\u007f]/u.test(intent.endpoint))return {kind:'blocked',reason:'invalid-intent'};
        line=`WEBPUSH UNSUBSCRIBE ${intent.endpoint}`;
      }
      const requestId=makeRequestId(randomRef());if(!requestId)return {kind:'blocked',reason:'invalid-intent'};
      return transport.sendLine({line,owner,requestId});
    },
  } : null;
  type ActivationLeaseRequest={readonly targetBuildId:string;readonly requestId:RequestId};
  let acquireRuntimeActivationLease:(input:ActivationLeaseRequest)=>Promise<(()=>void)|null>=async()=>null;
  const workerClientRef=randomRef();
  const workerLifecycle=platform?createWorkerLifecycle({ownerSnapshot:snapshot,isCurrent,platform,currentClientRef:workerClientRef,
    acquireActivationLease:input=>acquireRuntimeActivationLease(input)}):null;
  const pushLifecycle=platform?createPushLifecycle({ownerSnapshot:snapshot,isCurrent,platform,indexedDB:typeof indexedDB==='undefined'?null:indexedDB,
    crypto:typeof crypto==='undefined'?null:crypto}):null;
  const notificationBindingRefs = new Map<string,{readonly networkId:NetworkId;readonly accountId:AccountId}>();
  const notificationRouteRefs = new Map<string,{readonly owner:OwnerSnapshot;readonly route:AllowedNotificationRoute}>();
  const notificationRouter = platform && buildCompatibility ? createNotificationRouter({ ownerSnapshot:snapshot,isCurrent,transport,
    notifications:notificationAdapter,networkId:()=>networkId,
    applicationOrigin:typeof location==='undefined'?'https://invalid.local':location.origin,
    allowedApplicationPaths:buildCompatibility.publicNavigationPaths,
    encodeApplicationRoute:route=>route.kind==='inbox'?'/app/':config.encodeNotificationRoute?.(route)??null,
    ...(config.navigateNotificationRoute ? { navigate: config.navigateNotificationRoute } : {}),
    resolveBindingRef:bindingRef=>notificationBindingRefs.get(bindingRef)??null,
  }):null;
  const serviceWorkerMessages = (event: MessageEvent): void => {
    const data=event.data as unknown;
    if(!isRecord(data)||data.schemaVersion!==1||data.type!=='PENDING_NOTIFICATION_ROUTE')return;
    // The worker message is only a wake-up signal. Route contents are claimed
    // through the private worker RPC after the current account is established.
    pendingNotificationClick=true;
    claimPendingNotificationRoute();
  };
  const serviceWorkerContainer=platform?.serviceWorker??null;
  serviceWorkerContainer?.addEventListener('message',serviceWorkerMessages);
  claimPendingNotificationRoute=()=>{
    const browserPlatform=config.browserPlatform;
    if(!pendingNotificationClick||!browserPlatform||!buildCompatibility||disposed)return;
    const owner=snapshot();
    if(owner.accountId===null){return;}
    pendingNotificationClick=false;
    const requestId=makeRequestId(randomRef());if(!requestId){pendingNotificationClick=true;return;}
    const context:RequestContext={schemaVersion:1,requestId,owner};
    void browserPlatform.claimNotificationRoute(context).then(async route=>{
      if(!route)return;
      if(!isCurrent(owner)||!sameOwnerSnapshot(snapshot(),owner)){pendingNotificationClick=true;return;}
      if(route.kind!=='inbox'){
        if(route.networkId!==owner.networkId||route.accountId!==owner.accountId||route.conversationId===null){
          await browserPlatform.settleNotificationRoute(context,{routeRef:route.routeRef,claimRef:route.claimRef,outcome:'unavailable'});return;
        }
        const bindings=await platformStore.listBindings(owner);
        if(!isCurrent(owner)||!sameOwnerSnapshot(snapshot(),owner)){pendingNotificationClick=true;return;}
        const bound=bindings.some(binding=>binding.endpointRef===route.bindingRef&&binding.networkId===route.networkId&&binding.accountId===route.accountId);
        if(!bound){await browserPlatform.settleNotificationRoute(context,{routeRef:route.routeRef,claimRef:route.claimRef,outcome:'unavailable'});return;}
      }
      const timer=setTimeout(()=>{
        const claim=notificationNavigationClaims.get(requestId);if(!claim)return;
        notificationNavigationClaims.delete(requestId);
        void browserPlatform.settleNotificationRoute(context,{routeRef:route.routeRef,claimRef:route.claimRef,outcome:'unavailable'});
      },5_000);
      notificationNavigationClaims.set(requestId,{owner,context,route,timer});
      while(notificationNavigationClaims.size>16){const oldest=notificationNavigationClaims.keys().next().value;if(oldest){const stale=notificationNavigationClaims.get(oldest);if(stale)clearTimeout(stale.timer);notificationNavigationClaims.delete(oldest);}}
      try{config.onNotificationNavigation?.({requestId,ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),
        connectionGeneration:Number(owner.connectionGeneration),kind:route.kind,conversationId:route.conversationId});}catch{/* bridge observers are isolated */}
    }).catch(()=>{pendingNotificationClick=true;});
  };
  const safetyFor=(owner:OwnerSnapshot):ClientSafetyState|null=>{
    const state=clientSafetyState;
    return state&&state.ownerRef===owner.ownerRef&&state.accountGeneration===Number(owner.accountGeneration)
      &&state.connectionGeneration===Number(owner.connectionGeneration)?state:null;
  };
  const activationRequestKey=(owner:OwnerSnapshot):string|null=>{
    const active=authorizedWorkerActivation;
    if(!active||!sameOwnerSnapshot(active.owner,owner)||!isCurrent(owner))return null;
    const target=workerTargets.get(active.targetRef);
    if(!target||target.ownerRef!==owner.ownerRef||target.buildId!==active.targetBuildId)return null;
    const key=`${owner.ownerRef}:${active.requestId}`;
    return requestCache.get(key)?.pending?key:null;
  };
  const pendingDomainRequests=(owner:OwnerSnapshot):boolean=>{
    const excluded=activationRequestKey(owner);
    for(const [key,entry] of requestCache)if(entry.pending!==null&&key!==excluded)return true;
    return false;
  };
  const pruneExpiredPrivateCustody=():void=>{
    const now=Date.now();const expiredWebhookOwners=new Set<string>();
    for(const [ref,entry] of privateInputs)if(entry.expiresAt<=now){privateInputs.delete(ref);operatorInputTokens.delete(ref);}
    for(const [ref,entry] of privateOutputs)if(entry.expiresAt<=now){privateOutputs.delete(ref);backupOperationRefs.delete(ref);backupPasswordTokenByOutput.delete(ref);}
    for(const [ref,entry] of privatePasswords)if(entry.expiresAt<=now){entry.bytes.fill(0);privatePasswords.delete(ref);
      for(const [token,tokenEntry] of privatePasswordTokens)if(tokenEntry.ref===ref)privatePasswordTokens.delete(token);}
    for(const [ref,entry] of privateSecurityForms)if(entry.expiresAt<=now){wipePrivateSecurityValue(entry.bytes);privateSecurityForms.delete(ref);}
    for(const [ref,entry] of privateScheduledMessages)if(entry.expiresAt<=now){if(entry.timer)clearTimeout(entry.timer);entry.bytes.fill(0);
      if(entry.admissionRef)scheduledCustody?.retireCreateAdmission(entry.admissionRef);privateScheduledMessages.delete(ref);}
    for(const [ref,entry] of privateWebhookUrls)if(entry.expiresAt<=now){clearTimeout(entry.timer);entry.url='';expiredWebhookOwners.add(entry.ownerRef);privateWebhookUrls.delete(ref);}
    for(const ownerRef of expiredWebhookOwners)clearWebhookPresentationForOwner(ownerRef);
    for(const [token,entry] of privateInputTokens)if(!privateInputs.has(entry.ref))privateInputTokens.delete(token);
    for(const [token,entry] of privateOutputTokens)if(!privateOutputs.has(entry.ref))privateOutputTokens.delete(token);
    for(const [ref] of backupOperationRefs)if(!privateOutputs.has(ref))backupOperationRefs.delete(ref);
    for(const [ref] of backupPasswordTokenByOutput)if(!privateOutputs.has(ref))backupPasswordTokenByOutput.delete(ref);
  };
  const privateAuthoringPending=():boolean=>{
    pruneExpiredPrivateCustody();
    return pendingPasswordDialog!==null||pendingSecurityForm!==null
    ||privateSecurityForms.size>0||privateScheduledMessages.size>0||activePrivateIntegrationForms>0
    ||activePrivatePickers>0||privateInputs.size>0||privateOutputs.size>0||privatePasswords.size>0||privateWebhookUrls.size>0
    ||privatePasswordTokens.size>0||privateInputTokens.size>0||privateOutputTokens.size>0||backupOperationRefs.size>0
    ||pendingWebhookCreates.size>0||privateOutHookPresentations.size>0;
  };
  const runtimeQuiescent=(owner:OwnerSnapshot):boolean=>{
    const state=safetyFor(owner);
    if(!state||state.hasUnsavedDraft||state.composing||state.pendingAuthoring)return false;
    const activeCall=mediaEngine.hasActiveWork(owner)||config.getWorkerClientState?.().activeCall===true;
    const pendingMutation=(sessionOperations?.currentKind()!==null&&sessionOperations?.currentKind()!==undefined)
      ||pendingDomainRequests(owner)
      ||pendingWebAuthn.size>0||pendingIdentify.size>0||pendingContinuationSasl.size>0
      ||scheduledDueWorkActive||vaultPutWaiters.size>0||privateAuthoringPending();
    return !activeCall&&!pendingMutation&&isCurrent(owner);
  };
  const clientActivationState=(owner:OwnerSnapshot):ClientActivationState|null=>{
    if(!buildCompatibility)return null;
    const state=safetyFor(owner);const external=config.getWorkerClientState?.();
    const activeCall=mediaEngine.hasActiveWork(owner)||external?.activeCall===true;
    const pendingPrivateMutation=!state||state.pendingAuthoring||sessionOperations?.currentKind()!=null
      ||pendingDomainRequests(owner)||pendingWebAuthn.size>0||pendingIdentify.size>0
      ||pendingContinuationSasl.size>0||scheduledDueWorkActive||vaultPutWaiters.size>0||privateAuthoringPending()||external?.pendingPrivateMutation===true;
    const hasUnsavedDraft=!state||state.hasUnsavedDraft||state.composing||external?.hasUnsavedDraft===true;
    const canActivate=!hasUnsavedDraft&&!activeCall&&!pendingPrivateMutation&&isCurrent(owner)&&external?.canActivate!==false;
    return {clientRef:workerClientRef,buildId:buildCompatibility.buildId,protocolVersion:1,storageSchemas:buildCompatibility.storageSchemas,
      hasUnsavedDraft,activeCall,pendingPrivateMutation,canActivate};
  };
  acquireRuntimeActivationLease=async(input:ActivationLeaseRequest):Promise<(()=>void)|null>=>{
    const browser=config.browserPlatform;const owner=snapshot();
    if(!browser||activationBarrier||!runtimeQuiescent(owner))return null;
    const releaseFreeze=browser.freezeAuthoring(input.targetBuildId,input.requestId,owner);
    if(!releaseFreeze)return null;
    const token=Symbol('activation-barrier');
    activationBarrier={owner,targetBuildId:input.targetBuildId,token,releaseFreeze};
    if(!runtimeQuiescent(owner)||!isCurrent(owner)){activationBarrier=null;releaseFreeze();return null;}
    let released=false;
    return ()=>{if(released)return;released=true;const active=activationBarrier;if(active?.token!==token)return;activationBarrier=null;active.releaseFreeze();};
  };
  // Automatic shell updates. A deployed build installs as a waiting service
  // worker; without this, a page only moved to it through the manual
  // "Activate this update when safe" control, so returning visitors (notably
  // iOS, which rarely closes tabs) kept an old build indefinitely. When the
  // page is idle (no unsaved draft, call or private mutation, per
  // clientActivationState), ask the waiting worker to activate through the
  // same safety protocol, then reload once onto the new build.
  let autoUpdateRunning=false;let autoUpdateReloaded=false;
  const autoUpdateShell=async():Promise<void>=>{
    if(disposed||autoUpdateRunning||autoUpdateReloaded||!workerLifecycle||!buildCompatibility)return;
    if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
    const owner=snapshot();const local=clientActivationState(owner);if(!local?.canActivate)return;
    const requestId=makeRequestId(randomRef());if(!requestId)return;
    autoUpdateRunning=true;
    try{
      const req={schemaVersion:1 as const,requestId,owner};
      workerLifecycle.reportClientState(local);
      const registered=await workerLifecycle.register(req);
      if(disposed||registered.status!=='waiting')return;
      const target=workerLifecycle.waitingTarget();if(!target)return;
      if(!clientActivationState(snapshot())?.canActivate)return;
      const result=await workerLifecycle.requestActivation({...req,targetBuildId:target,action:'when-safe'});
      if(disposed||result.status!=='ready'||!clientActivationState(snapshot())?.canActivate)return;
      autoUpdateReloaded=true;
      try{globalThis.location?.reload();}catch{/* navigation unavailable */}
    }catch{/* best effort; the manual control remains available */}
    finally{autoUpdateRunning=false;}
  };
  if(workerLifecycle&&buildCompatibility&&typeof document!=='undefined'&&typeof setTimeout==='function'){
    setTimeout(()=>{void autoUpdateShell();},8000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void autoUpdateShell();});
  }
  const workerTargets=new Map<string,{readonly ownerRef:string;readonly buildId:string}>();
  const workerActivations=new Map<string,{readonly ownerRef:string;readonly requestId:RequestId;readonly buildId:string}>();
  const pushConsentRefs=new Map<string,string>();
  const retireNotificationClaims=(owner:OwnerSnapshot):void=>{
    for(const [requestId,claim] of notificationNavigationClaims){
      if(!sameOwnerSnapshot(claim.owner,owner))continue;
      clearTimeout(claim.timer);notificationNavigationClaims.delete(requestId);
      void config.browserPlatform?.settleNotificationRoute(claim.context,{routeRef:claim.route.routeRef,claimRef:claim.route.claimRef,outcome:'unavailable'});
    }
  };
  const pushReplies=transport.onPrivateIngress(envelope=>{
    const live=snapshot();
    if(!pushLifecycle||!platform||!isCurrent(live)||envelope.payload.owner.ownerRef!==live.ownerRef
      ||envelope.payload.owner.connectionGeneration!==live.connectionGeneration||envelope.payload.owner.accountGeneration!==live.accountGeneration)return false;
    let parsed:ReturnType<typeof parseIRCMessage>;try{parsed=parseIRCMessage(envelope.payload.line);}catch{return false;}
    const node=platform.getPushConfig().node;
    // Standard-replies emits PREFIXLESS `FAIL WEBPUSH <code> :reason`; legacy
    // replies can use `NOTICE <nick> :FAIL WEBPUSH <code>: reason`. These are
    // operation failures only: they never establish account/server authority.
    if(parsed.command==='FAIL'&&parsed.prefix===null&&envelope.payload.sourceKind==='prefixless-protocol'){
      const failedCommand=parsed.params[0]?.toUpperCase();
      if(failedCommand!=='WEBPUSH')return false;
      pushLifecycle.onServerReply({command:'FAIL',failedCommand,failureCode:parsed.params[1]?.toUpperCase()??'UNKNOWN',
        message:'',owner:live,node,authenticated:true});
      return true;
    }
    if(envelope.payload.sourceKind!=='server'||!learnedPrefix||parsed.prefix!==learnedPrefix)return false;
    if(parsed.command==='NOTICE'&&parsed.params[0]===currentNick){
      const message=(parsed.params.at(-1)??'').replace(/^:/u,'');
      const failure=/^FAIL\s+WEBPUSH\s+([A-Z0-9_-]{1,64})(?::\s|\s|$)/u.exec(message);
      if(failure){
        pushLifecycle.onServerReply({command:'FAIL',failedCommand:'WEBPUSH',failureCode:failure[1]??'UNKNOWN',message:'',owner:live,node,authenticated:true});
        return true;
      }
      if(message==='WEBPUSH: subscription stored'||message==='WEBPUSH: subscription removed'){
        pushLifecycle.onServerReply({command:'NOTICE',failedCommand:null,failureCode:null,message,owner:live,node,authenticated:true});
        return true;
      }
    }
    return false;
  });
  const identifyIngress=transport.onPrivateIngress(envelope=>{
    const {line,owner:sourceOwner,sourceKind}=envelope.payload;const owner=snapshot();
    if(disposed||sourceKind!=='server'||!learnedPrefix||sourceOwner.ownerRef!==owner.ownerRef
      ||sourceOwner.physicalRef!==owner.physicalRef||sourceOwner.connectionGeneration!==owner.connectionGeneration)return false;
    let parsed:ReturnType<typeof parseIRCMessage>;try{parsed=parseIRCMessage(line);}catch{return false;}
    if(parsed.command!=='NOTICE'||parsed.prefix!==learnedPrefix||parsed.params[0]!==currentNick)return false;
    const body=(parsed.params.at(-1)??'').replace(/^:/u,'');
    const match=/^You are now identified as ([A-Za-z0-9_.-]{1,64})$/u.exec(body);
    if(!match?.[1])return false;
    const canonical=match[1].replace(/[A-Z]/gu,c=>c.toLowerCase());
    const pending=[...pendingIdentify.values()].find(item=>item.owner.ownerRef===owner.ownerRef&&item.owner.physicalRef===owner.physicalRef
      &&item.owner.connectionGeneration===owner.connectionGeneration&&item.account===canonical);
    if(!pending){
      const passkey=[...pendingWebAuthn.values()].find(item=>item.owner.ownerRef===owner.ownerRef&&item.owner.physicalRef===owner.physicalRef
        &&item.owner.connectionGeneration===owner.connectionGeneration&&item.action==='authenticate'&&item.sent
        &&item.account.replace(/[A-Z]/gu,c=>c.toLowerCase())===canonical);
      if(passkey)applyPrivateAccountSourceProof(owner,match[1]!,endpointId);
      return true;
    }
    pendingIdentify.delete(pending.requestId);clearTimeout(pending.timer);
    applyPrivateAccountSourceProof(owner,match[1],endpointId);
    return true;
  });
  const roomGates = new Map<string,'paused-membership-change'|'ready'|'recovery-required'>();
  credentials = createCredentialOwner({
    storage,
    ownerSnapshot: snapshot,
    isCurrent,
    issuerEndpoint: () => endpointId,
    randomRef,
    now: Date.now,
    emit: state => {
      credentialProjection = { credentials: state.credentials, issuance: state.issuance, remembered: state.remembered };
      if (credentialIssuanceLease) {
        if (state.issuance === 'idle') { credentialIssuanceLease.release(); credentialIssuanceLease = null; }
        else if (state.issuance === 'unknown') credentialIssuanceLease.markUnknown();
      }
      config.onCredentialState?.(credentialProjection);
    },
    onPrivateServerLine: (line, owner) => { identity.observePrivateLine(line, owner); },
    isTrustedEndpoint: value => trustedEndpoints.has(value),
  });
  const joinedTargetsByPhysical = new Map<string, Set<string>>();
  isBatchablePublicIngress = (line, owner, suppliedParsed): boolean => {
    if (!publicIngressBatcher || !isCurrent(owner) || owner.physicalRef === null
      || owner.physicalRef !== physicalRef || owner.connectionGeneration !== connectionGeneration
      || learnedPrefix === null || currentNick === null || caseMapping === null) return false;
    const prefix = learnedPrefix;
    const nick = currentNick;
    const mapping = caseMapping;
    const tagSegmentEnd = line.startsWith('@') ? line.indexOf(' ') : -1;
    if (line.startsWith('@') && (tagSegmentEnd < 0 || line.slice(1, tagSegmentEnd).split(';').length > 3)) return false;
    let parsed = suppliedParsed;
    if (parsed === undefined) {
      try { parsed = parseIRCMessage(line); } catch { return false; }
    }
    const channel = parsed.params[0];
    const body = parsed.params[1];
    if (parsed.command !== 'PRIVMSG' || parsed.params.length !== 2 || !channel || body === undefined || parsed.prefix === null
      || parsed.prefix === prefix || !parsed.nick || !/[!@]/u.test(parsed.prefix)
      || normalizeCase(parsed.nick, mapping) === normalizeCase(nick, mapping)) return false;
    const messageTags = Object.keys(parsed.tags);
    if (messageTags.some(tag => tag === 'batch' || tag === 'label'
      || !['account', 'msgid', 'time'].includes(tag))) return false;
    if (/[\u0001-\u001f\u007f]/u.test(body)) return false;
    const joinedTargets = joinedTargetsByPhysical.get(String(owner.physicalRef));
    if (!joinedTargets) return false;
    const foldedChannel = normalizeCase(channel, mapping);
    return [...joinedTargets].some(target => normalizeCase(target, mapping) === foldedChannel);
  };
  let refreshRetentionObservation: ((owner:OwnerSnapshot,target:string)=>void) | null = null;
  facts = createAuthenticatedFacts({ ownerSnapshot:snapshot,isCurrent,transport,currentServerPrefix:()=>learnedPrefix,currentNick:()=>currentNick,metadataAvailable:()=>negotiatedCapabilities.has('metadata-2'),
    onInvalidation:()=>{ featureReady={...featureReady,e2ee:false}; publishFeatureReadiness(); },
    onReadiness:(observation)=>{
      if(observation.policy.complete&&observation.policy.ephemeralKnown&&isCurrent(observation.owner))
        refreshRetentionObservation?.(observation.owner,observation.target);
    } });
  const joinedTargetIngress=transport.onPrivateIngress(event=>{
    const {line,owner:sourceOwner,sourceKind}=event.payload;
    if(!isCurrent(sourceOwner)||sourceOwner.physicalRef!==physicalRef||sourceKind!=='user')return false;
    let parsed:ReturnType<typeof parseIRCMessage>;try{parsed=parseIRCMessage(line);}catch{return false;}
    const own=currentNick;if(!own||!parsed.nick||normalizeCase(parsed.nick,caseMapping??'ascii')!==normalizeCase(own,caseMapping??'ascii'))return false;
    const physicalKey=String(sourceOwner.physicalRef);let targets=joinedTargetsByPhysical.get(physicalKey);
    if(parsed.command==='JOIN'&&parsed.params[0]){targets??=new Set();targets.add(parsed.params[0]);joinedTargetsByPhysical.set(physicalKey,targets);}
    else if(parsed.command==='PART'&&parsed.params[0])targets?.delete(parsed.params[0]);
    else if(parsed.command==='KICK'&&parsed.params[0]&&parsed.params[1]&&normalizeCase(parsed.params[1],caseMapping??'ascii')===normalizeCase(own,caseMapping??'ascii'))targets?.delete(parsed.params[0]);
    return false;
  });
  const groupIngress=transport.onPrivateIngress(event=>{
    const currentOwner=snapshot();const input=event.payload;
    if(!isCurrent(currentOwner)||input.owner.ownerRef!==currentOwner.ownerRef||!privateCrypto)return false;
    // The server relays group controls under the sender's own prefix using a
    // dotted verb (parseIRCMessage leaves those with an empty command). The
    // verb position cannot be set by a peer; the adapter still verifies the
    // signature, routing, and account. Consume so the record stays private.
    if(GROUP_DELIVERY_LINE.test(input.line)){
      const deliveryRequestId=makeRequestId(randomRef());
      if(deliveryRequestId)void privateCrypto.ingestGroupControl({context:{schemaVersion:1,requestId:deliveryRequestId,owner:currentOwner},line:input.line});
      return true;
    }
    if(input.sourceKind==='user')return false;
    const parsed=parseIRCMessage(input.line);const body=parsed.params.at(-1)??'';
    if(input.sourceKind!=='server'||!learnedPrefix||parsed.prefix!==learnedPrefix||!/^E2EEGROUP\s/u.test(body))return false;
    const requestId=makeRequestId(randomRef());if(!requestId)return false;
    void privateCrypto.ingestGroupControl({context:{schemaVersion:1,requestId,owner:currentOwner},line:input.line});
    return false;
  });
  const webhookIngress=transport.onPrivateIngress(envelope=>{
    const {line,owner:sourceOwner,sourceKind}=envelope.payload;const owner=snapshot();
    if(disposed||!isCurrent(owner)||sourceOwner.ownerRef!==owner.ownerRef||sourceKind!=='server'||!learnedPrefix)return false;
    let message:ReturnType<typeof parseIRCMessage>;try{message=parseIRCMessage(line);}catch{return false;}
    if(message.command!=='NOTICE'||message.prefix!==learnedPrefix||message.params[0]!==currentNick)return false;
    const body=message.params.at(-1)??'';
    // Never project a bearer URL into Elm, logs, history or model folding. Even
    // an unsolicited, malformed or stale webhook creation reply is consumed
    // and discarded. The source wire is `... — POST Discord webhook JSON to <url>`.
    if(!isWebhookCreationReply(body))return false;
    const match=parseWebhookCreationReply(body);if(!match)return true;
    const room=makeConversationId(match.room);if(!room)return true;
    const key=facts?.canonicalConversationKey(owner,room)??`${owner.networkId}:${room}`;
    const pendingKey=`${owner.ownerRef}:${key}`;const pending=pendingWebhookCreates.get(pendingKey);
    if(!pending||pending.expiresAt<=Date.now()||pending.room!==room||!isCurrent(pending.owner))return true;
    pendingWebhookCreates.delete(pendingKey);
    const shown=presentPrivateWebhook(owner,room,match.url);
    try{config.onPrivateWebhookResult?.({ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),requestId:pending.requestId,room,status:shown?'created':'blocked'});}catch{/* private UI observers are isolated */}
    return true;
  });
  const accountSecurityIngress=transport.onPrivateIngress(envelope=>{
    const {line,owner:sourceOwner,sourceKind}=envelope.payload;const owner=snapshot();
    if(disposed||!isCurrent(owner)||sourceOwner.ownerRef!==owner.ownerRef)return false;
    let message:ReturnType<typeof parseIRCMessage>;try{message=parseIRCMessage(line);}catch{return false;}
    if(!learnedPrefix)return false;
    if(message.command==='FAIL'&&message.prefix===null&&sourceKind==='prefixless-protocol'){
      const family=message.params[0]?.toUpperCase();
      if(!['TOTP','RECOVERYCODES','SETPASS','ACCOUNTSET','RESETPASS','REGISTER','VERIFY','DROP'].includes(family??''))return false;
      return privateAccountSecurity?.ingest({line,owner,serverPrefix:learnedPrefix})??true;
    }
    if(sourceKind!=='server'||message.prefix!==learnedPrefix)return false;
    if(message.command==='NOTICE'&&message.params[0]!==currentNick)return false;
    const body=(message.params.at(-1)??'').replace(/^:/u,'');
    const privateReply=/^(?:TOTP:|RECOVERYCODES:|SETPASS:|RESETPASS:|RESETPASS SUCCESS |REGISTER SUCCESS |VERIFY:|Account [A-Za-z0-9_.-]{1,64} (?:updated \(email\)|dropped)|FAIL\s+(?:TOTP|RECOVERYCODES|SETPASS|ACCOUNTSET|RESETPASS|REGISTER|VERIFY|DROP)\s)/u.test(body);
    if(!privateReply)return false;
    return privateAccountSecurity?.ingest({line,owner,serverPrefix:learnedPrefix})??true;
  });
  const continuationIngress=transport.onPrivateIngress(envelope=>{
    const {line,owner:sourceOwner,sourceKind}=envelope.payload;const owner=snapshot();
    if(disposed||!isCurrent(owner)||sourceOwner.ownerRef!==owner.ownerRef)return false;
    if(sourceKind==='user')return false;
    let message:ReturnType<typeof parseIRCMessage>;try{message=parseIRCMessage(line);}catch{return false;}
    const preregServerPrefix=message.prefix!==null&&tentativeServerPrefix!==null&&message.prefix===tentativeServerPrefix&&!/[!@\s\u0000-\u001f\u007f]/u.test(message.prefix);
    const authenticatedServer=sourceKind==='server'&&learnedPrefix!==null&&message.prefix===learnedPrefix;
    const activeForOwner=[...pendingContinuationSasl.entries()].filter(([,entry])=>entry.owner.ownerRef===owner.ownerRef&&entry.owner.physicalRef===owner.physicalRef
      &&entry.owner.connectionGeneration===owner.connectionGeneration);
    if(message.command==='AUTHENTICATE'&&message.params[0]==='+'){
      if(sourceKind!=='prefixless-protocol'&&!authenticatedServer&&!preregServerPrefix)return false;
      const active=activeForOwner.find(([,entry])=>entry.phase==='challenge');
      if(!active)return false;
      const [authContextRef,entry]=active;entry.phase='result';
      const context={schemaVersion:1 as const,requestId:entry.requestId,owner:entry.owner};
      void (async()=>{
        const prepared=await identity.prepareSessionTokenSasl({context,continuationRef:entry.continuationRef,authContextRef});
        if(!isCurrent(entry.owner)||pendingContinuationSasl.get(authContextRef)!==entry){if(prepared.kind==='ready')prepared.payload.fill(0);return;}
        if(prepared.kind!=='ready'){identity.settleSessionTokenSasl({authContextRef,result:'unknown'});pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);publishSessionTokenSaslStatus(entry,'unknown');return;}
        let encoded='';try{encoded=btoa(String.fromCharCode(...prepared.payload));}catch{/* encoding failure stays unavailable */}
        prepared.payload.fill(0);
        if(!encoded){identity.settleSessionTokenSasl({authContextRef,result:'unknown'});pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);publishSessionTokenSaslStatus(entry,'unknown');return;}
        const admission=runtimeSendSaslPayload(encoded,authContextRef);
        if(admission.kind!=='transport-admitted'){
          identity.settleSessionTokenSasl({authContextRef,result:'unknown'});
          pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);
          publishSessionTokenSaslStatus(entry,'unknown');transport.close();
        }
      })();
      return true;
    }
    if(['903','904','905'].includes(message.command)&&(sourceKind==='prefixless-protocol'||authenticatedServer||preregServerPrefix)){
      const active=activeForOwner.find(([,entry])=>entry.phase==='result');
      if(!active)return false;
      const [authContextRef,entry]=active;const result=message.command==='903'?'accepted':'rejected';identity.settleSessionTokenSasl({authContextRef,result});
      publishSessionTokenSaslStatus(entry,result);
      pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);return true;
    }
    return false;
  });
  const webAuthnIngress=transport.onPrivateIngress(envelope=>{
    const {line,owner:sourceOwner,sourceKind}=envelope.payload;const owner=snapshot();
    if(disposed||!isCurrent(owner)||sourceOwner.ownerRef!==owner.ownerRef||sourceOwner.connectionGeneration!==owner.connectionGeneration)return false;
    if(sourceKind==='user')return false;
    if(recoveryController?.consumePrivateIngress(envelope.payload))return true;
    let ingressMessage:ReturnType<typeof parseIRCMessage>;try{ingressMessage=parseIRCMessage(line);}catch{return false;}
    const webAuthnFamily=ingressMessage.command==='EVENT'&&ingressMessage.params[1]?.toUpperCase()==='WEBAUTHN'?ingressMessage.params[2]?.toUpperCase():null;
    const nativeOperation=[...pendingWebAuthn.values()].some(item=>item.owner.ownerRef===owner.ownerRef&&item.owner.physicalRef===owner.physicalRef);
    if(['CRED','LIST','RENAMED','REMOVED'].includes(webAuthnFamily??'')){
      // Management-family payloads can contain credential identifiers and
      // remain private even when stale or interleaved with a native ceremony.
      if(!nativeOperation)passkeyManagement?.consumePrivateIngress(envelope.payload);
      return true;
    }
    if(!nativeOperation&&ingressMessage.command==='FAIL'&&ingressMessage.params[0]?.toUpperCase()==='WEBAUTHN')
      return passkeyManagement?.consumePrivateIngress(envelope.payload)??true;
    const reply=parsePrivateWebAuthnReply({line,sourceKind,serverPrefix:learnedPrefix,currentNick});
    if(reply.kind==='unrelated')return false;
    const pending=[...pendingWebAuthn.values()].find(item=>item.owner.ownerRef===owner.ownerRef&&item.owner.physicalRef===owner.physicalRef
      &&item.owner.connectionGeneration===owner.connectionGeneration);
    if(pending&&reply.kind==='failure'){
      clearPendingWebAuthn(pending);pendingWebAuthn.delete(pending.context.requestId);
      publishDomain('webauthn',{kind:'webauthn',requestId:pending.context.requestId,ceremonyRef:pending.ceremonyRef,ceremony:pending.action,phase:'blocked',reason:'invalid-ceremony'});return true;
    }
    if(!pending||reply.kind==='private-invalid')return true;
    if(reply.kind==='allow-credential'&&pending.action==='authenticate'&&pending.challenge!==null){
      const encoded=reply.credentialId;if(pending.allowCredentials.length>=64){pending.allowMalformed=true;return true;}
      try{const normalized=encoded.replace(/-/gu,'+').replace(/_/gu,'/');const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
        if(bytes.length>0&&bytes.length<=1023)pending.allowCredentials.push(bytes);else{bytes.fill(0);pending.allowMalformed=true;}}catch{pending.allowMalformed=true;}
      return true;
    }
    if(reply.kind==='registered'&&pending.action==='register'&&pending.sent){
      clearPendingWebAuthn(pending);pendingWebAuthn.delete(pending.context.requestId);
      publishDomain('webauthn',{kind:'webauthn',requestId:pending.context.requestId,ceremonyRef:pending.ceremonyRef,ceremony:'register',phase:'transport-admitted',reason:null});return true;
    }
    if(reply.kind!=='challenge'||reply.action!==pending.action)return true;
    const {challenge:challengeText,rpId,account}=reply;
    if(account.replace(/[A-Z]/gu,c=>c.toLowerCase())!==pending.account.replace(/[A-Z]/gu,c=>c.toLowerCase()))return true;
    if(pending.action==='register'&&owner.accountId!==pending.account)return true;
    let challenge:Uint8Array;
    try{const normalized=challengeText.replace(/-/gu,'+').replace(/_/gu,'/');const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));challenge=Uint8Array.from(raw,char=>char.charCodeAt(0));}
    catch{return true;}
    if(challenge.byteLength<16||challenge.byteLength>1024){challenge.fill(0);return true;}
    pending.challenge?.fill(0);pending.challenge=challenge;pending.rpId=rpId;
    if(pending.action==='authenticate'&&pending.allowMalformed){challenge.fill(0);clearPendingWebAuthn(pending);pendingWebAuthn.delete(pending.context.requestId);
      publishDomain('webauthn',{kind:'webauthn',requestId:pending.context.requestId,ceremonyRef:pending.ceremonyRef,ceremony:'authenticate',phase:'blocked',reason:'invalid-response'});return true;}
    if(pending.action==='register'){
      void webAuthn?.begin({context:pending.context,ceremonyRef:pending.ceremonyRef,action:'register',challenge,rpId,account:pending.account});
    }else{
      if(pending.timer)clearTimeout(pending.timer);
      pending.timer=setTimeout(()=>{
        pending.timer=null;
        if(!isCurrent(pending.owner)||pendingWebAuthn.get(pending.context.requestId)!==pending){challenge.fill(0);return;}
        void webAuthn?.begin({context:pending.context,ceremonyRef:pending.ceremonyRef,action:'authenticate',challenge,rpId,account:pending.account,allowCredentials:pending.allowCredentials});
      },75);
    }
    return true;
  });

  const localScheme = (request: { readonly schemaVersion: 1; readonly requestId: RequestId; readonly owner: OwnerSnapshot }) => localWorkspaces.conversationSchemeForRequest(request);
  const canonicalForTicket = (owner: OwnerSnapshot, target: ConversationId, ticket: LocalNamespaceTicket): string | null => {
    const scheme=ticket.conversationScheme;
    if(!scheme||!target||target.length>512||/[\u0000-\u001f\u007f]/u.test(target))return null;
    const folded=normalizeCase(target,scheme.name);
    return canonicalTupleKey([String(owner.networkId),scheme.name,folded]);
  };
  const cryptoPolicy = (owner: OwnerSnapshot, conversationId: ConversationId): CryptoPolicy | null => {
    if(!isCurrent(owner))return null;
    if(!conversationId.startsWith('#')&&!conversationId.startsWith('&')){
      facts?.observeDmTarget({context:{owner},target:conversationId});
      const dm=facts?.dmPolicySnapshot(owner,conversationId);
      if(!dm?.complete||!dm.revision)return {revision:'dm-policy-unknown',encryption:'unknown',eligible:false,room:null,epoch:null};
      const route=dm.encrypted?facts?.resolvePeerConversation(owner,conversationId):null;
      const revision=JSON.stringify(['onyx-send-policy-v2',owner.networkId,normalizeCase(conversationId,caseMapping??'ascii'),caseMapping??'unknown',dm.encrypted?'dm-required':'plain',dm.accountId]);
      return {revision,encryption:dm.encrypted?'dm-required':'plain',eligible:!dm.encrypted||!!route,room:null,epoch:null};
    }
    const fact=facts?.policySnapshot(owner,conversationId);
    if(!fact)return null;
    const gate=roomGates.get(JSON.stringify([owner.ownerRef,conversationId]));
    const membership=facts.roomPolicyFacts(owner,conversationId);
    const isRoom=conversationId.startsWith('#')||conversationId.startsWith('&');
    const groupHead=isRoom?privateCrypto?.groupProviders.currentAcceptedHead(owner,conversationId):null;
    const groupHeadCurrent=!!groupHead&&groupHead.mappingRevision===membership.mappingRevision
      &&groupHead.accountId===owner.accountId;
    const mode=fact.encryption==='off'?'plain':fact.encryption==='required'?'room-required':fact.encryption==='optional'?'plain':'unknown';
    const ready=mode==='plain'||(mode==='room-required'&&gate==='ready'&&groupHeadCurrent&&membership.joined&&membership.complete);
    const revision=JSON.stringify(['onyx-send-policy-v2',owner.networkId,membership.canonicalTarget??conversationId,membership.scheme??'unknown',mode,fact.ephemeralSeconds]);
    return {revision,
      encryption:mode,eligible:fact.complete&&fact.ephemeralKnown&&(mode==='plain'||ready),room:isRoom?conversationId:null,epoch:groupHeadCurrent?groupHead.epoch:null};
  };
  const scheduledPolicySnapshot = (context: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, targetKey: string): ScheduledPolicySnapshot | null => {
    if (!isCurrent(context.owner) || !isNamespaceCurrent(ticket, context) || !targetKey) return null;
    const isRoom = conversationId.startsWith('#') || conversationId.startsWith('&');
    const policy = cryptoPolicy(context.owner, conversationId);
    if (!policy || policy.encryption === 'unknown') return { kind: 'unknown' };
    let peerAccountId: AccountId | null = null;
    if (!isRoom) {
      const dm = facts?.dmPolicySnapshot(context.owner, conversationId);
      if (!dm?.complete || !dm.revision) return { kind: 'unknown' };
      peerAccountId = dm.accountId;
      // A durable account schedule must bind a DM to a current authenticated
      // account route. Guest schedules are physical-owner scoped and volatile.
      if (ticket.scope.kind === 'account' && peerAccountId === null) return null;
      if (peerAccountId !== null) {
        const route = facts?.resolvePeerConversation(context.owner, conversationId);
        if (route?.accountId !== peerAccountId || route.owner.ownerRef !== context.owner.ownerRef) return null;
      }
    } else {
      const room = facts?.policySnapshot(context.owner, conversationId);
      if (!room?.complete || !room.ephemeralKnown) return { kind: 'unknown' };
    }
    const privacy = policy.encryption === 'plain' ? 'plain' : 'required';
    const schemeRevision = ticket.conversationScheme?.revision;
    if (!schemeRevision) return null;
    const policyBinding = JSON.stringify(['scheduled-policy-binding-v1', String(context.owner.networkId), targetKey, schemeRevision, privacy, peerAccountId]);
    return { kind: 'known', semanticRevision: policy.revision, privacy, peerAccountId, policyBinding };
  };
  const checkScheduledPolicy = (context: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, targetKey: string,
    captured: ScheduledPolicySnapshot): 'compatible' | 'hold' | 'unavailable' => {
    if (!isCurrent(context.owner) || !isNamespaceCurrent(ticket, context)) return 'unavailable';
    const current = scheduledPolicySnapshot(context, ticket, conversationId, targetKey);
    if (!current) return 'unavailable';
    if (current.kind === 'unknown') return captured.kind === 'unknown' ? 'unavailable' : 'hold';
    if (captured.kind === 'known' && (captured.semanticRevision !== current.semanticRevision || captured.privacy !== current.privacy
      || captured.peerAccountId !== current.peerAccountId || captured.policyBinding !== current.policyBinding)) return 'hold';
    const policy = cryptoPolicy(context.owner, conversationId);
    if (!policy?.eligible) return 'hold';
    return 'compatible';
  };
  const workspaceGrantForOwner = (owner: OwnerSnapshot): LocalOwnerGrant | null => {
    const grant=localWorkspaces.grant(); if(!grant||grant.scope.networkId!==owner.networkId||!localWorkspaces.validateGrant(grant))return null;
    if(owner.accountId!==null&&grant.scope.accountId!==owner.accountId)return null;
    if(owner.accountId===null&&learnedPrefix!==null&&(grant.scope.kind!=='guest'||grant.scope.physicalRef!==owner.physicalRef))return null;
    if(owner.accountId===null&&grant.scope.kind==='guest'&&grant.scope.physicalRef!==owner.physicalRef)return null;
    lastWorkspaceGrant=grant;
    return grant;
  };
  const workspaceHistoryGrantForOwner = (owner: OwnerSnapshot): LocalOwnerGrant | null => {
    const grant=localWorkspaces.grant();
    if(!grant||grant.scope.kind!=='account'||grant.scope.historyOnly!==true||grant.scope.networkId!==owner.networkId
      ||owner.accountId!==null||owner.physicalRef===null||!isCurrent(owner)||!localWorkspaces.validateGrant(grant))return null;
    return grant;
  };
  const freshGenesisProofs=new Map<symbol,import('./authenticated-facts').FreshCreateFact>();
  const freshGenesisReservations=new Map<symbol,import('./authenticated-facts').FreshCreateFact>();
  privateCrypto = createPrivateCryptoProvider({
    transport, ownerSnapshot:snapshot, isCurrent,
    validateWorkspaceGrant:grant=>localWorkspaces.validateGrant(grant),
    workspaceGrantForOwner, indexedDB:typeof indexedDB==='undefined'?null:indexedDB,
    workspaceSelectionRef:()=>localWorkspaces.current()?.workspaceRef??null,
    configuredNetwork:value=>[networkId,...(config.endpointRegistry??[]).map(entry=>makeNetworkId(entry.networkId)).filter((item):item is NetworkId=>item!==null)].includes(makeNetworkId(value) as NetworkId),
    ensureImportedHistoryWorkspace:input=>localWorkspaces.ensureImportedHistoryWorkspace(input),
    canonicalConversationKey:(owner,target)=>facts?.canonicalConversationKey(owner,target)??null,
    canonicalWorkspaceTarget:(context,grant,conversationId)=>{
      const ticket=localWorkspaces.namespaceForRequest(context);
      if(!ticket||!localWorkspaces.validateGrant(grant)||!localWorkspaces.isNamespaceCurrent(ticket,context)
        ||grant.scope.workspaceRef!==ticket.scope.workspaceRef||grant.scope.localWorkspaceEpoch!==ticket.scope.localWorkspaceEpoch)return null;
      const key=canonicalForTicket(context.owner,conversationId,ticket);
      return localWorkspaces.isNamespaceCurrent(ticket,context)?key:null;
    },
    conversationKeyScheme:owner=>facts?.conversationKeyScheme(owner)??null,
    conversationPolicy:cryptoPolicy,
    authorizePurpose:({owner,purpose})=>isCurrent(owner)&&['encrypt-conversation','group-author','group-recovery','media-handshake','media-frame','sign-media-handshake','sign-media-frame','verify-media-peer','establish-key-agreement'].includes(purpose),
    identityPurposes:{
      proveAccount:async()=>null,
      verifyServerProof:async()=>false,
      // The public verifier contract has no defined proof transcript. Pin
      // presence is exposed separately and must not be treated as proof.
      verifyTrustedDevice:async()=>false,
    },
    ensureRegisteredDevice:(owner,deviceId,signingPublic,wrappingPublic)=>facts?.ensureRegisteredDevice(owner,deviceId,signingPublic,wrappingPublic)??Promise.resolve(false),
    resolvePeerConversation:(owner,conversationId)=>facts?.resolvePeerConversation(owner,conversationId)??null,
    directoryRevision:(owner,conversationId)=>{
      if(conversationId.startsWith('#')){const membership=facts?.roomMembershipFacts(owner,conversationId);return membership?.complete?`${membership.sourceRevision??''}:${membership.mappingRevision}:${membership.membershipGeneration}`:null;}
      const route=facts?.resolvePeerConversation(owner,conversationId); return route?.routingRevision??null;
    },
    authenticatedDirectory:(owner,account)=>facts?.authenticatedDirectory(owner,account)??Promise.resolve(null),
    conversationForRoom:(owner,room)=>isCurrent(owner)?makeConversationId(room):null,
    roomPolicyFacts:(owner,conversationId)=>facts?.roomPolicyFacts(owner,conversationId)??null,
    roomMembershipFacts:(owner,conversationId)=>{const value=facts?.roomMembershipFacts(owner,conversationId);if(!value)return null;return {owner,target:conversationId,...(value.canonicalTarget!==null?{canonicalTarget:value.canonicalTarget}:{}),...(value.scheme!==null?{scheme:value.scheme}:{}),mappingGeneration:value.mappingGeneration,membershipGeneration:value.membershipGeneration,complete:value.complete,memberCount:value.memberCount,memberAccounts:value.memberAccounts,members:value.members,...(value.ownNick!==null?{ownNick:value.ownNick}:{}),ownModes:value.ownModes,hiddenOrAuditorium:value.hiddenOrAuditorium,...(value.sourceRevision!==null?{sourceRevision:value.sourceRevision}:{}),joined:value.joined,mappingRevision:value.mappingRevision};},
    resolveMediaPeer:async(owner,peerNick,attachmentId)=>{
      if(!isCurrent(owner)||!attachmentId.length)return null;
      const account=facts?.resolvePeerAccount(owner,peerNick);
      if(!account)return null;
      const directory=await facts?.authenticatedDirectory(owner,account);
      if(!directory||!isCurrent(owner))return null;
      const candidates=[] as string[];
      for(const device of directory.snapshot.devices){
        if(device.legacy||!device.entry)continue;
        if(await privateCrypto.isTrustedDevicePinned(owner,account,device.deviceId))candidates.push(device.deviceId);
        if(!isCurrent(owner))return null;
      }
      return candidates.length===1?{accountId:account,deviceId:candidates[0]!}:null;
    },
    freshGenesisFact:async(owner,conversationId)=>{
      if(!isCurrent(owner)||!owner.accountId)return null;
      const fact=facts?.freshCreateFact(owner,conversationId);const membership=facts?.roomMembershipFacts(owner,conversationId);
      const policy=facts?.policySnapshot(owner,conversationId);
      if(!fact||!membership?.joined||!membership.complete||!membership.ownModes.some(mode=>mode==='q'||mode==='Q')
        ||!policy?.complete||policy.encryption!=='required'||fact.mappingGeneration!==membership.mappingGeneration
        ||membership.memberCount!==1||fact.canonicalTarget!==membership.canonicalTarget||!facts?.validateFreshCreateFact(fact))return null;
      // Genesis binds to the server object id of our own CREATE plus the
      // founder-only/required condition that validateFreshCreateFact re-proves
      // on every use; routine snapshot refresh counters are not part of it.
      if(!await privateCrypto.ensureEnrolledIdentity(owner)||!isCurrent(owner))return null;
      const requestId=makeRequestId(randomRef());if(!requestId)return null;
      const callRef=randomRef() as import('./contracts').MediaCallRef;
      const identity=await privateCrypto.privateIdentity.getMediaPublicIdentity({owner,conversationId,requestId,callRef});
      if(!identity||!isCurrent(owner))return null;
      identity.ecdhPublicRaw.fill(0);identity.signingPublicRaw.fill(0);
      if(!facts.validateFreshCreateFact(fact)||identity.directoryRevision.length===0)return null;
      const proofRef=Symbol('fresh-create-proof');freshGenesisProofs.set(proofRef,fact);
      while(freshGenesisProofs.size>32)freshGenesisProofs.delete(freshGenesisProofs.keys().next().value as symbol);
      const candidate:FreshGenesisFact={kind:'new-room-genesis',epoch:0,commitHash:new Uint8Array(32),membershipRevision:`fresh:${fact.operationRef}`,
        mappingRevision:membership.mappingRevision,accountId:owner.accountId,deviceId:identity.deviceId,proofRef};
      return candidate;
    },
    authorizeGroupAuthor:(owner,conversationId,accountId)=>{
      if(!isCurrent(owner)||owner.accountId!==accountId)return false;
      const membership=facts?.roomMembershipFacts(owner,conversationId);
      return !!membership?.joined&&membership.complete&&membership.ownModes.some(mode=>mode==='o'||mode==='q'||mode==='Q');
    },
    authorizeRemoteGroupAuthor:async(owner,room,accountId,deviceId)=>{
      if(!isCurrent(owner)||!deviceId||deviceId.length>32)return false;
      const membership=facts?.roomMembershipFacts(owner,room); if(!membership?.joined||!membership.complete||!membership.memberAccounts.includes(accountId))return false;
      const member=membership.members.find(candidate=>candidate.accountId===accountId);
      if(!member?.modes.some(mode=>mode==='o'||mode==='q'||mode==='Q'))return false;
      const directory=await facts?.authenticatedDirectory(owner,accountId);
      return isCurrent(owner)&&!!directory?.snapshot.devices.some(device=>device.deviceId===deviceId);
    },
    reserveFreshCreateProof:async(owner,conversationId,proofRef)=>{
      const candidate=freshGenesisProofs.get(proofRef);if(!candidate||candidate.owner.ownerRef!==owner.ownerRef||candidate.target!==conversationId
        ||!isCurrent(owner)||!facts?.validateFreshCreateFact(candidate))return null;
      const reserved=facts.reserveFreshCreateFact(owner,conversationId);
      if(!reserved||reserved.operationRef!==candidate.operationRef||!facts.validateFreshCreateFact(reserved))return null;
      freshGenesisProofs.delete(proofRef);const reservation=Symbol('fresh-create-reservation');freshGenesisReservations.set(reservation,reserved);
      while(freshGenesisReservations.size>32)freshGenesisReservations.delete(freshGenesisReservations.keys().next().value as symbol);
      return reservation;
    },
    validateFreshCreateReservation:async(owner,conversationId,reservation)=>{
      const fact=freshGenesisReservations.get(reservation);if(!fact)return false;
      const membership=facts?.roomMembershipFacts(owner,conversationId);const policy=facts?.policySnapshot(owner,conversationId);
      const valid=fact.owner.ownerRef===owner.ownerRef&&fact.target===conversationId&&isCurrent(owner)&&facts?.validateFreshCreateFact(fact)===true
        &&membership?.joined===true&&membership.complete&&membership.memberCount===1
        &&membership.mappingGeneration===fact.mappingGeneration&&policy?.complete===true&&policy.encryption==='required';
      if(!valid)freshGenesisReservations.delete(reservation);
      return valid;
    },
    setRoomSendGate:(owner,conversationId,state)=>{
      if(!isCurrent(owner))return; const key=JSON.stringify([owner.ownerRef,conversationId]);
      if(state==='ready')roomGates.set(key,'ready');else roomGates.set(key,state);
      const head=privateCrypto?.groupProviders.currentAcceptedHead(owner,conversationId)??null;
      publishDomain('group',{kind:'group',phase:state,conversationId,epoch:head?.epoch??null,currentCommitHashHex:head?.commitHashHex??null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'});
    },
    readBackupPassword:async(owner,conversationId,epoch)=>{
      if(!isCurrent(owner)||owner.accountId===null)return null;
      if(!runtimeRequest(owner))return null;
      const result=await requestPrivatePassword({purpose:'group-backup-export',ownerRef:owner.ownerRef,
        accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration)});
      if(!result||result.ownerRef!==owner.ownerRef||!isCurrent(owner))return null;
      return consumePrivatePassword(result.passwordRef,owner,'group-backup-export');
    },
    readPrivatePassword:async(ref,context)=>{
      const entry=privatePasswordTokens.get(ref);
      if(!entry||entry.ownerRef!==context.owner.ownerRef||!isCurrent(context.owner))return null;
      privatePasswordTokens.delete(ref);
      return consumePrivatePassword(entry.ref,context.owner,entry.purpose);
    },
    writePrivateBackupSelection:async(ref,bytes,context)=>{
      const selected=privateOutputTokens.get(ref);if(!selected||selected.ownerRef!==context.owner.ownerRef||!isCurrent(context.owner))return false;
      privateOutputTokens.delete(ref);
      const written=await writePrivateFile(selected.ref,bytes,'application/vnd.onyx.private-backup','onyx-group-backup.onyxbackup',context);
      backupOperationRefs.delete(selected.ref);return written&&isCurrent(context.owner);
    },
    readPrivateImport:async(inputRef,passwordRef,context)=>{
      const selected=privateInputTokens.get(inputRef);if(!selected||selected.ownerRef!==context.owner.ownerRef||!isCurrent(context.owner))return null;
      privateInputTokens.delete(inputRef);
      const bytes=await readSelectedPrivateFile(selected.ref,'group-backup-import',context.owner);
      const passwordEntry=privatePasswordTokens.get(passwordRef);
      if(passwordEntry)privatePasswordTokens.delete(passwordRef);
      const password=passwordEntry?.ownerRef===context.owner.ownerRef&&passwordEntry.purpose==='group-backup-import'
        ?consumePrivatePassword(passwordEntry.ref,context.owner,'group-backup-import'):null;
      if(!bytes||!password){bytes?.fill(0);password?.fill(0);return null;}
      return {bytes,password};
    },
    authorizeRemovalIntent:async intent=>{
      const owner=intent.owner;const room=intent.conversationId;
      if(intent.explicitUserIntent!==true||!owner.accountId||!isCurrent(owner)||!transport.isCurrent(owner)||intent.expectedCommitHash.byteLength!==32)return false;
      const membership=facts?.roomMembershipFacts(owner,room);
      if(!membership?.joined||!membership.complete||!membership.memberAccounts.includes(owner.accountId)
        ||!membership.ownModes.some(mode=>mode==='q'||mode==='Q'||mode==='o'))return false;
      const head=privateCrypto?.groupProviders.currentAcceptedHead(owner,room);
      if(!head||head.epoch!==intent.expectedEpoch||head.commitHashHex!==Array.from(intent.expectedCommitHash,b=>b.toString(16).padStart(2,'0')).join(''))return false;
      if(!membership.memberAccounts.includes(intent.removedAccountId))return false;
      if(intent.removedAccountId===owner.accountId&&intent.removedDeviceId===head.deviceId)return false;
      const directory=await facts?.authenticatedDirectory(owner,intent.removedAccountId);
      return isCurrent(owner)&&transport.isCurrent(owner)&&directory?.snapshot.devices.some(device=>device.deviceId===intent.removedDeviceId)===true;
    },
    onReadiness:(owner,state)=>{
      if(!isCurrent(owner))return;
      featureReady={...featureReady,e2ee:state==='ready'&&owner.accountId!==null}; publishFeatureReadiness();
    },
  });
  type ActiveMediaRequest={readonly owner:OwnerSnapshot;readonly requestId:RequestId;readonly conversationId:ConversationId;readonly callRef:MediaCallRef};
  let activeMediaRequest:ActiveMediaRequest|null=null;
  let mediaStatus:DomainView|null=null;
  let mediaProjectionOwnerRef=snapshot().ownerRef;
  let mediaProjectionSequence=0;
  let captionView:import('./media-control-types').MediaCaptionSnapshot|null=null;
  let webRtcView:import('./contracts').WebRtcView|null=null;
  let webRtcControlSnapshot:import('./media-control-types').MediaLocalWebRtcSnapshot|null=null;
  let webRtcContext:import('./webrtc-experiment').WebRtcExperimentContext|null=null;
  let mediaScreenRef:string|null=null;
  let activePreviewRef:string|null=null;
  const mediaElements=new Map<string,HTMLVideoElement>();
  const mediaPreviewRefs=new Map<string,import('./media-engine').PreviewRef>();
  const groupPlanRefs=new Map<string,{readonly ownerRef:string;readonly planRef:string;readonly requestId:RequestId}>();
  const storageSelections=new Map<string,{readonly ownerRef:string;readonly targets:readonly string[]}>();
  const mediaRetirementListeners=new Set<(signal:import('./caption-producer').CaptionRetirementSignal)=>void>();
  const captionLocalConsents=new Set<string>();
  const mediaRecordingControl=createMediaRecordingControl({
    ownerSnapshot:snapshot,isCurrent,
    isCallCurrent:context=>{const active=activeMediaRequest;return !!active&&sameOwnerSnapshot(active.owner,context.owner)
      &&active.conversationId===context.conversationId&&active.callRef===context.callRef;},
    currentNick:owner=>isCurrent(owner)?currentNick:null,currentServerPrefix:()=>learnedPrefix,
    sendControl:intent=>{
      if(!isCurrent(intent.owner))return {kind:'blocked',reason:'owner-changed'};
      const active=activeMediaRequest;
      if(!active||!sameOwnerSnapshot(active.owner,intent.owner)||active.conversationId!==intent.conversationId)return {kind:'blocked',reason:'policy'};
      const line=intent.kind==='roster'?formatIRCLine('MEDIA','ROSTER',intent.conversationId)
        :intent.kind==='consent'?formatIRCLine('MEDIA','CONSENT',intent.conversationId,intent.consent??'off')
          :formatIRCLine('MEDIA','RECORD',intent.conversationId,intent.action??'stop');
      return transport.sendLine({line:line.replace(/\r\n$/u,''),owner:intent.owner,requestId:intent.requestId});
    },
    emit:result=>{if(!isCurrent(result.owner))return;const active=activeMediaRequest;
      if(!active||!sameOwnerSnapshot(active.owner,result.owner)||active.conversationId!==result.conversationId||active.callRef!==result.callRef)return;
      mediaEngine.onRecordingControlResult(result);},
  });
  const mediaContext=(context:MediaIdentityContext)=>({owner:context.owner,conversationId:context.conversationId,requestId:context.requestId,callRef:context.callRef as import('./contracts').MediaCallRef});
  const scopedMediaIdentity:MediaIdentityAdapter={
    getPublicIdentity:context=>privateCrypto.privateIdentity.getMediaPublicIdentity(mediaContext(context)),
    signHandshake:(context,canonicalHandshake)=>privateCrypto.privateIdentity.signMediaHandshake({...mediaContext(context),canonicalHandshake}),
    signFrame:(context,canonicalFrame)=>privateCrypto.privateIdentity.signMediaFrame({...mediaContext(context),frame:canonicalFrame}),
    verifyPeerBinding:(context,input)=>privateCrypto.privateIdentity.verifyMediaPeerBinding({...mediaContext(context),...input}),
  };
  const cadenceTransport=createCadenceTransportAdapter({ownerSnapshot:snapshot,isCurrent,transport,privateIdentity:privateCrypto.privateIdentity,
    emit:event=>{try{const envelope=event as {kind?:string};void envelope;}catch{/* private adapter callback is isolated */}},
    platform:platform??({serviceWorker:null,notifications:notificationAdapter,privateStore:platformStore,now:()=>Date.now(),schedule:(fn:()=>void,ms:number)=>{const t=setTimeout(fn,ms);return()=>clearTimeout(t);},
      build:(buildCompatibility??{buildId:'unavailable',protocolVersion:1 as const,storageSchemas:{vault:5 as const,privateCrypto:2 as const,platform:1 as const,tabIntents:1 as const,localWorkspaces:1 as const},shellAssets:[],publicNavigationPaths:[]}),endpoint:()=>endpointId,
      getPushConfig:runtimePushConfig,privateSendWebPush:()=>({kind:'blocked',reason:'policy'})}),
    currentNick:()=>currentNick??'',activeRequest:()=>activeMediaRequest,suppressEngineRosterQueries:true});
  const mediaEngine=createMediaEngine({ownerSnapshot:snapshot,isCurrent,transport,privateIdentity:privateCrypto.privateIdentity,
    isBinaryTransportReady:owner=>isCurrent(owner)&&transport.supportsBinaryMedia(),
    emit:()=>{},platform:platform??({serviceWorker:null,notifications:notificationAdapter,privateStore:platformStore,now:()=>Date.now(),schedule:(fn:()=>void,ms:number)=>{const t=setTimeout(fn,ms);return()=>clearTimeout(t);},
      build:(buildCompatibility??{buildId:'unavailable',protocolVersion:1 as const,storageSchemas:{vault:5 as const,privateCrypto:2 as const,platform:1 as const,tabIntents:1 as const,localWorkspaces:1 as const},shellAssets:[],publicNavigationPaths:[]}),endpoint:()=>endpointId,
      getPushConfig:runtimePushConfig,privateSendWebPush:()=>({kind:'blocked',reason:'policy'})}),
    createEngine:(owner,callbacks,identityAdapter,identityContext)=>cadenceTransport.createEngine(owner,callbacks,identityAdapter,identityContext),
    mediaIdentity:scopedMediaIdentity,verifyPeerMediaKey:async()=>false,currentNick:owner=>isCurrent(owner)?currentNick??'':'' ,captureBroker,recordingControl:mediaRecordingControl,
  });
  const mediaIngress=transport.onPrivateIngress(envelope=>{
    const owner=snapshot();const {line,owner:sourceOwner,sourceKind}=envelope.payload;
    if(!isCurrent(owner)||!sameOwnerSnapshot(sourceOwner,owner))return false;
    if(mediaEngine.consumePrivateIngress(envelope.payload))return true;
    if(sourceKind!=='server'||!learnedPrefix)return false;
    let parsed:ReturnType<typeof parseIRCMessage>;try{parsed=parseIRCMessage(line);}catch{return false;}
    if(parsed.prefix!==learnedPrefix||parsed.command!=='EVENT'||parsed.params[0]!==currentNick)return false;
    const body=parsed.params[1]?.toUpperCase()==='MEDIA'
      ?parsed.params.slice(1).join(' '):(parsed.params[1]??'');
    // These Event Spine replies carry the authoritative per-nick recording
    // roster and consent state. Keep them private even when no request is
    // active; only the scoped typed recording snapshot is public.
    return /^MEDIA\s+(?:ROSTER|ROSTER-END|CONSENT|RECORD)(?:\s|$)/u.test(body);
  });
  const captions=createCaptionProducer({ownerSnapshot:snapshot,isCurrent,
    isCallCurrent:context=>{const room=makeConversationId(context.conversationId);const active=activeMediaRequest;
      if(!room||!active||!sameOwnerSnapshot(active.owner,context.owner)||active.conversationId!==room||active.callRef!==context.callRef)return false;
      const live=mediaEngine.inspect({schemaVersion:1,requestId:context.requestId,owner:context.owner});
      return live?.call?.conversationId===room&&live.call.callRef===context.callRef;},
    getOwnedLocalAudioTrack:async context=>{const room=makeConversationId(context.conversationId);const active=activeMediaRequest;
      if(!room||!active||!sameOwnerSnapshot(active.owner,context.owner)||active.conversationId!==room||active.callRef!==context.callRef)return null;
      const live=mediaEngine.inspect({schemaVersion:1,requestId:context.requestId,owner:context.owner});
      return live?.call?.conversationId===room&&live.call.callRef===context.callRef
        ?mediaEngine.cloneLocalAudioTrack({schemaVersion:1,requestId:context.requestId,owner:context.owner,conversationId:room,callRef:context.callRef as import('./contracts').MediaCallRef}):null;},
    captionConsent:async context=>{const membership=facts?.roomMembershipFacts(context.owner,context.conversationId);const policy=facts?.policySnapshot(context.owner,context.conversationId);
      const active=activeMediaRequest;const room=makeConversationId(context.conversationId);const live=room?mediaEngine.inspect({schemaVersion:1,requestId:context.requestId,owner:context.owner}):null;
      const exactCall=!!room&&!!active&&sameOwnerSnapshot(active.owner,context.owner)&&active.conversationId===room&&active.callRef===context.callRef
        &&live?.call?.conversationId===room&&live.call.callRef===context.callRef;
      const explicitConsent=captionLocalConsents.has(JSON.stringify([context.owner.ownerRef,context.conversationId,context.callRef]));
      return {activeMember:exactCall&&!!membership?.joined&&membership.complete&&!!context.owner.accountId&&membership.memberAccounts.includes(context.owner.accountId),localConsent:exactCall&&explicitConsent&&isCurrent(context.owner),policyRevision:exactCall&&policy?.complete?String(policy.policyGeneration):null};},
    onRetirement:listener=>{mediaRetirementListeners.add(listener);return{dispose:()=>mediaRetirementListeners.delete(listener)};},
    sendCaption:input=>{const conversationId=makeConversationId(input.conversationId);const active=activeMediaRequest;
      if(!conversationId||!active||!sameOwnerSnapshot(active.owner,input.owner)||active.conversationId!==conversationId||active.callRef!==input.callRef||!isCurrent(input.owner))return {kind:'blocked',reason:'policy'};
      const live=mediaEngine.inspect({schemaVersion:1,requestId:active.requestId,owner:active.owner});
      return live?.call?.conversationId===conversationId&&live.call.callRef===input.callRef
        ?cadenceTransport.sendCaption({...input,conversationId}):{kind:'blocked',reason:'policy'};},
    onObservation:observation=>{const conversationId=makeConversationId(observation.conversationId);captionView=conversationId?{owner:observation.owner,conversationId,
      callRef:observation.callRef as import('./contracts').MediaCallRef,state:observation.state,reason:observation.reason,mode:observation.mode,
      language:observation.language,source:observation.source,accuracy:observation.accuracy,interimText:observation.interimText,serverVisible:true}:null;publishMediaDomain();},
  });
  const webRtc=createWebRtcExperiment({ownerSnapshot:snapshot,isCurrent,claimCaptureLease:(ref,owner,room)=>captureBroker.claim(ref,owner,room),
    onObservation:observation=>{webRtcView={phase:observation.state,audioCodec:observation.audioCodec,videoCodec:observation.videoCodec,iceState:observation.iceState,dtlsState:observation.dtlsState,transportClass:observation.transportClass};
      webRtcControlSnapshot={owner:observation.owner,scope:'same-browser-loopback',reason:observation.reason,connectionState:observation.connectionState,
        bytes:observation.inboundBytes,packets:observation.inboundPackets,frames:observation.decodedFrames,durationMs:observation.durationMs};publishMediaDomain();}});
  const captionProducerSnapshot=():import('./media-control-types').MediaCaptionSnapshot|null=>{
    const observed=captions.snapshot();if(observed)return observed;
    return captionView&&isCurrent(captionView.owner)?captionView:null;
  };
  const webRtcSnapshot=():import('./media-control-types').MediaLocalWebRtcSnapshot|null=>
    webRtcControlSnapshot&&isCurrent(webRtcControlSnapshot.owner)?webRtcControlSnapshot:null;
  const webTransport=typeof WebTransport==='undefined'?null:createWebTransportAdapter({ownerSnapshot:snapshot,isCurrent,
    // Adapter failures only publish an actionable status. WSS fallback is a
    // separate, explicit user action with a fresh runtime connection epoch.
    fallbackWss:async()=>{},
    isTrustedWebTransportUrl:(url,endpoint)=>!!config.webTransportUrl&&url.href===new URL(config.webTransportUrl).href&&endpoint===endpointId,
    onLine:(line,owner)=>{if(!isCurrent(owner)||/[\r\n\u0000]/u.test(line))return;},
  });
  let integrationAttempt:{readonly ref:string;readonly owner:OwnerSnapshot;readonly requestId:RequestId;readonly transport:'wss'|'webtransport';readonly endpointId:EndpointId;readonly url:string;phase:'idle'|'connecting'|'ready'|'failed'|'unknown'}|null=null;
  let integrationFallbackTicket:{readonly ref:string;readonly owner:OwnerSnapshot;readonly endpointId:EndpointId;readonly url:string}|null=null;
  let pendingIntegrationFallback:{readonly ref:string;readonly networkId:NetworkId;readonly endpointId:EndpointId;readonly url:string}|null=null;
  const integrationView=():DomainView=>({kind:'integration',transport:integrationAttempt?.transport??(integrationFallbackTicket?'webtransport':'wss'),
    phase:integrationAttempt?.phase??(integrationFallbackTicket?'failed':'idle'),attemptRef:integrationAttempt?.ref??integrationFallbackTicket?.ref??null});
  const integrationStatusSubscription=webTransport?.subscribe(status=>{
    const attempt=integrationAttempt;
    if(!attempt||attempt.transport!=='webtransport'||!sameOwnerSnapshot(attempt.owner,status.owner)||!isCurrent(status.owner))return;
    attempt.phase=status.state==='ready'?'ready':status.state==='connecting'?'connecting':status.state==='failed'||status.state==='unsupported'?'failed':'unknown';
    publishDomainForOwner(status.owner,'integration',integrationView());
  });
  let mediaDomainUnsub=()=>{};
  let mediaControlUnsub=()=>{};
  function publishMediaDomain():void{
    if(disposed)return;const status=mediaEngine.snapshot();const owner=snapshot();
    const inspectRequestId=makeRequestId(randomRef());if(!inspectRequestId)return;
    const control=mediaEngine.inspect({schemaVersion:1,requestId:inspectRequestId,owner});if(!control||!isCurrent(control.owner))return;
    const {owner: privateOwner,...controlView}=control;if(!isCurrent(privateOwner))return;
    const previousCall=mediaStatus?.kind==='media'?mediaStatus.call:null;
    if(previousCall&&(!control.call||control.call.callRef!==previousCall.callRef||control.call.conversationId!==previousCall.conversationId)){
      const active=activeMediaRequest;
      if(active&&active.owner.ownerRef===owner.ownerRef&&active.callRef===previousCall.callRef&&active.conversationId===previousCall.conversationId){
        for(const listener of [...mediaRetirementListeners]){try{listener({owner:active.owner,conversationId:active.conversationId,callRef:active.callRef,reason:'call-ended'});}catch{/* isolate retirement observers */}}
        activeMediaRequest=null;mediaScreenRef=null;
        for(const key of captionLocalConsents)if(key.startsWith(JSON.stringify([owner.ownerRef]).slice(0,-1)))captionLocalConsents.delete(key);
      }
    }
    if(mediaProjectionOwnerRef!==owner.ownerRef){mediaProjectionOwnerRef=owner.ownerRef;mediaProjectionSequence=0;}
    const captionSnapshot=captionProducerSnapshot();const webRtcSnapshotValue=webRtcSnapshot();
    const caption=captionSnapshot&&isCurrent(captionSnapshot.owner)?(({owner: _owner,...safe})=>safe)(captionSnapshot):null;
    const webRtc=webRtcSnapshotValue&&isCurrent(webRtcSnapshotValue.owner)?(({owner: _owner,...safe})=>safe)(webRtcSnapshotValue):null;
    mediaStatus={...controlView,sequence:++mediaProjectionSequence,kind:'media',state:status.state,previewRef:activePreviewRef,screenRef:mediaScreenRef,
      experimentRef:webRtcContext?.requestId??null,experiment:webRtcView,caption,webRtc};
    publishDomain('media',mediaStatus);
    const active=activeMediaRequest;
    if(active&&isCurrent(active.owner)){
      const quality=mediaEngine.qualitySnapshot({context:{schemaVersion:1,requestId:active.requestId,owner:active.owner},conversationId:active.conversationId,callRef:active.callRef as import('./contracts').MediaCallRef});
      if(quality){const view:DomainView={kind:'media-quality',requestId:active.requestId,conversationId:active.conversationId,callRef:active.callRef as import('./contracts').MediaCallRef,
        desiredPolicy:quality.desiredPolicy,observedNetworkTier:quality.observedNetworkTier,observedAudioQuality:quality.observedAudioQuality,videoState:quality.videoState};
        publishDomainForOwner(active.owner,'media',view);}
    }
  }
  const retireMediaOwner=(previous:OwnerSnapshot,next:OwnerSnapshot,physicalRetirement=false,allowFallback=true):void=>{
    if(activeMediaRequest?.owner.ownerRef===previous.ownerRef){
      const active=activeMediaRequest;const requestContext={schemaVersion:1 as const,requestId:active.requestId,owner:previous,conversationId:active.conversationId,callRef:active.callRef};
      try{captions.stop(requestContext);}catch{/* caption retirement is best effort */}
      for(const listener of [...mediaRetirementListeners]){try{listener({owner:previous,conversationId:active.conversationId,callRef:active.callRef,reason:'owner-retired'});}catch{/* isolate */}}
    }
    if(webRtcContext?.owner.ownerRef===previous.ownerRef){webRtc.stop(webRtcContext);webRtcContext=null;webRtcView=null;webRtcControlSnapshot=null;}
    const samePhysical=!physicalRetirement&&previous.physicalRef!==null&&previous.physicalRef===next.physicalRef&&previous.networkId===next.networkId
      &&previous.connectionGeneration===next.connectionGeneration;
    if(integrationFallbackTicket&&sameOwnerSnapshot(integrationFallbackTicket.owner,previous))
      integrationFallbackTicket=samePhysical?{...integrationFallbackTicket,owner:next}:null;
    const priorAttempt=integrationAttempt;
    const attemptBelongs=!!priorAttempt&&sameOwnerSnapshot(priorAttempt.owner,previous);
    const rebindAlternative=samePhysical&&attemptBelongs&&priorAttempt?.transport==='webtransport'
      &&webTransport?.rebindOwner(previous,next)===true;
    cadenceTransport.retire(previous);mediaEngine.retireOwner(previous,next);activeMediaRequest=null;mediaScreenRef=null;activePreviewRef=null;
    let retireIntegration=false;
    if(samePhysical&&attemptBelongs&&(priorAttempt?.transport==='wss'||rebindAlternative)){
      integrationAttempt={...priorAttempt!,owner:next};
    }else if(attemptBelongs){
      retireIntegration=true;integrationAttempt=null;
      if(allowFallback&&priorAttempt?.transport==='webtransport'&&priorAttempt.phase==='failed'){
        if(physicalRetirement)pendingIntegrationFallback={ref:randomRef(),networkId:previous.networkId,endpointId:priorAttempt.endpointId,url:priorAttempt.url};
        else integrationFallbackTicket={ref:randomRef(),owner:next,endpointId:priorAttempt.endpointId,url:priorAttempt.url};
      }
    }
    for(const key of captionLocalConsents)if(key.startsWith(JSON.stringify([previous.ownerRef]).slice(0,-1)))captionLocalConsents.delete(key);
    for(const [ref,preview] of mediaPreviewRefs){if(preview.ownerRef===previous.ownerRef)mediaPreviewRefs.delete(ref);}
      if(!samePhysical)webTransport?.close('owner-retired');captionView=null;webRtcControlSnapshot=null;publishMediaDomain();
    if(retireIntegration)publishDomain('integration',integrationView());
  };
  const namespaceForRequest=(request: import('./contracts').RequestContext)=>localWorkspaces.namespaceForRequest(request);
  const isNamespaceCurrent=(ticket:LocalNamespaceTicket,request:import('./contracts').RequestContext)=>localWorkspaces.isNamespaceCurrent(ticket,request);
  const ownedStorage=createOwnedStorage({
    ...(typeof indexedDB!=='undefined'?{indexedDB}:{}),ownerSnapshot:snapshot,isCurrent,
    namespaceForRequest,isNamespaceCurrent,
    canonicalConversationKey:(owner,target,scheme)=>{
      if(!isCurrent(owner)||!scheme)return null;
      const folded=normalizeCase(target,scheme.name);
      return canonicalTupleKey([String(owner.networkId),scheme.name,folded]);
    },
    projectForPersistence:async({context,conversationId,wireBodyRef,candidate})=>{
      if(!isCurrent(context.owner)||!localWorkspaces.namespaceForRequest(context))return {kind:'blocked' as const,reason:'stale-owner' as const};
      const policy=cryptoPolicy(context.owner,conversationId);
      if(!policy||policy.encryption==='unknown')return {kind:'blocked' as const,reason:'policy-unknown' as const};
      const roomTarget=conversationId.startsWith('#')||conversationId.startsWith('&');
      if((candidate.privacy==='room-ciphertext'&&!roomTarget)||(candidate.privacy==='dm-ciphertext'&&roomTarget))return {kind:'blocked' as const,reason:'invalid-envelope' as const};
      if(policy.encryption==='room-required'&&candidate.privacy!=='room-ciphertext')return {kind:'blocked' as const,reason:'encryption-required' as const};
      if(policy.encryption==='dm-required'&&candidate.privacy!=='dm-ciphertext')return {kind:'blocked' as const,reason:'encryption-required' as const};
      if(candidate.privacy==='room-ciphertext'&&parseGroupEnvelope(candidate.body)===null)return {kind:'blocked' as const,reason:'invalid-envelope' as const};
      if(candidate.privacy==='dm-ciphertext'&&!isValidDmEnvelope(candidate.body))return {kind:'blocked' as const,reason:'invalid-envelope' as const};
      const {wireBodyRef:_wireRef,localRecordId:_localRecordId,...row}=candidate;
      return {kind:'persistable' as const,row,policyRevision:policy.revision};
    },
    currentPolicyRevision:(owner,conversationId)=>cryptoPolicy(owner,conversationId)?.revision??null,
    retentionPolicy:(owner,conversationId)=>{const fact=facts?.policySnapshot(owner,conversationId);if(!fact?.complete||!fact.ephemeralKnown)return null;
      return {keep:400,ephemeralSeconds:fact.ephemeralSeconds===0?null:fact.ephemeralSeconds,complete:true};},measureIdb:event=>metrics.recordIdb(event.kind,event.durationMs),
    retentionObservation:(owner,conversationId)=>{
      if(!isCurrent(owner))return null;const fact=facts?.policySnapshot(owner,conversationId);const scheme=facts?.conversationKeyScheme(owner);
      if(!fact?.complete||!fact.ephemeralKnown||!scheme)return null;
      const revision=JSON.stringify(['onyx-retention-policy-v1',owner.networkId,normalizeCase(conversationId,scheme.name),scheme.revision,fact.encryption,fact.ephemeralSeconds]);
      if(new TextEncoder().encode(revision).byteLength>2048)return null;
      return {keep:400,ephemeralSeconds:fact.ephemeralSeconds===0?null:fact.ephemeralSeconds,complete:true,revision};
    },
    isOfflineReadContext:(request,ticket)=>isCurrent(request.owner)&&request.owner.networkId===ticket.scope.networkId&&(
      learnedPrefix===null&&request.owner.accountId===null&&request.owner.physicalRef===null&&ticket.scope.kind==='account'||
      request.owner.accountId===null&&request.owner.physicalRef!==null&&ticket.scope.kind==='account'&&ticket.scope.historyOnly===true),
  });
  refreshRetentionObservation=(owner,target)=>{
    const requestId=makeRequestId(randomRef());const conversationId=makeConversationId(target);
    if(!requestId||!conversationId||!isCurrent(owner))return;
    const context={schemaVersion:1 as const,requestId,owner};
    void ownedStorage.refreshRetention(context,conversationId).catch(()=>undefined);
  };
  const draftSaveTails=new Map<string,Promise<unknown>>();
  const drafts=createDraftStore({
    ...(typeof indexedDB!=='undefined'?{indexedDB}:{}),ownerSnapshot:snapshot,isCurrent,namespaceForRequest,isNamespaceCurrent,
    canonicalConversationKey:(owner,target,ticket)=>canonicalForTicket(owner,target,ticket),
    recoverySelection:{isCurrent,isNamespaceCurrent,now:Date.now,randomRef},
    sealLocalDraft:async(request,ticket,conversationId,revision,plaintext)=>{
      const grant=localWorkspaces.grant(); if(!grant||!localWorkspaces.validateGrant(grant)||!isNamespaceCurrent(ticket,request))return null;
      const result=await privateCrypto.sealWorkspaceLocal({context:request,grant,conversationId,purpose:`draft:${revision}`,plaintext});
      if(result.kind!=='sealed'||!result.bytes||result.bytes.length<28)return null;
      return {nonce:result.bytes.slice(0,12),ciphertext:result.bytes.slice(12)};
    },
    openLocalDraft:async(request,ticket,row)=>{
      const grant=localWorkspaces.grant(); if(!grant||!localWorkspaces.validateGrant(grant)||!isNamespaceCurrent(ticket,request))return null;
      const packed=new Uint8Array(row.nonce.length+row.ciphertext.length);packed.set(row.nonce);packed.set(row.ciphertext,row.nonce.length);
      const result=await privateCrypto.openWorkspaceLocal({context:request,grant,conversationId:row.conversationId,purpose:`draft:${row.revision}`,ciphertext:packed});packed.fill(0);
      return result.kind==='opened'?result.bytes??null:null;
    },
  });
  draftStoreForRetirement=drafts;
  let journal: ReturnType<typeof createOutboxJournal> | null = null;
  let scheduledCustody: ReturnType<typeof createScheduledCustody> | null = null;
  let memorySend: ReturnType<typeof createMemorySendOwner> | null = null;
  const pendingAcceptanceProofs=new Map<symbol,import('./send-acceptance-registry').SendAcceptanceProofReady>();
  // Tell the UI a send was proven accepted by the server (its echo matched), so
  // the row's "queued" state clears. Without this the UI only ever saw the
  // initial transport-admitted result and kept every sent message queued.
  const sendAcceptedListeners=new Set<(event:{readonly clientIntentId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number})=>void>();
  const announceSendAccepted=(proof:import('./send-acceptance-registry').SendAcceptanceProofReady):void=>{
    const owner=proof.context.owner;if(!isCurrent(owner))return;
    const event={clientIntentId:proof.clientIntentId,ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration)};
    for(const listener of [...sendAcceptedListeners]){try{listener(event);}catch{/* observer failures do not affect delivery state */}}
  };
  const flushAcceptanceProofs=(recordId?:string):void=>{
    for(const [proofRef,proof] of pendingAcceptanceProofs){
      if(recordId&&proof.recordId!==recordId)continue;
      if(!isCurrent(proof.context.owner)){pendingAcceptanceProofs.delete(proofRef);continue;}
      if(proof.storageKind==='memory'){
        void memorySend?.reconcileAccepted({context:proof.context,recordId:proof.recordId,proofRef}).then(result=>{
          if(result.status==='server-accepted'){acceptance.acceptanceProofCommitted(proofRef);pendingAcceptanceProofs.delete(proofRef);announceSendAccepted(proof);}
        });
      }else if(journal){
        void journal.reconcileAccepted({...proof.context,recordId:proof.recordId,proofRef}).then(result=>{
          if(result==='server-accepted'){acceptance.acceptanceProofCommitted(proofRef);pendingAcceptanceProofs.delete(proofRef);announceSendAccepted(proof);}
        });
      }
    }
  };
  const acceptance=createSendAcceptanceRegistry({ownerSnapshot:snapshot,isCurrent,isNamespaceCurrent,negotiatedCaps:()=>negotiatedCapabilities,currentServerPrefix:()=>learnedPrefix,
    currentNick:()=>currentNick,currentEndpointId:()=>endpointId,currentMappingRevision:()=>facts?.conversationKeyScheme(snapshot())?.revision??null,now:Date.now,
    onProofReady:proof=>{
      pendingAcceptanceProofs.set(proof.proofRef,proof);while(pendingAcceptanceProofs.size>128)pendingAcceptanceProofs.delete(pendingAcceptanceProofs.keys().next().value as symbol);
      flushAcceptanceProofs(proof.recordId);
    }});
  const acceptanceIngress=transport.onPrivateIngress(event=>acceptance.ingest(event.payload));
  const physicalSendGroupTails=new Map<string,Promise<void>>();
  journal=createOutboxJournal({
    ...(typeof indexedDB!=='undefined'?{indexedDB}:{}),ownerSnapshot:snapshot,isCurrent,namespaceForRequest,isNamespaceCurrent,transport,
    policySnapshot:(intent,ticket,target)=>{
      if(intent.operation==='memo-send'){
        // MEMO targets are AccountIds, not conversation nicknames. This
        // callback supplies persisted row metadata only; recipient routing
        // stays bound by the memo operation and sealed target tuple.
        return {ownerProven:isCurrent(intent.owner)&&intent.owner.accountId!==null&&ticket.scope.kind==='account'
          &&ticket.scope.accountId===intent.owner.accountId&&learnedPrefix!==null,
          policyGeneration:Number(intent.owner.accountGeneration),channelMembership:'unknown',encryption:'unknown',
          canSend:'unknown',networkReady:transport.isOpen(),offlineMemoAllowed:false};
      }
      const request=intent;
      const conversationId=makeConversationId(target);const policy=conversationId?cryptoPolicy(request.owner,conversationId):null;
      const membership=conversationId?facts?.roomMembershipFacts(request.owner,conversationId):null;
      const channel=target.startsWith('#')||target.startsWith('&');
      return {ownerProven:isCurrent(request.owner)&&request.owner.accountId!==null&&learnedPrefix!==null,
        policyGeneration:conversationId?facts?.policySnapshot(request.owner,conversationId).policyGeneration??-1:-1,channelMembership:channel?(membership?.joined?'joined':'unknown'):'joined',
        encryption:policy?.encryption==='plain'?'plain':policy?.encryption==='dm-required'?'dm-required':policy?.encryption==='room-required'?'room-required':'unknown',
        canSend:policy?.eligible===true&&(channel?membership?.canSend===true:true),networkReady:transport.isOpen(),offlineMemoAllowed:false};
    },
    scheduledPolicySnapshot:(request,ticket,target,targetKey)=>{
      const conversationId=makeConversationId(target);
      return conversationId?scheduledPolicySnapshot(request,ticket,conversationId,targetKey):null;
    },
    canonicalConversationKey:(owner,target,ticket)=>canonicalForTicket(owner,makeConversationId(target)??target as ConversationId,ticket),
    prepareQueuedPayload:async(intent,ticket)=>{
      const target=intent.operation==='privmsg'?intent.conversationId:intent.recipientAccount;
      const conversationId=makeConversationId(target);
      if(!conversationId||!isNamespaceCurrent(ticket,intent))return {kind:'blocked' as const,reason:'unsafe-policy' as const};
      const policy=intent.operation==='memo-send'?null:cryptoPolicy(intent.owner,conversationId);
      const targetKey=canonicalForTicket(intent.owner,conversationId,ticket);if(!targetKey)return {kind:'blocked' as const,reason:'unsafe-policy' as const};
      const audiencePrefix=intent.audiencePrefix??null;
      if(intent.operation==='privmsg'&&audiencePrefix!==null&&(!statusMessagePrefixes.has(audiencePrefix)||policy?.encryption!=='plain'||!policy?.eligible))return {kind:'blocked' as const,reason:'unsafe-policy' as const};
      const body=new TextEncoder().encode(intent.body);
      const sealedPolicyRevision=intent.capturedPolicy
        ? intent.capturedPolicy.kind==='known'?intent.capturedPolicy.semanticRevision:undefined
        : policy?.revision;
      const sealed=await privateCrypto.prepareQueuedPayload({owner:intent.owner,conversationId,requestId:intent.requestId,clientIntentId:intent.clientIntentId,operation:intent.operation,targetKey,body,messageKind:intent.messageKind??'message',replyTo:intent.replyTo??null,audiencePrefix,...(sealedPolicyRevision?{policyRevision:sealedPolicyRevision}:{})});body.fill(0);
      if(sealed.kind!=='sealed-local'||!sealed.bytes)return {kind:'blocked' as const,reason:'local-key-unavailable' as const};
      if(!sealed.payloadCommitment){sealed.bytes.fill(0);return {kind:'blocked' as const,reason:'local-key-unavailable' as const};}
      return {kind:'ready' as const,payload:{kind:'sealed-local-plaintext' as const,ciphertext:sealed.bytes,payloadCommitment:sealed.payloadCommitment},policyRevision:sealed.policyRevision??'local-sealed-intent-v1'};
    },
    prepareDispatch:async(row,ticketRequest,ticket)=>{
      const isMemo=row.operation==='memo-send';
      const conversationId=makeConversationId(row.target);
      if(!conversationId)return {kind:'held' as const,reason:'policy-changed' as const};
      const grant=workspaceGrantForOwner(ticketRequest.owner);
      const memoAccount=isMemo&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(row.target)?makeAccountId(row.target):null;
      const policy:CryptoPolicy|null=isMemo
        ?ticketRequest.owner.accountId!==null&&grant!==null&&grant.scope===ticket.scope&&grant.scope.kind==='account'&&grant.scope.accountId===ticketRequest.owner.accountId
          &&memoAccount===row.target&&ticket.scope.kind==='account'&&ticket.scope.accountId===ticketRequest.owner.accountId
          ?{revision:row.policyRevision,encryption:'plain',eligible:true,room:null,epoch:null}:null
        :conversationId?cryptoPolicy(ticketRequest.owner,conversationId):null;
      if(!policy||!policy.eligible||policy.encryption==='unknown'||row.payload.kind!=='sealed-local-plaintext'||!isNamespaceCurrent(ticket,ticketRequest))return {kind:'held' as const,reason:'policy-changed' as const};
      // A display nickname without a proven account binding is not a stable
      // peer identity. Such DMs may use a fresh volatile send, but a durable
      // queued row must not replay to a later holder of that nickname.
      if(!isMemo&&conversationId&&!conversationId.startsWith('#')&&!conversationId.startsWith('&')
        &&facts?.dmPolicySnapshot(ticketRequest.owner,conversationId).accountId===null)
        return {kind:'review-needed' as const,reason:'policy-changed' as const};
      if(row.policyRevision!=='local-sealed-intent-v1'&&row.policyRevision!==policy.revision)return {kind:'held' as const,reason:'policy-changed' as const};
      if(!conversationId)return {kind:'held' as const,reason:'policy-changed' as const};
      const opened=await privateCrypto.prepareDispatch({owner:ticketRequest.owner,conversationId,requestId:ticketRequest.requestId,clientIntentId:row.clientIntentId as RequestId,operation:row.operation,targetKey:row.targetKey,payload:row.payload.ciphertext,policyRevision:row.policyRevision});
      if(opened.kind!=='ready'||!opened.body||!isNamespaceCurrent(ticket,ticketRequest))return {kind:'held' as const,reason:'policy-changed' as const};
      // The provider opens and validates the canonical v2 tuple and returns
      // the message metadata alongside its policy-protected semantic body.
      // The row intentionally stores no plaintext metadata.
      const metadata=opened as typeof opened & {messageKind?:'message'|'action';replyTo?:string|null;audiencePrefix?:string|null};
      let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(opened.body);}catch{return {kind:'held' as const,reason:'policy-changed' as const};}finally{opened.body.fill(0);}
      const messageKind=metadata.messageKind;const replyTo=metadata.replyTo;const audiencePrefix=metadata.audiencePrefix;
      if((messageKind!=='message'&&messageKind!=='action')||!(replyTo===null||typeof replyTo==='string'&&!!makeMessageId(replyTo))
        ||!(audiencePrefix===null||typeof audiencePrefix==='string'&&/^[!.@+]$/u.test(audiencePrefix)))return {kind:'held' as const,reason:'policy-changed' as const};
      if(isMemo&&(messageKind!=='message'||replyTo!==null||audiencePrefix!==null||text.includes('\n')||text.includes('\r')||text.includes('\0')))
        return {kind:'review-needed' as const,reason:'policy-changed' as const};
      if(replyTo!==null&&!negotiatedCapabilities.has('draft/reply'))return {kind:'review-needed' as const,reason:'policy-changed' as const};
      const membership=facts?.roomMembershipFacts(ticketRequest.owner,conversationId);
      if(audiencePrefix!==null&&(!statusMessagePrefixes.has(audiencePrefix)||policy.encryption!=='plain'||!policy.eligible||!membership?.joined||!membership.canSend||!membership.complete))return {kind:'held' as const,reason:'policy-changed' as const};
      if(messageKind==='action'&&text.includes('\n'))return {kind:'review-needed' as const,reason:'policy-changed' as const};
      const wireTarget=audiencePrefix?`${audiencePrefix}${row.target}`:row.target;
      const requiredRoom=policy.encryption==='room-required';
      if(requiredRoom&&(!text.startsWith(GROUP_ENVELOPE_PREFIX)||text.includes('\n')||new TextEncoder().encode(text).byteLength>MAX_GROUP_ENVELOPE_WIRE_BYTES))
        return {kind:'review-needed' as const,reason:'policy-changed' as const};
      const tags:Record<string,string>={};
      if(replyTo)tags['+draft/reply']=replyTo;
      if(requiredRoom)tags['+onyx/e2ee']='mls';
      let rawLines:string[];
      if(isMemo){
        rawLines=[formatIRCLine('MEMO','SEND',row.target,text)];
      }else if(text.includes('\n')&&hasNegotiatedMultiline()){
        const batches=planMultilineBatches(text,negotiatedMultilineLimits());
        if(!batches)return {kind:'review-needed' as const,reason:'policy-changed' as const};
        rawLines=buildMultilineLines(wireTarget,batches,undefined,tags).lines;
      }else if(text.includes('\n')){
        const parts=text.split('\n').filter(part=>part.trim().length>0);
        if(parts.length===0)return {kind:'review-needed' as const,reason:'policy-changed' as const};
        rawLines=parts.map(part=>formatTaggedLine(tags,'PRIVMSG',wireTarget,part));
      }else rawLines=[formatTaggedLine(tags,'PRIVMSG',wireTarget,text)];
      const lines=rawLines.map(line=>line.endsWith('\r\n')?line.slice(0,-2):line);
      const lineValidations=lines.map(validateClientLine);
      if(lines.length===0||lines.length>1024||lineValidations.some(result=>!result.valid)
        ||lineValidations.reduce((sum,result)=>sum+(result.valid?result.byteLength:0),0)>256*1024)return {kind:'review-needed' as const,reason:'policy-changed' as const};
      if(!isNamespaceCurrent(ticket,ticketRequest))return {kind:'held' as const,reason:'owner-changed' as const};
      let recordId:string|null=null;try{const parts=JSON.parse(row.id) as unknown[];if(parts[0]===ticket.ownerKey&&typeof parts[1]==='string')recordId=parts[1];}catch{/* corrupt journal key */}
      if(!recordId||!row.claimNonce)return {kind:'review-needed' as const,reason:'policy-changed' as const};
      const prepared=await acceptance.prepareAttempt({context:ticketRequest,ticket,recordId,clientIntentId:row.clientIntentId,
        semanticCommitment:row.payload.payloadCommitment,storageKind:'durable',claimNonce:row.claimNonce,operation:row.operation,
        baseTarget:row.target,baseTargetKey:row.targetKey,wireTarget,lines,semanticShape:isMemo?'memo':text.includes('\n')&&hasNegotiatedMultiline()?'multiline-batch-group':text.includes('\n')?'independent-message-lines':'single-message'});
      if(!prepared||!isNamespaceCurrent(ticket,ticketRequest))return {kind:'review-needed' as const,reason:'policy-changed' as const};
      return {kind:'ready' as const,lines:prepared.lines,validationReceipt:prepared.validationReceipt};
    },
    validatePreparedDispatch:(row,request,ticket,prepared)=>{
      const isMemo=row.operation==='memo-send';const conversationId=makeConversationId(row.target);
      const memoAccount=isMemo&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(row.target)?makeAccountId(row.target):null;
      const grant=workspaceGrantForOwner(request.owner);
      const currentPolicy:CryptoPolicy|null=isMemo
        ?request.owner.accountId!==null&&grant!==null&&grant.scope===ticket.scope&&grant.scope.kind==='account'&&grant.scope.accountId===request.owner.accountId
          &&memoAccount===row.target&&ticket.scope.kind==='account'&&ticket.scope.accountId===request.owner.accountId
          ?{revision:row.policyRevision,encryption:'plain',eligible:true,room:null,epoch:null}:null
        :conversationId?cryptoPolicy(request.owner,conversationId):null;
      return !!currentPolicy&&isNamespaceCurrent(ticket,request)&&acceptance.validatePreparedDispatch(row,request,ticket,prepared);
    },
    withDispatchGroup:async(request,ticket,run)=>{
      const key=String(request.owner.physicalRef??request.owner.ownerRef);const previous=physicalSendGroupTails.get(key)??Promise.resolve();let release!:()=>void;
      const hold=new Promise<void>(resolve=>{release=resolve;});const queued=previous.then(()=>hold);physicalSendGroupTails.set(key,queued);
      await previous;
      try{return isNamespaceCurrent(ticket,request)?await run():null;}finally{release();if(physicalSendGroupTails.get(key)===queued)physicalSendGroupTails.delete(key);}
    },
    memoCorrelationClear:(request,ticket)=>acceptance.memoCorrelationClear(request,ticket),
    verifyAcceptanceProof:(proofRef,request,row)=>acceptance.verifyAcceptanceProof(proofRef,request,row),
    observeAcceptanceAdmission:input=>{acceptance.observeAdmission(input);if(input.kind==='transport-admitted'||input.kind==='unknown')flushAcceptanceProofs(input.recordId);},
    acceptanceProofCommitted:proofRef=>acceptance.acceptanceProofCommitted(proofRef),
    measureIdb:event=>metrics.recordIdb(event.kind,event.durationMs),
  });
  scheduledCustody=createScheduledCustody({
    ...(typeof indexedDB!=='undefined'?{indexedDB}:{}),namespaceForRequest,isNamespaceCurrent,
    canonicalConversationKey:(owner,conversationId,ticket)=>canonicalForTicket(owner,conversationId,ticket),
    capturePolicy:({context,ticket,conversationId,targetKey})=>scheduledPolicySnapshot(context,ticket,conversationId,targetKey),
    checkDispatchPolicy:({context,ticket,conversationId,targetKey,captured})=>checkScheduledPolicy(context,ticket,conversationId,targetKey,captured),
    readPrivateInput:(inputRef,context,kind)=>readPrivateScheduledMessage(inputRef,context,kind),
    seal:async({context,ticket,operationId,revision,purpose,conversationId,targetKey,exactBinding,plaintext})=>{
      const grant=localWorkspaces.grant();
      if(!grant||grant.scope.kind!=='account'||!localWorkspaces.validateGrant(grant)||!isNamespaceCurrent(ticket,context)
        ||purpose!==`scheduled:${operationId}:${revision}`||exactBinding!==targetKey||canonicalForTicket(context.owner,conversationId,ticket)!==targetKey)return null;
      const result=await privateCrypto.sealWorkspaceLocal({context,grant,conversationId,exactBinding,purpose,plaintext});
      return result.kind==='sealed'&&result.bytes&&isNamespaceCurrent(ticket,context)&&localWorkspaces.validateGrant(grant)?result.bytes:null;
    },
    open:async({context,ticket,operationId,revision,purpose,conversationId,targetKey,exactBinding,ciphertext})=>{
      const grant=localWorkspaces.grant();
      if(!grant||grant.scope.kind!=='account'||!localWorkspaces.validateGrant(grant)||!isNamespaceCurrent(ticket,context)
        ||purpose!==`scheduled:${operationId}:${revision}`||exactBinding!==targetKey||canonicalForTicket(context.owner,conversationId,ticket)!==targetKey)return null;
      const result=await privateCrypto.openWorkspaceLocal({context,grant,conversationId,exactBinding,purpose,ciphertext});
      return result.kind==='opened'&&result.bytes&&isNamespaceCurrent(ticket,context)&&localWorkspaces.validateGrant(grant)?result.bytes:null;
    },
    enqueueJournal:async input=>{
      if(!journal||!isCurrent(input.owner))return 'not-accepted';
      const result=await journal.queueScheduledMessage({...input,operation:'privmsg',conversationId:input.conversationId,body:input.body,
        replyTo:input.replyTo,messageKind:input.messageKind,audiencePrefix:input.audiencePrefix,capturedPolicy:input.capturedPolicy});
      if(result.status==='queued'||result.status==='existing'){
        if(isCurrent(input.owner))void journal.flush(input).catch(()=>undefined);
        return 'accepted';
      }
      if(result.status==='unavailable'||result.status==='quota'||result.status==='stale-owner')return 'unknown';
      return 'not-accepted';
    },
    journalStatus:async(context,clientIntentId)=>{
      if(!journal||!isCurrent(context.owner))return 'unknown';
      const result=await journal.listEntries(context);
      if(result.status!=='ready')return 'unknown';
      return result.entries.some(entry=>entry.clientIntentId===clientIntentId)?'accepted':'not-found';
    },
    enqueueVolatile:async input=>{
      if(!memorySend||!isCurrent(input.owner))return 'not-accepted';
      const result=await memorySend.submit({context:input,intent:{operation:'privmsg',clientIntentId:input.clientIntentId,
        conversationId:input.conversationId,targetKey:input.targetKey,messageKind:input.messageKind,replyTo:input.replyTo,
        audiencePrefix:input.audiencePrefix,body:input.body}});
      if(result.status==='server-accepted')return 'server-accepted';
      if(result.status==='blocked'||result.status==='stale-owner')return 'not-accepted';
      return 'unknown';
    },
    volatileStatus:async(context,clientIntentId)=>{
      if(!memorySend||!isCurrent(context.owner))return 'unknown';
      const entry=memorySend.inspect(context).find(value=>value.clientIntentId===clientIntentId);
      if(entry?.status==='server-accepted')return 'server-accepted';
      // Absence from an in-memory summary cannot prove that no bytes were
      // admitted before retirement, so unknown never authorizes a retry.
      return 'unknown';
    },
    now:Date.now,
  });
  const runScheduledDuePump=async():Promise<void>=>{
    if(disposed||!physicalStarted||learnedPrefix===null||!transport.isOpen()||scheduledDueWorkActive)return;
    scheduledDueWorkActive=true;
    try{

        const pumpOwner=snapshot();
        const requestId=makeRequestId(randomRef());
        if(!requestId||pumpOwner.physicalRef===null||!isCurrent(pumpOwner))return;
        const context={schemaVersion:1 as const,requestId,owner:pumpOwner};
        const ticket=namespaceForRequest(context);
        if(!ticket||ticket.access!=='read-write'||ticket.scope.kind==='account'&&ticket.scope.historyOnly===true||!isNamespaceCurrent(ticket,context))return;
        const listed=await scheduledCustody?.list(context);
        if(!listed||listed.status!=='ready'||!isCurrent(pumpOwner)||!isNamespaceCurrent(ticket,context))return;
        const due=selectDueScheduledRows(listed.rows,Date.now(),4);
        let changed=false;
        for(const row of due){
          if(!isCurrent(pumpOwner)||!isNamespaceCurrent(ticket,context)||learnedPrefix===null||!transport.isOpen())break;
          const conversationId=row.conversationId;
          if(!conversationId||row.revision===null)continue;
          const targetKey=canonicalForTicket(pumpOwner,conversationId,ticket);if(!targetKey)continue;
          const captured=scheduledPolicySnapshot(context,ticket,conversationId,targetKey);
          if(!captured||captured.kind!=='known'||checkScheduledPolicy(context,ticket,conversationId,targetKey,captured)!=='compatible')continue;
          const policy=cryptoPolicy(pumpOwner,conversationId);if(!policy?.eligible)continue;
          const channel=conversationId.startsWith('#')||conversationId.startsWith('&');
          if(channel){const membership=facts?.roomMembershipFacts(pumpOwner,conversationId);
            if(!membership?.joined||!membership.complete||!membership.canSend)continue;
            if(row.audiencePrefix!==null&&(!statusMessagePrefixes.has(row.audiencePrefix)||policy.encryption!=='plain'))continue;
          }else{
            const dm=facts?.dmPolicySnapshot(pumpOwner,conversationId);
            if(!dm?.complete||dm.encrypted&&pumpOwner.accountId===null)continue;
          }
          if(row.replyTo!==null&&!negotiatedCapabilities.has('draft/reply'))continue;
          const dispatchId=makeRequestId(randomRef());if(!dispatchId)continue;
          const dispatchContext={schemaVersion:1 as const,requestId:dispatchId,owner:pumpOwner};
          const result=await scheduledCustody?.dispatch({...dispatchContext,scheduleRef:row.scheduleRef,expectedRevision:row.revision});
          if(!result||!isCurrent(pumpOwner)||!isNamespaceCurrent(ticket,context))break;
          changed=changed||result.status!=='not-due';
        }
        if(changed&&isCurrent(pumpOwner)&&isNamespaceCurrent(ticket,context)){
          const refreshId=makeRequestId(randomRef());
          if(refreshId){const refreshed=await scheduledCustody?.list({schemaVersion:1,requestId:refreshId,owner:pumpOwner});
            if(refreshed?.status==='ready'&&isCurrent(pumpOwner)&&isNamespaceCurrent(ticket,context))publishDomain('scheduled',scheduledDomainView(context,refreshed));}
        }
    }finally{scheduledDueWorkActive=false;}
  };
  const scheduledDuePump=createScheduledDuePump({runDue:runScheduledDuePump,intervalMs:15_000});
  const stopScheduledDuePump=():void=>scheduledDuePump.stop();
  const startScheduledDuePump=():void=>{if(!disposed&&physicalStarted&&learnedPrefix!==null&&transport.isOpen())scheduledDuePump.start();};
  const memoryPlanReceipts=new Map<symbol,{readonly receipt:import('./send-acceptance-registry').PreparedAcceptanceAttempt;readonly context:import('./contracts').RequestContext;
    readonly ticket:LocalNamespaceTicket;readonly recordId:string;readonly claimNonce:string;readonly intent:MemoryChatIntent;readonly policy:MemorySendPolicy;
    readonly semanticCommitment:string;readonly baseTarget:string;readonly baseTargetKey:string;readonly wireTarget:string}>();
  memorySend=createMemorySendOwner({ownerSnapshot:snapshot,isCurrent,isRegistered:owner=>isCurrent(owner)&&owner.physicalRef!==null&&learnedPrefix!==null&&currentNick!==null&&transport.isOpen(),
    policySnapshot:(owner,intent)=>{
      if(!isCurrent(owner))return null;const kind=intent.conversationId.startsWith('#')||intent.conversationId.startsWith('&')?'channel':'dm';
      const policy=cryptoPolicy(owner,intent.conversationId);const membership=kind==='channel'?facts?.roomMembershipFacts(owner,intent.conversationId):null;
      const dm=kind==='dm'?facts?.dmPolicySnapshot(owner,intent.conversationId):null;
      const scheme=facts?.conversationKeyScheme(owner);if(!policy||policy.encryption!=='plain'||!policy.eligible||!scheme)return null;
      if(kind==='dm'&&(!dm?.complete||dm.encrypted))return null;
      if(kind==='channel'&&(!membership?.joined||!membership.canSend))return null;
      return {owner,targetKind:kind,networkReady:transport.isOpen()&&learnedPrefix!==null,encryption:'plain',policyRevision:policy.revision,
        mappingRevision:scheme.revision,policyGeneration:kind==='channel'?facts!.policySnapshot(owner,intent.conversationId).policyGeneration:Number(owner.accountGeneration),
        channelMembership:kind==='channel'?'joined':'not-applicable',canSend:true};
    },
    prepareLivePlan:async({context,recordId,claimNonce,intent})=>{
      const ticket=namespaceForRequest(context);if(!ticket||!ticket.conversationScheme||!isNamespaceCurrent(ticket,context))return null;
      const policyValue=cryptoPolicy(context.owner,intent.conversationId);const scheme=facts?.conversationKeyScheme(context.owner);
      const targetKey=canonicalForTicket(context.owner,intent.conversationId,ticket);if(!policyValue||policyValue.encryption!=='plain'||!policyValue.eligible||!scheme||!targetKey)return null;
      const membership=facts?.roomMembershipFacts(context.owner,intent.conversationId);
      if((intent.conversationId.startsWith('#')||intent.conversationId.startsWith('&'))&&(!membership?.joined||!membership.canSend))return null;
      if(intent.audiencePrefix!==null&&(!statusMessagePrefixes.has(intent.audiencePrefix)||!membership?.joined||!membership.canSend||!membership.complete))return null;
      if(intent.replyTo!==null&&!negotiatedCapabilities.has('draft/reply'))return null;
      let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(intent.body);}catch{return null;}
      if(text.includes('\r')||text.includes('\0')||intent.messageKind==='action'&&text.includes('\n'))return null;
      const tags:Record<string,string>={};if(intent.replyTo)tags['+draft/reply']=intent.replyTo;
      const body=intent.messageKind==='action'?`\u0001ACTION ${text}\u0001`:text;
      const wireTarget=intent.audiencePrefix?`${intent.audiencePrefix}${intent.conversationId}`:intent.conversationId;
      let rawLines:string[];
      if(text.includes('\n')){
        if(hasNegotiatedMultiline()){const batches=planMultilineBatches(body,negotiatedMultilineLimits());if(!batches)return null;rawLines=buildMultilineLines(wireTarget,batches,undefined,tags).lines;}
        else if(intent.messageKind==='message')rawLines=text.split('\n').filter(part=>part.trim().length>0).map(part=>formatTaggedLine(tags,'PRIVMSG',wireTarget,part));
        else return null;
      }else rawLines=[formatTaggedLine(tags,'PRIVMSG',wireTarget,body)];
      const lines=rawLines.map(line=>line.endsWith('\r\n')?line.slice(0,-2):line);
      const lineValidations=lines.map(validateClientLine);
      if(!lines.length||lines.length>1024||lineValidations.some(result=>!result.valid)
        ||lineValidations.reduce((sum,result)=>sum+(result.valid?result.byteLength:0),0)>256*1024)return null;
      const commitmentInput=new TextEncoder().encode(JSON.stringify([2,'privmsg',targetKey,intent.messageKind,intent.replyTo,intent.audiencePrefix,text]));
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',commitmentInput));commitmentInput.fill(0);
      const semanticCommitment=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');digest.fill(0);
      const receipt=await acceptance.prepareAttempt({context,ticket,recordId,clientIntentId:intent.clientIntentId,semanticCommitment,storageKind:'memory',claimNonce,
        operation:'privmsg',baseTarget:intent.conversationId,baseTargetKey:targetKey,wireTarget,lines,semanticShape:text.includes('\n')&&hasNegotiatedMultiline()?'multiline-batch-group':text.includes('\n')?'independent-message-lines':'single-message'});
      if(!receipt||!isNamespaceCurrent(ticket,context))return null;
      const validationReceipt=Symbol('memory-send-plan');
      memoryPlanReceipts.set(validationReceipt,{receipt,context,ticket,recordId,claimNonce,intent,policy: {
        owner:context.owner,targetKind:intent.conversationId.startsWith('#')||intent.conversationId.startsWith('&')?'channel':'dm',networkReady:true,encryption:'plain',
        policyRevision:policyValue.revision,mappingRevision:scheme.revision,policyGeneration:(facts?.policySnapshot(context.owner,intent.conversationId).policyGeneration??Number(context.owner.accountGeneration)),
          channelMembership:membership?'joined':'not-applicable',canSend:true},semanticCommitment,baseTarget:intent.conversationId,baseTargetKey:targetKey,wireTarget});
      while(memoryPlanReceipts.size>64)memoryPlanReceipts.delete(memoryPlanReceipts.keys().next().value as symbol);
      return {lines:receipt.lines,validationReceipt,planHash:receipt.planHash};
    },
    validatePreparedPlan:input=>{
      const saved=memoryPlanReceipts.get(input.plan.validationReceipt);if(!saved)return false;
      return saved.recordId===input.recordId&&saved.intent.clientIntentId===input.intent.clientIntentId
        &&saved.context.requestId===input.context.requestId&&saved.context.owner.ownerRef===input.context.owner.ownerRef
        &&isNamespaceCurrent(saved.ticket,input.context)&&saved.policy.policyRevision===input.policy.policyRevision
        &&acceptance.validateMemoryPreparedPlan({context:input.context,ticket:saved.ticket,recordId:input.recordId,clientIntentId:input.intent.clientIntentId,
          claimNonce:saved.claimNonce,semanticCommitment:saved.semanticCommitment,baseTarget:saved.baseTarget,baseTargetKey:saved.baseTargetKey,wireTarget:saved.wireTarget,prepared:saved.receipt});
    },
    sendLineGroup:input=>{
      if(disposed||disposingRuntime)return [{kind:'blocked',reason:'owner-changed'}];
      const saved=memoryPlanReceipts.get(input.plan.validationReceipt);if(!saved||saved.recordId!==input.recordId||saved.claimNonce!==input.claimNonce||!isCurrent(input.context.owner))return [{kind:'blocked',reason:'owner-changed'}];
      memoryPlanReceipts.delete(input.plan.validationReceipt);
      const admissions=transport.sendLineGroup({lines:input.plan.lines,requestId:input.context.requestId,owner:input.context.owner});
      const kind=admissions.length===input.plan.lines.length&&admissions.every(item=>item.kind==='transport-admitted')?'transport-admitted':admissions.some(item=>item.kind==='unknown')||admissions.some(item=>item.kind==='transport-admitted')?'unknown':'blocked';
      acceptance.observeAdmission({recordId:input.recordId,claimNonce:input.claimNonce,planHash:input.plan.planHash,kind});
      if(kind==='transport-admitted'||kind==='unknown')flushAcceptanceProofs(input.recordId);
      return admissions;
    },
    verifyAcceptanceProof:(proofRef,context,recordId,clientIntentId)=>acceptance.verifyMemoryAcceptanceProof(proofRef,context,recordId,clientIntentId),
    onObservation:()=>{},now:Date.now});
  const markerProofs = new Map<symbol, { readonly owner: OwnerSnapshot; readonly requestId: RequestId; readonly conversationId: ConversationId; readonly proof: import('./read-anchor-store').AcceptedMarkerProof; readonly expiresAt: number }>();
  type PendingMarker = { readonly owner: OwnerSnapshot; readonly requestId: RequestId; readonly conversationId: ConversationId; readonly targetKey: string; readonly mappingRevision: string; readonly expectedTimestamp: string | null; readonly expiresAt: number };
  const pendingMarkerRequests = new Map<string, PendingMarker>();
  const markerRequestKey = (owner: OwnerSnapshot, targetKey: string) => JSON.stringify([owner.physicalRef, owner.connectionGeneration, owner.accountGeneration, targetKey]);
  const anchors=createReadAnchorStore({...(typeof indexedDB!=='undefined'?{indexedDB}:{}),namespaceForRequest,isNamespaceCurrent,
    canonicalConversationKey:(owner,target,ticket)=>canonicalForTicket(owner,target,ticket),conversationMappingRevision:(owner,ticket)=>facts?.conversationKeyScheme(owner)?.revision??ticket.conversationScheme?.revision??null,
    consumeMarkerProof:(proofRef,request,conversationId)=>{
      const saved=markerProofs.get(proofRef);if(!saved)return null;markerProofs.delete(proofRef);
      return saved.expiresAt>Date.now()&&saved.owner.ownerRef===request.owner.ownerRef&&saved.requestId===request.requestId
        &&saved.conversationId===conversationId&&isCurrent(saved.owner)?saved.proof:null;
    }});
  const markerIngress=transport.onPrivateIngress(envelope=>{
    const {line,owner:sourceOwner,sourceKind}=envelope.payload;const owner=snapshot();
    if(disposed||!isCurrent(owner)||sourceOwner.ownerRef!==owner.ownerRef||sourceKind!=='prefixless-protocol')return false;
    let parsed:ReturnType<typeof parseIRCMessage>;try{parsed=parseIRCMessage(line);}catch{return false;}
    if(parsed.prefix!==null||parsed.command!=='MARKREAD'||parsed.params.length<2)return false;
    const rawTarget=parsed.params[0],rawMarker=parsed.params[1];if(!rawTarget||!rawMarker)return false;
    const conversationId=makeConversationId(rawTarget);if(!conversationId)return false;
    const request=[...pendingMarkerRequests.values()].find(item=>item.owner.ownerRef===owner.ownerRef&&item.owner.physicalRef===owner.physicalRef
      &&item.owner.connectionGeneration===owner.connectionGeneration&&item.expiresAt>Date.now()&&item.conversationId===conversationId);
    if(!request)return false;
    const ticket=namespaceForRequest({schemaVersion:1,requestId:request.requestId,owner});
    const targetKey=ticket?canonicalForTicket(owner,conversationId,ticket):null;
    const mappingRevision=facts?.conversationKeyScheme(owner)?.revision??null;
    if(!ticket||!targetKey||targetKey!==request.targetKey||mappingRevision!==request.mappingRevision)return true;
    const marker=rawMarker.startsWith('timestamp=')?rawMarker.slice('timestamp='.length):rawMarker;
    const timestamp=makeReadMarkerTimestamp(marker);
    if(!timestamp||request.expectedTimestamp!==null&&timestamp<request.expectedTimestamp)return true;
    pendingMarkerRequests.delete(markerRequestKey(owner,request.targetKey));
    const proofRef=Symbol('accepted-markread');
    markerProofs.set(proofRef,{owner,requestId:request.requestId,conversationId,expiresAt:Date.now()+30_000,
      proof:{timestamp,targetKey:request.targetKey,mappingRevision:request.mappingRevision}});
    while(markerProofs.size>64)markerProofs.delete(markerProofs.keys().next().value as symbol);
    void anchors.persistAccepted({schemaVersion:1,requestId:request.requestId,owner,conversationId,proofRef}).then(result=>{
      if(!isCurrent(owner))return;
      if(result==='persisted-accepted'||result==='unchanged')publishDomain('anchor',{kind:'anchor',conversationId,acceptedTimestamp:timestamp,viewedCandidate:null});
      config.onReadMarkerResult?.({ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),requestId:request.requestId,conversationId,timestamp,status:result});
    });
    return true;
  });
  const reserveMarkerRequest=(line:string,owner:OwnerSnapshot,requestId:RequestId):{key:string;request:PendingMarker}|null=>{
    if(!negotiatedCapabilities.has('draft/read-marker'))return null;
    let parsed:ReturnType<typeof parseIRCMessage>;try{parsed=parseIRCMessage(line);}catch{return null;}
    if(parsed.command!=='MARKREAD')return null;
    const rawTarget=parsed.params[0];const conversationId=rawTarget&&makeConversationId(rawTarget);if(!conversationId)return null;
    const context={schemaVersion:1 as const,requestId,owner};const ticket=namespaceForRequest(context);const targetKey=ticket?canonicalForTicket(owner,conversationId,ticket):null;
    const mappingRevision=facts?.conversationKeyScheme(owner)?.revision??null;if(!ticket||!targetKey||!mappingRevision)return null;
    const key=markerRequestKey(owner,targetKey);if(pendingMarkerRequests.has(key))return null;
    const token=parsed.params[1];const expectedTimestamp=token?.startsWith('timestamp=')?makeReadMarkerTimestamp(token.slice('timestamp='.length)):null;
    if(token!==undefined&&token!=='*'&&expectedTimestamp===null)return null;
    const request:PendingMarker={owner,requestId,conversationId,targetKey,mappingRevision,expectedTimestamp,expiresAt:Date.now()+15_000};
    pendingMarkerRequests.set(key,request);while(pendingMarkerRequests.size>64)pendingMarkerRequests.delete(pendingMarkerRequests.keys().next().value as string);
    return {key,request};
  };
  const installId=(()=>{try{const key='onyx:elm-installation-id';const old=storage?.getItem(key);if(old&&/^[A-Za-z0-9_-]{22,128}$/u.test(old))return old;const next=randomRef();storage?.setItem(key,next);return next;}catch{return randomRef();}})();
  const settings=createSettingsStore({...(typeof indexedDB!=='undefined'?{indexedDB}:{}),ownerSnapshot:snapshot,isCurrent,namespaceForRequest,isNamespaceCurrent,
    installationId:installId,canonicalConversationKey:(owner,target,ticket)=>canonicalForTicket(owner,makeConversationId(target)??target as ConversationId,ticket)});
  const backupStorage=createPrivateBackupStorage({...(typeof indexedDB!=='undefined'?{indexedDB}:{}),ownerSnapshot:snapshot,isCurrent,namespaceForRequest,isNamespaceCurrent,
    validateEncryptedBackup:bytes=>bytes.length>=64&&bytes.length<=8*1024*1024});
  const evictionPlans=new Map<string,import('./eviction-policy').EvictionPreview>();
  const settingsPreviews=new Map<string,{readonly ownerRef:string;readonly preview:ReturnType<ReturnType<typeof createSettingsStore>['previewImport']>}>();
  const journalEntryRefs=new Map<string,{readonly ownerRef:string;readonly recordId:string}>();
  const eviction=createEvictionPolicy({namespaceForRequest,isNamespaceCurrent,
    readAcceptedHistory:async(request,ticket,conversationId,maximum)=>{
      if(!isNamespaceCurrent(ticket,request))return [];
      const result=await ownedStorage.get({schemaVersion:1,requestId:request.requestId,owner:request.owner,conversationId,limit:Math.min(400,maximum)});
      if(result.status!=='ready'||!isNamespaceCurrent(ticket,request))return [];
      return result.rows.map(row=>({owner:request.owner,conversationId,recordId:row.recordId,atMs:row.atMs,accepted:true,redacted:row.redacted}));
    },
    retentionPolicy:(request,ticket,conversationId)=>{
      if(!isNamespaceCurrent(ticket,request))return null;const fact=facts?.policySnapshot(request.owner,conversationId);
      return fact?.complete&&fact.ephemeralKnown?{revision:`policy-v1:${fact.encryption}:${fact.ephemeralSeconds??'none'}`,bounds:{keep:400,ephemeralSeconds:fact.ephemeralSeconds===0?null:fact.ephemeralSeconds}}:null;
    },
    clearAccepted:async(request,ticket,conversationId,recordIds)=>{
      if(!isNamespaceCurrent(ticket,request))return 0;
      return await ownedStorage.clearAcceptedRecords({schemaVersion:1,requestId:request.requestId,owner:request.owner,conversationId,recordIds})??0;
    },
  });

  const runtimeRequest = (owner: OwnerSnapshot, requestId?: string) => {
    const id=makeRequestId(requestId??randomRef());
    return id?{schemaVersion:1 as const,requestId:id,owner}:null;
  };
  const writableVaultTicket=async(owner:OwnerSnapshot,request:import('./contracts').RequestContext):Promise<LocalNamespaceTicket|null>=>{
    if(!isCurrent(owner))return null;
    let ticket=namespaceForRequest(request);
    // Never replace an explicitly selected offline/history namespace with the
    // live account workspace. Such tickets are intentionally read-only.
    if(ticket&&ticket.access!=='read-write')return null;
    const ownerKey=workspaceInitializationKey(owner);
    const pending=workspaceInitializations.get(ownerKey);
    if(pending){
      const ready=await pending;
      if(!ready||!isCurrent(owner))return null;
      if(workspaceInitializations.get(ownerKey)===pending)workspaceInitializations.delete(ownerKey);
      ticket=namespaceForRequest(request);
      if(ticket&&ticket.access!=='read-write')return null;
    }
    const scheme=facts?.conversationKeyScheme(owner);
    const matchesScheme=(candidate:LocalNamespaceTicket|null,authenticated:ConversationKeyScheme|null):boolean=>!!candidate&&!!authenticated
      &&candidate.conversationScheme?.name===authenticated.name&&candidate.conversationScheme.revision===authenticated.revision;
    if(!ticket||scheme&&!matchesScheme(ticket,scheme)){
      // A missing ticket with some other selected scope means the request is
      // intentionally outside that workspace. Do not replace it with a
      // default scope just to make this write proceed.
      if(!ticket&&localWorkspaces.current()!==null)return null;
      // With no selected ticket, only a live registered owner may create or
      // select its default workspace. For a mismatched live scheme, the same
      // deduplicated initializer persists that authenticated mapping first.
      if(!scheme||learnedPrefix===null||!isCurrent(owner))return null;
      const ready=await initializeDefaultWorkspace(owner);
      if(!ready||!isCurrent(owner))return null;
      ticket=namespaceForRequest(request);
      if(ticket&&ticket.access!=='read-write')return null;
      const currentScheme=facts?.conversationKeyScheme(owner);
      if(!matchesScheme(ticket,currentScheme))return null;
    }
    if(!ticket||ticket.access!=='read-write'||!isCurrent(owner))return null;
    return ticket;
  };
  const queueOutgoing = async (input:{readonly owner:OwnerSnapshot;readonly conversationId:string;readonly text:string;readonly intent:'chat'|'memo';readonly replyTo:string|null;readonly messageKind?:'message'|'action';readonly audiencePrefix?:string|null;readonly requestId:string;readonly clientIntentId?:string;readonly flushAfterQueue?:boolean}):Promise<RuntimeDomainResult>=>{
    const request=runtimeRequest(input.owner,input.requestId);const conversationId=makeConversationId(input.conversationId);
    const base={schemaVersion:1 as const,requestId:request?.requestId??makeRequestId(randomRef())!,ownerRef:input.owner.ownerRef,
      accountGeneration:Number(input.owner.accountGeneration),connectionGeneration:Number(input.owner.connectionGeneration),domain:'journal',action:'queue'};
    const messageKind=input.messageKind??'message';const audiencePrefix=input.audiencePrefix??null;const clientIntentId=makeRequestId(input.clientIntentId??request?.requestId??'');
    if(!request||!clientIntentId||!isCurrent(input.owner)||!conversationId||typeof input.text!=='string'||/[\u0000-\u0008\u000b-\u001f\u007f\r]/u.test(input.text)||new TextEncoder().encode(input.text).byteLength>65_536
      ||(messageKind!=='message'&&messageKind!=='action')||(input.replyTo!==null&&!makeMessageId(input.replyTo))
      ||(audiencePrefix!==null&&!/^[!.@+]$/u.test(audiencePrefix))||(input.intent==='memo'&&(input.replyTo!==null||messageKind!=='message'||audiencePrefix!==null)))
      return {...base,status:'blocked',completionScope:'local',reason:'invalid-or-unsupported-intent',view:null};
    // Account 900 can arrive while the default workspace's IndexedDB lookup
    // is still pending. Do not turn that initialization race into a stale
    // namespace ticket or let the journal capture an unselected workspace.
    const pendingWorkspace=workspaceInitializations.get(workspaceInitializationKey(input.owner));
    if(pendingWorkspace){
      const ready=await pendingWorkspace;
      if(!ready||!isCurrent(input.owner))return {...base,status:'blocked',completionScope:'local',reason:'workspace-unavailable',view:null};
    }
    let queueTicket=namespaceForRequest(request);
    const authenticatedScheme=facts?.conversationKeyScheme(input.owner);
    if(!queueTicket||(authenticatedScheme&&(queueTicket.conversationScheme?.name!==authenticatedScheme.name
      ||queueTicket.conversationScheme.revision!==authenticatedScheme.revision))){
      const ready=await initializeDefaultWorkspace(input.owner);
      if(!ready||!isCurrent(input.owner))return {...base,status:'blocked',completionScope:'local',reason:'workspace-unavailable',view:null};
      queueTicket=namespaceForRequest(request);
      if(!queueTicket)return {...base,status:'cancelled',completionScope:'local',reason:'stale-owner',view:null};
      const currentScheme=facts?.conversationKeyScheme(input.owner);
      if(currentScheme&&(queueTicket.conversationScheme?.name!==currentScheme.name
        ||queueTicket.conversationScheme.revision!==currentScheme.revision))
        return {...base,status:'blocked',completionScope:'local',reason:'workspace-unavailable',view:null};
    }
      if(audiencePrefix!==null){const policy=cryptoPolicy(input.owner,conversationId);const member=facts?.roomMembershipFacts(input.owner,conversationId);
      if(!statusMessagePrefixes.has(audiencePrefix)||policy?.encryption!=='plain'||!policy.eligible||!member?.canSend||!member.complete)return {...base,status:'blocked',completionScope:'local',reason:'audience-policy-unavailable',view:null};}
    const isRoomTarget=conversationId.startsWith('#')||conversationId.startsWith('&');
    const directFacts=!isRoomTarget?facts?.dmPolicySnapshot(input.owner,conversationId):null;
    if(input.intent==='chat'&&(input.owner.accountId===null||typeof indexedDB==='undefined'||!isRoomTarget&&directFacts?.accountId===null)){
      const ticket=namespaceForRequest(request);const targetKey=ticket?canonicalForTicket(input.owner,conversationId,ticket):null;
      if(!ticket||!targetKey)return {...base,status:'blocked',completionScope:'local',reason:'workspace-unavailable',view:null};
      const body=new TextEncoder().encode(input.text);
      const result=await memorySend!.submit({context:request,intent:{operation:'privmsg',clientIntentId,conversationId,targetKey,
        messageKind,replyTo:input.replyTo as import('./contracts').MessageId|null,audiencePrefix,body}});body.fill(0);
      const status:RuntimeDomainResult['status']=result.status==='server-accepted'?'accepted':result.status==='transport-admitted'?'transport-admitted':result.status==='delivery-unknown'?'unknown':result.status==='stale-owner'?'cancelled':'blocked';
      const state:import('./contracts').JournalPublicEntry['state']=result.status==='server-accepted'?'server-accepted':result.status==='transport-admitted'?'transport-admitted':result.status==='delivery-unknown'?'delivery-unknown':result.status==='stale-owner'?'cancelled':'held';
      const entryRef=randomRef();return {...base,status,completionScope:result.status==='server-accepted'?'server':result.status==='transport-admitted'?'transport':'local',reason:result.reason,
        view:{kind:'journal',entries:[{entryRef,clientIntentId,conversationId,intent:'chat',durability:'volatile',state,createdAtMs:Date.now()}],entryRef}};
    }
    let queued;
    if(input.intent==='memo'){
      const peer=facts?.resolvePeerConversation(input.owner,conversationId);
      if(!peer||peer.owner.ownerRef!==input.owner.ownerRef)return {...base,status:'blocked',completionScope:'local',reason:'memo-recipient-unverified',view:null};
      queued=await journal.queueMemo({...request,clientIntentId,operation:'memo-send',recipientAccount:peer.accountId,body:input.text});
    }else queued=await journal.queueMessage({...request,clientIntentId,operation:'privmsg',conversationId,body:input.text,replyTo:input.replyTo,messageKind,audiencePrefix});
    let status:RuntimeDomainResult['status']=queued.status==='queued'||queued.status==='existing'?'accepted':queued.status==='memory-only'?'held':queued.status==='stale-owner'?'cancelled':'blocked';
    let reason:string|null=status==='accepted'?null:queued.status;
    if(input.flushAfterQueue!==false&&(queued.status==='queued'||queued.status==='existing')&&queued.recordId&&transport.isOpen()){
      // Scope immediate admission to this exact durable row. An owner-wide
      // flush can report another row's transport result and must not settle
      // this request's composer/draft state.
      const attempted=await journal.retryQueued(request,queued.recordId);
      if(attempted.status==='transport-admitted')status='transport-admitted';
      else if(attempted.status==='delivery-unknown')status='unknown';
      else if(attempted.status==='stale-owner')status='cancelled';
      else if(attempted.status==='blocked')status='held';
      if(status==='transport-admitted')reason=null;
      else if(attempted.status!=='idle'&&attempted.status!=='unavailable')reason=attempted.status;
    }
    const entryRef=queued.recordId?randomRef():null;if(entryRef&&queued.recordId)journalEntryRefs.set(entryRef,{ownerRef:input.owner.ownerRef,recordId:queued.recordId});
    const entry=entryRef?{entryRef,clientIntentId,conversationId,intent:input.intent,durability:'durable' as const,state:(status==='transport-admitted'?'transport-admitted':status==='unknown'?'delivery-unknown':status==='accepted'?'queued':'held') as import('./contracts').JournalPublicEntry['state'],createdAtMs:Date.now()}:null;
    const view:DomainView={kind:'journal',entries:entry?[entry]:[],entryRef};
    return {...base,status,completionScope:status==='transport-admitted'?'transport':'local',reason,view};
  };
  const flushOutgoing = async (input:{readonly owner:OwnerSnapshot;readonly requestId:string}):Promise<RuntimeDomainResult>=>{
    const request=runtimeRequest(input.owner,input.requestId);const base={schemaVersion:1 as const,requestId:request?.requestId??makeRequestId(randomRef())!,ownerRef:input.owner.ownerRef,
      accountGeneration:Number(input.owner.accountGeneration),connectionGeneration:Number(input.owner.connectionGeneration),domain:'journal',action:'flush'};
    if(!request||!isCurrent(input.owner))return {...base,status:'cancelled',completionScope:'local',reason:'stale-owner',view:null};
    const result=await journal.flush(request);
    const status:RuntimeDomainResult['status']=result.status==='transport-admitted'?'transport-admitted':result.status==='delivery-unknown'?'unknown':result.status==='idle'?'accepted':result.status==='stale-owner'?'cancelled':'blocked';
    return {...base,status,completionScope:status==='transport-admitted'?'transport':'local',reason:status==='accepted'||status==='transport-admitted'?null:result.status,
      view:{kind:'journal',entries:[],entryRef:null}};
  };

  const sendCredentialLine = (line: string, owner: OwnerSnapshot): SendAdmission => {
    const requestId: RequestId | null = makeRequestId(randomRef());
    if (!requestId) return { kind: 'blocked', reason: 'invalid-intent' };
    return transport.sendLine({ line, owner, requestId });
  };
  const credentialTransport = { sendLine: ({ line, owner }: { line: string; owner: OwnerSnapshot }): SendAdmission => sendCredentialLine(line, owner) };
  sessionOperations=createSessionOperationOwner({currentOwner:snapshot,isCurrent});
  const startCredentialIssuance=(owner:OwnerSnapshot,requestedId?:RequestId):SendAdmission=>{
    const requestId=requestedId??makeRequestId(randomRef());
    if(!requestId||!isCurrent(owner)||owner.accountId===null||!learnedPrefix||credentialIssuanceLease)return {kind:'blocked',reason:'policy'};
    const context:RequestContext={schemaVersion:1,requestId,owner};
    const lease=sessionOperations?.acquire(context,'token-issue');
    if(!lease)return {kind:'blocked',reason:'backpressure'};
    credentialIssuanceLease=lease;
    const admission=credentials.issueBundle(owner,credentialTransport);
    if(admission.kind==='blocked'){
      if(credentialIssuanceLease===lease)credentialIssuanceLease=null;
      lease.release();
    }else if(admission.kind==='unknown')lease.markUnknown();
    return admission;
  };
  const guardedCredentialOperation = async (operation:(owner:OwnerSnapshot)=>SendAdmission,explicitNewAttachment=false):Promise<SendAdmission>=>{
    const owner=snapshot();
    // A mid-session sign-in is an owner change, and retiring the guest owner
    // retires its tab intent. "Create a new attachment" is itself the user's
    // explicit request for a fresh attachment, so acquire a fresh intent the
    // same way the session `new-attachment` action does instead of blocking
    // silently on a missing lease.
    if(explicitNewAttachment&&!activeTabIntentRef&&isCurrent(owner)&&owner.accountId!==null){
      const created=await tabIntents.createFreshIntent(true);
      const acquired=created.kind==='created'?await tabIntents.acquire(created.intentRef):created;
      if(acquired.kind==='acquired'&&acquired.intentRef&&isCurrent(owner))activeTabIntentRef=acquired.intentRef;
    }
    const ref=activeTabIntentRef;
    if(!ref||!tabIntents.assertCurrentLease(ref))return {kind:'blocked',reason:'policy'};
    if(!await tabIntents.markOperationStarted(ref)||!isCurrent(owner)||!tabIntents.assertCurrentLease(ref))return {kind:'blocked',reason:'owner-changed'};
    const admission=operation(owner);
    await tabIntents.settleOperation(ref,admission.kind==='blocked'?'definitively-unadmitted':admission.kind==='unknown'?'unknown':'accepted');
    return isCurrent(owner)?admission:{kind:'unknown',reason:'transport-error'};
  };
  const resolveTarget = (url: string): { networkId: NetworkId; endpointId: EndpointId } | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.hash || /[\u0000-\u0020\u007f]/u.test(url)) return null;
      const canonical = parsed.href;
      const registered = config.endpointRegistry?.find(entry => new URL(entry.url).href === canonical);
      if (registered) {
        const trustedNetwork = makeNetworkId(registered.networkId);
        const trustedEndpoint = makeEndpointId(registered.endpointId);
        return trustedNetwork && trustedEndpoint ? { networkId: trustedNetwork, endpointId: trustedEndpoint } : null;
      }
      if (parsed.search) return null;
      const scoped = `custom:${parsed.origin}${parsed.pathname}`;
      const customNetwork = makeNetworkId(scoped);
      const customEndpoint = makeEndpointId(scoped);
      return customNetwork && customEndpoint ? { networkId: customNetwork, endpointId: customEndpoint } : null;
    } catch { return null; }
  };
  function applyProvenAccount(next: AccountId | null): void {
    if (next === accountId) {
      if (learnedPrefix !== null) { initializeDefaultWorkspace(snapshot()); startScheduledDuePump(); }
      return;
    }
    const previous = snapshot();
    flushPublicIngress(previous);
    if (!isCurrent(previous)) return;
    retireNotificationClaims(previous);
    const recoveryAuthTransfer=recoveryTransfer!==null&&recoveryTransfer.destinationOwner!==null
      &&sameOwnerSnapshot(recoveryTransfer.destinationOwner,previous)
      &&recoveryTransfer.targetNetwork===networkId&&recoveryTransfer.targetEndpoint===endpointId
      &&recoveryTransfer.targetUrl===currentUrl&&recoveryTransfer.fromOwner.networkId===networkId
      &&previous.physicalRef!==null&&next!==null&&next===recoveryTransfer.fromOwner.accountId;
    if(recoveryTransfer&&!recoveryAuthTransfer&&next===null){recoveryController?.retire(recoveryTransfer.fromOwner);recoveryLegacyIntentKeys.delete(recoveryIntentKey(recoveryTransfer.requestId,recoveryTransfer.credentialRef));recoveryTransfer=null;}
    else if(!recoveryAuthTransfer&&recoveryTransfer){recoveryController?.retire(recoveryTransfer.fromOwner);recoveryLegacyIntentKeys.delete(recoveryIntentKey(recoveryTransfer.requestId,recoveryTransfer.credentialRef));recoveryTransfer=null;}
    if(!recoveryAuthTransfer)recoveryController?.retire(previous);
    sessionMeshControl?.retire(previous);accountCommunity?.retire(previous);sessionOperations?.retire(previous);draftStoreForRetirement?.retireOwner(previous);
    integrationOperations?.retire(previous);
    clearPrivateOutHookPresentations(previous.ownerRef);
    retireVaultPumpsForOwner(previous);
    // Revoke the old namespace before changing the live account stamp. This
    // prevents A's selected plaintext partition from being read as B.
    workspaceInitGeneration += 1;
    localWorkspaces.lock();
    scheduledCustody?.retireOwner(previous);
    for(const pending of pendingIdentify.values())clearTimeout(pending.timer);
    pendingIdentify.clear();
    webAuthn?.retireOwner(previous);
    scheduledCustody?.retireOwner(previous);
    passkeyManagement?.retire(previous);for(const [key,pending] of pendingWebAuthn){if(pending.owner.ownerRef===previous.ownerRef){clearPendingWebAuthn(pending);pendingWebAuthn.delete(key);}}
    abortPendingContinuations();
    pendingMarkerRequests.clear();markerProofs.clear();
    for(const [ref,fact] of freshGenesisProofs)if(fact.owner.ownerRef===previous.ownerRef)freshGenesisProofs.delete(ref);
    for(const [ref,fact] of freshGenesisReservations)if(fact.owner.ownerRef===previous.ownerRef)freshGenesisReservations.delete(ref);
    clearWebhookPresentationForOwner(previous.ownerRef);
    captureBroker.retireOwner(previous); captureIntentRefs.clear();
    clearPrivateScheduledMessages(previous.ownerRef);
    clearPrivateFiles();
    facts?.retire(previous);
    acceptance.retireOwner(previous); memorySend?.retireOwner(previous);
    privateCrypto.retireOwner(previous);
    privateCrypto.groupProviders.authoring.retireOwner(previous);
    accountId = next;
    saslContexts.clear();
    accountGeneration = makeAccountGeneration(Number(accountGeneration) + 1)!;
    ownerRef = makeOwnerRef(randomRef())!;
    clientSafetyState=null;
    const accountWasProven=accountId!==null;
    if(!accountWasProven)privateAccountSecurity?.retireOwner(previous);
    retireMediaOwner(previous,snapshot());
    workerTargets.clear();workerActivations.clear();pushConsentRefs.clear();
    credentials.retire(previous);
    retireRecoveryIssuanceForOwner(previous);
    if (learnedPrefix && accountId) {
      credentials.learnServerPrefix(learnedPrefix, snapshot());
      identity.learnServerPrefix(learnedPrefix, snapshot());
      identity.proveAccount(snapshot());
    } else identity.retire(previous);
    if(learnedPrefix){
      facts?.onRegistered({owner:snapshot()});
      const requestId=makeRequestId(randomRef());if(requestId){const context={schemaVersion:1 as const,requestId,owner:snapshot()};
        for(const target of joinedTargetsByPhysical.get(String(physicalRef))??[])facts?.observeJoinedTarget(context,target);}
    }
    if (learnedPrefix !== null) { initializeDefaultWorkspace(snapshot()); startScheduledDuePump(); }
    const provenDestination=snapshot();
    const recoveryAfterProof=recoveryAuthTransfer&&next!==null&&recoveryTransfer
      ?{requestId:recoveryTransfer.requestId,fromOwner:recoveryTransfer.fromOwner,transfer:recoveryTransfer}
      :null;
    if(recoveryAfterProof)recoveryTransfer={...recoveryAfterProof.transfer,destinationOwner:provenDestination,observationTransferFrom:previous};
    featureReady = { e2ee: false, media: false };
    publishFeatureReadiness();
    if(next!==null)claimPendingNotificationRoute();
    if(accountWasProven)privateAccountSecurity?.onAccountProven(previous,provenDestination);
    // The new account/owner stamp must reach Elm before continueAfterAuthentication
    // synchronously publishes its first pending observation. That observation
    // carries a one-use transferFrom for the exact destination guest stamp.
    if(recoveryAfterProof){
      const transfer=recoveryAfterProof;
      void recoveryController?.continueAfterAuthentication(provenDestination).then(admission=>{
        if((admission===null||admission.kind==='blocked')&&recoveryTransfer?.requestId===transfer.requestId){
          recoveryController?.retire(provenDestination);recoveryController?.retire(transfer.fromOwner);recoveryTransfer=null;
        }
        else if(recoveryTransfer?.requestId===transfer.requestId&&recoveryTransfer.observationTransferFrom===null)recoveryTransfer=null;
      });
    }
  }

  function applyPrivateAccountSourceProof(sourceOwner:OwnerSnapshot,rawAccount:string,sourceEndpoint:EndpointId):void{
    if(!isCurrent(sourceOwner)||sourceOwner.physicalRef===null||sourceEndpoint!==endpointId||sourceOwner.networkId!==networkId)return;
    const canonical=rawAccount.replace(/[A-Z]/gu,letter=>letter.toLowerCase());
    const account=makeAccountId(canonical);if(!account||accountId!==null&&accountId!==account)return;
    if(accountId===account){privateAccountSecurity?.onAccountProven(sourceOwner,snapshot());return;}
    applyProvenAccount(account);
  }

  retirePhysicalOwner=(expected,closeTransport=false,preserveWorkspaceSelection=false,nextNetwork?:NetworkId,nextEndpoint?:EndpointId):void=>{
    if(!isCurrent(expected)){
      if(closeTransport)transport.close();
      return;
    }
    flushPublicIngress(expected);
    if(!isCurrent(expected))return;
    retireNotificationClaims(expected);
    if(recoveryTransfer&&sameOwnerSnapshot(recoveryTransfer.fromOwner,expected)){
      const controlled=recoveryTransfer.targetEndpoint===nextEndpoint&&recoveryTransfer.targetUrl===currentUrl;
      recoveryController?.retire(expected,{controlledRedirect:controlled});
      if(!controlled){recoveryLegacyIntentKeys.delete(recoveryIntentKey(recoveryTransfer.requestId,recoveryTransfer.credentialRef));recoveryTransfer=null;}
    }else recoveryController?.retire(expected);
    sessionMeshControl?.retire(expected);accountCommunity?.retire(expected);sessionOperations?.retire(expected);draftStoreForRetirement?.retireOwner(expected);
    integrationOperations?.retire(expected);
    clearPrivateOutHookPresentations(expected.ownerRef);
    physicalStarted=false;
    retireVaultPumpsForOwner(expected);
    stopScheduledDuePump();
    workspaceInitGeneration+=1;
    if(!preserveWorkspaceSelection)localWorkspaces.lock();
    for(const pending of pendingIdentify.values())clearTimeout(pending.timer);
    pendingIdentify.clear();webAuthn?.retireOwner(expected);passkeyManagement?.retire(expected);for(const [key,pending] of pendingWebAuthn){if(pending.owner.ownerRef===expected.ownerRef){clearPendingWebAuthn(pending);pendingWebAuthn.delete(key);}}
    abortPendingContinuations();pendingMarkerRequests.clear();markerProofs.clear();
    joinedTargetsByPhysical.delete(String(expected.physicalRef));
    clearWebhookPresentationForOwner(expected.ownerRef);captureBroker.retireOwner(expected);captureIntentRefs.clear();
    scheduledCustody?.retireOwner(expected);clearPrivateScheduledMessages(expected.ownerRef);clearPrivateFiles();privateAccountSecurity?.retireOwner(expected);facts?.retire(expected);
    acceptance.retireOwner(expected);memorySend?.retireOwner(expected);privateCrypto.retireOwner(expected);
    privateCrypto.groupProviders.authoring.retireOwner(expected);
    const intent=activeTabIntentRef;activeTabIntentRef=null;if(intent)void tabIntents.retire(intent);
    retireMediaOwner(expected,expected,true,!closeTransport&&nextNetwork===undefined&&nextEndpoint===undefined);retireRecoveryIssuanceForOwner(expected);credentials.retire(expected);identity.retire(expected);saslContexts.clear();
    workerTargets.clear();workerActivations.clear();pushConsentRefs.clear();pendingWebhookCreates.clear();
    for(const [ref,fact] of freshGenesisProofs)if(fact.owner.ownerRef===expected.ownerRef)freshGenesisProofs.delete(ref);
    for(const [ref,fact] of freshGenesisReservations)if(fact.owner.ownerRef===expected.ownerRef)freshGenesisReservations.delete(ref);
    if(expected.physicalRef!==null)joinedTargetsByPhysical.delete(String(expected.physicalRef));
    accountId=null;physicalRef=null;
    accountGeneration=makeAccountGeneration(Number(accountGeneration)+1)!;
    connectionGeneration=makeConnectionGeneration(Number(connectionGeneration)+1)!;
    if(nextNetwork)networkId=nextNetwork;
    if(nextEndpoint)endpointId=nextEndpoint;
    ownerRef=makeOwnerRef(randomRef())!;
    clientSafetyState=null;
    learnedPrefix=null;tentativeServerPrefix=null;pendingAccountProof=null;currentNick=null;caseMapping=null;statusMessagePrefixes.clear();advertisedVapidKey=null;
    advertisedCapabilities.clear();negotiatedCapabilities.clear();capabilityValues.clear();clearCapabilityStage();capabilityInventoryPoisoned=false;
    mappingGeneration+=1;featureRounds.clear();activeFeatureRoundRef=null;
    pendingFeatureReadiness=null;pendingNewCapabilities.clear();featureReady={e2ee:false,media:false};
    if(closeTransport)transport.close();
    if(pendingIntegrationFallback){
      const pending=pendingIntegrationFallback;pendingIntegrationFallback=null;
      if(pending.networkId===networkId&&pending.endpointId===endpointId&&pending.url===currentUrl)
        integrationFallbackTicket={ref:pending.ref,owner:snapshot(),endpointId:pending.endpointId,url:pending.url};
    }
    publishFeatureReadiness();
  };

  const publishDomain = (domain: string, view: DomainView): void => {
    const owner = snapshot();
    publishDomainForOwner(owner, domain, view);
  };
  const publishDomainForOwner = (owner:OwnerSnapshot, domain:string, view:DomainView):void => {
    if(!isCurrent(owner))return;
    const sequenceKey = `${owner.ownerRef}:${domain}`;
    const sequence = (domainSequence.get(sequenceKey) ?? 0) + 1;
    domainSequence.set(sequenceKey, sequence);
    const observation: RuntimeDomainObservation = { schemaVersion: 1, ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration),
      connectionGeneration: Number(owner.connectionGeneration), domain, sequence, view };
    for (const listener of [...domainListeners]) { try { listener(observation); } catch { /* observer failures do not affect authority */ } }
  };
  const acquireWebAuthnOperation=(context:RequestContext,kind:'register'|'authenticate'|'list'|'rename'|'remove'):WebAuthnOperationLease|null=>{
    if(webAuthnOperation||!isCurrent(context.owner)||(kind!=='authenticate'&&context.owner.accountId===null)||!learnedPrefix||!transport.isOpen())return null;
    const leaseId=randomRef();webAuthnOperation={context,leaseId};let released=false;
    return {isCurrent:()=>!released&&webAuthnOperation?.leaseId===leaseId&&isCurrent(context.owner)&&transport.isOpen()&&learnedPrefix!==null,
      release:()=>{if(released)return;released=true;if(webAuthnOperation?.leaseId===leaseId)webAuthnOperation=null;}};
  };
  const publishRecoveryEvent=(event:RecoveryEvent):void=>{
    let outerOwner=event.owner;
    let transferFrom:Extract<DomainView,{kind:'session-recovery'}>['transferFrom']=null;
    const transfer=recoveryTransfer;
    if(!isCurrent(event.owner)){
      if(!transfer||transfer.requestId!==event.requestId||transfer.credentialRef!==event.credentialRef||!transfer.destinationOwner
        ||!isCurrent(transfer.destinationOwner)||transfer.targetNetwork!==networkId||transfer.targetEndpoint!==endpointId
        ||transfer.targetUrl!==currentUrl||transfer.destinationOwner.networkId!==transfer.targetNetwork||event.owner.networkId!==transfer.fromOwner.networkId
        ||event.owner.accountId!==transfer.fromOwner.accountId||event.owner.accountGeneration!==transfer.fromOwner.accountGeneration
        ||event.owner.connectionGeneration!==transfer.fromOwner.connectionGeneration||event.owner.physicalRef!==transfer.fromOwner.physicalRef
        ||event.owner.ownerRef!==transfer.fromOwner.ownerRef
        ||(event.status!=='awaiting-authentication'&&event.status!=='blocked'&&event.status!=='rejected'))return;
      outerOwner=transfer.destinationOwner;
      transferFrom={ownerRef:transfer.fromOwner.ownerRef,accountGeneration:transfer.fromOwner.accountGeneration,connectionGeneration:transfer.fromOwner.connectionGeneration};
    }else if(transfer&&transfer.requestId===event.requestId&&transfer.credentialRef===event.credentialRef
      &&transfer.observationTransferFrom!==null&&transfer.destinationOwner!==null
      &&sameOwnerSnapshot(event.owner,transfer.destinationOwner)&&isCurrent(transfer.destinationOwner)
      &&transfer.targetNetwork===networkId&&transfer.targetEndpoint===endpointId&&transfer.targetUrl===currentUrl
      &&event.status==='pending'&&event.outcome==='redirect'){
      const source=transfer.observationTransferFrom;
      if(source.networkId!==event.owner.networkId||source.physicalRef!==event.owner.physicalRef
        ||source.connectionGeneration!==event.owner.connectionGeneration||source.accountId!==null
        ||transfer.fromOwner.accountId!==event.owner.accountId||transfer.targetNetwork!==event.owner.networkId
        ||transfer.targetEndpoint!==endpointId)return;
      transferFrom={ownerRef:source.ownerRef,accountGeneration:source.accountGeneration,connectionGeneration:source.connectionGeneration};
      recoveryTransfer={...transfer,observationTransferFrom:null};
    }
    const view:Extract<DomainView,{kind:'session-recovery'}>={kind:'session-recovery',requestId:event.requestId,credentialRef:event.credentialRef,
      status:event.status,outcome:event.outcome,reason:event.reason,redirectNode:event.redirectNode,hopCount:event.hopCount,transferFrom};
    recoveryViews.set(event.requestId,view);while(recoveryViews.size>64)recoveryViews.delete(recoveryViews.keys().next().value as string);
    publishDomainForOwner(outerOwner,'session',view);
    const intentKey=recoveryIntentKey(event.requestId,event.credentialRef);
    const explicitlyAllowsLegacy=recoveryLegacyIntentKeys.has(intentKey)||transfer?.requestId===event.requestId&&transfer.credentialRef===event.credentialRef&&transfer.acceptLegacyNewAttachment;
    const acceptedOutcome=event.outcome==='exact-restored'||event.outcome==='logical-attached'
      ||event.outcome==='legacy-new-attachment'&&explicitlyAllowsLegacy;
    if(event.status==='accepted'&&acceptedOutcome&&isCurrent(event.owner)&&event.owner.accountId!==null
      &&event.owner.physicalRef!==null&&learnedPrefix!==null&&transport.isOpen()&&event.owner.networkId===networkId
      &&(!transfer||(transfer.targetNetwork===networkId&&transfer.targetEndpoint===endpointId))&&!disposed){
      const issuanceKey=JSON.stringify([event.requestId,event.credentialRef,event.owner.networkId,event.owner.accountId,
        event.owner.accountGeneration,event.owner.connectionGeneration,event.owner.physicalRef,event.owner.ownerRef,endpointId]);
      if(!recoveryIssuanceKeys.has(issuanceKey)){
        recoveryIssuanceKeys.set(issuanceKey,event.owner);
        while(recoveryIssuanceKeys.size>64)recoveryIssuanceKeys.delete(recoveryIssuanceKeys.keys().next().value as string);
        // Reserve before queueing behind RESUME's lease release. The callback
        // is owner/request-bound; an unknown issuance is never replayed.
        const queued=sessionOperations?.afterRelease(event.owner,event.requestId,()=>{
          if(!isCurrent(event.owner))return;
          const admission=startCredentialIssuance(event.owner);
          if(admission.kind==='blocked')recoveryIssuanceKeys.delete(issuanceKey);
        })??false;
        if(!queued)recoveryIssuanceKeys.delete(issuanceKey);
      }
    }
    if(event.status==='accepted'||event.status==='rejected'||event.status==='unknown'||event.status==='blocked'){
      if(recoveryTransfer?.requestId===event.requestId)recoveryTransfer=null;
      recoveryLegacyIntentKeys.delete(intentKey);
    }
  };
  recoveryController=createSessionRecoveryController({
    currentOwner:snapshot,isCurrent,currentEndpointId:()=>endpointId,currentServerPrefix:()=>learnedPrefix,currentNick:()=>currentNick,
    pinCredential:(context,ref)=>{
      let operation=sessionOperations?.acquire(context,'resume')??null;
      let operationOwner=context.owner;
      if(!operation)return null;
      const credential=credentials.pinForRecovery(context.owner,ref,credentialTransport);
      if(!credential){operation.release();return null;}
      let released=false;
      return {credentialKind:credential.credentialKind,issuerEndpointId:credential.issuerEndpointId,expiresAtMs:credential.expiresAtMs,
        resume:async(nextOwner,requestId)=>{
          if(released||!isCurrent(nextOwner)||requestId!==context.requestId)return {kind:'blocked' as const,reason:'owner-changed' as const};
          let attempt=operation;
          if(!attempt?.isCurrent()){
            const sameAttemptOwner=sameOwnerSnapshot(operationOwner,nextOwner)&&isCurrent(operationOwner);
            if(!sameAttemptOwner){
              const transfer=recoveryTransfer;
              const validDestination=transfer!==null&&transfer.requestId===requestId
                &&transfer.credentialRef===ref&&transfer.destinationOwner!==null
                &&sameOwnerSnapshot(transfer.destinationOwner,nextOwner)
                &&transfer.fromOwner.accountId!==null&&nextOwner.accountId===transfer.fromOwner.accountId
                &&transfer.fromOwner.networkId===nextOwner.networkId&&transfer.targetNetwork===nextOwner.networkId
                &&transfer.targetEndpoint===endpointId&&transfer.targetUrl===currentUrl
                &&isCurrent(transfer.destinationOwner);
              if(!validDestination)return {kind:'blocked' as const,reason:'owner-changed' as const};
            }
            const destinationContext:RequestContext={schemaVersion:1,requestId,owner:nextOwner};
            attempt=sessionOperations?.acquire(destinationContext,'resume')??null;
            if(!attempt)return {kind:'blocked' as const,reason:'backpressure' as const};
            operation=attempt;
            operationOwner=nextOwner;
          }
          if(!sameOwnerSnapshot(operationOwner,nextOwner)||!attempt.isCurrent())return {kind:'blocked' as const,reason:'owner-changed' as const};
          const admission=await credential.resume(nextOwner,requestId);
          if(admission.kind==='unknown')attempt.markUnknown();
          else if(admission.kind==='blocked'){
            attempt.release();
            if(operation===attempt)operation=null;
          }
          return admission;
        },forget:()=>credential.forget(),release:()=>{if(released)return;released=true;credential.release();operation?.release();operation=null;}};
    },
    resolveRedirectNode:(network,nodeName)=>{
      const match=config.endpointRegistry?.find(entry=>entry.nodeName===nodeName&&makeNetworkId(entry.networkId)===network);
      if(!match)return null;
      const targetNetwork=makeNetworkId(match.networkId),targetEndpoint=makeEndpointId(match.endpointId);
      let url:string;try{const parsed=new URL(match.url);if(parsed.protocol!=='wss:'||parsed.username||parsed.password||parsed.hash||parsed.search||/[\u0000-\u0020\u007f]/u.test(match.url))return null;url=parsed.href;}catch{return null;}
      return targetNetwork&&targetEndpoint?{networkId:targetNetwork,endpointId:targetEndpoint,url,nodeName}:null;
    },
    isTrustedEndpoint:value=>trustedEndpoints.has(value),
    requestRedirect:async({requestId,fromOwner,target})=>{
      if(!isCurrent(fromOwner)||target.networkId!==networkId||!trustedEndpoints.has(target.endpointId))return 'blocked';
      const ref=recoveryViews.get(requestId)?.credentialRef;
      if(!ref)return 'blocked';
      const intentKey=recoveryIntentKey(requestId,ref);
      recoveryTransfer={requestId,credentialRef:ref,fromOwner,destinationOwner:null,targetNetwork:target.networkId,targetEndpoint:target.endpointId,
        targetUrl:target.url,acceptLegacyNewAttachment:recoveryLegacyIntentKeys.has(intentKey),observationTransferFrom:null};
      const admission=runtimeConnect(target.url);
      if(admission.kind==='blocked')return 'blocked';
      if(recoveryTransfer?.requestId===requestId)recoveryTransfer={...recoveryTransfer,destinationOwner:snapshot()};
      return 'started';
    },
    emit:publishRecoveryEvent,now:Date.now,
  });
  webAuthn=createPrivateWebAuthnCeremonies({
    isCurrent:(input:PrivateWebAuthnInput)=>{
      const pending=pendingWebAuthn.get(input.context.requestId);
      return !!pending&&pending.ceremonyRef===input.ceremonyRef&&pending.owner.ownerRef===input.context.owner.ownerRef
        &&pending.action===input.action&&pending.challenge!==null&&pending.rpId===input.rpId&&pending.account===input.account
        &&pending.lease.isCurrent()&&isCurrent(pending.owner)&&transport.isOpen()&&learnedPrefix!==null;
    },
    origin:()=>typeof location==='undefined'?'':location.origin,
    sendLine:(context,line)=>transport.sendLine({line,owner:context.owner,requestId:context.requestId}),
    emitSafeStatus:(status:PrivateWebAuthnStatus)=>{
      const pending=pendingWebAuthn.get(status.requestId);if(!pending||pending.ceremonyRef!==status.ceremonyRef||!isCurrent(pending.owner))return;
      if(status.phase==='pending'&&pending.challenge!==null&&pending.timer){clearTimeout(pending.timer);pending.timer=null;}
      if(status.phase==='transport-admitted'){
        pending.sent=true;if(pending.timer)clearTimeout(pending.timer);
        pending.timer=setTimeout(()=>{if(pendingWebAuthn.get(status.requestId)===pending){clearPendingWebAuthn(pending);pendingWebAuthn.delete(status.requestId);}},45_000);
      }else if(status.phase!=='pending'){
        clearPendingWebAuthn(pending);pendingWebAuthn.delete(status.requestId);
      }
      publishDomain('webauthn',{kind:'webauthn',requestId:status.requestId,ceremonyRef:status.ceremonyRef,ceremony:pending.action,phase:status.phase,reason:status.reason});
    },
  });
  passkeyManagement=createPrivatePasskeyManagement({
    currentOwner:snapshot,isCurrent,currentServerPrefix:()=>learnedPrefix,currentNick:()=>currentNick,
    sendLine:({line,owner,requestId})=>transport.sendLine({line,owner,requestId}),
    acquireWebAuthnOperation,
    now:Date.now,randomRef,
    emit:(result:PasskeyResult)=>{
      if(!isCurrent(result.owner))return;
      const view:DomainView={kind:'passkey-management',requestId:result.requestId,status:result.view.status,operation:result.view.operation,
        rows:result.view.rows,reason:result.view.reason};
      publishDomainForOwner(result.owner,'account-security',view);
    },
  });
  sessionMeshControl=createSessionMeshControl({
    currentOwner:snapshot,isCurrent,currentNick:()=>currentNick,currentServerPrefix:()=>learnedPrefix,currentEndpointId:()=>endpointId,
    acquireSessionOperation:(context,kind,operationRef)=>sessionOperations?.acquire(context,kind,operationRef)??null,
    sendLine:({context,line,lease})=>lease.isCurrent()&&isCurrent(context.owner)&&transport.isOpen()
      ?transport.sendLine({line,owner:context.owner,requestId:context.requestId}):{kind:'blocked',reason:'owner-changed'},
    deploymentAllowed:()=>config.sessionMeshControlEnabled===true,now:Date.now,randomRef,
    emit:result=>{if(isCurrent(result.context.owner))publishDomainForOwner(result.context.owner,'session',result.view);},
  });
  accountCommunity=createAccountCommunityService({
    currentOwner:snapshot,isCurrent,currentNick:()=>currentNick,currentServerPrefix:()=>learnedPrefix,
    sendLine:({context,line})=>isCurrent(context.owner)&&transport.isOpen()
      ?transport.sendLine({line,owner:context.owner,requestId:context.requestId}):{kind:'blocked',reason:'owner-changed'},
    now:Date.now,randomRef,
    emit:result=>{if(isCurrent(result.context.owner))publishDomainForOwner(result.context.owner,'account-community',result.view);},
  });
  integrationOperations=createIntegrationOperations({
    currentOwner:snapshot,isCurrent,currentNick:()=>currentNick,currentServerPrefix:()=>learnedPrefix,
    hasNegotiatedLabels:()=>negotiatedCapabilities.has('labeled-response'),
    sendLine:({line,owner,requestId})=>transport.sendLine({line,owner,requestId}),
    now:Date.now,randomRef,
    openPrivateOutHookInput,
    presentPrivateOutHook,
    emit:(result:IntegrationResult)=>{
      if(isCurrent(result.owner))publishDomainForOwner(result.owner,'service-integration',result.view);
    },
  });
  const sessionControlIngress=transport.onPrivateIngress(envelope=>sessionMeshControl?.consumePrivateIngress(envelope.payload)??false);
  const accountCommunityIngress=transport.onPrivateIngress(envelope=>accountCommunity?.consumePrivateIngress(envelope.payload)??false);
  integrationIngress=transport.onPrivateIngress(envelope=>integrationOperations?.consumePrivateIngress(envelope.payload)??false);
  privateAccountSecurity=createPrivateAccountSecurity({ownerSnapshot:snapshot,isCurrent,currentServerPrefix:()=>learnedPrefix,currentNick:()=>currentNick,endpointId:()=>endpointId,
    isAccountProven:owner=>isCurrent(owner)&&owner.accountId!==null&&learnedPrefix!==null,
    // The runtime does not yet have an authenticated certificate-factor
    // projection. Certificate-only reset therefore remains explicitly refused.
    isCertificateVerifiedAccount:()=>false,
    onRecoveryLoginSourceSuccess:input=>applyPrivateAccountSourceProof(input.owner,input.account,input.endpointId),
    onRegistrationSourceSuccess:input=>applyPrivateAccountSourceProof(input.owner,input.account,input.endpointId),
    sendLine:({line,owner,requestId})=>transport.sendLine({line,owner,requestId}),
    readAndClearPrivateForm,
    resolvePresentationHost:hostRef=>hostRef==='account-security'?ensurePrivatePresentationHost('onyx-private-account-security'):null,
    clipboardWrite:async text=>{try{return typeof navigator!=='undefined'&&!!navigator.clipboard&&await navigator.clipboard.writeText(text)===undefined;}catch{return false;}},
    emitSafeStatus:(status:PrivateAccountSecurityStatus)=>{
      const currentOwner=snapshot();
      if(currentOwner.ownerRef!==status.ownerRef||Number(currentOwner.accountGeneration)!==Number(status.accountGeneration)
        ||Number(currentOwner.connectionGeneration)!==Number(status.connectionGeneration))return;
      publishDomain('account-security',{kind:'account-security',schemaVersion:1,requestId:status.requestId,operationRef:status.operationRef,
        ownerRef:status.ownerRef,accountGeneration:makeAccountGeneration(Number(status.accountGeneration))!,connectionGeneration:makeConnectionGeneration(Number(status.connectionGeneration))!,action:status.action,phase:status.phase,reason:status.reason,
        totpState:status.totpState,remainingCodes:status.remainingCodes,presentationRef:status.presentationRef,
        accountOutcome:status.accountOutcome,targetAccount:status.targetAccount,requiresLogin:status.requiresLogin});
    },now:Date.now,randomRef});
  mediaDomainUnsub=mediaEngine.subscribe(status=>{if(status.reason==='owner-changed')return;publishMediaDomain();});
  mediaControlUnsub=mediaEngine.subscribeControl(()=>publishMediaDomain());
  const decodeDomainCommand = (raw: unknown): RuntimeDomainCommand | null => {
    if (!isRecord(raw) || Object.keys(raw).length !== DOMAIN_COMMAND_ENVELOPE_KEYS.length
      || DOMAIN_COMMAND_ENVELOPE_KEYS.some(key => !Object.hasOwn(raw, key))
      || Object.keys(raw).some(key => !(DOMAIN_COMMAND_ENVELOPE_KEYS as readonly string[]).includes(key))
      || raw.schemaVersion !== 1 || typeof raw.requestId !== 'string'
      || typeof raw.ownerRef !== 'string' || !Number.isSafeInteger(raw.accountGeneration) || !Number.isSafeInteger(raw.connectionGeneration)
      || typeof raw.domain !== 'string' || typeof raw.action !== 'string' || !isRecord(raw.payload)) return null;
    const payload=raw.payload;
    const keys = DOMAIN_PAYLOAD_KEYS[raw.domain]?.[raw.action];
    const optionalKeys = OPTIONAL_DOMAIN_PAYLOAD_KEYS[`${raw.domain}.${raw.action}`] ?? [];
    const legacyAttachmentOptional = raw.domain === 'session' && (raw.action === 'resume' || raw.action === 'retry')
      && !Object.hasOwn(payload, 'acceptLegacyNewAttachment');
    if (!keys || Object.keys(raw.payload).some(key => !keys.includes(key))
      || !keys.filter(key => !(legacyAttachmentOptional && key === 'acceptLegacyNewAttachment') && !optionalKeys.includes(key)).every(key => Object.hasOwn(payload, key))
      || !commandPayloadBounded(raw.payload)) return null;
    const requestId = makeRequestId(raw.requestId);
    if (!requestId || !/^[A-Za-z0-9_-]{22,128}$/u.test(raw.requestId)) return null;
    const owner = snapshot();
    if (raw.ownerRef !== owner.ownerRef || raw.accountGeneration !== Number(owner.accountGeneration)
      || raw.connectionGeneration !== Number(owner.connectionGeneration)) return null;
    if (raw.domain === 'session') {
      if ((raw.action === 'remember' && typeof raw.payload.enabled !== 'boolean')
        || ((raw.action === 'resume' || raw.action === 'retry' || raw.action === 'forget') && (typeof raw.payload.credentialRef !== 'string' || raw.payload.credentialRef.length > 128))
        || ((raw.action === 'resume' || raw.action === 'retry') && Object.hasOwn(raw.payload,'acceptLegacyNewAttachment') && raw.payload.acceptLegacyNewAttachment !== true)) return null;
      const refPattern=/^[A-Za-z0-9_-]{22,128}$/u;
      if ((raw.action==='local-drop'&&(typeof raw.payload.rowRef!=='string'||!refPattern.test(raw.payload.rowRef)||raw.payload.confirm!==true))
        ||(raw.action==='mesh-next'&&(typeof raw.payload.scanRef!=='string'||!refPattern.test(raw.payload.scanRef)))
        ||(raw.action==='mesh-revoke'&&(typeof raw.payload.groupRef!=='string'||!refPattern.test(raw.payload.groupRef)||raw.payload.confirm!==true))
        ||(['mesh-reconcile','mesh-dismiss'].includes(raw.action)&&(typeof raw.payload.revokeRef!=='string'||!refPattern.test(raw.payload.revokeRef))))return null;
    }
    if(raw.domain==='account-community'){
      const p=raw.payload;
      if(['autojoin-add','autojoin-remove'].includes(raw.action)
        &&(typeof p.channel!=='string'||new TextEncoder().encode(p.channel).byteLength>128||!p.channel.startsWith('#')
          ||/[\s,\u0000-\u001f\u007f:]/u.test(p.channel)||raw.action==='autojoin-remove'&&p.confirm!==true))return null;
      if(['group-add','group-remove','group-primary'].includes(raw.action)
        &&(typeof p.nick!=='string'||new TextEncoder().encode(p.nick).byteLength>64||/[\s,\u0000-\u001f\u007f:]/u.test(p.nick)
          ||raw.action!=='group-add'&&p.confirm!==true))return null;
    }
    if(raw.domain==='service-integration'){
      const p=raw.payload;const action=raw.action;
      const account=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,64}$/u.test(value);
      const boundedText=(value:unknown,max:number):value is string=>typeof value==='string'
        &&new TextEncoder().encode(value).byteLength<=max
        &&!/[\u0000-\u001f\u007f]/u.test(value);
      const channel=(value:unknown):value is string=>typeof value==='string'&&new TextEncoder().encode(value).byteLength<=128
        &&value.startsWith('#')&&!/[\s,\u0000-\u001f\u007f:]/u.test(value);
      if(action==='refresh'&&!['webhook','outhook','botgrant','botcmd','defer','unfurl','memo'].includes(String(p.feature)))return null;
      if(action==='botgrant-list'&&p.account!==undefined&&!account(p.account))return null;
      if(['botgrant-add','botgrant-remove'].includes(action)
        &&(!account(p.account)||!['speak','webhook','history'].includes(String(p.grant))||!channel(p.channel)
          ||action==='botgrant-add'&&(!Number.isSafeInteger(p.ttlSeconds)||Number(p.ttlSeconds)<1||Number(p.ttlSeconds)>31_536_000)
          ||action==='botgrant-remove'&&p.confirm!==true))return null;
      if(action==='botcmd-add'&&(!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(String(p.name))
        ||!Number.isSafeInteger(p.argc)||Number(p.argc)<0||Number(p.argc)>16||!boundedText(p.help,512)))return null;
      if(action==='botcmd-run'&&(!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(String(p.name))||!Array.isArray(p.args)
        ||p.args.length>16||p.args.some(value=>!boundedText(value,512))))return null;
      if(action==='defer-at'||action==='defer-oper-at'){
        if(!Number.isSafeInteger(p.unixMs)||Number(p.unixMs)<0||!channel(p.channel)
          ||action==='defer-at'&&!boundedText(p.text,65_536)||action==='defer-oper-at'&&!boundedText(p.mode,64))return null;
      }
      if(action==='defer-cron'||action==='defer-oper-cron'){
        const cron=['minute','hour','dayOfMonth','month','dayOfWeek'].every(key=>boundedText(p[key],64)&&/^[0-9*/?,L#-]+$/u.test(String(p[key])));
        if(!cron||!channel(p.channel)||action==='defer-cron'&&!boundedText(p.text,65_536)
          ||action==='defer-oper-cron'&&!boundedText(p.mode,64))return null;
      }
      if(action==='outhook-add'&&!(typeof p.inputRef==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(p.inputRef)))return null;
      if(action==='outhook-inspect'&&(typeof p.urlRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.urlRef)))return null;
      if(action==='outhook-remove'&&(typeof p.urlRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.urlRef)||p.confirm!==true))return null;
      if(action==='unfurl-preview'&&(!boundedText(p.url,2048)||!/^https:\/\//u.test(String(p.url))))return null;
      if(action==='memo-send'&&(!account(p.account)||!boundedText(p.text,65_536)))return null;
      if(action==='memo-clear'&&p.confirm!==true)return null;
      if(action==='memo-forward'&&p.account!==null&&!account(p.account))return null;
      if((action==='memo-ignore-add'||action==='memo-ignore-remove')&&(!account(p.account)||action==='memo-ignore-remove'&&p.confirm!==true))return null;
    }
    if(raw.domain==='account-security'&&raw.action==='passkey-rename'
      &&(typeof raw.payload.credentialRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.credentialRef)
        ||typeof raw.payload.label!=='string'||new TextEncoder().encode(raw.payload.label).byteLength>64||/[\u0000-\u001f\u007f]/u.test(raw.payload.label)))return null;
    if(raw.domain==='account-security'&&raw.action==='passkey-remove'
      &&(typeof raw.payload.credentialRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.credentialRef)||raw.payload.confirm!==true))return null;
    if(raw.domain==='account-security'){
      const p=raw.payload;
      if(raw.action==='begin'){
        const action=p.action;const valid=['totp-status','totp-enroll','totp-disable','totp-confirm','recovery-status','recovery-generate','recovery-clear','recovery-login','account-email','account-password','account-certificate-reset','account-drop','password-reset-request','password-reset-confirm','account-register','account-verify'].includes(String(action));
        if(!valid||!(p.formRef===null||typeof p.formRef==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(p.formRef))
          ||!(p.account===null||typeof p.account==='string'&&/^[A-Za-z0-9_.-]{1,64}$/u.test(p.account))
          ||typeof p.confirm!=='boolean')return null;
        const requiresForm=['totp-confirm','recovery-generate','recovery-clear','recovery-login','account-email','account-password','account-certificate-reset','account-drop','password-reset-confirm','account-register','account-verify'].includes(String(action));
        const requiresAccount=['recovery-login','password-reset-request','password-reset-confirm','account-register','account-verify'].includes(String(action));
        if(requiresForm!==(p.formRef!==null)||requiresAccount!==(p.account!==null)||(action==='account-drop'&&p.confirm!==true))return null;
      }else if(raw.action==='present'&&(typeof p.presentationRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.presentationRef)
        ||!['present','copy','dismiss'].includes(String(p.action))
        ||!(p.selection===null||p.selection==='secret'||p.selection==='uri'||p.selection==='codes')))return null;
    }
    if(raw.domain==='continuation'){
      const p=raw.payload;
      if(raw.action==='remember'&&typeof p.enabled!=='boolean')return null;
      if((raw.action==='remember'||raw.action==='forget'||raw.action==='select')
        &&(typeof p.continuationRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.continuationRef)))return null;
      if(raw.action==='select'&&p.confirm!==true)return null;
    }
    if (raw.domain === 'draft') {
      const p=raw.payload;
      if(raw.action!=='recovery-list'&&(typeof p.conversationId!=='string'||!makeConversationId(p.conversationId)))return null;
      if(raw.action==='save'&&(typeof p.text!=='string'||new TextEncoder().encode(p.text).byteLength>64*1024||!Number.isSafeInteger(p.revision)||Number(p.revision)<0))return null;
      if((raw.action==='save'||raw.action==='discard')&&(!Number.isSafeInteger(p.revision)||Number(p.revision)<0))return null;
      if(raw.action==='recover'&&(typeof p.draftRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.draftRef)))return null;
    }
    if(raw.domain==='journal'){
      const p=raw.payload;
      if(raw.action==='queue'&&(typeof p.clientIntentId!=='string'||!makeRequestId(p.clientIntentId)||typeof p.conversationId!=='string'||!makeConversationId(p.conversationId)
        ||(p.intent!=='chat'&&p.intent!=='memo')||typeof p.text!=='string'||new TextEncoder().encode(p.text).byteLength>65_536
        ||/[\u0000-\u0008\u000b-\u001f\u007f\r]/u.test(p.text)||(p.messageKind!=='message'&&p.messageKind!=='action')
        ||!(p.replyTo===null||typeof p.replyTo==='string'&&!!makeMessageId(p.replyTo)&&p.replyTo.length<=512)
        ||!(p.audiencePrefix===null||typeof p.audiencePrefix==='string'&&/^[!.@+]$/u.test(p.audiencePrefix))))return null;
      if(raw.action==='queue'&&p.intent==='memo'&&(p.messageKind!=='message'||p.replyTo!==null||p.audiencePrefix!==null))return null;
      for(const key of ['entryRef'] as const)if(['retry','cancel','reconcile'].includes(raw.action)&&(typeof p[key]!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p[key] as string)))return null;
      if(raw.action==='retry'&&p.confirmDuplicateRisk!==true)return null;
    }
    if(raw.domain==='scheduled'){
      const p=raw.payload;
      if(raw.action==='create'&&(typeof p.inputRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.inputRef)
        ||typeof p.operationId!=='string'||!/^[A-Za-z0-9_-]{1,96}$/u.test(p.operationId)
        ||typeof p.clientIntentId!=='string'||!makeRequestId(p.clientIntentId)
        ||typeof p.conversationId!=='string'||!makeConversationId(p.conversationId)
        ||!Number.isSafeInteger(p.dueAtMs)||Number(p.dueAtMs)<0||(p.messageKind!=='message'&&p.messageKind!=='action')
        ||!(p.replyTo===null||typeof p.replyTo==='string'&&!!makeMessageId(p.replyTo)&&p.replyTo.length<=512)
        ||!(p.audiencePrefix===null||typeof p.audiencePrefix==='string'&&/^[!.@+]$/u.test(p.audiencePrefix))))return null;
      if(raw.action==='edit'&&(typeof p.inputRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.inputRef)
        ||typeof p.scheduleRef!=='string'||!/^[A-Za-z0-9_-]{1,96}$/u.test(p.scheduleRef)
        ||!Number.isSafeInteger(p.expectedRevision)||Number(p.expectedRevision)<0||!Number.isSafeInteger(p.dueAtMs)||Number(p.dueAtMs)<0
        ||(p.messageKind!=='message'&&p.messageKind!=='action')
        ||!(p.replyTo===null||typeof p.replyTo==='string'&&!!makeMessageId(p.replyTo)&&p.replyTo.length<=512)
        ||!(p.audiencePrefix===null||typeof p.audiencePrefix==='string'&&/^[!.@+]$/u.test(p.audiencePrefix))))return null;
      if(['cancel','dispatch','reconcile'].includes(raw.action)&&(typeof p.scheduleRef!=='string'||!/^[A-Za-z0-9_-]{1,96}$/u.test(p.scheduleRef)
        ||!Number.isSafeInteger(p.expectedRevision)||Number(p.expectedRevision)<0))return null;
    }
    if(raw.domain==='anchor'){
      const p=raw.payload;
      if(typeof p.conversationId!=='string'||!makeConversationId(p.conversationId))return null;
      if(raw.action==='viewed'&&(!(p.messageId===null||typeof p.messageId==='string'&&p.messageId.length<=512)
        ||!(p.timestamp===null||typeof p.timestamp==='string'&&p.timestamp.length<=64)))return null;
    }
    if(raw.domain==='settings'&&raw.action==='apply'){
      const p=raw.payload;
      if(typeof p.previewRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(p.previewRef)||!Array.isArray(p.enabledOptIns)
        ||p.enabledOptIns.some(value=>value!=='linkPreviews'&&value!=='notificationPreviews'))return null;
    }
    if(raw.domain==='storage'&&((raw.action==='export'&&(typeof raw.payload.selectionRef!=='string'||typeof raw.payload.outputRef!=='string'))
      ||(raw.action==='clear'&&(typeof raw.payload.selectionRef!=='string'||raw.payload.confirm!==true))))return null;
    if(raw.domain==='eviction'){
      if(raw.action==='preview'&&(!Array.isArray(raw.payload.conversationIds)||raw.payload.conversationIds.length<1||raw.payload.conversationIds.length>100
        ||raw.payload.conversationIds.some(value=>typeof value!=='string'||!makeConversationId(value))))return null;
      if(raw.action==='apply'&&(raw.payload.confirm!==true||typeof raw.payload.planRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.planRef)))return null;
    }
    if (raw.domain === 'tab-intent') {
      if ((raw.action === 'fresh' || raw.action === 'restore' || raw.action === 'retire') && raw.payload.confirm !== true) return null;
      if ((raw.action === 'restore' || raw.action === 'retire') && (typeof raw.payload.intentRef !== 'string' || !/^[a-f0-9]{48}$/u.test(raw.payload.intentRef))) return null;
    }
    if (raw.domain === 'workspace' && raw.action === 'remember' && (raw.payload.confirm !== true || typeof raw.payload.enabled !== 'boolean')) return null;
    if (raw.domain === 'group') {
      if (raw.action === 'bootstrap-preview' && (typeof raw.payload.conversationId !== 'string' || raw.payload.conversationId.length < 1 || raw.payload.conversationId.length > 512)) return null;
      if (raw.action === 'bootstrap-approve' && (raw.payload.confirm !== true || typeof raw.payload.previewRef !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.previewRef))) return null;
      if (raw.action === 'bootstrap-cancel' && (typeof raw.payload.previewRef !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.previewRef))) return null;
      if (['directory-refresh','author-plan','welcome-request','enroll','remove-device','backup-export','backup-import','trust-preview'].includes(raw.action)
        && (typeof raw.payload.conversationId !== 'string' || raw.payload.conversationId.length < 1 || raw.payload.conversationId.length > 512)) return null;
      if (raw.action === 'trust-confirm' && (raw.payload.confirm !== true || typeof raw.payload.previewRef !== 'string' || !/^[0-9a-f]{48}$/u.test(raw.payload.previewRef))) return null;
      if (raw.action === 'trust-preview' && (typeof raw.payload.accountId !== 'string' || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(raw.payload.accountId)
        || typeof raw.payload.deviceId !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/u.test(raw.payload.deviceId))) return null;
    }
    if (raw.domain === 'platform') {
      if (raw.action === 'worker-activate' && (raw.payload.confirm !== true || typeof raw.payload.targetRef !== 'string' || raw.payload.targetRef.length > 128)) return null;
      if (raw.action === 'worker-cancel' && (typeof raw.payload.activationRef !== 'string' || raw.payload.activationRef.length > 128)) return null;
      if (raw.action === 'push-enable' && (typeof raw.payload.consentRef !== 'string' || raw.payload.consentRef.length > 128)) return null;
      if (raw.action === 'push-disable' && raw.payload.confirm !== true) return null;
      if (raw.action === 'notification-route' && (typeof raw.payload.routeRef !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.routeRef))) return null;
    }
    if(raw.domain==='media'){
      if(raw.action==='roster-refresh'&&(typeof raw.payload.conversationId!=='string'||!makeConversationId(raw.payload.conversationId)
        ||typeof raw.payload.callRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.callRef)))return null;
      if(['join','leave','camera-preview','camera-publish','screen-start','screen-stop','consent','record','caption-prepare','caption-start','caption-stop','quality','audio-recover'].includes(raw.action)
        && (typeof raw.payload.conversationId!=='string'||raw.payload.conversationId.length<1||raw.payload.conversationId.length>512))return null;
      if(['soundcheck','join','camera-preview','screen-start','webrtc-run'].includes(raw.action)
        && (typeof raw.payload.captureRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.captureRef)))return null;
      if(raw.action==='join'&&(raw.payload.kind!=='voice'&&raw.payload.kind!=='video'))return null;
      if(raw.action==='webrtc-run'&&raw.payload.kind!=='voice'&&raw.payload.kind!=='video')return null;
      if(raw.action==='soundcheck'&&(!Number.isSafeInteger(raw.payload.durationMs)||Number(raw.payload.durationMs)<250||Number(raw.payload.durationMs)>3000))return null;
      if(raw.action==='consent'&&(raw.payload.consent!=='granted'&&raw.payload.consent!=='denied'||typeof raw.payload.callRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.callRef)
        ||!(raw.payload.policyRevision===null||typeof raw.payload.policyRevision==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.policyRevision))))return null;
      if(raw.action==='record'&&(raw.payload.action!=='start'&&raw.payload.action!=='stop'||typeof raw.payload.callRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.callRef)
        ||!(raw.payload.consentRevision===null||typeof raw.payload.consentRevision==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.consentRevision))))return null;
      if(['mute','deafen'].includes(raw.action)&&typeof raw.payload[raw.action==='mute'?'muted':'deafened']!=='boolean')return null;
      if(raw.action==='output'&&(!Number.isSafeInteger(raw.payload.volumePercent)||Number(raw.payload.volumePercent)<0||Number(raw.payload.volumePercent)>100
        ||!(raw.payload.deviceRef===null||typeof raw.payload.deviceRef==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.deviceRef))))return null;
      if(raw.action==='input'&&(!(raw.payload.deviceRef===null||typeof raw.payload.deviceRef==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.deviceRef))
        ||!(raw.payload.conversationId===null||typeof raw.payload.conversationId==='string'&&makeConversationId(raw.payload.conversationId))
        ||!(raw.payload.callRef===null||typeof raw.payload.callRef==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.callRef))
        ||!(raw.payload.captureRef===null||typeof raw.payload.captureRef==='string'&&/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.captureRef))))return null;
      if(['preview-attach','preview-retire','camera-publish','webrtc-stop','fingerprint-compare'].includes(raw.action)){
        for(const key of Object.keys(raw.payload))if(!/^[A-Za-z0-9_-]{22,128}$/u.test(String(raw.payload[key])))return null;
      }
      if(raw.action==='screen-stop'&&typeof raw.payload.conversationId!=='string')return null;
      if(raw.action==='caption-start'&&(typeof raw.payload.callRef!=='string'||raw.payload.callRef.length>128||typeof raw.payload.language!=='string'
        ||!/^[A-Za-z0-9-]{2,64}$/u.test(raw.payload.language)||(raw.payload.mode!=='local'&&raw.payload.mode!=='browser-service')
        ||typeof raw.payload.browserServiceConsent!=='boolean'))return null;
      if(raw.action==='caption-prepare'&&(typeof raw.payload.callRef!=='string'||raw.payload.callRef.length>128||typeof raw.payload.language!=='string'||!/^[A-Za-z0-9-]{2,64}$/u.test(raw.payload.language)))return null;
      if(raw.action==='caption-stop'&&(typeof raw.payload.callRef!=='string'||raw.payload.callRef.length>128))return null;
      if(raw.action==='quality'&&(typeof raw.payload.callRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.callRef)
        ||!['auto','balanced','audio-priority'].includes(String(raw.payload.policy))))return null;
      if(raw.action==='audio-recover'&&(typeof raw.payload.callRef!=='string'||!/^[A-Za-z0-9_-]{22,128}$/u.test(raw.payload.callRef)))return null;
    }
    return raw as unknown as RuntimeDomainCommand;
  };
  const domainResult = (command: RuntimeDomainCommand, input: { status: RuntimeDomainResult['status']; scope?: RuntimeDomainResult['completionScope']; reason?: string|null; view?: DomainView|null }): RuntimeDomainResult => ({
    schemaVersion: 1, requestId: command.requestId, ownerRef: command.ownerRef, accountGeneration: Number(command.accountGeneration),
    connectionGeneration: Number(command.connectionGeneration), domain: command.domain, action: command.action,
    status: input.status, completionScope: input.scope ?? 'local', reason: input.reason ?? null, view: input.view ?? null,
  });
  const legacyScheduledProjectionUnclear=():boolean=>{
    try {
      const raw=storage?.getItem('onyx:scheduled');
      return raw!==null&&raw!==undefined&&!/^\[\s*\]$/u.test(raw.trim());
    } catch { return true; }
  };
  const scheduledDomainView=(context:RequestContext,listed:ScheduledListResult):DomainView=>({
    kind:'scheduled',items:listed.status==='ready'?listed.rows:[],
    mode:listed.mode??(namespaceForRequest(context)?.scope.kind==='guest'?'volatile':'durable'),
    legacyHeldCount:listed.status==='ready'?listed.legacyHeldCount:0,
    legacyReviewUnavailable:listed.status!=='ready'||listed.legacyReviewUnavailable||legacyScheduledProjectionUnclear(),
  });
  const dispatchDomain = async (raw: unknown): Promise<RuntimeDomainResult> => {
    const command = decodeDomainCommand(raw);
    if (!command) {
      const owner = snapshot();
      return { schemaVersion:1,requestId:makeRequestId(isRecord(raw)&&typeof raw.requestId==='string'?raw.requestId:'') ?? makeRequestId(randomRef())!,ownerRef:owner.ownerRef,
        accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),domain:'unknown',action:'unknown',status:'blocked',completionScope:'local',reason:'invalid-command',view:null };
    }
    if (disposed || disposingRuntime) return domainResult(command,{status:'blocked',scope:'local',reason:'runtime-disposed'});
    const commandOwner = snapshot();
    const commandMatchesOwner = command.ownerRef === commandOwner.ownerRef
      && Number(command.accountGeneration) === Number(commandOwner.accountGeneration)
      && Number(command.connectionGeneration) === Number(commandOwner.connectionGeneration)
      && isCurrent(commandOwner);
    if (commandMatchesOwner) {
      flushPublicIngress(commandOwner);
      if (!isCurrent(commandOwner)) return domainResult(command,{status:'cancelled',scope:'local',reason:'owner-changed'});
    }
    const key = `${command.ownerRef}:${command.requestId}`;
    if(activationBarrier&&!(command.domain==='platform'&&command.action==='worker-cancel'))
      return domainResult(command,{status:'blocked',reason:'activation-in-progress'});
    const payloadKey = JSON.stringify([command.domain,command.action,command.payload]);
    const prior = requestCache.get(key);
    if (prior) {
      if (prior.payloadKey !== payloadKey) return domainResult(command,{status:'blocked',reason:'request-id-conflict'});
      if (prior.result) return prior.result;
      if (prior.pending) return prior.pending;
    }
    const pendingCount = [...requestCache.values()].filter(value => value.pending !== null).length;
    if (pendingCount >= 32) return domainResult(command,{status:'blocked',reason:'request-capacity'});
    const execution = (async (): Promise<RuntimeDomainResult> => {
      const owner = snapshot();
      if(command.domain==='account-community'&&accountCommunity){
        const context:RequestContext={schemaVersion:1,requestId:command.requestId,owner};const p=command.payload as Record<string,unknown>;
        let result:CommunityResult;
        switch(command.action){
          case 'autojoin-list': result=accountCommunity.listAutojoin(context); break;
          case 'autojoin-add': result=accountCommunity.addAutojoin({context,channel:p.channel as string}); break;
          case 'autojoin-remove': result=accountCommunity.removeAutojoin({context,channel:p.channel as string}); break;
          case 'group-list': result=accountCommunity.listGroup(context); break;
          case 'group-add': result=accountCommunity.addGroup({context,nick:p.nick as string}); break;
          case 'group-remove': result=accountCommunity.removeGroup({context,nick:p.nick as string}); break;
          case 'group-primary': result=accountCommunity.setPrimary({context,nick:p.nick as string}); break;
          default: return domainResult(command,{status:'blocked',reason:'community-action-unavailable'});
        }
        const status:RuntimeDomainResult['status']=result.status==='accepted'?'accepted':result.status==='pending'?'pending'
          :result.status==='unknown'?'unknown':result.status==='rejected'?'failed':'blocked';
        const scope:RuntimeDomainResult['completionScope']=result.status==='accepted'||result.status==='rejected'?'server':result.status==='pending'||result.status==='unknown'?'transport':'local';
        return domainResult(command,{status,scope,reason:result.reason,view:result.view});
      }
      if(command.domain==='service-integration'){
        const requestContext:RequestContext={schemaVersion:1,requestId:command.requestId,owner};
        const payload=command.payload as Record<string,unknown>;
        if(command.action==='memo-send'){
          const recipientAccount=makeAccountId(payload.account);
          if(!integrationOperations)return domainResult(command,{status:'blocked',reason:'integration-unavailable'});
          let readiness=integrationOperations.readiness({context:requestContext,feature:'memo'});
          if(!readiness.allowed)return domainResult(command,{status:'blocked',scope:'local',reason:readiness.view.reason??'memo-not-ready',view:readiness.view});
          if(!recipientAccount||owner.accountId===null)return domainResult(command,{status:'blocked',scope:'local',reason:'account-proof-required',view:readiness.view});
          // A MEMO is an account-targeted durable write. Wait for the exact
          // owner's workspace selection to finish, then require its current
          // writable ticket and authenticated scheme before journal admission.
          const memoTicket=await writableVaultTicket(owner,requestContext);
          const memoGrant=memoTicket?workspaceGrantForOwner(owner):null;
          if(!memoTicket||memoTicket.scope.kind!=='account'||memoTicket.scope.accountId!==owner.accountId
            ||memoGrant?.scope!==memoTicket.scope
            ||!isCurrent(owner)||!isNamespaceCurrent(memoTicket,requestContext))
            return domainResult(command,{status:isCurrent(owner)?'blocked':'cancelled',scope:'local',reason:isCurrent(owner)?'workspace-unavailable':'owner-changed',view:null});
          const currentTicket=namespaceForRequest(requestContext);
          if(!currentTicket||currentTicket.scope.kind!=='account'||currentTicket.scope.accountId!==owner.accountId
            ||currentTicket.scope!==memoTicket.scope||currentTicket.access!=='read-write'
            ||currentTicket.workspaceEpoch!==memoTicket.workspaceEpoch||!isNamespaceCurrent(currentTicket,requestContext))
            return domainResult(command,{status:'blocked',scope:'local',reason:'workspace-unavailable',view:null});
          readiness=integrationOperations.readiness({context:requestContext,feature:'memo'});
          if(!readiness.allowed)return domainResult(command,{status:'blocked',scope:'local',reason:readiness.view.reason??'memo-not-ready',view:readiness.view});
          const queued=await journal.queueMemo({...requestContext,clientIntentId:command.requestId,operation:'memo-send',recipientAccount,body:payload.text as string});
          let status:RuntimeDomainResult['status']='accepted';let scope:RuntimeDomainResult['completionScope']='local';let reason:string|null=null;
          let phase:IntegrationView['phase']='accepted';let item='Queued locally; delivery is not yet confirmed. See Outbox for its current status.';
          if(queued.status==='queued'||queued.status==='existing'){
            if(queued.recordId){const entryRef=randomRef();journalEntryRefs.set(entryRef,{ownerRef:owner.ownerRef,recordId:queued.recordId});}
            if(queued.recordId&&transport.isOpen()){
              const attempted=await journal.retryQueued(requestContext,queued.recordId);
              if(attempted.status==='transport-admitted'){status='transport-admitted';scope='transport';item='Queued locally; this copy was handed to the connection. Delivery is not yet confirmed; see Outbox.';}
              else if(attempted.status==='delivery-unknown'){status='unknown';scope='transport';phase='unknown';reason='transport-error';item='Delivery outcome is unknown. Review Outbox before retrying.';}
              else if(attempted.status==='stale-owner'){status='cancelled';phase='blocked';reason='owner-changed';item='The account connection changed before the memo could be sent.';}
              else if(attempted.status==='blocked'){status='held';phase='blocked';reason='feature-unknown';item='The memo is saved in Outbox and needs review before sending.';}
            }
          }else{
            status='blocked';phase='blocked';
            reason=queued.status==='memory-only'?'account-proof-required':queued.status==='stale-owner'?'owner-changed':queued.status==='unavailable'?'offline':'feature-unknown';
            item='The memo was not saved to Outbox.';
          }
          const view:IntegrationView={...readiness.view,requestId:command.requestId,operation:'send',phase,
            authorization:readiness.view.authorization,reason:reason as IntegrationView['reason'],
            rows:[...readiness.view.rows,{kind:'status',label:'Outbox',value:item,ref:null}]};
          return domainResult(command,{status,scope,reason,view});
        }
        if(!integrationOperations)return domainResult(command,{status:'blocked',reason:'integration-unavailable'});
        const result:IntegrationResult=command.action==='refresh'
          ?integrationOperations.refresh({context:requestContext,feature:payload.feature as import('./integration-operations').IntegrationFeature})
          :integrationOperations.execute({context:requestContext,action:{type:command.action,...payload} as IntegrationAction});
        const phase=result.view.phase;
        const status:RuntimeDomainResult['status']=phase==='accepted'?'accepted':phase==='pending'?'pending':phase==='unknown'?'unknown'
          :phase==='rejected'?'failed':phase==='idle'?'blocked':'blocked';
        const localAction=command.action==='outhook-input'||command.action==='outhook-inspect';
        const scope:RuntimeDomainResult['completionScope']=phase==='pending'?(localAction?'local':'transport')
          :phase==='accepted'||phase==='rejected'||phase==='unsupported'?(localAction?'local':'server')
            :phase==='unknown'?'transport':'local';
        return domainResult(command,{status,scope,reason:result.view.reason,view:result.view});
      }
      if(command.domain==='account-security'&&privateAccountSecurity){
        const requestContext={schemaVersion:1 as const,requestId:command.requestId,owner};const p=command.payload as Record<string,unknown>;
        if(command.action==='passkey-list'||command.action==='passkey-rename'||command.action==='passkey-remove'){
          if(!passkeyManagement)return domainResult(command,{status:'blocked',reason:'passkey-unavailable',view:null});
          const result=command.action==='passkey-list'?passkeyManagement.list(requestContext)
            :command.action==='passkey-rename'?passkeyManagement.rename({context:requestContext,credentialRef:p.credentialRef as string,label:p.label as string})
              :passkeyManagement.remove({context:requestContext,credentialRef:p.credentialRef as string,confirm:true});
          const view:DomainView={kind:'passkey-management',requestId:result.requestId,status:result.view.status,operation:result.view.operation,rows:result.view.rows,reason:result.view.reason};
          const status:RuntimeDomainResult['status']=result.status==='accepted'?'accepted':result.status==='pending'?'pending':result.status==='unknown'?'unknown':result.status==='rejected'?'failed':'blocked';
          return domainResult(command,{status,scope:result.status==='pending'?'transport':'local',reason:result.reason,view});
        }
        if(command.action==='begin'){
          const action=p.action as import('./private-account-security').PrivateAccountSecurityAction;
          let intent:Parameters<typeof privateAccountSecurity.begin>[1];
          if(action==='totp-confirm')intent={action,formRef:p.formRef as string};
          else if(action==='recovery-generate'||action==='recovery-clear')intent={action,formRef:p.formRef as string|null};
          else if(action==='recovery-login'||action==='password-reset-confirm'||action==='account-register'||action==='account-verify')intent={action,account:p.account as string,formRef:p.formRef as string};
          else if(action==='account-email'||action==='account-password'||action==='account-certificate-reset')intent={action,formRef:p.formRef as string};
          else if(action==='account-drop')intent={action,formRef:p.formRef as string,confirm:true};
          else if(action==='password-reset-request')intent={action,account:p.account as string};
          else intent={action};
          const result=await privateAccountSecurity.begin(requestContext,intent);
          const status:RuntimeDomainResult['status']=result.admission.kind==='transport-admitted'?'pending':result.admission.kind==='unknown'?'unknown':'blocked';
          return domainResult(command,{status,scope:result.admission.kind==='transport-admitted'?'transport':'local',reason:result.admission.kind==='transport-admitted'?null:result.admission.reason,view:null});
        }
        const presentationRef=p.presentationRef as string;let phase:'accepted'|'failed'|'dismissed'='failed';let reason:string|null='presentation-unavailable';
        if(p.action==='present'){if(privateAccountSecurity.present(requestContext,presentationRef,'account-security')){phase='accepted';reason=null;}}
        else if(p.action==='copy'){
          const copied=await privateAccountSecurity.copy(requestContext,presentationRef,p.selection as 'secret'|'uri'|'codes');phase=copied?'accepted':'failed';reason=copied?null:'copy-failed';
        }else{privateAccountSecurity.dismiss(requestContext,presentationRef);phase='dismissed';reason=null;}
        const view:DomainView={kind:'account-security',schemaVersion:1,requestId:command.requestId,operationRef:presentationRef,ownerRef:owner.ownerRef,
          accountGeneration:owner.accountGeneration,connectionGeneration:owner.connectionGeneration,action:p.action as 'present'|'copy'|'dismiss',phase,reason,
          totpState:'unknown',remainingCodes:null,presentationRef:phase==='dismissed'?null:presentationRef,accountOutcome:'none',targetAccount:null,requiresLogin:false};
        publishDomain('account-security',view);return domainResult(command,{status:phase==='accepted'?'accepted':phase==='dismissed'?'cancelled':'failed',reason,view});
      }
      if(command.domain==='webauthn'&&webAuthn){
        if(command.action==='cancel'){
          const ceremonyRef=(command.payload as {ceremonyRef:string}).ceremonyRef;
          const pending=[...pendingWebAuthn.values()].find(item=>item.owner.ownerRef===owner.ownerRef&&item.ceremonyRef===ceremonyRef);
          if(pending){clearPendingWebAuthn(pending);pendingWebAuthn.delete(pending.context.requestId);webAuthn.cancel(ceremonyRef);}
          const view:DomainView={kind:'webauthn',requestId:command.requestId,ceremonyRef,ceremony:pending?.action??'authenticate',phase:'blocked',reason:'cancelled'};
          publishDomain('webauthn',view);return domainResult(command,{status:pending?'cancelled':'blocked',reason:pending?null:'ceremony-unavailable',view});
        }
        const p=command.payload as {ceremony:'register'|'authenticate';account:AccountId|null};
        const action=p.ceremony;const account=action==='register'?owner.accountId:p.account;
        if(!transport.isOpen()||!learnedPrefix||!account||!makeAccountId(account)||action==='register'&&(!owner.accountId||owner.accountId!==account))
          return domainResult(command,{status:'blocked',reason:'webauthn-unavailable',view:null});
        for(const [key,old] of pendingWebAuthn){if(old.owner.ownerRef===owner.ownerRef){clearPendingWebAuthn(old);pendingWebAuthn.delete(key);webAuthn.cancel(old.ceremonyRef);}}
        const lease=acquireWebAuthnOperation({schemaVersion:1,requestId:command.requestId,owner},action);
        if(!lease)return domainResult(command,{status:'blocked',reason:'webauthn-operation-busy',view:null});
        const context={schemaVersion:1 as const,requestId:command.requestId,owner};
        const pending:PendingWebAuthn={owner,context,action,account,ceremonyRef:randomRef(),challenge:null,rpId:null,allowCredentials:[],allowMalformed:false,sent:false,timer:null,lease};
        pending.timer=setTimeout(()=>{if(pendingWebAuthn.get(command.requestId)===pending){clearPendingWebAuthn(pending);pendingWebAuthn.delete(command.requestId);
          publishDomain('webauthn',{kind:'webauthn',requestId:command.requestId,ceremonyRef:pending.ceremonyRef,ceremony:action,phase:'blocked',reason:'cancelled'});}},60_000);
        pendingWebAuthn.set(command.requestId,pending);
        const line=formatIRCLine('WEBAUTHN',action==='register'?'REGISTER':'AUTH',...(action==='authenticate'?[account]:[])).replace(/\r\n$/u,'');
        const admission=transport.sendLine({line,owner,requestId:command.requestId});
        if(admission.kind==='blocked'){
          clearPendingWebAuthn(pending);pendingWebAuthn.delete(command.requestId);
          const view:DomainView={kind:'webauthn',requestId:command.requestId,ceremonyRef:pending.ceremonyRef,ceremony:action,phase:'blocked',reason:'transport-blocked'};
          return domainResult(command,{status:'blocked',reason:admission.reason,view});
        }
        const view:DomainView={kind:'webauthn',requestId:command.requestId,ceremonyRef:pending.ceremonyRef,ceremony:action,phase:admission.kind==='unknown'?'unknown':'pending',reason:admission.kind==='unknown'?'transport-unknown':null};
        if(admission.kind==='unknown')return domainResult(command,{status:'unknown',scope:'transport',reason:'transport-unknown',view});
        publishDomain('webauthn',view);return domainResult(command,{status:'pending',scope:'transport',view});
      }
      if(command.domain==='continuation'){
        const p=command.payload as Record<string,unknown>;
        let status:RuntimeDomainResult['status']='accepted';let reason:string|null=null;
        let scope:RuntimeDomainResult['completionScope']='local';
        if(command.action==='remember'||command.action==='forget'||command.action==='select'||command.action==='use'){
          const ref=p.continuationRef as string;const item=identity.listAccountContinuations().find(entry=>entry.continuationRef===ref);
          if(!item||item.networkId!==owner.networkId||(owner.accountId!==null&&item.accountId!==owner.accountId)){
            status='blocked';reason='continuation-unavailable';
          }else if(command.action==='remember'){
            const ok=await identity.setContinuationRememberConsent({networkId:item.networkId,accountId:item.accountId,enabled:p.enabled as boolean});
            status=ok?'accepted':'blocked';reason=ok?null:'remember-unavailable';
          }else if(command.action==='forget'){
            const ok=await identity.forgetAccountContinuation(ref);if(selectedContinuationRef===ref)selectedContinuationRef=null;
            status=ok?'accepted':'blocked';reason=ok?null:'forget-unavailable';
          }else if(command.action==='select'){
            if(!item.usable){status='blocked';reason='continuation-not-usable';}
            else selectedContinuationRef=ref;
          }else if(!item.usable||selectedContinuationRef!==ref||!advertisedCapabilities.has('sasl')
            ||!/(?:^|[\s,])SESSION-TOKEN(?:$|[\s,])/iu.test(capabilityValues.get('sasl')??'')){
            status='blocked';reason='continuation-not-ready';
          }else{
            const authContextRef=randomRef();
            if(!makeRequestId(authContextRef)||[...pendingContinuationSasl.values()].some(entry=>entry.owner.ownerRef===owner.ownerRef)){
              status='blocked';reason='continuation-operation-pending';
            }else{
              const requestId=command.requestId;
              saslContexts.set(authContextRef,owner);
              const pending={owner,continuationRef:ref,requestId,phase:'challenge' as const};
              pendingContinuationSasl.set(authContextRef,pending);
              const admission=transport.sendLine({line:'AUTHENTICATE SESSION-TOKEN',owner,requestId});
              if(admission.kind==='blocked'){
                pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);status='blocked';reason=admission.reason;
              }else if(admission.kind==='unknown'){
                identity.settleSessionTokenSasl({authContextRef,result:'unknown'});pendingContinuationSasl.delete(authContextRef);saslContexts.delete(authContextRef);
                publishSessionTokenSaslStatus(pending,'unknown');transport.close();status='unknown';scope='transport';reason='transport-error';
              }else{selectedContinuationRef=null;status='pending';scope='transport';}
            }
          }
        }
        const items=identity.listAccountContinuations();
        const selected=selectedContinuationRef&&items.some(item=>item.continuationRef===selectedContinuationRef&&item.usable)?selectedContinuationRef:null;
        if(selected===null)selectedContinuationRef=null;
        const view:DomainView={kind:'continuation',items,selectedContinuationRef:selected};
        publishDomain('continuation',view);return domainResult(command,{status,scope,reason,view});
      }
      if (command.domain === 'session') {
        const state = credentials.state(owner);
        let status: RuntimeDomainResult['status'] = 'accepted'; let scope: RuntimeDomainResult['completionScope'] = 'local'; let reason: string|null = null;
        if(['local-list','local-drop','mesh-list','mesh-next','mesh-revoke','mesh-reconcile','mesh-dismiss'].includes(command.action)){
          if(!sessionMeshControl)return domainResult(command,{status:'blocked',reason:'session-control-unavailable'});
          const context:RequestContext={schemaVersion:1,requestId:command.requestId,owner};const p=command.payload as Record<string,unknown>;
          let result:SessionControlResult;
          switch(command.action){
            case 'local-list': result=sessionMeshControl.localList(context); break;
            case 'local-drop': result=sessionMeshControl.localDrop({context,rowRef:p.rowRef as string,confirm:true}); break;
            case 'mesh-list': result=sessionMeshControl.meshList(context); break;
            case 'mesh-next': result=sessionMeshControl.meshNext({context,scanRef:p.scanRef as string}); break;
            case 'mesh-revoke': result=sessionMeshControl.meshRevoke({context,groupRef:p.groupRef as string,confirm:true}); break;
            case 'mesh-reconcile': result=sessionMeshControl.meshReconcile({context,revokeRef:p.revokeRef as string}); break;
            default: result=sessionMeshControl.meshDismiss({context,revokeRef:p.revokeRef as string}); break;
          }
          const mapped:RuntimeDomainResult['status']=result.status==='accepted'?'accepted':result.status==='pending'?'pending'
            :result.status==='held'?'held':result.status==='unknown'?'unknown':result.status==='rejected'?'failed':'blocked';
          const completionScope:RuntimeDomainResult['completionScope']=result.status==='accepted'||result.status==='held'||result.status==='rejected'?'server'
            :result.status==='pending'||result.status==='unknown'?'transport':'local';
          return domainResult(command,{status:mapped,scope:completionScope,reason:result.reason,view:result.view});
        }
        if (command.action === 'new-attachment') {
          const created=await tabIntents.createFreshIntent(true);
          const acquired=created.kind==='created'?await tabIntents.acquire(created.intentRef):created;
          if(acquired.kind==='acquired'&&acquired.intentRef){activeTabIntentRef=acquired.intentRef;status='accepted';}
          else {status='blocked';reason='reason'in acquired?acquired.reason:'intent-busy';}
        }
        else if (command.action === 'resume' || command.action === 'retry') {
          const payload=command.payload as {credentialRef:CredentialRef;acceptLegacyNewAttachment?:true};
          const context={schemaVersion:1 as const,requestId:command.requestId,owner};
          if(payload.acceptLegacyNewAttachment===true){
            recoveryLegacyIntentKeys.add(recoveryIntentKey(command.requestId,payload.credentialRef));
            while(recoveryLegacyIntentKeys.size>64)recoveryLegacyIntentKeys.delete(recoveryLegacyIntentKeys.values().next().value as string);
          }
          const admission=await recoveryController!.begin({context,credentialRef:payload.credentialRef,...(payload.acceptLegacyNewAttachment===true?{acceptLegacyNewAttachment:true as const}:{})});
          status=admission.kind==='transport-admitted'?'transport-admitted':admission.kind==='unknown'?'unknown':'blocked';
          scope=admission.kind==='blocked'?'local':'transport';reason=admission.kind==='blocked'?admission.reason:admission.kind==='unknown'?admission.reason:null;
          const view=recoveryViews.get(command.requestId)??null;
          return domainResult(command,{status,scope,reason,view});
        }
        else if (command.action === 'forget') { const ok=credentials.forget(owner,(command.payload as {credentialRef:CredentialRef}).credentialRef);status=ok?'accepted':'blocked';reason=ok?null:'credential-unavailable'; }
        else if (command.action === 'remember') { const ok=credentials.setRememberConsent(owner,(command.payload as {enabled:boolean}).enabled);status=ok?'accepted':'blocked';reason=ok?null:'remember-unavailable'; }
        const next=credentials.state(owner); const view:DomainView={kind:'session',credentials:next.credentials,issuance:next.issuance,remembered:next.remembered};
        return domainResult(command,{status,scope,reason,view});
      }
      const requestContext={schemaVersion:1 as const,requestId:command.requestId,owner};
      if(command.domain==='integration'){
        if(command.action==='webtransport-connect'){
          const p=command.payload as {endpointRef:string;confirm:true};
          if(p.confirm!==true||p.endpointRef!==String(endpointId)||!webTransport||!config.webTransportUrl)
            return domainResult(command,{status:'blocked',reason:'alternative-transport-unavailable',view:integrationView()});
          let url:URL;try{url=new URL(config.webTransportUrl);}catch{return domainResult(command,{status:'blocked',reason:'alternative-endpoint-unavailable',view:integrationView()});}
          if(url.protocol!=='https:'||url.username||url.password||url.hash||!trustedEndpoints.has(endpointId))
            return domainResult(command,{status:'blocked',reason:'alternative-endpoint-unavailable',view:integrationView()});
          const wss=runtimeConnect(currentUrl);
          if(wss.kind!=='transport-admitted')return domainResult(command,{status:wss.kind==='unknown'?'unknown':'blocked',reason:wss.kind==='blocked'?wss.reason:null,view:integrationView()});
          const nextOwner=snapshot();const requestId=makeRequestId(randomRef());const ref=randomRef();
          if(!requestId||!isCurrent(nextOwner)||!ref)return domainResult(command,{status:'cancelled',reason:'owner-changed',view:integrationView()});
          const req={schemaVersion:1 as const,requestId,owner:nextOwner,url:url.href,endpoint:endpointId};
          integrationFallbackTicket=null;pendingIntegrationFallback=null;
          integrationAttempt={ref,owner:nextOwner,requestId,transport:'webtransport',endpointId,url:currentUrl,phase:'connecting'};
          const admission=transport.connectAlternative({owner:nextOwner,endpoint:endpointId,requestId,open:sink=>webTransport.open(req,sink)});
          if(admission.kind==='blocked'){
            integrationAttempt={...integrationAttempt,phase:'failed'};
            publishDomainForOwner(nextOwner,'integration',integrationView());
            return domainResult(command,{status:'blocked',reason:admission.reason,view:integrationView()});
          }
          publishDomainForOwner(nextOwner,'integration',integrationView());
          return domainResult(command,{status:'transport-admitted',scope:'transport',view:integrationView()});
        }
        if(command.action==='webtransport-fallback'){
          const p=command.payload as {attemptRef:string;confirm:true};const active=integrationAttempt;
          const ticket=integrationFallbackTicket;
          const liveAttempt=!!active&&active.ref===p.attemptRef&&active.transport==='webtransport'&&active.phase==='failed'&&sameOwnerSnapshot(active.owner,owner);
          const liveTicket=!!ticket&&ticket.ref===p.attemptRef&&sameOwnerSnapshot(ticket.owner,owner)&&ticket.endpointId===endpointId&&ticket.url===currentUrl;
          if(p.confirm!==true||(!liveAttempt&&!liveTicket))
            return domainResult(command,{status:'blocked',reason:'alternative-attempt-unavailable',view:integrationView()});
          webTransport?.close('explicit fallback');
          integrationAttempt=null;integrationFallbackTicket=null;pendingIntegrationFallback=null;
          const admission=runtimeConnect(currentUrl);
          if(admission.kind!=='transport-admitted'){
            if(liveTicket&&ticket&&ticket.endpointId===endpointId&&ticket.url===currentUrl)integrationFallbackTicket={...ticket,owner:snapshot()};
            else if(liveAttempt&&active)integrationFallbackTicket={ref:active.ref,owner:snapshot(),endpointId:active.endpointId,url:active.url};
            return domainResult(command,{status:admission.kind==='unknown'?'unknown':'blocked',reason:admission.kind==='blocked'?admission.reason:null,view:integrationView()});
          }
          const nextOwner=snapshot();const requestId=makeRequestId(randomRef());const ref=randomRef();
          if(!requestId||!ref)return domainResult(command,{status:'cancelled',reason:'owner-changed',view:integrationView()});
          integrationAttempt={ref,owner:nextOwner,requestId,transport:'wss',endpointId,url:currentUrl,phase:'connecting'};
          publishDomainForOwner(nextOwner,'integration',integrationView());
          return domainResult(command,{status:'transport-admitted',scope:'transport',view:integrationView()});
        }
        if(command.action==='reconnect-media'){
          return domainResult(command,{status:'blocked',reason:'fresh-media-capable-attachment-required',view:integrationView()});
        }
      }
      if(command.domain==='media'){
        const p=command.payload as Record<string,unknown>;
        const room=typeof p.conversationId==='string'?makeConversationId(p.conversationId):null;
        const publish=()=>publishMediaDomain();
        if(command.action==='inspect'){
          publish();return domainResult(command,{status:'accepted',view:mediaStatus});
        }
        if(command.action==='roster-refresh'&&room){
          const callRef=p.callRef as import('./contracts').MediaCallRef;
          if(!activeMediaRequest||!sameOwnerSnapshot(activeMediaRequest.owner,owner)||activeMediaRequest.conversationId!==room||activeMediaRequest.callRef!==callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const refreshed=await mediaEngine.refreshRecording({...requestContext,conversationId:room,callRef});
          if(!refreshed||!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});
          publish();const recording=refreshed.recording;
          return domainResult(command,{status:recording.rosterState==='complete'?'accepted':recording.rosterState==='pending'?'transport-admitted':recording.rosterState==='stale'?'unknown':'blocked',
            scope:recording.rosterState==='complete'?'server':'transport',reason:recording.reason,view:mediaStatus});
        }
        if(command.action==='devices-refresh'){
          const refreshed=await mediaEngine.refreshDevices(requestContext);
          if(!refreshed||!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});
          publish();return domainResult(command,{status:refreshed.devices.inputState==='rejected'||refreshed.devices.outputState==='rejected'?'blocked':'accepted',
            reason:refreshed.devices.inputReason??refreshed.devices.outputReason,view:mediaStatus});
        }
        if(command.action==='quality'&&room){
          const callRef=p.callRef as import('./contracts').MediaCallRef;
          const quality=mediaEngine.setQuality({context:requestContext,conversationId:room,callRef,policy:p.policy as 'auto'|'balanced'|'audio-priority'});
          if(!quality||!isCurrent(quality.owner)||!sameOwnerSnapshot(quality.owner,owner))return domainResult(command,{status:'blocked',reason:'call-unavailable',view:null});
          const view:DomainView={kind:'media-quality',requestId:command.requestId,conversationId:room,callRef,
            desiredPolicy:quality.desiredPolicy,observedNetworkTier:quality.observedNetworkTier,
            observedAudioQuality:quality.observedAudioQuality,videoState:quality.videoState};
          publishDomainForOwner(owner,'media',view);
          return domainResult(command,{status:'accepted',view});
        }
        if(command.action==='soundcheck'){
          const capture=captureIntentRefs.get(p.captureRef as string);
          if(!capture||capture.ownerRef!==owner.ownerRef||capture.purpose!=='soundcheck'||capture.conversationId!=='soundcheck'||capture.kind!=='voice')
            return domainResult(command,{status:'blocked',reason:'capture-intent-unavailable',view:mediaStatus});
          const result=await mediaEngine.soundcheck({...requestContext,captureRef:p.captureRef as string,durationMs:p.durationMs as number});
          return domainResult(command,{status:result.state==='input-signal-detected'||result.state==='silence'?'accepted':'blocked',reason:result.state==='input-signal-detected'||result.state==='silence'?null:result.state,view:mediaStatus});
        }
        if(command.action==='join'&&room){
          const capture=captureIntentRefs.get(p.captureRef as string);
          if(!capture||capture.ownerRef!==owner.ownerRef||capture.conversationId!==room||capture.purpose!=='cadence-call'
            ||capture.kind!==(p.kind==='video'?'camera':'voice'))return domainResult(command,{status:'blocked',reason:'capture-intent-unavailable',view:mediaStatus});
          const callRef=randomRef() as MediaCallRef;const previousActive=activeMediaRequest;
          if(previousActive&&(!sameOwnerSnapshot(previousActive.owner,owner)||previousActive.conversationId!==room||previousActive.callRef!==callRef)){
            const previousContext={schemaVersion:1 as const,requestId:previousActive.requestId,owner:previousActive.owner,conversationId:previousActive.conversationId,callRef:previousActive.callRef};
            mediaRecordingControl.retireCall(previousContext);
            captions.stop(previousContext);
            for(const listener of [...mediaRetirementListeners]){try{listener({owner:previousActive.owner,conversationId:previousActive.conversationId,callRef:previousActive.callRef,reason:'call-ended'});}catch{/* isolate old-call retirement */}}
            captionLocalConsents.delete(JSON.stringify([previousActive.owner.ownerRef,previousActive.conversationId,previousActive.callRef]));
          }
          activeMediaRequest={owner,requestId:command.requestId,conversationId:room,callRef};
          const result=await mediaEngine.join({...requestContext,conversationId:room,kind:p.kind as 'voice'|'video',captureRef:p.captureRef as string,callRef:callRef as import('./contracts').MediaCallRef});
          if(result.state==='in-call'){publish();}
          else {if(activeMediaRequest?.requestId===command.requestId)activeMediaRequest=null;publish();}
          return domainResult(command,{status:result.state==='in-call'?'accepted':result.reason==='owner-changed'?'cancelled':'blocked',reason:result.reason,view:mediaStatus});
        }
        if(command.action==='leave'){
          const result=await mediaEngine.leave({...requestContext,conversationId:room});activeMediaRequest=null;mediaScreenRef=null;captionView=null;publish();
          return domainResult(command,{status:result.reason==='owner-changed'?'cancelled':'accepted',reason:result.reason,view:mediaStatus});
        }
        if(command.action==='mute'){mediaEngine.setMuted({...requestContext,muted:p.muted as boolean});publish();return domainResult(command,{status:'accepted',view:mediaStatus});}
        if(command.action==='deafen'){mediaEngine.setDeafened({...requestContext,deafened:p.deafened as boolean});publish();return domainResult(command,{status:'accepted',view:mediaStatus});}
        if(command.action==='input'){
          if(p.captureRef!==null){const capture=captureIntentRefs.get(p.captureRef as string);
            if(!room||!p.callRef||!activeMediaRequest||capture?.ownerRef!==owner.ownerRef||capture.purpose!=='cadence-call'||capture.kind!=='voice'
              ||capture.conversationId!==room||capture.callRef!==p.callRef||capture.deviceRef!==p.deviceRef||activeMediaRequest.conversationId!==room||activeMediaRequest.callRef!==p.callRef)
              return domainResult(command,{status:'blocked',reason:'capture-intent-unavailable',view:mediaStatus});}
          if(p.captureRef!==null&&room&&p.callRef!==null){
            const context={schemaVersion:1 as const,requestId:command.requestId,owner,conversationId:room,callRef:p.callRef as import('./contracts').MediaCallRef};
            captions.stop(context);captionLocalConsents.delete(JSON.stringify([owner.ownerRef,room,p.callRef]));
          }
          const result=await mediaEngine.setMediaInput({...requestContext,deviceRef:p.deviceRef as string|null,conversationId:room,
            callRef:p.callRef as import('./contracts').MediaCallRef|null,captureRef:p.captureRef as string|null});
          if(!result||!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});publish();
          const state=result.devices.inputState;return domainResult(command,{status:state==='pending'?'transport-admitted':state==='unknown'?'unknown':state==='rejected'?'blocked':'accepted',
            scope:state==='pending'?'transport':'local',reason:result.devices.inputReason,view:mediaStatus});
        }
        if(command.action==='output'){
          const result=await mediaEngine.setMediaOutput({...requestContext,deviceRef:p.deviceRef as string|null,volumePercent:p.volumePercent as number});
          if(!result||!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});publish();
          const state=result.devices.outputState;return domainResult(command,{status:state==='pending'?'transport-admitted':state==='unknown'?'unknown':state==='rejected'?'blocked':'accepted',
            scope:state==='pending'?'transport':'local',reason:result.devices.outputReason,view:mediaStatus});
        }
        if(command.action==='camera-preview'&&room){
          const capture=captureIntentRefs.get(p.captureRef as string);
          if(!capture||capture.ownerRef!==owner.ownerRef||capture.conversationId!==room||capture.kind!=='camera'||capture.purpose!=='local-preview')
            return domainResult(command,{status:'blocked',reason:'capture-intent-unavailable',view:mediaStatus});
          const preview=await mediaEngine.previewCamera({...requestContext,conversationId:room,captureRef:p.captureRef as string,kind:'camera'});
          if(!preview)return domainResult(command,{status:'blocked',reason:'capture-unavailable',view:mediaStatus});
          const previewRef=randomRef();mediaPreviewRefs.set(previewRef,preview);activePreviewRef=previewRef;publish();
          return domainResult(command,{status:'accepted',view:mediaStatus});
        }
        if(command.action==='preview-attach'){
          const preview=mediaPreviewRefs.get(p.previewRef as string),element=mediaElements.get(p.elementRef as string);
          const attached=!!preview&&!!element&&preview.ownerRef===owner.ownerRef&&mediaEngine.attachPreview(preview,element);
          return domainResult(command,{status:attached?'accepted':'blocked',reason:attached?null:'preview-unavailable',view:mediaStatus});
        }
        if(command.action==='preview-retire'){
          const ref=p.previewRef as string,preview=mediaPreviewRefs.get(ref);if(preview?.ownerRef===owner.ownerRef){mediaEngine.retirePreview(preview);mediaPreviewRefs.delete(ref);if(activePreviewRef===ref)activePreviewRef=null;}
          publish();return domainResult(command,{status:preview?'accepted':'blocked',reason:preview?null:'preview-unavailable',view:mediaStatus});
        }
        if(command.action==='camera-publish'&&room){
          const preview=mediaPreviewRefs.get(p.previewRef as string);
          if(!preview||preview.ownerRef!==owner.ownerRef||preview.conversationId!==room)return domainResult(command,{status:'blocked',reason:'preview-unavailable',view:mediaStatus});
          const previous=activeMediaRequest;
          if(previous){
            const prior={schemaVersion:1 as const,requestId:previous.requestId,owner:previous.owner,conversationId:previous.conversationId,callRef:previous.callRef as import('./contracts').MediaCallRef};
            captions.stop(prior);
            captionLocalConsents.delete(JSON.stringify([previous.owner.ownerRef,previous.conversationId,previous.callRef]));
            if(previous.conversationId!==room){mediaRecordingControl.retireCall(prior);for(const listener of [...mediaRetirementListeners]){try{listener({owner:previous.owner,conversationId:previous.conversationId,callRef:previous.callRef,reason:'call-ended'});}catch{/* isolate old-call retirement */}}}
          }
          const callRef=previous&&sameOwnerSnapshot(previous.owner,owner)&&previous.conversationId===room?previous.callRef:randomRef() as MediaCallRef;
          const reserved:ActiveMediaRequest={owner,requestId:command.requestId,conversationId:room,callRef};
          activeMediaRequest=reserved;
          const result=await mediaEngine.publishCamera({...requestContext,conversationId:room,previewRef:preview.id,callRef:callRef as import('./contracts').MediaCallRef});
          if(!isCurrent(owner)||activeMediaRequest!==reserved)return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});
          const live=mediaEngine.inspect(requestContext);
          const priorScope=previous&&sameOwnerSnapshot(previous.owner,owner)&&previous.conversationId===room
            ?{conversationId:previous.conversationId,callRef:previous.callRef}:null;
          const publication=resolveCameraPublication(result,live,room,callRef,priorScope);
          if(publication.refreshRoster){
            publish();
            void mediaEngine.refreshRecording({...requestContext,conversationId:room,callRef:callRef as import('./contracts').MediaCallRef}).then(()=>{
              if(isCurrent(owner)&&activeMediaRequest===reserved)publish();
            }).catch(()=>{});
          }else{
            if(publication.restorePrevious&&previous)activeMediaRequest=previous;
            else{
              const failed={schemaVersion:1 as const,requestId:command.requestId,owner,conversationId:room,callRef:callRef as import('./contracts').MediaCallRef};
              mediaRecordingControl.retireCall(failed);
              for(const listener of [...mediaRetirementListeners]){try{listener({owner,conversationId:room,callRef,reason:'call-ended'});}catch{/* isolate failed publish retirement */}}
              activeMediaRequest=null;
            }
            mediaScreenRef=null;publish();
          }
          return domainResult(command,{status:publication.accepted?'accepted':'blocked',reason:publication.accepted?null:result.reason??'failed',view:mediaStatus});
        }
        if(command.action==='screen-start'&&room){
          const capture=captureIntentRefs.get(p.captureRef as string);const active=activeMediaRequest;
          if(!capture||capture.ownerRef!==owner.ownerRef||capture.conversationId!==room||capture.kind!=='screen'||capture.purpose!=='cadence-call'
            ||!active||!sameOwnerSnapshot(active.owner,owner)||active.conversationId!==room||capture.callRef!==active.callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const result=await mediaEngine.startScreen({...requestContext,conversationId:room,captureRef:p.captureRef as string,kind:'screen',callRef:active.callRef as import('./contracts').MediaCallRef});
          if(!isCurrent(owner)||activeMediaRequest!==active)return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});
          if(!result.reason)mediaScreenRef=randomRef();publish();return domainResult(command,{status:result.reason?'blocked':'accepted',reason:result.reason,view:mediaStatus});
        }
        if(command.action==='screen-stop'&&room){mediaEngine.stopScreen({...requestContext,conversationId:room});mediaScreenRef=null;publish();return domainResult(command,{status:'accepted',view:mediaStatus});}
        if(command.action==='consent'&&room){const callRef=p.callRef as import('./contracts').MediaCallRef;
          if(!activeMediaRequest||activeMediaRequest.owner.ownerRef!==owner.ownerRef||activeMediaRequest.conversationId!==room||activeMediaRequest.callRef!==callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const current=mediaEngine.inspect(requestContext);if(!current?.call||current.call.conversationId!==room||current.call.callRef!==callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const result=await mediaEngine.setMediaConsent({...requestContext,conversationId:room,callRef,consent:p.consent as 'granted'|'denied',policyRevision:p.policyRevision as string|null});
          if(!result||!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});publish();
          const state=result.recording.consentRequest;return domainResult(command,{status:state==='pending'?'transport-admitted':state==='unknown'?'unknown':state==='rejected'?'failed':'blocked',
            scope:state==='pending'?'transport':'local',reason:result.recording.reason,view:mediaStatus});}
        if(command.action==='record'&&room){const callRef=p.callRef as import('./contracts').MediaCallRef;
          if(!activeMediaRequest||activeMediaRequest.owner.ownerRef!==owner.ownerRef||activeMediaRequest.conversationId!==room||activeMediaRequest.callRef!==callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const current=mediaEngine.inspect(requestContext);if(!current?.call||current.call.conversationId!==room||current.call.callRef!==callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const result=await mediaEngine.requestRecording({...requestContext,conversationId:room,callRef,action:p.action as 'start'|'stop',consentRevision:p.consentRevision as string|null});
          if(!result||!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});publish();
          const state=result.recording.requestState;return domainResult(command,{status:state==='pending'?'transport-admitted':state==='unknown'?'unknown':state==='rejected'?'failed':'blocked',
            scope:state==='pending'?'transport':'local',reason:result.recording.reason,view:mediaStatus});}
        if(command.action==='audio-recover'&&room){const callRef=p.callRef as import('./contracts').MediaCallRef;
          if(!activeMediaRequest||activeMediaRequest.owner.ownerRef!==owner.ownerRef||activeMediaRequest.conversationId!==room||activeMediaRequest.callRef!==callRef)
            return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const result=await mediaEngine.recoverAudio({...requestContext,conversationId:room,callRef});if(!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-changed',view:null});publish();
          return domainResult(command,{status:result.state==='applied'?'accepted':result.state==='pending'?'transport-admitted':result.state==='unknown'?'unknown':'blocked',
            scope:result.state==='pending'?'local':'local',reason:result.reason,view:mediaStatus});}
        if(command.action==='caption-prepare'&&room){const callRef=p.callRef as MediaCallRef;const current=mediaEngine.inspect(requestContext);
          if(!current?.call||current.call.conversationId!==room||current.call.callRef!==callRef)return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const context={...requestContext,conversationId:room,callRef};const result=await captions.prepareLocalLanguage({context,language:p.language as string,explicitUserAction:true});return domainResult(command,{status:result.state==='installed'||result.state==='available'?'accepted':'blocked',reason:result.reason,view:mediaStatus});}
        if(command.action==='caption-start'&&room){const callRef=p.callRef as MediaCallRef;const current=mediaEngine.inspect(requestContext);
          if(!current?.call||current.call.conversationId!==room||current.call.callRef!==callRef)return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          const context={...requestContext,conversationId:room,callRef};captionLocalConsents.add(JSON.stringify([owner.ownerRef,room,callRef]));const result=await captions.start({context,language:p.language as string,mode:p.mode as 'local'|'browser-service',browserServiceConsent:p.browserServiceConsent as boolean});if(result.state!=='listening')captionLocalConsents.delete(JSON.stringify([owner.ownerRef,room,callRef]));return domainResult(command,{status:result.state==='listening'?'accepted':result.state==='stopped'?'cancelled':'blocked',reason:result.reason,view:mediaStatus});}
        if(command.action==='caption-stop'&&room){const callRef=p.callRef as MediaCallRef;const current=mediaEngine.inspect(requestContext);
          if(!current?.call||current.call.conversationId!==room||current.call.callRef!==callRef)return domainResult(command,{status:'blocked',reason:'call-unavailable',view:mediaStatus});
          captions.stop({...requestContext,conversationId:room,callRef});captionLocalConsents.delete(JSON.stringify([owner.ownerRef,room,callRef]));return domainResult(command,{status:'accepted',view:mediaStatus});}
        if(command.action==='webrtc-run'){
          const capture=captureIntentRefs.get(p.captureRef as string);
          if(!capture||capture.ownerRef!==owner.ownerRef||capture.kind!==(p.kind==='video'?'camera':'voice')||capture.purpose!=='webrtc-call')return domainResult(command,{status:'blocked',reason:'capture-intent-unavailable',view:mediaStatus});
          const context={...requestContext,conversationId:capture.conversationId};webRtcContext=context;
          const observation=await webRtc.runLocal({context,captureRef:p.captureRef as string,kind:p.kind==='video'?'audio-video':'audio'});
          webRtcView={phase:observation.state,audioCodec:observation.audioCodec,videoCodec:observation.videoCodec,iceState:observation.iceState,dtlsState:observation.dtlsState,transportClass:observation.transportClass};publish();
          return domainResult(command,{status:observation.state==='completed'||observation.state==='connected-no-media'?'accepted':'blocked',reason:observation.reason,view:mediaStatus});
        }
        if(command.action==='webrtc-stop'&&webRtcContext){webRtc.stop(webRtcContext);webRtcContext=null;webRtcView=null;publish();return domainResult(command,{status:'accepted',view:mediaStatus});}
        return domainResult(command,{status:'blocked',reason:'media-action-unavailable',view:mediaStatus});
      }
      if(command.domain==='group'){
        const p=command.payload as Record<string,unknown>;
        const room=typeof p.conversationId==='string'?makeConversationId(p.conversationId):null;
        if(command.action==='bootstrap-preview'&&room){const preview=privateCrypto.previewBootstrap({context:requestContext,conversationId:room});
          const view:DomainView={kind:'group',phase:preview?'bootstrap-review':'unavailable',conversationId:room,epoch:preview?.epoch??null,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:preview,backupPreview:null,backupOutcome:'none'};
          return domainResult(command,{status:preview?'accepted':'blocked',reason:preview?null:'bootstrap-preview-unavailable',view});}
        if(command.action==='bootstrap-approve'){const previewRef=p.previewRef as string;const approved=await privateCrypto.approveBootstrap({context:requestContext,previewRef,confirm:true});
          // The approval is a local trust decision; the Elm shell treats a
          // transport-admitted result as awaiting a follow-up that this action
          // never sends, so settle it as a local acceptance.
          return domainResult(command,{status:approved?'accepted':'blocked',scope:'local',reason:approved?null:'bootstrap-approval-failed',view:null});}
        if(command.action==='bootstrap-cancel'){const cancelled=privateCrypto.cancelBootstrap({context:requestContext,previewRef:p.previewRef as string});return domainResult(command,{status:cancelled?'cancelled':'blocked',reason:cancelled?null:'bootstrap-preview-unavailable'});}
        // Explicit device trust. SECURITY: requires independent security review.
        // No automatic or first-use trust: the fingerprint comes from the
        // authenticated directory and the pin is written only on trust-confirm.
        if(command.action==='trust-preview'&&room){
          const preview=await privateCrypto.previewDeviceTrust({context:requestContext,conversationId:room,accountId:p.accountId as string,deviceId:p.deviceId as string});
          const view:DomainView&{deviceTrust:{previewRef:string;accountId:string;deviceId:string;fingerprintHex:string}|null}={kind:'group',phase:preview?'device-trust-review':'unavailable',conversationId:room,epoch:null,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none',deviceTrust:preview};
          return domainResult(command,{status:preview?'accepted':'blocked',reason:preview?null:'device-trust-unavailable',view});
        }
        if(command.action==='trust-confirm'){
          const outcome=await privateCrypto.confirmDeviceTrust({context:requestContext,previewRef:p.previewRef as string,confirm:true});
          return domainResult(command,{status:outcome==='blocked'?'blocked':'accepted',reason:outcome==='blocked'?'device-trust-unavailable':null,view:null});
        }
        if(command.action==='directory-refresh'&&room){
          const membership=facts?.roomMembershipFacts(owner,room);
          if(!membership?.joined||!membership.complete)return domainResult(command,{status:'blocked',reason:'membership-incomplete',view:{kind:'group',phase:'directory-incomplete',conversationId:room,epoch:null,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});
          const accounts=membership.memberAccounts;const devices:import('./contracts').PublicDeviceMetadata[]=[];
          for(const accountId of accounts){const directory=await facts?.authenticatedDirectory(owner,accountId);if(!directory||!isCurrent(owner))continue;
            for(const item of directory.snapshot.devices){const trusted=!item.legacy&&await privateCrypto.isTrustedDevicePinned(owner,accountId,item.deviceId);
              if(!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-retired'});
              devices.push({accountId,deviceId:item.deviceId,trusted:trusted?'trusted':item.legacy?'unknown':'untrusted',current:accountId===owner.accountId});}
          }
          // Removal needs the verified head so the rotation cannot race a newer epoch.
          // Before any epoch exists, a still-valid fresh-create proof (our own
          // CREATE, founder alone, policy required) lets the founder author the
          // genesis from epoch 0 / zero hash; plan() re-proves it via the provider.
          const acceptedHead=privateCrypto.groupProviders.currentAcceptedHead(owner,room);
          const genesisAvailable=!acceptedHead&&!!facts?.freshCreateFact(owner,room)&&facts?.policySnapshot(owner,room).encryption==='required';
          const directoryHead=acceptedHead??(genesisAvailable?{epoch:0,commitHashHex:'0'.repeat(64)}:null);
          return domainResult(command,{status:'accepted',view:{kind:'group',phase:'directory-refreshed',conversationId:room,epoch:directoryHead?.epoch??null,currentCommitHashHex:directoryHead?.commitHashHex??null,plan:null,devices,operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});
        }
        if(command.action==='author-plan'&&room){const hash=String(p.expectedCommitHash);if(!/^[0-9a-f]{64}$/u.test(hash))return domainResult(command,{status:'blocked',reason:'invalid-commit-hash'});
          const expectedCommitHash=new Uint8Array(hash.match(/../gu)!.map(byte=>Number.parseInt(byte,16)));
          const plan=await privateCrypto.groupProviders.authoring.plan({...requestContext,conversationId:room,explicitUserIntent:true,expectedEpoch:p.expectedEpoch as number,expectedCommitHash,...(p.excludeDevice ? {excludeDevice:p.excludeDevice as {accountId:AccountId;deviceId:string}} : {})});expectedCommitHash.fill(0);
          if(!plan)return domainResult(command,{status:'blocked',reason:'group-plan-unavailable',view:{kind:'group',phase:'blocked',conversationId:room,epoch:null,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});
          const publicPlan={planRef:plan.planRef,conversationId:room,priorEpoch:plan.priorEpoch,nextEpoch:plan.nextEpoch,membershipRevision:plan.membershipRevision,recipientCount:plan.recipientCount,backupRequired:true};
          groupPlanRefs.set(plan.planRef,{ownerRef:owner.ownerRef,planRef:plan.planRef,requestId:command.requestId});
          while(groupPlanRefs.size>64)groupPlanRefs.delete(groupPlanRefs.keys().next().value as string);
          return domainResult(command,{status:'accepted',view:{kind:'group',phase:'planned',conversationId:room,epoch:plan.priorEpoch,currentCommitHashHex:hash,plan:publicPlan,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});}
        if(command.action==='author-commit'){const planRef=p.planRef as string;const plan=groupPlanRefs.get(planRef);if(!plan||plan.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'plan-unavailable'});
          const result=await privateCrypto.groupProviders.authoring.commit({...requestContext,planRef,confirmMembershipRevision:p.confirmMembershipRevision as string,confirmBackupEnabled:true});
          groupPlanRefs.delete(planRef);
          return domainResult(command,{status:result.phase==='local-installed'?'accepted':result.phase==='transport-admitted'||result.phase==='recipient-delivery-unknown'?'unknown':'blocked',scope:result.phase==='local-installed'?'server':'transport',reason:result.reason,view:{kind:'group',phase:result.phase,conversationId:result.room,epoch:result.epoch,currentCommitHashHex:null,plan:null,devices:[],operationRef:planRef,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});}
        if(command.action==='enroll'&&room){const result=await privateCrypto.groupProviders.recovery.enroll({...requestContext,conversationId:room,explicitUserIntent:true});return domainResult(command,{status:result.phase==='verified'?'accepted':result.phase==='blocked'?'blocked':'failed',reason:result.reason,view:{kind:'group',phase:result.phase,conversationId:room,epoch:result.epoch,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});}
        if(command.action==='welcome-request'&&room){const expected=String(p.expectedCommitHash);if(!/^[0-9a-f]{64}$/u.test(expected))return domainResult(command,{status:'blocked',reason:'invalid-commit-hash'});
          const hash=new Uint8Array(expected.match(/../gu)!.map(byte=>Number.parseInt(byte,16)));
          const result=await privateCrypto.groupProviders.recovery.requestWelcome({...requestContext,conversationId:room,expectedEpoch:p.expectedEpoch as number,expectedCommitHash:hash,explicitUserIntent:true});hash.fill(0);
          return domainResult(command,{status:result.phase==='request-admitted'||result.phase==='delivery-unknown'?'unknown':result.phase==='installed'?'accepted':'blocked',scope:result.phase==='installed'?'server':'transport',reason:result.reason,view:{kind:'group',phase:result.phase,conversationId:room,epoch:result.epoch,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});}
        if(command.action==='backup-export'&&room){
          const outputRef=p.outputRef as string,passwordRef=p.passwordRef as string,output=privateOutputs.get(outputRef),password=privatePasswords.get(passwordRef);
          if(!output||output.ownerRef!==owner.ownerRef||output.purpose!=='group-backup-export'||!password||password.ownerRef!==owner.ownerRef||password.purpose!=='group-backup-export')return domainResult(command,{status:'blocked',reason:'backup-private-ref-unavailable'});
          const outputToken=Symbol('backup-output'),passwordToken=privatePasswordToken(passwordRef,owner,'group-backup-export');if(!passwordToken)return domainResult(command,{status:'blocked',reason:'backup-password-unavailable'});
          privateOutputTokens.set(outputToken,{ref:outputRef,ownerRef:owner.ownerRef});
          const result=await privateCrypto.exportPortableGroupBackup({context:requestContext,conversationId:room,epoch:p.epoch as number,
            commitHashHex:p.commitHashHex as string,passwordRef:passwordToken});
          let written=false;
          if(result.kind==='encrypted'&&isCurrent(owner)){
            written=await writePrivateFile(outputRef,result.bytes,'application/vnd.onyx.private-backup','onyx-group-backup.onyxbackup',requestContext);
            result.bytes.fill(0);
          }
          privateOutputTokens.delete(outputToken);privatePasswordTokens.delete(passwordToken);privatePasswords.get(passwordRef)?.bytes.fill(0);privatePasswords.delete(passwordRef);
          const ok=result.kind==='encrypted'&&written;
          return domainResult(command,{status:ok?'accepted':result.kind==='blocked'&&result.reason==='stale-owner'?'cancelled':'failed',scope:'local',reason:ok?null:result.kind==='blocked'?result.reason:'private-output-unavailable',
            view:{kind:'group',phase:ok?'backup-exported':'backup-export-failed',conversationId:room,epoch:p.epoch as number,currentCommitHashHex:p.commitHashHex as string,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:ok?'encrypted-export':'none'}});
        }
        if(command.action==='backup-import'&&room){
          const inputRef=p.inputRef as string,passwordRef=p.passwordRef as string,input=privateInputs.get(inputRef),password=privatePasswords.get(passwordRef);
          if(!input||input.ownerRef!==owner.ownerRef||!sameOwnerSnapshot(input.owner,owner)||input.purpose!=='group-backup-import'||!password||password.ownerRef!==owner.ownerRef||password.purpose!=='group-backup-import')return domainResult(command,{status:'blocked',reason:'backup-private-ref-unavailable'});
          if(p.configuredNetworkId!==owner.networkId)return domainResult(command,{status:'blocked',reason:'wrong-network'});
          const inputToken=Symbol('backup-input'),passwordToken=privatePasswordToken(passwordRef,owner,'group-backup-import');if(!passwordToken)return domainResult(command,{status:'blocked',reason:'backup-password-unavailable'});
          privateInputTokens.set(inputToken,{ref:inputRef,ownerRef:owner.ownerRef});privatePasswordTokens.set(passwordToken,{ref:passwordRef,ownerRef:owner.ownerRef,purpose:'group-backup-import'});
          const result=await privateCrypto.previewPortableGroupBackup({context:requestContext,conversationId:room,inputRef:inputToken,passwordRef:passwordToken,configuredNetworkId:p.configuredNetworkId as string});
          privateInputTokens.delete(inputToken);privatePasswordTokens.delete(passwordToken);
          privatePasswords.get(passwordRef)?.bytes.fill(0);privatePasswords.delete(passwordRef);
          const network= result.kind==='preview' ? makeNetworkId(result.preview.networkId) : null;
          const account= result.kind==='preview' ? makeAccountId(result.preview.accountId) : null;
          const signer= result.kind==='preview' ? makeAccountId(result.preview.signerAccountId) : null;
          const safePreview=result.kind==='preview'&&network&&account&&signer?{...result.preview,networkId:network,accountId:account,signerAccountId:signer}:null;
          if(safePreview)portableBackupPreviews.set(safePreview.previewRef,{ownerRef:owner.ownerRef,preview:safePreview});
          const ok=safePreview!==null;return domainResult(command,{status:ok?'accepted':result.kind==='blocked'&&result.reason==='stale-owner'?'cancelled':'failed',scope:'local',reason:ok?null:result.kind==='blocked'?result.reason:'invalid-backup-preview',
            view:{kind:'group',phase:ok?'backup-review':'backup-import-failed',conversationId:room,epoch:safePreview?.epoch??null,currentCommitHashHex:safePreview?.commitHashHex??null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:safePreview,backupOutcome:ok?'preview':'none'}});
        }
        if(command.action==='backup-approve'){
          const previewRef=p.previewRef as string,known=portableBackupPreviews.get(previewRef);
          if(!known||known.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'backup-preview-unavailable'});
          const result=await privateCrypto.approvePortableGroupBackup({context:requestContext,previewRef,confirmHistoryOnly:true,confirmFingerprint:p.confirmFingerprint as string});
          portableBackupPreviews.delete(previewRef);
          const ok=result.kind==='installed-history-only';
          return domainResult(command,{status:ok?'accepted':result.reason==='stale-owner'?'cancelled':'failed',scope:'local',reason:ok?null:result.kind==='blocked'?result.reason:'invalid-backup-preview',
            view:{kind:'group',phase:ok?'history-installed':'backup-approval-failed',conversationId:known.preview.conversationId,epoch:ok?result.epoch:known.preview.epoch,
              currentCommitHashHex:ok?result.commitHashHex:known.preview.commitHashHex,plan:null,devices:[],operationRef:null,historyOnly:ok,bootstrap:null,backupPreview:null,backupOutcome:ok?'installed-history-only':'none'}});
        }
        if(command.action==='backup-cancel'){
          const previewRef=p.previewRef as string,known=portableBackupPreviews.get(previewRef);
          if(!known||known.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'backup-preview-unavailable'});
          privateCrypto.cancelPortableGroupBackup({context:requestContext,previewRef});portableBackupPreviews.delete(previewRef);
          return domainResult(command,{status:'cancelled',view:{kind:'group',phase:'backup-cancelled',conversationId:known.preview.conversationId,epoch:known.preview.epoch,currentCommitHashHex:known.preview.commitHashHex,
            plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});
        }
        if(command.action==='remove-device'&&room){const expected=String(p.expectedCommitHash);if(!/^[0-9a-f]{64}$/u.test(expected))return domainResult(command,{status:'blocked',reason:'invalid-commit-hash'});
          const hash=new Uint8Array(expected.match(/../gu)!.map(byte=>Number.parseInt(byte,16)));
          const result=await privateCrypto.groupProviders.recovery.rotateAfterRemoval({...requestContext,conversationId:room,expectedEpoch:p.expectedEpoch as number,expectedCommitHash:hash,explicitUserIntent:true,removedAccountId:p.accountId as AccountId,removedDeviceId:p.deviceId as string});hash.fill(0);
          return domainResult(command,{status:result.phase==='request-admitted'||result.phase==='delivery-unknown'?'unknown':result.phase==='installed'?'accepted':'blocked',scope:result.phase==='installed'?'server':'transport',reason:result.reason,view:{kind:'group',phase:result.phase,conversationId:room,epoch:result.epoch,currentCommitHashHex:null,plan:null,devices:[],operationRef:null,historyOnly:false,bootstrap:null,backupPreview:null,backupOutcome:'none'}});}
        if(command.action==='cancel'){const ref=p.operationRef as string;const operation=groupPlanRefs.get(ref);if(operation?.ownerRef===owner.ownerRef){privateCrypto.groupProviders.authoring.cancel(operation.requestId);groupPlanRefs.delete(ref);return domainResult(command,{status:'cancelled'});}return domainResult(command,{status:'blocked',reason:'operation-unavailable'});}
        return domainResult(command,{status:'blocked',reason:'group-action-unavailable',view:null});
      }
      if(command.domain==='draft'){
        const payload=command.payload as {conversationId:ConversationId;text?:string;revision?:number};
        if(command.action==='save'){
          const saveKey=JSON.stringify([owner.ownerRef,payload.conversationId]);const previous=draftSaveTails.get(saveKey)??Promise.resolve();
          const operation=previous.catch(()=>undefined).then(()=>drafts.save({...requestContext,conversationId:payload.conversationId,text:payload.text??'',revision:payload.revision??-1}));
          draftSaveTails.set(saveKey,operation);const result=await operation.finally(()=>{if(draftSaveTails.get(saveKey)===operation)draftSaveTails.delete(saveKey);});
          const state=result.status==='saved-encrypted'?'saved-encrypted':result.status==='memory-only-unsaved'||result.status==='quota-failed'?'memory-only-unsaved':'unavailable';
          const view:DomainView={kind:'storage',draft:{conversationId:payload.conversationId,revision:payload.revision??0,updatedAtMs:Date.now(),state,text:null},rows:[],items:[],plan:null};
          return domainResult(command,{status:result.status==='saved-encrypted'?'accepted':result.status==='memory-only-unsaved'?'held':'blocked',scope:'local',reason:result.status==='saved-encrypted'?null:result.status,view});
        }
        if(command.action==='load'){
          const result=await drafts.load({...requestContext,conversationId:payload.conversationId});
          const meta=result.revision===null?null:(await drafts.list(requestContext)).find(item=>item.conversationId===payload.conversationId);
          const view:DomainView={kind:'storage',draft:{conversationId:payload.conversationId,revision:meta?.revision??0,updatedAtMs:meta?.updatedAt??Date.now(),state:result.status==='saved-encrypted'?'saved-encrypted':'unavailable',text:result.text},rows:[],items:[],plan:null};
          return domainResult(command,{status:result.status==='saved-encrypted'?'accepted':'blocked',scope:'local',reason:result.status==='saved-encrypted'?null:result.status,view});
        }
        if(command.action==='discard'){
          const saveKey=JSON.stringify([owner.ownerRef,payload.conversationId]);const pending=draftSaveTails.get(saveKey);
          if(pending)await pending.catch(()=>undefined);
          if(!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'stale-owner'});
          const result=await drafts.clearIfRevision({...requestContext,conversationId:payload.conversationId,revision:payload.revision??-1});
          return domainResult(command,{status:result==='cleared'?'accepted':result==='unchanged'?'accepted':result==='stale-owner'?'cancelled':'blocked',reason:result==='cleared'||result==='unchanged'?null:result,view:{kind:'storage',draft:null,rows:[],items:[],plan:null}});
        }
        if(command.action==='recovery-list'){
          const listed=await drafts.listRecoverable(requestContext);
          if(!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-retired'});
          const view:DomainView={kind:'draft-recovery',requestId:command.requestId,
            status:listed.status==='ready'?'ready':listed.status==='stale-owner'?'stale':listed.status==='invalid'?'invalid':'unavailable',
            items:listed.items,truncated:listed.truncated,recovered:null,
            reason:listed.status==='ready'?null:listed.status==='stale-owner'?'owner-changed':listed.status==='invalid'?'invalid-ciphertext':'workspace-unavailable'};
          return domainResult(command,{status:listed.status==='ready'?'accepted':listed.status==='stale-owner'?'cancelled':'blocked',
            scope:'local',reason:listed.status==='ready'?null:view.reason,view});
        }
        if(command.action==='recover'){
          const result=await drafts.recoverExplicit({...requestContext,draftRef:(command.payload as {draftRef:string}).draftRef});
          if(!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'owner-retired'});
          const conversationId=result.conversationId?makeConversationId(result.conversationId):null;
          const recovered=result.status==='saved-encrypted'&&result.text!==null&&conversationId&&result.revision!==null&&result.draftRef
            ?{draftRef:result.draftRef,conversationId,revision:result.revision,text:result.text}:null;
          const status:Extract<DomainView,{kind:'draft-recovery'}>['status']=recovered?'ready'
            :result.status==='stale-owner'||result.status==='revision-changed'?'stale'
              :result.status==='selection-expired'||result.status==='invalid'||result.status==='invalid-ciphertext'?'invalid':'unavailable';
          const reason:Extract<DomainView,{kind:'draft-recovery'}>['reason']=recovered?null
            :result.status==='stale-owner'?'owner-changed':result.status==='selection-expired'?'selection-expired'
              :result.status==='revision-changed'?'revision-changed':result.status==='invalid-ciphertext'||result.status==='invalid'?'invalid-ciphertext':'storage-unavailable';
          const view:DomainView={kind:'draft-recovery',requestId:command.requestId,status,items:[],truncated:false,recovered,reason};
          return domainResult(command,{status:recovered?'accepted':result.status==='stale-owner'?'cancelled':status==='invalid'?'failed':'blocked',
            scope:'local',reason,view});
        }
        return domainResult(command,{status:'blocked',reason:'draft-recovery-unavailable'});
      }
      if(command.domain==='journal'){
        if(command.action==='queue'){
          const p=command.payload as {clientIntentId:RequestId;conversationId:ConversationId;intent:'chat'|'memo';text:string;replyTo:string|null;messageKind:'message'|'action';audiencePrefix:string|null};
          return queueOutgoing({owner,conversationId:p.conversationId,text:p.text,intent:p.intent,replyTo:p.replyTo,messageKind:p.messageKind,
            audiencePrefix:p.audiencePrefix,requestId:command.requestId,clientIntentId:p.clientIntentId});
        }
        if(command.action==='list'){
          const listed=await journal.listEntries(requestContext);
          const entries:import('./contracts').JournalPublicEntry[]=listed.entries.map(item=>{
            let entryRef=[...journalEntryRefs].find(([,saved])=>saved.ownerRef===owner.ownerRef&&saved.recordId===item.recordId)?.[0];
            if(!entryRef){entryRef=randomRef();journalEntryRefs.set(entryRef,{ownerRef:owner.ownerRef,recordId:item.recordId});}
            const state:import('./contracts').JournalPublicEntry['state']=item.state==='queued'?'queued':item.state==='queued-held'?'held':item.state==='dispatching'?'dispatching'
              :item.state==='transport-admitted'?'transport-admitted':item.state==='server-accepted'?'server-accepted':item.state==='delivery-unknown'?'delivery-unknown':item.state==='discarded'?'cancelled':'review-required';
            return {entryRef,clientIntentId:item.clientIntentId as RequestId,conversationId:(item.conversationId??item.target) as ConversationId,intent:item.intent,durability:'durable',state,createdAtMs:item.queuedAt};
          });
          const view:DomainView={kind:'journal',entries,entryRef:null};
          return domainResult(command,{status:listed.status==='ready'?'accepted':'blocked',reason:listed.status==='ready'?null:listed.status,view});
        }
        if(command.action==='retry'||command.action==='cancel'||command.action==='reconcile'){
          const ref=String((command.payload as {entryRef:string}).entryRef);const entry=journalEntryRefs.get(ref);
          if(!entry||entry.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'journal-entry-unavailable'});
          const context={...requestContext};
          const listed=await journal.listEntries(context);const row=listed.entries.find(item=>item.recordId===entry.recordId);
          if(!row)return domainResult(command,{status:'blocked',reason:'journal-entry-unavailable'});
          if(command.action==='retry'){
            if(row.state!=='queued'&&row.state!=='queued-held')return domainResult(command,{status:'blocked',reason:'explicit-replacement-required'});
            const result=await journal.retryQueued(context,row.recordId);
            return domainResult(command,{status:result.status==='transport-admitted'?'transport-admitted':result.status==='delivery-unknown'?'unknown':result.status==='stale-owner'?'cancelled':'blocked',scope:result.status==='transport-admitted'?'transport':'local',reason:result.status,view:null});
          }
          if(command.action==='cancel'){
            const result=await journal.discardReviewed({...context,recordId:row.recordId,confirmDiscard:true});
            return domainResult(command,{status:result==='discarded'?'accepted':result==='stale-owner'?'cancelled':'blocked',reason:result==='discarded'?null:result,view:null});
          }
          return domainResult(command,{status:'blocked',reason:'acceptance-proof-unavailable'});
        }
      }
      if(command.domain==='scheduled'&&scheduledCustody){
        const p=command.payload as Record<string,unknown>;const context={schemaVersion:1 as const,requestId:command.requestId,owner};
        if(command.action==='list'){
          const listed=await scheduledCustody.list(context);
          const view=scheduledDomainView(context,listed);
          return domainResult(command,{status:listed.status==='ready'?'accepted':listed.status==='stale-owner'?'cancelled':'blocked',reason:listed.status==='ready'?null:listed.status,view});
        }
        let result:ScheduledResult;
        if(command.action==='create')result=await scheduledCustody.create({...context,inputRef:p.inputRef as string,operationId:p.operationId as string,
          clientIntentId:p.clientIntentId as RequestId,conversationId:p.conversationId as ConversationId,dueAtMs:p.dueAtMs as number,
          messageKind:p.messageKind as 'message'|'action',replyTo:p.replyTo as import('./contracts').MessageId|null,audiencePrefix:p.audiencePrefix as string|null});
        else if(command.action==='edit')result=await scheduledCustody.edit({...context,inputRef:p.inputRef as string,scheduleRef:p.scheduleRef as string,
          expectedRevision:p.expectedRevision as number,dueAtMs:p.dueAtMs as number,messageKind:p.messageKind as 'message'|'action',
          replyTo:p.replyTo as import('./contracts').MessageId|null,audiencePrefix:p.audiencePrefix as string|null});
        else if(command.action==='cancel')result=await scheduledCustody.cancel({...context,scheduleRef:p.scheduleRef as string,expectedRevision:p.expectedRevision as number});
        else if(command.action==='reconcile')result=await scheduledCustody.reconcile({...context,scheduleRef:p.scheduleRef as string,expectedRevision:p.expectedRevision as number});
        else result=await scheduledCustody.dispatch({...context,scheduleRef:p.scheduleRef as string,expectedRevision:p.expectedRevision as number});
        if((command.action==='create'||command.action==='edit')&&typeof p.inputRef==='string'
          &&(result.status==='saved'||result.status==='edited'))settlePrivateScheduledMessage(p.inputRef,context,true);
        const mappedStatus:RuntimeDomainResult['status']=result.status==='saved'||result.status==='edited'||result.status==='cancelled'||result.status==='journal-accepted'||result.status==='server-accepted'?'accepted'
          :result.status==='delivery-unknown'?'unknown':result.status==='not-due'||result.status==='not-dispatched'||result.status==='policy-review'||result.status==='legacy-review'?'held':result.status==='stale-owner'?'cancelled'
          :result.status==='unavailable'||result.status==='quota'?'failed':'blocked';
        const reason=result.status==='saved'||result.status==='edited'||result.status==='cancelled'||result.status==='journal-accepted'||result.status==='server-accepted'?null
          :result.status==='stale-owner'?'stale-owner':result.status==='delivery-unknown'?'send-unknown':result.status==='not-due'||result.status==='not-dispatched'?'operation-pending'
          :result.status==='policy-review'?'policy-changed':result.status==='legacy-review'?'operation-pending'
          :result.status==='quota'?'quota-failed':result.status==='unavailable'?'storage-unavailable':result.status==='conflict'?'invalid-intent'
          :result.status==='invalid'?'invalid-intent':'send-blocked';
        const listed=await scheduledCustody.list(context);
        const view=scheduledDomainView(context,listed);
        const scope:RuntimeDomainResult['completionScope']=result.status==='server-accepted'?'server':'local';
        return domainResult(command,{status:mappedStatus,scope,reason,view});
      }
      if(command.domain==='anchor'){
        const p=command.payload as {conversationId:ConversationId;messageId:string|null;timestamp:string|null};
        if(command.action==='load'){
          const conversationId=(command.payload as {conversationId:ConversationId}).conversationId;
          const [accepted,viewed]=await Promise.all([anchors.get({...requestContext,conversationId}),anchors.getViewedCandidate({...requestContext,conversationId})]);
          if(!isCurrent(owner))return domainResult(command,{status:'cancelled',reason:'stale-owner',view:null});
          const view:DomainView={kind:'anchor',conversationId,acceptedTimestamp:accepted?.timestamp??null,viewedCandidate:viewed?.timestamp??null};
          return domainResult(command,{status:'accepted',scope:'local',view});
        }
        const timestamp=p.timestamp;
        if(timestamp===null)return domainResult(command,{status:'blocked',reason:'invalid-timestamp'});
        const saved=await anchors.persistViewedCandidate({...requestContext,conversationId:p.conversationId,anchor:{messageId:p.messageId as never,timestamp:timestamp as never,viewportRef:null,firstUnreadRef:null}});
        return domainResult(command,{status:saved==='local-saved'?'accepted':'blocked',scope:'local',reason:saved==='local-saved'?null:saved,view:null});
      }
      if(command.domain==='settings'){
        if(command.action==='preview'){
          const ref=(command.payload as {inputRef:string}).inputRef;const bytes=await readSelectedPrivateFile(ref,'settings-import',owner);
          if(!bytes)return domainResult(command,{status:'blocked',reason:'file-ref-unavailable',view:{kind:'settings',preview:null}});
          let parsed:unknown=null;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}finally{bytes.fill(0);}
          const preview=settings.previewImport(parsed);if(!preview.accepted)return domainResult(command,{status:'failed',reason:'invalid-settings',view:{kind:'settings',preview:null}});
          const previewRef=randomRef();settingsPreviews.set(previewRef,{ownerRef:owner.ownerRef,preview});
          const values=Object.entries(preview.diff).map(([key,value])=>({key:key as import('./contracts').SettingsPreviewView['values'][number]['key'],value}));
          return domainResult(command,{status:'accepted',view:{kind:'settings',preview:{previewRef,values,requiresOptInConfirmation:preview.requiresOptInConfirmation as ('linkPreviews'|'notificationPreviews')[]}}});
        }
        if(command.action==='apply'){
          const p=command.payload as {previewRef:string;enabledOptIns:readonly string[]};const ref=settingsPreviews.get(p.previewRef);
          if(!ref||ref.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'settings-preview-unavailable',view:{kind:'settings',preview:null}});
          const required=ref.preview.requiresOptInConfirmation;
          if(required.some(key=>!p.enabledOptIns.includes(key)))return domainResult(command,{status:'blocked',reason:'explicit-opt-in-required',view:{kind:'settings',preview:null}});
          const values={...ref.preview.diff};for(const key of required)if(p.enabledOptIns.includes(key))values[key]=true;
          const applied=await settings.applyImport(requestContext,{accepted:true,diff:values,requiresOptInConfirmation:[]},true);settingsPreviews.delete(p.previewRef);
          return domainResult(command,{status:applied?'accepted':'blocked',reason:applied?null:'settings-write-failed',view:{kind:'settings',preview:null}});
        }
        if(command.action==='export'){
          const bundle=await settings.exportInstallation(requestContext);if(!bundle)return domainResult(command,{status:'blocked',reason:'settings-unavailable',view:{kind:'settings',preview:null}});
          const bytes=new TextEncoder().encode(JSON.stringify(bundle));const outputRef=(command.payload as {outputRef:string}).outputRef;
          const written=await writePrivateFile(outputRef,bytes,'application/json','onyx-settings.json',requestContext);bytes.fill(0);
          return domainResult(command,{status:written?'accepted':'blocked',scope:'local',reason:written?null:'output-unavailable',view:{kind:'settings',preview:null}});
        }
      }
      if(command.domain==='storage'){
        const selection=storageSelections.get((command.payload as {selectionRef:string}).selectionRef);
        if(!selection||selection.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'storage-selection-unavailable',view:{kind:'storage',draft:null,rows:[],items:[],plan:null}});
        if(command.action==='export'){
          const ok=await api.vaultExport(selection.targets,(command.payload as {outputRef:string}).outputRef);
          return domainResult(command,{status:ok?'accepted':'blocked',scope:'local',reason:ok?null:'storage-export-unavailable',view:{kind:'storage',draft:null,rows:[],items:[],plan:null}});
        }
        if(command.action==='clear'){
          if((command.payload as {confirm:true}).confirm!==true)return domainResult(command,{status:'blocked',reason:'explicit-confirmation-required'});
          let affected=0;for(const target of selection.targets){const result=await api.vaultClear(target);if(result.status!=='ready')return domainResult(command,{status:'blocked',reason:result.status==='stale'?'stale-owner':'storage-unavailable'});affected+=result.affected;}
          storageSelections.delete((command.payload as {selectionRef:string}).selectionRef);
          return domainResult(command,{status:'accepted',scope:'local',view:{kind:'storage',draft:null,rows:[],items:[],plan:{planRef:'',selectedCount:affected,retainedCount:0}}});
        }
      }
      if(command.domain==='eviction'){
        if(command.action==='preview'){
          const ids=(command.payload as {conversationIds:readonly ConversationId[]}).conversationIds;
          const plans=[] as Array<{planRef:string;selectedCount:number;retainedCount:number}>;
          for(const conversationId of ids){const plan=await eviction.preview({...requestContext,conversationId});if(!plan)continue;const ref=randomRef();evictionPlans.set(ref,plan);plans.push({planRef:ref,selectedCount:plan.count,retainedCount:Math.max(0,400-plan.count)});}
          return domainResult(command,{status:plans.length?'accepted':'blocked',reason:plans.length?null:'retention-unknown',view:{kind:'storage',draft:null,rows:[],items:[],plan:plans[0]??null}});
        }
        if(command.action==='apply'){
          const ref=(command.payload as {planRef:string}).planRef;const plan=evictionPlans.get(ref);
          if(!plan||plan.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'eviction-plan-unavailable'});
          const result=await eviction.apply(requestContext,plan);evictionPlans.delete(ref);
          return domainResult(command,{status:result.status==='cleared'?'accepted':'blocked',scope:'local',reason:result.status==='cleared'?null:result.status,view:{kind:'storage',draft:null,rows:[],items:[],plan:null}});
        }
      }
      if(command.domain==='workspace') {
        if(command.action==='list') {
          const metadata=await localWorkspaces.list();
          const items=metadata.map(item=>({workspaceRef:item.workspaceRef,networkId:item.networkId,accountId:item.accountId,remembered:item.remembered,selected:item.selected,locked:item.locked}));
          return domainResult(command,{status:'accepted',view:{kind:'workspace',items,selectedWorkspaceRef:metadata.find(item=>item.selected)?.workspaceRef??null}});
        }
        if(command.action==='select') {
          const workspaceRef=(command.payload as {workspaceRef:string}).workspaceRef;
          if(owner.accountId!==null){
            const selected=await localWorkspaces.select({workspaceRef,explicitUserAction:true});
            if(selected)lastWorkspaceGrant=localWorkspaces.grant();
            const metadata=await localWorkspaces.list();
            const items=metadata.map(item=>({workspaceRef:item.workspaceRef,networkId:item.networkId,accountId:item.accountId,remembered:item.remembered,selected:item.selected,locked:item.locked}));
            return domainResult(command,{status:selected?'accepted':'blocked',reason:selected?null:'workspace-unavailable',view:{kind:'workspace',items,selectedWorkspaceRef:metadata.find(item=>item.selected)?.workspaceRef??null}});
          }
          // Offline workspace switching is a two-phase local-owner transition.
          // The prepared reference is made under the old stamp and committed only
          // after the live physical identity has been retired and rotated.
          const prepared=await localWorkspaces.prepareSelection({workspaceRef,explicitUserAction:true,context:requestContext});
          if(!prepared||!isCurrent(owner))return domainResult(command,{status:'blocked',reason:'workspace-unavailable',view:null});
          const selectedMetadata=(await localWorkspaces.list()).find(item=>item.workspaceRef===workspaceRef);
          const configuredEndpoint=selectedMetadata?.networkId===networkId?endpointId
            :selectedMetadata?.networkId===makeNetworkId(config.networkId)?makeEndpointId(config.endpointId)
            :config.endpointRegistry?.find(entry=>makeNetworkId(entry.networkId)===selectedMetadata?.networkId)?.endpointId;
          const nextNetwork=selectedMetadata?makeNetworkId(selectedMetadata.networkId):null;
          const nextEndpoint=typeof configuredEndpoint==='string'?makeEndpointId(configuredEndpoint):null;
          if(!selectedMetadata||!nextNetwork||!nextEndpoint){
            const items=(await localWorkspaces.list()).map(item=>({workspaceRef:item.workspaceRef,networkId:item.networkId,accountId:item.accountId,remembered:item.remembered,selected:item.selected,locked:item.locked}));
            return domainResult(command,{status:'blocked',reason:'workspace-network-unavailable',view:{kind:'workspace',items,selectedWorkspaceRef:items.find(item=>item.selected)?.workspaceRef??null}});
          }
          retirePhysicalOwner(owner,false,true,nextNetwork,nextEndpoint);
          const nextOwner=snapshot();const commitContext=runtimeRequest(nextOwner,command.requestId);
          const selected=commitContext?localWorkspaces.commitSelection({prepared,context:commitContext}):null;
          if(selected)lastWorkspaceGrant=localWorkspaces.grant();
          const metadata=await localWorkspaces.list();
          const items=metadata.map(item=>({workspaceRef:item.workspaceRef,networkId:item.networkId,accountId:item.accountId,remembered:item.remembered,selected:item.selected,locked:item.locked}));
          const view:DomainView={kind:'workspace',items,selectedWorkspaceRef:metadata.find(item=>item.selected)?.workspaceRef??null};
          publishDomain('workspace',view);
          // The request stamp is intentionally stale after retirement. The new
          // owner receives the selected view through the scoped observation.
          return domainResult(command,{status:selected?'accepted':'blocked',reason:selected?null:'workspace-unavailable',view:null});
        }
        if(command.action==='lock') {
          localWorkspaces.lock();
          const metadata=await localWorkspaces.list();
          const items=metadata.map(item=>({workspaceRef:item.workspaceRef,networkId:item.networkId,accountId:item.accountId,remembered:item.remembered,selected:item.selected,locked:true}));
          return domainResult(command,{status:'accepted',view:{kind:'workspace',items,selectedWorkspaceRef:null}});
        }
        if(command.action==='remember') {
          const enabled=(command.payload as {enabled:boolean}).enabled;
          const remembered=await localWorkspaces.rememberProvenOwner(owner,enabled);
          // Remembering reselects the scope from its stored row, which may not
          // hold the scheme yet (a first remember can also race the initial
          // record and fail its fence). Without this the connection keeps a
          // null scheme, so read anchors and other keyed stores silently no-op.
          if(remembered&&isCurrent(owner)){
            const authenticatedScheme=facts?.conversationKeyScheme(owner);
            if(authenticatedScheme)await localWorkspaces.recordAuthenticatedConversationScheme(owner,authenticatedScheme);
          }
          const metadata=await localWorkspaces.list();
          const items=metadata.map(item=>({workspaceRef:item.workspaceRef,networkId:item.networkId,accountId:item.accountId,remembered:item.remembered,selected:item.selected,locked:item.locked}));
          return domainResult(command,{status:remembered?'accepted':'blocked',reason:remembered?null:'workspace-not-eligible',view:{kind:'workspace',items,selectedWorkspaceRef:metadata.find(item=>item.selected)?.workspaceRef??null}});
        }
      }
      if(command.domain==='tab-intent') {
        if(command.action==='list') {
          const metadata=await tabIntents.listSavedIntentMetadata();
          const intents:TabIntentView[]=metadata.map(item=>({intentRef:item.intentRef,state:item.state==='retired'?'retired':item.state,createdAtMs:item.createdAtMs}));
          return domainResult(command,{status:'accepted',view:{kind:'tab-intent',intents}});
        }
        let result:TabIntentResult|null;
        if(command.action==='fresh'){
          const fresh=await tabIntents.createFreshIntent(true);
          result=fresh.kind==='created'?await tabIntents.acquire(fresh.intentRef):fresh;
          if(result.kind==='acquired'&&result.intentRef)activeTabIntentRef=result.intentRef;
        }else if(command.action==='restore'){
          const ref=(command.payload as {intentRef:string}).intentRef;const approved=await tabIntents.requestExplicitRestore(ref);
          result=approved.kind==='restorable'?await tabIntents.acquire(ref):approved;
          if(result.kind==='acquired'&&result.intentRef)activeTabIntentRef=result.intentRef;
        }else if(command.action==='retire'){
          const ref=(command.payload as {intentRef:string}).intentRef;await tabIntents.retire(ref);if(activeTabIntentRef===ref)activeTabIntentRef=null;
          result={kind:'created' as const,intentRef:ref as never};
        }else result=null;
        const metadata=await tabIntents.listSavedIntentMetadata();
        const intents:TabIntentView[]=metadata.map(item=>({intentRef:item.intentRef,state:item.state==='retired'?'retired':item.state,createdAtMs:item.createdAtMs}));
        if(!result)return domainResult(command,{status:'blocked',reason:'unsupported-action',view:{kind:'tab-intent',intents}});
        const status=result.kind==='created'||result.kind==='acquired'||result.kind==='restorable'?'accepted':result.kind==='busy'?'held':'blocked';
        return domainResult(command,{status,reason:'reason'in result?result.reason:null,view:{kind:'tab-intent',intents}});
      }
      if(command.domain==='operator-import') {
        if(command.action==='preview') {
          const inputRef=(command.payload as {inputRef:string}).inputRef;const token=operatorInputTokens.get(inputRef);
          if(!token)return domainResult(command,{status:'blocked',reason:'file-ref-unavailable'});
          const result=await operatorImport.preview({context:{schemaVersion:1,requestId:command.requestId,owner},inputRef:token});
          const view:DomainView={kind:'operator-import',previewRef:result.previewRef,plan:result.plan};
          return domainResult(command,{status:result.status==='ready'?'accepted':result.status==='unavailable'?'blocked':'failed',reason:result.status==='ready'?null:result.status,view});
        }
        const previewRef=(command.payload as {previewRef:string}).previewRef;
        if(command.action==='dismiss') { operatorImport.dismiss({context:{schemaVersion:1,requestId:command.requestId,owner},previewRef});return domainResult(command,{status:'accepted',view:{kind:'operator-import',previewRef:null,plan:null}}); }
        const plan=operatorImport.getPreview({context:{schemaVersion:1,requestId:command.requestId,owner},previewRef});
        return domainResult(command,{status:plan?'accepted':'blocked',reason:plan?null:'preview-unavailable',view:{kind:'operator-import',previewRef:plan?previewRef:null,plan}});
      }
      if(command.domain==='platform') {
        const requestContext={schemaVersion:1 as const,requestId:command.requestId,owner};
        if(command.action==='notification-route'){
          const routeRef=(command.payload as {routeRef:string}).routeRef;const entry=notificationRouteRefs.get(routeRef);
          if(!entry||entry.owner.ownerRef!==owner.ownerRef||!notificationRouter)return domainResult(command,{status:'blocked',reason:'notification-route-unavailable'});
          notificationRouteRefs.delete(routeRef);const result=await notificationRouter.activate(entry.route,owner);
          return domainResult(command,{status:result==='opened'||result==='authentication-required'?'accepted':result==='stale-owner'?'cancelled':'blocked',reason:result==='opened'||result==='authentication-required'?null:result,view:null});
        }
        if(command.action.startsWith('worker-')) {
          if(!workerLifecycle||!buildCompatibility)return domainResult(command,{status:'blocked',reason:'build-compatibility-unavailable',view:{kind:'platform',worker:null,push:null}});
          let result:WorkerStatus|null=null;let activationRef:string|null=null;let targetRef:string|null=null;
          if(command.action==='worker-register'){
            const local=clientActivationState(owner);
            if(local)workerLifecycle.reportClientState(local);
            result=await workerLifecycle.register(requestContext);
          }else if(command.action==='worker-activate'){
            const ref=(command.payload as {targetRef:string}).targetRef;const target=workerTargets.get(ref);
            if(!target||target.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'activation-target-unavailable',view:{kind:'platform',worker:null,push:null}});
            const targetBuildId=target.buildId;
            activationRef=randomRef();workerActivations.set(activationRef,{ownerRef:owner.ownerRef,requestId:command.requestId,buildId:targetBuildId});
            const activation={owner,requestId:command.requestId,targetRef:ref,targetBuildId};authorizedWorkerActivation=activation;
            try{result=await workerLifecycle.requestActivation({...requestContext,targetBuildId,action:'when-safe'});}
            finally{if(authorizedWorkerActivation===activation)authorizedWorkerActivation=null;}
          }else if(command.action==='worker-cancel'){
            const ref=(command.payload as {activationRef:string}).activationRef;const active=workerActivations.get(ref);
            if(!active||active.ownerRef!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'activation-unavailable',view:{kind:'platform',worker:null,push:null}});
            result=await workerLifecycle.requestActivation({...requestContext,requestId:active.requestId,targetBuildId:active.buildId,action:'cancel'});workerActivations.delete(ref);
          }
          if(result){targetRef=randomRef();workerTargets.set(targetRef,{ownerRef:owner.ownerRef,buildId:result.buildId});const workerView={status:result.status,reason:result.reason,pendingClientCount:result.pendingClientCount,buildId:result.buildId,targetRef,activationRef};
            return domainResult(command,{status:result.status==='ready'?'accepted':result.status==='failed'||result.status==='unsupported'?'failed':result.status==='blocked-by-clients'?'held':'pending',scope:'local',reason:result.reason,view:{kind:'platform',worker:workerView,push:null}});}
        }
        if(!pushLifecycle||!platform)return domainResult(command,{status:'blocked',reason:'platform-unavailable',view:{kind:'platform',worker:null,push:null}});
        let result:PushSnapshot;
        if(command.action==='push-inspect'){
          result=await pushLifecycle.inspect(owner);
        }else if(command.action==='push-enable'){
          const ref=(command.payload as {consentRef:string}).consentRef;if(pushConsentRefs.get(ref)!==owner.ownerRef)return domainResult(command,{status:'blocked',reason:'consent-unavailable',view:{kind:'platform',worker:null,push:null}});
          pushConsentRefs.delete(ref);result=await pushLifecycle.enable({...requestContext,consent:'explicit-user',preview:'private'});
        }else if(command.action==='push-disable')result=await pushLifecycle.disable({...requestContext,consent:'explicit-user',preview:'private'});
        else result=await pushLifecycle.reconcile({...requestContext,consent:'recover-existing',preview:'private'});
        const pushConfig=platform.getPushConfig();
        const consentRef=owner.accountId!==null&&pushConfig.enabled&&pushConfig.vapidPublicKey instanceof Uint8Array
          &&(result.permission==='default'||result.permission==='granted')&&result.serverRegistration!=='registered'?randomRef():null;
        if(consentRef){pushConsentRefs.set(consentRef,owner.ownerRef);while(pushConsentRefs.size>32)pushConsentRefs.delete(pushConsentRefs.keys().next().value as string);}
        const pushView={state:result.reason,permission:result.permission,browserSubscription:result.browserSubscription,serverRegistration:result.serverRegistration,delivery:result.delivery,boundNode:result.boundNode,consentRef};
        const settledRemoval=command.action==='push-disable'&&result.reason===null&&result.serverRegistration==='none'&&result.browserSubscription==='none';
        const acceptedRegistration=result.reason===null&&result.serverRegistration==='registered';
        const status:RuntimeDomainResult['status']=result.reason==='stale-owner'?'cancelled':result.reason==='operation-pending'?'held':acceptedRegistration||settledRemoval?'accepted':result.serverRegistration==='pending'?'pending':result.serverRegistration==='unknown'?'unknown':'blocked';
        return domainResult(command,{status,scope:acceptedRegistration||settledRemoval?'server':'local',reason:result.reason,view:{kind:'platform',worker:null,push:pushView}});
      }
      return domainResult(command,{status:'blocked',reason:'service-not-composed'});
    })();
    requestCache.set(key,{payloadKey,pending:execution,result:null});
    const result=await execution;
    const live=snapshot();
    requestCache.set(key,{payloadKey,pending:null,result:live.ownerRef===command.ownerRef?result:domainResult(command,{status:'cancelled',reason:'owner-retired'})});
    while(requestCache.size>256){
      let oldestCompleted:string|undefined;
      for(const [candidate,row] of requestCache){if(row.pending===null){oldestCompleted=candidate;break;}}
      if(oldestCompleted===undefined)break;
      requestCache.delete(oldestCompleted);
    }
    const retained=requestCache.get(key)?.result??result;
    if(retained.view&&isCurrent(snapshot()))publishDomain(command.domain,retained.view);
    return retained;
  };
  const selectPrivateFile = (purpose: PrivateInputPurpose): Promise<string|null> => {
    const owner=snapshot();if (!privatePromptAllowed(owner) || typeof document === 'undefined') return Promise.resolve(null);
    const input=document.createElement('input');input.type='file';input.hidden=true;
    input.accept=purpose==='operator-import'?'.json,application/json':purpose==='settings-import'?'.json,application/json':'.onyxbackup,application/vnd.onyx.private-backup';
    document.body.append(input);
    return new Promise(resolve=>{
      let finished=false;
      activePrivatePickers+=1;
      let finish:(value:string|null)=>void=()=>{};
      const cancel=()=>finish(null);
      finish=(value:string|null)=>{if(finished)return;finished=true;privatePickerCancels.delete(cancel);input.value='';input.remove();activePrivatePickers=Math.max(0,activePrivatePickers-1);resolve(value);};
      privatePickerCancels.add(cancel);
      input.addEventListener('change',()=>{
        const file=input.files?.[0];const max=purpose==='group-backup-import'?8*1024*1024:1024*1024;
        if(!file||file.size>max||!privatePromptAllowed(owner)){finish(null);return;}
        const ref=randomRef();privateInputs.set(ref,{ownerRef:owner.ownerRef,owner,purpose,file,expiresAt:Date.now()+3*60_000});
        if(purpose==='operator-import')operatorInputTokens.set(ref,Symbol('operator-import-file'));
        while(privateInputs.size>8){const oldest=privateInputs.keys().next().value as string|undefined;if(!oldest)break;privateInputs.delete(oldest);operatorInputTokens.delete(oldest);}
        finish(ref);
      },{once:true});
      input.addEventListener('cancel',cancel,{once:true});
      try{input.click();}catch{finish(null);}
      globalThis.setTimeout(()=>finish(null),120_000);
    });
  };
  const readSelectedPrivateFile = async (inputRef: string, purpose: PrivateInputPurpose, owner: OwnerSnapshot): Promise<Uint8Array | null> => {
    const entry = privateInputs.get(inputRef);
    if (disposed || !entry || entry.purpose !== purpose || entry.expiresAt <= Date.now() || entry.ownerRef !== owner.ownerRef || !sameOwnerSnapshot(entry.owner,owner) || !isCurrent(owner)) return null;
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      if (!isCurrent(owner) || privateInputs.get(inputRef) !== entry || entry.expiresAt <= Date.now()) { bytes.fill(0); return null; }
      privateInputs.delete(inputRef);operatorInputTokens.delete(inputRef);
      for(const [token,tokenEntry] of privateInputTokens)if(tokenEntry.ref===inputRef)privateInputTokens.delete(token);
      return bytes;
    } catch { return null; }
  };
  const selectPrivateOutput = async (purpose: PrivateOutputPurpose): Promise<string|null> => {
    const picker = (globalThis as typeof globalThis & { showSaveFilePicker?: (options?: { suggestedName?: string; types?: readonly unknown[] }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    const owner = snapshot();
    if (!privatePromptAllowed(owner) || !picker || typeof window === 'undefined' || !window.isSecureContext) return null;
    activePrivatePickers+=1;
    let active=true;
    const finishLease=()=>{if(!active)return;active=false;privatePickerCancels.delete(cancel);activePrivatePickers=Math.max(0,activePrivatePickers-1);};
    let cancelPending:(value:null)=>void=()=>{};
    const cancelled=new Promise<null>(resolve=>{cancelPending=resolve;});
    const cancel=()=>{finishLease();cancelPending(null);};
    privatePickerCancels.add(cancel);
    try {
      const handle = await Promise.race([picker({ suggestedName: purpose === 'group-backup-export' ? 'onyx-group-backup.onyxbackup' : purpose === 'storage-export' ? 'onyx-history.json' : 'onyx-settings.json' }),cancelled]);
      if (!handle||!active||!privatePromptAllowed(owner)) return null;
      const outputRef = randomRef();
      privateOutputs.set(outputRef,{ownerRef:owner.ownerRef,purpose,handle,expiresAt:Date.now()+3*60_000});
      while(privateOutputs.size>8){const oldest=privateOutputs.keys().next().value as string|undefined;if(!oldest)break;privateOutputs.delete(oldest);}
      return outputRef;
    } catch { return null; }
    finally { finishLease(); }
  };
  const writePrivateFile = async (outputRef:string, bytes:Uint8Array, mime:string, filename:string, context:{readonly owner:OwnerSnapshot}):Promise<boolean> => {
    const entry=privateOutputs.get(outputRef);
    if(disposed||!entry||entry.expiresAt<=Date.now()||entry.ownerRef!==context.owner.ownerRef||!isCurrent(context.owner)
      ||!(bytes instanceof Uint8Array)||bytes.byteLength>8*1024*1024||!/^[\w.+-]{1,128}$/u.test(filename)||!/^[\w.+-]+\/[\w.+-]+$/u.test(mime))return false;
    try {
      const writable=await entry.handle.createWritable({keepExistingData:false});
      if(!isCurrent(context.owner)||privateOutputs.get(outputRef)!==entry||entry.expiresAt<=Date.now()){await writable.abort();return false;}
      await writable.write(new Blob([bytes.slice().buffer],{type:mime}));
      if(!isCurrent(context.owner)||privateOutputs.get(outputRef)!==entry){await writable.abort();return false;}
      await writable.close();privateOutputs.delete(outputRef);return isCurrent(context.owner);
    } catch { return false; }
  };
  const readPrivateFile = async (inputRef:symbol, context:{readonly owner:OwnerSnapshot}):Promise<Uint8Array|null> => {
    let ref:string|undefined;
    for(const [candidate,token] of operatorInputTokens)if(token===inputRef){ref=candidate;break;}
    const entry=ref?privateInputs.get(ref):undefined;
    if(disposed||!entry||entry.purpose!=='operator-import'||entry.expiresAt<=Date.now()||entry.ownerRef!==context.owner.ownerRef||!sameOwnerSnapshot(entry.owner,context.owner)||!isCurrent(context.owner))return null;
    try{const bytes=new Uint8Array(await entry.file.arrayBuffer());if(!isCurrent(context.owner)||privateInputs.get(ref!)!==entry||entry.expiresAt<=Date.now()){bytes.fill(0);return null;}privateInputs.delete(ref!);operatorInputTokens.delete(ref!);return bytes;}catch{return null;}
  };
  type MediaGesture='caption-prepare'|'audio-recover'|'output-select';
  type MediaGestureResult={readonly state:string;readonly reason:string|null};
  const currentGestureCall=(owner:OwnerSnapshot,conversationId:string,callRef:string):{readonly requestId:RequestId;readonly conversationId:ConversationId;readonly callRef:import('./contracts').MediaCallRef}|null=>{
    const room=makeConversationId(conversationId);const active=activeMediaRequest;
    if(!room||!active||!sameOwnerSnapshot(active.owner,owner)||active.conversationId!==room||active.callRef!==callRef||!isCurrent(owner))return null;
    const live=mediaEngine.inspect({schemaVersion:1,requestId:active.requestId,owner});
    return live?.call?.conversationId===room&&live.call.callRef===callRef
      ?{requestId:active.requestId,conversationId:room,callRef:callRef as import('./contracts').MediaCallRef}:null;
  };
  const isMediaCallCurrent=(owner:OwnerSnapshot,conversationId:string,callRef:string):boolean=>currentGestureCall(owner,conversationId,callRef)!==null;
  const prepareCaptionLanguageFromGesture=async(input:{readonly owner:OwnerSnapshot;readonly conversationId:string;readonly callRef:string;readonly language:string}):Promise<MediaGestureResult>=>{
    if(activationBarrier!==null)return {state:'failed',reason:'activation-barrier'};
    const call=currentGestureCall(input.owner,input.conversationId,input.callRef);
    if(!call)return {state:'failed',reason:'call-not-active'};
    const context={schemaVersion:1 as const,requestId:call.requestId,owner:input.owner,conversationId:call.conversationId,callRef:call.callRef};
    const result=await captions.prepareLocalLanguage({context,language:input.language,explicitUserAction:true});
    return {state:result.state,reason:result.reason};
  };
  const recoverAudioFromGesture=async(input:{readonly owner:OwnerSnapshot;readonly conversationId:string;readonly callRef:string}):Promise<MediaGestureResult>=>{
    if(activationBarrier!==null)return {state:'rejected',reason:'activation-barrier'};
    const call=currentGestureCall(input.owner,input.conversationId,input.callRef);
    if(!call)return {state:'rejected',reason:'call-not-active'};
    const result=await mediaEngine.recoverAudio({schemaVersion:1,requestId:call.requestId,owner:input.owner,conversationId:call.conversationId,callRef:call.callRef});
    return {state:result.state,reason:result.reason};
  };
  const setMediaOutputFromGesture=async(input:{readonly owner:OwnerSnapshot;readonly conversationId:string;readonly callRef:string;readonly deviceRef:string|null;readonly volumePercent:number}):Promise<MediaGestureResult>=>{
    if(activationBarrier!==null)return {state:'rejected',reason:'activation-barrier'};
    const noCallScope=input.conversationId===''&&input.callRef==='';
    const call=noCallScope?null:currentGestureCall(input.owner,input.conversationId,input.callRef);
    if(!noCallScope&&!call)return {state:'rejected',reason:'call-not-active'};
    if(input.deviceRef!==null&&!/^[A-Za-z0-9_-]{22,128}$/u.test(input.deviceRef)||!Number.isInteger(input.volumePercent)||input.volumePercent<0||input.volumePercent>100)
      return {state:'rejected',reason:'invalid-selection'};
    const request=call?{schemaVersion:1 as const,requestId:call.requestId,owner:input.owner}:runtimeRequest(input.owner);
    if(!request)return {state:'rejected',reason:'owner-changed'};
    const result=await mediaEngine.setMediaOutput({...request,deviceRef:input.deviceRef,volumePercent:input.volumePercent});
    return result?{state:result.devices.outputState,reason:result.devices.outputReason}:{state:'rejected',reason:'owner-changed'};
  };
  const createCaptureIntentRef = (): string => {
    if (disposed || disposingRuntime) return '';
    return randomRef();
  };
  const captureReadinessReason=(reason:string|null):CaptureReadiness['reason']=>{
    switch(reason){
      case null:return null;
      case 'expired':case 'unsupported':case 'stale-owner':case 'permission-required':case 'device-missing':
      case 'capture-failed':case 'transport-unavailable':case 'activation-barrier':return reason;
      default:return 'unsupported';
    }
  };
  const prepareCaptureFromGesture = (input: { readonly intentRef: string; readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly kind: CaptureKind; readonly purpose: CapturePurpose; readonly deviceRef?:string|null; readonly callRef?:string }): CaptureReadiness => {
    if (disposed || disposingRuntime || !isCurrent(input.owner) || !/^[A-Za-z0-9_-]{22,128}$/u.test(input.intentRef)) return { available: false, reason: 'stale-owner' };
    if(activationBarrier!==null){
      const event={intentRef:input.intentRef,ownerRef:input.owner.ownerRef,conversationId:input.conversationId,captureRef:input.intentRef,
        ...(input.callRef===undefined?{}:{callRef:input.callRef}),available:false,reason:'activation-barrier'} as const;
      for(const listener of [...captureListeners]){try{listener(event);}catch{/* isolate UI observers */}}
      return {available:false,reason:'activation-barrier'};
    }
    const purpose=input.purpose;
    const validPurpose=purpose==='cadence-call'||purpose==='local-preview'&&input.kind==='camera'
      ||purpose==='webrtc-call'&&(input.kind==='voice'||input.kind==='camera')||purpose==='soundcheck'&&input.kind==='voice';
    if(!validPurpose)return {available:false,reason:'unsupported'};
    if(input.purpose==='cadence-call'&&(input.kind==='screen'||input.callRef!==undefined)){
      const active=activeMediaRequest;
      if(!input.callRef||!active||!sameOwnerSnapshot(active.owner,input.owner)||active.conversationId!==input.conversationId||active.callRef!==input.callRef){
        const event={intentRef:input.intentRef,ownerRef:input.owner.ownerRef,conversationId:input.conversationId,captureRef:input.intentRef,
          ...(input.callRef===undefined?{}:{callRef:input.callRef}),available:false,reason:'stale-owner'} as const;
        for(const listener of [...captureListeners]){try{listener(event);}catch{/* isolate stale-call observer */}}
        return {available:false,reason:'stale-owner'};
      }
      const live=mediaEngine.inspect({schemaVersion:1,requestId:active.requestId,owner:input.owner});
      if(!live?.call||live.call.conversationId!==input.conversationId||live.call.callRef!==input.callRef){
        const event={intentRef:input.intentRef,ownerRef:input.owner.ownerRef,conversationId:input.conversationId,captureRef:input.intentRef,
          ...(input.callRef===undefined?{}:{callRef:input.callRef}),available:false,reason:'stale-owner'} as const;
        for(const listener of [...captureListeners]){try{listener(event);}catch{/* isolate stale-call observer */}}
        return {available:false,reason:'stale-owner'};
      }
    }
    if(input.deviceRef!==undefined&&input.deviceRef!==null&&!/^[A-Za-z0-9_-]{22,128}$/u.test(input.deviceRef))return {available:false,reason:'device-missing'};
    const existing = captureIntentRefs.get(input.intentRef);
    if (existing) return { available: false, reason: 'capture-failed' };
    if(purpose==='cadence-call'&&(!isCurrent(input.owner)||!transport.supportsBinaryMedia())){
      const event={intentRef:input.intentRef,ownerRef:input.owner.ownerRef,conversationId:input.conversationId,captureRef:input.intentRef,...(input.callRef===undefined?{}:{callRef:input.callRef}),
        available:false,reason:'transport-unavailable'} as const;
      for(const listener of [...captureListeners]){try{listener(event);}catch{/* isolate UI observers */}}
      return {available:false,reason:'transport-unavailable'};
    }
    const backendReadiness=mediaEngine.prepareCaptureFromGesture(input.intentRef,input.owner,input.conversationId,input.kind,purpose,input.deviceRef);
    const readiness:CaptureReadiness={available:backendReadiness.available===true,reason:captureReadinessReason(backendReadiness.reason)};
    if (readiness.available) {
      captureIntentRefs.set(input.intentRef, { ownerRef: input.owner.ownerRef, conversationId: input.conversationId, kind: input.kind, purpose,
        ...(input.deviceRef===undefined?{}:{deviceRef:input.deviceRef}), ...(input.callRef===undefined?{}:{callRef:input.callRef}) });
      while (captureIntentRefs.size > 8) {
        const oldest = captureIntentRefs.keys().next().value as string | undefined;
        if (!oldest) break;
        const retired = captureIntentRefs.get(oldest);
        if (retired?.ownerRef === input.owner.ownerRef) captureBroker.release(oldest, input.owner, retired.conversationId);
        captureIntentRefs.delete(oldest);
      }
    }
    const event = { intentRef: input.intentRef, ownerRef: input.owner.ownerRef, conversationId: input.conversationId, captureRef: input.intentRef,
      ...(input.callRef===undefined?{}:{callRef:input.callRef}),available: readiness.available, reason: readiness.reason };
    for (const listener of [...captureListeners]) { try { listener(event); } catch { /* isolate UI observation */ } }
    return readiness;
  };
  const newOperatorImport=()=>createOperatorImport({ownerSnapshot:snapshot,isCurrent,readPrivateFile,
    emit:event=>{const resultView:DomainView={kind:'operator-import',previewRef:event.previewRef,plan:null};publishDomain('operator-import',resultView);}});
  let operatorImport=newOperatorImport();
  const clearPrivateFiles=():void=>{for(const cancel of [...privatePickerCancels]){try{cancel();}catch{/* isolate picker cleanup */}}clearPrivatePasswords();privateInputs.clear();operatorInputTokens.clear();privateOutputs.clear();privateInputTokens.clear();privateOutputTokens.clear();operatorImport.dispose();operatorImport=newOperatorImport();};

  type LegacyVaultRow={readonly id?:string;readonly wireMessageId?:string|null;readonly target:string;readonly from:string;readonly body:string;readonly at:number;readonly rowType?:string;readonly kind?:string;readonly deleted?:boolean;readonly redacted?:boolean;readonly replyTo?:{readonly id:string;readonly from:string;readonly text:string}|null};
  type VaultPutStatus='ready'|'unavailable'|'stale';
  type VaultPutResult={readonly status:VaultPutStatus;readonly affected:number};
  type VaultPutWaiter={remaining:number;affected:number;failure:'unavailable'|'stale'|null;settled:boolean;resolve:(result:VaultPutResult)=>void};
  type RawVaultDescriptor={readonly id:string|undefined;readonly wireMessageId:string|null|undefined;readonly target:string;readonly from:string;readonly body:string;readonly at:number;
    readonly rowType:string|undefined;readonly kind:string|undefined;readonly deleted:boolean|undefined;readonly redacted:boolean|undefined;
    readonly replyPresent:boolean;readonly replyId:string|undefined;readonly replyFrom:string|undefined;readonly replyText:string|undefined};
  type VaultPutVersion={readonly identity:string;readonly descriptor:RawVaultDescriptor|null;readonly row:OwnedMessageInput;readonly bytes:number;readonly request:RequestContext;readonly waiters:Set<VaultPutWaiter>;terminal:boolean};
  type VaultPutPump={readonly owner:OwnerSnapshot;readonly ticket:LocalNamespaceTicket;readonly request:RequestContext;readonly scope:string;readonly pending:Map<string,VaultPutVersion>;active:VaultPutVersion[];readonly activeByIdentity:Map<string,VaultPutVersion>;running:boolean;scheduled:boolean;cancelled:boolean};
  // namespaceForRequest mints a request-bound ticket each time. Coalescing is
  // therefore scoped to the stable selected workspace object/epoch lineage;
  // each caller's fresh ticket is still checked before it joins, and the pump
  // keeps the first exact ticket/request for all writes.
  const vaultPutPumps=new Map<LocalNamespaceTicket['scope'],Map<string,VaultPutPump>>();
  const vaultPutWaiters=new Set<VaultPutWaiter>();
  let vaultPutLiveRows=0;
  let vaultPutLiveBytes=0;
  let vaultPutWaiterReferences=0;
  const VAULT_PUT_MAX_ROWS=10_000;
  const VAULT_PUT_MAX_BYTES=32*1024*1024;
  const VAULT_PUT_MAX_WAITERS=2_048;
  const VAULT_PUT_MAX_REFERENCES=2_000_000;
  // Keep persistence batches below the owned-storage row cap and bound synchronous version/waiter settlement per turn.
  const VAULT_PUT_DRAIN_ROWS=64;
  const sameRawVaultDescriptor=(left:RawVaultDescriptor|null,right:RawVaultDescriptor|null):boolean=>left!==null&&right!==null
    &&left.id===right.id&&left.wireMessageId===right.wireMessageId&&left.target===right.target&&left.from===right.from&&left.body===right.body
    &&Object.is(left.at,right.at)&&left.rowType===right.rowType&&left.kind===right.kind&&left.deleted===right.deleted&&left.redacted===right.redacted
    &&left.replyPresent===right.replyPresent&&left.replyId===right.replyId&&left.replyFrom===right.replyFrom&&left.replyText===right.replyText;
  const descriptorRetainedBytes=(descriptor:RawVaultDescriptor):number=>{
    // Strings are immutable primitives shared with the normalized row except
    // for reply previews stripped from encrypted rows. This conservative upper
    // bound accounts for the descriptor metadata and every retained string.
    const strings=[descriptor.id,descriptor.wireMessageId??undefined,descriptor.target,descriptor.from,descriptor.body,
      descriptor.rowType,descriptor.kind,descriptor.replyId,descriptor.replyFrom,descriptor.replyText];
    return 256+strings.reduce((total,value)=>total+(value?.length??0)*3,0);
  };
  const settleVaultPutWaiter=(waiter:VaultPutWaiter):void=>{
    if(waiter.settled||waiter.remaining>0)return;
    waiter.settled=true;vaultPutWaiters.delete(waiter);
    const status=waiter.failure??'ready';
    waiter.resolve({status,affected:status==='stale'?0:waiter.affected});
  };
  const finishVaultPutVersion=(version:VaultPutVersion,status:'ready'|'unavailable'|'stale'):void=>{
    if(version.terminal)return;
    version.terminal=true;vaultPutLiveRows=Math.max(0,vaultPutLiveRows-1);vaultPutLiveBytes=Math.max(0,vaultPutLiveBytes-version.bytes);
    for(const waiter of version.waiters){
      if(waiter.settled)continue;
      vaultPutWaiterReferences=Math.max(0,vaultPutWaiterReferences-1);
      if(status==='stale'||waiter.failure==='stale')waiter.failure='stale';
      else if(status==='unavailable'&&waiter.failure===null)waiter.failure='unavailable';
      if(status==='ready'&&waiter.failure!=='stale')waiter.affected+=1;
      waiter.remaining-=1;settleVaultPutWaiter(waiter);
    }
    version.waiters.clear();
  };
  const removeVaultPutPump=(pump:VaultPutPump):void=>{
    const byScope=vaultPutPumps.get(pump.ticket.scope);
    if(byScope?.get(pump.scope)===pump)byScope.delete(pump.scope);
    if(byScope?.size===0)vaultPutPumps.delete(pump.ticket.scope);
  };
  const stopVaultPutPump=(pump:VaultPutPump,status:'unavailable'|'stale'):void=>{
    if(pump.cancelled)return;
    pump.cancelled=true;
    for(const version of pump.pending.values())finishVaultPutVersion(version,status);
    pump.pending.clear();
    for(const version of pump.active)finishVaultPutVersion(version,status);
    pump.active=[];pump.activeByIdentity.clear();removeVaultPutPump(pump);
  };
  const vaultPutPumpCurrent=(pump:VaultPutPump):boolean=>!disposed&&!pump.cancelled&&isCurrent(pump.owner)
    &&localWorkspaces.isNamespaceCurrent(pump.ticket,pump.request);
  const scheduleVaultPutPump=(pump:VaultPutPump):void=>{
    if(pump.scheduled||pump.running||pump.cancelled)return;
    pump.scheduled=true;
    queueMicrotask(()=>{pump.scheduled=false;void drainVaultPutPump(pump);});
  };
  const drainVaultPutPump=async(pump:VaultPutPump):Promise<void>=>{
    if(pump.running||pump.cancelled)return;
    pump.running=true;
    try{
      while(!disposed&&!pump.cancelled){
        if(!vaultPutPumpCurrent(pump)){stopVaultPutPump(pump,'stale');return;}
        const batch=[...pump.pending.values()];
        if(batch.length===0)break;
          pump.pending.clear();pump.active=batch;
          pump.activeByIdentity.clear();
          for(const version of batch)if(!version.terminal)pump.activeByIdentity.set(version.identity,version);
        while(batch.length>0){
          if(!vaultPutPumpCurrent(pump)){stopVaultPutPump(pump,'stale');return;}
          const chunk=batch.splice(0,VAULT_PUT_DRAIN_ROWS).filter(version=>!version.terminal);
          pump.active=[...chunk,...batch];
          pump.activeByIdentity.clear();
          for(const version of pump.active)if(!version.terminal)pump.activeByIdentity.set(version.identity,version);
          if(chunk.length===0)continue;
          const result=await ownedStorage.put({...chunk[0]!.request,rows:chunk.map(version=>version.row)});
          if(!vaultPutPumpCurrent(pump)){
            stopVaultPutPump(pump,'stale');return;
          }
          if(result.status!=='ready'||result.affected!==chunk.length){
            const failedStatus=result.status==='stale-owner'?'stale':'unavailable';
            for(const version of pump.active)finishVaultPutVersion(version,failedStatus);
            for(const version of pump.pending.values())finishVaultPutVersion(version,failedStatus);
            pump.pending.clear();pump.active=[];pump.activeByIdentity.clear();chunk.length=0;pump.cancelled=true;removeVaultPutPump(pump);return;
          }
          for(const version of chunk){finishVaultPutVersion(version,'ready');if(pump.activeByIdentity.get(version.identity)===version)pump.activeByIdentity.delete(version.identity);}
          pump.active=batch;chunk.length=0;
          pump.activeByIdentity.clear();
          for(const version of batch)if(!version.terminal)pump.activeByIdentity.set(version.identity,version);
        }
        pump.active=[];pump.activeByIdentity.clear();
      }
    }catch{
      for(const version of pump.active)finishVaultPutVersion(version,'unavailable');
      for(const version of pump.pending.values())finishVaultPutVersion(version,'unavailable');
      pump.active=[];pump.activeByIdentity.clear();pump.pending.clear();pump.cancelled=true;removeVaultPutPump(pump);
    }finally{
      pump.running=false;
      if(!pump.cancelled&&pump.pending.size>0)scheduleVaultPutPump(pump);
      else if(!pump.cancelled&&pump.active.length===0)removeVaultPutPump(pump);
    }
  };
  retireVaultPumpsForOwner=(expected?:OwnerSnapshot):void=>{
    for(const byScope of vaultPutPumps.values())for(const pump of [...byScope.values()]){
      if(expected&&pump.owner.ownerRef!==expected.ownerRef)continue;
      stopVaultPutPump(pump,'stale');
    }
  };
  retireVaultPumpsForWorkspace=(scope):void=>{
    const byScope=vaultPutPumps.get(scope);
    if(!byScope)return;
    for(const pump of [...byScope.values()])stopVaultPutPump(pump,'stale');
  };
  const projectVaultRows=async(request:import('./contracts').RequestContext, rows:readonly OwnedMessageRow[])=>{
    const grant=workspaceGrantForOwner(request.owner)??workspaceHistoryGrantForOwner(request.owner);
    const ticket=localWorkspaces.namespaceForRequest(request);
    const projected=[] as Array<{id:string;wireMessageId:string|null;target:string;from:string;body:string;at:number;rowType:string;deleted:boolean;redacted:boolean;replyTo:{id:string;from:string;text:string}|null}>;
    for(const row of rows){
      if(!ticket||!isCurrent(request.owner)||!localWorkspaces.isNamespaceCurrent(ticket,request))return {status:'stale' as const,rows:[]};
      let body:string|null=row.privacy==='plain'?row.body:null;
      if(row.privacy==='room-ciphertext'&&grant){
        const opened=await privateCrypto.groupProviders.openHistoricalRoom({context:request,grant,conversationId:row.conversationId,room:row.conversationId,envelope:row.body});
        if(!isCurrent(request.owner)||!localWorkspaces.isNamespaceCurrent(ticket,request))return {status:'stale' as const,rows:[]};
        if(opened!==null)body=opened;
      } else if(row.privacy==='dm-ciphertext') {
        const opened=await privateCrypto.groupProviders.openDmFromCurrentPeer({context:request,conversationId:row.conversationId,envelope:row.body});
        if(!isCurrent(request.owner)||!localWorkspaces.isNamespaceCurrent(ticket,request))return {status:'stale' as const,rows:[]};
        if(opened!==null)body=opened;
      }
      projected.push({id:row.recordId,wireMessageId:row.messageId,target:row.conversationId,from:row.from,body:body??'[Encrypted message unavailable]',at:row.atMs,rowType:row.rowType,deleted:row.deleted,redacted:row.redacted,
        replyTo:body!==null&&row.replyTo&&row.replyTo.text!==null?{id:row.replyTo.id,from:row.replyTo.from,text:row.replyTo.text}:null});
    }
    if(!ticket||!isCurrent(request.owner)||!localWorkspaces.isNamespaceCurrent(ticket,request))return {status:'stale' as const,rows:[]};
    return {status:'ready' as const,rows:projected};
  };

  const api = Object.freeze({
    ownerSnapshot: snapshot,
    isCurrent,
    conversationKeyScheme(owner: OwnerSnapshot): ConversationKeyScheme | null {
      if (!isCurrent(owner) || caseMapping === null) return null;
      return { name: caseMapping, revision: `irc-casemapping-v1:${caseMapping}` };
    },
    conversationMappingGeneration(owner: OwnerSnapshot): number | null {
      return isCurrent(owner) ? mappingGeneration : null;
    },
    canonicalConversationKey(owner: OwnerSnapshot, rawConversationId: string): string | null {
      if (!isCurrent(owner) || caseMapping === null) return null;
      const conversationId: ConversationId | null = makeConversationId(rawConversationId);
      if (!conversationId) return null;
      const folded = normalizeCase(conversationId,caseMapping);
      return canonicalTupleKey([String(owner.networkId), caseMapping, folded]);
    },
    transport,
    credentials,
    identity,
    selectPrivateFile,
    readSelectedPrivateFile,
    selectPrivateOutput,
    writePrivateFile,
    readPrivateFile,
    isPrivateRuntimeActive: () => !disposed,
    queueOutgoing,
    flushOutgoing,
    async vaultPut(rows: readonly LegacyVaultRow[]): Promise<{readonly status:'ready'|'unavailable'|'stale';readonly affected:number}> {
      const owner=snapshot();const request=runtimeRequest(owner);if(!request||!Array.isArray(rows)||rows.length<1||rows.length>10_000)return {status:'unavailable',affected:0};
      const initialTicket=namespaceForRequest(request);
      const ticket=await writableVaultTicket(owner,request);
      if(!ticket)return {status:isCurrent(owner)?'unavailable':'stale',affected:0};
      if(!isCurrent(owner)||!localWorkspaces.isNamespaceCurrent(ticket,request)
        ||(initialTicket&&(!localWorkspaces.isNamespaceCurrent(initialTicket,request)||initialTicket.scope!==ticket.scope
          ||initialTicket.workspaceEpoch!==ticket.workspaceEpoch||initialTicket.access!==ticket.access)))return {status:'stale',affected:0};
      // Guest and read-only workspaces have no durable history write path.
      // Reject before touching row fields, normalization, or the account pump.
      if(ticket.scope.kind==='guest'||ticket.access!=='read-write')return {status:'unavailable',affected:0};
      type VaultPutCandidate={readonly scope:string;readonly canonicalTarget:string;readonly identity:string;readonly descriptor:RawVaultDescriptor|null;
        readonly bytes:number;readonly row:OwnedMessageInput;readonly reuse:VaultPutVersion|null};
      const candidates=new Map<string,VaultPutCandidate>();
      const scheme=ticket.conversationScheme;
      if(!scheme)return {status:'unavailable',affected:0};
      let normalizedBytes=0;
      const captureDescriptor=(row:LegacyVaultRow):RawVaultDescriptor|null=>{
        try{
          const id=row.id,wireMessageId=row.wireMessageId,target=row.target,from=row.from,body=row.body,at=row.at;
          const rowType=row.rowType,kind=row.kind,deleted=row.deleted,redacted=row.redacted,reply=row.replyTo;
          if(!(id===undefined||typeof id==='string')||!(wireMessageId===undefined||wireMessageId===null||typeof wireMessageId==='string')
            ||typeof target!=='string'||typeof from!=='string'||typeof body!=='string'||typeof at!=='number'
            ||!(rowType===undefined||typeof rowType==='string')||!(kind===undefined||typeof kind==='string')
            ||!(deleted===undefined||typeof deleted==='boolean')||!(redacted===undefined||typeof redacted==='boolean'))return null;
          const replyId=reply===undefined||reply===null?undefined:reply.id;
          const replyFrom=reply===undefined||reply===null?undefined:reply.from;
          const replyText=reply===undefined||reply===null?undefined:reply.text;
          if(reply!==undefined&&reply!==null&&(typeof replyId!=='string'||typeof replyFrom!=='string'||typeof replyText!=='string'))return null;
          return {id,wireMessageId,target,from,body,at,rowType,kind,deleted,redacted,replyPresent:reply!==undefined&&reply!==null,
            replyId,replyFrom,replyText};
        }catch{return null;}
      };
      const normalize=(row:LegacyVaultRow,descriptor:RawVaultDescriptor|null,generatedLocalRecordId?:string):{readonly input:OwnedMessageInput;readonly bytes:number;readonly normalizedBytes:number}|null=>{
        const target=descriptor?descriptor.target:row.target,from=descriptor?descriptor.from:row.from,body=descriptor?descriptor.body:row.body,atMs=descriptor?descriptor.at:row.at;
        const rawWireId=descriptor?descriptor.wireMessageId:row.wireMessageId;
        const rawId=descriptor?descriptor.id:row.id;
        const conversationId=makeConversationId(target);
        const validAt=Number.isSafeInteger(atMs)&&atMs>=0&&atMs<=8_640_000_000_000_000;
        const stamp=validAt?new Date(atMs).toISOString():null;const wireTimestamp=stamp?makeWireTimestamp(stamp):null;
        const reply=descriptor?.replyPresent?{id:descriptor.replyId!,from:descriptor.replyFrom!,text:descriptor.replyText!}:descriptor?null:row.replyTo;
        const replyTo=reply===null||reply===undefined?null:(reply&&typeof reply.id==='string'&&makeMessageId(reply.id)
          &&typeof reply.from==='string'&&typeof reply.text==='string'&&new TextEncoder().encode(reply.text).byteLength<=4096
          ?{id:reply.id,from:reply.from,text:reply.text}:undefined);
        if(typeof body!=='string')return null;
        const isRoomCiphertext=parseGroupEnvelope(body)!==null;
        const isDmCiphertext=isEnvelope(body)&&isValidDmEnvelope(body);
        const privacy=isRoomCiphertext?'room-ciphertext':isDmCiphertext?'dm-ciphertext':'plain';
        const wireMessageId=rawWireId===null||rawWireId===undefined?null:makeMessageId(rawWireId);
        const localRecordId=rawId??(wireMessageId===null?(generatedLocalRecordId??randomRef()):undefined);
        const bodyBytes=new TextEncoder().encode(body).byteLength;
        if(!conversationId||!validAt||!wireTimestamp||typeof from!=='string'||bodyBytes>64*1024||replyTo===undefined
          ||(rawWireId!==null&&rawWireId!==undefined&&!wireMessageId)
          ||(localRecordId!==undefined&&(typeof localRecordId!=='string'||localRecordId.length===0||localRecordId.length>512||/[\u0000-\u001f\u007f]/u.test(localRecordId))))return null;
        const rowType=descriptor?(descriptor.rowType??descriptor.kind??'msg'):(row.rowType??row.kind??'msg');
        const allowedRowTypes=new Set(['msg','action','notice','join','part','quit','kick','mode','topic','nick','system','error','whisper']);
        const input:OwnedMessageInput={messageId:wireMessageId,...(localRecordId===undefined?{}:{localRecordId}),conversationId,from,body,atMs,serverTime:wireTimestamp,
          rowType:allowedRowTypes.has(rowType)?rowType as OwnedMessageInput['rowType']:'system',deleted:(descriptor?descriptor.deleted:row.deleted)===true,redacted:(descriptor?descriptor.redacted:row.redacted)===true,
          replyTo:privacy==='plain'?replyTo:replyTo?{id:replyTo.id,from:replyTo.from,text:null}:null,privacy,wireBodyRef:null};
        const normalizedBytes=new TextEncoder().encode(JSON.stringify(input)).byteLength;
        return {input,normalizedBytes,bytes:normalizedBytes+(descriptor?descriptorRetainedBytes(descriptor):0)};
      };
      const scopedKey=(canonicalTarget:string):string=>JSON.stringify([owner.ownerRef,owner.networkId,owner.accountId,Number(owner.accountGeneration),Number(owner.connectionGeneration),owner.physicalRef,
        ticket.scope.workspaceRef,ticket.scope.kind,ticket.ownerKey,ticket.workspaceEpoch,ticket.access,scheme.name,scheme.revision,canonicalTarget]);
      const byScope=vaultPutPumps.get(ticket.scope);
      for(const sourceRow of rows){
        const descriptor=captureDescriptor(sourceRow);
        const target=descriptor?.target??sourceRow.target;
        const conversationId=makeConversationId(target);
        if(!conversationId)return {status:'unavailable',affected:0};
        const canonicalTarget=canonicalForTicket(owner,conversationId,ticket);
        if(!canonicalTarget)return {status:'unavailable',affected:0};
        const rawWireId=descriptor?descriptor.wireMessageId:sourceRow.wireMessageId;
        const rawId=descriptor?descriptor.id:sourceRow.id;
        const wireMessageId=rawWireId===null||rawWireId===undefined?null:makeMessageId(rawWireId);
        if(rawWireId!==null&&rawWireId!==undefined&&!wireMessageId)return {status:'unavailable',affected:0};
        const generatedLocalRecordId=rawId===undefined&&wireMessageId===null?randomRef():undefined;
        const localRecordId=rawId??generatedLocalRecordId;
        if(localRecordId!==undefined&&(typeof localRecordId!=='string'||localRecordId.length===0||localRecordId.length>512||/[\u0000-\u001f\u007f]/u.test(localRecordId)))return {status:'unavailable',affected:0};
        const identityKind=wireMessageId!==null?'wire':'local';const identityValue=wireMessageId??localRecordId;
        if(!identityValue)return {status:'unavailable',affected:0};
        const identity=JSON.stringify([canonicalTarget,identityKind,identityValue]);const scope=scopedKey(canonicalTarget);const candidateKey=JSON.stringify([scope,identity]);
        const existingCandidate=candidates.get(candidateKey);
        if(descriptor&&existingCandidate&&sameRawVaultDescriptor(existingCandidate.descriptor,descriptor))continue;
        const pump=byScope?.get(scope);const pending=pump?.pending.get(identity);const active=pump?.activeByIdentity.get(identity);
        const reuse=pending&&!pending.terminal&&sameRawVaultDescriptor(pending.descriptor,descriptor)?pending
          :active&&!active.terminal&&sameRawVaultDescriptor(active.descriptor,descriptor)?active:null;
        if(reuse){candidates.set(candidateKey,{scope,canonicalTarget,identity,descriptor,bytes:reuse.bytes,row:reuse.row,reuse});continue;}
        const normalized=normalize(sourceRow,descriptor,generatedLocalRecordId);
        if(!normalized)return {status:'unavailable',affected:0};
        normalizedBytes+=normalized.normalizedBytes;
        if(normalizedBytes>VAULT_PUT_MAX_BYTES)return {status:'unavailable',affected:0};
        candidates.set(candidateKey,{scope,canonicalTarget,identity,descriptor,bytes:normalized.bytes,row:normalized.input,reuse:null});
      }
      if(candidates.size===0||candidates.size>VAULT_PUT_MAX_ROWS)return {status:'unavailable',affected:0};
      let additionalRows=0;let additionalBytes=0;
      for(const candidate of candidates.values()){
        const pump=byScope?.get(candidate.scope);const pending=pump?.pending.get(candidate.identity);const active=pump?.activeByIdentity.get(candidate.identity);
        if(candidate.reuse===pending)continue;
        if(candidate.reuse===active){if(pending){additionalRows-=1;additionalBytes-=pending.bytes;}continue;}
        if(!pending){additionalRows+=1;additionalBytes+=candidate.bytes;}
        else additionalBytes+=candidate.bytes-pending.bytes;
      }
      if(vaultPutWaiters.size>=VAULT_PUT_MAX_WAITERS||vaultPutWaiterReferences+candidates.size>VAULT_PUT_MAX_REFERENCES
        ||vaultPutLiveRows+additionalRows>VAULT_PUT_MAX_ROWS||vaultPutLiveBytes+additionalBytes>VAULT_PUT_MAX_BYTES)return {status:'unavailable',affected:0};
      let resolve!: (result:VaultPutResult)=>void;
      const completion=new Promise<VaultPutResult>(done=>{resolve=done;});
      const waiter:VaultPutWaiter={remaining:candidates.size,affected:0,failure:null,settled:false,resolve};
      vaultPutWaiters.add(waiter);
      for(const candidate of candidates.values()){
        let pumps=vaultPutPumps.get(ticket.scope);if(!pumps){pumps=new Map();vaultPutPumps.set(ticket.scope,pumps);}
        let pump=pumps.get(candidate.scope);
        if(!pump){pump={owner,ticket,request,scope:candidate.scope,pending:new Map(),active:[],activeByIdentity:new Map(),running:false,scheduled:false,cancelled:false};pumps.set(candidate.scope,pump);}
        const previous=pump.pending.get(candidate.identity);
        if(candidate.reuse){
          if(candidate.reuse!==previous&&previous){pump.pending.delete(candidate.identity);finishVaultPutVersion(previous,'stale');}
          candidate.reuse.waiters.add(waiter);vaultPutWaiterReferences+=1;continue;
        }
        if(previous){pump.pending.delete(candidate.identity);finishVaultPutVersion(previous,'stale');}
        const version:VaultPutVersion={identity:candidate.identity,descriptor:candidate.descriptor,row:candidate.row,bytes:candidate.bytes,request,waiters:new Set([waiter]),terminal:false};
        pump.pending.set(candidate.identity,version);vaultPutLiveRows+=1;vaultPutLiveBytes+=candidate.bytes;vaultPutWaiterReferences+=1;
        scheduleVaultPutPump(pump);
      }
      return completion;
    },
    async vaultGet(target:string,limit=400):Promise<{readonly status:'ready'|'unavailable'|'stale';readonly rows:readonly LegacyVaultRow[];readonly retentionScope:import('./owned-storage').RetentionReadScope}> {
      const owner=snapshot();const request=runtimeRequest(owner);const conversationId=makeConversationId(target);
      if(!request||!conversationId)return {status:'unavailable',rows:[],retentionScope:{kind:'unknown'}};
      const result=await ownedStorage.get({...request,conversationId,limit:Math.max(1,Math.min(400,Math.floor(limit)))});
      if(result.status!=='ready')return {status:result.status==='stale-owner'?'stale':'unavailable',rows:[],retentionScope:result.retentionScope??{kind:'unknown'}};
      const projected=await projectVaultRows(request,result.rows);
      return {status:projected.status,rows:projected.rows,retentionScope:result.retentionScope??{kind:'unknown'}};
    },
    async vaultGetAround(target:string,at:string,limit=200):Promise<{readonly status:'ready'|'unavailable'|'stale';readonly rows:readonly LegacyVaultRow[];readonly retentionScope:import('./owned-storage').RetentionReadScope}> {
      const owner=snapshot();const request=runtimeRequest(owner);const conversationId=makeConversationId(target);const atMs=Date.parse(at);
      if(!request||!conversationId||!Number.isFinite(atMs))return {status:'unavailable',rows:[],retentionScope:{kind:'unknown'}};
      const result=await ownedStorage.around({...request,conversationId,atMs,limit:Math.max(1,Math.min(400,Math.floor(limit)))});
      if(result.status!=='ready')return {status:result.status==='stale-owner'?'stale':'unavailable',rows:[],retentionScope:result.retentionScope??{kind:'unknown'}};
      const projected=await projectVaultRows(request,result.rows);
      return {status:projected.status,rows:projected.rows,retentionScope:result.retentionScope??{kind:'unknown'}};
    },
    async vaultSearch(query:string,limit=100):Promise<{readonly status:'ready'|'unavailable'|'stale';readonly rows:readonly LegacyVaultRow[];readonly retentionScopes:readonly import('./owned-storage').TargetRetentionScope[];readonly complete:boolean}> {
      const owner=snapshot();const request=runtimeRequest(owner);if(!request)return {status:'unavailable',rows:[],retentionScopes:[],complete:false};
      const result=await ownedStorage.search({...request,query,limit:Math.max(1,Math.min(100,Math.floor(limit)))});
      if(result.status!=='ready')return {status:result.status==='stale-owner'?'stale':'unavailable',rows:[],retentionScopes:result.retentionScopes??[],complete:false};
      const projected=await projectVaultRows(request,result.rows);
      return {status:projected.status,rows:projected.rows,retentionScopes:result.retentionScopes??[],complete:result.complete&&projected.status==='ready'};
    },
    async vaultClear(target:string):Promise<{readonly status:'ready'|'unavailable'|'stale';readonly affected:number}> {
      const owner=snapshot();const request=runtimeRequest(owner);const conversationId=makeConversationId(target);
      if(!request||!conversationId)return {status:'unavailable',affected:0};const result=await ownedStorage.clear({...request,conversationId});return {status:result.status==='ready'?'ready':result.status==='stale-owner'?'stale':'unavailable',affected:result.affected};
    },
    async vaultExport(targets:readonly string[],outputRef:string):Promise<boolean> {
      const owner=snapshot();const request=runtimeRequest(owner);const conversationIds=targets.map(makeConversationId).filter((value):value is ConversationId=>value!==null);
      if(!request||!conversationIds.length||conversationIds.length>100)return false;
      const result=await ownedStorage.exportSelected({...request,conversationIds});if(result.status!=='ready'||!result.complete)return false;
      const projected=await projectVaultRows(request,result.rows);if(projected.status!=='ready')return false;
      const bytes=new TextEncoder().encode(JSON.stringify(projected.rows));
      const written=await writePrivateFile(outputRef,bytes,'application/json','onyx-history.json',request);bytes.fill(0);return written;
    },
    createCaptureIntentRef,
    prepareCaptureFromGesture,
    isMediaCallCurrent,
    prepareCaptionLanguageFromGesture,
    recoverAudioFromGesture,
    setMediaOutputFromGesture,
    subscribeCapturePrepared(listener: (event: { readonly intentRef: string; readonly ownerRef: string; readonly conversationId: string; readonly captureRef: string; readonly callRef?:string; readonly available: boolean; readonly reason: string | null }) => void): () => void {
      if (disposed) return () => {};
      captureListeners.add(listener);
      return () => { captureListeners.delete(listener); };
    },
    dispatchDomain,
    reportClientSafetyState(input: unknown): boolean {
      const safetyKeys=['schemaVersion','ownerRef','accountGeneration','connectionGeneration','hasUnsavedDraft','composing','pendingAuthoring'] as const;
      if(!isRecord(input)||input.schemaVersion!==1||Object.keys(input).length!==safetyKeys.length
        ||safetyKeys.some(key=>!Object.hasOwn(input,key))||Object.keys(input).some(key=>!(safetyKeys as readonly string[]).includes(key))
        ||typeof input.ownerRef!=='string'||!Number.isSafeInteger(input.accountGeneration)||!Number.isSafeInteger(input.connectionGeneration)
        ||typeof input.hasUnsavedDraft!=='boolean'||typeof input.composing!=='boolean'||typeof input.pendingAuthoring!=='boolean')return false;
      const owner=snapshot();
      if(input.ownerRef!==owner.ownerRef||input.accountGeneration!==Number(owner.accountGeneration)||input.connectionGeneration!==Number(owner.connectionGeneration)||!isCurrent(owner))return false;
      clientSafetyState={ownerRef:owner.ownerRef,accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),
        hasUnsavedDraft:input.hasUnsavedDraft,composing:input.composing,pendingAuthoring:input.pendingAuthoring};
      const safe=clientActivationState(owner);if(safe)workerLifecycle?.reportClientState(safe);
      if(activationBarrier&&!runtimeQuiescent(owner)){
        const active=[...workerActivations.values()].find(value=>value.ownerRef===owner.ownerRef);
        if(active&&workerLifecycle)void workerLifecycle.requestActivation({schemaVersion:1,requestId:active.requestId,owner,targetBuildId:active.buildId,action:'cancel'});
      }
      return true;
    },
    async settleNotificationNavigation(input:{readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number;readonly opened:boolean}):Promise<boolean>{
      const receiptKeys=['requestId','ownerRef','accountGeneration','connectionGeneration','opened'] as const;
      if(!isRecord(input)||Object.keys(input).length!==receiptKeys.length||receiptKeys.some(key=>!Object.hasOwn(input,key))
        ||Object.keys(input).some(key=>!(receiptKeys as readonly string[]).includes(key))
        ||typeof input.requestId!=='string'||typeof input.ownerRef!=='string'||!Number.isSafeInteger(input.accountGeneration)
        ||!Number.isSafeInteger(input.connectionGeneration)||typeof input.opened!=='boolean')return false;
      const claim=notificationNavigationClaims.get(input.requestId);const owner=snapshot();
      if(!claim||!sameOwnerSnapshot(claim.owner,owner)||input.ownerRef!==owner.ownerRef
        ||input.accountGeneration!==Number(owner.accountGeneration)||input.connectionGeneration!==Number(owner.connectionGeneration))return false;
      clearTimeout(claim.timer);notificationNavigationClaims.delete(input.requestId);
      const platform=config.browserPlatform;if(!platform)return false;
      return platform.settleNotificationRoute(claim.context,{routeRef:claim.route.routeRef,claimRef:claim.route.claimRef,
        outcome:input.opened?'opened':'unavailable'});
    },
    requestPrivateAccountForm(input:PrivateAccountFormRequest){
      if(!isRecord(input)||!['totp-code','recovery-password','recovery-code','account-email','account-password','account-certificate-reset','account-drop','password-reset-confirm','account-register','account-verify'].includes(String(input.kind))||typeof input.requestId!=='string'
        ||typeof input.ownerRef!=='string'||!Number.isSafeInteger(input.accountGeneration)||!Number.isSafeInteger(input.connectionGeneration)
        ||!(input.account===null||typeof input.account==='string'&&/^[A-Za-z0-9_.-]{1,64}$/u.test(input.account)))return Promise.resolve(null);
      return requestPrivateAccountForm(input);
    },
    requestPrivateScheduledMessage(input:PrivateScheduledMessageRequest){
      if(!isRecord(input)||typeof input.requestId!=='string'||typeof input.ownerRef!=='string'||(input.kind!=='create'&&input.kind!=='edit')
        ||typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{1,96}$/u.test(input.operationId)
        ||typeof input.conversationId!=='string'||!makeConversationId(input.conversationId)||!Number.isSafeInteger(input.initialDueAtMs)
        ||typeof input.prefillFromComposer!=='boolean'||!Number.isSafeInteger(input.accountGeneration)||!Number.isSafeInteger(input.connectionGeneration))return Promise.resolve(null);
      return requestPrivateScheduledMessage(input);
    },
    requestPrivatePassword(input:{readonly purpose:PrivatePasswordPurpose;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}){
      if(!isRecord(input)||!(input.purpose==='group-backup-export'||input.purpose==='group-backup-import')
        ||typeof input.ownerRef!=='string'||!Number.isSafeInteger(input.accountGeneration)||!Number.isSafeInteger(input.connectionGeneration))return Promise.resolve(null);
      return requestPrivatePassword(input);
    },
    async openDmFromCurrentPeer(input:{readonly owner:OwnerSnapshot;readonly conversationId:string;readonly envelope:string;readonly requestId:string}):Promise<string|null>{
      const conversationId=makeConversationId(input.conversationId),requestId=makeRequestId(input.requestId);
      if(!conversationId||!requestId||!isCurrent(input.owner)||typeof input.envelope!=='string'||input.envelope.length>64*1024)return null;
      const opened=await privateCrypto.groupProviders.openDmFromCurrentPeer({context:{schemaVersion:1,requestId,owner:input.owner},conversationId,envelope:input.envelope});
      return isCurrent(input.owner)?opened:null;
    },
    /** Live inbound room envelope → plaintext, only under the current accepted
     *  epoch for this owner (mirrors openDmFromCurrentPeer). Older or removed
     *  epochs return null; the shell then renders the missing-key state. */
    async openRoomFromCurrentEpoch(input:{readonly owner:OwnerSnapshot;readonly conversationId:string;readonly envelope:string;readonly requestId:string}):Promise<string|null>{
      const conversationId=makeConversationId(input.conversationId),requestId=makeRequestId(input.requestId);
      if(!conversationId||!requestId||!conversationId.startsWith('#')||!isCurrent(input.owner)||typeof input.envelope!=='string'||input.envelope.length>64*1024
        ||parseGroupEnvelope(input.envelope)===null)return null;
      const opened=await privateCrypto.groupProviders.openRoom(input.owner,conversationId,input.envelope);
      return isCurrent(input.owner)?opened:null;
    },
    createStorageSelection(targets:readonly string[]):string|null{
      const owner=snapshot();if(disposed||!targets.length||targets.length>100)return null;
      const safe=[...new Set(targets.map(makeConversationId).filter((value):value is ConversationId=>value!==null))];if(!safe.length)return null;
      const ref=randomRef();storageSelections.set(ref,{ownerRef:owner.ownerRef,targets:safe});while(storageSelections.size>64)storageSelections.delete(storageSelections.keys().next().value as string);return ref;
    },
    registerPrivateMediaElement(elementRef:string,element:HTMLVideoElement):boolean{
      if(disposed||!/^[A-Za-z0-9_-]{22,128}$/u.test(elementRef)||!(element instanceof HTMLVideoElement))return false;
      mediaElements.set(elementRef,element);while(mediaElements.size>8)mediaElements.delete(mediaElements.keys().next().value as string);return true;
    },
    retirePrivateMediaElement(elementRef:string):void{const element=mediaElements.get(elementRef);if(element?.srcObject)element.srcObject=null;mediaElements.delete(elementRef);},
    subscribeSendAccepted(listener:(event:{readonly clientIntentId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number})=>void):()=>void{
      if(disposed)return()=>{};sendAcceptedListeners.add(listener);return()=>{sendAcceptedListeners.delete(listener);};
    },
    subscribeDomainObservations(listener: (event: RuntimeDomainObservation) => void): () => void {
      if (disposed) return () => {};
      domainListeners.add(listener);
      return () => { domainListeners.delete(listener); };
    },
    subscribeSessionTokenSaslStatus(listener:(event:{readonly requestId:string;readonly status:'accepted'|'rejected'|'unknown'|'aborted';readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number})=>void):()=>void{
      if(disposed)return()=>{};sessionTokenSaslListeners.add(listener);return()=>sessionTokenSaslListeners.delete(listener);
    },
    onDispose(listener: () => void): () => void {
      if (disposed) { try { listener(); } catch { /* observer cleanup is isolated */ } return () => {}; }
      disposeListeners.add(listener);
      return () => { disposeListeners.delete(listener); };
    },
    connect(url = config.initialUrl): SendAdmission {
      if (disposed || disposingRuntime) return { kind: 'blocked', reason: 'owner-changed' };
      const target = resolveTarget(url);
      if (!target) return { kind: 'blocked', reason: 'invalid-intent' };
      const previous = snapshot();
      flushPublicIngress(previous);
      if (!isCurrent(previous)) return { kind: 'blocked', reason: 'owner-changed' };
      integrationFallbackTicket=null;pendingIntegrationFallback=null;
      const controlledRecovery=recoveryTransfer!==null&&sameOwnerSnapshot(recoveryTransfer.fromOwner,previous)
        &&recoveryTransfer.targetNetwork===target.networkId&&recoveryTransfer.targetEndpoint===target.endpointId&&recoveryTransfer.targetUrl===url;
      if(recoveryTransfer&&!controlledRecovery){recoveryController?.retire(recoveryTransfer.fromOwner);recoveryLegacyIntentKeys.delete(recoveryIntentKey(recoveryTransfer.requestId,recoveryTransfer.credentialRef));recoveryTransfer=null;}
      recoveryController?.retire(previous,{controlledRedirect:controlledRecovery});
      sessionMeshControl?.retire(previous);accountCommunity?.retire(previous);sessionOperations?.retire(previous);draftStoreForRetirement?.retireOwner(previous);
      integrationOperations?.retire(previous);
      clearPrivateOutHookPresentations(previous.ownerRef);
      stopScheduledDuePump();
      workspaceInitGeneration += 1;
      localWorkspaces.lock();
      scheduledCustody?.retireOwner(previous);
      for(const pending of pendingIdentify.values())clearTimeout(pending.timer);
      pendingIdentify.clear();
      pendingMarkerRequests.clear();markerProofs.clear();
      scheduledCustody?.retireOwner(previous);
      joinedTargetsByPhysical.clear();
      clearWebhookPresentationForOwner(previous.ownerRef);
      captureBroker.retireOwner(previous); captureIntentRefs.clear();
      clearPrivateScheduledMessages(previous.ownerRef);
      clearPrivateFiles();
      webAuthn?.retireOwner(previous);passkeyManagement?.retire(previous);
      for(const [key,pending] of pendingWebAuthn){if(pending.owner.ownerRef===previous.ownerRef){clearPendingWebAuthn(pending);pendingWebAuthn.delete(key);}}
      privateAccountSecurity?.retireOwner(previous);
      facts?.retire(previous);
      acceptance.retireOwner(previous); memorySend?.retireOwner(previous);
      privateCrypto.retireOwner(previous);
      privateCrypto.groupProviders.authoring.retireOwner(previous);
      retireRecoveryIssuanceForOwner(previous);credentials.retire(previous);
      identity.retire(previous);
      networkId = target.networkId;
      endpointId = target.endpointId;
      tabIntents.dispose();
      tabIntents = newTabIntentOwner(networkId);
      activeTabIntentRef=null;
      connectionGeneration = makeConnectionGeneration(Number(connectionGeneration) + 1)!;
      if (accountId !== null) accountGeneration = makeAccountGeneration(Number(accountGeneration) + 1)!;
      accountId = null;
      saslContexts.clear();
      physicalRef = makeLocalPhysicalEpoch(randomHex32());
      ownerRef = makeOwnerRef(randomRef())!;
      clientSafetyState=null;
      if(controlledRecovery&&recoveryTransfer&&sameOwnerSnapshot(recoveryTransfer.fromOwner,previous))
        recoveryTransfer={...recoveryTransfer,destinationOwner:snapshot()};
      retireMediaOwner(previous,snapshot(),true,false);
      workerTargets.clear();workerActivations.clear();pushConsentRefs.clear();
      learnedPrefix = null;
      tentativeServerPrefix = null;
      pendingAccountProof = null;
      currentNick = null;
      caseMapping = null;
      advertisedVapidKey=null;
      mappingGeneration += 1;
      metrics.start({ contextRef: ownerRef });
      advertisedCapabilities.clear();
      negotiatedCapabilities.clear();
      capabilityValues.clear();statusMessagePrefixes.clear();freshGenesisProofs.clear();freshGenesisReservations.clear();
      clearCapabilityStage();capabilityInventoryPoisoned=false;
      featureRounds.clear();
      activeFeatureRoundRef = null;
      pendingFeatureReadiness = null;
      pendingNewCapabilities.clear();
      currentUrl = url;
      pushLifecycle?.onNodeChange(snapshot());
      featureReady = { e2ee: false, media: false };
      publishFeatureReadiness();
      physicalStarted = true;
      const admission=transport.connect(url);
      if(admission.kind==='blocked')physicalStarted=false;
      return admission;
    },
    sendLine(line: string): SendAdmission {
      if (disposed || disposingRuntime) return { kind: 'blocked', reason: 'owner-changed' };
      if(activationBarrier)return {kind:'blocked',reason:'policy'};
      if (!validateClientLine(line).valid) return { kind: 'blocked', reason: 'invalid-intent' };
      // SESSION is a private serialized command family. UI/raw sends cannot
      // bypass the resume, list/drop, reconciliation, or token-issuance lease.
      try {
        const parsed=parseIRCMessage(line);
        if(parsed.command.toUpperCase()==='SESSION')return {kind:'blocked',reason:'policy'};
        if(parsed.command.toUpperCase()==='MEDIA'&&['ROSTER','CONSENT','RECORD'].includes((parsed.params[0]??'').toUpperCase()))
          return {kind:'blocked',reason:'policy'};
      } catch { /* validator below remains authoritative */ }
      const requestId: RequestId | null = makeRequestId(randomRef());
      if (!requestId) return { kind: 'blocked', reason: 'invalid-intent' };
      const owner=snapshot();let webhookKey:string|null=null;let createOperationRef:string|null=null;let markerReservation:{key:string;request:PendingMarker}|null=null;
      try{
        const parsed=parseIRCMessage(line);
        if(parsed.command==='MARKREAD'&&negotiatedCapabilities.has('draft/read-marker')){
          markerReservation=reserveMarkerRequest(line,owner,requestId);
          if(!markerReservation)return {kind:'blocked',reason:'backpressure'};
        }
        if(parsed.command==='CREATE'&&parsed.params[0]){
          const target=makeConversationId(parsed.params[0]);if(!target)return {kind:'blocked',reason:'invalid-intent'};
          createOperationRef=facts?.noteCreateIntent({context:{owner},target,label:parsed.tags.label??randomRef()})??null;
          if(!createOperationRef)return {kind:'blocked',reason:'policy'};
        }
        if(parsed.command==='WEBHOOK'&&parsed.params[0]?.toUpperCase()==='CREATE'&&parsed.params[1]){
          const room=makeConversationId(parsed.params[1]);if(!room)return {kind:'blocked',reason:'invalid-intent'};
          const canonical=facts?.canonicalConversationKey(owner,room)??`${owner.networkId}:${room}`;webhookKey=`${owner.ownerRef}:${canonical}`;
          const prior=pendingWebhookCreates.get(webhookKey);if(prior&&prior.expiresAt>Date.now())return {kind:'blocked',reason:'backpressure'};
          pendingWebhookCreates.set(webhookKey,{owner,requestId,room,expiresAt:Date.now()+30_000});
          while(pendingWebhookCreates.size>32)pendingWebhookCreates.delete(pendingWebhookCreates.keys().next().value as string);
        }
      }catch{/* non-parseable lines continue through normal bounded transport validation */}
      const admission=transport.sendLine({ line, owner, requestId });
      if(markerReservation&&admission.kind!=='transport-admitted')pendingMarkerRequests.delete(markerReservation.key);
      if(webhookKey&&admission.kind==='blocked')pendingWebhookCreates.delete(webhookKey);
      if(createOperationRef)facts?.observeCreateAdmission(createOperationRef,admission);
      return admission;
    },
    sendBinary(input:{readonly bytes:Uint8Array;readonly owner:OwnerSnapshot;readonly requestId?:string}):SendAdmission{
      const requestId=makeRequestId(input?.requestId??randomRef());
      if(disposed||disposingRuntime||!requestId||!(input?.bytes instanceof Uint8Array)||!isCurrent(input.owner))return {kind:'blocked',reason:'owner-changed'};
      return transport.sendBinary({bytes:input.bytes,owner:input.owner,requestId});
    },
    privateIdentify(input: {readonly account:string;readonly password:string;readonly requestId:string;readonly ownerRef:string;readonly accountGeneration:number;readonly connectionGeneration:number}): SendAdmission {
      const owner=snapshot();
      const requestId=makeRequestId(input?.requestId);
      const account=typeof input?.account==='string'?input.account:'';
      const password=typeof input?.password==='string'?input.password:'';
      const passwordBytes=new TextEncoder().encode(password);
      let malformedSurrogate=false;
      for(let i=0;i<password.length;i++){
        const code=password.charCodeAt(i);
        if(code>=0xd800&&code<=0xdbff){const next=password.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff)){malformedSurrogate=true;break;}i++;}
        else if(code>=0xdc00&&code<=0xdfff){malformedSurrogate=true;break;}
      }
      if(!requestId||input.ownerRef!==owner.ownerRef||input.accountGeneration!==Number(owner.accountGeneration)
        ||input.connectionGeneration!==Number(owner.connectionGeneration)||!isCurrent(owner)||!learnedPrefix
        ||!makeAccountId(account)||new TextEncoder().encode(account).byteLength>64||/[\s\u0000-\u001f\u007f]/u.test(account)
        ||passwordBytes.byteLength<8||passwordBytes.byteLength>512||/[\u0000-\u001f\u007f]/u.test(password)||malformedSurrogate){
        passwordBytes.fill(0);return {kind:'blocked',reason:'invalid-intent'};
      }
      for(const [priorId,pending] of pendingIdentify){if(pending.owner.ownerRef===owner.ownerRef){clearTimeout(pending.timer);pendingIdentify.delete(priorId);}}
      const line=formatIRCLine('IDENTIFY',account,password).replace(/\r\n$/u,'');
      passwordBytes.fill(0);
      const timer=setTimeout(()=>{const pending=pendingIdentify.get(requestId);if(pending?.owner.ownerRef===owner.ownerRef)pendingIdentify.delete(requestId);},45_000);
      pendingIdentify.set(requestId,{owner,requestId,account:account.replace(/[A-Z]/gu,c=>c.toLowerCase()),timer});
      while(pendingIdentify.size>16){const oldest=pendingIdentify.keys().next().value as string|undefined;if(!oldest)break;const pending=pendingIdentify.get(oldest);if(pending)clearTimeout(pending.timer);pendingIdentify.delete(oldest);}
      const admission=transport.sendLine({line,owner,requestId});
      if(admission.kind==='blocked'){const pending=pendingIdentify.get(requestId);if(pending)clearTimeout(pending.timer);pendingIdentify.delete(requestId);}
      return admission;
    },
    captureSaslContext(): string | null {
      const owner = snapshot();
      if (!isCurrent(owner)) return null;
      const ref = randomRef();
      if (!makeRequestId(ref)) return null;
      while (saslContexts.size >= 8) saslContexts.delete(saslContexts.keys().next().value as string);
      saslContexts.set(ref, owner);
      return ref;
    },
    isSaslContextCurrent(context: string): boolean {
      const owner = saslContexts.get(context);
      return !!owner && isCurrent(owner);
    },
    clearSaslContext(context: string): void { saslContexts.delete(context); },
    sendSaslPayload(payload: string, context: string): SendAdmission { return runtimeSendSaslPayload(payload,context); },
    isOpen(): boolean { return transport.isOpen(); },
    issueCredentialBundle(): Promise<SendAdmission> { return guardedCredentialOperation(owner=>startCredentialIssuance(owner),true); },
    resumeCredential(ref: CredentialRef): Promise<SendAdmission> {
      const owner=snapshot();const requestId=makeRequestId(randomRef());
      if(!requestId||!recoveryController)return Promise.resolve({kind:'blocked',reason:'invalid-intent'});
      return recoveryController.begin({context:{schemaVersion:1,requestId,owner},credentialRef:ref});
    },
    forgetCredential(ref: CredentialRef): boolean { return credentials.forget(snapshot(), ref); },
    setCredentialRemembered(remember: boolean): boolean { return credentials.setRememberConsent(snapshot(), remember); },
    /** Private service composition only; no Elm port accepts readiness claims. */
    setFeatureReadiness(input: { readonly owner: OwnerSnapshot; readonly e2ee: boolean; readonly media: boolean }): boolean {
      if (!isCurrent(input.owner) || typeof input.e2ee !== 'boolean' || typeof input.media !== 'boolean') return false;
      if (featureReady.e2ee === input.e2ee && featureReady.media === input.media) return true;
      featureReady = { e2ee: input.e2ee, media: input.media };
      publishFeatureReadiness();
      return true;
    },
    requestCapabilityGroup(input: { readonly roundRef: string; readonly names: readonly string[] }): SendAdmission {
      const round = featureRounds.get(input.roundRef);
      if (!round || round.ended || round.emittedRequest || activeFeatureRoundRef !== input.roundRef || !isCurrent(round.owner)) return { kind: 'blocked', reason: 'owner-changed' };
      if (!Array.isArray(input.names) || input.names.length < 1 || input.names.length > 48) return { kind: 'blocked', reason: 'invalid-intent' };
      const names = [...new Set(input.names)];
      if (names.length !== input.names.length || names.some(name => !RUNTIME_CAPS.has(name) || round.requested.has(name) || !advertisedCapabilities.has(name)
        || (name === 'onyx/e2ee' && !round.e2ee) || (name === 'onyx/media' && !round.media)
        || (name !== 'onyx/e2ee' && name !== 'onyx/media' && !round.newCapabilities.includes(name)))) return { kind: 'blocked', reason: 'policy' };
      if (new TextEncoder().encode(`CAP REQ :${names.join(' ')}`).byteLength > 400) return { kind: 'blocked', reason: 'invalid-intent' };
      const requestId = makeRequestId(randomRef());
      if (!requestId) return { kind: 'blocked', reason: 'invalid-intent' };
      names.forEach(name => { round.requested.add(name); round.unresolved.add(name); });
      round.emittedRequest = true;
      const admission = transport.sendLine({ line: `CAP REQ :${names.join(' ')}`, owner: round.owner, requestId });
      if (admission.kind === 'blocked') {
        names.forEach(name => { round.requested.delete(name); round.unresolved.delete(name); });
        names.filter(name => name !== 'onyx/e2ee' && name !== 'onyx/media').forEach(name => pendingNewCapabilities.delete(name));
        round.emittedRequest = round.requested.size > 0;
      }
      return admission;
    },
    endCapabilityRound(roundRef: string): SendAdmission {
      const round = featureRounds.get(roundRef);
      if (!round || round.ended || activeFeatureRoundRef !== roundRef || round.unresolved.size > 0) return { kind: 'blocked', reason: 'policy' };
      const currentOwner = snapshot();
      if (currentOwner.networkId !== round.owner.networkId || currentOwner.connectionGeneration !== round.owner.connectionGeneration || currentOwner.physicalRef !== round.owner.physicalRef) return { kind: 'blocked', reason: 'owner-changed' };
      if (!round.emittedRequest) {
        round.ended = true;
        advanceFeatureRound(roundRef);
        return { kind: 'transport-admitted' };
      }
      const requestId = makeRequestId(randomRef());
      if (!requestId) return { kind: 'blocked', reason: 'invalid-intent' };
      const admission = transport.sendLine({ line: 'CAP END', owner: currentOwner, requestId });
      if (admission.kind === 'transport-admitted') {
        round.ended = true;
        advanceFeatureRound(roundRef);
      } else if (admission.kind === 'unknown') {
        transport.close();
      }
      return admission;
    },
    close(): void { retirePhysicalOwner(snapshot(),true); },
    metricSnapshot: () => metrics.snapshot(),
    dispose(): void { if (disposed || disposingRuntime) return;disposingRuntime=true;flushPublicIngress(snapshot());publicIngressBatcher?.dispose();retireNotificationClaims(snapshot());config.browserPlatform?.dispose();clearCapabilityStage();recoveryController?.dispose();recoveryTransfer=null;recoveryViews.clear();recoveryLegacyIntentKeys.clear();recoveryIssuanceKeys.clear();passkeyManagement?.dispose();for(const pending of pendingWebAuthn.values())clearPendingWebAuthn(pending);webAuthn?.dispose();sessionMeshControl?.dispose();accountCommunity?.dispose();integrationOperations?.dispose();integrationIngress?.dispose();clearPrivateOutHookPresentations();sessionOperations?.dispose();stopScheduledDuePump();abortPendingContinuations();pendingMarkerRequests.clear();markerProofs.clear();pendingAcceptanceProofs.clear();pendingWebAuthn.clear();clearWebhookPresentationForOwner();clearPrivateScheduledMessages();disposed = true;retireVaultPumpsForOwner(); captureBroker.dispose(); captureIntentRefs.clear(); captureListeners.clear(); mediaDomainUnsub();mediaControlUnsub();integrationStatusSubscription?.();mediaIngress.dispose();sessionControlIngress.dispose();accountCommunityIngress.dispose();joinedTargetIngress.dispose();acceptanceIngress.dispose();markerIngress.dispose();groupIngress.dispose();webhookIngress.dispose();accountSecurityIngress.dispose();continuationIngress.dispose();webAuthnIngress.dispose();for(const element of mediaElements.values())if(element.srcObject)element.srcObject=null;mediaElements.clear();mediaPreviewRefs.clear();mediaEngine.dispose();cadenceTransport.dispose();captions.dispose();webRtc.dispose();webTransport?.dispose();privateAccountSecurity?.dispose();privateCrypto.dispose();acceptance.dispose();memorySend?.dispose();scheduledCustody?.dispose();ownedStorage.dispose();drafts.dispose();journal.dispose();anchors.dispose();settings.dispose();backupStorage.dispose();notificationBindingRefs.clear();notificationRouteRefs.clear();notificationNavigationClaims.clear();serviceWorkerContainer?.removeEventListener('message',serviceWorkerMessages); notificationRouter?.dispose(); clearPrivateFiles(); operatorImport.dispose(); localWorkspaces.dispose(); facts?.dispose(); tabIntents.dispose(); workerLifecycle?.dispose();pushLifecycle?.dispose();pushReplies.dispose();browserLifecycleSubscription();browserLifecycle.dispose();metrics.dispose(); saslContexts.clear(); transport.dispose(); credentials.dispose(); identity.dispose(); learnedPrefix = null; tentativeServerPrefix = null; currentNick = null; caseMapping = null; mappingGeneration += 1; pendingAccountProof = null; featureRounds.clear(); activeFeatureRoundRef = null; pendingFeatureReadiness = null; pendingNewCapabilities.clear();storageSelections.clear();groupPlanRefs.clear();joinedTargetsByPhysical.clear(); for (const listener of [...disposeListeners]) { try { listener(); } catch { /* cleanup isolated */ } } disposeListeners.clear(); domainListeners.clear();sessionTokenSaslListeners.clear(); requestCache.clear(); },
  });
  runtimeConnect=api.connect;
  publishFeatureReadiness();
  return api;
}
