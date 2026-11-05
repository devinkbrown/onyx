import {
  makeWireTimestamp,
  type AccountId,
  type ConversationId,
  type MessageId,
  type OpaqueWireBodyRef,
  type OwnerSnapshot,
  type PersistableRow,
  type PersistenceProjection,
  type PersistenceReason,
  type RequestContext,
  makeOpaqueWireBodyRef,
  canonicalTupleKey,
} from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import {
  LEGACY_MESSAGES,
  LEGACY_OUTBOX,
  OWNED_MESSAGES,
  OWNED_OUTBOX,
  QUARANTINE_DECISIONS,
  VAULT_META,
  openVaultV5,
  requestPromise,
  scopedRecordId,
  transactionPromise,
} from './migrations';
import { fromB64url, isEnvelope, isMultiEnvelope, isValidDmEnvelope, toB64url } from '../../src/lib/e2ee/dmCipher';
import { parseGroupEnvelope } from '../../src/lib/e2ee/groupEnvelope';

declare const recordIdBrand: unique symbol;
export type StorageRecordId = string & { readonly [recordIdBrand]: true };
export type VaultRowType = 'msg' | 'action' | 'notice' | 'join' | 'part' | 'quit' | 'kick' | 'mode' | 'topic' | 'nick' | 'system' | 'error' | 'whisper';
export type MessagePrivacy = 'plain' | 'dm-ciphertext' | 'room-ciphertext';
export interface ReplyContext { readonly id: string; readonly from: string; readonly text: string | null }
export interface OwnedMessageRow {
  readonly recordId: StorageRecordId;
  readonly messageId: MessageId | null;
  readonly conversationId: ConversationId;
  readonly from: string;
  readonly body: string;
  readonly atMs: number;
  readonly serverTime: ReturnType<typeof makeWireTimestamp>;
  readonly rowType: VaultRowType;
  readonly deleted: boolean;
  readonly redacted: boolean;
  readonly replyTo: ReplyContext | null;
  readonly privacy: MessagePrivacy;
}
export type OwnedMessageInput = Omit<OwnedMessageRow, 'recordId'> & { readonly wireBodyRef: OpaqueWireBodyRef | null; readonly localRecordId?: string };
export const createOpaqueWireBodyRef = makeOpaqueWireBodyRef;

export interface ConversationKeyScheme {
  readonly name: 'ascii' | 'rfc1459' | 'strict-rfc1459';
  readonly revision: string;
}
export interface OwnedStorageDependencies {
  readonly indexedDB?: IDBFactory;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (snapshot: OwnerSnapshot) => boolean;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly canonicalConversationKey: (owner: OwnerSnapshot, conversationId: ConversationId, scheme: ConversationKeyScheme) => string | null;
  readonly projectForPersistence: (input: { readonly context: RequestContext; readonly conversationId: ConversationId; readonly wireBodyRef: OpaqueWireBodyRef | null; readonly candidate: OwnedMessageInput }) => Promise<PersistenceProjection>;
  readonly currentPolicyRevision: (owner: OwnerSnapshot, conversationId: ConversationId) => string | null;
  readonly retentionPolicy?: (owner: OwnerSnapshot, conversationId: ConversationId) => { readonly keep: number; readonly ephemeralSeconds: number | null; readonly complete: boolean } | null;
  readonly retentionObservation?: (owner: OwnerSnapshot, conversationId: ConversationId) => { readonly keep: number; readonly ephemeralSeconds: number | null; readonly complete: boolean; readonly revision: string } | null;
  readonly isOfflineReadContext?: (request: RequestContext, ticket: LocalNamespaceTicket) => boolean;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly measureIdb?: (event: { readonly kind: 'read' | 'write'; readonly durationMs: number; readonly outcome: 'success' | 'failure'; readonly requestId?: string }) => void;
}
export interface OwnedRowsRequest extends RequestContext { readonly rows: readonly OwnedMessageInput[] }
export interface OwnedTargetRequest extends RequestContext { readonly conversationId: ConversationId; readonly limit: number; readonly cursor?: string | null }
export interface OwnedAroundRequest extends OwnedTargetRequest { readonly atMs: number }
export interface OwnedSearchRequest extends RequestContext { readonly query: string; readonly limit: number }
export interface OwnedExportRequest extends RequestContext { readonly conversationIds: readonly ConversationId[]; readonly messageIds?: readonly MessageId[] }
export interface OwnedClearRequest extends RequestContext { readonly conversationId: ConversationId }
export interface OwnedClearAcceptedRequest extends RequestContext { readonly conversationId: ConversationId; readonly recordIds: readonly string[] }
export interface ReindexOwnedRequest extends RequestContext { readonly confirmCurrentMapping: true }
export interface RecoveryIntent extends RequestContext {
  readonly sourceStore: 'messages' | 'outbox';
  readonly legacyRecordId: string;
  readonly reviewed: true;
  readonly mapping?: { readonly conversationId: ConversationId; readonly privacy: MessagePrivacy };
}
export interface DiscardIntent extends RequestContext { readonly sourceStore: 'messages' | 'outbox'; readonly legacyRecordId: string; readonly reviewed: true }

export type StorageStatusCode = 'ready' | 'unavailable' | 'blocked-upgrade' | 'stale-owner' | 'quota' | 'invalid';
export interface StorageStatus { readonly schemaVersion: 1; readonly owner: OwnerSnapshot; readonly status: StorageStatusCode }
export interface OwnedResult extends StorageStatus { readonly requestId: RequestContext['requestId'] | null; readonly affected: number }
export interface OwnedRowsResult extends StorageStatus {
  readonly requestId: RequestContext['requestId'];
  readonly rows: readonly OwnedMessageRow[];
  readonly cursor: string | null;
  readonly complete: boolean;
  readonly retentionScope: RetentionReadScope | null;
  readonly retentionScopes: readonly TargetRetentionScope[];
}
export interface OwnedExportResult extends StorageStatus {
  readonly requestId: RequestContext['requestId'];
  readonly rows: readonly OwnedMessageRow[];
  readonly complete: boolean;
  readonly retentionScopes: readonly TargetRetentionScope[];
}
export type RetentionReadScope =
  | { readonly kind: 'live'; readonly policyRevision: string; readonly lastSyncMs: number }
  | { readonly kind: 'cached'; readonly policyRevision: string; readonly lastSyncMs: number }
  | { readonly kind: 'unknown' };
export interface TargetRetentionScope { readonly conversationId: ConversationId; readonly scope: RetentionReadScope }
export type RetentionRefreshResult = { readonly status: 'refreshed' | 'unavailable' | 'stale-owner' | 'invalid'; readonly scope: RetentionReadScope };
export interface QuarantineSummary extends StorageStatus {
  readonly pendingMessages: number;
  readonly pendingOutbox: number;
  readonly admittedOutbox: number;
}
export interface QuarantineReviewResult extends StorageStatus {
  readonly rows: readonly { readonly sourceStore: 'messages' | 'outbox'; readonly legacyRecordId: string; readonly summary: string; readonly admitted: boolean }[];
}

interface StoredMessage {
  readonly id: string;
  readonly ownerKey: string;
  readonly targetKey: string;
  readonly scheme: ConversationKeyScheme;
  readonly row: OwnedMessageRow;
}
interface StoredDecision { readonly id: string; readonly storeName: 'messages' | 'outbox'; readonly legacyId: string; readonly status: 'recovered' | 'discarded'; readonly decidedAt: number }
interface StoredReviewOutbox { readonly id: string; readonly ownerKey: string; readonly targetKey: string; readonly state: 'quarantined-review'; readonly target: string; readonly text: string; readonly queuedAt: number }

const ROW_TYPES = new Set<VaultRowType>(['msg', 'action', 'notice', 'join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error', 'whisper']);
const PRIVACY = new Set<MessagePrivacy>(['plain', 'dm-ciphertext', 'room-ciphertext']);
const MAX_ROW_BODY = 64 * 1024;
const MAX_ROWS_PER_PUT = 200;
const MAX_EXPORT_ROWS = 16_384;
const MAX_SEARCH_ROWS = 80;
const MAX_SEARCH_SCAN = 4096;
const MAX_QUARANTINE_PREVIEW = 500;
const MIN_EPOCH_MS = 0;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const MAX_EPHEMERAL_SECONDS = 2_592_000;
const E2EE_PREFIXES = ['ONYXDM1 ', 'ONYXDMN1 ', 'ONYXROOM1 ', 'ONYXGROUP1 ', 'TSUMUGI1 '];
const asRecordId = (value: string): StorageRecordId => value as StorageRecordId;
const validText = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && (empty || value.length > 0) && value.length <= max && !/[\u0000\r\n]/u.test(value);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= MIN_EPOCH_MS && value <= MAX_EPOCH_MS;
const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot): boolean => a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
const normalizeLegacyType = (value: unknown): VaultRowType => typeof value === 'string' && ROW_TYPES.has(value as VaultRowType) ? value as VaultRowType : 'msg';
function validScheme(value: ConversationKeyScheme | null): value is ConversationKeyScheme {
  return value !== null && ['ascii', 'rfc1459', 'strict-rfc1459'].includes(value.name) && validText(value.revision, 64);
}
interface RetentionSnapshot { readonly keep: number; readonly ephemeralSeconds: number | null; readonly complete: boolean; readonly revision: string }
interface StoredRetentionSnapshotV1 {
  readonly id: string;
  readonly version: 1;
  readonly namespaceKey: string;
  readonly targetKey: string;
  readonly conversationId: string;
  readonly caseMapping: string;
  readonly policyRevision: string;
  readonly retention: { readonly kind: 'none' } | { readonly kind: 'ttl'; readonly seconds: string };
  readonly observedAtMs: number;
  readonly evaluatedThroughMs: number;
  readonly provenance: 'authenticated-complete-policy';
}
type KnownRetentionReadScope = Exclude<RetentionReadScope, { readonly kind: 'unknown' }>;
interface ResolvedRetention { readonly snapshot: RetentionSnapshot; readonly scope: KnownRetentionReadScope; readonly evaluationMs: number }
interface ExpiredCandidate { readonly id: IDBValidKey; readonly targetKey: string; readonly scheme: ConversationKeyScheme; readonly conversationId: ConversationId; readonly atMs: number; readonly retention: RetentionSnapshot; readonly scope: KnownRetentionReadScope; readonly evaluationMs: number; readonly namespaceKey: string; readonly metaId: string }
function sameRetention(a: RetentionSnapshot, b: RetentionSnapshot | null): boolean {
  return Boolean(b && a.keep === b.keep && a.ephemeralSeconds === b.ephemeralSeconds && a.complete === b.complete && a.revision === b.revision);
}
function validRetentionRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).byteLength <= 2048 && !/[\u0000\r\n]/u.test(value);
}
function validRetentionSeconds(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,6})$/u.test(value)) return false;
  const seconds = Number(value);
  return seconds === 0 || Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= MAX_EPHEMERAL_SECONDS;
}
function ownerEcho(owner: OwnerSnapshot): OwnerSnapshot { return Object.freeze({ ...owner }); }
function validInput(row: Omit<OwnedMessageRow, 'recordId'>): boolean {
  return validText(row.conversationId, 512) && validText(row.from, 256) && validText(row.body, MAX_ROW_BODY, true)
    && validTime(row.atMs) && (row.serverTime === null || makeWireTimestamp(row.serverTime) !== null)
    && ROW_TYPES.has(row.rowType) && typeof row.deleted === 'boolean' && typeof row.redacted === 'boolean'
    && PRIVACY.has(row.privacy) && (row.messageId === null || validText(row.messageId, 512))
    && (row.replyTo === null || (validText(row.replyTo.id, 512) && validText(row.replyTo.from, 256)
      && (row.privacy === 'plain' ? row.replyTo.text === null || validText(row.replyTo.text, 4096, true) : row.replyTo.text === null)))
    && validPrivacyBody(row.body, row.privacy);
}
function validPrivacyBody(body: string, privacy: MessagePrivacy): boolean {
  if (privacy === 'plain') return !E2EE_PREFIXES.some((prefix) => body.startsWith(prefix));
  if (privacy === 'room-ciphertext') {
    if (parseGroupEnvelope(body) === null) return false;
    const encoded = body.slice('ONYXROOM1 '.length);
    const decoded = fromB64url(encoded);
    return decoded !== null && toB64url(decoded) === encoded;
  }
  return isEnvelope(body) && isValidDmEnvelope(body);
}

