/** Bounded volatile fallback for an explicitly submitted plaintext PRIVMSG.
 * It never flushes on reconnect and never persists message bodies. The
 * authenticated planner/acceptance registry own wire construction and proof.
 */
import type { ConversationId, MessageId, OwnerSnapshot, RequestContext, RequestId, SendAdmission } from './contracts';
import { makeMessageId, makeRequestId } from './contracts';

export type MemorySendStatus = 'prepared' | 'transport-admitted' | 'server-accepted' | 'delivery-unknown' | 'blocked' | 'intent-conflict' | 'stale-owner';
export type MemorySendPolicy = {
  readonly owner: OwnerSnapshot;
  readonly targetKind: 'channel' | 'dm';
  readonly networkReady: boolean;
  readonly encryption: 'plain' | 'dm-required' | 'room-required' | 'unknown';
  readonly policyRevision: string;
  readonly mappingRevision: string;
  readonly policyGeneration: number;
  readonly channelMembership: 'joined' | 'not-joined' | 'unknown' | 'not-applicable';
  readonly canSend: boolean | 'unknown';
};
export type MemoryChatIntent = {
  readonly operation: 'privmsg';
  readonly clientIntentId: RequestId;
  readonly conversationId: ConversationId;
  readonly targetKey: string;
  readonly messageKind: 'message' | 'action';
  readonly replyTo: MessageId | null;
  readonly audiencePrefix: string | null;
  readonly body: Uint8Array;
};
export type MemoryLivePlan = {
  readonly lines: readonly string[];
  readonly validationReceipt: symbol;
  readonly planHash: string;
};
export type MemorySendSummary = {
  readonly recordId: string;
  readonly clientIntentId: RequestId;
  readonly conversationId: ConversationId;
  readonly messageKind: 'message' | 'action';
  readonly replyTo: MessageId | null;
  readonly audiencePrefix: string | null;
  readonly status: MemorySendStatus;
  readonly durability: 'volatile';
};
export type MemorySendResult = MemorySendSummary & { readonly reason: 'offline' | 'policy' | 'invalid' | 'capacity' | 'stale-owner' | 'intent-conflict' | 'delivery-unknown' | null };
export interface MemorySendOwnerDeps {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly isRegistered: (owner: OwnerSnapshot) => boolean;
  readonly policySnapshot: (owner: OwnerSnapshot, intent: MemoryChatIntent) => MemorySendPolicy | null;
  readonly prepareLivePlan: (input: { readonly context: RequestContext; readonly recordId: string; readonly claimNonce: string; readonly intent: Omit<MemoryChatIntent, 'body'> & { readonly body: Uint8Array } }) => Promise<MemoryLivePlan | null>;
  readonly validatePreparedPlan: (input: { readonly context: RequestContext; readonly recordId: string; readonly intent: MemoryChatIntent; readonly policy: MemorySendPolicy; readonly plan: MemoryLivePlan }) => boolean;
  /** Must register the private acceptance attempt before synchronously admitting lines. */
  readonly sendLineGroup: (input: { readonly context: RequestContext; readonly recordId: string; readonly claimNonce: string; readonly intent: MemoryChatIntent; readonly policy: MemorySendPolicy; readonly plan: MemoryLivePlan }) => readonly SendAdmission[];
  readonly verifyAcceptanceProof: (proofRef: symbol, context: RequestContext, recordId: string, clientIntentId: RequestId) => boolean;
  readonly onObservation: (result: MemorySendResult) => void;
  readonly now: () => number;
}

