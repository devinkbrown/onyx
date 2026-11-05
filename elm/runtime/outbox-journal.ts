import {
  makeAccountId,
  makeConversationId,
  makeMessageId,
  type AccountId,
  type OwnerSnapshot,
  type RequestContext,
  type SendAdmission,
  type Transport,
} from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import type { ScheduledPolicySnapshot } from './scheduled-custody';
import { OWNED_OUTBOX, openVaultV5, requestPromise, transactionPromise } from './migrations';

export type QueueIntent = RequestContext & { readonly clientIntentId: RequestContext['requestId'] } & (
  | { readonly operation: 'privmsg'; readonly conversationId: string; readonly body: string; readonly replyTo?: string | null; readonly messageKind?: 'message' | 'action'; readonly audiencePrefix?: string | null }
  | { readonly operation: 'memo-send'; readonly recipientAccount: AccountId; readonly body: string; readonly replyTo?: null; readonly messageKind?: 'message'; readonly audiencePrefix?: null }
);
export type ScheduledQueueIntent = RequestContext & { readonly clientIntentId: RequestContext['requestId']; readonly operation: 'privmsg';
  readonly conversationId: string; readonly body: string; readonly replyTo?: string | null; readonly messageKind?: 'message' | 'action';
  readonly audiencePrefix?: string | null; readonly capturedPolicy: ScheduledPolicySnapshot };
export type QueueProjectionIntent = RequestContext & { readonly clientIntentId: RequestContext['requestId']; readonly capturedPolicy?: ScheduledPolicySnapshot } & (
  | { readonly operation: 'privmsg'; readonly conversationId: string; readonly body: string; readonly replyTo?: string | null; readonly messageKind?: 'message' | 'action'; readonly audiencePrefix?: string | null }
  | { readonly operation: 'memo-send'; readonly recipientAccount: AccountId; readonly body: string; readonly replyTo?: null; readonly messageKind?: 'message'; readonly audiencePrefix?: null }
);
export type QueueResult = { readonly schemaVersion: 1; readonly requestId: RequestContext['requestId']; readonly owner: OwnerSnapshot; readonly status: 'queued' | 'existing' | 'intent-conflict' | 'memory-only' | 'stale-owner' | 'blocked' | 'invalid' | 'quota' | 'unavailable'; readonly recordId: string | null };
export type FlushStatus = 'idle' | 'transport-admitted' | 'delivery-unknown' | 'blocked' | 'stale-owner' | 'unavailable';
export interface OutboxPolicy {
  readonly ownerProven: boolean;
  readonly policyGeneration: number;
  readonly channelMembership: 'joined' | 'not-joined' | 'unknown';
  readonly encryption: 'plain' | 'dm-required' | 'room-required' | 'unknown';
  readonly canSend: boolean | 'unknown';
  readonly networkReady: boolean;
  readonly offlineMemoAllowed: boolean;
}
export type DurableQueuedPayload =
  | { readonly kind: 'sealed-local-plaintext'; readonly ciphertext: Uint8Array; readonly payloadCommitment: string }
  | { readonly kind: 'verified-wire-ciphertext'; readonly wireBody: string; readonly payloadCommitment: string; readonly epochRef: string };
export type QueueProjection =
  | { readonly kind: 'ready'; readonly payload: DurableQueuedPayload; readonly policyRevision: string }
  | { readonly kind: 'memory-only' | 'blocked'; readonly reason: 'local-key-unavailable' | 'unsafe-policy' | 'invalid-payload' | 'stale-owner' };
export type PreparedDispatch =
  | { readonly kind: 'ready'; readonly lines: readonly string[]; readonly validationReceipt: string }
  | { readonly kind: 'held'; readonly reason: 'offline' | 'not-joined' | 'policy-changed' | 'reseal-required' | 'owner-changed' }
  | { readonly kind: 'review-needed'; readonly reason: 'offline' | 'not-joined' | 'policy-changed' | 'reseal-required' | 'owner-changed' };
export interface OwnedMemoIntent extends RequestContext { readonly operation: 'memo-send'; readonly clientIntentId: RequestContext['requestId']; readonly recipientAccount: AccountId; readonly body: string }
export interface OutboxJournalDependencies {
  readonly indexedDB?: IDBFactory;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly transport: Pick<Transport, 'sendLineGroup'>;
  readonly policySnapshot: (intent: QueueProjectionIntent, ticket: LocalNamespaceTicket, target: string) => OutboxPolicy;
  readonly canonicalConversationKey: (owner: OwnerSnapshot, target: string, ticket: LocalNamespaceTicket) => string | null;
  readonly prepareQueuedPayload: (intent: QueueProjectionIntent, ticket: LocalNamespaceTicket) => Promise<QueueProjection>;
  /** Trusted current snapshot used only by the internal scheduled-message enqueue path. */
  readonly scheduledPolicySnapshot?: (request: RequestContext, ticket: LocalNamespaceTicket, target: string, targetKey: string) => ScheduledPolicySnapshot | null;
  readonly prepareDispatch: (row: Readonly<JournalRow>, request: RequestContext, ticket: LocalNamespaceTicket) => Promise<PreparedDispatch>;
  readonly validatePreparedDispatch: (row: Readonly<JournalRow>, request: RequestContext, ticket: LocalNamespaceTicket, prepared: Extract<PreparedDispatch, { readonly kind: 'ready' }>) => boolean;
  readonly withDispatchGroup: <T>(request: RequestContext, ticket: LocalNamespaceTicket, run: () => Promise<T>) => Promise<T | null>;
  readonly memoCorrelationClear: (request: RequestContext, ticket: LocalNamespaceTicket) => boolean;
  readonly verifyAcceptanceProof: (proofRef: symbol, request: RequestContext & { readonly recordId: string }, row: Readonly<JournalRow>) => boolean;
  readonly observeAcceptanceAdmission?: (input: { readonly recordId: string; readonly claimNonce: string; readonly planHash: string; readonly kind: 'transport-admitted' | 'blocked' | 'unknown' }) => void;
  readonly acceptanceProofCommitted?: (proofRef: symbol) => void;
  readonly randomId?: () => string;
  readonly now?: () => number;
  readonly measureIdb?: (event: { readonly kind: 'read' | 'write'; readonly durationMs: number; readonly outcome: 'success' | 'failure'; readonly requestId?: string }) => void;
}
export interface JournalRow {
  readonly id: string;
  readonly ownerKey: string;
  readonly ownerAccountGeneration: number;
  readonly ownerConnectionGeneration: number;
  readonly clientIntentId: string;
  readonly retryOfRecordId: string | null;
  readonly operation: 'privmsg' | 'memo-send';
  readonly target: string;
  readonly targetKey: string;
  readonly payload: DurableQueuedPayload;
  readonly policyRevision: string;
  readonly queuedAt: number;
  readonly expiresAt: number;
  readonly state: 'queued' | 'queued-held' | 'dispatching' | 'transport-admitted' | 'server-accepted' | 'delivery-unknown' | 'expired-review' | 'discarded';
  readonly claimNonce: string | null;
  readonly claimExpiresAt: number | null;
  readonly policyGeneration: number;
  readonly dispatchAttempt?: Readonly<{ readonly nonce: string; readonly planHash: string; readonly lineCount: number; readonly policyRevision: string; readonly mappingRevision: string | null; readonly startedAt: number }> | null;
}
export interface JournalSummary { readonly schemaVersion: 1; readonly owner: OwnerSnapshot; readonly status: 'ready' | 'stale-owner' | 'unavailable'; readonly queued: number; readonly dispatching: number; readonly admitted: number; readonly unknown: number; readonly expired: number }
export interface JournalEntrySummary { readonly recordId: string; readonly clientIntentId: string; readonly operation: 'privmsg' | 'memo-send'; readonly intent: 'chat' | 'memo'; readonly target: string; readonly conversationId: string | null; readonly state: JournalRow['state']; readonly queuedAt: number; readonly expiresAt: number }