async function deterministicRecordId(targetKey: string, identityKind: 'wire' | 'local' | 'generated', identity: string): Promise<StorageRecordId | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const input = new TextEncoder().encode(canonicalTupleKey(['owned-message-record-v1', targetKey, identityKind, identity]));
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
    return asRecordId(`m1-${toB64url(digest)}`);
  } catch {
    return null;
  }
}
function projectedRow(value: PersistableRow, expectedConversation: ConversationId): Omit<OwnedMessageRow, 'recordId'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const allowed = new Set(['messageId', 'conversationId', 'from', 'body', 'atMs', 'serverTime', 'rowType', 'deleted', 'redacted', 'replyTo', 'privacy']);
  if (Object.keys(row).some((key) => !allowed.has(key))) return null;
  if (row.conversationId !== expectedConversation || typeof row.body !== 'string' || typeof row.from !== 'string') return null;
  const reply = row.replyTo;
  let replyTo: ReplyContext | null = null;
  if (reply !== null) {
    if (!reply || typeof reply !== 'object') return null;
    const r = reply as Record<string, unknown>;
    if (Object.keys(r).some((key) => !['id', 'from', 'text'].includes(key)) || !validText(r.id, 512) || !validText(r.from, 256)) return null;
    if (row.privacy === 'plain') {
      if (r.text !== null && !validText(r.text, 4096, true)) return null;
      replyTo = { id: r.id, from: r.from, text: r.text as string | null };
    } else {
      // Ciphertext rows never retain decrypted previews.
      replyTo = { id: r.id, from: r.from, text: null };
    }
  }
  const serverTime = row.serverTime === null ? null : makeWireTimestamp(row.serverTime);
  if (row.serverTime !== null && serverTime === null) return null;
  const messageId = row.messageId === null ? null : typeof row.messageId === 'string' && validText(row.messageId, 512) ? row.messageId as MessageId : undefined;
  if (messageId === undefined || typeof row.atMs !== 'number' || typeof row.deleted !== 'boolean' || typeof row.redacted !== 'boolean' || typeof row.rowType !== 'string' || !ROW_TYPES.has(row.rowType as VaultRowType) || !PRIVACY.has(row.privacy as MessagePrivacy)) return null;
  const result: Omit<OwnedMessageRow, 'recordId'> = {
    messageId, conversationId: expectedConversation, from: row.from, body: row.body, atMs: row.atMs, serverTime,
    rowType: row.rowType as VaultRowType, deleted: row.deleted, redacted: row.redacted, replyTo, privacy: row.privacy as MessagePrivacy,
  };
  return validInput(result) ? result : null;
}

function pruneTarget(tx: IDBTransaction, ownerKey: string, targetKey: string, keep: number, maxAgeMs: number | null, currentTime: number): void {
  const request = tx.objectStore(OWNED_MESSAGES).index('by-owner-target').openCursor(IDBKeyRange.only([ownerKey, targetKey]));
  const records: Array<{ id: IDBValidKey; atMs: number; recordId: string }> = [];
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      const value = cursor.value as StoredMessage;
      if (value?.row && validTime(value.row.atMs) && typeof value.row.recordId === 'string') records.push({ id: cursor.primaryKey, atMs: value.row.atMs, recordId: value.row.recordId });
      cursor.continue();
      return;
    }
    records.sort((a, b) => b.atMs - a.atMs || b.recordId.localeCompare(a.recordId));
    for (const [index, record] of records.entries()) {
      const tooOld = maxAgeMs !== null && record.atMs < currentTime - maxAgeMs;
      if (index >= keep || tooOld) tx.objectStore(OWNED_MESSAGES).delete(record.id);
    }
  };
}
function plainRow(value: unknown): OwnedMessageRow | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredMessage>;
  const row = stored.row as Record<string, unknown> | undefined;
  if (Object.keys(value).some((key) => !['id', 'ownerKey', 'targetKey', 'scheme', 'row'].includes(key))
    || !row || Object.keys(row).some((key) => !['recordId', 'messageId', 'conversationId', 'from', 'body', 'atMs', 'serverTime', 'rowType', 'deleted', 'redacted', 'replyTo', 'privacy'].includes(key))
    || typeof stored.ownerKey !== 'string' || typeof stored.targetKey !== 'string' || !validScheme(stored.scheme ?? null)) return null;
  if (typeof row.recordId !== 'string' || scopedRecordId(stored.ownerKey, row.recordId) !== stored.id) return null;
  if (!(row.privacy === 'plain' || row.privacy === 'dm-ciphertext' || row.privacy === 'room-ciphertext')) return null;
  if (!(row.serverTime === null || makeWireTimestamp(row.serverTime) !== null)) return null;
  if (!(row.replyTo === null || (typeof row.replyTo === 'object' && row.replyTo !== null))) return null;
  const messageId = row.messageId === null ? null : typeof row.messageId === 'string' && validText(row.messageId, 512) ? row.messageId as MessageId : undefined;
  if (messageId === undefined) return null;
  const serverTime = row.serverTime === null ? null : makeWireTimestamp(row.serverTime);
  const reply = row.replyTo as Record<string, unknown> | null;
  const replyTo = reply === null ? null : validText(reply.id, 512) && validText(reply.from, 256) && validText(reply.text, 4096, true)
    ? { id: reply.id, from: reply.from, text: reply.text } : undefined;
  if (replyTo === undefined) return null;
  if (typeof row.deleted !== 'boolean' || typeof row.redacted !== 'boolean' || typeof row.conversationId !== 'string' || typeof row.from !== 'string' || typeof row.body !== 'string') return null;
  if (typeof row.atMs !== 'number' || !validTime(row.atMs) || typeof row.rowType !== 'string' || !ROW_TYPES.has(row.rowType as VaultRowType)) return null;
  const result: OwnedMessageRow = {
    recordId: asRecordId(String(row.recordId ?? '')),
    messageId,
    conversationId: String(row.conversationId || '') as ConversationId,
    from: String(row.from || ''),
    body: String(row.body || ''),
    atMs: Number(row.atMs),
    serverTime,
    rowType: row.rowType as VaultRowType,
    deleted: row.deleted,
    redacted: row.redacted,
    replyTo,
    privacy: row.privacy,
  };
  return validText(result.recordId, 512) && validInput(result) ? result : null;
}

/** Owner-scoped replacement persistence. Legacy v1-v3 rows are never visible
 * through normal message reads and cannot be assigned without an explicit,
 * reviewed recovery request. */
