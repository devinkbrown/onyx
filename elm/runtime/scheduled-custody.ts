/** Owner-fenced, encrypted-at-rest scheduled-message custody.
 *
 * The existing v5 `scheduled` object store is reused without a schema bump.
 * Only this module opens schedule ciphertext; public results contain metadata
 * and opaque schedule references, never message bodies.
 */
import { makeAccountId, makeConversationId, makeMessageId, makeRequestId, type AccountId, type ConversationId, type MessageId, type OwnerSnapshot, type RequestContext, type RequestId } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { SCHEDULED, VAULT_META, openVaultV5, requestPromise, transactionPromise } from './migrations';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_ROWS_PER_OWNER = 256;
const MAX_STORAGE_BYTES_PER_OWNER = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 65_536;
const MAX_RECORD_BYTES = 262_144;
const MAX_SCAN_ROWS = 20_000;
const ID_RE = /^[A-Za-z0-9_-]{1,96}$/u;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\r]/u;
const CREATE_ADMISSION_TTL_MS = 120_000;
const SCHEDULE_GENERATION_PREFIX = 'scheduled-cancel-generation-v1';
const volatileScheduleGenerations = new Map<string, number>();

export type ScheduledIntent = {
  readonly operationId: string;
  readonly clientIntentId: RequestId;
  readonly conversationId: ConversationId;
  readonly dueAtMs: number;
  readonly messageKind: 'message' | 'action';
  readonly replyTo: MessageId | null;
  readonly audiencePrefix: string | null;
  readonly body: string;
};
export type ScheduledRowState = 'scheduled' | 'dispatching' | 'delivery-unknown' | 'policy-review' | 'legacy-review';
export type ScheduledPolicySnapshot = { readonly kind: 'unknown' } | { readonly kind: 'known'; readonly semanticRevision: string;
  readonly privacy: 'plain' | 'required'; readonly peerAccountId: AccountId | null; readonly policyBinding: string };
export type ScheduledCreateAdmissionRef = symbol;
export type ScheduledSummary = {
  readonly scheduleRef: string;
  readonly operationId: string | null;
  readonly clientIntentId: RequestId | null;
  readonly conversationId: ConversationId | null;
  readonly dueAtMs: number | null;
  readonly messageKind: 'message' | 'action' | null;
  readonly replyTo: MessageId | null;
  readonly audiencePrefix: string | null;
  readonly revision: number | null;
  readonly state: ScheduledRowState;
  readonly mode: 'durable' | 'volatile';
};
export type ScheduledResultStatus = 'saved' | 'edited' | 'cancelled' | 'journal-accepted' | 'server-accepted' | 'delivery-unknown' | 'not-due' | 'not-dispatched'
  | 'policy-review' | 'legacy-review' | 'conflict' | 'blocked' | 'invalid' | 'stale-owner' | 'unavailable' | 'quota';
export type ScheduledResult = {
  readonly schemaVersion: 1;
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
  readonly status: ScheduledResultStatus;
  readonly scheduleRef: string | null;
  readonly revision: number | null;
  readonly mode: 'durable' | 'volatile' | null;
};
export type ScheduledListResult = {
  readonly schemaVersion: 1;
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
  readonly status: 'ready' | 'stale-owner' | 'unavailable';
  readonly rows: readonly ScheduledSummary[];
  readonly legacyHeldCount: number;
  readonly legacyReviewUnavailable: boolean;
  readonly mode: 'durable' | 'volatile' | null;
};
export type ScheduledQueueOutcome = 'accepted' | 'not-accepted' | 'unknown';
export type ScheduledJournalStatus = 'accepted' | 'not-found' | 'unknown';
export type VolatileScheduleOutcome = 'server-accepted' | 'not-accepted' | 'unknown';
export type VolatileScheduleStatus = 'server-accepted' | 'not-found' | 'unknown';

export interface ScheduledCustodyDependencies {
  readonly indexedDB?: IDBFactory;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly canonicalConversationKey: (owner: OwnerSnapshot, conversationId: ConversationId, ticket: LocalNamespaceTicket) => string | null;
  /** One-use request-bound editor input. The returned UTF-8 body is private and must be wiped. */
  readonly readPrivateInput: (inputRef: string, context: RequestContext, kind: 'create' | 'edit') => Promise<Uint8Array | null>;
  /** Provider-owned workspace AEAD, with target and immutable operation ID in its authenticated context. */
  readonly seal: (input: { context: RequestContext; ticket: LocalNamespaceTicket; operationId: string; revision: number; purpose: string; conversationId: ConversationId; targetKey: string; exactBinding: string; plaintext: Uint8Array }) => Promise<Uint8Array | null>;
  readonly open: (input: { context: RequestContext; ticket: LocalNamespaceTicket; operationId: string; revision: number; purpose: string; conversationId: ConversationId; targetKey: string; exactBinding: string; ciphertext: Uint8Array }) => Promise<Uint8Array | null>;
  /** This queues durably; it never admits bytes to the transport itself. */
  readonly enqueueJournal: (input: RequestContext & { readonly operationId: string; readonly clientIntentId: RequestId;
    readonly conversationId: ConversationId; readonly targetKey: string; readonly dueAtMs: number;
    readonly messageKind: 'message' | 'action'; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null;
    readonly body: string; readonly capturedPolicy: ScheduledPolicySnapshot }) => Promise<ScheduledQueueOutcome>;
  /** Must query by the same immutable clientIntentId, not infer absence from a timeout. */
  readonly journalStatus: (context: RequestContext, clientIntentId: RequestId) => Promise<ScheduledJournalStatus>;
  /** RAM-only guest path. Transport-admitted is `unknown`; only correlated server acceptance is terminal. */
  readonly enqueueVolatile?: (input: RequestContext & { readonly operationId: string; readonly clientIntentId: RequestId;
    readonly conversationId: ConversationId; readonly targetKey: string; readonly dueAtMs: number;
    readonly messageKind: 'message' | 'action'; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null;
    readonly body: Uint8Array; readonly capturedPolicy: ScheduledPolicySnapshot }) => Promise<VolatileScheduleOutcome>;
  readonly volatileStatus?: (context: RequestContext, clientIntentId: RequestId) => Promise<VolatileScheduleStatus>;
  readonly capturePolicy: (input: { readonly context: RequestContext; readonly ticket: LocalNamespaceTicket; readonly conversationId: ConversationId; readonly targetKey: string }) => ScheduledPolicySnapshot | null;
  readonly checkDispatchPolicy: (input: { readonly context: RequestContext; readonly ticket: LocalNamespaceTicket; readonly conversationId: ConversationId;
    readonly targetKey: string; readonly captured: ScheduledPolicySnapshot }) => 'compatible' | 'hold' | 'unavailable';
  readonly now?: () => number;
}

type CreateAdmission = {
  readonly ref: ScheduledCreateAdmissionRef;
  readonly owner: OwnerSnapshot;
  readonly requestId: RequestId;
  readonly ticket: LocalNamespaceTicket;
  readonly operationId: string;
  readonly expectedGeneration: number;
  readonly expiresAt: number;
  consumed: boolean;
  inputRef: string | null;
  timer: ReturnType<typeof setTimeout> | null;
};