const MAX_OWNER_ROWS = 100;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 65_536;
const MAX_RECORD_BYTES = 262_144;
const MAX_CIPHERTEXT_BYTES = 262_172;
const MAX_GROUP_LINES = 1024;
const MAX_GROUP_BYTES = 256 * 1024;
const MAX_WIRE_LINE_BYTES = 64 * 1024;
const clean = (value: string, max: number): boolean => value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const validRef = (value: string): boolean => /^[A-Za-z0-9_-]{22,128}$/u.test(value);
const encoder = new TextEncoder();
function safeBody(value: string): boolean {
  if (/[\u0000-\u0008\u000b-\u001f\u007f\r]/u.test(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  const bytes = encoder.encode(value).byteLength;
  return bytes <= MAX_BODY_BYTES && 1 + encoder.encode(JSON.stringify([1, 'privmsg', '', 'message', null, value])).byteLength <= MAX_RECORD_BYTES;
}
function canonicalRecordBytes(operation: QueueIntent['operation'], targetKey: string, messageKind: 'message' | 'action', replyTo: string | null, audiencePrefix: string | null, body: string): Uint8Array | null {
  if (!safeBody(body) || !clean(targetKey, 512) || (replyTo !== null && (!makeMessageId(replyTo) || !clean(replyTo, 512)))) return null;
  if (audiencePrefix !== null && (Array.from(audiencePrefix).length !== 1 || encoder.encode(audiencePrefix).byteLength > 4 || !clean(audiencePrefix, 4) || /[,:]/u.test(audiencePrefix))) return null;
  if (operation === 'memo-send' && (messageKind !== 'message' || replyTo !== null || audiencePrefix !== null)) return null;
  const bytes = encoder.encode(JSON.stringify([2, operation, targetKey, messageKind, replyTo, audiencePrefix, body]));
  return bytes.byteLength <= MAX_RECORD_BYTES ? bytes : null;
}
const echo = (owner: OwnerSnapshot): OwnerSnapshot => Object.freeze({ ...owner });
const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot): boolean => a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
function validJournalRow(value: unknown): value is JournalRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const keys = ['id','ownerKey','ownerAccountGeneration','ownerConnectionGeneration','clientIntentId','retryOfRecordId','operation','target','targetKey','payload','policyRevision','queuedAt','expiresAt','state','claimNonce','claimExpiresAt','policyGeneration','dispatchAttempt'];
  const legacyKeys = keys.filter((key) => key !== 'dispatchAttempt');
  if ((Object.keys(row).length !== keys.length && Object.keys(row).length !== legacyKeys.length) || Object.keys(row).some((key) => !keys.includes(key))) return false;
  const payload = row.payload as DurableQueuedPayload | undefined;
  const payloadShapeOk = payload?.kind === 'sealed-local-plaintext'
    ? Object.keys(payload).length === 3 && Object.keys(payload).every((key) => ['kind', 'ciphertext', 'payloadCommitment'].includes(key))
    : payload?.kind === 'verified-wire-ciphertext' && Object.keys(payload).length === 4 && Object.keys(payload).every((key) => ['kind', 'wireBody', 'payloadCommitment', 'epochRef'].includes(key));
  const payloadOk = payloadShapeOk && (payload?.kind === 'sealed-local-plaintext'
    ? payload.ciphertext instanceof Uint8Array && payload.ciphertext.byteLength >= 29 && payload.ciphertext.byteLength <= MAX_CIPHERTEXT_BYTES && /^[0-9a-f]{64}$/u.test(payload.payloadCommitment)
    : payload?.kind === 'verified-wire-ciphertext' && typeof payload.wireBody === 'string' && encoder.encode(payload.wireBody).byteLength <= MAX_BODY_BYTES && /^[0-9a-f]{64}$/u.test(payload.payloadCommitment) && typeof payload.epochRef === 'string' && payload.epochRef.length <= 128);
  return typeof row.id === 'string' && clean(row.id, 1024) && typeof row.ownerKey === 'string' && clean(row.ownerKey, 512) && Number.isSafeInteger(row.ownerAccountGeneration) && Number.isSafeInteger(row.ownerConnectionGeneration)
    && typeof row.clientIntentId === 'string' && validRef(row.clientIntentId) && (row.retryOfRecordId === null || (typeof row.retryOfRecordId === 'string' && clean(row.retryOfRecordId, 512))) && (row.operation === 'privmsg' || row.operation === 'memo-send') && typeof row.target === 'string' && clean(row.target, 512) && typeof row.targetKey === 'string' && clean(row.targetKey, 512)
    && payloadOk && typeof row.policyRevision === 'string' && Number.isSafeInteger(row.queuedAt) && Number.isSafeInteger(row.expiresAt)
    && ['queued', 'queued-held', 'dispatching', 'transport-admitted', 'server-accepted', 'delivery-unknown', 'expired-review', 'discarded'].includes(String(row.state))
    && (row.claimNonce === null || typeof row.claimNonce === 'string') && (row.claimExpiresAt === null || Number.isSafeInteger(row.claimExpiresAt)) && Number.isSafeInteger(row.policyGeneration)
    && (row.dispatchAttempt === undefined || row.dispatchAttempt === null || (() => {
      if (!row.dispatchAttempt || typeof row.dispatchAttempt !== 'object') return false;
      const attempt = row.dispatchAttempt as Record<string, unknown>;
      return Object.keys(attempt).length === 6 && Object.keys(attempt).every((key) => ['nonce', 'planHash', 'lineCount', 'policyRevision', 'mappingRevision', 'startedAt'].includes(key))
        && typeof attempt.nonce === 'string' && clean(attempt.nonce, 128) && typeof attempt.planHash === 'string' && /^[0-9a-f]{64}$/u.test(attempt.planHash)
        && Number.isSafeInteger(attempt.lineCount) && (attempt.lineCount as number) > 0 && (attempt.lineCount as number) <= MAX_GROUP_LINES
        && typeof attempt.policyRevision === 'string' && clean(attempt.policyRevision, 128)
        && (attempt.mappingRevision === null || (typeof attempt.mappingRevision === 'string' && clean(attempt.mappingRevision, 128)))
        && Number.isSafeInteger(attempt.startedAt);
    })());
}