export function createOwnedStorage(deps: OwnedStorageDependencies) {
  let database: IDBDatabase | null = null;
  let dbStatus: 'unopened' | 'ready' | 'unavailable' | 'blocked-upgrade' = 'unopened';
  let disposed = false;
  let opening: Promise<StorageStatusCode> | null = null;
  const activeTransactions = new Set<IDBTransaction>();
  const idb = deps.indexedDB ?? globalThis.indexedDB;
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? (() => globalThis.crypto.randomUUID());
  const ticketCache = new WeakMap<object, LocalNamespaceTicket | null>();
  const retentionRefreshes = new Map<string, Promise<RetentionRefreshResult>>();
  function ticketFor(request: RequestContext): LocalNamespaceTicket | null {
    if (ticketCache.has(request)) return ticketCache.get(request) ?? null;
    const ticket = request.schemaVersion === 1 ? deps.namespaceForRequest(request) : null;
    ticketCache.set(request, ticket);
    return ticket;
  }

  async function ensureOpen(owner: OwnerSnapshot): Promise<StorageStatusCode> {
    if (!idb || disposed) { dbStatus = 'unavailable'; return 'unavailable'; }
    if (database) return deps.isCurrent(owner) && sameOwner(deps.ownerSnapshot(), owner) ? 'ready' : 'stale-owner';
    // The initial history burst can call put concurrently before any other
    // service path opens the vault. Share one open attempt so those calls do
    // not create and strand one connection apiece.
    let attempt = opening;
    if (!attempt) {
      attempt = (async (): Promise<StorageStatusCode> => {
        let candidate: IDBDatabase | null = null;
        let changedVersion = false;
        const opened = await openVaultV5({ indexedDB: idb, onVersionChange: () => {
          changedVersion = true;
          if (candidate && database === candidate) { database = null; dbStatus = 'unavailable'; }
        } });
        if (opened.kind !== 'ready') {
          const failureStatus: StorageStatusCode = opened.kind === 'blocked' ? 'blocked-upgrade' : 'unavailable';
          if (!disposed) dbStatus = failureStatus;
          return disposed ? 'unavailable' : failureStatus;
        }
        candidate = opened.database;
        if (disposed || changedVersion) {
          candidate.close();
          if (!disposed) dbStatus = 'unavailable';
          return 'unavailable';
        }
        // Only the shared attempt installs a handle. A versionchange callback
        // from an older handle cannot clear a newer connection.
        database = candidate;
        dbStatus = 'ready';
        return 'ready';
      })();
      opening = attempt;
    }
    let openedStatus: StorageStatusCode;
    try { openedStatus = await attempt; }
    finally { if (opening === attempt) opening = null; }
    if (openedStatus !== 'ready') return openedStatus;
    if (disposed) return 'unavailable';
    return deps.isCurrent(owner) && sameOwner(deps.ownerSnapshot(), owner) ? 'ready' : 'stale-owner';
  }

  function contextStatus(request: RequestContext, ticket: LocalNamespaceTicket): StorageStatusCode {
    if (disposed) return 'unavailable';
    if (!deps.isNamespaceCurrent(ticket, request)) return 'stale-owner';
    return dbStatus === 'ready' && database ? 'ready' : dbStatus === 'blocked-upgrade' ? 'blocked-upgrade' : 'unavailable';
  }
  function checkContext(request: RequestContext, ticket: LocalNamespaceTicket): StorageStatusCode {
    if (request.schemaVersion !== 1 || !validText(request.requestId, 128)) return 'invalid';
    return contextStatus(request, ticket);
  }
  function checkRequest(request: RequestContext): StorageStatusCode {
    const ticket = ticketFor(request);
    return ticket ? checkContext(request, ticket) : 'stale-owner';
  }
  function keyContext(owner: OwnerSnapshot, ticket: LocalNamespaceTicket, conversationId: ConversationId): { ownerKey: string; targetKey: string; scheme: ConversationKeyScheme } | null {
    const scheme = ticket.conversationScheme;
    const targetKey = validScheme(scheme) ? deps.canonicalConversationKey(owner, conversationId, scheme) : null;
    if (!validScheme(scheme) || !targetKey || !validText(targetKey, 512)) return null;
    return { ownerKey: ticket.ownerKey, targetKey, scheme };
  }
  function retentionNamespaceKey(ticket: LocalNamespaceTicket): string | null {
    if (ticket.scope.kind !== 'account' || !validText(ticket.scope.workspaceRef, 256) || !validText(ticket.scope.installationDeviceId, 64)) return null;
    return canonicalTupleKey(['retention-workspace-v1', ticket.scope.kind, String(ticket.scope.networkId), String(ticket.scope.accountId), ticket.scope.workspaceRef, ticket.scope.installationDeviceId]);
  }
  function retentionMetaId(namespaceKey: string, targetKey: string, scheme: ConversationKeyScheme): string {
    return canonicalTupleKey(['retention-snapshot-v1', namespaceKey, targetKey, scheme.name, scheme.revision]);
  }
  function liveRetention(owner: OwnerSnapshot, conversationId: ConversationId): RetentionSnapshot | null {
    const observation = deps.retentionObservation?.(owner, conversationId);
    const legacy = deps.retentionPolicy?.(owner, conversationId);
    const revision = observation?.revision ?? deps.currentPolicyRevision(owner, conversationId);
    const complete = observation ? observation.complete : legacy?.complete;
    const keep = observation?.keep ?? legacy?.keep;
    const seconds = observation ? observation.ephemeralSeconds : legacy?.ephemeralSeconds;
    if (complete !== true || !validRetentionRevision(revision) || !Number.isInteger(keep) || keep! < 1 || keep! > 400) return null;
    if (seconds === undefined || seconds !== null && seconds !== 0 && (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > MAX_EPHEMERAL_SECONDS)) return null;
    return { keep: keep!, ephemeralSeconds: seconds === 0 ? null : seconds, complete: true, revision };
  }
  function storedRetention(value: unknown, expected: { readonly id: string; readonly namespaceKey: string; readonly targetKey: string; readonly conversationId: string; readonly scheme: ConversationKeyScheme }): StoredRetentionSnapshotV1 | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Partial<StoredRetentionSnapshotV1>;
    if (Object.keys(value).length !== 11 || row.id !== expected.id || row.version !== 1 || row.namespaceKey !== expected.namespaceKey
      || row.targetKey !== expected.targetKey || row.conversationId !== expected.conversationId || row.caseMapping !== expected.scheme.revision
      || !validRetentionRevision(row.policyRevision) || !validTime(row.observedAtMs) || !validTime(row.evaluatedThroughMs)
      || row.evaluatedThroughMs < row.observedAtMs || row.provenance !== 'authenticated-complete-policy'
      || !row.retention || typeof row.retention !== 'object') return null;
    const retention = row.retention as { kind?: unknown; seconds?: unknown };
    if (retention.kind === 'none') {
      if (Object.keys(retention).length !== 1) return null;
    } else if (retention.kind === 'ttl') {
      if (Object.keys(retention).length !== 2 || !validRetentionSeconds(retention.seconds) || retention.seconds === '0') return null;
    } else return null;
    return row as StoredRetentionSnapshotV1;
  }
  function snapshotFromStored(value: StoredRetentionSnapshotV1): RetentionSnapshot {
    return { keep: 400, ephemeralSeconds: value.retention.kind === 'none' ? null : Number(value.retention.seconds), complete: true, revision: value.policyRevision };
  }
  async function purgeExpired(request: RequestContext, ticket: LocalNamespaceTicket, candidates: readonly ExpiredCandidate[]): Promise<boolean> {
    if (candidates.length === 0) return checkContext(request, ticket) === 'ready';
    if (candidates.length > MAX_EXPORT_ROWS || checkContext(request, ticket) !== 'ready'
      || candidates.some((item) => !checkScheme(ticket, item.scheme)
        || item.scope.kind === 'live' && !liveRetentionStillCurrent(request, item.conversationId, item.retention)
        || item.scope.kind === 'cached' && !(deps.isOfflineReadContext?.(request, ticket) ?? false))) return false;
    const tx = transaction([OWNED_MESSAGES, VAULT_META], 'readwrite');
    if (!tx) return false;
    const done = transactionPromise(tx);
    const store = tx.objectStore(OWNED_MESSAGES);
    const meta = tx.objectStore(VAULT_META);
    let valid = true;
    for (const candidate of candidates) {
      let rowReady = false;
      let metaReady = false;
      let currentRow: StoredMessage | undefined;
      let currentMeta: StoredRetentionSnapshotV1 | null = null;
      const considerDelete = (): void => {
        if (!valid) return;
        if (!rowReady || !metaReady) return;
        const cutoffMs = candidate.retention.ephemeralSeconds === null ? null : candidate.evaluationMs - candidate.retention.ephemeralSeconds * 1000;
        if (checkContext(request, ticket) !== 'ready' || !checkScheme(ticket, candidate.scheme)
          || !currentMeta || currentMeta.policyRevision !== candidate.retention.revision
          || !sameRetention(candidate.retention, snapshotFromStored(currentMeta))
          || currentMeta.observedAtMs > candidate.evaluationMs
          || candidate.scope.kind === 'live' && !liveRetentionStillCurrent(request, candidate.conversationId, candidate.retention)
          || candidate.scope.kind === 'cached' && !(deps.isOfflineReadContext?.(request, ticket) ?? false)) { valid = false; abort(tx); return; }
        if (currentRow && currentRow.ownerKey === ticket.ownerKey && currentRow.targetKey === candidate.targetKey && currentRow.row?.conversationId === candidate.conversationId
          && currentRow.scheme.revision === candidate.scheme.revision && cutoffMs !== null && currentRow.row.atMs < cutoffMs) store.delete(candidate.id);
      };
      const get = store.get(candidate.id);
      get.onsuccess = () => { currentRow = get.result as StoredMessage | undefined; rowReady = true; considerDelete(); };
      const metaGet = meta.get(candidate.metaId);
      metaGet.onsuccess = () => {
        currentMeta = storedRetention(metaGet.result, { id: candidate.metaId, namespaceKey: candidate.namespaceKey, targetKey: candidate.targetKey,
          conversationId: candidate.conversationId, scheme: candidate.scheme });
        metaReady = true; considerDelete();
      };
    }
    try { await done; } catch { return false; }
    return valid && checkContext(request, ticket) === 'ready'
      && candidates.every((item) => checkScheme(ticket, item.scheme)
        && (item.scope.kind !== 'live' || liveRetentionStillCurrent(request, item.conversationId, item.retention))
        && (item.scope.kind !== 'cached' || (deps.isOfflineReadContext?.(request, ticket) ?? false)));
  }
  function measure(kind: 'read' | 'write', started: number, outcome: 'success' | 'failure', requestId?: string): void {
    try { deps.measureIdb?.({ kind, durationMs: Math.max(0, now() - started), outcome, ...(requestId ? { requestId } : {}) }); } catch { /* metrics never affect storage outcomes */ }
  }
  function base(owner: OwnerSnapshot, status: StorageStatusCode): StorageStatus { return { schemaVersion: 1, owner: ownerEcho(owner), status }; }
  function result(request: RequestContext, status: StorageStatusCode, affected = 0): OwnedResult { return { ...base(request.owner, status), requestId: request.requestId, affected }; }
  function rowFromStored(value: unknown): OwnedMessageRow | null { return plainRow(value); }
  function transaction(storeNames: string | string[], mode: IDBTransactionMode): IDBTransaction | null {
    if (!database || disposed) return null;
    try {
      const tx = database.transaction(storeNames, mode);
      activeTransactions.add(tx);
      const release = (): void => { activeTransactions.delete(tx); };
      tx.addEventListener('complete', release, { once: true });
      tx.addEventListener('abort', release, { once: true });
      tx.addEventListener('error', release, { once: true });
      return tx;
    } catch { return null; }
  }
  function retentionKey(request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId): { readonly namespaceKey: string; readonly targetKey: string; readonly scheme: ConversationKeyScheme; readonly id: string } | null {
    const namespaceKey = retentionNamespaceKey(ticket);
    const context = keyContext(request.owner, ticket, conversationId);
    if (!namespaceKey || !context) return null;
    return { namespaceKey, targetKey: context.targetKey, scheme: context.scheme, id: retentionMetaId(namespaceKey, context.targetKey, context.scheme) };
  }
  function validCurrentContext(request: RequestContext, ticket: LocalNamespaceTicket, scheme: ConversationKeyScheme): boolean {
    return checkContext(request, ticket) === 'ready' && checkScheme(ticket, scheme);
  }
  function retentionRecord(input: { readonly id: string; readonly namespaceKey: string; readonly targetKey: string; readonly conversationId: ConversationId; readonly scheme: ConversationKeyScheme; readonly policy: RetentionSnapshot; readonly observedAtMs: number; readonly evaluatedThroughMs: number }): StoredRetentionSnapshotV1 {
    return {
      id: input.id, version: 1, namespaceKey: input.namespaceKey, targetKey: input.targetKey, conversationId: input.conversationId,
      caseMapping: input.scheme.revision, policyRevision: input.policy.revision,
      retention: input.policy.ephemeralSeconds === null ? { kind: 'none' } : { kind: 'ttl', seconds: String(input.policy.ephemeralSeconds) },
      observedAtMs: input.observedAtMs, evaluatedThroughMs: input.evaluatedThroughMs, provenance: 'authenticated-complete-policy',
    };
  }
  async function readRetentionRecord(request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, key: NonNullable<ReturnType<typeof retentionKey>>): Promise<StoredRetentionSnapshotV1 | null> {
    if (!validCurrentContext(request, ticket, key.scheme) || !database) return null;
    const tx = transaction(VAULT_META, 'readonly');
    if (!tx) return null;
    try {
      const value = await requestPromise(tx.objectStore(VAULT_META).get(key.id));
      await transactionPromise(tx);
      if (!validCurrentContext(request, ticket, key.scheme)) return null;
      return storedRetention(value, { ...key, conversationId });
    } catch { return null; }
  }
  async function persistRetentionRecord(request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, key: NonNullable<ReturnType<typeof retentionKey>>, policy: RetentionSnapshot, observedAtMs: number): Promise<StoredRetentionSnapshotV1 | null> {
    if (!validCurrentContext(request, ticket, key.scheme) || !validTime(observedAtMs) || !validRetentionRevision(policy.revision)) return null;
    const tx = transaction(VAULT_META, 'readwrite');
    if (!tx) return null;
    const done = transactionPromise(tx);
    const store = tx.objectStore(VAULT_META);
    const get = store.get(key.id);
    let saved: StoredRetentionSnapshotV1 | null = null;
    get.onsuccess = () => {
      if (!validCurrentContext(request, ticket, key.scheme) || !sameRetention(policy, liveRetention(request.owner, conversationId))) { abort(tx); return; }
      const previous = storedRetention(get.result, { ...key, conversationId });
      const stableObservedAt = Math.max(observedAtMs, previous?.observedAtMs ?? observedAtMs);
      const floor = Math.max(stableObservedAt, previous?.evaluatedThroughMs ?? stableObservedAt);
      const record = retentionRecord({ ...key, conversationId, policy, observedAtMs: stableObservedAt, evaluatedThroughMs: floor });
      saved = record;
      store.put(record);
    };
    try {
      await done;
      if (!validCurrentContext(request, ticket, key.scheme)) return null;
      return saved;
    } catch { return null; }
  }
  async function advanceRetentionFloor(request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, key: NonNullable<ReturnType<typeof retentionKey>>, expected: StoredRetentionSnapshotV1, floor: number): Promise<StoredRetentionSnapshotV1 | null> {
    if (!validTime(floor) || !validCurrentContext(request, ticket, key.scheme)) return null;
    const tx = transaction(VAULT_META, 'readwrite');
    if (!tx) return null;
    const done = transactionPromise(tx);
    const store = tx.objectStore(VAULT_META);
    const get = store.get(key.id);
    let current: StoredRetentionSnapshotV1 | null = null;
    get.onsuccess = () => {
      if (!validCurrentContext(request, ticket, key.scheme)) { abort(tx); return; }
      const row = storedRetention(get.result, { ...key, conversationId });
      if (!row || row.policyRevision !== expected.policyRevision || row.observedAtMs < expected.observedAtMs
        || row.retention.kind !== expected.retention.kind || (row.retention.kind === 'ttl' && expected.retention.kind === 'ttl' && row.retention.seconds !== expected.retention.seconds)) { abort(tx); return; }
      const evaluatedThroughMs = Math.max(row.evaluatedThroughMs, row.observedAtMs, floor);
      current = { ...row, evaluatedThroughMs };
      if (evaluatedThroughMs !== row.evaluatedThroughMs) store.put(current);
    };
    try {
      await done;
      return validCurrentContext(request, ticket, key.scheme) ? current : null;
    } catch { return null; }
  }
  async function resolveRetention(request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId): Promise<ResolvedRetention | null> {
    const key = retentionKey(request, ticket, conversationId);
    if (!key || !validCurrentContext(request, ticket, key.scheme)) return null;
    const live = liveRetention(request.owner, conversationId);
    const time = now();
    if (!validTime(time)) return null;
    if (live && ticket.access === 'read-write') {
      const previous = await readRetentionRecord(request, ticket, conversationId, key);
      if (!validCurrentContext(request, ticket, key.scheme) || !sameRetention(live, liveRetention(request.owner, conversationId))) return null;
      const evaluationMs = Math.max(time, previous?.observedAtMs ?? 0, previous?.evaluatedThroughMs ?? 0);
      const previousPolicy = previous ? snapshotFromStored(previous) : null;
      let saved = previousPolicy && sameRetention(live, previousPolicy)
        ? previous && evaluationMs > previous.evaluatedThroughMs
          ? await advanceRetentionFloor(request, ticket, conversationId, key, previous, evaluationMs)
          : previous
        : await persistRetentionRecord(request, ticket, conversationId, key, live, time);
      // A complete live observation governs this read even if replacing its
      // cached snapshot failed. Preserve the rollback floor independently when
      // that floor needs to advance before exposing rows.
      if (!saved && previous && evaluationMs > previous.evaluatedThroughMs) {
        saved = await advanceRetentionFloor(request, ticket, conversationId, key, previous, evaluationMs);
      }
      if (!validCurrentContext(request, ticket, key.scheme) || !sameRetention(live, liveRetention(request.owner, conversationId))) return null;
      if (!saved && previous && evaluationMs > previous.evaluatedThroughMs) return null;
      return {
        snapshot: live,
        scope: { kind: 'live', policyRevision: live.revision, lastSyncMs: saved?.observedAtMs ?? time },
        evaluationMs: Math.max(evaluationMs, saved?.observedAtMs ?? 0, saved?.evaluatedThroughMs ?? 0),
      };
    }
    if (ticket.scope.kind !== 'account' || !(deps.isOfflineReadContext?.(request, ticket) ?? false)) return null;
    const stored = await readRetentionRecord(request, ticket, conversationId, key);
    if (!stored || !validCurrentContext(request, ticket, key.scheme) || !(deps.isOfflineReadContext?.(request, ticket) ?? false)) return null;
    const evaluationMs = Math.max(time, stored.observedAtMs, stored.evaluatedThroughMs);
    const advanced = evaluationMs > stored.evaluatedThroughMs
      ? await advanceRetentionFloor(request, ticket, conversationId, key, stored, evaluationMs)
      : stored;
    if (!advanced || !validCurrentContext(request, ticket, key.scheme) || !(deps.isOfflineReadContext?.(request, ticket) ?? false)) return null;
    return {
      snapshot: snapshotFromStored(advanced),
      scope: { kind: 'cached', policyRevision: advanced.policyRevision, lastSyncMs: advanced.observedAtMs },
      evaluationMs: Math.max(evaluationMs, advanced.observedAtMs, advanced.evaluatedThroughMs),
    };
  }
  function liveRetentionStillCurrent(request: RequestContext, conversationId: ConversationId, expected: RetentionSnapshot): boolean {
    return sameRetention(expected, liveRetention(request.owner, conversationId));
  }
  function checkScheme(ticket: LocalNamespaceTicket, expected: ConversationKeyScheme): boolean {
    const current = ticket.conversationScheme;
    return validScheme(current) && current.name === expected.name && current.revision === expected.revision;
  }
  function abort(tx: IDBTransaction): void { try { tx.abort(); } catch { /* transaction already ended */ } }

  return {
    async open(): Promise<StorageStatus> {
      const owner = deps.ownerSnapshot();
      return base(owner, await ensureOpen(owner));
    },

    async refreshRetention(context: RequestContext, conversationId: ConversationId): Promise<RetentionRefreshResult> {
      const unknown: RetentionReadScope = { kind: 'unknown' };
      const ticket = ticketFor(context);
      if (!ticket || !validText(conversationId, 512)) return { status: 'invalid', scope: unknown };
      if (ticket.scope.kind !== 'account' || ticket.access !== 'read-write' || !deps.isNamespaceCurrent(ticket, context)
        || !deps.isCurrent(context.owner)) return { status: 'stale-owner', scope: unknown };
      const key = retentionKey(context, ticket, conversationId);
      const policy = liveRetention(context.owner, conversationId);
      if (!key || !policy) return { status: 'unavailable', scope: unknown };
      const refreshKey = key.id;
      const previous = retentionRefreshes.get(refreshKey);
      const operation = (async (): Promise<RetentionRefreshResult> => {
        if (previous) await previous.catch(() => undefined);
        if (!deps.isNamespaceCurrent(ticket, context) || ticket.access !== 'read-write' || !deps.isCurrent(context.owner)
          || !sameRetention(policy, liveRetention(context.owner, conversationId))) return { status: 'stale-owner', scope: unknown };
        const opened = await ensureOpen(context.owner);
        if (opened !== 'ready') return { status: opened === 'stale-owner' ? 'stale-owner' : 'unavailable', scope: unknown };
        if (!deps.isNamespaceCurrent(ticket, context) || !sameRetention(policy, liveRetention(context.owner, conversationId))) return { status: 'stale-owner', scope: unknown };
        const observedAtMs = now();
        if (!validTime(observedAtMs)) return { status: 'invalid', scope: unknown };
        const saved = await persistRetentionRecord(context, ticket, conversationId, key, policy, observedAtMs);
        if (!saved) return { status: deps.isNamespaceCurrent(ticket, context) ? 'unavailable' : 'stale-owner', scope: unknown };
        return { status: 'refreshed', scope: { kind: 'live', policyRevision: saved.policyRevision, lastSyncMs: saved.observedAtMs } };
      })();
      retentionRefreshes.set(refreshKey, operation);
      try { return await operation; }
      finally { if (retentionRefreshes.get(refreshKey) === operation) retentionRefreshes.delete(refreshKey); }
    },

    async put(request: OwnedRowsRequest): Promise<OwnedResult> {
      const started = now();
      const ticket = ticketFor(request);
      if (!ticket) return result(request, 'stale-owner');
      if (ticket.scope.kind === 'guest' || ticket.access !== 'read-write') return result(request, 'unavailable');
      if (request.schemaVersion !== 1 || !validText(request.requestId, 128)
        || !Array.isArray(request.rows) || request.rows.length === 0 || request.rows.length > MAX_ROWS_PER_PUT
        || request.rows.some((row) => !validInput(row))) return result(request, 'invalid');
      if (!deps.isCurrent(request.owner) || !sameOwner(deps.ownerSnapshot(), request.owner)
        || !deps.isNamespaceCurrent(ticket, request)) return result(request, 'stale-owner');
      // put is a public storage entry point and must not depend on an unrelated
      // retention refresh having won the startup race to open IndexedDB.
      const opened = await ensureOpen(request.owner);
      if (opened !== 'ready') return result(request, opened);
      // Retain the namespace captured before the await. Never reassign these
      // rows to whichever workspace happens to be selected after opening.
      if (!deps.isCurrent(request.owner) || !sameOwner(deps.ownerSnapshot(), request.owner)
        || !deps.isNamespaceCurrent(ticket, request)) return result(request, 'stale-owner');
      const initial = checkContext(request, ticket);
      if (initial !== 'ready') return result(request, initial);
      const ownerKey = ticket.ownerKey;
      type TargetRetention = { readonly key: string; readonly targetKey: string; readonly scheme: ConversationKeyScheme; readonly conversationId: ConversationId; readonly namespaceKey: string; readonly metaId: string; readonly retention: ResolvedRetention };
      const retentionByTarget = new Map<string, TargetRetention>();
      const prepared: Array<{ stored: StoredMessage; scheme: ConversationKeyScheme; conversationId: ConversationId; policyRevision: string; retention: ResolvedRetention } | null> = [];
      const cachedRetentionsStillCurrent = (): boolean => [...retentionByTarget.values()].every((target) =>
        liveRetentionStillCurrent(request, target.conversationId, target.retention.snapshot));
      for (const row of request.rows) {
        const indexed = keyContext(request.owner, ticket, row.conversationId);
        if (!indexed || indexed.ownerKey !== ownerKey) { prepared.push(null); continue; }
        let projection: PersistenceProjection;
        try { projection = await deps.projectForPersistence({ context: request, conversationId: row.conversationId, wireBodyRef: row.wireBodyRef, candidate: row }); }
        catch { return result(request, 'invalid'); }
        if (!deps.isCurrent(request.owner) || !sameOwner(deps.ownerSnapshot(), request.owner)
          || !deps.isNamespaceCurrent(ticket, request) || !cachedRetentionsStillCurrent()) return result(request, 'stale-owner');
        if (projection.kind !== 'persistable' || !validRetentionRevision(projection.policyRevision)
          || !deps.isNamespaceCurrent(ticket, request)) return result(request, 'stale-owner');
        const policyNow = deps.currentPolicyRevision(request.owner, row.conversationId);
        if (policyNow === null || policyNow !== projection.policyRevision || !checkScheme(ticketFor(request)!, indexed.scheme)) return result(request, 'stale-owner');
        const targetRetentionKey = canonicalTupleKey([ownerKey, indexed.targetKey, indexed.scheme.name, indexed.scheme.revision]);
        let targetRetention = retentionByTarget.get(targetRetentionKey);
        if (targetRetention) {
          if (!sameRetention(targetRetention.retention.snapshot, liveRetention(request.owner, row.conversationId))) return result(request, 'stale-owner');
        } else {
          const retention = await resolveRetention(request, ticket, row.conversationId);
          if (!retention || retention.scope.kind !== 'live' || !deps.isNamespaceCurrent(ticket, request)
            || !cachedRetentionsStillCurrent()) return result(request, 'unavailable');
          const resolvedKey = retentionKey(request, ticket, row.conversationId);
          if (!resolvedKey || resolvedKey.targetKey !== indexed.targetKey || resolvedKey.scheme.name !== indexed.scheme.name
            || resolvedKey.scheme.revision !== indexed.scheme.revision) return result(request, 'stale-owner');
          targetRetention = { key: targetRetentionKey, targetKey: indexed.targetKey, scheme: indexed.scheme, conversationId: row.conversationId,
            namespaceKey: resolvedKey.namespaceKey, metaId: resolvedKey.id, retention };
          retentionByTarget.set(targetRetentionKey, targetRetention);
        }
        const retention = targetRetention.retention;
        const normalized = projectedRow(projection.row, row.conversationId);
        if (!normalized) return result(request, 'invalid');
        const localRecordId = row.localRecordId;
        if (localRecordId !== undefined && !validText(localRecordId, 512)) return result(request, 'invalid');
        const identityKind = normalized.messageId !== null ? 'wire' : localRecordId !== undefined ? 'local' : 'generated';
        const identity = normalized.messageId ?? localRecordId ?? randomId();
        const recordId = await deterministicRecordId(indexed.targetKey, identityKind, identity);
        if (!recordId) return result(request, 'unavailable');
        if (!deps.isCurrent(request.owner) || !deps.isNamespaceCurrent(ticket, request)
          || deps.currentPolicyRevision(request.owner, row.conversationId) !== projection.policyRevision
          || !checkScheme(ticketFor(request)!, indexed.scheme) || !cachedRetentionsStillCurrent()
          || !sameRetention(retention.snapshot, liveRetention(request.owner, row.conversationId))) return result(request, 'stale-owner');
        const finalRow: OwnedMessageRow = { ...normalized, recordId };
        prepared.push({ stored: { id: scopedRecordId(ownerKey, recordId), ownerKey, targetKey: indexed.targetKey, scheme: indexed.scheme, row: finalRow }, scheme: indexed.scheme, conversationId: row.conversationId, policyRevision: projection.policyRevision, retention });
      }
      if (prepared.some((row) => row === null)) return result(request, 'invalid');
      if (checkContext(request, ticket) !== 'ready') return result(request, 'stale-owner');
      for (const item of prepared) if (item && (deps.currentPolicyRevision(request.owner, item.conversationId) !== item.policyRevision || !checkScheme(ticketFor(request)!, item.scheme) || item.retention.scope.kind !== 'live' || !liveRetentionStillCurrent(request, item.conversationId, item.retention.snapshot))) return result(request, 'stale-owner');
      if (!cachedRetentionsStillCurrent()) return result(request, 'stale-owner');
      const tx = transaction([OWNED_MESSAGES, VAULT_META], 'readwrite');
      if (!tx) return result(request, 'unavailable');
      const done = transactionPromise(tx);
      try {
        if (checkContext(request, ticket) !== 'ready') { abort(tx); return result(request, 'stale-owner'); }
        const store = tx.objectStore(OWNED_MESSAGES);
        const meta = tx.objectStore(VAULT_META);
        for (const row of prepared) if (row) store.put(row.stored);
        for (const target of retentionByTarget.values()) {
          const get = meta.get(target.metaId);
          get.onsuccess = () => {
            const current = storedRetention(get.result, { id: target.metaId, namespaceKey: target.namespaceKey,
              targetKey: target.targetKey, conversationId: target.conversationId, scheme: target.scheme });
            const policyStillCurrent = [...prepared].every((item) => item !== null
              && deps.currentPolicyRevision(request.owner, item.conversationId) === item.policyRevision
              && checkScheme(ticketFor(request)!, item.scheme)
              && liveRetentionStillCurrent(request, item.conversationId, item.retention.snapshot));
            const wallClock = now();
            if (checkContext(request, ticket) !== 'ready' || !policyStillCurrent || !current
              || current.policyRevision !== target.retention.snapshot.revision
              || (current.retention.kind === 'none' ? target.retention.snapshot.ephemeralSeconds !== null
                : target.retention.snapshot.ephemeralSeconds !== Number(current.retention.seconds)) || !validTime(wallClock)) {
              abort(tx);
              return;
            }
            const evaluationMs = Math.max(target.retention.evaluationMs, current.observedAtMs, current.evaluatedThroughMs, wallClock);
            if (evaluationMs > current.evaluatedThroughMs) meta.put({ ...current, evaluatedThroughMs: evaluationMs });
            const maxAgeMs = target.retention.snapshot.ephemeralSeconds === null ? null : target.retention.snapshot.ephemeralSeconds * 1000;
            pruneTarget(tx, ownerKey, target.targetKey, target.retention.snapshot.keep, maxAgeMs, evaluationMs);
          };
        }
      } catch (error) {
        abort(tx);
        const status = (error as DOMException)?.name === 'QuotaExceededError' ? 'quota' : 'unavailable';
        measure('write', started, 'failure', request.requestId);
        return result(request, status);
      }
      try {
        await done;
        const current = checkContext(request, ticket);
        const schemeStillCurrent = prepared.every((item) => item !== null && checkScheme(ticketFor(request)!, item.scheme)
          && deps.currentPolicyRevision(request.owner, item.conversationId) === item.policyRevision
          && item.retention.scope.kind === 'live' && liveRetentionStillCurrent(request, item.conversationId, item.retention.snapshot));
        measure('write', started, current === 'ready' && schemeStillCurrent ? 'success' : 'failure', request.requestId);
        return result(request, current !== 'ready' ? current : schemeStillCurrent ? 'ready' : 'stale-owner', current === 'ready' && schemeStillCurrent ? prepared.length : 0);
      } catch (error) {
        measure('write', started, 'failure', request.requestId);
        return result(request, (error as DOMException)?.name === 'QuotaExceededError' ? 'quota' : checkRequest(request) === 'stale-owner' ? 'stale-owner' : 'unavailable');
      }
    },

    async get(request: OwnedTargetRequest): Promise<OwnedRowsResult> {
      return readTarget(request, false);
    },

    async around(request: OwnedAroundRequest): Promise<OwnedRowsResult> {
      return readTarget(request, true);
    },

    async search(request: OwnedSearchRequest): Promise<OwnedRowsResult> {
      const started = now();
      const initial = checkRequest(request);
      const empty = (status: StorageStatusCode, retentionScopes: readonly TargetRetentionScope[] = []): OwnedRowsResult => ({ ...base(request.owner, status), requestId: request.requestId, rows: [], cursor: null, complete: false, retentionScope: null, retentionScopes });
      if (initial !== 'ready') return empty(initial);
      const ticket = ticketFor(request);
      if (ticket?.scope.kind !== 'account') return empty('unavailable');
      if (!validText(request.query, 512) || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_SEARCH_ROWS) return empty('invalid');
      const scheme = ticket.conversationScheme;
      if (!validScheme(scheme)) return empty('invalid');
      const tx = transaction(OWNED_MESSAGES, 'readonly');
      if (!tx) return empty('unavailable');
      const done = transactionPromise(tx);
      const candidates: Array<{ readonly id: IDBValidKey; readonly row: OwnedMessageRow; readonly targetKey: string }> = [];
      const resultRows: OwnedMessageRow[] = [];
      const retentionByConversation = new Map<string, ResolvedRetention>();
      const retentionScopes = new Map<string, TargetRetentionScope>();
      const expired: ExpiredCandidate[] = [];
      let scanned = 0;
      let status: StorageStatusCode = 'ready';
      try {
        const ownerKey = ticket.ownerKey;
        if (!ownerKey) { abort(tx); return empty('stale-owner'); }
        const cursor = tx.objectStore(OWNED_MESSAGES).index('by-owner').openCursor(IDBKeyRange.only(ownerKey), 'prev');
        cursor.onsuccess = () => {
          if (status !== 'ready') return;
          if (checkRequest(request) !== 'ready' || !checkScheme(ticket, scheme)) { status = 'stale-owner'; abort(tx); return; }
          const entry = cursor.result;
          if (!entry || scanned >= MAX_SEARCH_SCAN) return;
          scanned += 1;
          const stored = entry.value as StoredMessage;
          const row = rowFromStored(stored);
          if (row && stored.ownerKey === ownerKey && stored.scheme.revision === scheme.revision
            && row.privacy === 'plain' && !row.deleted && !row.redacted
            && `${row.from}\n${row.body}`.toLocaleLowerCase().includes(request.query.trim().toLocaleLowerCase())) {
            const target = keyContext(request.owner, ticket, row.conversationId);
            if (!target || target.targetKey !== stored.targetKey) { status = 'invalid'; abort(tx); return; }
            candidates.push({ id: entry.primaryKey, row, targetKey: stored.targetKey });
          }
          entry.continue();
        };
        await done;
      } catch {
        status = checkRequest(request) === 'stale-owner' ? 'stale-owner' : 'unavailable';
      }
      if (status === 'ready' && (checkRequest(request) !== 'ready' || !checkScheme(ticket, scheme))) status = 'stale-owner';
      if (status === 'ready') {
        for (const candidate of candidates) {
          let resolved = retentionByConversation.get(candidate.row.conversationId);
          if (!resolved) {
            resolved = await resolveRetention(request, ticket, candidate.row.conversationId) ?? undefined;
            if (!resolved) { retentionScopes.set(candidate.row.conversationId, { conversationId: candidate.row.conversationId, scope: { kind: 'unknown' } }); status = 'unavailable'; break; }
            retentionByConversation.set(candidate.row.conversationId, resolved);
            retentionScopes.set(candidate.row.conversationId, { conversationId: candidate.row.conversationId, scope: resolved.scope });
          }
          const retentionKeyValue = retentionKey(request, ticket, candidate.row.conversationId);
          if (!retentionKeyValue) { status = 'invalid'; break; }
          const cutoffMs = resolved.snapshot.ephemeralSeconds === null ? null : resolved.evaluationMs - resolved.snapshot.ephemeralSeconds * 1000;
          if (cutoffMs !== null && candidate.row.atMs < cutoffMs) {
            expired.push({ id: candidate.id, targetKey: candidate.targetKey, scheme, conversationId: candidate.row.conversationId, atMs: candidate.row.atMs,
              retention: resolved.snapshot, scope: resolved.scope, evaluationMs: resolved.evaluationMs, namespaceKey: retentionKeyValue.namespaceKey, metaId: retentionKeyValue.id });
          } else if (resultRows.length < request.limit) resultRows.push(candidate.row);
        }
      }
      if (status === 'ready' && checkRequest(request) !== 'ready') status = 'stale-owner';
      if (status === 'ready') for (const [conversation, resolved] of retentionByConversation) {
        const latest = await resolveRetention(request, ticket, conversation as ConversationId);
        if (!latest || !sameRetention(resolved.snapshot, latest.snapshot) || latest.scope.kind !== resolved.scope.kind
          || latest.scope.policyRevision !== resolved.scope.policyRevision
          || latest.scope.kind === 'cached' && resolved.scope.kind === 'cached' && latest.scope.lastSyncMs !== resolved.scope.lastSyncMs) { status = 'unavailable'; break; }
      }
      if (status === 'ready' && expired.length > 0 && !await purgeExpired(request, ticket, expired)) status = checkRequest(request) === 'ready' ? 'unavailable' : 'stale-owner';
      measure('read', started, status === 'ready' ? 'success' : 'failure', request.requestId);
      return { ...base(request.owner, status), requestId: request.requestId, rows: status === 'ready' ? resultRows : [], cursor: null,
        complete: status === 'ready' && scanned < MAX_SEARCH_SCAN, retentionScope: null,
        retentionScopes: [...retentionScopes.values()].sort((left, right) => left.conversationId.localeCompare(right.conversationId)) };
    },

    async exportSelected(request: OwnedExportRequest): Promise<OwnedExportResult> {
      const started = now();
      const initial = checkRequest(request);
      const scopes: TargetRetentionScope[] = [];
      const empty = (status: StorageStatusCode): OwnedExportResult => ({ ...base(request.owner, status), requestId: request.requestId, rows: [], complete: false, retentionScopes: scopes });
      if (initial !== 'ready') return empty(initial);
      const ticket = ticketFor(request);
      if (ticket?.scope.kind !== 'account') return empty('unavailable');
      if (request.conversationIds.length === 0 || request.conversationIds.length > 4096 || (request.messageIds?.length ?? 0) > MAX_EXPORT_ROWS) return empty('invalid');
      const schemes = new Map<string, { key: string; scheme: ConversationKeyScheme; conversationId: ConversationId; retention: ResolvedRetention; namespaceKey: string; metaId: string }>();
      let unknownPolicy = false;
      for (const conversation of request.conversationIds) {
        const context = keyContext(request.owner, ticket, conversation);
        if (!context) return empty('invalid');
        const existing = schemes.get(context.targetKey);
        if (existing && existing.conversationId !== conversation) return empty('invalid');
        if (existing) continue;
        const retention = await resolveRetention(request, ticket, conversation);
        if (!retention) { scopes.push({ conversationId: conversation, scope: { kind: 'unknown' } }); unknownPolicy = true; continue; }
        const key = retentionKey(request, ticket, conversation);
        if (!key) return empty('invalid');
        schemes.set(context.targetKey, { key: context.ownerKey, scheme: context.scheme, conversationId: conversation, retention, namespaceKey: key.namespaceKey, metaId: key.id });
        scopes.push({ conversationId: conversation, scope: retention.scope });
      }
      if (unknownPolicy) return empty('unavailable');
      const ownerKey = ticket.ownerKey;
      if (!ownerKey) return empty('stale-owner');
      const selected = request.messageIds ? new Set<string>(request.messageIds) : null;
      const tx = transaction(OWNED_MESSAGES, 'readonly');
      if (!tx) return empty('unavailable');
      const done = transactionPromise(tx);
      const rows: OwnedMessageRow[] = [];
      const expired: ExpiredCandidate[] = [];
      let status: StorageStatusCode = 'ready';
      try {
        const cursor = tx.objectStore(OWNED_MESSAGES).index('by-owner').openCursor(IDBKeyRange.only(ownerKey));
        cursor.onsuccess = () => {
          if (status !== 'ready') return;
          if (checkRequest(request) !== 'ready' || [...schemes.values()].some((entry) => !checkScheme(ticket, entry.scheme))) { status = 'stale-owner'; abort(tx); return; }
          const entry = cursor.result;
          if (!entry || rows.length >= MAX_EXPORT_ROWS) return;
          const stored = entry.value as StoredMessage;
          const row = rowFromStored(stored);
          const selectedTarget = schemes.get(stored.targetKey);
          if (row && selectedTarget && row.conversationId === selectedTarget.conversationId) {
            const cutoffMs = selectedTarget.retention.snapshot.ephemeralSeconds === null ? null : selectedTarget.retention.evaluationMs - selectedTarget.retention.snapshot.ephemeralSeconds * 1000;
            if (cutoffMs !== null && row.atMs < cutoffMs) {
              expired.push({ id: entry.primaryKey, targetKey: stored.targetKey, scheme: selectedTarget.scheme, conversationId: selectedTarget.conversationId, atMs: row.atMs,
                retention: selectedTarget.retention.snapshot, scope: selectedTarget.retention.scope, evaluationMs: selectedTarget.retention.evaluationMs,
                namespaceKey: selectedTarget.namespaceKey, metaId: selectedTarget.metaId });
              entry.continue(); return;
            }
          }
          if (row && schemes.has(stored.targetKey) && stored.scheme.revision === schemes.get(stored.targetKey)?.scheme.revision && !row.deleted && !row.redacted && (!selected || (row.messageId !== null && selected.has(row.messageId)))) rows.push(row);
          entry.continue();
        };
        await done;
      } catch { status = checkRequest(request) === 'stale-owner' ? 'stale-owner' : 'unavailable'; }
      if (status === 'ready' && checkRequest(request) !== 'ready') status = 'stale-owner';
      if (status === 'ready') for (const entry of schemes.values()) {
        const latest = await resolveRetention(request, ticket, entry.conversationId);
        if (!latest || !sameRetention(entry.retention.snapshot, latest.snapshot) || latest.scope.kind !== entry.retention.scope.kind
          || latest.scope.policyRevision !== entry.retention.scope.policyRevision
          || latest.scope.kind === 'cached' && entry.retention.scope.kind === 'cached' && latest.scope.lastSyncMs !== entry.retention.scope.lastSyncMs) { status = 'unavailable'; break; }
      }
      if (status === 'ready' && expired.length > 0 && !await purgeExpired(request, ticket, expired)) status = checkRequest(request) === 'ready' ? 'unavailable' : 'stale-owner';
      measure('read', started, status === 'ready' ? 'success' : 'failure', request.requestId);
      return { ...base(request.owner, status), requestId: request.requestId, rows: status === 'ready' ? rows : [], complete: status === 'ready' && rows.length < MAX_EXPORT_ROWS, retentionScopes: scopes };
    },

    async clear(request: OwnedClearRequest): Promise<OwnedResult> {
      const started = now();
      const status = checkRequest(request);
      if (status !== 'ready') return result(request, status);
      const ticket = ticketFor(request);
      if (ticket?.scope.kind !== 'account' || ticket.access !== 'read-write') return result(request, 'unavailable');
      const context = keyContext(request.owner, ticket, request.conversationId);
      if (!context) return result(request, 'invalid');
      const tx = transaction(OWNED_MESSAGES, 'readwrite');
      if (!tx) return result(request, 'unavailable');
      const done = transactionPromise(tx);
      let removed = 0;
      try {
        const cursor = tx.objectStore(OWNED_MESSAGES).index('by-owner-target').openCursor(IDBKeyRange.only([context.ownerKey, context.targetKey]));
        cursor.onsuccess = () => {
          if (checkRequest(request) !== 'ready' || !checkScheme(ticketFor(request)!, context.scheme)) { abort(tx); return; }
          const entry = cursor.result;
          if (entry) { entry.delete(); removed += 1; entry.continue(); }
        };
        await done;
        const finalStatus = checkRequest(request) === 'ready' && checkScheme(ticketFor(request)!, context.scheme) ? 'ready' : 'stale-owner';
        measure('write', started, finalStatus === 'ready' ? 'success' : 'failure', request.requestId);
        return result(request, finalStatus, finalStatus === 'ready' ? removed : 0);
      } catch (error) {
        measure('write', started, 'failure', request.requestId);
        return result(request, checkRequest(request) === 'stale-owner' ? 'stale-owner' : (error as DOMException)?.name === 'QuotaExceededError' ? 'quota' : 'unavailable');
      }
    },

    /** Delete only the accepted record ids sealed into a current eviction plan. */
    async clearAcceptedRecords(request: OwnedClearAcceptedRequest): Promise<number | null> {
      const ticket = ticketFor(request);
      if (!ticket || checkRequest(request) !== 'ready' || ticket.scope.kind !== 'account' || ticket.access !== 'read-write') return null;
      if (request.recordIds.length > 16_384 || new Set(request.recordIds).size !== request.recordIds.length
        || request.recordIds.some((id) => !validText(id, 512))) return null;
      const context = keyContext(request.owner, ticket, request.conversationId);
      if (!context) return null;
      const tx = transaction(OWNED_MESSAGES, 'readwrite'); if (!tx) return null;
      const done = transactionPromise(tx); const store = tx.objectStore(OWNED_MESSAGES);
      let removed = 0; let failed = false;
      await new Promise<void>((resolve) => {
        const step = (index: number): void => {
          if (!checkScheme(ticket, context.scheme) || checkRequest(request) !== 'ready') { failed = true; abort(tx); resolve(); return; }
          const recordId = request.recordIds[index];
          if (recordId === undefined) { resolve(); return; }
          const get = store.get(scopedRecordId(ticket.ownerKey, recordId));
          get.onerror = () => { failed = true; abort(tx); resolve(); };
          get.onsuccess = () => {
            if (!checkScheme(ticket, context.scheme) || checkRequest(request) !== 'ready') { failed = true; abort(tx); resolve(); return; }
            const stored = get.result as StoredMessage | undefined;
            if (stored !== undefined) {
              const row = rowFromStored(stored);
              if (!row || stored.ownerKey !== ticket.ownerKey || stored.targetKey !== context.targetKey || row.conversationId !== request.conversationId) { failed = true; abort(tx); resolve(); return; }
              store.delete(stored.id); removed += 1;
            }
            step(index + 1);
          };
        };
        step(0);
      });
      try { await done; } catch { return null; }
      return !failed && checkRequest(request) === 'ready' && checkScheme(ticket, context.scheme) ? removed : null;
    },

    async reindexOwned(request: ReindexOwnedRequest): Promise<OwnedResult> {
      const initial = checkRequest(request);
      if (initial !== 'ready') return result(request, initial);
      if (ticketFor(request)?.scope.kind !== 'account' || ticketFor(request)?.access !== 'read-write') return result(request, 'unavailable');
      if (request.confirmCurrentMapping !== true) return result(request, 'invalid');
      const ownerKey = ticketFor(request)?.ownerKey;
      if (!ownerKey) return result(request, 'stale-owner');
      const tx = transaction(OWNED_MESSAGES, 'readwrite');
      if (!tx) return result(request, 'unavailable');
      const done = transactionPromise(tx);
      const entries: Array<{ primaryKey: IDBValidKey; value: StoredMessage; newTarget: string; scheme: ConversationKeyScheme }> = [];
      const targetDisplay = new Map<string, string>();
      let ambiguous = false;
      const cursor = tx.objectStore(OWNED_MESSAGES).index('by-owner').openCursor(IDBKeyRange.only(ownerKey));
      cursor.onsuccess = () => {
        if (checkRequest(request) !== 'ready') { abort(tx); return; }
        const item = cursor.result;
        if (!item) return;
        const value = item.value as StoredMessage;
        const scheme = ticketFor(request)?.conversationScheme ?? null;
        const newTarget = validScheme(scheme) ? deps.canonicalConversationKey(request.owner, value.row.conversationId, scheme) : null;
        if (!validScheme(scheme) || !newTarget || !validText(newTarget, 512)) { ambiguous = true; abort(tx); return; }
        const previousDisplay = targetDisplay.get(newTarget);
        if (previousDisplay !== undefined && previousDisplay !== value.row.conversationId) { ambiguous = true; abort(tx); return; }
        targetDisplay.set(newTarget, value.row.conversationId);
        entries.push({ primaryKey: item.primaryKey, value, newTarget, scheme });
        item.continue();
      };
      try { await done; } catch { return result(request, ambiguous ? 'invalid' : 'stale-owner'); }
      if (checkRequest(request) !== 'ready' || entries.some((item) => !checkScheme(ticketFor(request)!, item.scheme))) return result(request, 'stale-owner');
      const write = transaction(OWNED_MESSAGES, 'readwrite');
      if (!write) return result(request, 'unavailable');
      const writeDone = transactionPromise(write);
      try {
        if (checkRequest(request) !== 'ready') { abort(write); return result(request, 'stale-owner'); }
        const store = write.objectStore(OWNED_MESSAGES);
        for (const item of entries) store.put({ ...item.value, targetKey: item.newTarget, scheme: item.scheme });
        await writeDone;
      } catch { abort(write); return result(request, 'unavailable'); }
      return result(request, checkRequest(request) === 'ready' ? 'ready' : 'stale-owner', checkRequest(request) === 'ready' ? entries.length : 0);
    },

    async quarantineSummary(request: RequestContext): Promise<QuarantineSummary> {
      const owner = request.owner;
      const initial = checkRequest(request);
      const summary = (status: StorageStatusCode, pendingMessages = 0, pendingOutbox = 0, admittedOutbox = 0): QuarantineSummary => ({ ...base(owner, status), pendingMessages, pendingOutbox, admittedOutbox });
      if (initial !== 'ready') return summary(initial);
      if (ticketFor(request)?.scope.kind !== 'account' || ticketFor(request)?.access !== 'read-write') return summary('unavailable');
      const started = now();
      const tx = transaction([LEGACY_MESSAGES, LEGACY_OUTBOX, QUARANTINE_DECISIONS], 'readonly');
      if (!tx) return summary('unavailable');
      const counts = await scanQuarantine(tx, MAX_QUARANTINE_PREVIEW, null);
      if (checkRequest(request) !== 'ready') { measure('read', started, 'failure', request.requestId); return summary('stale-owner'); }
      measure('read', started, counts.ok ? 'success' : 'failure');
      return counts.ok ? summary('ready', counts.pendingMessages, counts.pendingOutbox, counts.admittedOutbox) : summary('unavailable');
    },

    async reviewQuarantine(request: RequestContext): Promise<QuarantineReviewResult> {
      const owner = request.owner;
      const initial = checkRequest(request);
      const empty = (status: StorageStatusCode): QuarantineReviewResult => ({ ...base(owner, status), rows: [] });
      if (initial !== 'ready') return empty(initial);
      if (ticketFor(request)?.scope.kind !== 'account' || ticketFor(request)?.access !== 'read-write') return empty('unavailable');
      const tx = transaction([LEGACY_MESSAGES, LEGACY_OUTBOX, QUARANTINE_DECISIONS], 'readonly');
      if (!tx) return empty('unavailable');
      const scanned = await scanQuarantine(tx, MAX_QUARANTINE_PREVIEW, 'preview');
      if (checkRequest(request) !== 'ready') return empty('stale-owner');
      return scanned.ok ? { ...base(owner, 'ready'), rows: scanned.preview } : empty('unavailable');
    },

    async recoverExplicit(request: RecoveryIntent): Promise<OwnedResult> {
      const initial = checkRequest(request);
      if (initial !== 'ready') return result(request, initial);
      const ticket = ticketFor(request);
      if (ticket?.scope.kind !== 'account' || ticket.access !== 'read-write') return result(request, 'unavailable');
      if (!request.reviewed || !validText(request.legacyRecordId, 512)) return result(request, 'invalid');
      const sourceName = request.sourceStore === 'messages' ? LEGACY_MESSAGES : LEGACY_OUTBOX;
      const readTx = transaction([sourceName, QUARANTINE_DECISIONS], 'readonly');
      if (!readTx) return result(request, 'unavailable');
      const readDone = transactionPromise(readTx);
      let legacy: unknown;
      let decision: unknown;
      try {
        legacy = await requestPromise(readTx.objectStore(sourceName).get(request.legacyRecordId));
        decision = await requestPromise(readTx.objectStore(QUARANTINE_DECISIONS).get(decisionId(request.sourceStore, request.legacyRecordId)));
        await readDone;
      } catch { return result(request, 'unavailable'); }
      if (checkRequest(request) !== 'ready' || !legacy) return result(request, checkRequest(request) === 'ready' ? 'invalid' : 'stale-owner');
      if (decision) return result(request, 'invalid');
      const mapped = request.mapping;
      const context = mapped && ticket ? keyContext(request.owner, ticket, mapped.conversationId) : null;
      if (!mapped || !context || !PRIVACY.has(mapped.privacy)) return result(request, 'invalid');
      const started = now();
      const legacyObject = legacy as Record<string, unknown>;
      let recoveredMessage: StoredMessage | null = null;
      let recoveredOutbox: StoredReviewOutbox | null = null;
      let recoveryPolicyRevision: string | null = null;
      if (request.sourceStore === 'messages') {
        const messageId = validText(legacyObject.id, 512) ? legacyObject.id as MessageId : null;
        const body = typeof legacyObject.body === 'string' ? legacyObject.body : typeof legacyObject.text === 'string' ? legacyObject.text : '';
        const from = typeof legacyObject.from === 'string' ? legacyObject.from : 'unknown';
        const atMs = validTime(legacyObject.at) ? legacyObject.at : validTime(legacyObject.time) ? legacyObject.time : now();
        if (!validText(body, MAX_ROW_BODY, true) || !validText(from, 256)) return result(request, 'invalid');
        const candidate: OwnedMessageRow = { recordId: asRecordId(messageId ?? randomId()), messageId, conversationId: mapped.conversationId, from, body, atMs,
          serverTime: null, rowType: normalizeLegacyType(legacyObject.rowType ?? legacyObject.type), deleted: legacyObject.deleted === true,
          redacted: legacyObject.redacted === true, replyTo: null, privacy: mapped.privacy };
        const projection = await deps.projectForPersistence({ context: request, conversationId: candidate.conversationId, wireBodyRef: null, candidate: { ...candidate, wireBodyRef: null } });
        if (!deps.isNamespaceCurrent(ticket, request) || projection.kind !== 'persistable' || deps.currentPolicyRevision(request.owner, candidate.conversationId) !== projection.policyRevision) return result(request, 'invalid');
        recoveryPolicyRevision = projection.policyRevision;
        const projected = projectedRow(projection.row, candidate.conversationId);
        if (!projected || !checkScheme(ticketFor(request)!, context.scheme)) return result(request, 'invalid');
        const row: OwnedMessageRow = { ...projected, recordId: candidate.recordId };
        recoveredMessage = { id: scopedRecordId(context.ownerKey, row.recordId), ownerKey: context.ownerKey, targetKey: context.targetKey, scheme: context.scheme, row };
      } else {
        const admitted = legacyObject.wire_admitted === true || legacyObject.admitted === true || legacyObject.state === 'dispatching' || legacyObject.state === 'delivery-unknown';
        if (admitted) return result(request, 'invalid');
        const target = typeof legacyObject.target === 'string' ? legacyObject.target : mapped.conversationId;
        const text = typeof legacyObject.text === 'string' ? legacyObject.text : '';
        const queuedAt = validTime(legacyObject.queued_at) ? legacyObject.queued_at : now();
        if (!validText(target, 512) || !validText(text, MAX_ROW_BODY)) return result(request, 'invalid');
        const recordId = randomId();
        recoveredOutbox = { id: scopedRecordId(context.ownerKey, recordId), ownerKey: context.ownerKey, targetKey: context.targetKey, state: 'quarantined-review', target, text, queuedAt };
      }
      if (checkRequest(request) !== 'ready' || !checkScheme(ticketFor(request)!, context.scheme) || (recoveryPolicyRevision !== null && deps.currentPolicyRevision(request.owner, mapped.conversationId) !== recoveryPolicyRevision)) return result(request, 'stale-owner');
      const tx = transaction([OWNED_MESSAGES, OWNED_OUTBOX, QUARANTINE_DECISIONS], 'readwrite');
      if (!tx) return result(request, 'unavailable');
      const done = transactionPromise(tx);
      try {
        if (checkRequest(request) !== 'ready' || !checkScheme(ticketFor(request)!, context.scheme)) { abort(tx); return result(request, 'stale-owner'); }
        if (recoveredMessage) tx.objectStore(OWNED_MESSAGES).add(recoveredMessage);
        else if (recoveredOutbox) tx.objectStore(OWNED_OUTBOX).add(recoveredOutbox);
        const decisionRow: StoredDecision = { id: decisionId(request.sourceStore, request.legacyRecordId), storeName: request.sourceStore, legacyId: request.legacyRecordId, status: 'recovered', decidedAt: now() };
        tx.objectStore(QUARANTINE_DECISIONS).add(decisionRow);
        await done;
      } catch (error) {
        abort(tx);
        measure('write', started, 'failure', request.requestId);
        return result(request, (error as DOMException)?.name === 'QuotaExceededError' ? 'quota' : 'unavailable');
      }
      const finalStatus = checkRequest(request) === 'ready' && checkScheme(ticketFor(request)!, context.scheme)
        && (recoveryPolicyRevision === null || deps.currentPolicyRevision(request.owner, mapped.conversationId) === recoveryPolicyRevision) ? 'ready' : 'stale-owner';
      measure('write', started, finalStatus === 'ready' ? 'success' : 'failure', request.requestId);
      return result(request, finalStatus, finalStatus === 'ready' ? 1 : 0);
    },

    async discardQuarantine(request: DiscardIntent): Promise<OwnedResult> {
      const initial = checkRequest(request);
      if (initial !== 'ready') return result(request, initial);
      if (ticketFor(request)?.scope.kind !== 'account' || ticketFor(request)?.access !== 'read-write') return result(request, 'unavailable');
      if (!request.reviewed || !validText(request.legacyRecordId, 512)) return result(request, 'invalid');
      const storeName = request.sourceStore === 'messages' ? LEGACY_MESSAGES : LEGACY_OUTBOX;
      const readTx = transaction(storeName, 'readonly');
      if (!readTx) return result(request, 'unavailable');
      const readDone = transactionPromise(readTx);
      let exists = false;
      try { exists = await requestPromise(readTx.objectStore(storeName).getKey(request.legacyRecordId)) !== undefined; await readDone; } catch { return result(request, 'unavailable'); }
      if (!exists || checkRequest(request) !== 'ready') return result(request, exists ? 'stale-owner' : 'invalid');
      const tx = transaction(QUARANTINE_DECISIONS, 'readwrite');
      if (!tx) return result(request, 'unavailable');
      const done = transactionPromise(tx);
      try {
        if (checkRequest(request) !== 'ready') { abort(tx); return result(request, 'stale-owner'); }
        tx.objectStore(QUARANTINE_DECISIONS).add({ id: decisionId(request.sourceStore, request.legacyRecordId), storeName: request.sourceStore, legacyId: request.legacyRecordId, status: 'discarded', decidedAt: now() } satisfies StoredDecision);
        await done;
      } catch { abort(tx); return result(request, 'unavailable'); }
      const finalStatus = checkRequest(request);
      return result(request, finalStatus, finalStatus === 'ready' ? 1 : 0);
    },

    dispose(): void {
      disposed = true;
      for (const tx of activeTransactions) abort(tx);
      activeTransactions.clear();
      database?.close();
      database = null;
      dbStatus = 'unavailable';
    },
  };

  async function readTarget(request: OwnedTargetRequest, aroundMode: boolean): Promise<OwnedRowsResult> {
    const started = now();
    const initial = checkRequest(request);
    const empty = (status: StorageStatusCode, scope: RetentionReadScope = { kind: 'unknown' }): OwnedRowsResult => ({ ...base(request.owner, status), requestId: request.requestId, rows: [], cursor: null, complete: false, retentionScope: scope, retentionScopes: [] });
    if (initial !== 'ready') return empty(initial);
    const ticket = ticketFor(request);
    if (ticket?.scope.kind !== 'account') return empty('unavailable');
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 400 || request.cursor) return empty('invalid');
    if (aroundMode && !validTime((request as OwnedAroundRequest).atMs)) return empty('invalid');
    const context = ticket ? keyContext(request.owner, ticket, request.conversationId) : null;
    if (!context) return empty('invalid');
    const resolved = await resolveRetention(request, ticket, request.conversationId);
    if (!resolved) return empty('unavailable');
    const retentionKeyValue = retentionKey(request, ticket, request.conversationId);
    if (!retentionKeyValue) return empty('invalid');
    const cutoffMs = resolved.snapshot.ephemeralSeconds === null ? null : resolved.evaluationMs - resolved.snapshot.ephemeralSeconds * 1000;
    const tx = transaction(OWNED_MESSAGES, 'readonly');
    if (!tx) return empty('unavailable');
    const done = transactionPromise(tx);
    const rows: OwnedMessageRow[] = [];
    const expired: ExpiredCandidate[] = [];
    let status: StorageStatusCode = 'ready';
    try {
      const cursor = tx.objectStore(OWNED_MESSAGES).index('by-owner-target').openCursor(IDBKeyRange.only([context.ownerKey, context.targetKey]));
      cursor.onsuccess = () => {
        if (status !== 'ready') return;
        if (checkRequest(request) !== 'ready' || !checkScheme(ticketFor(request)!, context.scheme)) { status = 'stale-owner'; abort(tx); return; }
        const entry = cursor.result;
        if (!entry) return;
        const stored = entry.value as StoredMessage;
        const row = rowFromStored(stored);
        if (row && stored.scheme.name === context.scheme.name && stored.scheme.revision === context.scheme.revision
          && cutoffMs !== null && row.atMs < cutoffMs) {
          expired.push({ id: entry.primaryKey, targetKey: context.targetKey, scheme: context.scheme, conversationId: request.conversationId, atMs: row.atMs,
            retention: resolved.snapshot, scope: resolved.scope, evaluationMs: resolved.evaluationMs, namespaceKey: retentionKeyValue.namespaceKey, metaId: retentionKeyValue.id });
          entry.continue(); return;
        }
        if (row && stored.scheme.name === context.scheme.name && stored.scheme.revision === context.scheme.revision && !row.deleted && !row.redacted) rows.push(row);
        entry.continue();
      };
      await done;
    } catch { status = checkRequest(request) === 'stale-owner' ? 'stale-owner' : 'unavailable'; }
    if (status === 'ready' && (checkRequest(request) !== 'ready' || !checkScheme(ticket, context.scheme))) status = 'stale-owner';
    const latestRetention = status === 'ready' ? await resolveRetention(request, ticket, request.conversationId) : null;
    if (status === 'ready' && (!latestRetention || !sameRetention(resolved.snapshot, latestRetention.snapshot)
      || latestRetention.scope.kind !== resolved.scope.kind || latestRetention.scope.policyRevision !== resolved.scope.policyRevision
      || latestRetention.scope.kind === 'cached' && resolved.scope.kind === 'cached' && latestRetention.scope.lastSyncMs !== resolved.scope.lastSyncMs)) status = 'unavailable';
    if (status === 'ready' && expired.length > 0 && !await purgeExpired(request, ticket, expired)) status = checkRequest(request) === 'ready' ? 'unavailable' : 'stale-owner';
    let selected = rows;
    if (aroundMode && status === 'ready') {
      const anchor = (request as OwnedAroundRequest).atMs;
      selected = rows.slice().sort((a, b) => Math.abs(a.atMs - anchor) - Math.abs(b.atMs - anchor) || a.atMs - b.atMs || a.recordId.localeCompare(b.recordId)).slice(0, request.limit)
        .sort((a, b) => a.atMs - b.atMs || a.recordId.localeCompare(b.recordId));
    } else if (status === 'ready') selected = rows.slice().sort((a, b) => a.atMs - b.atMs || a.recordId.localeCompare(b.recordId)).slice(-request.limit);
    measure('read', started, status === 'ready' ? 'success' : 'failure', request.requestId);
    return { ...base(request.owner, status), requestId: request.requestId, rows: status === 'ready' ? selected : [], cursor: null,
      complete: status === 'ready' && rows.length <= request.limit, retentionScope: status === 'ready' ? resolved.scope : { kind: 'unknown' }, retentionScopes: [] };
  }
}

