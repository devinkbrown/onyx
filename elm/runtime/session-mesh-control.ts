import { formatIRCLine, parseIRCMessage } from '../../src/lib/irc/parser';
import type { EndpointId, OwnerSnapshot, PrivateIngressEvent, RequestContext, RequestId, SendAdmission } from './contracts';
import type { SessionOperationKind, SessionOperationLease } from './session-operation-owner';

export type SessionControlReason = 'invalid-request' | 'owner-changed' | 'account-proof-required' | 'offline'
  | 'busy' | 'backpressure' | 'transport-error' | 'response-timeout' | 'invalid-response' | 'unsupported'
  | 'stale-list' | 'inventory-limit' | 'no-such-session' | 'ambiguous-group' | 'temporarily-unavailable'
  | 'server-rejected' | 'dismissed';

export interface LocalSessionRow {
  readonly rowRef: string;
  readonly index: number;
  readonly signonMs: string;
  readonly state: 'attached' | 'detached' | 'unknown';
  readonly current: boolean;
}
export interface MeshSessionRow {
  readonly rowRef: string;
  readonly groupRef: string;
  readonly attachmentId: string | null;
  readonly nodeHex: string;
  readonly state: 'revoked' | 'unknown' | 'attached' | 'detached';
  readonly inventory: 'complete' | 'legacy-incomplete';
  readonly coverage: 'ready' | 'partial';
  readonly observedAt: string;
}
export interface SessionInventoryView {
  readonly kind: 'session-inventory'; readonly requestId: RequestId; readonly mode: 'local' | 'mesh';
  readonly status: 'idle' | 'pending' | 'ready' | 'partial' | 'stale' | 'unknown' | 'unsupported' | 'failed';
  readonly scanRef: string | null; readonly localRows: readonly LocalSessionRow[]; readonly meshRows: readonly MeshSessionRow[];
  readonly continuationAvailable: boolean; readonly scanComplete: boolean; readonly pageCount: number;
  readonly lastObservedAt: string | null; readonly reason: SessionControlReason | null;
}
export interface SessionRevocationView {
  readonly kind: 'session-revocation'; readonly requestId: RequestId; readonly revokeRef: string; readonly groupRef: string;
  readonly status: 'requesting' | 'preflight-pending' | 'local-denial-committed' | 'completion-unknown' | 'complete' | 'rejected' | 'unsupported';
  readonly reason: SessionControlReason | null;
}
export type SessionControlResult = {
  readonly context: RequestContext;
  readonly status: 'pending' | 'accepted' | 'held' | 'blocked' | 'unknown' | 'rejected';
  readonly reason: SessionControlReason | null;
  readonly view: SessionInventoryView | SessionRevocationView;
};

const MAX_LOCAL_ROWS = 4096;
const MAX_MESH_PAGE = 32;
const MAX_MESH_PAGES = 128;
const MAX_MESH_ROWS = 4096;
const MAX_REFS = 4096;
const REF_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;
const HEX32 = /^[0-9a-f]{32}$/u;
const HEX_NODE = /^[0-9a-f]{1,16}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/u;
const MAX_I64 = 9_223_372_036_854_775_807n;
const MAX_SIGNED_I64 = 9_223_372_036_854_775_807n;
const TIMEOUT_MS = 12_000;

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function safeRef(value: string): boolean { return REF_PATTERN.test(value); }
function validSignedI64(value: string): boolean {
  if (!SIGNED_DECIMAL.test(value)) return false;
  try { const parsed = BigInt(value); return parsed >= -MAX_SIGNED_I64 - 1n && parsed <= MAX_SIGNED_I64; } catch { return false; }
}
function validUnsignedI64(value: string): boolean {
  if (!DECIMAL.test(value)) return false;
  try { return BigInt(value) <= MAX_I64; } catch { return false; }
}
function admissionReason(value: SendAdmission): SessionControlReason {
  if (value.kind === 'unknown') return 'transport-error';
  if (value.kind !== 'blocked') return 'server-rejected';
  if (value.reason === 'owner-changed') return 'owner-changed';
  if (value.reason === 'offline') return 'offline';
  if (value.reason === 'backpressure') return 'backpressure';
  return 'invalid-request';
}
function ownNotice(event: PrivateIngressEvent, prefix: string, nick: string): string | null {
  if (event.sourceKind !== 'server') return null;
  const message = parseIRCMessage(event.line);
  return message.command === 'NOTICE' && message.prefix === prefix && message.params[0] === nick
    ? message.params.at(-1) ?? '' : null;
}

interface LocalPrivateRow {
  readonly selector: string;
  readonly index: number;
  readonly signonMs: string;
  readonly state: LocalSessionRow['state'];
  readonly current: boolean;
  readonly rowRef: string;
  readonly listEpoch: number;
}
interface MeshScan {
  readonly scanRef: string;
  readonly owner: OwnerSnapshot;
  readonly endpointId: EndpointId;
  readonly networkId: OwnerSnapshot['networkId'];
  readonly rows: MeshSessionRow[];
  readonly groupIds: Map<string, string>;
  readonly rowRefs: Map<string, string>;
  readonly operationRef: symbol;
  cursor: string | null;
  pages: number;
  complete: boolean;
  lastObservedAt: string | null;
  continuationAvailable: boolean;
  lease: SessionOperationLease;
  context: RequestContext;
  prefix: string;
  nick: string;
  timer: ReturnType<typeof setTimeout> | null;
  pendingPage: boolean;
  expectedPageRows: number | null;
  stagedRows: number;
  reason: SessionControlReason | null;
  status: SessionInventoryView['status'];
}
interface RevokeIntent {
  readonly revokeRef: string;
  readonly groupRef: string;
  readonly groupId: string;
  readonly networkId: OwnerSnapshot['networkId'];
  readonly accountId: NonNullable<OwnerSnapshot['accountId']>;
  operationRef: symbol;
  context: RequestContext;
  owner: OwnerSnapshot;
  endpointId: EndpointId;
  prefix: string;
  nick: string;
  lease: SessionOperationLease | null;
  timer: ReturnType<typeof setTimeout> | null;
  status: SessionRevocationView['status'];
  reason: SessionControlReason | null;
  acknowledged: boolean;
  uiDismissed: boolean;
}
interface ActiveLocalList {
  readonly operationRef: symbol;
  readonly lease: SessionOperationLease;
  context: RequestContext;
  readonly owner: OwnerSnapshot;
  readonly endpointId: EndpointId;
  readonly prefix: string;
  readonly nick: string;
  readonly epoch: number;
  readonly rows: LocalPrivateRow[];
  timer: ReturnType<typeof setTimeout> | null;
  unknown: boolean;
}
interface ActiveDrop {
  readonly operationRef: symbol;
  readonly lease: SessionOperationLease;
  context: RequestContext;
  readonly owner: OwnerSnapshot;
  readonly endpointId: EndpointId;
  readonly prefix: string;
  readonly nick: string;
  readonly row: LocalPrivateRow;
  phase: 'drop' | 'refresh';
  acknowledged: boolean;
  readonly rows: LocalPrivateRow[];
  timer: ReturnType<typeof setTimeout> | null;
}