function validScheduledPolicySnapshot(value: unknown): value is ScheduledPolicySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'unknown') return Object.keys(record).length === 1;
  return record.kind === 'known' && Object.keys(record).sort().join(',') === 'kind,peerAccountId,policyBinding,privacy,semanticRevision'
    && typeof record.semanticRevision === 'string' && record.semanticRevision.length > 0 && record.semanticRevision.length <= 2048
    && !/[\u0000-\u001f\u007f]/u.test(record.semanticRevision)
    && (record.privacy === 'plain' || record.privacy === 'required')
    && (record.peerAccountId === null || makeAccountId(record.peerAccountId) !== null)
    && typeof record.policyBinding === 'string' && record.policyBinding.length > 0 && record.policyBinding.length <= 2048
    && !/[\u0000-\u001f\u007f]/u.test(record.policyBinding);
}

function freezeScheduledPolicySnapshot(value: ScheduledPolicySnapshot): ScheduledPolicySnapshot {
  return value.kind === 'unknown'
    ? Object.freeze({ kind: 'unknown' as const })
    : Object.freeze({ kind: 'known' as const, semanticRevision: value.semanticRevision,
      privacy: value.privacy, peerAccountId: value.peerAccountId, policyBinding: value.policyBinding });
}

function sameScheduledPolicySnapshot(left: ScheduledPolicySnapshot, right: ScheduledPolicySnapshot): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'unknown' || right.kind === 'unknown') return left.kind === 'unknown' && right.kind === 'unknown';
  return left.semanticRevision === right.semanticRevision && left.privacy === right.privacy
    && left.peerAccountId === right.peerAccountId && left.policyBinding === right.policyBinding;
}

function scheduledProjectionMatches(snapshot: ScheduledPolicySnapshot, projectionRevision: string): boolean {
  return snapshot.kind === 'known'
    ? projectionRevision === snapshot.semanticRevision
    : projectionRevision === 'local-sealed-intent-v1';
}

/** Durable owner-scoped queue. A persisted dispatch claim is the only permission
 * to call the wire; ambiguous calls stay unknown and are never retried. */
