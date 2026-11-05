import { parseIRCMessage } from '../../src/lib/irc/parser';
import type { OwnerSnapshot, RequestContext, RequestId, SendAdmission, PrivateIngressEvent } from './contracts';
import { validateClientLine } from './client-line-validator';

export interface WebAuthnOperationLease {
  isCurrent(): boolean;
  release(): void;
}

export type PasskeyReason = null | 'invalid-request' | 'owner-changed' | 'account-proof-required' | 'busy'
  | 'offline' | 'backpressure' | 'local-policy' | 'transport-error' | 'response-timeout'
  | 'invalid-list' | 'not-owned' | 'not-found' | 'label-invalid' | 'server-rejected';
export type PasskeyOperation = 'list' | 'rename' | 'remove' | null;
export interface PasskeyRow {
  readonly credentialRef: string;
  readonly label: string;
  readonly createdUnix: string;
  readonly signCount: string;
}
export interface PasskeyView {
  readonly status: 'idle' | 'pending' | 'ready' | 'rejected' | 'unknown';
  readonly operation: PasskeyOperation;
  readonly reason: PasskeyReason;
  readonly rows: readonly PasskeyRow[];
}
export interface PasskeyResult {
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
  readonly status: 'pending' | 'accepted' | 'rejected' | 'unknown' | 'blocked';
  readonly reason: PasskeyReason;
  readonly view: PasskeyView;
}
export interface PrivatePasskeyManagementDependencies {
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentServerPrefix: () => string | null;
  readonly currentNick: () => string | null;
  readonly sendLine: (input: { readonly line: string; readonly owner: OwnerSnapshot; readonly requestId: RequestId }) => SendAdmission;
  readonly acquireWebAuthnOperation: (context: RequestContext, kind: Exclude<PasskeyOperation, null>) => WebAuthnOperationLease | null;
  readonly now: () => number;
  readonly randomRef: () => string;
  readonly emit: (result: PasskeyResult) => void;
  readonly timeoutMs?: number;
}

interface StoredRow {
  readonly publicRow: PasskeyRow;
  readonly id: string;
  readonly owner: OwnerSnapshot;
}
interface ParsedCredential {
  readonly id: string;
  readonly signCount: string;
  readonly createdUnix: string;
  readonly label: string;
}
interface ActiveOperation {
  readonly context: RequestContext;
  readonly owner: OwnerSnapshot;
  readonly kind: Exclude<PasskeyOperation, null>;
  readonly prefix: string;
  readonly nick: string;
  readonly lease: WebAuthnOperationLease;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly staged: Map<string, ParsedCredential>;
  readonly credential: StoredRow | null;
  readonly requestedLabel: string | null;
  readonly deadlineAt: number;
  finalStatus?: PasskeyResult['status'];
  finalReason?: PasskeyReason;
}