function decisionId(storeName: 'messages' | 'outbox', id: string): string { return JSON.stringify([storeName, id]); }

async function scanQuarantine(tx: IDBTransaction, limit: number, mode: 'preview' | null): Promise<{
  ok: boolean; pendingMessages: number; pendingOutbox: number; admittedOutbox: number;
  preview: QuarantineReviewResult['rows'];
}> {
  const transactionDone = transactionPromise(tx);
  const out = { ok: true, pendingMessages: 0, pendingOutbox: 0, admittedOutbox: 0, preview: [] as Array<{ sourceStore: 'messages' | 'outbox'; legacyRecordId: string; summary: string; admitted: boolean }> };
  try {
    const decisions = new Set<string>();
    const decisionCursor = tx.objectStore(QUARANTINE_DECISIONS).openCursor();
    await new Promise<void>((resolve, reject) => {
      decisionCursor.onerror = () => reject(decisionCursor.error ?? new Error('indexeddb_cursor_failed'));
      decisionCursor.onsuccess = () => {
        const cursor = decisionCursor.result;
        if (!cursor) { resolve(); return; }
        const value = cursor.value as StoredDecision;
        decisions.add(decisionId(value.storeName, value.legacyId));
        cursor.continue();
      };
    });
    for (const [storeName, sourceName] of [['messages', LEGACY_MESSAGES], ['outbox', LEGACY_OUTBOX]] as const) {
      const cursorRequest = tx.objectStore(sourceName).openCursor();
      await new Promise<void>((resolve, reject) => {
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('indexeddb_cursor_failed'));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) { resolve(); return; }
          const legacyId = String((cursor.value as { id?: unknown }).id ?? '');
          const raw = cursor.value as Record<string, unknown>;
          if (legacyId && !decisions.has(decisionId(storeName, legacyId))) {
            const admitted = storeName === 'outbox' && (raw.wire_admitted === true || raw.admitted === true || raw.state === 'dispatching' || raw.state === 'delivery-unknown');
            if (storeName === 'messages') out.pendingMessages += 1;
            else { out.pendingOutbox += 1; if (admitted) out.admittedOutbox += 1; }
            if (mode === 'preview' && out.preview.length < limit) out.preview.push({ sourceStore: storeName, legacyRecordId: legacyId, summary: storeName === 'messages' ? 'Unclassified local history row' : admitted ? 'Legacy queued item with uncertain delivery' : 'Unclassified legacy queued item', admitted });
          }
          cursor.continue();
        };
      });
    }
  } catch { out.ok = false; }
  try { await transactionDone; } catch { out.ok = false; }
  return out;
}