export function createOutboxJournal(deps: OutboxJournalDependencies) {
  const idb = deps.indexedDB ?? globalThis.indexedDB;
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? (() => globalThis.crypto.randomUUID());
  let db: IDBDatabase | null = null;
  let disposed = false;
  let opening: Promise<boolean> | null = null;
  const transactions = new Set<IDBTransaction>();
  const flushingOwners = new Set<string>();

  function current(request: RequestContext, ticket: LocalNamespaceTicket): boolean { return !disposed && deps.isNamespaceCurrent(ticket, request); }
  function liveCurrent(request: RequestContext, ticket: LocalNamespaceTicket): boolean { return current(request, ticket) && deps.isCurrent(request.owner) && sameOwner(deps.ownerSnapshot(), request.owner); }
  function liveNamespaceMatches(request: RequestContext, ticket: LocalNamespaceTicket): boolean {
    return liveCurrent(request, ticket) && ticket.scope.kind === 'account' && ticket.scope.networkId === request.owner.networkId && ticket.scope.accountId === request.owner.accountId;
  }
  function tx(mode: IDBTransactionMode): IDBTransaction | null {
    if (!db || disposed) return null;
    try {
      const value = db.transaction(OWNED_OUTBOX, mode);
      transactions.add(value);
      const drop = (): void => { transactions.delete(value); };
      value.addEventListener('complete', drop, { once: true });
      value.addEventListener('abort', drop, { once: true });
      value.addEventListener('error', drop, { once: true });
      return value;
    } catch { return null; }
  }
  function measure(kind: 'read' | 'write', start: number, success: boolean, requestId?: string): void {
    try { deps.measureIdb?.({ kind, durationMs: Math.max(0, now() - start), outcome: success ? 'success' : 'failure', ...(requestId ? { requestId } : {}) }); } catch { /* telemetry is isolated */ }
  }
  async function open(): Promise<boolean> {
    if (db) return true;
    if (!idb || disposed) return false;
    opening ??= openVaultV5({ indexedDB: idb, onVersionChange: () => { db?.close(); db = null; } }).then((result) => {
      if (result.kind !== 'ready' || disposed) { if (result.kind === 'ready') result.database.close(); return false; }
      db = result.database;
      return true;
    }).finally(() => { opening = null; });
    return opening;
  }
  function contextValid(request: RequestContext, ticket: LocalNamespaceTicket): boolean { return request.schemaVersion === 1 && validRef(request.requestId) && current(request, ticket); }
  function scope(ticket: LocalNamespaceTicket): string { return ticket.ownerKey; }
  function validPayload(value: DurableQueuedPayload): boolean {
    return value.kind === 'sealed-local-plaintext'
      ? value.ciphertext instanceof Uint8Array && value.ciphertext.length >= 29 && value.ciphertext.length <= MAX_CIPHERTEXT_BYTES && /^[0-9a-f]{64}$/u.test(value.payloadCommitment)
      : value.kind === 'verified-wire-ciphertext' && encoder.encode(value.wireBody).byteLength <= MAX_BODY_BYTES && /^[0-9a-f]{64}$/u.test(value.payloadCommitment) && clean(value.epochRef, 128);
  }
  async function enqueue(intent: QueueIntent, ticket: LocalNamespaceTicket,
    retryOf: { readonly recordId: string; readonly payloadCommitment: string; readonly operation: 'privmsg' | 'memo-send'; readonly targetKey: string } | null = null,
    scheduledPolicy: ScheduledPolicySnapshot | null = null): Promise<QueueResult> {
    const owner = intent.owner;
    const base = (status: QueueResult['status'], recordId: string | null = null): QueueResult => ({ schemaVersion: 1, requestId: intent.requestId, owner: echo(owner), status, recordId });
    const scheduledPolicyMatches = (target: string, targetKey: string): boolean => {
      if (scheduledPolicy === null) return true;
      if (!deps.scheduledPolicySnapshot || !current(intent, ticket)) return false;
      try {
        const currentPolicy = deps.scheduledPolicySnapshot(intent, ticket, target, targetKey);
        return currentPolicy !== null && validScheduledPolicySnapshot(currentPolicy)
          && sameScheduledPolicySnapshot(scheduledPolicy, currentPolicy);
      } catch { return false; }
    };
    const messageKind = intent.messageKind ?? 'message';
    const replyTo = intent.operation === 'privmsg' ? intent.replyTo ?? null : null;
    const audiencePrefix = intent.operation === 'privmsg' ? intent.audiencePrefix ?? null : null;
    if (intent.operation === 'memo-send' && (intent.replyTo != null || intent.audiencePrefix != null)) return base('invalid');
    if (!contextValid(intent, ticket) || !validRef(intent.clientIntentId) || (messageKind !== 'message' && messageKind !== 'action')) return base('invalid');
    const target = intent.operation === 'privmsg' ? intent.conversationId : intent.recipientAccount;
    if (!clean(target, 512) || /[\s,:]/u.test(target) || (intent.operation === 'privmsg' && !makeConversationId(target)) || (intent.operation === 'memo-send' && (ticket.scope.kind !== 'account' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(target)))) return base('invalid');
    const targetKey = deps.canonicalConversationKey(owner, target, ticket);
    if (!targetKey) return base('blocked');
    if (!scheduledPolicyMatches(target, targetKey)) return base('blocked');
    const canonicalBytes = canonicalRecordBytes(intent.operation, targetKey, messageKind, replyTo, audiencePrefix, intent.body);
    if (!canonicalBytes) return base('invalid');
    canonicalBytes.fill(0);
    const canonicalIntent = {
      ...intent,
      messageKind,
      replyTo,
      audiencePrefix,
      ...(scheduledPolicy === null ? {} : { capturedPolicy: scheduledPolicy }),
    } as QueueProjectionIntent;
    let projection: QueueProjection;
    try { projection = await deps.prepareQueuedPayload(canonicalIntent, ticket); } catch { return base('blocked'); }
    if (!current(intent, ticket)) return base('stale-owner');
    if (!scheduledPolicyMatches(target, targetKey)) {
      if (projection.kind === 'ready' && projection.payload.kind === 'sealed-local-plaintext') projection.payload.ciphertext.fill(0);
      return base('blocked');
    }
    if (projection.kind !== 'ready') return base(projection.kind === 'memory-only' ? 'memory-only' : projection.reason === 'stale-owner' ? 'stale-owner' : 'blocked');
    if (!validPayload(projection.payload) || !clean(projection.policyRevision, 128)
      || scheduledPolicy !== null && !scheduledProjectionMatches(scheduledPolicy, projection.policyRevision)) {
      if (projection.payload.kind === 'sealed-local-plaintext') projection.payload.ciphertext.fill(0);
      return base('invalid');
    }
    if (retryOf && (projection.payload.payloadCommitment !== retryOf.payloadCommitment || intent.operation !== retryOf.operation || retryOf.targetKey !== targetKey)) return base('intent-conflict');
    const opened = await open();
    if (!current(intent, ticket)) return base('stale-owner');
    if (!scheduledPolicyMatches(target, targetKey)) {
      if (projection.payload.kind === 'sealed-local-plaintext') projection.payload.ciphertext.fill(0);
      return base('blocked');
    }
    if (!opened) return base('unavailable');
    const started = now();
    const transaction = tx('readwrite');
    if (!transaction) return base('unavailable');
    const done = transactionPromise(transaction);
    const store = transaction.objectStore(OWNED_OUTBOX);
    const ownerKey = scope(ticket);
      let recordId = '';
    try {
      if (!current(intent, ticket)) { transaction.abort(); await done.catch(() => undefined); return base('stale-owner'); }
      if (!scheduledPolicyMatches(target, targetKey)) { transaction.abort(); await done.catch(() => undefined); return base('blocked'); }
      const existingKey = await requestPromise(store.index('by-owner-intent').getKey([ownerKey, intent.clientIntentId]));
      if (!current(intent, ticket)) { transaction.abort(); await done.catch(() => undefined); return base('stale-owner'); }
      if (!scheduledPolicyMatches(target, targetKey)) { transaction.abort(); await done.catch(() => undefined); return base('blocked'); }
      const duplicateValue = existingKey === undefined ? undefined : await requestPromise(store.get(existingKey));
      if (!current(intent, ticket)) { transaction.abort(); await done.catch(() => undefined); return base('stale-owner'); }
      if (!scheduledPolicyMatches(target, targetKey)) { transaction.abort(); await done.catch(() => undefined); return base('blocked'); }
      if (duplicateValue !== undefined && !validJournalRow(duplicateValue)) { transaction.abort(); await done.catch(() => undefined); return base('unavailable'); }
      const duplicate = duplicateValue as JournalRow | undefined ?? null;
      if (duplicate) {
        const oldId = (() => { try { const parts = JSON.parse(duplicate.id) as unknown[]; return typeof parts[1] === 'string' ? parts[1] : null; } catch { return null; } })();
        const sameIntent = duplicate.operation === intent.operation && duplicate.targetKey === targetKey && duplicate.payload.payloadCommitment === projection.payload.payloadCommitment;
        transaction.abort(); await done.catch(() => undefined);
        return base(sameIntent ? 'existing' : 'intent-conflict', oldId);
      }
      let activeCount = 0;
      await new Promise<void>((resolve, reject) => {
        const cursor = store.index('by-owner').openCursor(IDBKeyRange.only(ownerKey));
        cursor.onerror = () => reject(cursor.error ?? new Error('idb_cursor_failed'));
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) { resolve(); return; }
          const existing = item.value as JournalRow;
          if (!validJournalRow(existing)) { reject(new Error('corrupt_journal_row')); return; }
          if ((existing.state === 'transport-admitted' || existing.state === 'server-accepted' || existing.state === 'discarded') && existing.queuedAt + TTL_MS < now()) item.delete();
          else if (existing.state === 'queued' && existing.expiresAt <= now()) { item.update({ ...existing, state: 'expired-review' }); activeCount += 1; }
          else if (['queued', 'queued-held', 'dispatching', 'delivery-unknown', 'expired-review'].includes(existing.state)) activeCount += 1;
          item.continue();
        };
      });
      if (!current(intent, ticket)) { transaction.abort(); await done.catch(() => undefined); return base('stale-owner'); }
      if (!scheduledPolicyMatches(target, targetKey)) { transaction.abort(); await done.catch(() => undefined); return base('blocked'); }
      if (activeCount >= MAX_OWNER_ROWS) { transaction.abort(); await done.catch(() => undefined); measure('write', started, false, intent.requestId); return base('blocked'); }
      recordId = randomId();
      const row: JournalRow = {
        id: JSON.stringify([ownerKey, recordId]), ownerKey, ownerAccountGeneration: owner.accountGeneration,
        ownerConnectionGeneration: owner.connectionGeneration, clientIntentId: intent.clientIntentId, retryOfRecordId: retryOf?.recordId ?? null,
        operation: intent.operation, target, targetKey, payload: projection.payload, policyRevision: projection.policyRevision, queuedAt: now(), expiresAt: now() + TTL_MS,
        state: 'queued', claimNonce: null, claimExpiresAt: null, policyGeneration: deps.policySnapshot(canonicalIntent, ticket, target).policyGeneration,
        dispatchAttempt: null,
      };
      if (!current(intent, ticket)) { transaction.abort(); await done.catch(() => undefined); return base('stale-owner'); }
      if (!scheduledPolicyMatches(target, targetKey)) { transaction.abort(); await done.catch(() => undefined); return base('blocked'); }
      store.add(row);
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* ended */ }
      measure('write', started, false, intent.requestId);
      return base((error as DOMException)?.name === 'QuotaExceededError' ? 'quota' : current(intent, ticket) ? 'unavailable' : 'stale-owner');
    }
    measure('write', started, current(intent, ticket), intent.requestId);
    return base(current(intent, ticket) ? 'queued' : 'stale-owner', recordId || null);
  }
  async function claim(request: RequestContext, ticket: LocalNamespaceTicket, onlyRecordId: string | null = null): Promise<JournalRow | null | 'busy' | 'invalid'> {
    const owner = request.owner;
    const transaction = tx('readwrite');
    if (!transaction) return null;
    const done = transactionPromise(transaction);
    let claimed: JournalRow | null = null;
    let busy = false;
    let invalid = false;
    let unknownBarrier = false;
    let unknownMemoBarrier = false;
    let privmsgCandidate: { readonly id: IDBValidKey; readonly row: JournalRow } | null = null;
    let memoCandidate: { readonly id: IDBValidKey; readonly row: JournalRow } | null = null;
    const cursorRequest = transaction.objectStore(OWNED_OUTBOX).index('by-owner').openCursor(IDBKeyRange.only(scope(ticket)));
    cursorRequest.onsuccess = () => {
      if (!current(request, ticket)) { try { transaction.abort(); } catch { /* ended */ } return; }
      const cursor = cursorRequest.result;
      if (!cursor) {
        const chosen = unknownMemoBarrier && !deps.memoCorrelationClear(request, ticket) ? privmsgCandidate : privmsgCandidate ?? memoCandidate;
        if (busy || unknownBarrier || invalid || !chosen) return;
        const get = transaction.objectStore(OWNED_OUTBOX).get(chosen.id);
        get.onsuccess = () => {
          if (!current(request, ticket)) { try { transaction.abort(); } catch { /* ended */ } return; }
          const row = get.result as unknown;
          if (!validJournalRow(row) || (row.state !== 'queued' && row.state !== 'queued-held')) { invalid = true; return; }
          if (row.expiresAt <= now()) { transaction.objectStore(OWNED_OUTBOX).put({ ...row, state: 'expired-review' }); return; }
          const claimNonce = randomId();
          claimed = { ...row, state: 'dispatching', claimNonce, claimExpiresAt: now() + 30_000, ownerAccountGeneration: owner.accountGeneration, ownerConnectionGeneration: owner.connectionGeneration, dispatchAttempt: null };
          transaction.objectStore(OWNED_OUTBOX).put(claimed);
        };
        return;
      }
      const row = cursor.value as JournalRow;
      if (!validJournalRow(row)) { invalid = true; return; }
      if (row.state === 'dispatching') {
        // A prior page ended after durable claim. Its wire outcome cannot be
        // reconstructed, so preserve it as unknown and never replay it.
        if ((row.claimExpiresAt ?? 0) > now()) { busy = true; cursor.continue(); return; }
        cursor.update({ ...row, state: 'delivery-unknown' });
        unknownBarrier = true;
        cursor.continue();
        return;
      }
      if (row.operation === 'memo-send' && row.state === 'delivery-unknown') unknownMemoBarrier = true;
      if (row.state === 'queued' || row.state === 'queued-held') {
        if (row.expiresAt <= now()) {
          cursor.update({ ...row, state: 'expired-review' });
          cursor.continue();
          return;
        }
        const recordId = (() => { try { const parts = JSON.parse(row.id) as unknown[]; return parts[0] === ticket.ownerKey && typeof parts[1] === 'string' ? parts[1] : null; } catch { return null; } })();
        if (onlyRecordId === null || recordId === onlyRecordId) {
          if (row.operation === 'privmsg') privmsgCandidate ??= { id: cursor.primaryKey, row };
          else memoCandidate ??= { id: cursor.primaryKey, row };
        }
      }
      cursor.continue();
    };
    try { await done; } catch { return null; }
    return current(request, ticket) ? invalid ? 'invalid' : busy ? 'busy' : claimed : null;
  }
  async function updateState(row: JournalRow, request: RequestContext, ticket: LocalNamespaceTicket, state: JournalRow['state'], dispatchAttempt: JournalRow['dispatchAttempt'] = row.dispatchAttempt): Promise<boolean> {
    const opened = await open();
    if (!current(request, ticket) || !opened) return false;
    const transaction = tx('readwrite');
    if (!transaction) return false;
    const done = transactionPromise(transaction);
    try {
      const store = transaction.objectStore(OWNED_OUTBOX);
      const currentRow = await requestPromise(store.get(row.id)) as JournalRow | undefined;
      if (!current(request, ticket) || !currentRow || !validJournalRow(currentRow) || currentRow.state !== 'dispatching' || currentRow.claimNonce !== row.claimNonce) { transaction.abort(); await done.catch(() => undefined); return false; }
      store.put({ ...currentRow, state, dispatchAttempt });
      await done;
      return current(request, ticket);
    } catch { try { transaction.abort(); } catch { /* ended */ } return false; }
  }
  async function preserveUnknownAttempt(row: JournalRow): Promise<void> {
    // A captured, already-claimed attempt may need an uncertainty marker after
    // its UI namespace retires. This narrow write can only change that exact
    // owner's row with the same claim nonce; it cannot publish plaintext or
    // grant another send.
    const opened = await open();
    if (!opened) return;
    const transaction = tx('readwrite');
    if (!transaction) return;
    const done = transactionPromise(transaction);
    try {
      const store = transaction.objectStore(OWNED_OUTBOX);
      const found = await requestPromise(store.get(row.id)) as unknown;
      if (!validJournalRow(found) || (found.state !== 'dispatching' && found.state !== 'transport-admitted') || found.claimNonce !== row.claimNonce) {
        transaction.abort(); await done.catch(() => undefined); return;
      }
      store.put({ ...found, state: 'delivery-unknown' });
      await done;
    } catch { try { transaction.abort(); } catch { /* transaction already ended */ } await done.catch(() => undefined); }
  }
  async function claimStillOwned(row: JournalRow, request: RequestContext, ticket: LocalNamespaceTicket): Promise<boolean> {
    if (!current(request, ticket) || (row.claimExpiresAt ?? 0) <= now()) return false;
    const opened = await open();
    if (!current(request, ticket) || !opened) return false;
    const transaction = tx('readonly'); if (!transaction) return false; const done = transactionPromise(transaction);
    try {
      const currentRow = await requestPromise(transaction.objectStore(OWNED_OUTBOX).get(row.id)) as unknown;
      await done;
      return current(request, ticket) && validJournalRow(currentRow) && currentRow.state === 'dispatching' && currentRow.claimNonce === row.claimNonce
        && currentRow.dispatchAttempt?.nonce === row.dispatchAttempt?.nonce && currentRow.dispatchAttempt?.planHash === row.dispatchAttempt?.planHash
        && (currentRow.claimExpiresAt ?? 0) > now();
    } catch { await done.catch(() => undefined); return false; }
  }

  async function lineGroupHash(lines: readonly string[]): Promise<string | null> {
    try {
      const bytes = encoder.encode(JSON.stringify(lines));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      bytes.fill(0);
      const hash = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
      digest.fill(0);
      return hash;
    } catch { return null; }
  }

  async function runFlush(context: RequestContext, ticket: LocalNamespaceTicket, onlyRecordId: string | null): Promise<{ readonly schemaVersion: 1; readonly requestId: RequestContext['requestId']; readonly owner: OwnerSnapshot; readonly status: FlushStatus; readonly processed: number }> {
    const owner = context.owner;
    const answer = (status: FlushStatus, processed = 0) => ({ schemaVersion: 1 as const, requestId: context.requestId, owner: echo(owner), status, processed });
    if (!contextValid(context, ticket)) return answer('stale-owner');
    if (ticket.scope.kind === 'guest') return answer('blocked');
    if (!liveNamespaceMatches(context, ticket)) return answer('blocked');
    const opened = await open();
    if (!liveNamespaceMatches(context, ticket)) return answer('stale-owner');
    if (!opened) return answer('unavailable');
    if (!liveNamespaceMatches(context, ticket)) return answer('stale-owner');
    const ownerKey = scope(ticket);
    if (flushingOwners.has(ownerKey)) return answer('blocked');
    flushingOwners.add(ownerKey);
    try {
      let processed = 0;
      while (liveNamespaceMatches(context, ticket) && processed < (onlyRecordId ? 1 : MAX_OWNER_ROWS)) {
        const row = await claim(context, ticket, onlyRecordId);
        if (row === 'busy') return answer('blocked', processed);
        if (row === 'invalid') return answer('unavailable', processed);
        if (!row) return answer(processed ? 'transport-admitted' : 'idle', processed);
        if (!liveNamespaceMatches(context, ticket)) return answer('stale-owner', processed);
        let prepared: PreparedDispatch;
        try { prepared = await deps.prepareDispatch(row, context, ticket); }
        catch { prepared = { kind: 'review-needed', reason: 'policy-changed' }; }
        if (!liveNamespaceMatches(context, ticket)) { await updateState(row, context, ticket, 'delivery-unknown'); return answer('stale-owner', processed); }
        if (prepared.kind === 'held') { await updateState(row, context, ticket, 'queued-held', null); return answer('blocked', processed); }
        if (prepared.kind === 'review-needed') { await updateState(row, context, ticket, 'expired-review', null); return answer('blocked', processed); }
        const lines = Array.isArray(prepared.lines) ? [...prepared.lines] : [];
        const lineBytes = lines.map((line) => typeof line === 'string' && !/[\r\n\u0000]/u.test(line) ? encoder.encode(line).byteLength : Number.POSITIVE_INFINITY);
        const totalBytes = lineBytes.reduce((sum, bytes) => sum + bytes, 0);
        if (lines.length === 0 || lines.length > MAX_GROUP_LINES || lineBytes.some((bytes) => bytes <= 0 || bytes > MAX_WIRE_LINE_BYTES) || totalBytes > MAX_GROUP_BYTES || !clean(prepared.validationReceipt, 256)) {
          await updateState(row, context, ticket, 'expired-review', null);
          return answer('blocked', processed);
        }
        const planHash = await lineGroupHash(lines);
        if (!liveNamespaceMatches(context, ticket)) return answer('stale-owner', processed);
        if (!planHash) { await updateState(row, context, ticket, 'expired-review', null); return answer('blocked', processed); }
        const attempt = {
          nonce: row.claimNonce ?? '', planHash, lineCount: lines.length, policyRevision: row.policyRevision,
          mappingRevision: ticket.conversationScheme?.revision ?? null, startedAt: now(),
        } as const;
        const attemptRow = { ...row, dispatchAttempt: attempt };
        if (!clean(attempt.nonce, 128) || !await updateState(row, context, ticket, 'dispatching', attempt)) return answer('stale-owner', processed);
        if (!liveNamespaceMatches(context, ticket)) return answer('stale-owner', processed);
        const outcome = await deps.withDispatchGroup(context, ticket, async () => {
          const observe = (kind: 'transport-admitted' | 'blocked' | 'unknown'): void => {
            let recordId: string | null = null;
            try { const parts = JSON.parse(row.id) as unknown[]; if (parts[0] === scope(ticket) && typeof parts[1] === 'string') recordId = parts[1]; } catch { /* invalid key */ }
            if (recordId) { try { deps.observeAcceptanceAdmission?.({ recordId, claimNonce: attempt.nonce, planHash: attempt.planHash, kind }); } catch { /* correlation cannot alter transport state */ } }
          };
          const unknown = async (): Promise<'unknown'> => { await preserveUnknownAttempt(attemptRow); observe('unknown'); return 'unknown'; };
          if (!liveNamespaceMatches(context, ticket)) return 'stale' as const;
          if (!deps.validatePreparedDispatch(attemptRow, context, ticket, prepared)) {
            const saved = await updateState(row, context, ticket, 'expired-review', null);
            if (saved) observe('blocked');
            return 'review' as const;
          }
          if (!await claimStillOwned(attemptRow, context, ticket)) {
            if (!liveNamespaceMatches(context, ticket)) return 'stale' as const;
            const saved = await updateState(row, context, ticket, 'queued-held', null);
            if (saved) observe('blocked');
            return 'blocked' as const;
          }
          if (!liveNamespaceMatches(context, ticket)) return 'stale' as const;
          let admissions: readonly SendAdmission[];
          try { admissions = deps.transport.sendLineGroup({ lines, requestId: context.requestId, owner }); }
          catch { return unknown(); }
          if (!liveNamespaceMatches(context, ticket)) return admissions.some((item) => item.kind === 'transport-admitted' || item.kind === 'unknown') ? unknown() : 'stale' as const;
          let admittedCount = 0;
          for (const admission of admissions) {
            if (admission.kind === 'transport-admitted') { admittedCount += 1; continue; }
            if (admission.kind === 'unknown' || admittedCount > 0) return unknown();
            const held = await updateState(row, context, ticket, 'queued-held', null);
            if (held) observe('blocked');
            return 'blocked' as const;
          }
          if (admissions.length !== lines.length || admittedCount !== lines.length) return unknown();
          const saved = await updateState(row, context, ticket, 'transport-admitted', attempt);
          if (!saved) return unknown();
          observe('transport-admitted');
          return 'admitted' as const;
        });
        if (outcome === 'admitted') { processed += 1; continue; }
        if (outcome === 'unknown') return answer('delivery-unknown', processed);
        if (outcome === 'review' || outcome === 'blocked') return answer('blocked', processed);
        if (outcome === 'stale') return answer('stale-owner', processed);
        if (outcome === null) {
          if (!liveNamespaceMatches(context, ticket)) { await preserveUnknownAttempt(attemptRow); return answer('stale-owner', processed); }
          const held = await updateState(row, context, ticket, 'queued-held', null);
          if (held) {
            let recordId: string | null = null;
            try { const parts = JSON.parse(row.id) as unknown[]; if (parts[0] === scope(ticket) && typeof parts[1] === 'string') recordId = parts[1]; } catch { /* invalid key */ }
            if (recordId) { try { deps.observeAcceptanceAdmission?.({ recordId, claimNonce: attempt.nonce, planHash: attempt.planHash, kind: 'blocked' }); } catch { /* correlation is advisory */ } }
          }
          return answer(held ? 'blocked' : 'stale-owner', processed);
        }
      }
      return answer(liveNamespaceMatches(context, ticket) ? (processed ? 'transport-admitted' : 'idle') : 'stale-owner', processed);
    } finally { flushingOwners.delete(ownerKey); }
  }

  return {
    async queueMessage(intent: QueueIntent): Promise<QueueResult> {
      const ticket = deps.namespaceForRequest(intent);
      if (!ticket || !contextValid(intent, ticket)) return { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'stale-owner', recordId: null };
      return ticket.scope.kind === 'guest' ? { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'memory-only', recordId: null } : enqueue(intent, ticket);
    },
    async queueScheduledMessage(intent: ScheduledQueueIntent): Promise<QueueResult> {
      const ticket = deps.namespaceForRequest(intent);
      if (!ticket || !contextValid(intent, ticket)) return { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'stale-owner', recordId: null };
      if (ticket.scope.kind === 'guest') return { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'memory-only', recordId: null };
      if (!deps.scheduledPolicySnapshot || !validScheduledPolicySnapshot(intent.capturedPolicy)) {
        return { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'blocked', recordId: null };
      }
      const capturedPolicy = freezeScheduledPolicySnapshot(intent.capturedPolicy);
      return enqueue(intent, ticket, null, capturedPolicy);
    },
    async queueMemo(intent: OwnedMemoIntent): Promise<QueueResult> {
      const ticket = deps.namespaceForRequest(intent);
      if (!ticket || !contextValid(intent, ticket)) return { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'stale-owner', recordId: null };
      return ticket.scope.kind === 'guest' ? { schemaVersion: 1, requestId: intent.requestId, owner: echo(intent.owner), status: 'memory-only', recordId: null } : enqueue({ ...intent, operation: 'memo-send' }, ticket);
    },
    async flush(context: RequestContext): Promise<{ readonly schemaVersion: 1; readonly requestId: RequestContext['requestId']; readonly owner: OwnerSnapshot; readonly status: FlushStatus; readonly processed: number }> {
      const ticket = deps.namespaceForRequest(context);
      return ticket ? runFlush(context, ticket, null) : { schemaVersion: 1, requestId: context.requestId, owner: echo(context.owner), status: 'stale-owner', processed: 0 };
    },
    async retryQueued(context: RequestContext, recordId: string): Promise<{ readonly schemaVersion: 1; readonly requestId: RequestContext['requestId']; readonly owner: OwnerSnapshot; readonly status: FlushStatus; readonly processed: number }> {
      const ticket = deps.namespaceForRequest(context);
      if (!ticket || !clean(recordId, 512)) return { schemaVersion: 1, requestId: context.requestId, owner: echo(context.owner), status: 'stale-owner', processed: 0 };
      return runFlush(context, ticket, recordId);
    },
    async inspect(request: RequestContext): Promise<JournalSummary> {
      const owner = request.owner;
      const ticket = deps.namespaceForRequest(request);
      const summary = { schemaVersion: 1 as const, owner: echo(owner), status: 'ready' as JournalSummary['status'], queued: 0, dispatching: 0, admitted: 0, unknown: 0, expired: 0 };
      if (!ticket || !current(request, ticket)) return { ...summary, status: 'stale-owner' };
      if (ticket.scope.kind === 'guest') return summary;
      const opened = await open();
      if (!current(request, ticket)) return { ...summary, status: 'stale-owner' };
      if (!opened) return { ...summary, status: 'unavailable' };
      const transaction = tx('readonly');
      if (!transaction) return { ...summary, status: 'unavailable' };
      const done = transactionPromise(transaction);
      let invalid = false;
      const cursorRequest = transaction.objectStore(OWNED_OUTBOX).index('by-owner').openCursor(IDBKeyRange.only(scope(ticket)));
      cursorRequest.onsuccess = () => {
        if (!current(request, ticket)) { try { transaction.abort(); } catch { /* ended */ } return; }
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const row = cursor.value as JournalRow;
        if (!validJournalRow(row)) { invalid = true; try { transaction.abort(); } catch { /* ended */ } return; }
        if (row.state === 'queued' || row.state === 'queued-held') summary.queued += 1;
        else if (row.state === 'dispatching') summary.dispatching += 1;
        else if (row.state === 'transport-admitted' || row.state === 'server-accepted') summary.admitted += 1;
        else if (row.state === 'delivery-unknown') summary.unknown += 1;
        else if (row.state === 'expired-review') summary.expired += 1;
        cursor.continue();
      };
      await done.catch(() => undefined);
      if (!current(request, ticket)) return { ...summary, status: 'stale-owner', queued: 0, dispatching: 0, admitted: 0, unknown: 0, expired: 0 };
      if (invalid) return { ...summary, status: 'unavailable', queued: 0, dispatching: 0, admitted: 0, unknown: 0, expired: 0 };
      return summary;
    },
    async listEntries(request: RequestContext): Promise<{ readonly status: JournalSummary['status']; readonly entries: readonly JournalEntrySummary[] }> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !current(request, ticket)) return { status: 'stale-owner', entries: [] };
      if (ticket.scope.kind === 'guest') return { status: 'ready', entries: [] };
      const opened = await open();
      if (!current(request, ticket)) return { status: 'stale-owner', entries: [] };
      if (!opened) return { status: 'unavailable', entries: [] };
      const transaction = tx('readonly'); if (!transaction) return { status: 'unavailable', entries: [] };
      const done = transactionPromise(transaction); const entries: JournalEntrySummary[] = []; let invalid = false;
      const cursorRequest = transaction.objectStore(OWNED_OUTBOX).index('by-owner').openCursor(IDBKeyRange.only(scope(ticket)));
      cursorRequest.onsuccess = () => {
        if (!current(request, ticket)) { try { transaction.abort(); } catch { /* ended */ } return; }
        const cursor = cursorRequest.result; if (!cursor || entries.length >= MAX_OWNER_ROWS) return;
        const row = cursor.value as unknown;
        if (!validJournalRow(row) || row.ownerKey !== ticket.ownerKey) { invalid = true; try { transaction.abort(); } catch { /* ended */ } return; }
        let recordId: unknown;
        try { const parts = JSON.parse(row.id) as unknown[]; recordId = parts[0] === ticket.ownerKey ? parts[1] : undefined; } catch { recordId = undefined; }
        if (typeof recordId !== 'string' || !clean(recordId, 512)) { invalid = true; try { transaction.abort(); } catch { /* ended */ } return; }
        entries.push({ recordId, clientIntentId: row.clientIntentId, operation: row.operation, intent: row.operation === 'memo-send' ? 'memo' : 'chat', target: row.target, conversationId: row.operation === 'privmsg' ? row.target : null, state: row.state, queuedAt: row.queuedAt, expiresAt: row.expiresAt });
        cursor.continue();
      };
      await done.catch(() => undefined);
      if (!current(request, ticket)) return { status: 'stale-owner', entries: [] };
      if (invalid) return { status: 'unavailable', entries: [] };
      return { status: 'ready', entries };
    },
    async reconcileAccepted(request: RequestContext & { readonly recordId: string; readonly proofRef: symbol }): Promise<'server-accepted' | 'stale-owner' | 'invalid' | 'unavailable'> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !contextValid(request, ticket) || !liveNamespaceMatches(request, ticket) || !clean(request.recordId, 512)) return 'stale-owner';
      const opened = await open();
      if (!current(request, ticket)) return 'stale-owner';
      if (!opened) return 'unavailable';
      if (!current(request, ticket)) return 'stale-owner';
      const transaction = tx('readwrite'); if (!transaction) return 'unavailable';
      const done = transactionPromise(transaction);
      try {
        const id = JSON.stringify([scope(ticket), request.recordId]);
        const row = await requestPromise(transaction.objectStore(OWNED_OUTBOX).get(id)) as unknown;
        if (!validJournalRow(row)) { transaction.abort(); await done.catch(() => undefined); return 'invalid'; }
        if (row.state === 'server-accepted') { transaction.abort(); await done.catch(() => undefined); return 'server-accepted'; }
        if (row.state !== 'transport-admitted' && row.state !== 'delivery-unknown') { transaction.abort(); await done.catch(() => undefined); return 'invalid'; }
        if (!current(request, ticket) || !deps.verifyAcceptanceProof(request.proofRef, request, row)) { transaction.abort(); await done.catch(() => undefined); return current(request, ticket) ? 'invalid' : 'stale-owner'; }
        transaction.objectStore(OWNED_OUTBOX).put({ ...row, state: 'server-accepted' });
        await done;
        try { deps.acceptanceProofCommitted?.(request.proofRef); } catch { /* persisted acceptance remains authoritative */ }
        return current(request, ticket) ? 'server-accepted' : 'stale-owner';
      } catch { try { transaction.abort(); } catch { /* ended */ } await done.catch(() => undefined); return current(request, ticket) ? 'unavailable' : 'stale-owner'; }
    },
    async discardReviewed(request: RequestContext & { readonly recordId: string; readonly confirmDiscard: true }): Promise<'discarded' | 'stale-owner' | 'invalid' | 'unavailable'> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !contextValid(request, ticket) || ticket.scope.kind === 'guest') return 'stale-owner';
      if (request.confirmDiscard !== true || !clean(request.recordId, 512)) return 'invalid';
      const opened = await open();
      if (!current(request, ticket)) return 'stale-owner';
      if (!opened) return 'unavailable';
      if (!current(request, ticket)) return 'stale-owner';
      const transaction = tx('readwrite'); if (!transaction) return 'unavailable'; const done = transactionPromise(transaction);
      try {
        const id = JSON.stringify([scope(ticket), request.recordId]);
        const row = await requestPromise(transaction.objectStore(OWNED_OUTBOX).get(id)) as unknown;
        if (!validJournalRow(row) || !['queued', 'queued-held', 'expired-review'].includes(row.state)) { transaction.abort(); await done.catch(() => undefined); return 'invalid'; }
        if (!current(request, ticket)) { transaction.abort(); await done.catch(() => undefined); return 'stale-owner'; }
        transaction.objectStore(OWNED_OUTBOX).put({ ...row, state: 'discarded' }); await done;
        return current(request, ticket) ? 'discarded' : 'stale-owner';
      } catch { try { transaction.abort(); } catch { /* ended */ } await done.catch(() => undefined); return current(request, ticket) ? 'unavailable' : 'stale-owner'; }
    },
    async retryUnknown(request: RequestContext & { readonly oldRecordId: string; readonly newIntent: QueueIntent; readonly duplicateRiskConfirmed: true }): Promise<QueueResult> {
      const failure = (status: QueueResult['status']): QueueResult => ({ schemaVersion: 1, requestId: request.requestId, owner: echo(request.owner), status, recordId: null });
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !contextValid(request, ticket) || ticket.scope.kind !== 'account' || request.newIntent.requestId !== request.requestId || !sameOwner(request.owner, request.newIntent.owner) || request.duplicateRiskConfirmed !== true || !clean(request.oldRecordId, 512)) return failure('stale-owner');
      const opened = await open();
      if (!current(request, ticket)) return failure('stale-owner');
      if (!opened) return failure('unavailable');
      const transaction = tx('readonly'); if (!transaction) return failure('unavailable'); const done = transactionPromise(transaction);
      let row: unknown;
      try { row = await requestPromise(transaction.objectStore(OWNED_OUTBOX).get(JSON.stringify([scope(ticket), request.oldRecordId]))); await done; }
      catch { return failure('unavailable'); }
      if (!validJournalRow(row) || row.state !== 'delivery-unknown' || row.clientIntentId === request.newIntent.clientIntentId) return failure('invalid');
      if (!current(request, ticket)) return failure('stale-owner');
      return enqueue(request.newIntent, ticket, { recordId: request.oldRecordId, payloadCommitment: row.payload.payloadCommitment, operation: row.operation, targetKey: row.targetKey });
    },
    dispose(): void { disposed = true; for (const transaction of transactions) { try { transaction.abort(); } catch { /* ended */ } } transactions.clear(); db?.close(); db = null; },
  };
}