type PersistedPayload = {
  readonly version: 1; readonly revision: number; readonly capturedPolicy: ScheduledPolicySnapshot; readonly operationId: string; readonly clientIntentId: RequestId;
  readonly conversationId: ConversationId; readonly targetKey: string; readonly dueAtMs: number;
  readonly messageKind: 'message' | 'action'; readonly replyTo: MessageId | null;
  readonly audiencePrefix: string | null; readonly body: string;
};
type StoredRow = {
  readonly id: string; readonly ownerKey: string; readonly operationId: string; readonly clientIntentId: RequestId;
  readonly conversationId: ConversationId; readonly targetKey: string; readonly dueAtMs: number;
  readonly messageKind: 'message' | 'action'; readonly replyTo: MessageId | null; readonly audiencePrefix: string | null;
  readonly revision: number; readonly state: 'scheduled' | 'dispatching' | 'delivery-unknown' | 'policy-review';
  readonly claimNonce: string | null; readonly claimStartedAt: number | null; readonly ciphertext: Uint8Array;
};

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function recordId(ownerKey: string, operationId: string): string { return JSON.stringify([ownerKey, 'scheduled-v1', operationId]); }
function randomNonce(): string { return [...crypto.getRandomValues(new Uint8Array(18))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function validRef(value: string): boolean { return ID_RE.test(value); }
function validPolicySnapshot(value: unknown): value is ScheduledPolicySnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'unknown') return Object.keys(record).length === 1;
  return record.kind === 'known' && Object.keys(record).sort().join(',') === 'kind,peerAccountId,policyBinding,privacy,semanticRevision'
    && typeof record.semanticRevision === 'string' && record.semanticRevision.length > 0 && record.semanticRevision.length <= 2048
    && (record.privacy === 'plain' || record.privacy === 'required')
    && (record.peerAccountId === null || makeAccountId(record.peerAccountId) !== null)
    && typeof record.policyBinding === 'string' && record.policyBinding.length > 0 && record.policyBinding.length <= 2048
    && !/[\u0000-\u001f\u007f]/u.test(record.semanticRevision) && !/[\u0000-\u001f\u007f]/u.test(record.policyBinding);
}
function samePolicySnapshot(a: ScheduledPolicySnapshot, b: ScheduledPolicySnapshot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'unknown' || b.kind === 'unknown') return a.kind === 'unknown' && b.kind === 'unknown';
  return a.semanticRevision === b.semanticRevision && a.privacy === b.privacy
    && a.peerAccountId === b.peerAccountId && a.policyBinding === b.policyBinding;
}
function validBody(body: string): boolean {
  if (!body.trim() || CONTROL.test(body) || encoder.encode(body).byteLength > MAX_BODY_BYTES) return false;
  const roundtrip = encoder.encode(body);
  try { return decoder.decode(roundtrip) === body; } catch { return false; }
}
function validMetadata(input: Omit<PersistedPayload, 'version' | 'body'>): boolean {
  return Number.isSafeInteger(input.revision) && input.revision > 0 && validRef(input.operationId) && !!makeRequestId(input.clientIntentId) && !!makeConversationId(input.conversationId)
    && input.conversationId.startsWith('#') && typeof input.targetKey === 'string' && input.targetKey.length > 0
    && input.targetKey.length <= 512 && !/[\s\u0000-\u001f\u007f]/u.test(input.targetKey)
    && Number.isSafeInteger(input.dueAtMs) && input.dueAtMs > 0
    && (input.messageKind === 'message' || input.messageKind === 'action')
    && (input.replyTo === null || !!makeMessageId(input.replyTo) && input.replyTo.length <= 512)
    && (input.audiencePrefix === null || Array.from(input.audiencePrefix).length === 1
      && encoder.encode(input.audiencePrefix).byteLength <= 4 && !/[\s,:\u0000-\u001f\u007f]/u.test(input.audiencePrefix));
}
function decodeRow(value: unknown, id: string): StoredRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<StoredRow>;
  if (row.id !== id || typeof row.ownerKey !== 'string' || row.ownerKey.length > 512 || typeof row.operationId !== 'string' || !validRef(row.operationId)
    || !makeRequestId(row.clientIntentId) || typeof row.conversationId !== 'string' || !makeConversationId(row.conversationId) || !row.conversationId.startsWith('#')
    || typeof row.targetKey !== 'string' || row.targetKey.length < 1 || row.targetKey.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(row.targetKey)
    || !Number.isSafeInteger(row.dueAtMs) || (row.dueAtMs ?? 0) <= 0 || !Number.isSafeInteger(row.revision) || (row.revision ?? -1) < 1
    || (row.messageKind !== 'message' && row.messageKind !== 'action')
    || !(row.replyTo === null || typeof row.replyTo === 'string' && !!makeMessageId(row.replyTo) && row.replyTo.length <= 512)
    || !(row.audiencePrefix === null || typeof row.audiencePrefix === 'string' && Array.from(row.audiencePrefix).length === 1
      && encoder.encode(row.audiencePrefix).byteLength <= 4 && !/[\s,:\u0000-\u001f\u007f]/u.test(row.audiencePrefix))
    || (row.state !== 'scheduled' && row.state !== 'dispatching' && row.state !== 'delivery-unknown' && row.state !== 'policy-review')
    || !(row.claimNonce === null || typeof row.claimNonce === 'string' && /^[a-f0-9]{36}$/u.test(row.claimNonce))
    || !(row.claimStartedAt === null || Number.isSafeInteger(row.claimStartedAt))
    || !(row.ciphertext instanceof Uint8Array) || row.ciphertext.byteLength < 29 || row.ciphertext.byteLength > MAX_RECORD_BYTES) return null;
  return row as StoredRow;
}
function metadata(row: StoredRow): ScheduledSummary {
  return { scheduleRef: row.operationId, operationId: row.operationId, clientIntentId: row.clientIntentId,
    conversationId: row.conversationId, dueAtMs: row.dueAtMs, messageKind: row.messageKind, replyTo: row.replyTo,
    audiencePrefix: row.audiencePrefix, revision: row.revision, state: row.state === 'dispatching' ? 'delivery-unknown' : row.state, mode: 'durable' };
}
function decodePayload(bytes: Uint8Array, row: StoredRow): PersistedPayload | null {
  let value: unknown;
  try { value = JSON.parse(decoder.decode(bytes)); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const payload = value as PersistedPayload;
  if (Object.keys(value).sort().join(',') !== 'audiencePrefix,body,capturedPolicy,clientIntentId,conversationId,dueAtMs,messageKind,operationId,replyTo,revision,targetKey,version'
    || payload.version !== 1 || payload.revision !== row.revision || payload.operationId !== row.operationId || payload.clientIntentId !== row.clientIntentId
    || payload.conversationId !== row.conversationId || payload.targetKey !== row.targetKey || payload.dueAtMs !== row.dueAtMs
    || payload.messageKind !== row.messageKind || payload.replyTo !== row.replyTo || payload.audiencePrefix !== row.audiencePrefix
    || !validPolicySnapshot(payload.capturedPolicy)
    || typeof payload.body !== 'string' || !validBody(payload.body)) return null;
  return payload;
}

export function createScheduledCustody(deps: ScheduledCustodyDependencies) {
  let disposed = false;
  let opening: ReturnType<typeof openVaultV5> | null = null;
  const activeRequests = new Set<RequestId>();
  const requestOwners = new Map<RequestId, OwnerSnapshot>();
  type VolatileEntry = { readonly owner: OwnerSnapshot; readonly context: RequestContext; readonly operationId: string; readonly clientIntentId: RequestId; readonly conversationId: ConversationId;
    readonly targetKey: string; dueAtMs: number; messageKind: 'message' | 'action'; replyTo: MessageId | null;
    audiencePrefix: string | null; capturedPolicy: ScheduledPolicySnapshot; revision: number; state: 'scheduled' | 'dispatching' | 'delivery-unknown' | 'policy-review';
    claimNonce: string | null; body: Uint8Array };
  const volatileByOwner = new Map<string, Map<string, VolatileEntry>>();
  const activeVolatileClaims = new Set<string>();
  const createAdmissions = new Map<ScheduledCreateAdmissionRef, CreateAdmission>();
  const inputAdmissions = new Map<string, ScheduledCreateAdmissionRef>();
  let volatileBytes = 0;
  const MAX_VOLATILE_ROWS = 32;
  const MAX_VOLATILE_BYTES = 2 * 1024 * 1024;
  const ownerStillCurrent = (ticket: LocalNamespaceTicket, context: RequestContext): boolean => !disposed
    && sameOwner(ticketRequestOwner.get(ticket) ?? context.owner, context.owner) && deps.isNamespaceCurrent(ticket, context);
  const ticketRequestOwner = new WeakMap<object, OwnerSnapshot>();
  function capture(context: RequestContext, allowReadOnly = false): LocalNamespaceTicket | null {
    if (disposed || !context || context.schemaVersion !== 1 || !makeRequestId(context.requestId) || activeRequests.has(context.requestId)) return null;
    const ticket = deps.namespaceForRequest(context);
    // Scheduled work is durable only for an explicitly selected account
    // workspace. Guest work must remain volatile and cannot survive a socket.
    const matchingScope = ticket?.scope.kind === 'account'
      ? context.owner.networkId === ticket.scope.networkId && context.owner.accountId === ticket.scope.accountId
      : ticket?.scope.kind === 'guest' && context.owner.accountId === null && context.owner.networkId === ticket.scope.networkId
        && context.owner.physicalRef === ticket.scope.physicalRef;
    if (!ticket || !matchingScope || (!allowReadOnly && ticket.access !== 'read-write') || ticket.scope.kind === 'account' && ticket.scope.historyOnly
      || !deps.isNamespaceCurrent(ticket, context)) return null;
    ticketRequestOwner.set(ticket, Object.freeze({ ...context.owner }));
    requestOwners.set(context.requestId, Object.freeze({ ...context.owner }));
    return ticket;
  }
  function release(context: RequestContext): void {
    activeRequests.delete(context.requestId);
    requestOwners.delete(context.requestId);
  }
  function generationRecordId(ownerKey: string): string {
    return JSON.stringify([ownerKey, SCHEDULE_GENERATION_PREFIX]);
  }
  function decodeGeneration(value: unknown, id: string, ownerKey: string): number | null {
    if (value === undefined) return 0;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'generation,id,ownerKey,version' || row.id !== id || row.ownerKey !== ownerKey
      || row.version !== 1 || !Number.isSafeInteger(row.generation) || (row.generation as number) < 0) return null;
    return row.generation as number;
  }
  async function readGeneration(context: RequestContext, ticket: LocalNamespaceTicket): Promise<number | null> {
    const db = await database();
    if (!db || !ownerStillCurrent(ticket, context)) return null;
    const id = generationRecordId(ticket.ownerKey);
    try {
      const tx = db.transaction(VAULT_META, 'readonly');
      const done = transactionPromise(tx);
      const value = await requestPromise(tx.objectStore(VAULT_META).get(id));
      await done;
      return ownerStillCurrent(ticket, context) ? decodeGeneration(value, id, ticket.ownerKey) : null;
    } catch { return null; }
  }
  function retireCreateAdmission(ref: ScheduledCreateAdmissionRef): void {
    const admission = createAdmissions.get(ref);
    if (!admission) return;
    if (admission.timer) clearTimeout(admission.timer);
    if (admission.inputRef && inputAdmissions.get(admission.inputRef) === ref) inputAdmissions.delete(admission.inputRef);
    createAdmissions.delete(ref);
  }
  function admissionForInput(inputRef: string, context: RequestContext, ticket: LocalNamespaceTicket, operationId: string): CreateAdmission | null {
    const ref = inputAdmissions.get(inputRef);
    if (!ref) return null;
    const admission = createAdmissions.get(ref);
    // Consume before any further async work, but retain the active admission
    // until create settles so owner retirement can fence its generation.
    inputAdmissions.delete(inputRef);
    if (admission) admission.consumed = true;
    if (!admission || admission.consumed !== true || admission.inputRef !== inputRef || admission.requestId !== context.requestId
      || admission.operationId !== operationId || !sameOwner(admission.owner, context.owner)
      || admission.expiresAt <= now() || !ownerStillCurrent(admission.ticket, context)
      || admission.ticket.ownerKey !== ticket.ownerKey || admission.ticket.workspaceEpoch !== ticket.workspaceEpoch) {
      if (ref) retireCreateAdmission(ref);
      return null;
    }
    return admission;
  }
  function admissionStillCurrent(admission: CreateAdmission, context: RequestContext, ticket: LocalNamespaceTicket): boolean {
    return createAdmissions.get(admission.ref) === admission && admission.consumed && admission.expiresAt > now()
      && admission.requestId === context.requestId && sameOwner(admission.owner, context.owner)
      && admission.ticket.ownerKey === ticket.ownerKey && admission.ticket.workspaceEpoch === ticket.workspaceEpoch
      && ownerStillCurrent(admission.ticket, context);
  }
  async function captureCreateAdmission(context: RequestContext, operationId: string): Promise<ScheduledCreateAdmissionRef | null> {
    const ticket = capture(context);
    if (!ticket || !ID_RE.test(operationId)) return null;
    activeRequests.add(context.requestId);
    try {
      let expectedGeneration: number | null;
      if (ticket.scope.kind === 'guest') expectedGeneration = volatileScheduleGenerations.get(ticket.ownerKey) ?? 0;
      else expectedGeneration = await readGeneration(context, ticket);
      if (expectedGeneration === null || !ownerStillCurrent(ticket, context)) return null;
      const ref = Symbol('scheduled-create-admission');
      const admission: CreateAdmission = { ref, owner: Object.freeze({ ...context.owner }), requestId: context.requestId,
        ticket, operationId, expectedGeneration, expiresAt: now() + CREATE_ADMISSION_TTL_MS, consumed: false, inputRef: null, timer: null };
      admission.timer = setTimeout(() => retireCreateAdmission(ref), CREATE_ADMISSION_TTL_MS);
      createAdmissions.set(ref, admission);
      return ref;
    } finally { release(context); }
  }
  function bindCreateAdmission(inputRef: string, ref: ScheduledCreateAdmissionRef, context: RequestContext): boolean {
    const admission = createAdmissions.get(ref);
    if (!admission || admission.consumed || admission.inputRef !== null || !/^[A-Za-z0-9_-]{22,128}$/u.test(inputRef)
      || admission.requestId !== context.requestId || !sameOwner(admission.owner, context.owner)
      || admission.expiresAt <= now() || !ownerStillCurrent(admission.ticket, context) || inputAdmissions.has(inputRef)) return false;
    admission.inputRef = inputRef;
    inputAdmissions.set(inputRef, ref);
    return true;
  }
  function volatileRows(ticket: LocalNamespaceTicket): Map<string, VolatileEntry> {
    let rows = volatileByOwner.get(ticket.ownerKey);
    if (!rows) { rows = new Map(); volatileByOwner.set(ticket.ownerKey, rows); }
    return rows;
  }
  function volatileSummary(row: VolatileEntry): ScheduledSummary {
    return { scheduleRef: row.operationId, operationId: row.operationId, clientIntentId: row.clientIntentId,
      conversationId: row.conversationId, dueAtMs: row.dueAtMs, messageKind: row.messageKind, replyTo: row.replyTo,
      audiencePrefix: row.audiencePrefix, revision: row.revision,
      state: row.state === 'dispatching' ? 'delivery-unknown' : row.state, mode: 'volatile' };
  }
  function wipeVolatile(row: VolatileEntry): void { volatileBytes = Math.max(0, volatileBytes - row.body.byteLength); row.body.fill(0); }
  function wipeVolatileOwner(owner: OwnerSnapshot): void {
    for (const [key, rows] of volatileByOwner) {
      for (const [id, row] of rows) {
        if (sameOwner(owner, row.owner)) { wipeVolatile(row); rows.delete(id); }
      }
      if (rows.size === 0) volatileByOwner.delete(key);
    }
  }
  async function database(): Promise<IDBDatabase | null> {
    if (!deps.indexedDB || disposed) return null;
    opening ??= openVaultV5({ indexedDB: deps.indexedDB });
    const result = await opening;
    return !disposed && result.kind === 'ready' ? result.database : null;
  }
  async function readRow(db: IDBDatabase, id: string): Promise<StoredRow | null> {
    const tx = db.transaction(SCHEDULED, 'readonly');
    const done = transactionPromise(tx);
    try {
      const value = await requestPromise(tx.objectStore(SCHEDULED).get(id));
      await done;
      return decodeRow(value, id);
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
  }
  const now = (): number => deps.now?.() ?? Date.now();
  function base(context: RequestContext, status: ScheduledResultStatus, scheduleRef: string | null, revision: number | null,
    mode: ScheduledResult['mode'] = 'durable'): ScheduledResult {
    return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status, scheduleRef, revision, mode };
  }
  async function scanOwned(db: IDBDatabase, ticket: LocalNamespaceTicket): Promise<{ rows: StoredRow[]; legacyHeldCount: number; legacyReviewUnavailable: boolean } | null> {
    return new Promise((resolve) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(SCHEDULED, 'readonly'); } catch { resolve(null); return; }
      const rows: StoredRow[] = []; let legacyHeldCount = 0; let legacyReviewUnavailable = false; let count = 0; let failed = false;
      const request = tx.objectStore(SCHEDULED).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (++count > MAX_SCAN_ROWS) { failed = true; try { tx.abort(); } catch { /* transaction ended */ } return; }
        const value: unknown = cursor.value; const id = typeof (value as { id?: unknown })?.id === 'string' ? (value as { id: string }).id : '';
        const row = decodeRow(value, id);
        if (row?.ownerKey === ticket.ownerKey) rows.push(row);
        else if (!row) {
          const rawOwner = typeof (value as { ownerKey?: unknown })?.ownerKey === 'string' ? (value as { ownerKey: string }).ownerKey : null;
          if (rawOwner === ticket.ownerKey) legacyHeldCount += 1;
          else legacyReviewUnavailable = true;
        }
        // Malformed/legacy rows have no trustworthy owner partition. Never
        // expose even their identifiers through another workspace's listing.
        cursor.continue();
      };
      request.onerror = () => { failed = true; try { tx.abort(); } catch { /* transaction ended */ } };
      tx.oncomplete = () => resolve(failed ? null : { rows, legacyHeldCount, legacyReviewUnavailable });
      tx.onerror = tx.onabort = () => resolve(null);
    });
  }
  async function sealPayload(context: RequestContext, ticket: LocalNamespaceTicket, payload: PersistedPayload): Promise<Uint8Array | null> {
    const bytes = encoder.encode(JSON.stringify(payload));
    try {
      if (bytes.byteLength > MAX_RECORD_BYTES || !ownerStillCurrent(ticket, context)) return null;
      const purpose = `scheduled:${payload.operationId}:${payload.revision}`;
      const sealed = await deps.seal({ context, ticket, operationId: payload.operationId, revision: payload.revision, purpose,
        conversationId: payload.conversationId, targetKey: payload.targetKey, exactBinding: payload.targetKey, plaintext: bytes });
      return ownerStillCurrent(ticket, context) ? sealed : (sealed?.fill(0), null);
    } finally { bytes.fill(0); }
  }
  async function privatePayload(context: RequestContext, ticket: LocalNamespaceTicket, row: StoredRow): Promise<PersistedPayload | null> {
    if (!ownerStillCurrent(ticket, context)) return null;
    const encrypted = row.ciphertext.slice();
    try {
      const purpose = `scheduled:${row.operationId}:${row.revision}`;
      const opened = await deps.open({ context, ticket, operationId: row.operationId, revision: row.revision, purpose,
        conversationId: row.conversationId, targetKey: row.targetKey, exactBinding: row.targetKey, ciphertext: encrypted });
      if (!opened || !ownerStillCurrent(ticket, context)) { opened?.fill(0); return null; }
      try { return decodePayload(opened, row); } finally { opened.fill(0); }
    } finally { encrypted.fill(0); }
  }
