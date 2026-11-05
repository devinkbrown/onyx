import { parseIRCMessage } from '../../src/lib/irc/parser';
import { makeCredentialRef, makeRequestId, type CredentialRef, type EndpointId, type NetworkId, type OwnerSnapshot, type PrivateIngressEvent, type RequestContext, type RequestId, type SendAdmission } from './contracts';

export type RecoveryOutcome = 'exact-restored' | 'logical-attached' | 'legacy-new-attachment' | 'attachment-in-use' | 'missing' | 'revoked' | 'invalid' | 'retryable' | 'redirect' | 'unknown';
export type RecoveryReason = 'invalid-request' | 'busy' | 'credential-unavailable' | 'credential-expired' | 'owner-changed' | 'account-proof-required' | 'offline' | 'backpressure' | 'local-policy' | 'transport-error' | 'response-timeout' | 'untrusted-redirect' | 'redirect-loop' | 'redirect-limit' | 'kind-mismatch' | 'server-rejected';
export type RecoveryStatus = 'pending' | 'transport-admitted' | 'blocked' | 'unknown' | 'redirecting' | 'awaiting-authentication' | 'accepted' | 'rejected';

export interface RecoveryRequest { readonly context: RequestContext; readonly credentialRef: CredentialRef; readonly acceptLegacyNewAttachment?: true }
export interface RecoveryEvent {
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
  readonly credentialRef: CredentialRef;
  readonly status: RecoveryStatus;
  readonly outcome: RecoveryOutcome | null;
  readonly reason: RecoveryReason | null;
  readonly redirectNode: string | null;
  readonly hopCount: number;
}
export interface TrustedRecoveryEndpoint { readonly networkId: NetworkId; readonly endpointId: EndpointId; readonly url: string; readonly nodeName: string }
export interface PrivateRecoveryCredentialLease {
  readonly credentialKind: 'local-logical' | 'local-exact' | 'mesh-logical' | 'mesh-exact' | 'unknown';
  readonly issuerEndpointId: EndpointId;
  readonly expiresAtMs: number | null;
  resume(owner: OwnerSnapshot, requestId: RequestId): Promise<SendAdmission>;
  forget?(): void;
  release(): void;
}
export interface SessionRecoveryDependencies {
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentEndpointId: () => EndpointId;
  readonly currentServerPrefix: () => string | null;
  readonly currentNick: () => string | null;
  readonly pinCredential: (context: RequestContext, credentialRef: CredentialRef) => PrivateRecoveryCredentialLease | null;
  readonly resolveRedirectNode: (networkId: NetworkId, nodeName: string) => TrustedRecoveryEndpoint | null;
  readonly isTrustedEndpoint: (endpoint: EndpointId) => boolean;
  readonly requestRedirect: (input: { readonly requestId: RequestId; readonly fromOwner: OwnerSnapshot; readonly target: TrustedRecoveryEndpoint }) => Promise<'started' | 'blocked'>;
  readonly emit: (event: RecoveryEvent) => void;
  readonly now: () => number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

const RESPONSE_TIMEOUT_MS = 30_000;
const MAX_REDIRECT_HOPS = 3;
const EXACT_SUCCESS = new Set([
  'SESSION RESUME: already attached to this exact session',
  'SESSION RESUME: exact session restored',
  'SESSION RESUME: exact session reclaimed',
  'SESSION RESUME: exact session restored (cross-server)',
  'SESSION RESUME: exact session reclaimed (cross-server)',
]);
const LEGACY_SUCCESS = new Set([
  'SESSION RESUME: legacy session state cloned into a new attachment',
  'SESSION RESUME: legacy session attached as a new attachment',
]);
const LOGICAL_SUCCESS = new Set([
  'SESSION RESUME: already attached to this session',
  'SESSION RESUME: attached to live session',
  'SESSION RESUME: already attached to this mesh session',
  'SESSION RESUME: attached to live mesh session',
  'SESSION RESUME: attached to replicated mesh session',
  'SESSION RESUME: session restored (cross-server)',
  'SESSION RESUME: session reclaimed (cross-server)',
]);
const NODE_NAME = '[A-Za-z0-9._-]{1,128}';
const REDIRECT_EXACT = new RegExp(`^SESSION REDIRECT: exact session lives on (${NODE_NAME}); reconnect there to reclaim$`, 'u');
const REDIRECT_LOGICAL = new RegExp(`^SESSION REDIRECT: session lives on (${NODE_NAME}); reconnect there to reclaim$`, 'u');
const RETRYABLE = new Set(['TEMPORARILY_UNAVAILABLE', 'ORIGIN_UNREACHABLE', 'RESUME_CREDENTIAL_PRESERVED']);
const INVALID = new Set(['INVALID_TOKEN']);

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function safeAdmissionReason(admission: SendAdmission): RecoveryReason {
  if (admission.kind === 'unknown') return 'transport-error';
  if (admission.kind !== 'blocked') return 'server-rejected';
  switch (admission.reason) {
    case 'owner-changed': return 'owner-changed';
    case 'offline': return 'offline';
    case 'backpressure': return 'backpressure';
    case 'policy': return 'local-policy';
    case 'invalid-intent': return 'invalid-request';
  }
}

interface Attempt { readonly owner: OwnerSnapshot; readonly endpointId: EndpointId; readonly prefix: string; readonly nick: string }
interface Pending {
  readonly requestId: RequestId;
  readonly credentialRef: CredentialRef;
  readonly acceptLegacyNewAttachment: boolean;
  readonly lease: PrivateRecoveryCredentialLease;
  readonly originalNetworkId: NetworkId;
  readonly originalAccountId: string;
  readonly visited: Set<EndpointId>;
  hopCount: number;
  attempt: Attempt;
  target: TrustedRecoveryEndpoint | null;
  stage: 'admitting' | 'waiting' | 'redirecting' | 'authenticating' | 'settled';
  timer: ReturnType<typeof setTimeout> | null;
  readonly deferred: Array<{ readonly owner: OwnerSnapshot; readonly command: string; readonly body: string; readonly failureCommand: string | null; readonly failureCode: string | null }>;
}

/** Keeps only the credential lease and routing metadata private in memory while
 * a resume is admitted, redirected, and reauthenticated. It never owns token bytes. */
export function createSessionRecoveryController(deps: SessionRecoveryDependencies) {
  let pending: Pending | null = null;
  let disposed = false;
  let attemptedPhysicalRef: OwnerSnapshot['physicalRef'] = null;
  const timers = { set: deps.setTimer ?? setTimeout, clear: deps.clearTimer ?? clearTimeout };

  function isCurrent(owner: OwnerSnapshot): boolean {
    return !disposed && deps.isCurrent(owner) && sameOwner(owner, deps.currentOwner());
  }
  function emitUnstarted(requestId: RequestId, owner: OwnerSnapshot, credentialRef: CredentialRef, reason: RecoveryReason): void {
    if (disposed) return;
    deps.emit({ requestId, owner: { ...owner }, credentialRef, status: 'blocked', outcome: null, reason, redirectNode: null, hopCount: 0 });
  }
  function publish(item: Pending, owner: OwnerSnapshot, status: RecoveryStatus, outcome: RecoveryOutcome | null = null, reason: RecoveryReason | null = null, redirectNode: string | null = null): void {
    if (pending !== item || disposed) return;
    deps.emit({ requestId: item.requestId, owner: { ...owner }, credentialRef: item.credentialRef, status, outcome, reason, redirectNode, hopCount: item.hopCount });
  }
  function clearTimer(item: Pending): void { if (item.timer !== null) timers.clear(item.timer); item.timer = null; }
  // Keep the stage check behind a function boundary across awaits: ingress
  // callbacks can advance it while TypeScript's local narrowing is stale.
  function isWaiting(item: Pending): boolean { return pending === item && item.stage === 'waiting'; }
  function settle(item: Pending): void {
    clearTimer(item);
    item.stage = 'settled';
    if (pending === item) pending = null;
    item.lease.release();
  }
  function emitAdmission(item: Pending, owner: OwnerSnapshot, admission: SendAdmission): void {
    if (pending !== item) return;
    if (!isCurrent(owner)) {
      publish(item, owner, 'blocked', null, 'owner-changed');
      settle(item);
      return;
    }
    if (admission.kind === 'blocked') {
      publish(item, owner, 'blocked', null, safeAdmissionReason(admission));
      if (attemptedPhysicalRef === owner.physicalRef) attemptedPhysicalRef = null;
      settle(item);
      return;
    }
    if (admission.kind === 'unknown') {
      publish(item, owner, 'unknown', 'unknown', safeAdmissionReason(admission));
    } else {
      publish(item, owner, 'transport-admitted');
    }
    item.stage = 'waiting';
    attemptedPhysicalRef = owner.physicalRef;
    clearTimer(item);
    item.timer = timers.set(() => {
      if (pending !== item || item.stage !== 'waiting' || !isCurrent(item.attempt.owner)) return;
      publish(item, item.attempt.owner, 'unknown', 'unknown', 'response-timeout');
      settle(item);
    }, RESPONSE_TIMEOUT_MS);
  }
  function validAttempt(owner: OwnerSnapshot): Attempt | null {
    const prefix = deps.currentServerPrefix();
    const nick = deps.currentNick();
    const endpointId = deps.currentEndpointId();
    if (!prefix || !nick || owner.physicalRef === null || !owner.accountId || !isCurrent(owner)) return null;
    return { owner: { ...owner }, endpointId, prefix, nick };
  }
  function exactIngress(item: Pending, event: PrivateIngressEvent): { command: string; body: string; failureCommand: string | null; failureCode: string | null } | null {
    const attempt = item.attempt;
    if ((event.sourceKind !== 'server' && event.sourceKind !== 'prefixless-protocol') || !sameOwner(event.owner, attempt.owner) || !isCurrent(attempt.owner)
      || deps.currentServerPrefix() !== attempt.prefix || deps.currentNick() !== attempt.nick || deps.currentEndpointId() !== attempt.endpointId) return null;
    let parsed: ReturnType<typeof parseIRCMessage>;
    try { parsed = parseIRCMessage(event.line); } catch { return null; }
    if ((event.sourceKind === 'server' && parsed.prefix !== attempt.prefix)
      || (event.sourceKind === 'prefixless-protocol' && parsed.prefix !== null)) return null;
    if (event.sourceKind === 'server' && parsed.command === 'NOTICE' && parsed.params[0] === attempt.nick) {
      const body = parsed.params[1];
      if (body === undefined) return null;
      const fallbackFailure = /^(FAIL|WARN) SESSION ([A-Z_]{1,64}):\s/u.exec(body);
      return { command: parsed.command, body, failureCommand: fallbackFailure?.[1] ?? null, failureCode: fallbackFailure?.[2] ?? null };
    }
    // The daemon's standard FAIL/WARN is deliberately prefixless. Its owner
    // and active unlabeled RESUME correlation come from this exact live socket;
    // the command/code pair must match the narrow session grammar below.
    if (event.sourceKind === 'prefixless-protocol' && (parsed.command === 'FAIL' || parsed.command === 'WARN') && parsed.params[0] === 'SESSION') {
      const code = parsed.params[1];
      if (!code || !/^[A-Z_]{1,64}$/u.test(code)) return null;
      return { command: parsed.command, body: '', failureCommand: parsed.command, failureCode: code };
    }
    return null;
  }
  function failureOutcome(command: string, code: string | null): RecoveryOutcome | null {
    if ((command !== 'FAIL' && command !== 'WARN') || !code) return null;
    if (RETRYABLE.has(code)) return 'retryable';
    if (command === 'FAIL' && code === 'SESSION_REVOKED') return 'revoked';
    if (command === 'FAIL' && INVALID.has(code)) return 'invalid';
    if (command === 'FAIL' && code === 'ATTACHMENT_IN_USE') return 'attachment-in-use';
    if (command === 'FAIL' && (code === 'NO_ATTACHMENT' || code === 'NO_SESSION')) return 'missing';
    return null;
  }
  function stopRedirect(item: Pending, owner: OwnerSnapshot, nodeName: string, reason: RecoveryReason): void {
    publish(item, owner, 'blocked', 'redirect', reason, nodeName);
    clearTimer(item);
    item.stage = 'settled';
    item.lease.release();
    if (pending === item) pending = null;
  }
  async function redirect(item: Pending, nodeName: string, kind: 'exact' | 'logical'): Promise<boolean> {
    const currentAttempt = item.attempt;
    if (pending !== item || item.stage !== 'waiting' || !isCurrent(currentAttempt.owner)) return false;
    const expectedKind = kind === 'exact' ? 'mesh-exact' : 'mesh-logical';
    if (item.lease.credentialKind !== expectedKind) {
      stopRedirect(item, currentAttempt.owner, nodeName, 'kind-mismatch');
      return true;
    }
    if (item.hopCount >= MAX_REDIRECT_HOPS) {
      stopRedirect(item, currentAttempt.owner, nodeName, 'redirect-limit');
      return true;
    }
    let target: TrustedRecoveryEndpoint | null = null;
    try { target = deps.resolveRedirectNode(item.originalNetworkId, nodeName); } catch { target = null; }
    if (!target || target.networkId !== item.originalNetworkId || target.nodeName !== nodeName || !deps.isTrustedEndpoint(target.endpointId)
      || !/^wss:\/\//u.test(target.url) || target.url.length > 2048 || /[\u0000-\u0020\u007f]/u.test(target.url)) {
      stopRedirect(item, currentAttempt.owner, nodeName, 'untrusted-redirect');
      return true;
    }
    if (item.visited.has(target.endpointId)) {
      stopRedirect(item, currentAttempt.owner, nodeName, 'redirect-loop');
      return true;
    }
    item.visited.add(target.endpointId);
    item.hopCount += 1;
    item.target = target;
    item.stage = 'redirecting';
    clearTimer(item);
    publish(item, currentAttempt.owner, 'redirecting', 'redirect', null, nodeName);
    let result: 'started' | 'blocked';
    try { result = await deps.requestRedirect({ requestId: item.requestId, fromOwner: currentAttempt.owner, target }); }
    catch { result = 'blocked'; }
    if (pending !== item || disposed) return true;
    if (result !== 'started') {
      stopRedirect(item, currentAttempt.owner, nodeName, 'offline');
      return true;
    }
    item.stage = 'authenticating';
    publish(item, currentAttempt.owner, 'awaiting-authentication', 'redirect', null, nodeName);
    return true;
  }
  function recognizedOutcome(match: { readonly command: string; readonly body: string; readonly failureCommand: string | null; readonly failureCode: string | null }): boolean {
    return EXACT_SUCCESS.has(match.body) || LOGICAL_SUCCESS.has(match.body) || LEGACY_SUCCESS.has(match.body)
      || REDIRECT_EXACT.test(match.body) || REDIRECT_LOGICAL.test(match.body)
      || failureOutcome(match.failureCommand ?? match.command, match.failureCode) !== null;
  }
  function consumeParsed(item: Pending, match: { readonly owner: OwnerSnapshot; readonly command: string; readonly body: string; readonly failureCommand: string | null; readonly failureCode: string | null }): boolean {
    if (pending !== item || item.stage !== 'waiting' || !sameOwner(match.owner, item.attempt.owner) || !isCurrent(item.attempt.owner)) return false;
    if (EXACT_SUCCESS.has(match.body)) {
      if (item.lease.credentialKind !== 'local-exact' && item.lease.credentialKind !== 'mesh-exact') {
        publish(item, item.attempt.owner, 'unknown', 'exact-restored', 'kind-mismatch'); settle(item); return true;
      }
      publish(item, item.attempt.owner, 'accepted', 'exact-restored'); settle(item); return true;
    }
    if (LOGICAL_SUCCESS.has(match.body)) {
      if (item.lease.credentialKind !== 'local-logical' && item.lease.credentialKind !== 'mesh-logical') {
        publish(item, item.attempt.owner, 'unknown', 'logical-attached', 'kind-mismatch'); settle(item); return true;
      }
      publish(item, item.attempt.owner, 'accepted', 'logical-attached'); settle(item); return true;
    }
    if (LEGACY_SUCCESS.has(match.body)) {
      if (!item.acceptLegacyNewAttachment || item.lease.credentialKind !== 'local-logical') {
        publish(item, item.attempt.owner, 'unknown', 'legacy-new-attachment', 'kind-mismatch'); settle(item); return true;
      }
      publish(item, item.attempt.owner, 'accepted', 'legacy-new-attachment'); settle(item); return true;
    }
    const exactRedirect = REDIRECT_EXACT.exec(match.body);
    const logicalRedirect = REDIRECT_LOGICAL.exec(match.body);
    if (exactRedirect?.[1]) { void redirect(item, exactRedirect[1], 'exact'); return true; }
    if (logicalRedirect?.[1]) { void redirect(item, logicalRedirect[1], 'logical'); return true; }
    const failure = failureOutcome(match.failureCommand ?? match.command, match.failureCode);
    if (failure) {
      const retryable = failure === 'retryable' || failure === 'attachment-in-use';
      if(failure==='invalid'||failure==='missing'||failure==='revoked')item.lease.forget?.();
      publish(item, item.attempt.owner, retryable ? 'blocked' : 'rejected', failure, 'server-rejected');
      // Every definitive server rejection proves this physical socket did not
      // attach the credential. Keep the per-socket replay fence only for an
      // admitted/unknown outcome where a write may have taken effect.
      if (attemptedPhysicalRef === item.attempt.owner.physicalRef) attemptedPhysicalRef = null;
      settle(item);
      return true;
    }
    return false;
  }

  return {
    begin(request: RecoveryRequest): Promise<SendAdmission> {
      const { context, credentialRef } = request;
      const requestId = makeRequestId(context?.requestId);
      const ref = makeCredentialRef(credentialRef);
      const owner = context?.owner;
      if (pending?.stage === 'settled') { pending.lease.release(); pending = null; }
      if (disposed || context?.schemaVersion !== 1 || !requestId || !ref || !owner) return Promise.resolve({ kind: 'blocked', reason: 'invalid-intent' });
      if (pending) { emitUnstarted(requestId, owner, ref, 'busy'); return Promise.resolve({ kind: 'blocked', reason: 'policy' }); }
      if (!isCurrent(owner)) { emitUnstarted(requestId, owner, ref, 'owner-changed'); return Promise.resolve({ kind: 'blocked', reason: 'owner-changed' }); }
      if (!owner.accountId) { emitUnstarted(requestId, owner, ref, 'account-proof-required'); return Promise.resolve({ kind: 'blocked', reason: 'policy' }); }
      if (owner.physicalRef === null || owner.physicalRef === attemptedPhysicalRef) { emitUnstarted(requestId, owner, ref, 'busy'); return Promise.resolve({ kind: 'blocked', reason: 'policy' }); }
      const attempt = validAttempt(owner);
      if (!attempt) { emitUnstarted(requestId, owner, ref, 'offline'); return Promise.resolve({ kind: 'blocked', reason: 'offline' }); }
      let lease: PrivateRecoveryCredentialLease | null = null;
      try { lease = deps.pinCredential(context, ref); } catch { lease = null; }
      if (!lease) { emitUnstarted(requestId, owner, ref, 'credential-unavailable'); return Promise.resolve({ kind: 'blocked', reason: 'policy' }); }
      const endpointId = deps.currentEndpointId();
      if (lease.credentialKind === 'unknown'
        || (lease.credentialKind.startsWith('local-') && lease.issuerEndpointId !== endpointId)
        || (lease.credentialKind.startsWith('mesh-') && !deps.isTrustedEndpoint(endpointId))) {
        lease.release();
        emitUnstarted(requestId, owner, ref, 'credential-unavailable');
        return Promise.resolve({ kind: 'blocked', reason: 'policy' });
      }
      const item: Pending = { requestId, credentialRef: ref, acceptLegacyNewAttachment: request.acceptLegacyNewAttachment === true, lease, originalNetworkId: owner.networkId,
        originalAccountId: owner.accountId, visited: new Set([endpointId]),
        hopCount: 0, attempt, target: null, stage: 'admitting', timer: null, deferred: [] };
      // Install correlation before the lease can admit a write or a response can arrive.
      pending = item;
      publish(item, owner, 'pending');
      if (lease.expiresAtMs !== null && lease.expiresAtMs <= deps.now()) {
        publish(item, owner, 'blocked', null, 'credential-expired');
        settle(item);
        return Promise.resolve({ kind: 'blocked', reason: 'policy' });
      }
      return Promise.resolve().then(() => lease.resume(owner, requestId)).then(admission => {
        emitAdmission(item, owner, admission);
        if (item.stage === 'waiting') {
          const deferred = item.deferred.splice(0);
          for (const match of deferred) {
            if (pending !== item || item.stage !== 'waiting') break;
            consumeParsed(item, match);
          }
        } else item.deferred.length = 0;
        return admission;
      }, () => {
        const admission: SendAdmission = { kind: 'unknown', reason: 'transport-error' };
        emitAdmission(item, owner, admission);
        if (item.stage === 'waiting') {
          const deferred = item.deferred.splice(0);
          for (const match of deferred) {
            if (pending !== item || item.stage !== 'waiting') break;
            consumeParsed(item, match);
          }
        }
        return admission;
      });
    },
    consumePrivateIngress(event: PrivateIngressEvent): boolean {
      const item = pending;
      if (!item || (item.stage !== 'waiting' && item.stage !== 'admitting')) return false;
      const match = exactIngress(item, event);
      if (!match) return false;
      const candidate = { owner: { ...event.owner }, ...match };
      if (item.stage === 'admitting') {
        if (item.deferred.length < 4 && recognizedOutcome(candidate)) item.deferred.push(candidate);
        return recognizedOutcome(candidate);
      }
      return consumeParsed(item, candidate);
    },
    async continueAfterAuthentication(owner: OwnerSnapshot): Promise<SendAdmission | null> {
      const item = pending;
      if (!item || item.stage !== 'authenticating' || !isCurrent(owner) || owner.networkId !== item.originalNetworkId
        || owner.accountId !== item.originalAccountId || !item.target || deps.currentEndpointId() !== item.target.endpointId) return null;
      const attempt = validAttempt(owner);
      if (!attempt || !deps.isTrustedEndpoint(attempt.endpointId)) return { kind: 'blocked', reason: 'policy' };
      item.attempt = attempt;
      item.stage = 'admitting';
      item.deferred.length = 0;
      publish(item, owner, 'pending', 'redirect', null, item.target.nodeName);
      let admission: SendAdmission;
      try { admission = await item.lease.resume(owner, item.requestId); }
      catch { admission = { kind: 'unknown', reason: 'transport-error' }; }
      emitAdmission(item, owner, admission);
      const deferred = item.deferred.splice(0);
      for (const match of deferred) {
        if (!isWaiting(item)) break;
        consumeParsed(item, match);
      }
      return admission;
    },
    retire(owner: OwnerSnapshot, options: { readonly controlledRedirect?: boolean } = {}): void {
      const item = pending;
      if (!item || !sameOwner(item.attempt.owner, owner)) return;
      clearTimer(item);
      if (options.controlledRedirect && (item.stage === 'redirecting' || item.stage === 'authenticating') && item.target) {
        item.stage = 'authenticating';
        publish(item, owner, 'awaiting-authentication', 'redirect', null, item.target.nodeName);
        return;
      }
      pending = null;
      item.stage = 'settled';
      item.lease.release();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const item = pending;
      pending = null;
      if (item) { clearTimer(item); item.stage = 'settled'; item.lease.release(); }
    },
  };
}