const MAX_ACTIVE = 32;
const MAX_SUMMARIES = 128;
const MAX_BODY_BYTES = 65_536;
const MAX_OWNER_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 1024;
const MAX_PLAN_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function ownerKey(owner: OwnerSnapshot): string {
  return JSON.stringify([owner.networkId, owner.accountId, owner.physicalRef, owner.accountGeneration, owner.connectionGeneration, owner.ownerRef]);
}
function newId(): string { return [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function validBody(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES) return false;
  try {
    const text = decoder.decode(bytes);
    if (!text || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text)) return false;
    const encoded = encoder.encode(text); const valid = encoded.length === bytes.length && encoded.every((value, index) => value === bytes[index]); encoded.fill(0);
    return valid;
  } catch { return false; }
}
function validIntent(intent: MemoryChatIntent): boolean {
  return !!intent && intent.operation === 'privmsg' && !!makeRequestId(intent.clientIntentId)
    && typeof intent.conversationId === 'string' && intent.conversationId.length > 0 && intent.conversationId.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(intent.conversationId)
    && typeof intent.targetKey === 'string' && intent.targetKey.length > 0 && intent.targetKey.length <= 512
    && !/[\u0000-\u001f\u007f]/u.test(intent.targetKey)
    && (intent.messageKind === 'message' || intent.messageKind === 'action')
    && (intent.replyTo === null || !!makeMessageId(intent.replyTo))
    && (intent.audiencePrefix === null || /^[!-~]$/u.test(intent.audiencePrefix))
    && validBody(intent.body);
}
function intentMetadata(intent: MemoryChatIntent): string {
  return JSON.stringify([2, intent.operation, intent.conversationId, intent.targetKey, intent.messageKind, intent.replyTo, intent.audiencePrefix, intent.body.byteLength]);
}
async function semanticDigest(intent: MemoryChatIntent): Promise<Uint8Array> {
  const metadata = encoder.encode(intentMetadata(intent)); const bytes = new Uint8Array(metadata.length + intent.body.length);
  bytes.set(metadata); bytes.set(intent.body, metadata.length);
  try { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
  finally { metadata.fill(0); bytes.fill(0); }
}
function sameDigest(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!; return diff === 0;
}
function safePolicy(policy: MemorySendPolicy | null, owner: OwnerSnapshot): policy is MemorySendPolicy {
  return !!policy && sameOwner(policy.owner, owner) && policy.networkReady && policy.encryption === 'plain'
    && policy.canSend === true && typeof policy.policyRevision === 'string' && policy.policyRevision.length > 0
    && policy.policyRevision.length <= 2048 && typeof policy.mappingRevision === 'string' && policy.mappingRevision.length > 0
    && policy.mappingRevision.length <= 128 && Number.isSafeInteger(policy.policyGeneration)
    && (policy.targetKind === 'channel' ? policy.channelMembership === 'joined' : policy.targetKind === 'dm' && policy.channelMembership === 'not-applicable');
}

export function createMemorySendOwner(deps: MemorySendOwnerDeps) {
  type Entry = { readonly recordId: string; readonly claimNonce: string; readonly owner: OwnerSnapshot; readonly context: RequestContext;
    readonly intent: Omit<MemoryChatIntent, 'body'> & { readonly body: Uint8Array | null }; readonly metadata: string;
    digest: Uint8Array | null; status: MemorySendStatus; reason: MemorySendResult['reason']; createdAt: number; admissionInProgress: boolean };
  type Bucket = { entries: Map<string, Entry>; byIntent: Map<string, Entry>; bodyBytes: number };
  const owners = new Map<string, Bucket>();
  let disposed = false;
  const bucketFor = (owner: OwnerSnapshot): Bucket => {
    const key = ownerKey(owner); let bucket = owners.get(key);
    if (!bucket) { bucket = { entries: new Map(), byIntent: new Map(), bodyBytes: 0 }; owners.set(key, bucket); }
    return bucket;
  };
  const current = (context: RequestContext): boolean => !disposed && !!context && context.schemaVersion === 1
    && !!makeRequestId(context.requestId) && !!context.owner && sameOwner(context.owner, deps.ownerSnapshot()) && deps.isCurrent(context.owner);
  const entryCurrent = (bucket: Bucket, entry: Entry): boolean => current(entry.context)
    && owners.get(ownerKey(entry.owner)) === bucket && bucket.entries.get(entry.recordId) === entry;
  const result = (entry: Entry): MemorySendResult => ({ recordId: entry.recordId, clientIntentId: entry.intent.clientIntentId,
    conversationId: entry.intent.conversationId, messageKind: entry.intent.messageKind, replyTo: entry.intent.replyTo,
    audiencePrefix: entry.intent.audiencePrefix, status: entry.status, durability: 'volatile', reason: entry.reason });
  const staleResult = (entry: Entry): MemorySendResult => ({ ...result(entry), status: 'stale-owner', reason: 'stale-owner' });
  function publish(entry: Entry): MemorySendResult {
    const value = result(entry); try { deps.onObservation(value); } catch { /* observer cannot change delivery truth */ } return value;
  }
  function releaseBody(bucket: Bucket, entry: Entry): void {
    const body = entry.intent.body;
    if (body) { bucket.bodyBytes = Math.max(0, bucket.bodyBytes - body.length); body.fill(0); (entry.intent as { body: Uint8Array | null }).body = null; }
  }
  function prune(bucket: Bucket): void {
    while (bucket.entries.size > MAX_SUMMARIES) {
      const terminal = [...bucket.entries.values()].find((entry) => entry.status !== 'prepared'
        && entry.status !== 'transport-admitted' && entry.status !== 'delivery-unknown');
      if (!terminal) return;
      bucket.entries.delete(terminal.recordId); bucket.byIntent.delete(terminal.intent.clientIntentId); terminal.digest?.fill(0);
    }
  }
  function policyCurrent(context: RequestContext, intent: MemoryChatIntent, captured: MemorySendPolicy): boolean {
    if (!current(context) || !deps.isRegistered(context.owner)) return false;
    const fresh = deps.policySnapshot(context.owner, intent);
    return safePolicy(fresh, context.owner) && fresh.policyRevision === captured.policyRevision
      && fresh.mappingRevision === captured.mappingRevision && fresh.policyGeneration === captured.policyGeneration
      && fresh.targetKind === captured.targetKind && fresh.channelMembership === captured.channelMembership;
  }
  return {
    async submit(input: { readonly context: RequestContext; readonly intent: MemoryChatIntent }): Promise<MemorySendResult> {
      const { context, intent } = input;
      if (!current(context) || !context.owner.physicalRef || !deps.isRegistered(context.owner)) {
        return { recordId: '', clientIntentId: intent?.clientIntentId ?? '' as RequestId, conversationId: intent?.conversationId ?? '' as ConversationId,
          messageKind: intent?.messageKind ?? 'message', replyTo: intent?.replyTo ?? null, audiencePrefix: intent?.audiencePrefix ?? null,
          status: 'stale-owner', durability: 'volatile', reason: 'stale-owner' };
      }
      if (!validIntent(intent)) return { recordId: '', clientIntentId: intent?.clientIntentId ?? '' as RequestId, conversationId: intent?.conversationId ?? '' as ConversationId,
        messageKind: intent?.messageKind ?? 'message', replyTo: intent?.replyTo ?? null, audiencePrefix: intent?.audiencePrefix ?? null,
        status: 'blocked', durability: 'volatile', reason: 'invalid' };
      const bucket = bucketFor(context.owner); const metadata = intentMetadata(intent); const previous = bucket.byIntent.get(intent.clientIntentId);
      if (previous) {
        let digest: Uint8Array;
        try { digest = await semanticDigest(intent); }
        catch { return current(context) && bucket.entries.get(previous.recordId) === previous ? publish(previous) : staleResult(previous); }
        if (!current(context) || bucket.entries.get(previous.recordId) !== previous) {
          digest.fill(0);
          return { ...result(previous), status: 'stale-owner', reason: 'stale-owner' };
        }
        const matches = previous.metadata === metadata && (sameDigest(previous.digest, digest)
          || previous.intent.body !== null && previous.intent.body.length === intent.body.length && previous.intent.body.every((value, index) => value === intent.body[index]));
        digest.fill(0);
        return matches ? publish(previous) : { ...result(previous), status: 'intent-conflict', reason: 'intent-conflict' };
      }
      const activeCount = [...bucket.entries.values()].filter((entry) => entry.status === 'prepared' || entry.status === 'transport-admitted' || entry.status === 'delivery-unknown').length;
      if (activeCount >= MAX_ACTIVE || bucket.bodyBytes + intent.body.byteLength > MAX_OWNER_BODY_BYTES) {
        return { recordId: '', clientIntentId: intent.clientIntentId, conversationId: intent.conversationId, messageKind: intent.messageKind,
          replyTo: intent.replyTo, audiencePrefix: intent.audiencePrefix, status: 'blocked', durability: 'volatile', reason: 'capacity' };
      }
      const body = intent.body.slice(); const snapshot = { ...intent, body };
      const entry: Entry = { recordId: newId(), claimNonce: newId(), owner: Object.freeze({ ...context.owner }),
        context: Object.freeze({ ...context, owner: Object.freeze({ ...context.owner }) }), intent: snapshot, metadata,
        digest: null, status: 'prepared', reason: null, createdAt: deps.now(), admissionInProgress: false };
      // Claim and dedupe before the first await or any possible wire bytes.
      bucket.entries.set(entry.recordId, entry); bucket.byIntent.set(intent.clientIntentId, entry); bucket.bodyBytes += body.length;
      let plan: MemoryLivePlan | null = null;
      let admissionAttempted = false;
      try {
        const digest = await semanticDigest(snapshot as MemoryChatIntent);
        if (!entryCurrent(bucket, entry) || !sameOwner(entry.owner, context.owner)) {
          digest.fill(0); entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry);
        }
        entry.digest = digest;
        const policy = deps.policySnapshot(context.owner, snapshot as MemoryChatIntent);
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        if (!policy) { entry.status = 'blocked'; entry.reason = 'offline'; releaseBody(bucket, entry); return publish(entry); }
        const policyNetworkReady = policy.networkReady;
        if (!safePolicy(policy, context.owner)) {
          entry.status = 'blocked'; entry.reason = policyNetworkReady ? 'policy' : 'offline'; releaseBody(bucket, entry); return publish(entry);
        }
        plan = await deps.prepareLivePlan({ context, recordId: entry.recordId, claimNonce: entry.claimNonce, intent: snapshot as MemoryChatIntent });
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        if (!plan) {
          entry.status = current(context) ? 'blocked' : 'stale-owner'; entry.reason = current(context) ? 'policy' : 'stale-owner'; releaseBody(bucket, entry); return publish(entry);
        }
        const policyReady = policyCurrent(context, snapshot as MemoryChatIntent, policy);
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        const planReady = policyReady && deps.validatePreparedPlan({ context, recordId: entry.recordId, intent: snapshot as MemoryChatIntent, policy, plan });
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        if (!planReady) { entry.status = 'blocked'; entry.reason = 'policy'; releaseBody(bucket, entry); return publish(entry); }
        const lines = [...plan.lines]; let planBytes = 0;
        for (const line of lines) { const bytes = encoder.encode(line); planBytes += bytes.byteLength; bytes.fill(0); }
        if (typeof plan.validationReceipt !== 'symbol' || !/^[a-f0-9]{64}$/u.test(plan.planHash)
          || lines.length < 1 || lines.length > MAX_LINES || planBytes > MAX_PLAN_BYTES
          || lines.some((line) => !line || /[\r\n\u0000]/u.test(line))) {
          entry.status = 'blocked'; entry.reason = 'invalid'; releaseBody(bucket, entry); return publish(entry);
        }
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        const dispatchPolicyReady = policyCurrent(context, snapshot as MemoryChatIntent, policy);
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        const dispatchPlanReady = dispatchPolicyReady && deps.validatePreparedPlan({ context, recordId: entry.recordId, intent: snapshot as MemoryChatIntent, policy, plan });
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        if (!dispatchPlanReady) {
          entry.status = 'blocked'; entry.reason = 'policy'; releaseBody(bucket, entry); return publish(entry);
        }
        let admissions: readonly SendAdmission[];
        admissionAttempted = true;
        entry.admissionInProgress = true;
        try { admissions = deps.sendLineGroup({ context, recordId: entry.recordId, claimNonce: entry.claimNonce,
          intent: snapshot as MemoryChatIntent, policy, plan: { ...plan, lines } }); }
        catch { admissions = [{ kind: 'unknown', reason: 'transport-error' }]; }
        finally { entry.admissionInProgress = false; }
        if (!entryCurrent(bucket, entry)) {
          entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry);
        }
        // A synchronous acceptance event may arrive from inside the fenced
        // group sender. Its private receipt is stronger evidence than the
        // transport callback's return value and must remain monotonic.
        if (entry.status === 'server-accepted') return publish(entry);
        const admitted = admissions.filter((value) => value.kind === 'transport-admitted').length;
        const unknown = admissions.some((value) => value.kind === 'unknown');
        const blocked = admissions.some((value) => value.kind === 'blocked');
        if (admissions.length !== lines.length || unknown || admitted > 0 && (blocked || admitted !== lines.length)) {
          entry.status = 'delivery-unknown'; entry.reason = 'delivery-unknown'; releaseBody(bucket, entry); return publish(entry);
        }
        if (admitted === lines.length && lines.length > 0) {
          entry.status = 'transport-admitted'; entry.reason = null; releaseBody(bucket, entry); return publish(entry);
        }
        const firstBlocked = admissions.find((value): value is Extract<SendAdmission, { kind: 'blocked' }> => value.kind === 'blocked');
        entry.status = 'blocked'; entry.reason = firstBlocked?.reason === 'owner-changed' ? 'stale-owner'
          : firstBlocked?.reason === 'invalid-intent' ? 'invalid' : firstBlocked?.reason === 'policy' ? 'policy' : 'offline';
        if (entry.reason === 'stale-owner') entry.status = 'stale-owner';
        releaseBody(bucket, entry); return publish(entry);
      } catch {
        if (!entryCurrent(bucket, entry)) { entry.status = 'stale-owner'; entry.reason = 'stale-owner'; releaseBody(bucket, entry); return staleResult(entry); }
        entry.status = admissionAttempted ? 'delivery-unknown' : 'blocked';
        entry.reason = admissionAttempted ? 'delivery-unknown' : 'policy'; releaseBody(bucket, entry); return publish(entry);
      } finally {
        prune(bucket);
      }
    },
    async reconcileAccepted(input: { readonly context: RequestContext; readonly recordId: string; readonly proofRef: symbol }): Promise<MemorySendResult> {
      const bucket = owners.get(ownerKey(input.context.owner)); const entry = bucket?.entries.get(input.recordId);
      if (!entry) return { recordId: input.recordId, clientIntentId: '' as RequestId, conversationId: '' as ConversationId,
        messageKind: 'message', replyTo: null, audiencePrefix: null, status: 'blocked', durability: 'volatile', reason: 'invalid' };
      if (!bucket || !entryCurrent(bucket, entry) || !sameOwner(entry.owner, input.context.owner)) return staleResult(entry);
      if (entry.status === 'server-accepted') return publish(entry);
      if (entry.status !== 'transport-admitted' && entry.status !== 'delivery-unknown'
        && !(entry.status === 'prepared' && entry.admissionInProgress)) return publish(entry);
      try { if (!deps.verifyAcceptanceProof(input.proofRef, input.context, entry.recordId, entry.intent.clientIntentId)) return entryCurrent(bucket, entry) ? publish(entry) : staleResult(entry); }
      catch { return entryCurrent(bucket, entry) ? publish(entry) : staleResult(entry); }
      if (!entryCurrent(bucket, entry)) return staleResult(entry);
      if (!current(input.context)) { entry.status = 'delivery-unknown'; entry.reason = 'delivery-unknown'; return publish(entry); }
      entry.status = 'server-accepted'; entry.reason = null;
      if (bucket) releaseBody(bucket, entry);
      return publish(entry);
    },
    inspect(context: RequestContext): readonly MemorySendSummary[] {
      if (!current(context)) return [];
      const bucket = owners.get(ownerKey(context.owner));
      return bucket ? [...bucket.entries.values()].map(({ recordId, intent, status }) => ({ recordId,
        clientIntentId: intent.clientIntentId, conversationId: intent.conversationId, messageKind: intent.messageKind,
        replyTo: intent.replyTo, audiencePrefix: intent.audiencePrefix, status, durability: 'volatile' as const })) : [];
    },
    retireOwner(owner: OwnerSnapshot): void {
      const key = ownerKey(owner); const bucket = owners.get(key); if (!bucket) return;
      for (const entry of bucket.entries.values()) { releaseBody(bucket, entry); entry.digest?.fill(0); }
      bucket.entries.clear(); bucket.byIntent.clear(); owners.delete(key);
    },
    dispose(): void {
      if (disposed) return; disposed = true;
      for (const bucket of owners.values()) for (const entry of bucket.entries.values()) { releaseBody(bucket, entry); entry.digest?.fill(0); }
      owners.clear();
    },
  };
}