export interface SessionMeshControlDependencies {
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentNick: () => string | null;
  readonly currentServerPrefix: () => string | null;
  readonly currentEndpointId: () => EndpointId;
  readonly acquireSessionOperation: (context: RequestContext, kind: SessionOperationKind, operationRef?: symbol) => SessionOperationLease | null;
  readonly sendLine: (input: { readonly context: RequestContext; readonly line: string; readonly lease: SessionOperationLease }) => SendAdmission;
  readonly deploymentAllowed: () => boolean;
  readonly now: () => number;
  readonly randomRef: () => string;
  readonly emit: (result: SessionControlResult) => void;
  readonly timeoutMs?: number;
}

/** Source-shaped private handler for local attachment and candidate mesh
 * SESSION operations. Opaque UI refs only index state captured from a fresh
 * authenticated list; wire SIDs, cursors, and group IDs remain private. */
export function createSessionMeshControl(deps: SessionMeshControlDependencies) {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  let disposed = false;
  let localEpoch = 0;
  let localRows: LocalPrivateRow[] = [];
  let localOwner: OwnerSnapshot | null = null;
  let activeLocalList: ActiveLocalList | null = null;
  let activeLocalDrop: ActiveDrop | null = null;
  let scan: MeshScan | null = null;
  let currentInventory: SessionInventoryView | null = null;
  const revocations = new Map<string, RevokeIntent>();

  const currentContext = (context: RequestContext): boolean => !disposed && context.schemaVersion === 1
    && sameOwner(context.owner, deps.currentOwner()) && deps.isCurrent(context.owner);
  const validSource = (owner: OwnerSnapshot, endpointId: EndpointId, prefix: string, nick: string): boolean => !disposed
    && sameOwner(owner, deps.currentOwner()) && deps.isCurrent(owner) && owner.physicalRef !== null
    && deps.currentEndpointId() === endpointId && deps.currentServerPrefix() === prefix && deps.currentNick() === nick;
  const publish = (context: RequestContext, status: SessionControlResult['status'], reason: SessionControlReason | null,
    view: SessionInventoryView | SessionRevocationView): SessionControlResult => {
    const result = Object.freeze({ context, status, reason, view });
    if (!disposed) deps.emit(result);
    return result;
  };
  function inventory(context: RequestContext, values: Partial<Omit<SessionInventoryView, 'kind' | 'requestId'>>): SessionInventoryView {
    return Object.freeze({ kind: 'session-inventory', requestId: context.requestId, mode: values.mode ?? 'local',
      status: values.status ?? 'idle', scanRef: values.scanRef ?? null, localRows: Object.freeze([...(values.localRows ?? [])]),
      meshRows: Object.freeze([...(values.meshRows ?? [])]), continuationAvailable: values.continuationAvailable ?? false,
      scanComplete: values.scanComplete ?? false, pageCount: values.pageCount ?? 0, lastObservedAt: values.lastObservedAt ?? null,
      reason: values.reason ?? null });
  }
  function revokeView(intent: RevokeIntent): SessionRevocationView {
    return Object.freeze({ kind: 'session-revocation', requestId: intent.context.requestId, revokeRef: intent.revokeRef,
      groupRef: intent.groupRef, status: intent.status, reason: intent.reason });
  }
  function activeLease(lease: SessionOperationLease): boolean { return lease.isCurrent(); }
  function finishLocal(entry: ActiveLocalList, status: SessionInventoryView['status'], reason: SessionControlReason | null,
    admissionStatus: SessionControlResult['status']): SessionControlResult {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    if (activeLocalList === entry && status !== 'unknown') activeLocalList = null;
    if (status !== 'unknown' && status !== 'stale') entry.lease.release();
    else { entry.unknown = true; entry.lease.markUnknown(); }
    if (status === 'ready') { localRows = [...entry.rows]; localOwner = entry.owner; localEpoch = entry.epoch; }
    const view = inventory(entry.context, { mode: 'local', status, localRows: status === 'ready' ? entry.rows.map(row => ({
      rowRef: row.rowRef, index: row.index, signonMs: row.signonMs, state: row.state, current: row.current,
    })) : localRows.filter(row => localOwner && sameOwner(localOwner, entry.owner)).map(row => ({
      rowRef: row.rowRef, index: row.index, signonMs: row.signonMs, state: row.state, current: row.current,
    })), scanComplete: status === 'ready', reason });
    currentInventory = view;
    return publish(entry.context, admissionStatus, reason, view);
  }
  function timeoutLocal(entry: ActiveLocalList): void {
    if (activeLocalList !== entry || !validSource(entry.owner, entry.endpointId, entry.prefix, entry.nick)) return;
    finishLocal(entry, 'unknown', 'response-timeout', 'unknown');
  }
  function startLocalList(context: RequestContext, lease?: SessionOperationLease): SessionControlResult {
    const owner = Object.freeze({ ...context.owner }); const endpointId = deps.currentEndpointId(); const prefix = deps.currentServerPrefix(); const nick = deps.currentNick();
    if (!currentContext(context)) return publish(context, 'blocked', 'owner-changed', inventory(context, { status: 'stale', reason: 'owner-changed' }));
    if (!owner.accountId) return publish(context, 'blocked', 'account-proof-required', inventory(context, { status: 'unsupported', reason: 'account-proof-required' }));
    if (!prefix || !nick || owner.physicalRef === null) return publish(context, 'blocked', 'offline', inventory(context, { status: 'unsupported', reason: 'offline' }));
    const retry = activeLocalList?.unknown && sameOwner(activeLocalList.owner, owner)
      && activeLocalList.endpointId === endpointId && activeLocalList.prefix === prefix && activeLocalList.nick === nick
      ? activeLocalList : null;
    if ((activeLocalList && !retry) || activeLocalDrop || scan) return publish(context, 'blocked', 'busy', inventory(context, { status: 'stale', reason: 'busy' }));
    if (retry?.timer) clearTimeout(retry.timer);
    const operationRef = lease?.operationRef ?? retry?.operationRef ?? Symbol('local-session-list');
    const acquired = lease ?? (retry?.lease ?? deps.acquireSessionOperation(context, 'local-list', operationRef));
    if (!acquired || !activeLease(acquired)) return publish(context, 'blocked', 'busy', inventory(context, { status: 'stale', reason: 'busy' }));
    const entry: ActiveLocalList = { operationRef, lease: acquired, context, owner, endpointId, prefix, nick, epoch: localEpoch + 1, rows: [], timer: null, unknown: false };
    activeLocalList = entry;
    entry.timer = setTimeout(() => timeoutLocal(entry), timeoutMs);
    const result = publish(context, 'pending', null, inventory(context, { status: 'pending' }));
    const admission = deps.sendLine({ context, line: formatIRCLine('SESSION', 'LIST', '*').trimEnd(), lease: acquired });
    if (admission.kind === 'blocked') return finishLocal(entry, 'failed', admissionReason(admission), 'blocked');
    if (admission.kind === 'unknown') { entry.unknown = true; acquired.markUnknown(); return finishLocal(entry, 'unknown', 'transport-error', 'unknown'); }
    return result;
  }
  function parseLocalRow(body: string, entry: ActiveLocalList | ActiveDrop): LocalPrivateRow | null {
    const match = /^SESSION LIST ([*-]) #([1-9][0-9]*) signon=(0|[1-9][0-9]*) (attached|detached|unknown) sid=([0-9a-f]{32}) scope=local-attachment$/u.exec(body);
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return null;
    const index = Number(match[2]);
    if (!Number.isSafeInteger(index) || index < 1 || index > MAX_LOCAL_ROWS) return null;
    if (!validUnsignedI64(match[3])) return null;
    const selector = `sid=${match[5]}`;
    const rowRef = deps.randomRef();
    if (!safeRef(rowRef) || entry.rows.some(row => row.index === index)) return null;
    return { selector, index, signonMs: match[3], state: match[4] as LocalPrivateRow['state'], current: match[1] === '*',
      rowRef, listEpoch: entry instanceof Object && 'epoch' in entry ? entry.epoch : localEpoch + 1 };
  }
  function startDropRefresh(entry: ActiveDrop): void {
    if (!validSource(entry.owner, entry.endpointId, entry.prefix, entry.nick) || !activeLease(entry.lease)) { finishDrop(entry, 'stale', 'owner-changed', 'unknown'); return; }
    entry.phase = 'refresh'; entry.rows.length = 0; entry.acknowledged = true;
    const admission = deps.sendLine({ context: entry.context, line: formatIRCLine('SESSION', 'LIST', '*').trimEnd(), lease: entry.lease });
    if (admission.kind === 'blocked') finishDrop(entry, 'unknown', admissionReason(admission), 'unknown');
    else if (admission.kind === 'unknown') { entry.lease.markUnknown(); finishDrop(entry, 'unknown', 'transport-error', 'unknown'); }
  }
  function finishDrop(entry: ActiveDrop, status: SessionInventoryView['status'], reason: SessionControlReason | null,
    resultStatus: SessionControlResult['status']): SessionControlResult {
    if (entry.timer) clearTimeout(entry.timer); entry.timer = null;
    if (activeLocalDrop === entry) activeLocalDrop = null;
    if (status === 'ready') { localRows = [...entry.rows]; localOwner = entry.owner; localEpoch = entry.row.listEpoch; entry.lease.release(); }
    else if (status === 'unknown' || status === 'stale') entry.lease.markUnknown();
    else entry.lease.release();
    const view = inventory(entry.context, { mode: 'local', status, localRows: status === 'ready' ? entry.rows.map(row => ({ rowRef: row.rowRef,
      index: row.index, signonMs: row.signonMs, state: row.state, current: row.current })) : [], scanComplete: status === 'ready', reason });
    currentInventory = view;
    return publish(entry.context, resultStatus, reason, view);
  }
  function parseMeshRow(body: string, entry: MeshScan): MeshSessionRow | null {
    const match = /^SESSION MESH group=([0-9a-f]{32}) attachment=([0-9a-f]{32}|-{32}) node=([0-9a-f]{1,16}) state=(revoked|unknown|attached|detached) inventory=(complete|legacy-incomplete) coverage=(ready|partial) observed_at=(0|[1-9][0-9]*)$/u.exec(body);
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6] || !match[7]) return null;
    if (!HEX32.test(match[1]) || !HEX_NODE.test(match[3]) || !validUnsignedI64(match[7]) || entry.rows.length >= MAX_MESH_ROWS) return null;
    const groupId = match[1]; let groupRef = entry.groupIds.get(groupId);
    if (!groupRef) {
      groupRef = deps.randomRef(); if (!safeRef(groupRef) || entry.groupIds.size >= MAX_REFS) return null;
      entry.groupIds.set(groupId, groupRef);
    }
    const rowRef = deps.randomRef(); if (!safeRef(rowRef) || entry.rowRefs.has(rowRef)) return null;
    entry.rowRefs.set(rowRef, groupId);
    return Object.freeze({ rowRef, groupRef, attachmentId: match[2] === '-'.repeat(32) ? null : match[2], nodeHex: match[3],
      state: match[4] as MeshSessionRow['state'], inventory: match[5] as MeshSessionRow['inventory'],
      coverage: match[6] as MeshSessionRow['coverage'], observedAt: match[7] });
  }
  function inventoryForScan(entry: MeshScan, status: SessionInventoryView['status'], reason: SessionControlReason | null): SessionInventoryView {
    return inventory(entry.context, { mode: 'mesh', status, scanRef: entry.scanRef, meshRows: entry.rows,
      continuationAvailable: entry.continuationAvailable, scanComplete: entry.complete, pageCount: entry.pages,
      lastObservedAt: entry.lastObservedAt, reason });
  }
  function endMeshPage(entry: MeshScan, body: string): boolean {
    const match = /^SESSION MESH end rows=(0|[1-9][0-9]*) complete=([01]) cursor=(none|[0-9a-f]{32}) observed_at=(0|[1-9][0-9]*); observations=(per-page)$/u.exec(body);
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return false;
    const count = Number(match[1]);
    if (!Number.isSafeInteger(count) || count !== entry.stagedRows || count > MAX_MESH_PAGE || !validUnsignedI64(match[4])) return false;
    const isComplete = match[2] === '1'; const cursor = match[3] === 'none' ? null : match[3];
    if (isComplete === (cursor !== null) || entry.pages >= MAX_MESH_PAGES || entry.rows.length > MAX_MESH_ROWS) return false;
    entry.pages += 1; entry.complete = isComplete; entry.cursor = cursor;
    entry.continuationAvailable = !isComplete && cursor !== null && entry.pages < MAX_MESH_PAGES && entry.rows.length < MAX_MESH_ROWS;
    entry.lastObservedAt = match[4]; entry.pendingPage = false; entry.expectedPageRows = null; entry.stagedRows = 0;
    if (entry.timer) clearTimeout(entry.timer); entry.timer = null;
    entry.status = isComplete ? 'ready' : 'partial';
    entry.lease.release();
    currentInventory = inventoryForScan(entry, entry.status, null);
    publish(entry.context, 'accepted', null, currentInventory);
    return true;
  }
  function beginMeshPage(entry: MeshScan, context: RequestContext, useExistingLease: boolean): SessionControlResult {
    if (!currentContext(context) || !validSource(entry.owner, entry.endpointId, entry.prefix, entry.nick) || !sameOwner(entry.owner, context.owner))
      return publish(context, 'blocked', 'owner-changed', inventory(context, { mode: 'mesh', status: 'stale', scanRef: entry.scanRef, reason: 'owner-changed' }));
    if (entry.pendingPage || !entry.continuationAvailable && entry.pages > 0) return publish(context, 'blocked', 'stale-list', inventoryForScan(entry, 'stale', 'stale-list'));
    const pagesSent = entry.pages;
    if (pagesSent >= MAX_MESH_PAGES) return publish(context, 'blocked', 'inventory-limit', inventoryForScan(entry, 'partial', 'inventory-limit'));
    const lease = useExistingLease ? entry.lease : deps.acquireSessionOperation(context, 'mesh-list', entry.operationRef);
    if (!lease || !activeLease(lease)) return publish(context, 'blocked', 'busy', inventoryForScan(entry, 'stale', 'busy'));
    entry.context = context; entry.pendingPage = true; entry.stagedRows = 0;
    entry.timer = setTimeout(() => {
      if (scan !== entry || !entry.pendingPage || !validSource(entry.owner, entry.endpointId, entry.prefix, entry.nick)) return;
      entry.pendingPage = false; entry.status = 'unknown'; entry.reason = 'response-timeout';
      lease.markUnknown(); currentInventory = inventoryForScan(entry, 'unknown', 'response-timeout');
      publish(context, 'unknown', 'response-timeout', currentInventory);
    }, timeoutMs);
    const command = entry.pages === 0
      ? formatIRCLine('SESSION', 'MESH', 'LIST').trimEnd()
      : formatIRCLine('SESSION', 'MESH', 'NEXT', entry.cursor ?? '').trimEnd();
    const result = publish(context, 'pending', null, inventoryForScan(entry, 'pending', null));
    const admission = deps.sendLine({ context, line: command, lease });
    if (admission.kind === 'blocked') {
      if (entry.timer) clearTimeout(entry.timer); entry.timer = null; entry.pendingPage = false;
      entry.status = 'failed'; entry.reason = admissionReason(admission); lease.release();
      currentInventory = inventoryForScan(entry, 'failed', entry.reason);
      return publish(context, 'blocked', entry.reason, currentInventory);
    }
    if (admission.kind === 'unknown') {
      entry.status = 'unknown'; entry.reason = 'transport-error'; lease.markUnknown();
      currentInventory = inventoryForScan(entry, 'unknown', entry.reason);
      return publish(context, 'unknown', entry.reason, currentInventory);
    }
    return result;
  }
  function timeoutRevoke(entry: RevokeIntent): void {
    if (revocations.get(entry.revokeRef) !== entry || !entry.lease || !validSource(entry.owner, entry.endpointId, entry.prefix, entry.nick)) return;
    entry.status = entry.acknowledged ? 'local-denial-committed' : 'completion-unknown'; entry.reason = 'response-timeout';
    entry.lease.markUnknown(); publish(entry.context, 'unknown', entry.reason, revokeView(entry));
  }
  function sendRevoke(entry: RevokeIntent, context: RequestContext, lease: SessionOperationLease): SessionControlResult {
    if (!currentContext(context) || !sameOwner(entry.owner, context.owner) || !validSource(entry.owner, entry.endpointId, entry.prefix, entry.nick))
      return publish(context, 'blocked', 'owner-changed', revokeView(entry));
    entry.context = context; entry.lease = lease; entry.status = 'requesting'; entry.reason = null; entry.acknowledged = false;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => timeoutRevoke(entry), timeoutMs);
    const result = publish(context, 'pending', null, revokeView(entry));
    const admission = deps.sendLine({ context, line: formatIRCLine('SESSION', 'REVOKE', `group=${entry.groupId}`).trimEnd(), lease });
    if (admission.kind === 'blocked') {
      clearTimeout(entry.timer); entry.timer = null; lease.release(); entry.lease = null; entry.status = 'rejected'; entry.reason = admissionReason(admission);
      return publish(context, 'blocked', entry.reason, revokeView(entry));
    }
    if (admission.kind === 'unknown') { lease.markUnknown(); entry.status = 'completion-unknown'; entry.reason = 'transport-error'; return publish(context, 'unknown', entry.reason, revokeView(entry)); }
    return result;
  }
  function terminalRevoke(entry: RevokeIntent, status: SessionRevocationView['status'], reason: SessionControlReason | null,
    resultStatus: SessionControlResult['status']): void {
    if (entry.timer) clearTimeout(entry.timer); entry.timer = null;
    entry.status = status; entry.reason = reason;
    if (status === 'complete' || status === 'rejected' || status === 'unsupported') { entry.lease?.release(); entry.lease = null; }
    else entry.lease?.markUnknown();
    publish(entry.context, resultStatus, reason, revokeView(entry));
  }
  function handleRevokeNotice(entry: RevokeIntent, body: string): boolean {
    if (body === 'SESSION REVOKE PENDING scope=logical-session; durable local denial committed; selected attachments including this connection will close; repeat from another account attachment to verify mesh receipts'
      || body === 'SESSION REVOKE PENDING scope=logical-session; local denial is durable; repeat from any other attachment of this account to verify configured-node receipts') {
      entry.acknowledged = true; entry.status = 'local-denial-committed'; entry.reason = null;
      entry.lease?.markUnknown(); publish(entry.context, 'held', null, revokeView(entry)); return true;
    }
    if (body === 'SESSION REVOKE OK scope=logical-session; every configured node confirmed durable denial') {
      terminalRevoke(entry, 'complete', null, 'accepted'); return true;
    }
    if (body.startsWith('SESSION REVOKE PENDING')) {
      terminalRevoke(entry, entry.acknowledged ? 'local-denial-committed' : 'completion-unknown', 'invalid-response', entry.acknowledged ? 'held' : 'unknown');
      return true;
    }
    return false;
  }
  function failureCode(event: PrivateIngressEvent): { family: string; code: string; text: string } | null {
    if (event.sourceKind !== 'prefixless-protocol') return null;
    const message = parseIRCMessage(event.line);
    if (message.command !== 'FAIL' && message.command !== 'WARN') return null;
    const params = message.params;
    if (params.length < 2 || params[0]?.toUpperCase() !== 'SESSION') return null;
    return { family: message.command, code: params[1]?.toUpperCase() ?? '', text: params.at(-1) ?? '' };
  }
  function finishMeshFailure(entry: MeshScan, code: string, family: string): boolean {
    const reasonMap: Record<string, SessionControlReason> = {
      UNSUPPORTED: 'unsupported', NO_SUCH_SESSION: 'no-such-session', AMBIGUOUS_GROUP: 'ambiguous-group',
      TEMPORARILY_UNAVAILABLE: 'temporarily-unavailable', STALE_LIST: 'stale-list', INVALID_CURSOR: 'stale-list',
      INVALID_GROUP: 'invalid-request', INVALID_PARAMS: 'invalid-request', INVALID_SUBCOMMAND: 'invalid-request',
    };
    if (!(code in reasonMap)) return false;
    entry.reason = reasonMap[code] ?? 'server-rejected';
    entry.status = family === 'WARN' && code === 'TEMPORARILY_UNAVAILABLE' ? 'unknown' : 'failed';
    if (entry.timer) clearTimeout(entry.timer); entry.timer = null; entry.pendingPage = false;
    if (entry.status === 'unknown') entry.lease.markUnknown(); else entry.lease.release();
    currentInventory = inventoryForScan(entry, entry.status, entry.reason);
    publish(entry.context, entry.status === 'unknown' ? 'unknown' : 'rejected', entry.reason, currentInventory);
    return true;
  }

  function runLocalList(context: RequestContext): SessionControlResult { return startLocalList(context); }
  function runLocalDrop(input: { readonly context: RequestContext; readonly rowRef: string; readonly confirm: true }): SessionControlResult {
    const context = input.context; const owner = Object.freeze({ ...context.owner }); const endpointId = deps.currentEndpointId(); const prefix = deps.currentServerPrefix(); const nick = deps.currentNick();
    const row = localRows.find(item => item.rowRef === input.rowRef);
    if (!currentContext(context)) return publish(context, 'blocked', 'owner-changed', inventory(context, { status: 'stale', reason: 'owner-changed' }));
    if (!input.confirm || !row || !localOwner || !sameOwner(localOwner, owner) || row.listEpoch !== localEpoch)
      return publish(context, 'blocked', 'stale-list', inventory(context, { status: 'stale', reason: 'stale-list' }));
    // The server refuses CANNOT_DROP_CURRENT; fail closed locally so the
    // caller's own attachment is never offered to the wire at all.
    if (row.current) return publish(context, 'blocked', 'invalid-request', inventory(context, { status: 'stale', reason: 'invalid-request' }));
    if (!owner.accountId) return publish(context, 'blocked', 'account-proof-required', inventory(context, { status: 'unsupported', reason: 'account-proof-required' }));
    if (!prefix || !nick || owner.physicalRef === null) return publish(context, 'blocked', 'offline', inventory(context, { status: 'unsupported', reason: 'offline' }));
    if (activeLocalList || activeLocalDrop || (scan !== null && !scan.complete)) return publish(context, 'blocked', 'busy', inventory(context, { status: 'stale', reason: 'busy' }));
    if (scan?.complete) scan = null;
    const operationRef = Symbol('local-session-drop'); const lease = deps.acquireSessionOperation(context, 'local-drop', operationRef);
    if (!lease) return publish(context, 'blocked', 'busy', inventory(context, { status: 'stale', reason: 'busy' }));
    const entry: ActiveDrop = { operationRef, lease, context, owner, endpointId, prefix, nick, row, phase: 'drop', acknowledged: false, rows: [], timer: null };
    activeLocalDrop = entry; entry.timer = setTimeout(() => {
      if (activeLocalDrop !== entry || !validSource(owner, endpointId, prefix, nick)) return;
      entry.lease.markUnknown(); finishDrop(entry, 'unknown', 'response-timeout', 'unknown');
    }, timeoutMs);
    const result = publish(context, 'pending', null, inventory(context, { status: 'pending', localRows: localRows.map(item => ({ rowRef: item.rowRef, index: item.index, signonMs: item.signonMs, state: item.state, current: item.current })) }));
    const line = formatIRCLine('SESSION', 'DROP', row.selector).trimEnd();
    const admission = deps.sendLine({ context, line, lease });
    if (admission.kind === 'blocked') return finishDrop(entry, 'failed', admissionReason(admission), 'blocked');
    if (admission.kind === 'unknown') { lease.markUnknown(); return finishDrop(entry, 'unknown', 'transport-error', 'unknown'); }
    return result;
  }
  function meshList(context: RequestContext): SessionControlResult {
    if (!deps.deploymentAllowed()) return publish(context, 'blocked', 'unsupported', inventory(context, { mode: 'mesh', status: 'unsupported', reason: 'unsupported' }));
    if (!currentContext(context)) return publish(context, 'blocked', 'owner-changed', inventory(context, { mode: 'mesh', status: 'stale', reason: 'owner-changed' }));
    const owner = Object.freeze({ ...context.owner }); const endpointId = deps.currentEndpointId(); const prefix = deps.currentServerPrefix(); const nick = deps.currentNick();
    if (!owner.accountId) return publish(context, 'blocked', 'account-proof-required', inventory(context, { mode: 'mesh', status: 'unsupported', reason: 'account-proof-required' }));
    if (!prefix || !nick || owner.physicalRef === null) return publish(context, 'blocked', 'offline', inventory(context, { mode: 'mesh', status: 'unsupported', reason: 'offline' }));
    if ((scan !== null && !scan.complete) || activeLocalList || activeLocalDrop) return publish(context, 'blocked', 'busy', inventory(context, { mode: 'mesh', status: 'stale', reason: 'busy' }));
    if (scan?.complete) scan = null;
    const operationRef = Symbol('mesh-session-list'); const lease = deps.acquireSessionOperation(context, 'mesh-list', operationRef);
    if (!lease) return publish(context, 'blocked', 'busy', inventory(context, { mode: 'mesh', status: 'stale', reason: 'busy' }));
    const scanRef = deps.randomRef();
    if (!safeRef(scanRef)) { lease.release(); return publish(context, 'blocked', 'invalid-request', inventory(context, { mode: 'mesh', status: 'failed', reason: 'invalid-request' })); }
    scan = { scanRef, owner, endpointId, networkId: owner.networkId, rows: [], groupIds: new Map(), rowRefs: new Map(), operationRef, cursor: null,
      pages: 0, complete: false, lastObservedAt: null, continuationAvailable: false, lease, context, prefix, nick, timer: null,
      pendingPage: false, expectedPageRows: null, stagedRows: 0, reason: null, status: 'pending' };
    return beginMeshPage(scan, context, true);
  }
  function meshNext(input: { readonly context: RequestContext; readonly scanRef: string }): SessionControlResult {
    const context = input.context; const entry = scan;
    if (!entry || entry.scanRef !== input.scanRef || !safeRef(input.scanRef) || !entry.continuationAvailable || entry.complete)
      return publish(context, 'blocked', 'stale-list', inventory(context, { mode: 'mesh', status: 'stale', scanRef: input.scanRef, reason: 'stale-list' }));
    if (!deps.deploymentAllowed()) return publish(context, 'blocked', 'unsupported', inventoryForScan(entry, 'unsupported', 'unsupported'));
    if (entry.status === 'unknown' && entry.lease.isCurrent() && !entry.pendingPage) {
      // Explicit retry of this same page is the only operation allowed to reuse
      // an unknown lease; no page is automatically replayed.
      return beginMeshPage(entry, context, false);
    }
    const lease = deps.acquireSessionOperation(context, 'mesh-list', entry.operationRef);
    if (!lease) return publish(context, 'blocked', 'busy', inventoryForScan(entry, 'stale', 'busy'));
    entry.lease = lease;
    return beginMeshPage(entry, context, true);
  }
  function meshRevoke(input: { readonly context: RequestContext; readonly groupRef: string; readonly confirm: true }): SessionControlResult {
    const context = input.context; const entry = scan;
    if (!deps.deploymentAllowed()) return publish(context, 'blocked', 'unsupported', inventory(context, { mode: 'mesh', status: 'unsupported', reason: 'unsupported' }));
    if (!currentContext(context)) return publish(context, 'blocked', 'owner-changed', inventory(context, { mode: 'mesh', status: 'stale', reason: 'owner-changed' }));
    const accountId = context.owner.accountId;
    if (accountId === null) return publish(context, 'blocked', 'account-proof-required', inventory(context, { mode: 'mesh', status: 'unsupported', reason: 'account-proof-required' }));
    if (!input.confirm || !entry || !safeRef(input.groupRef) || !entry.complete || !entry.owner.accountId || !sameOwner(entry.owner, context.owner))
      return publish(context, 'blocked', entry?.complete ? 'invalid-request' : 'stale-list', inventory(context, { mode: 'mesh', status: 'stale', reason: 'stale-list' }));
    const groupId = [...entry.groupIds].find(([, ref]) => ref === input.groupRef)?.[0];
    if (!groupId || !HEX32.test(groupId)) return publish(context, 'blocked', 'stale-list', inventoryForScan(entry, 'stale', 'stale-list'));
    if (scan?.pendingPage || activeLocalList || activeLocalDrop || [...revocations.values()].some(item => item.lease?.isCurrent()))
      return publish(context, 'blocked', 'busy', inventoryForScan(entry, 'stale', 'busy'));
    const revokeRef = deps.randomRef(); if (!safeRef(revokeRef)) return publish(context, 'blocked', 'invalid-request', inventoryForScan(entry, 'failed', 'invalid-request'));
    const operationRef = Symbol('mesh-session-revoke'); const lease = deps.acquireSessionOperation(context, 'mesh-revoke', operationRef);
    if (!lease) return publish(context, 'blocked', 'busy', inventoryForScan(entry, 'stale', 'busy'));
    const intent: RevokeIntent = { revokeRef, groupRef: input.groupRef, groupId, networkId: context.owner.networkId,
      accountId, operationRef, context, owner: Object.freeze({ ...context.owner }), prefix: deps.currentServerPrefix()!,
      endpointId: deps.currentEndpointId(), nick: deps.currentNick()!, lease, timer: null, status: 'requesting', reason: null, acknowledged: false, uiDismissed: false };
    revocations.set(revokeRef, intent); while (revocations.size > 64) { const first = revocations.keys().next().value; if (first) revocations.delete(first); }
    return sendRevoke(intent, context, lease);
  }
  function meshReconcile(input: { readonly context: RequestContext; readonly revokeRef: string }): SessionControlResult {
    const context = input.context; const intent = revocations.get(input.revokeRef);
    if (!intent || !safeRef(input.revokeRef) || !currentContext(context) || context.owner.accountId !== intent.accountId || context.owner.networkId !== intent.networkId)
      return publish(context, 'blocked', intent ? 'account-proof-required' : 'stale-list', intent ? revokeView(intent) : inventory(context, { mode: 'mesh', status: 'stale', reason: 'stale-list' }));
    if (!deps.deploymentAllowed()) return publish(context, 'blocked', 'unsupported', revokeView(intent));
    if (intent.status === 'complete' || intent.status === 'rejected') return publish(context, 'accepted', null, revokeView(intent));
    if (intent.lease?.isCurrent()) return publish(context, 'blocked', 'busy', revokeView(intent));
    const op = Symbol('mesh-revoke-reconcile'); const lease = deps.acquireSessionOperation(context, 'mesh-revoke', op);
    if (!lease) return publish(context, 'blocked', 'busy', revokeView(intent));
    intent.operationRef = op; intent.owner = Object.freeze({ ...context.owner }); intent.endpointId = deps.currentEndpointId(); intent.prefix = deps.currentServerPrefix() ?? '';
    intent.nick = deps.currentNick() ?? ''; intent.acknowledged = false;
    return sendRevoke(intent, context, lease);
  }
  function meshDismiss(input: { readonly context: RequestContext; readonly revokeRef: string }): SessionControlResult {
    const context = input.context; const intent = revocations.get(input.revokeRef);
    if (!intent || !currentContext(context) || context.owner.accountId !== intent.accountId || context.owner.networkId !== intent.networkId)
      return publish(context, 'blocked', 'stale-list', inventory(context, { mode: 'mesh', status: 'stale', reason: 'stale-list' }));
    intent.uiDismissed = true;
    return publish(context, 'accepted', null, Object.freeze({ ...revokeView(intent), requestId: context.requestId }));
  }

  function consumePrivateIngress(event: PrivateIngressEvent): boolean {
    if (disposed) return false;
    const message = parseIRCMessage(event.line);
    const currentOperationOwner = activeLocalList?.owner ?? activeLocalDrop?.owner ?? scan?.owner
      ?? [...revocations.values()].find(item => item.lease?.isCurrent())?.owner;
    if (currentOperationOwner && !sameOwner(event.owner, currentOperationOwner)) return false;
    if (message.command === 'NOTICE') {
      const candidates = [activeLocalList, activeLocalDrop, scan].filter((item): item is ActiveLocalList | ActiveDrop | MeshScan => !!item);
      const active = candidates.find(item => item.prefix === message.prefix && item.nick === message.params[0]
        && sameOwner(item.owner, event.owner) && validSource(item.owner, item.endpointId, item.prefix, item.nick));
      const body = active ? message.params.at(-1) ?? '' : null;
      if (active instanceof Object && body !== null) {
        if (active === activeLocalList) {
          const list = active as ActiveLocalList;
          if (body === 'SESSION: end of session list (this node\'s physical attachments only)') {
            finishLocal(list, 'ready', null, 'accepted'); return true;
          }
          if (body.startsWith('SESSION LIST')) {
            const row = parseLocalRow(body, list);
            if (!row || list.rows.length >= MAX_LOCAL_ROWS) { finishLocal(list, 'failed', 'invalid-response', 'rejected'); return true; }
            list.rows.push(row); return true;
          }
          if (body.startsWith('SESSION')) return true;
        }
        if (active === activeLocalDrop) {
          const drop = active as ActiveDrop;
          if (drop.phase === 'drop') {
            const exactSid = drop.row.selector.startsWith('sid=');
            const expected = exactSid ? `SESSION DROP ${drop.row.selector} ok` : `SESSION DROP #${drop.row.index} ok`;
            if (body === expected) { startDropRefresh(drop); return true; }
            if (body.startsWith('SESSION DROP')) { finishDrop(drop, 'failed', 'server-rejected', 'rejected'); return true; }
          } else {
            if (body === 'SESSION: end of session list (this node\'s physical attachments only)') { finishDrop(drop, 'ready', null, 'accepted'); return true; }
            if (body.startsWith('SESSION LIST')) {
              const row = parseLocalRow(body, drop);
              if (!row || drop.rows.length >= MAX_LOCAL_ROWS) { finishDrop(drop, 'failed', 'invalid-response', 'rejected'); return true; }
              drop.rows.push(row); return true;
            }
          }
          if (body.startsWith('SESSION')) return true;
        }
        if (active === scan) {
          const mesh = active as MeshScan;
          if (body.startsWith('SESSION MESH group=')) {
            const row = parseMeshRow(body, mesh);
            if (!row || mesh.stagedRows >= MAX_MESH_PAGE || mesh.rows.length >= MAX_MESH_ROWS) {
              mesh.status = 'failed'; mesh.reason = 'inventory-limit'; mesh.lease.release(); mesh.pendingPage = false;
              if (mesh.timer) clearTimeout(mesh.timer); mesh.timer = null; currentInventory = inventoryForScan(mesh, 'failed', mesh.reason);
              publish(mesh.context, 'rejected', mesh.reason, currentInventory); return true;
            }
            mesh.rows.push(row); mesh.stagedRows += 1; return true;
          }
          if (body.startsWith('SESSION MESH end ')) {
            if (!endMeshPage(mesh, body)) { mesh.status = 'failed'; mesh.reason = 'invalid-response'; mesh.lease.release(); mesh.pendingPage = false;
              if (mesh.timer) clearTimeout(mesh.timer); mesh.timer = null; currentInventory = inventoryForScan(mesh, 'failed', mesh.reason);
              publish(mesh.context, 'rejected', mesh.reason, currentInventory); }
            return true;
          }
          if (body.startsWith('SESSION MESH')) return true;
        }
      }
      const revoke = [...revocations.values()].find(item => item.prefix === message.prefix && item.nick === message.params[0]
        && item.lease?.isCurrent() && sameOwner(item.owner, event.owner) && validSource(item.owner, item.endpointId, item.prefix, item.nick));
      if (revoke) { const body = message.params.at(-1) ?? ''; if (body.startsWith('SESSION REVOKE')) return handleRevokeNotice(revoke, body); }
    }
    const failure = failureCode(event);
    if (failure) {
      if (failure.family === 'WARN' && failure.code === 'PENDING' && failure.text === 'Configured nodes have not all confirmed current durable group support; no revocation committed; retry') {
        const entry = [...revocations.values()].find(item => item.lease?.isCurrent() && sameOwner(item.owner, event.owner));
        if (entry) { terminalRevoke(entry, 'preflight-pending', 'temporarily-unavailable', 'held'); return true; }
      }
      const revocation = [...revocations.values()].find(item => item.lease?.isCurrent() && sameOwner(item.owner, event.owner));
      if (revocation) {
        const codes: Record<string, SessionControlReason> = { INVALID_SUBCOMMAND: 'invalid-request', INVALID_PARAMS: 'invalid-request', INVALID_GROUP: 'invalid-request', INVALID_CURSOR: 'stale-list', UNSUPPORTED: 'unsupported', NO_SUCH_SESSION: 'no-such-session', AMBIGUOUS_GROUP: 'ambiguous-group', TEMPORARILY_UNAVAILABLE: 'temporarily-unavailable', STALE_LIST: 'stale-list' };
        const reason = codes[failure.code];
        if (reason) { terminalRevoke(revocation, failure.family === 'WARN' ? revocation.acknowledged ? 'local-denial-committed' : 'completion-unknown' : 'rejected', reason, failure.family === 'WARN' ? revocation.acknowledged ? 'held' : 'unknown' : 'rejected'); return true; }
      }
      if (scan?.lease.isCurrent() && sameOwner(scan.owner, event.owner) && finishMeshFailure(scan, failure.code, failure.family)) return true;
      const active = activeLocalList ?? activeLocalDrop;
      if (active?.lease.isCurrent() && sameOwner(active.owner, event.owner) && failure.code === 'UNSUPPORTED') {
        if (active instanceof Object && active === activeLocalList) finishLocal(active, 'unsupported', 'unsupported', 'rejected');
        else if (active === activeLocalDrop) finishDrop(active, 'failed', 'unsupported', 'rejected');
        return true;
      }
    }
    return false;
  }

  return {
    localList: runLocalList,
    localDrop: runLocalDrop,
    meshList,
    meshNext,
    meshRevoke,
    meshReconcile,
    meshDismiss,
    consumePrivateIngress,
    retire(owner: OwnerSnapshot): void {
      if (activeLocalList && sameOwner(activeLocalList.owner, owner)) { if (activeLocalList.timer) clearTimeout(activeLocalList.timer); activeLocalList.lease.markUnknown(); activeLocalList = null; }
      if (activeLocalDrop && sameOwner(activeLocalDrop.owner, owner)) { if (activeLocalDrop.timer) clearTimeout(activeLocalDrop.timer); activeLocalDrop.lease.markUnknown(); activeLocalDrop = null; }
      if (scan && sameOwner(scan.owner, owner)) { if (scan.timer) clearTimeout(scan.timer); scan.lease.markUnknown(); scan = null; }
      for (const intent of revocations.values()) if (sameOwner(intent.owner, owner)) {
        if (intent.timer) clearTimeout(intent.timer); intent.timer = null; intent.lease?.markUnknown(); intent.lease = null;
      }
      if (localOwner && sameOwner(localOwner, owner)) { localRows = []; localOwner = null; localEpoch += 1; }
      currentInventory = null;
    },
    dispose(): void {
      disposed = true;
      if (activeLocalList?.timer) clearTimeout(activeLocalList.timer); if (activeLocalDrop?.timer) clearTimeout(activeLocalDrop.timer); if (scan?.timer) clearTimeout(scan.timer);
      for (const entry of revocations.values()) if (entry.timer) clearTimeout(entry.timer);
      activeLocalList?.lease.release(); activeLocalDrop?.lease.release(); scan?.lease.release(); for (const entry of revocations.values()) entry.lease?.release();
      localRows = []; localOwner = null; activeLocalList = null; activeLocalDrop = null; scan = null; currentInventory = null; revocations.clear();
    },
  };
}
