import { makeConversationId, makeMessageId, type EndpointId, type OwnerSnapshot, type PrivateIngressEvent, type RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import type { JournalRow, PreparedDispatch } from './outbox-journal';
import { formatTaggedLine, parseIRCMessage } from '../../src/lib/irc/parser';

export type SendAcceptanceOperation = 'privmsg' | 'memo-send';
export type SendAcceptanceSemanticShape = 'single-message' | 'independent-message-lines' | 'multiline-batch-group' | 'memo';
export type SendAdmissionObservation = 'transport-admitted' | 'blocked' | 'unknown';

export interface PrepareAcceptanceAttemptInput {
  readonly context: RequestContext;
  readonly ticket: LocalNamespaceTicket;
  readonly recordId: string;
  readonly clientIntentId: string;
  readonly semanticCommitment: string;
  readonly storageKind: 'durable' | 'memory';
  readonly claimNonce: string;
  readonly operation: SendAcceptanceOperation;
  readonly baseTarget: string;
  readonly baseTargetKey: string;
  readonly wireTarget: string;
  readonly lines: readonly string[];
  readonly semanticShape: SendAcceptanceSemanticShape;
}
export interface PreparedAcceptanceAttempt {
  readonly lines: readonly string[];
  readonly validationReceipt: string;
  readonly planHash: string;
}
export interface SendAcceptanceProofReady {
  readonly recordId: string;
  readonly proofRef: symbol;
  readonly context: RequestContext;
  readonly messageIds: readonly string[];
  readonly storageKind: 'durable' | 'memory';
}
export interface SendAcceptanceRegistryDependencies {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly negotiatedCaps: () => ReadonlySet<string>;
  readonly currentServerPrefix: () => string | null;
  readonly currentNick: () => string | null;
  readonly currentEndpointId: () => EndpointId;
  readonly currentMappingRevision: () => string | null;
  readonly onProofReady: (input: SendAcceptanceProofReady) => void;
  readonly now: () => number;
}
export interface SendAcceptancePublicApi {
  prepareAttempt(input: PrepareAcceptanceAttemptInput): Promise<PreparedAcceptanceAttempt | null>;
  validatePreparedDispatch(row: Readonly<JournalRow>, request: RequestContext, ticket: LocalNamespaceTicket, prepared: Extract<PreparedDispatch, { readonly kind: 'ready' }>): boolean;
  validateMemoryPreparedPlan(input: { readonly context: RequestContext; readonly ticket: LocalNamespaceTicket; readonly recordId: string; readonly clientIntentId: string; readonly claimNonce: string; readonly semanticCommitment: string; readonly baseTarget: string; readonly baseTargetKey: string; readonly wireTarget: string; readonly prepared: PreparedAcceptanceAttempt }): boolean;
  observeAdmission(input: { readonly recordId: string; readonly claimNonce: string; readonly planHash: string; readonly kind: SendAdmissionObservation }): void;
  ingest(event: PrivateIngressEvent): boolean;
  verifyAcceptanceProof(proofRef: symbol, request: RequestContext & { readonly recordId: string }, row: Readonly<JournalRow>): boolean;
  verifyMemoryAcceptanceProof(proofRef: symbol, request: RequestContext, recordId: string, clientIntentId: string): boolean;
  acceptanceProofCommitted(proofRef: symbol): void;
  memoCorrelationClear(request: RequestContext, ticket: LocalNamespaceTicket): boolean;
  retireOwner(owner: OwnerSnapshot): void;
  dispose(): void;
}

interface ExpectedLine {
  readonly label: string | null;
  readonly command: 'PRIVMSG' | 'MEMO';
  readonly target: string;
  messageId: string | null;
}
interface AcceptanceAttempt {
  readonly key: string;
  readonly recordId: string;
  readonly clientIntentId: string;
  readonly semanticCommitment: string;
  readonly storageKind: 'durable' | 'memory';
  readonly claimNonce: string;
  readonly operation: SendAcceptanceOperation;
  readonly baseTarget: string;
  readonly baseTargetKey: string;
  readonly wireTarget: string;
  readonly semanticShape: SendAcceptanceSemanticShape;
  readonly owner: OwnerSnapshot;
  readonly endpointId: EndpointId;
  readonly ticketRef: symbol;
  readonly ticket: LocalNamespaceTicket;
  readonly ownerKey: string;
  readonly workspaceEpoch: number;
  readonly mappingRevision: string | null;
  readonly requestId: RequestContext['requestId'];
  readonly context: RequestContext;
  readonly planHash: string;
  readonly linesJson: string;
  readonly validationReceipt: string;
  readonly expiresAt: number;
  readonly expectations: ExpectedLine[];
  readonly labelMode: 'labelled' | 'memo-unlabelled' | 'unavailable';
  admission: SendAdmissionObservation | null;
  state: 'prepared' | 'pending' | 'unknown' | 'blocked' | 'accepted' | 'rejected';
  proofRef: symbol | null;
}
interface AcceptanceReceipt {
  readonly attemptKey: string;
  readonly expiresAt: number;
  readonly linesJson: string;
  readonly planHash: string;
}
interface AcceptanceProof {
  readonly proofRef: symbol;
  readonly attempt: AcceptanceAttempt;
  readonly messageIds: readonly string[];
  readonly expiresAt: number;
}

const MAX_PENDING_ATTEMPTS = 32;
const MAX_EXPECTED_LINES = 1024;
const MAX_TERMINAL_PROOFS = 256;
const MAX_BATCHES = 256;
const MAX_USED_LABELS = 65_536;
const EXPECTATION_TTL_MS = 30_000;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_GROUP_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const validRef = (value: string): boolean => /^[A-Za-z0-9_-]{22,128}$/u.test(value);
const clean = (value: string, max: number): boolean => value.length > 0 && encoder.encode(value).byteLength <= max && !/[\u0000-\u0020\u007f]/u.test(value);
const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot): boolean => a.networkId === b.networkId && a.accountId === b.accountId
  && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
  && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;