const MAX_CREDENTIALS = 16;
const MAX_LABEL_BYTES = 64;
const DEFAULT_TIMEOUT_MS = 15_000;
const encoder = new TextEncoder();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,342}$/u;
const CANONICAL_UNSIGNED = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_SIGNED = /^(?:0|-?[1-9][0-9]*)$/u;

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function validLabel(label: string): boolean {
  if (encoder.encode(label).byteLength > MAX_LABEL_BYTES || /[\u0000-\u001f\u007f]/u.test(label)) return false;
  for (let index = 0; index < label.length; index += 1) {
    const code = label.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = label.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function validCount(value: string): boolean {
  if (!CANONICAL_UNSIGNED.test(value)) return false;
  try { return BigInt(value) <= 0xffff_ffffn; } catch { return false; }
}
function validCredentialId(value: string): boolean {
  if (!ID_PATTERN.test(value) || value.length % 4 === 1 || Math.floor(value.length * 3 / 4) > 256) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(value.at(-1) ?? '');
  if (value.length % 4 === 2 && (last & 0x0f) !== 0) return false;
  if (value.length % 4 === 3 && (last & 0x03) !== 0) return false;
  return true;
}
function validCreated(value: string): boolean {
  if (!CANONICAL_SIGNED.test(value)) return false;
  try {
    const number = BigInt(value);
    return number >= -0x8000_0000_0000_0000n && number <= 0x7fff_ffff_ffff_ffffn;
  } catch { return false; }
}
function rawEventBody(line: string, recipient: string): string | null {
  const head = /^(?:@[^ ]+ )?(?::[^ ]+ )?EVENT ([^ ]+) WEBAUTHN /u.exec(line);
  return head && head[1] === recipient ? line.slice(head[0].length) : null;
}
function parseCredential(body: string): ParsedCredential | null {
  const match = /^CRED ([^ ]+) ([^ ]+) ([^ ]+) :(.*)$/u.exec(body);
  if (!match) return null;
  const id = match[1] ?? '';
  const signCount = match[2] ?? '';
  const createdUnix = match[3] ?? '';
  const label = match[4] ?? '';
  if (!validCredentialId(id) || !validCount(signCount) || !validCreated(createdUnix) || !validLabel(label)) return null;
  return { id, signCount, createdUnix, label };
}
function listEnd(body: string): number | null {
  const match = /^LIST :end \((0|[1-9][0-9]{0,2})\)$/u.exec(body);
  if (!match) return null;
  const count = Number(match[1]);
  return count <= MAX_CREDENTIALS ? count : null;
}
function isWebAuthnEvent(parsed: ReturnType<typeof parseIRCMessage>): boolean {
  return parsed.command === 'EVENT' && parsed.params[1]?.toUpperCase() === 'WEBAUTHN';
}
function failureReason(code: string): PasskeyReason {
  if (code === 'NOT_OWNED') return 'not-owned';
  if (code === 'NOT_FOUND') return 'not-found';
  if (code === 'LABEL_TOO_LONG' || code === 'BAD_LABEL') return 'label-invalid';
  return 'server-rejected';
}
function admissionResult(admission: SendAdmission): { status: PasskeyResult['status']; reason: PasskeyReason } {
  if (admission.kind === 'transport-admitted') return { status: 'pending', reason: null };
  if (admission.kind === 'unknown') return { status: 'unknown', reason: 'transport-error' };
  switch (admission.reason) {
    case 'owner-changed': return { status: 'blocked', reason: 'owner-changed' };
    case 'offline': return { status: 'blocked', reason: 'offline' };
    case 'backpressure': return { status: 'blocked', reason: 'backpressure' };
    default: return { status: 'blocked', reason: 'local-policy' };
  }
}

/** Owns the private credential-ID map and serializes exact WebAuthn management replies. */
export function createPrivatePasskeyManagement(deps: PrivatePasskeyManagementDependencies) {
  let rows: StoredRow[] = [];
  let active: ActiveOperation | null = null;
  let unknownMutationOwner: OwnerSnapshot | null = null;
  let disposed = false;
  let status: PasskeyView['status'] = 'idle';
  let lastOperation: PasskeyOperation = null;
  let lastReason: PasskeyReason = null;
  let statusOwner: OwnerSnapshot | null = null;

  const ownerCurrent = (owner: OwnerSnapshot): boolean => !disposed && owner.accountId !== null
    && deps.isCurrent(owner) && sameOwner(deps.currentOwner(), owner);
  const currentView = (): PasskeyView => {
    const owner = deps.currentOwner();
    const activeForOwner = active !== null && sameOwner(active.owner, owner) ? active : null;
    const statusForOwner = activeForOwner !== null || statusOwner !== null && sameOwner(statusOwner, owner);
    return {
      status: statusForOwner ? status : 'idle',
      operation: activeForOwner?.kind ?? (statusForOwner ? lastOperation : null),
      reason: statusForOwner ? lastReason : null,
      rows: rows.filter(row => sameOwner(row.owner, owner) && deps.isCurrent(row.owner)).map(row => row.publicRow),
    };
  };
  const publish = (context: RequestContext, resultStatus: PasskeyResult['status'], reason: PasskeyReason): PasskeyResult => {
    const result: PasskeyResult = { requestId: context.requestId, owner: context.owner, status: resultStatus, reason, view: currentView() };
    deps.emit(result);
    return result;
  };
  const validContext = (context: RequestContext): PasskeyReason => {
    if (disposed || !context || context.schemaVersion !== 1 || !context.requestId || !context.owner) return 'invalid-request';
    if (!sameOwner(context.owner, deps.currentOwner()) || !deps.isCurrent(context.owner)) return 'owner-changed';
    if (context.owner.accountId === null) return 'account-proof-required';
    if (!deps.currentServerPrefix() || !deps.currentNick()) return 'offline';
    return null;
  };
  const reject = (context: RequestContext, reason: PasskeyReason, resultStatus: PasskeyResult['status'] = 'blocked'): PasskeyResult => {
    if (active === null && sameOwner(context.owner, deps.currentOwner())) {
      status = resultStatus === 'unknown' ? 'unknown' : 'rejected';
      lastOperation = null;
      lastReason = reason;
      statusOwner = context.owner;
    }
    return publish(context, resultStatus, reason);
  };
  const release = (operation: ActiveOperation): void => {
    clearTimeout(operation.timer);
    try { operation.lease.release(); } catch { /* lease cleanup is isolated */ }
  };
  const operationScopeCurrent = (operation: ActiveOperation): boolean => active === operation
    && ownerCurrent(operation.owner) && operation.lease.isCurrent()
    && deps.currentServerPrefix() === operation.prefix && deps.currentNick() === operation.nick;
  const operationCurrent = (operation: ActiveOperation): boolean => operationScopeCurrent(operation)
    && deps.now() <= operation.deadlineAt;
  const settle = (operation: ActiveOperation, resultStatus: PasskeyResult['status'], reason: PasskeyReason): void => {
    if (active !== operation) return;
    active = null;
    operation.finalStatus = resultStatus;
    operation.finalReason = reason;
    release(operation);
    status = resultStatus === 'accepted' ? 'ready' : resultStatus === 'unknown' ? 'unknown' : 'rejected';
    lastOperation = operation.kind;
    lastReason = reason;
    statusOwner = operation.owner;
    publish(operation.context, resultStatus, reason);
  };
  const start = (context: RequestContext, kind: Exclude<PasskeyOperation, null>, line: string, credential: StoredRow | null = null, requestedLabel: string | null = null): PasskeyResult => {
    const reason = validContext(context);
    if (reason) return reject(context, reason);
    if (active) return reject(context, 'busy');
    if (kind !== 'list' && unknownMutationOwner !== null && sameOwner(unknownMutationOwner, context.owner)) return reject(context, 'busy');
    const prefix = deps.currentServerPrefix();
    const nick = deps.currentNick();
    if (!prefix || !nick) return reject(context, 'offline');
    const lease = deps.acquireWebAuthnOperation(context, kind);
    if (!lease || !lease.isCurrent()) {
      try { lease?.release(); } catch { /* lease cleanup is isolated */ }
      return reject(context, 'busy');
    }
    const validation = validateClientLine(line);
    if (!validation.valid) {
      try { lease.release(); } catch { /* lease cleanup is isolated */ }
      return reject(context, kind === 'rename' && requestedLabel !== null ? 'label-invalid' : 'local-policy');
    }
    const operation = {} as ActiveOperation;
    const timer = setTimeout(() => {
      if (active !== operation) return;
      if (!operationScopeCurrent(operation)) {
        active = null;
        release(operation);
        status = 'idle';
        lastOperation = null;
        lastReason = null;
        return;
      }
      if (kind !== 'list') unknownMutationOwner = operation.owner;
      settle(operation, 'unknown', 'response-timeout');
    }, Math.max(1, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    const deadlineAt = deps.now() + Math.max(1, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    Object.assign(operation, {
      context, owner: context.owner, kind, prefix, nick, lease, timer,
      staged: new Map<string, ParsedCredential>(), credential, requestedLabel,
      deadlineAt,
    });
    active = operation;
    status = 'pending';
    lastOperation = kind;
    lastReason = null;
    statusOwner = context.owner;
    // Pending is visible before the transport callback can synchronously deliver a reply.
    publish(context, 'pending', null);
    let admission: SendAdmission;
    try { admission = deps.sendLine({ line, owner: operation.owner, requestId: context.requestId }); }
    catch { admission = { kind: 'unknown', reason: 'transport-error' }; }
    if (active === operation && admission.kind !== 'transport-admitted') {
      if (admission.kind === 'unknown' && kind !== 'list') unknownMutationOwner = operation.owner;
      const mapped = admissionResult(admission);
      settle(operation, mapped.status, mapped.reason);
    }
    const resultStatus = active === operation ? 'pending' : operation.finalStatus ?? 'rejected';
    return { requestId: context.requestId, owner: context.owner, status: resultStatus,
      reason: active === operation ? null : operation.finalReason ?? null, view: currentView() };
  };
  const resolveRef = (context: RequestContext, ref: string): StoredRow | null => rows.find(row => row.publicRow.credentialRef === ref && sameOwner(row.owner, context.owner)) ?? null;

  return {
    view: currentView,
    list(context: RequestContext): PasskeyResult {
      return start(context, 'list', 'WEBAUTHN LIST');
    },
    rename(input: { readonly context: RequestContext; readonly credentialRef: string; readonly label: string }): PasskeyResult {
      const { context, credentialRef, label } = input;
      const reason = validContext(context);
      if (reason) return reject(context, reason);
      if (!validLabel(label)) return reject(context, 'label-invalid');
      const row = resolveRef(context, credentialRef);
      if (!row) return reject(context, 'not-found');
      return start(context, 'rename', `WEBAUTHN RENAME ${row.id} :${label}`, row, label);
    },
    remove(input: { readonly context: RequestContext; readonly credentialRef: string; readonly confirm: true }): PasskeyResult {
      const reason = validContext(input.context);
      if (reason) return reject(input.context, reason);
      if (input.confirm !== true) return reject(input.context, 'invalid-request');
      const row = resolveRef(input.context, input.credentialRef);
      if (!row) return reject(input.context, 'not-found');
      return start(input.context, 'remove', `WEBAUTHN REMOVE ${row.id}`, row);
    },
    consumePrivateIngress(event: PrivateIngressEvent): boolean {
      if (disposed || !event || !event.line || !event.owner) return false;
      const wireControls = /[\u0000\r\n]/u.test(event.line);
      let parsed: ReturnType<typeof parseIRCMessage>;
      try { parsed = parseIRCMessage(event.line); } catch { return false; }
      const noticeFailureMatch = parsed.command === 'NOTICE' && parsed.params.length === 2
        ? /^FAIL WEBAUTHN ([A-Z0-9_-]{1,64})(?::\s|\s|$)/u.exec(parsed.params[1] ?? '') : null;
      const prefixlessFail = parsed.command === 'FAIL' && parsed.params[0]?.toUpperCase() === 'WEBAUTHN';
      const failure = prefixlessFail || noticeFailureMatch !== null;
      const privateEvent = isWebAuthnEvent(parsed);
      if (!failure && !privateEvent) return false;
      const eventBody = privateEvent ? rawEventBody(event.line, parsed.params[0] ?? '') : null;
      const op = active;
      const sourceMatches = event.sourceKind === 'server' && parsed.prefix !== null
        && parsed.prefix === deps.currentServerPrefix()
        && (prefixlessFail || parsed.params[0] === deps.currentNick());
      const prefixlessFailure = prefixlessFail && event.sourceKind === 'prefixless-protocol' && parsed.prefix === null;
      if (!sourceMatches && !prefixlessFailure) return true; // Private family never reaches the public line projection.
      if (wireControls) {
        if (op && sameOwner(event.owner, op.owner) && operationCurrent(op) && op.kind === 'list') settle(op, 'rejected', 'invalid-list');
        return true;
      }
      if (!op || !sameOwner(event.owner, op.owner) || !operationCurrent(op)) return true;
      if (failure) {
        const code = prefixlessFail ? parsed.params[1]?.toUpperCase() ?? 'UNKNOWN' : noticeFailureMatch?.[1]?.toUpperCase() ?? null;
        if (code) {
          const reason = failureReason(code);
          if (op.kind !== 'list' && unknownMutationOwner !== null && sameOwner(unknownMutationOwner, op.owner)) unknownMutationOwner = null;
          settle(op, 'rejected', reason);
        }
        return true;
      }
      if (!sourceMatches || !sameOwner(event.owner, op.owner) || parsed.params[0] !== op.nick) return true;
      if (op.kind === 'list') {
        const credential = eventBody === null ? null : parseCredential(eventBody);
        if (credential) {
          if (op.staged.has(credential.id) || op.staged.size >= MAX_CREDENTIALS) {
            settle(op, 'rejected', 'invalid-list');
            return true;
          }
          op.staged.set(credential.id, credential);
          return true;
        }
        const count = eventBody === null ? null : listEnd(eventBody);
        if (count !== null) {
          if (op.staged.size !== count) {
            settle(op, 'rejected', 'invalid-list');
            return true;
          }
          const seenRefs = new Set<string>();
          const next: StoredRow[] = [];
          for (const entry of op.staged.values()) {
            let ref = '';
            const unavailableRefs = new Set([...seenRefs, ...rows.map(row => row.publicRow.credentialRef)]);
            for (let tries = 0; tries < 8 && (!ref || unavailableRefs.has(ref)); tries += 1) ref = deps.randomRef();
            if (!ref || unavailableRefs.has(ref)) { settle(op, 'rejected', 'invalid-list'); return true; }
            seenRefs.add(ref);
            next.push({ id: entry.id, owner: op.owner, publicRow: { credentialRef: ref, label: entry.label, createdUnix: entry.createdUnix, signCount: entry.signCount } });
          }
          rows = next;
          if (unknownMutationOwner !== null && sameOwner(unknownMutationOwner, op.owner)) unknownMutationOwner = null;
          settle(op, 'accepted', null);
          return true;
        }
        settle(op, 'rejected', 'invalid-list');
        return true;
      }
      const row = op.credential;
      if (!row) return true;
      if (op.kind === 'rename') {
        const match = eventBody === null ? null : /^RENAMED ([A-Za-z0-9_-]{1,342}) :(.*)$/u.exec(eventBody);
        if (match && match[1] === row.id && match[2] === op.requestedLabel && validLabel(match[2])) {
          rows = rows.map(item => item === row
            ? { ...item, publicRow: { ...item.publicRow, label: match[2] ?? item.publicRow.label } }
            : item);
          settle(op, 'accepted', null);
        }
        return true;
      }
      const removed = eventBody === null ? null : /^REMOVED :(.*)$/u.exec(eventBody);
      if (removed && removed[1] === row.id) {
        rows = rows.filter(item => item !== row);
        settle(op, 'accepted', null);
      }
      return true;
    },
    retire(owner: OwnerSnapshot): void {
      if (active && sameOwner(active.owner, owner)) {
        const operation = active;
        active = null;
        clearTimeout(operation.timer);
        try { operation.lease.release(); } catch { /* lease cleanup is isolated */ }
        status = 'idle';
        lastOperation = null;
        lastReason = null;
        statusOwner = owner;
      }
      rows = rows.filter(row => !sameOwner(row.owner, owner));
      if (unknownMutationOwner !== null && sameOwner(unknownMutationOwner, owner)) unknownMutationOwner = null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (active) {
        clearTimeout(active.timer);
        try { active.lease.release(); } catch { /* lease cleanup is isolated */ }
        active = null;
      }
      rows = [];
      unknownMutationOwner = null;
      status = 'idle';
      lastOperation = null;
      lastReason = null;
      statusOwner = null;
    },
  };
}