async function readInputBytes(inputRef: string, context: RequestContext, ticket: LocalNamespaceTicket, kind: 'create' | 'edit'): Promise<Uint8Array | null> {
    if (!/^[A-Za-z0-9_-]{22,128}$/u.test(inputRef) || !ownerStillCurrent(ticket, context)) return null;
    let bytes: Uint8Array | null = null;
    try {
      bytes = await deps.readPrivateInput(inputRef, context, kind);
      if (!bytes || !ownerStillCurrent(ticket, context) || bytes.byteLength > MAX_BODY_BYTES) return null;
      const body = decoder.decode(bytes);
      return validBody(body) ? bytes.slice() : null;
    } catch { return null; }
    finally { bytes?.fill(0); }
  }
  async function readInput(inputRef: string, context: RequestContext, ticket: LocalNamespaceTicket, kind: 'create' | 'edit'): Promise<string | null> {
    const bytes = await readInputBytes(inputRef, context, ticket, kind);
    if (!bytes) return null;
    try { return decoder.decode(bytes); } catch { return null; } finally { bytes.fill(0); }
  }
  async function createVolatile(input: RequestContext & { inputRef: string; operationId: string; clientIntentId: RequestId; conversationId: ConversationId;
    dueAtMs: number; messageKind: 'message' | 'action'; replyTo: MessageId | null; audiencePrefix: string | null }, ticket: LocalNamespaceTicket,
    targetKey: string, capturedPolicy: ScheduledPolicySnapshot, admission: CreateAdmission): Promise<ScheduledResult> {
    if (!deps.enqueueVolatile) return base(input, 'unavailable', null, null, 'volatile');
    const inputBytes = await readInputBytes(input.inputRef, input, ticket, 'create');
    if (!inputBytes || !ownerStillCurrent(ticket, input)) { inputBytes?.fill(0); return base(input, 'invalid', null, null, 'volatile'); }
    if (admission.operationId !== input.operationId || !admissionStillCurrent(admission, input, ticket)
      || (volatileScheduleGenerations.get(ticket.ownerKey) ?? 0) !== admission.expectedGeneration) {
      inputBytes.fill(0); return base(input, 'conflict', input.operationId, null, 'volatile');
    }
    if (deps.checkDispatchPolicy({ context: input, ticket, conversationId: input.conversationId, targetKey, captured: capturedPolicy }) !== 'compatible') {
      inputBytes.fill(0); return base(input, 'blocked', null, null, 'volatile');
    }
    const meta = { operationId: input.operationId, clientIntentId: input.clientIntentId, conversationId: input.conversationId,
      dueAtMs: input.dueAtMs, messageKind: input.messageKind, replyTo: input.replyTo, audiencePrefix: input.audiencePrefix };
    if (!validMetadata({ ...meta, revision: 1, targetKey, capturedPolicy }) || input.dueAtMs <= now()) { inputBytes.fill(0); return base(input, 'invalid', null, null, 'volatile'); }
    const rows = volatileRows(ticket);
    const previous = [...rows.values()].find((row) => row.clientIntentId === input.clientIntentId);
    if (previous) {
      const same = previous.operationId === input.operationId && previous.conversationId === input.conversationId && previous.targetKey === targetKey
        && previous.dueAtMs === input.dueAtMs && previous.messageKind === input.messageKind && previous.replyTo === input.replyTo
        && previous.audiencePrefix === input.audiencePrefix && previous.body.byteLength === inputBytes.byteLength
        && previous.body.every((value, index) => value === inputBytes[index]);
      inputBytes.fill(0);
      return base(input, same ? 'saved' : 'conflict', previous.operationId, previous.revision, 'volatile');
    }
    if (rows.has(input.operationId) || rows.size >= MAX_VOLATILE_ROWS || volatileBytes + inputBytes.byteLength > MAX_VOLATILE_BYTES) {
      inputBytes.fill(0); return base(input, 'quota', null, null, 'volatile');
    }
    const row: VolatileEntry = { owner: Object.freeze({ ...input.owner }), context: Object.freeze({ ...input, owner: Object.freeze({ ...input.owner }) }),
      operationId: input.operationId, clientIntentId: input.clientIntentId, conversationId: input.conversationId, targetKey,
      dueAtMs: input.dueAtMs, messageKind: input.messageKind, replyTo: input.replyTo, audiencePrefix: input.audiencePrefix,
      capturedPolicy, revision: 1, state: 'scheduled', claimNonce: null, body: inputBytes };
    rows.set(input.operationId, row); volatileBytes += inputBytes.byteLength;
    return base(input, 'saved', input.operationId, 1, 'volatile');
  }
  async function editVolatile(input: RequestContext & { inputRef: string; scheduleRef: string; expectedRevision: number; dueAtMs: number;
    messageKind: 'message' | 'action'; replyTo: MessageId | null; audiencePrefix: string | null }, ticket: LocalNamespaceTicket): Promise<ScheduledResult> {
    const rows = volatileByOwner.get(ticket.ownerKey); const old = rows?.get(input.scheduleRef);
    if (!old || !sameOwner(old.owner, input.owner) || old.revision !== input.expectedRevision || (old.state !== 'scheduled' && old.state !== 'policy-review'))
      return base(input, 'conflict', input.scheduleRef, old?.revision ?? null, 'volatile');
    const targetKey = deps.canonicalConversationKey(input.owner, old.conversationId, ticket);
    if (!targetKey || targetKey !== old.targetKey || input.dueAtMs <= now()) return base(input, 'blocked', input.scheduleRef, old.revision, 'volatile');
    const capturedPolicy = deps.capturePolicy({ context: input, ticket, conversationId: old.conversationId, targetKey });
    if (!capturedPolicy || !validPolicySnapshot(capturedPolicy)) return base(input, 'blocked', input.scheduleRef, old.revision, 'volatile');
    if (!validMetadata({ revision: old.revision + 1, capturedPolicy, operationId: old.operationId, clientIntentId: old.clientIntentId,
      conversationId: old.conversationId, targetKey, dueAtMs: input.dueAtMs, messageKind: input.messageKind,
      replyTo: input.replyTo, audiencePrefix: input.audiencePrefix })) return base(input, 'invalid', input.scheduleRef, old.revision, 'volatile');
    const bytes = await readInputBytes(input.inputRef, input, ticket, 'edit');
    if (!bytes || !ownerStillCurrent(ticket, input)) { bytes?.fill(0); return base(input, 'stale-owner', input.scheduleRef, old.revision, 'volatile'); }
    if (rows?.get(old.operationId) !== old || old.revision !== input.expectedRevision || old.state !== 'scheduled') {
      bytes.fill(0); return base(input, 'conflict', input.scheduleRef, old.revision, 'volatile');
    }
    if (deps.checkDispatchPolicy({ context: input, ticket, conversationId: old.conversationId, targetKey, captured: capturedPolicy }) !== 'compatible') {
      bytes.fill(0); return base(input, 'blocked', input.scheduleRef, old.revision, 'volatile');
    }
    if (volatileBytes - old.body.byteLength + bytes.byteLength > MAX_VOLATILE_BYTES) { bytes.fill(0); return base(input, 'quota', input.scheduleRef, old.revision, 'volatile'); }
    old.body.fill(0); volatileBytes = Math.max(0, volatileBytes - old.body.byteLength) + bytes.byteLength;
    old.body = bytes; old.dueAtMs = input.dueAtMs; old.messageKind = input.messageKind; old.replyTo = input.replyTo;
    old.audiencePrefix = input.audiencePrefix; old.capturedPolicy = capturedPolicy; old.revision += 1;
    return base(input, 'edited', input.scheduleRef, old.revision, 'volatile');
  }
  async function dispatchVolatile(input: RequestContext & { scheduleRef: string; expectedRevision: number }, ticket: LocalNamespaceTicket): Promise<ScheduledResult> {
    const rows = volatileByOwner.get(ticket.ownerKey); const row = rows?.get(input.scheduleRef);
    if (!row || !sameOwner(row.owner, input.owner) || row.revision !== input.expectedRevision)
      return base(input, 'conflict', input.scheduleRef, row?.revision ?? null, 'volatile');
    if (row.state === 'dispatching' && row.claimNonce && activeVolatileClaims.has(row.claimNonce))
      return base(input, 'delivery-unknown', row.operationId, row.revision, 'volatile');
    if (row.state === 'dispatching') {
      let state: VolatileScheduleStatus = 'unknown';
      try { state = await deps.volatileStatus?.(input, row.clientIntentId) ?? 'unknown'; } catch { state = 'unknown'; }
      if (!ownerStillCurrent(ticket, input)) return base(input, 'stale-owner', row.operationId, row.revision, 'volatile');
      if (state === 'server-accepted') { rows?.delete(row.operationId); wipeVolatile(row); return base(input, 'server-accepted', row.operationId, row.revision, 'volatile'); }
      row.state = 'delivery-unknown'; row.body.fill(0); volatileBytes = Math.max(0, volatileBytes - row.body.byteLength);
      return base(input, 'delivery-unknown', row.operationId, row.revision, 'volatile');
    }
    if (row.state === 'delivery-unknown') {
      let state: VolatileScheduleStatus = 'unknown';
      try { state = await deps.volatileStatus?.(input, row.clientIntentId) ?? 'unknown'; } catch { state = 'unknown'; }
      if (!ownerStillCurrent(ticket, input)) return base(input, 'stale-owner', row.operationId, row.revision, 'volatile');
      if (state === 'server-accepted') { rows?.delete(row.operationId); wipeVolatile(row); return base(input, 'server-accepted', row.operationId, row.revision, 'volatile'); }
      return base(input, 'delivery-unknown', row.operationId, row.revision, 'volatile');
    }
    if (row.dueAtMs > now()) return base(input, 'not-due', row.operationId, row.revision, 'volatile');
    if (!deps.enqueueVolatile || !ownerStillCurrent(ticket, input)) return base(input, 'blocked', row.operationId, row.revision, 'volatile');
    const compatibility = deps.checkDispatchPolicy({ context: input, ticket, conversationId: row.conversationId, targetKey: row.targetKey, captured: row.capturedPolicy });
    if (compatibility !== 'compatible') { row.state = 'policy-review'; return base(input, compatibility === 'hold' ? 'policy-review' : 'unavailable', row.operationId, row.revision, 'volatile'); }
    row.state = 'dispatching'; row.claimNonce = randomNonce();
    activeVolatileClaims.add(row.claimNonce);
    const body = row.body.slice();
    let outcome: VolatileScheduleOutcome;
    try {
      outcome = await deps.enqueueVolatile({ ...input, operationId: row.operationId, clientIntentId: row.clientIntentId,
        conversationId: row.conversationId, targetKey: row.targetKey, dueAtMs: row.dueAtMs, messageKind: row.messageKind,
        replyTo: row.replyTo, audiencePrefix: row.audiencePrefix, body, capturedPolicy: row.capturedPolicy });
    } catch { outcome = 'unknown'; }
    finally { body.fill(0); if (row.claimNonce) activeVolatileClaims.delete(row.claimNonce); }
    if (!ownerStillCurrent(ticket, input) || rows?.get(row.operationId) !== row) return base(input, 'stale-owner', row.operationId, row.revision, 'volatile');
    if (outcome === 'server-accepted') { rows.delete(row.operationId); wipeVolatile(row); return base(input, 'server-accepted', row.operationId, row.revision, 'volatile'); }
    if (outcome === 'not-accepted') { row.state = 'scheduled'; row.claimNonce = null; return base(input, 'blocked', row.operationId, row.revision, 'volatile'); }
    row.state = 'delivery-unknown'; row.body.fill(0); volatileBytes = Math.max(0, volatileBytes - row.body.byteLength);
    return base(input, 'delivery-unknown', row.operationId, row.revision, 'volatile');
  }
  async function writeNew(context: RequestContext, ticket: LocalNamespaceTicket, row: StoredRow, capturedPolicy: ScheduledPolicySnapshot,
    admission: CreateAdmission): Promise<'saved' | 'conflict' | 'quota' | 'unavailable' | 'stale-owner' | 'policy-review'> {
    const db = await database(); if (!db) return 'unavailable';
    if (!ownerStillCurrent(ticket, context)) return 'stale-owner';
    return new Promise((resolve) => {
      let tx: IDBTransaction; try { tx = db.transaction([SCHEDULED, VAULT_META], 'readwrite'); } catch { resolve('unavailable'); return; }
      const store = tx.objectStore(SCHEDULED); const cursorReq = store.openCursor();
      const generationId = generationRecordId(ticket.ownerKey);
      const generationReq = tx.objectStore(VAULT_META).get(generationId);
      let count = 0; let ownerCount = 0; let bytes = 0; let generationReady = false; let cursorReady = false; let currentGeneration: number | null = null;
      let finalized = false;
      let result: 'saved' | 'conflict' | 'quota' | 'unavailable' | 'stale-owner' | 'policy-review' = 'unavailable';
      const done = transactionPromise(tx);
      const considerAdd = (): void => {
        if (finalized || !generationReady || !cursorReady) return;
        finalized = true;
        if (admission.operationId !== row.operationId || !ownerStillCurrent(ticket, context) || !admissionStillCurrent(admission, context, ticket)) {
          result = 'stale-owner'; try { tx.abort(); } catch { /* ended */ } return;
        }
        if (currentGeneration === null || currentGeneration !== admission.expectedGeneration) { result = 'conflict'; try { tx.abort(); } catch { /* ended */ } return; }
        if (ownerCount >= MAX_ROWS_PER_OWNER || bytes + row.ciphertext.byteLength > MAX_STORAGE_BYTES_PER_OWNER) {
          result = 'quota'; try { tx.abort(); } catch { /* ended */ } return;
        }
        if (deps.checkDispatchPolicy({ context, ticket, conversationId: row.conversationId, targetKey: row.targetKey, captured: capturedPolicy }) !== 'compatible') {
          result = 'policy-review'; try { tx.abort(); } catch { /* ended */ } return;
        }
        store.add(row); result = 'saved';
      };
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          if (++count > MAX_SCAN_ROWS) { finalized = true; try { tx.abort(); } catch { /* ended */ } return; }
          const existing = decodeRow(cursor.value, String((cursor.value as { id?: unknown }).id ?? ''));
          if (existing?.ownerKey === ticket.ownerKey) { ownerCount++; bytes += existing.ciphertext.byteLength; if (existing.operationId === row.operationId) { result = 'conflict'; finalized = true; try { tx.abort(); } catch { /* ended */ } return; } }
          cursor.continue(); return;
        }
        cursorReady = true; considerAdd();
      };
      cursorReq.onerror = () => { try { tx.abort(); } catch { /* ended */ } };
      generationReq.onsuccess = () => { currentGeneration = decodeGeneration(generationReq.result, generationId, ticket.ownerKey); generationReady = true; considerAdd(); };
      generationReq.onerror = () => { try { tx.abort(); } catch { /* ended */ } };
      void done.then(() => resolve(result), () => resolve(result === 'stale-owner' || result === 'conflict' || result === 'quota' || result === 'policy-review' ? result : 'unavailable'));
    });
  }
  async function replace(context: RequestContext, ticket: LocalNamespaceTicket, old: StoredRow, next: StoredRow, capturedPolicy: ScheduledPolicySnapshot): Promise<'saved' | 'conflict' | 'unavailable' | 'stale-owner' | 'policy-review'> {
    const db = await database(); if (!db) return 'unavailable';
    if (!ownerStillCurrent(ticket, context)) return 'stale-owner';
    try {
      const tx = db.transaction(SCHEDULED, 'readwrite'); const done = transactionPromise(tx); const store = tx.objectStore(SCHEDULED);
      const current = await requestPromise(store.get(old.id));
      const parsed = decodeRow(current, old.id);
      if (!ownerStillCurrent(ticket, context)) { tx.abort(); await done.catch(() => undefined); return 'stale-owner'; }
      if (!parsed || parsed.ownerKey !== ticket.ownerKey || parsed.revision !== old.revision
        || (parsed.state !== 'scheduled' && parsed.state !== 'policy-review')) { tx.abort(); await done.catch(() => undefined); return 'conflict'; }
      if (deps.checkDispatchPolicy({ context, ticket, conversationId: next.conversationId, targetKey: next.targetKey, captured: capturedPolicy }) !== 'compatible') {
        tx.abort(); await done.catch(() => undefined); return 'policy-review';
      }
      store.put(next); await done;
      return ownerStillCurrent(ticket, context) ? 'saved' : 'stale-owner';
    } catch { return ownerStillCurrent(ticket, context) ? 'unavailable' : 'stale-owner'; }
  }
  async function mutateState(context: RequestContext, ticket: LocalNamespaceTicket, row: StoredRow, state: StoredRow['state'], claimNonce: string | null): Promise<boolean> {
    const db = await database(); if (!db || !ownerStillCurrent(ticket, context)) return false;
    try {
      const tx = db.transaction(SCHEDULED, 'readwrite'); const done = transactionPromise(tx); const store = tx.objectStore(SCHEDULED);
      const current = decodeRow(await requestPromise(store.get(row.id)), row.id);
      if (!current || current.ownerKey !== ticket.ownerKey || current.revision !== row.revision
        || current.claimNonce !== row.claimNonce || !ownerStillCurrent(ticket, context)) { tx.abort(); await done.catch(() => undefined); return false; }
      store.put({ ...current, state, claimNonce, claimStartedAt: claimNonce ? now() : null });
      await done; return ownerStillCurrent(ticket, context);
    } catch { return false; }
  }
  async function removeClaimed(context: RequestContext, ticket: LocalNamespaceTicket, row: StoredRow): Promise<boolean> {
    const db = await database(); if (!db || !ownerStillCurrent(ticket, context)) return false;
    try {
      const tx = db.transaction(SCHEDULED, 'readwrite'); const done = transactionPromise(tx); const store = tx.objectStore(SCHEDULED);
      const current = decodeRow(await requestPromise(store.get(row.id)), row.id);
      if (!current || current.ownerKey !== ticket.ownerKey || current.revision !== row.revision
        || current.claimNonce !== row.claimNonce || (current.state !== 'dispatching' && current.state !== 'delivery-unknown') || !ownerStillCurrent(ticket, context)) {
        tx.abort(); await done.catch(() => undefined); return false;
      }
      store.delete(row.id); await done; return ownerStillCurrent(ticket, context);
    } catch { return false; }
  }
  async function recoverClaim(context: RequestContext, ticket: LocalNamespaceTicket, row: StoredRow): Promise<ScheduledResult> {
    const status = await deps.journalStatus(context, row.clientIntentId);
    if (!ownerStillCurrent(ticket, context)) return base(context, 'stale-owner', row.operationId, row.revision);
    if (status === 'accepted') {
      const removed = await removeClaimed(context, ticket, row);
      return base(context, removed ? 'journal-accepted' : 'conflict', row.operationId, row.revision);
    }
    if (status === 'unknown' || status === 'not-found') {
      await mutateState(context, ticket, row, 'delivery-unknown', row.claimNonce);
      return base(context, 'delivery-unknown', row.operationId, row.revision);
    }
    // The journal prunes admission tombstones. An absent record after a crash
    // cannot prove that bytes were never admitted, so this path never resends.
    return base(context, 'delivery-unknown', row.operationId, row.revision, 'durable');
  }
  async function claimRow(context: RequestContext, ticket: LocalNamespaceTicket, row: StoredRow, nonce: string, allowUnknown: boolean): Promise<boolean> {
    const db = await database(); if (!db || !ownerStillCurrent(ticket, context)) return false;
    try {
      const tx = db.transaction(SCHEDULED, 'readwrite'); const done = transactionPromise(tx); const store = tx.objectStore(SCHEDULED);
      const current = decodeRow(await requestPromise(store.get(row.id)), row.id);
      const stateAllowed = allowUnknown
        ? current?.state === 'delivery-unknown' || current?.state === 'dispatching'
        : (current?.state === 'scheduled' || current?.state === 'policy-review') && current.dueAtMs <= now();
      if (!current || current.ownerKey !== ticket.ownerKey || current.revision !== row.revision
        || current.claimNonce !== row.claimNonce || !stateAllowed || !ownerStillCurrent(ticket, context)) {
        tx.abort(); await done.catch(() => undefined); return false;
      }
      store.put({ ...current, state: 'dispatching', claimNonce: nonce, claimStartedAt: now() });
      await done; return ownerStillCurrent(ticket, context);
    } catch { return false; }
  }

  async function create(input: RequestContext & { inputRef: string; operationId: string; clientIntentId: RequestId; conversationId: ConversationId; dueAtMs: number; messageKind: 'message' | 'action'; replyTo: MessageId | null; audiencePrefix: string | null }): Promise<ScheduledResult> {
    const ticket = capture(input); if (!ticket) return base(input, 'stale-owner', null, null);
    if (activeRequests.has(input.requestId)) return base(input, 'conflict', null, null);
    activeRequests.add(input.requestId);
    let consumedAdmission: CreateAdmission | null = null;
    try {
      const admission = admissionForInput(input.inputRef, input, ticket, input.operationId);
      if (!admission) return base(input, 'conflict', input.operationId, null, ticket.scope.kind === 'guest' ? 'volatile' : 'durable');
      consumedAdmission = admission;
      const targetKey = deps.canonicalConversationKey(input.owner, input.conversationId, ticket);
      if (!targetKey) return base(input, 'invalid', null, null);
      const capturedPolicy = deps.capturePolicy({ context: input, ticket, conversationId: input.conversationId, targetKey });
      if (!capturedPolicy || !validPolicySnapshot(capturedPolicy)) return base(input, 'blocked', null, null, ticket.scope.kind === 'guest' ? 'volatile' : 'durable');
      if (ticket.scope.kind === 'guest') return await createVolatile(input, ticket, targetKey, capturedPolicy, admission);
      const meta = { revision: 1, operationId: input.operationId, clientIntentId: input.clientIntentId, conversationId: input.conversationId, targetKey,
        dueAtMs: input.dueAtMs, messageKind: input.messageKind, replyTo: input.replyTo, audiencePrefix: input.audiencePrefix };
      if (!validMetadata({ ...meta, capturedPolicy }) || input.dueAtMs <= now()) return base(input, 'invalid', null, null);
      const body = await readInput(input.inputRef, input, ticket, 'create');
      if (body === null || !ownerStillCurrent(ticket, input)) return base(input, body === null ? 'invalid' : 'stale-owner', null, null);
      if (deps.checkDispatchPolicy({ context: input, ticket, conversationId: input.conversationId, targetKey, captured: capturedPolicy }) !== 'compatible')
        return base(input, 'blocked', null, null);
      const payload: PersistedPayload = { version: 1, ...meta, capturedPolicy, body };
      const ciphertext = await sealPayload(input, ticket, payload);
      if (!ciphertext || !ownerStillCurrent(ticket, input)) { ciphertext?.fill(0); return base(input, 'unavailable', null, null); }
      const row: StoredRow = { id: recordId(ticket.ownerKey, input.operationId), ownerKey: ticket.ownerKey, ...meta,
        state: 'scheduled', claimNonce: null, claimStartedAt: null, ciphertext };
      const result = await writeNew(input, ticket, row, capturedPolicy, admission);
      ciphertext.fill(0);
      return base(input, result === 'saved' ? 'saved' : result === 'quota' ? 'quota' : result === 'conflict' ? 'conflict' : result === 'policy-review' ? 'policy-review'
        : result === 'stale-owner' ? 'stale-owner' : 'unavailable', input.operationId, result === 'saved' ? 1 : null);
    } catch { return base(input, 'unavailable', null, null); }
    finally { if (consumedAdmission) retireCreateAdmission(consumedAdmission.ref); release(input); }
  }
  async function edit(input: RequestContext & { inputRef: string; scheduleRef: string; expectedRevision: number; dueAtMs: number; messageKind: 'message' | 'action'; replyTo: MessageId | null; audiencePrefix: string | null }): Promise<ScheduledResult> {
    const ticket = capture(input); if (!ticket) return base(input, 'stale-owner', input.scheduleRef, null);
    activeRequests.add(input.requestId);
    try {
      if (ticket.scope.kind === 'guest') return await editVolatile(input, ticket);
      const db = await database(); if (!db || !ownerStillCurrent(ticket, input)) return base(input, 'unavailable', input.scheduleRef, null);
      if (!validRef(input.scheduleRef) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
        || !Number.isSafeInteger(input.dueAtMs) || input.dueAtMs <= now()) return base(input, 'invalid', input.scheduleRef, null);
      const old = await readRow(db, recordId(ticket.ownerKey, input.scheduleRef));
      if (!old || old.ownerKey !== ticket.ownerKey || old.revision !== input.expectedRevision
        || (old.state !== 'scheduled' && old.state !== 'policy-review')) return base(input, 'conflict', input.scheduleRef, old?.revision ?? null);
      const targetKey = deps.canonicalConversationKey(input.owner, old.conversationId, ticket);
      if (!targetKey || targetKey !== old.targetKey) return base(input, 'blocked', input.scheduleRef, old.revision);
      const body = await readInput(input.inputRef, input, ticket, 'edit');
      if (body === null || !ownerStillCurrent(ticket, input)) return base(input, body === null ? 'invalid' : 'stale-owner', input.scheduleRef, old.revision);
      const capturedPolicy = deps.capturePolicy({ context: input, ticket, conversationId: old.conversationId, targetKey });
      if (!capturedPolicy || !validPolicySnapshot(capturedPolicy) || deps.checkDispatchPolicy({ context: input, ticket,
        conversationId: old.conversationId, targetKey, captured: capturedPolicy }) !== 'compatible') return base(input, 'blocked', input.scheduleRef, old.revision);
      const meta = { revision: old.revision + 1, operationId: old.operationId, clientIntentId: old.clientIntentId, conversationId: old.conversationId, targetKey,
        dueAtMs: input.dueAtMs, messageKind: input.messageKind, replyTo: input.replyTo, audiencePrefix: input.audiencePrefix };
      if (!validMetadata({ ...meta, capturedPolicy })) return base(input, 'invalid', input.scheduleRef, old.revision);
      const ciphertext = await sealPayload(input, ticket, { version: 1, ...meta, capturedPolicy, body });
      if (!ciphertext || !ownerStillCurrent(ticket, input)) { ciphertext?.fill(0); return base(input, 'unavailable', input.scheduleRef, old.revision); }
      const next: StoredRow = { ...old, ...meta, state: 'scheduled', claimNonce: null, claimStartedAt: null, ciphertext };
      const result = await replace(input, ticket, old, next, capturedPolicy); ciphertext.fill(0);
      return base(input, result === 'saved' ? 'edited' : result === 'conflict' ? 'conflict' : result === 'policy-review' ? 'policy-review' : result === 'stale-owner' ? 'stale-owner' : 'unavailable', input.scheduleRef,
        result === 'saved' ? next.revision : old.revision);
    } catch { return base(input, 'unavailable', input.scheduleRef, null); }
    finally { release(input); }
  }
  async function list(context: RequestContext): Promise<ScheduledListResult> {
    const ticket = capture(context);
    if (!ticket) return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status: 'stale-owner', rows: [], legacyHeldCount: 0, legacyReviewUnavailable: false, mode: null };
    activeRequests.add(context.requestId);
    try {
      if (ticket.scope.kind === 'guest') {
        const rows = [...(volatileByOwner.get(ticket.ownerKey)?.values() ?? [])].map(volatileSummary)
          .sort((a, b) => (a.dueAtMs ?? 0) - (b.dueAtMs ?? 0));
        return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status: 'ready', rows,
          legacyHeldCount: 0, legacyReviewUnavailable: false, mode: 'volatile' };
      }
      const db = await database(); if (!db) return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status: 'unavailable', rows: [], legacyHeldCount: 0, legacyReviewUnavailable: false, mode: 'durable' };
      const found = await scanOwned(db, ticket);
      if (!ownerStillCurrent(ticket, context)) return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status: 'stale-owner', rows: [], legacyHeldCount: 0, legacyReviewUnavailable: false, mode: 'durable' };
      if (!found) return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status: 'unavailable', rows: [], legacyHeldCount: 0, legacyReviewUnavailable: false, mode: 'durable' };
      const rows = found.rows.map(metadata).sort((a, b) => (a.dueAtMs ?? 0) - (b.dueAtMs ?? 0)).slice(0, MAX_ROWS_PER_OWNER);
      return { schemaVersion: 1, requestId: context.requestId, owner: Object.freeze({ ...context.owner }), status: 'ready', rows,
        legacyHeldCount: found.legacyHeldCount, legacyReviewUnavailable: found.legacyReviewUnavailable, mode: 'durable' };
    } finally { release(context); /* no plaintext is opened for listing */ }
  }
  async function cancel(input: RequestContext & { scheduleRef: string; expectedRevision: number }): Promise<ScheduledResult> {
    const ticket = capture(input); if (!ticket) return base(input, 'stale-owner', input.scheduleRef, null);
    activeRequests.add(input.requestId);
    try {
      if (ticket.scope.kind === 'guest') {
        const rows = volatileByOwner.get(ticket.ownerKey); const row = rows?.get(input.scheduleRef);
        if (!row || row.revision !== input.expectedRevision || row.state !== 'scheduled' || !sameOwner(row.owner, input.owner))
          return base(input, 'conflict', input.scheduleRef, row?.revision ?? null, 'volatile');
        const generation = volatileScheduleGenerations.get(ticket.ownerKey) ?? 0;
        if (generation >= Number.MAX_SAFE_INTEGER) return base(input, 'conflict', input.scheduleRef, row.revision, 'volatile');
        volatileScheduleGenerations.set(ticket.ownerKey, generation + 1);
        rows?.delete(row.operationId); wipeVolatile(row);
        return base(input, 'cancelled', input.scheduleRef, row.revision, 'volatile');
      }
      const db = await database(); if (!db || !validRef(input.scheduleRef) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) return base(input, 'invalid', input.scheduleRef, null);
      if (!ownerStillCurrent(ticket, input)) return base(input, 'stale-owner', input.scheduleRef, null);
      const tx = db.transaction([SCHEDULED, VAULT_META], 'readwrite'); const done = transactionPromise(tx); const store = tx.objectStore(SCHEDULED);
      const metaStore = tx.objectStore(VAULT_META);
      const id = recordId(ticket.ownerKey, input.scheduleRef); const generationId = generationRecordId(ticket.ownerKey);
      const [rawRow, rawGeneration] = await Promise.all([requestPromise(store.get(id)), requestPromise(metaStore.get(generationId))]);
      const row = decodeRow(rawRow, id);
      if (!row || row.ownerKey !== ticket.ownerKey || row.revision !== input.expectedRevision
        || (row.state !== 'scheduled' && row.state !== 'policy-review')) { tx.abort(); await done.catch(() => undefined); return base(input, 'conflict', input.scheduleRef, row?.revision ?? null); }
      if (!ownerStillCurrent(ticket, input)) { tx.abort(); await done.catch(() => undefined); return base(input, 'stale-owner', input.scheduleRef, row.revision); }
      const generation = decodeGeneration(rawGeneration, generationId, ticket.ownerKey);
      if (generation === null || generation >= Number.MAX_SAFE_INTEGER) { tx.abort(); await done.catch(() => undefined); return base(input, 'unavailable', input.scheduleRef, row.revision); }
      // Cancellation and generation advancement are one atomic commit. Any
      // older create admission will fail its generation comparison.
      metaStore.put({ id: generationId, ownerKey: ticket.ownerKey, version: 1, generation: generation + 1 });
      store.delete(id); await done;
      return base(input, ownerStillCurrent(ticket, input) ? 'cancelled' : 'stale-owner', input.scheduleRef, row.revision);
    } catch { return base(input, 'unavailable', input.scheduleRef, null); }
    finally { release(input); }
  }
  async function dispatch(input: RequestContext & { scheduleRef: string; expectedRevision: number }): Promise<ScheduledResult> {
    const ticket = capture(input); if (!ticket) return base(input, 'stale-owner', input.scheduleRef, null);
    activeRequests.add(input.requestId);
    try {
      if (ticket.scope.kind === 'guest') return await dispatchVolatile(input, ticket);
      if (!validRef(input.scheduleRef) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) return base(input, 'invalid', input.scheduleRef, null);
      const db = await database(); if (!db) return base(input, 'unavailable', input.scheduleRef, null);
      const id = recordId(ticket.ownerKey, input.scheduleRef);
      const row = await readRow(db, id);
      if (!row || row.ownerKey !== ticket.ownerKey || row.revision !== input.expectedRevision) return base(input, 'conflict', input.scheduleRef, row?.revision ?? null);
      if (row.state === 'dispatching' || row.state === 'delivery-unknown') return recoverClaim(input, ticket, row);
      if (row.dueAtMs > now()) return base(input, 'not-due', input.scheduleRef, row.revision);
      const nonce = randomNonce();
      if (!await claimRow(input, ticket, row, nonce, false)) return base(input, ownerStillCurrent(ticket, input) ? 'conflict' : 'stale-owner', input.scheduleRef, row.revision);
      const claimed: StoredRow = { ...row, state: 'dispatching', claimNonce: nonce, claimStartedAt: now() };
      const payload = await privatePayload(input, ticket, claimed);
      if (!payload || !ownerStillCurrent(ticket, input)) {
        await mutateState(input, ticket, claimed, 'delivery-unknown', nonce);
        return base(input, ownerStillCurrent(ticket, input) ? 'unavailable' : 'stale-owner', input.scheduleRef, row.revision);
      }
      const compatibility = deps.checkDispatchPolicy({ context: input, ticket, conversationId: row.conversationId,
        targetKey: row.targetKey, captured: payload.capturedPolicy });
      if (compatibility !== 'compatible') {
        await mutateState(input, ticket, claimed, 'policy-review', nonce);
        return base(input, compatibility === 'hold' ? 'policy-review' : 'unavailable', row.operationId, row.revision);
      }
      const outcome = await deps.enqueueJournal({ ...input, operationId: row.operationId, clientIntentId: row.clientIntentId,
        conversationId: row.conversationId, targetKey: row.targetKey, dueAtMs: row.dueAtMs,
        messageKind: row.messageKind, replyTo: row.replyTo, audiencePrefix: row.audiencePrefix, body: payload.body, capturedPolicy: payload.capturedPolicy });
      if (!ownerStillCurrent(ticket, input)) { await mutateState(input, ticket, claimed, 'delivery-unknown', nonce); return base(input, 'stale-owner', input.scheduleRef, row.revision); }
      if (outcome === 'accepted') {
        const removed = await removeClaimed(input, ticket, claimed);
        return base(input, removed ? 'journal-accepted' : 'conflict', input.scheduleRef, row.revision);
      }
      if (outcome === 'not-accepted') {
      await mutateState(input, ticket, claimed, 'scheduled', null);
        return base(input, 'blocked', input.scheduleRef, row.revision);
      }
      await mutateState(input, ticket, claimed, 'delivery-unknown', nonce);
      return base(input, 'delivery-unknown', input.scheduleRef, row.revision);
    } catch { return base(input, 'unavailable', input.scheduleRef, null); }
    finally { release(input); }
  }
  async function reconcile(context: RequestContext & { scheduleRef: string; expectedRevision: number }): Promise<ScheduledResult> {
    const ticket = capture(context, true);
    if (!ticket) return base(context, 'stale-owner', context.scheduleRef, null);
    if (!validRef(context.scheduleRef) || !Number.isSafeInteger(context.expectedRevision) || context.expectedRevision < 1)
      return base(context, 'invalid', context.scheduleRef, null);
    activeRequests.add(context.requestId);
    try {
      if (ticket.scope.kind === 'guest') {
        const row = volatileByOwner.get(ticket.ownerKey)?.get(context.scheduleRef);
        if (!row || !sameOwner(row.owner, context.owner) || row.revision !== context.expectedRevision)
          return base(context, 'conflict', context.scheduleRef, row?.revision ?? null, 'volatile');
        if (row.state === 'scheduled') return base(context, 'not-dispatched', row.operationId, row.revision, 'volatile');
        if (row.state === 'policy-review') return base(context, 'policy-review', row.operationId, row.revision, 'volatile');
        let status: VolatileScheduleStatus = 'unknown';
        try { status = await deps.volatileStatus?.(context, row.clientIntentId) ?? 'unknown'; } catch { status = 'unknown'; }
        if (!ownerStillCurrent(ticket, context)) return base(context, 'stale-owner', row.operationId, row.revision, 'volatile');
        if (status === 'server-accepted') {
          volatileByOwner.get(ticket.ownerKey)?.delete(row.operationId);
          wipeVolatile(row);
          return base(context, 'server-accepted', row.operationId, row.revision, 'volatile');
        }
        return base(context, 'delivery-unknown', row.operationId, row.revision, 'volatile');
      }

      const db = await database();
      if (!db) return base(context, 'unavailable', context.scheduleRef, null);
      if (!ownerStillCurrent(ticket, context)) return base(context, 'stale-owner', context.scheduleRef, null);
      const row = await readRow(db, recordId(ticket.ownerKey, context.scheduleRef));
      if (!ownerStillCurrent(ticket, context)) return base(context, 'stale-owner', context.scheduleRef, row?.revision ?? null);
      if (!row || row.ownerKey !== ticket.ownerKey || row.revision !== context.expectedRevision)
        return base(context, 'conflict', context.scheduleRef, row?.revision ?? null);
      if (row.state === 'scheduled') return base(context, 'not-dispatched', row.operationId, row.revision);
      if (row.state === 'policy-review') return base(context, 'policy-review', row.operationId, row.revision);

      let status: ScheduledJournalStatus;
      try { status = await deps.journalStatus(context, row.clientIntentId); } catch { status = 'unknown'; }
      if (!ownerStillCurrent(ticket, context)) return base(context, 'stale-owner', row.operationId, row.revision);
      if (status === 'accepted') {
        if (ticket.access === 'read-write') {
          const removed = await removeClaimed(context, ticket, row);
          if (!ownerStillCurrent(ticket, context)) return base(context, 'stale-owner', row.operationId, row.revision);
          if (!removed) return base(context, 'conflict', row.operationId, row.revision);
        }
        return base(context, 'journal-accepted', row.operationId, row.revision);
      }
      // A missing/pruned journal record cannot prove that dispatch never began.
      return base(context, 'delivery-unknown', row.operationId, row.revision);
    } catch {
      return base(context, 'unavailable', context.scheduleRef, null);
    } finally { release(context); }
  }
  function retireOwner(owner: OwnerSnapshot): void {
    const guestKeys = new Set<string>();
    for (const [ref, admission] of createAdmissions) if (sameOwner(owner, admission.owner)) {
      if (admission.ticket.scope.kind === 'guest') guestKeys.add(admission.ticket.ownerKey);
      retireCreateAdmission(ref);
    }
    for (const [ownerKey, rows] of volatileByOwner) if ([...rows.values()].some((row) => sameOwner(owner, row.owner))) guestKeys.add(ownerKey);
    for (const ownerKey of guestKeys) {
      const generation = volatileScheduleGenerations.get(ownerKey) ?? 0;
      if (generation < Number.MAX_SAFE_INTEGER) volatileScheduleGenerations.set(ownerKey, generation + 1);
    }
    wipeVolatileOwner(owner);
    for (const [requestId, requestOwner] of requestOwners) {
      if (sameOwner(owner, requestOwner)) release({ schemaVersion: 1, requestId, owner: requestOwner });
    }
  }
  function dispose(): void {
    disposed = true; opening = null; activeRequests.clear(); requestOwners.clear();
    for (const ref of createAdmissions.keys()) retireCreateAdmission(ref);
    for (const rows of volatileByOwner.values()) for (const row of rows.values()) wipeVolatile(row);
    volatileByOwner.clear(); volatileBytes = 0;
  }
  return { captureCreateAdmission, bindCreateAdmission, retireCreateAdmission, create, edit, list, cancel, dispatch, reconcile, retireOwner, dispose };
}