function scopeKey(owner: OwnerSnapshot): string {
  return JSON.stringify([owner.networkId, owner.physicalRef, owner.connectionGeneration, owner.accountGeneration, owner.accountId]);
}
function hashText(text: string): Promise<string | null> {
  try {
    return crypto.subtle.digest('SHA-256', encoder.encode(text)).then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  } catch { return Promise.resolve(null); }
}
function opaqueRef(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function wireLineValid(line: string): boolean {
  return line.length > 0 && !/[\r\n\u0000]/u.test(line) && encoder.encode(line).byteLength <= MAX_LINE_BYTES;
}
function parseLabelFailure(message: ReturnType<typeof parseIRCMessage>): { readonly family: string; readonly code: string } | null {
  if (message.command === 'FAIL' && message.prefix === null) {
    const family = message.params[0]?.toUpperCase(); const code = message.params[1]?.toUpperCase();
    return family && code ? { family, code } : null;
  }
  if (message.command === 'NOTICE' && message.params.length === 2) {
    const match = /^FAIL\s+([A-Z0-9_-]{1,64})\s+([A-Z0-9_-]{1,64})(?::\s|\s|$)/u.exec(message.params[1] ?? '');
    return match?.[1] && match[2] ? { family: match[1], code: match[2] } : null;
  }
  if ((message.command === '461' || message.command === '464') && message.params[1]) {
    return { family: message.params[1]!.toUpperCase(), code: message.command };
  }
  return null;
}
function memoSuccess(body: string): boolean {
  if (body === 'MEMO: message stored for delivery') return true;
  const forwarded = /^MEMO: message stored \(forwarded to ([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\)$/u.exec(body);
  return Boolean(forwarded?.[1]);
}

/** Private, bounded correlation for source-proven server acknowledgements. */
export function createSendAcceptanceRegistry(deps: SendAcceptanceRegistryDependencies): SendAcceptancePublicApi {
  const attempts = new Map<string, AcceptanceAttempt>();
  const receipts = new Map<string, AcceptanceReceipt>();
  const proofs = new Map<symbol, AcceptanceProof>();
  const batchLabels = new Map<string, { readonly label: string; readonly scope: string; readonly expiresAt: number }>();
  const usedLabels = new Map<string, Set<string>>();
  const unlabelledMemoByScope = new Map<string, string>();
  let disposed = false;

  const activeOwner = (): OwnerSnapshot => deps.ownerSnapshot();
  const scopeCurrent = (owner: OwnerSnapshot, endpoint: EndpointId): boolean => !disposed
    && sameOwner(activeOwner(), owner) && deps.isCurrent(owner) && deps.currentEndpointId() === endpoint;
  const trim = (): void => {
    const time = deps.now();
    for (const [key, attempt] of attempts) {
      if (attempt.expiresAt > time) continue;
      if (attempt.state === 'pending' || attempt.state === 'prepared') attempt.state = 'unknown';
      receipts.delete(attempt.validationReceipt);
      if (attempt.labelMode === 'memo-unlabelled' && attempt.state === 'blocked') unlabelledMemoByScope.delete(scopeKey(attempt.owner));
      if (attempt.state === 'accepted' || attempt.state === 'rejected' || attempt.state === 'blocked'
        || attempt.labelMode !== 'memo-unlabelled') attempts.delete(key);
    }
    for (const [ref, receipt] of receipts) if (receipt.expiresAt <= time) receipts.delete(ref);
    for (const [ref, proof] of proofs) if (proof.expiresAt <= time) proofs.delete(ref);
    for (const [ref, batch] of batchLabels) if (batch.expiresAt <= time) batchLabels.delete(ref);
    while (proofs.size > MAX_TERMINAL_PROOFS) proofs.delete(proofs.keys().next().value as symbol);
    while (receipts.size > MAX_PENDING_ATTEMPTS * 2) receipts.delete(receipts.keys().next().value as string);
    while (batchLabels.size > MAX_BATCHES) batchLabels.delete(batchLabels.keys().next().value as string);
  };
  const requestIdFor = (context: RequestContext): RequestContext['requestId'] => context.requestId;
  const rowRecordId = (row: Readonly<JournalRow>): string | null => {
    try {
      const parts = JSON.parse(row.id) as unknown[];
      return typeof parts[1] === 'string' ? parts[1] : null;
    } catch { return null; }
  };
  const makeProof = (attempt: AcceptanceAttempt): void => {
    // A matching echo/notice can race the async durable claim update. Keep its
    // message IDs on the attempt, but publish the proof only after the journal
    // has recorded the transport outcome that binds this plan to a row.
    if (!attempt.admission || attempt.proofRef || attempt.state === 'blocked' || attempt.state === 'rejected') return;
    if (!attempt.expectations.length || attempt.expectations.some((line) => !line.messageId)) return;
    const proofRef = Symbol('send-acceptance-proof');
    const messageIds = attempt.expectations.map((line) => line.messageId!).filter((id) => id && !id.startsWith('memo:'));
    const proof: AcceptanceProof = { proofRef, attempt, messageIds, expiresAt: Math.max(attempt.expiresAt, deps.now() + EXPECTATION_TTL_MS) };
    proofs.set(proofRef, proof);
    attempt.proofRef = proofRef;
    attempt.state = 'accepted';
    trim();
    try { deps.onProofReady({ recordId: attempt.recordId, proofRef, context: attempt.context, messageIds, storageKind: attempt.storageKind }); } catch { /* bootstrap will reconcile only from its own queue */ }
  };
  const releaseAttempt = (attempt: AcceptanceAttempt, state: AcceptanceAttempt['state']): void => {
    attempt.state = state;
    if (attempt.labelMode === 'memo-unlabelled' && (state === 'blocked' || state === 'rejected')) unlabelledMemoByScope.delete(scopeKey(attempt.owner));
    if (state === 'blocked' || state === 'rejected') {
      for (const [batch, binding] of batchLabels) if (binding.scope === scopeKey(attempt.owner)) batchLabels.delete(batch);
      receipts.delete(attempt.validationReceipt);
    }
  };
  const currentProofAttempt = (proof: AcceptanceProof, request: RequestContext & { readonly recordId: string }, row: Readonly<JournalRow>): boolean => {
    const attempt = proof.attempt;
    return proof.expiresAt > deps.now() && attempt.recordId === request.recordId
      && attempt.requestId === request.requestId && sameOwner(attempt.owner, request.owner)
      && scopeCurrent(attempt.owner, attempt.endpointId) && attempt.state === 'accepted'
      && deps.isNamespaceCurrent(attempt.ticket, request)
      && row.id === JSON.stringify([attempt.ticket.ownerKey, attempt.recordId]) && row.ownerKey === attempt.ticket.ownerKey
      && rowRecordId(row) === attempt.recordId && row.clientIntentId === attempt.clientIntentId
      && row.operation === (attempt.operation === 'memo-send' ? 'memo-send' : 'privmsg')
      && row.target === attempt.baseTarget && row.targetKey === attempt.baseTargetKey
      && row.payload.payloadCommitment === attempt.semanticCommitment
      && row.dispatchAttempt?.nonce === attempt.claimNonce && row.dispatchAttempt.planHash === attempt.planHash
      && (row.state === 'transport-admitted' || row.state === 'delivery-unknown' || row.state === 'server-accepted');
  };

  return {
    async prepareAttempt(input): Promise<PreparedAcceptanceAttempt | null> {
      trim();
      if (disposed || attempts.size >= MAX_PENDING_ATTEMPTS || !clean(input.recordId, 512) || !clean(input.clientIntentId, 128)
        || (input.storageKind !== 'durable' && input.storageKind !== 'memory')
        || !/^[a-f0-9]{64}$/u.test(input.semanticCommitment) || !validRef(input.claimNonce) || !clean(input.baseTarget, 512)
        || !clean(input.baseTargetKey, 512)
        || !clean(input.wireTarget, 512) || !makeConversationId(input.baseTarget) || !Array.isArray(input.lines)
        || input.lines.length === 0 || input.lines.length > MAX_EXPECTED_LINES) return null;
      const owner = activeOwner();
      const ticket = input.ticket;
      if (!sameOwner(owner, input.context.owner) || !deps.isCurrent(owner) || !deps.isNamespaceCurrent(ticket, input.context)
        || owner.physicalRef === null || ticket.scope.networkId !== owner.networkId || ticket.scope.accountId !== owner.accountId
        || (ticket.scope.kind === 'account' ? owner.accountId === null : owner.accountId !== null || ticket.scope.physicalRef !== owner.physicalRef)
        || (input.storageKind === 'durable' && ticket.scope.kind !== 'account')
        || !ticket.conversationScheme || ticket.conversationScheme.revision !== deps.currentMappingRevision()) return null;
      const endpointId = deps.currentEndpointId();
      const scope = scopeKey(owner);
      const caps = new Set([...deps.negotiatedCaps()].map((cap) => cap.toLowerCase().replace(/^[-~]/u, '')));
      const labelled = caps.has('message-tags') && caps.has('labeled-response');
      const echo = caps.has('echo-message');
      if ((input.operation === 'memo-send') !== (input.semanticShape === 'memo')) return null;
      if (input.operation === 'memo-send' && input.semanticShape !== 'memo') return null;
      if (input.semanticShape === 'single-message' && input.lines.length !== 1) return null;
      if (input.semanticShape === 'memo' && input.lines.length !== 1) return null;
      const originalLines = [...input.lines];
      let totalBytes = 0;
      const parsedLines = [] as ReturnType<typeof parseIRCMessage>[];
      for (const line of originalLines) {
        if (!wireLineValid(line)) return null;
        totalBytes += encoder.encode(line).byteLength;
        if (totalBytes > MAX_GROUP_BYTES) return null;
        const parsed = parseIRCMessage(line);
        if (parsed.prefix !== null || Object.hasOwn(parsed.tags, 'label') || (input.semanticShape !== 'multiline-batch-group' && Object.hasOwn(parsed.tags, 'batch')) || Object.hasOwn(parsed.tags, 'msgid')) return null;
        if (input.semanticShape === 'multiline-batch-group') {
          if (input.operation !== 'privmsg' || parsed.command !== 'BATCH' && parsed.command !== 'PRIVMSG') return null;
        } else if (input.operation === 'privmsg') {
          if (parsed.command !== 'PRIVMSG' || parsed.params[0] !== input.wireTarget) return null;
        } else if (parsed.command !== 'MEMO' || parsed.params[0]?.toUpperCase() !== 'SEND' || parsed.params[1] !== input.wireTarget) return null;
        parsedLines.push(parsed);
      }
      const memoReservation = `${scope}:${input.recordId}:${input.claimNonce}`;
      const releaseMemoReservation = (): void => { if (unlabelledMemoByScope.get(scope) === memoReservation) unlabelledMemoByScope.delete(scope); };
      let labelMode: AcceptanceAttempt['labelMode'] = labelled && input.semanticShape !== 'multiline-batch-group' ? 'labelled' : 'unavailable';
      if (!labelled && input.operation === 'memo-send') {
        if (unlabelledMemoByScope.has(scope)) return null;
        unlabelledMemoByScope.set(scope, memoReservation);
        labelMode = 'memo-unlabelled';
      }
      if (!labelled && input.operation === 'privmsg' && input.semanticShape === 'single-message') labelMode = 'unavailable';
      const labels = usedLabels.get(scope) ?? new Set<string>();
      if (!usedLabels.has(scope)) usedLabels.set(scope, labels);
      if (labelMode === 'labelled' && labels.size >= MAX_USED_LABELS) { releaseMemoReservation(); return null; }
      const expectations: ExpectedLine[] = [];
      const lines: string[] = [];
      for (let index = 0; index < parsedLines.length; index += 1) {
        const parsed = parsedLines[index]!;
        let label: string | null = null;
        let output = originalLines[index]!;
        if (labelMode === 'labelled') {
          do { label = opaqueRef(); } while (labels.has(label));
          labels.add(label);
          const tags = { ...parsed.tags, label };
          output = formatTaggedLine(tags, parsed.command, ...parsed.params).replace(/\r?\n$/u, '');
          if (!wireLineValid(output)) return null;
          expectations.push({ label, command: input.operation === 'memo-send' ? 'MEMO' : 'PRIVMSG', target: input.wireTarget, messageId: null });
        }
        lines.push(output);
      }
      if (input.operation === 'memo-send' && labelMode === 'memo-unlabelled') expectations.push({ label: null, command: 'MEMO', target: input.wireTarget, messageId: null });
      const finalTotal = lines.reduce((sum, line) => sum + encoder.encode(line).byteLength, 0);
      if (finalTotal > MAX_GROUP_BYTES) { releaseMemoReservation(); return null; }
      const planHash = await hashText(JSON.stringify(lines));
      if (!planHash || !scopeCurrent(owner, endpointId) || !deps.isNamespaceCurrent(ticket, input.context)) { releaseMemoReservation(); return null; }
      if (input.operation === 'privmsg' && (!echo || input.semanticShape === 'multiline-batch-group')) expectations.splice(0);
      if (input.semanticShape === 'multiline-batch-group') expectations.splice(0);
      const key = `${scope}:${input.recordId}:${input.claimNonce}`;
      if (attempts.has(key)) { releaseMemoReservation(); return null; }
      const validationReceipt = opaqueRef();
      const time = deps.now();
      const attempt: AcceptanceAttempt = {
        key, recordId: input.recordId, clientIntentId: input.clientIntentId, semanticCommitment: input.semanticCommitment, storageKind: input.storageKind,
        claimNonce: input.claimNonce, operation: input.operation, baseTarget: input.baseTarget, baseTargetKey: input.baseTargetKey, wireTarget: input.wireTarget,
        semanticShape: input.semanticShape, owner, endpointId, ticketRef: ticket.ref, ticket, ownerKey: ticket.ownerKey,
        workspaceEpoch: ticket.workspaceEpoch, mappingRevision: ticket.conversationScheme.revision,
        requestId: requestIdFor(input.context), context: input.context, planHash, linesJson: JSON.stringify(lines),
        validationReceipt, expiresAt: time + EXPECTATION_TTL_MS, expectations, labelMode,
        admission: null, state: 'prepared', proofRef: null,
      };
      attempts.set(key, attempt);
      if (labelMode === 'memo-unlabelled') unlabelledMemoByScope.set(scope, key);
      receipts.set(validationReceipt, { attemptKey: key, expiresAt: attempt.expiresAt, linesJson: attempt.linesJson, planHash: attempt.planHash });
      return { lines, validationReceipt, planHash };
    },
    validatePreparedDispatch(row, request, ticket, prepared): boolean {
      trim();
      if (!scopeCurrent(request.owner, deps.currentEndpointId()) || !deps.isCurrent(request.owner)
        || ticket.scope.networkId !== request.owner.networkId || ticket.ownerKey.length === 0
        || ticket.scope.accountId !== request.owner.accountId
        || (ticket.scope.kind === 'account' ? request.owner.accountId === null : request.owner.accountId !== null || ticket.scope.physicalRef !== request.owner.physicalRef)
        || (ticket.scope.kind === 'guest' && row.operation !== 'privmsg')
        || ticket.conversationScheme?.revision !== deps.currentMappingRevision()) return false;
      const receipt = receipts.get(prepared.validationReceipt);
      if (!receipt || receipt.expiresAt <= deps.now() || receipt.linesJson !== JSON.stringify(prepared.lines)) return false;
      const attempt = attempts.get(receipt.attemptKey);
      return Boolean(attempt && attempt.state === 'prepared' && attempt.expiresAt > deps.now()
        && row.id === JSON.stringify([attempt.ticket.ownerKey, attempt.recordId]) && row.ownerKey === attempt.ticket.ownerKey
        && attempt.recordId === rowRecordId(row) && attempt.clientIntentId === row.clientIntentId
        && attempt.semanticCommitment === row.payload.payloadCommitment && attempt.claimNonce === row.claimNonce
        && attempt.operation === (row.operation === 'memo-send' ? 'memo-send' : 'privmsg')
        && attempt.baseTarget === row.target && attempt.baseTargetKey === row.targetKey && attempt.planHash === receipt.planHash
        && attempt.planHash === row.dispatchAttempt?.planHash && attempt.linesJson === JSON.stringify(prepared.lines)
        && attempt.requestId === request.requestId && sameOwner(attempt.owner, request.owner)
        && attempt.mappingRevision === ticket.conversationScheme?.revision
        && attempt.ticketRef === ticket.ref && attempt.ownerKey === ticket.ownerKey && attempt.workspaceEpoch === ticket.workspaceEpoch
        && deps.isNamespaceCurrent(ticket, request)
        && attempt.endpointId === deps.currentEndpointId() && scopeCurrent(attempt.owner, attempt.endpointId));
    },
    validateMemoryPreparedPlan(input): boolean {
      trim();
      const receipt = receipts.get(input.prepared.validationReceipt);
      if (!receipt || receipt.expiresAt <= deps.now() || receipt.linesJson !== JSON.stringify(input.prepared.lines)) return false;
      const attempt = attempts.get(receipt.attemptKey);
      return Boolean(attempt && attempt.storageKind === 'memory' && attempt.operation === 'privmsg'
        && attempt.state === 'prepared' && attempt.expiresAt > deps.now() && attempt.recordId === input.recordId
        && attempt.clientIntentId === input.clientIntentId && attempt.claimNonce === input.claimNonce
        && attempt.semanticCommitment === input.semanticCommitment && attempt.baseTarget === input.baseTarget
        && attempt.baseTargetKey === input.baseTargetKey && attempt.wireTarget === input.wireTarget
        && attempt.requestId === input.context.requestId && sameOwner(attempt.owner, input.context.owner)
        && attempt.ticketRef === input.ticket.ref && attempt.ownerKey === input.ticket.ownerKey && attempt.workspaceEpoch === input.ticket.workspaceEpoch
        && attempt.mappingRevision === input.ticket.conversationScheme?.revision && attempt.planHash === input.prepared.planHash
        && attempt.linesJson === JSON.stringify(input.prepared.lines) && scopeCurrent(attempt.owner, attempt.endpointId)
        && deps.isNamespaceCurrent(input.ticket, input.context));
    },
    observeAdmission(input): void {
      trim();
      for (const attempt of attempts.values()) {
        if (attempt.recordId !== input.recordId || attempt.claimNonce !== input.claimNonce || attempt.planHash !== input.planHash) continue;
        if (input.kind === 'blocked') { if (!attempt.proofRef) releaseAttempt(attempt, 'blocked'); return; }
        attempt.admission = input.kind;
        if (!attempt.proofRef) attempt.state = input.kind === 'transport-admitted' ? 'pending' : 'unknown';
        makeProof(attempt);
        return;
      }
    },
    ingest(event): boolean {
      trim();
      if (disposed || !event || !event.owner || !scopeCurrent(event.owner, deps.currentEndpointId())) return false;
      const owner = event.owner;
      const scope = scopeKey(owner);
      const prefix = deps.currentServerPrefix();
      const nick = deps.currentNick();
      const message = parseIRCMessage(event.line);
      if (event.sourceKind === 'server' && prefix && message.prefix === prefix && message.command === 'BATCH') {
        const value = message.params[0] ?? '';
        if (value.startsWith('+') && message.params[1] === 'labeled-response') {
          const batchRef = value.slice(1);
          const label = message.tags.label;
          if (!batchRef || batchLabels.has(batchRef) || batchLabels.size >= MAX_BATCHES || !label
            || ![...attempts.values()].some((item) => sameOwner(item.owner, owner) && item.expectations.some((line) => line.label === label)
              && deps.isNamespaceCurrent(item.ticket, item.context))) return false;
          batchLabels.set(batchRef, { label, scope, expiresAt: deps.now() + EXPECTATION_TTL_MS });
          trim(); return true;
        }
        if (value.startsWith('-')) return batchLabels.delete(value.slice(1));
      }
      const batchRef = message.tags.batch;
      const batchLabel = batchRef ? batchLabels.get(batchRef) : undefined;
      const directLabel = message.tags.label || null;
      if (directLabel && batchLabel && directLabel !== batchLabel.label) return false;
      const label = directLabel ?? batchLabel?.label ?? null;
      let consumed = false;
      for (const attempt of attempts.values()) {
        if (scopeKey(attempt.owner) !== scope || !sameOwner(attempt.owner, owner) || attempt.endpointId !== deps.currentEndpointId()) continue;
        if (!scopeCurrent(attempt.owner, attempt.endpointId) || !deps.isNamespaceCurrent(attempt.ticket, attempt.context)) continue;
        if (label) {
          const expected = attempt.expectations.find((line) => line.label === label);
          if (!expected) continue;
          if (expected.command === 'PRIVMSG') {
            if (event.sourceKind !== 'user' || !nick || message.nick !== nick || message.command !== 'PRIVMSG'
              || message.params[0] !== expected.target || !message.tags.msgid || !makeMessageId(message.tags.msgid)) continue;
            expected.messageId = message.tags.msgid;
            consumed = true;
            makeProof(attempt);
            continue;
          }
          if (event.sourceKind === 'server' && prefix && message.prefix === prefix && message.command === 'NOTICE'
            && nick && message.params[0] === nick && memoSuccess(message.params[1] ?? '')) {
            expected.messageId = `memo:${attempt.recordId}`;
            consumed = true;
            makeProof(attempt);
            continue;
          }
          const failure = parseLabelFailure(message);
          const trustedFailure = (event.sourceKind === 'prefixless-protocol' && message.prefix === null)
            || (event.sourceKind === 'server' && Boolean(prefix && message.prefix === prefix && message.command === 'NOTICE' && nick && message.params[0] === nick));
          if (trustedFailure && failure && failure.family === (expected.command === 'MEMO' ? 'MEMO' : 'PRIVMSG')) { releaseAttempt(attempt, 'rejected'); consumed = true; }
          continue;
        }
        if (attempt.labelMode === 'memo-unlabelled' && attempt.operation === 'memo-send' && attempt.state !== 'blocked' && attempt.state !== 'rejected') {
          if (event.sourceKind === 'server' && prefix && message.prefix === prefix && message.command === 'NOTICE'
            && nick && message.params[0] === nick && memoSuccess(message.params[1] ?? '')) {
            const expected = attempt.expectations[0];
            if (expected) expected.messageId = `memo:${attempt.recordId}`;
            unlabelledMemoByScope.delete(scope);
            consumed = true;
            // No label means it may only become proof after durable admission and only while this sole stream is held.
            makeProof(attempt);
          } else {
            const failure = parseLabelFailure(message);
            const trustedFailure = (event.sourceKind === 'prefixless-protocol' && message.prefix === null)
              || (event.sourceKind === 'server' && Boolean(prefix && message.prefix === prefix && message.command === 'NOTICE' && nick && message.params[0] === nick));
            if (trustedFailure && failure?.family === 'MEMO') { releaseAttempt(attempt, 'rejected'); consumed = true; }
          }
        }
      }
      return consumed;
    },
    verifyAcceptanceProof(proofRef, request, row): boolean {
      trim();
      const proof = proofs.get(proofRef);
      return Boolean(proof && currentProofAttempt(proof, request, row));
    },
    verifyMemoryAcceptanceProof(proofRef, request, recordId, clientIntentId): boolean {
      trim();
      const proof = proofs.get(proofRef);
      const attempt = proof?.attempt;
      return Boolean(proof && attempt && proof.expiresAt > deps.now() && attempt.storageKind === 'memory'
        && attempt.recordId === recordId && attempt.clientIntentId === clientIntentId && attempt.requestId === request.requestId
        && sameOwner(attempt.owner, request.owner) && attempt.state === 'accepted'
        && scopeCurrent(attempt.owner, attempt.endpointId) && deps.isNamespaceCurrent(attempt.ticket, request)
        && attempt.expectations.length > 0 && attempt.expectations.every((line) => !!line.messageId));
    },
    acceptanceProofCommitted(proofRef): void {
      const proof = proofs.get(proofRef);
      if (!proof) return;
      attempts.delete(proof.attempt.key);
      receipts.delete(proof.attempt.validationReceipt);
      proofs.delete(proofRef);
      if (proof.attempt.labelMode === 'memo-unlabelled') unlabelledMemoByScope.delete(scopeKey(proof.attempt.owner));
    },
    memoCorrelationClear(request, ticket): boolean {
      trim();
      if (disposed || ticket.scope.networkId !== request.owner.networkId || ticket.scope.accountId !== request.owner.accountId
        || (ticket.scope.kind === 'account' ? request.owner.accountId === null : request.owner.accountId !== null || ticket.scope.physicalRef !== request.owner.physicalRef)
        || !scopeCurrent(request.owner, deps.currentEndpointId()) || !deps.isNamespaceCurrent(ticket, request)) return false;
      const scope = scopeKey(request.owner);
      const key = unlabelledMemoByScope.get(scope);
      if (!key) return true;
      const attempt = attempts.get(key);
      return Boolean(attempt && (attempt.state === 'blocked' || attempt.state === 'rejected' || attempt.state === 'accepted'));
    },
    retireOwner(owner): void {
      const scope = scopeKey(owner);
      for (const [key, attempt] of attempts) if (sameOwner(attempt.owner, owner)) {
        attempt.state = 'unknown'; attempts.delete(key); receipts.delete(attempt.validationReceipt);
      }
      for (const [ref, proof] of proofs) if (sameOwner(proof.attempt.owner, owner)) proofs.delete(ref);
      for (const [ref, batch] of batchLabels) if (batch.scope === scope) batchLabels.delete(ref);
      usedLabels.delete(scope);
      unlabelledMemoByScope.delete(scope);
    },
    dispose(): void {
      disposed = true; attempts.clear(); receipts.clear(); proofs.clear(); batchLabels.clear(); usedLabels.clear(); unlabelledMemoByScope.clear();
    },
  };
}

