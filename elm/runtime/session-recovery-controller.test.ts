import { describe, expect, it, vi } from 'vitest';
import { createSessionRecoveryController, type PrivateRecoveryCredentialLease, type RecoveryEvent, type TrustedRecoveryEndpoint } from './session-recovery-controller';
import type { CredentialRef, EndpointId, NetworkId, OwnerSnapshot, PrivateIngressEvent, RequestContext, SendAdmission } from './contracts';

const network = 'network-a' as NetworkId;
const endpointA = 'endpoint-a' as EndpointId;
const endpointB = 'endpoint-b' as EndpointId;
const credentialRef = 'credential_reference_0123456789' as CredentialRef;
const credentialRefOther = 'credential_reference_abcdefghij' as CredentialRef;
const requestId = 'request_reference_0123456789' as RequestContext['requestId'];
const requestIdRetry = 'request_retry_reference_0123456789' as RequestContext['requestId'];
const ownerA: OwnerSnapshot = { networkId: network, accountId: 'alice' as OwnerSnapshot['accountId'], accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'], physicalRef: 'physical-a' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'] };
const context = (owner: OwnerSnapshot, id: RequestContext['requestId'] = requestId): RequestContext => ({ schemaVersion: 1, requestId: id, owner });
const targetB: TrustedRecoveryEndpoint = { networkId: network, endpointId: endpointB, nodeName: 'session-node2.test', url: 'wss://ircx-b.example/ws' };

function ingress(owner: OwnerSnapshot, body: string, sourceKind: PrivateIngressEvent['sourceKind'] = 'server', prefix = 'ircx.example', nick = 'alice'): PrivateIngressEvent {
  return { owner, sourceKind, line: `:${prefix} NOTICE ${nick} :${body}` };
}

function fixture(options: { kind?: PrivateRecoveryCredentialLease['credentialKind']; admission?: SendAdmission; redirect?: 'started' | 'blocked'; synchronousReply?: boolean;
  targets?: Readonly<Record<string, TrustedRecoveryEndpoint>>; trusted?: readonly EndpointId[] } = {}) {
  let owner = ownerA;
  let endpoint = endpointA;
  let admission = options.admission ?? { kind: 'transport-admitted' as const };
  let resumeCount = 0;
  let released = 0;
  const forgotten: CredentialRef[] = [];
  let redirectCalls = 0;
  let consumeDuringResume: ((event: PrivateIngressEvent) => boolean) | null = null;
  const events: RecoveryEvent[] = [];
  const lease: PrivateRecoveryCredentialLease = {
    credentialKind: options.kind ?? 'mesh-exact', issuerEndpointId: endpointA, expiresAtMs: null,
    async resume(owner) { resumeCount += 1; if (options.synchronousReply) consumeDuringResume?.(ingress(owner, 'SESSION RESUME: exact session reclaimed')); return admission; },
    release() { released += 1; },
  };
  const service = createSessionRecoveryController({
    currentOwner: () => owner,
    isCurrent: candidate => candidate.ownerRef === owner.ownerRef && candidate.accountGeneration === owner.accountGeneration
      && candidate.connectionGeneration === owner.connectionGeneration && candidate.physicalRef === owner.physicalRef,
    currentEndpointId: () => endpoint,
    currentServerPrefix: () => 'ircx.example', currentNick: () => 'alice',
    pinCredential: (_request, ref) => ref === credentialRef || ref === credentialRefOther
      ? { ...lease, forget: () => { forgotten.push(ref); } } : null,
    resolveRedirectNode: (networkId, nodeName) => options.targets ? options.targets[nodeName] ?? null
      : networkId === network && nodeName === targetB.nodeName ? targetB : null,
    isTrustedEndpoint: value => value === endpointA || value === endpointB || (options.trusted ?? []).includes(value),
    async requestRedirect({ target }) { redirectCalls += 1; owner = { ...ownerA, connectionGeneration: (1 + redirectCalls) as OwnerSnapshot['connectionGeneration'], physicalRef: (redirectCalls === 1 ? 'physical-b' : `physical-b${redirectCalls}`) as OwnerSnapshot['physicalRef'], ownerRef: (redirectCalls === 1 ? 'owner-b' : `owner-b${redirectCalls}`) as OwnerSnapshot['ownerRef'], accountId: null }; endpoint = target.endpointId; return options.redirect ?? 'started'; },
    emit: event => events.push(event), now: () => 100,
  });
  consumeDuringResume = event => service.consumePrivateIngress(event);
  const authenticateDestination = () => { owner = { ...owner, accountId: 'alice' as OwnerSnapshot['accountId'], accountGeneration: 2 as OwnerSnapshot['accountGeneration'] }; };
  const setAdmission = (value: SendAdmission) => { admission = value; };
  return { service, events, authenticateDestination, setAdmission, forgotten, get owner() { return owner; }, get resumeCount() { return resumeCount; }, get released() { return released; }, get redirectCalls() { return redirectCalls; } };
}

describe('session recovery controller', () => {
  it('installs correlation before resume and waits for exact authenticated success', async () => {
    const f = fixture();
    const admission = await f.service.begin({ context: context(ownerA), credentialRef });
    expect(admission.kind).toBe('transport-admitted');
    expect(f.events.map(event => event.status)).toEqual(['pending', 'transport-admitted']);
    expect(f.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session reclaimed', 'user'))).toBe(false);
    expect(f.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session reclaimed', 'server', 'evil.example'))).toBe(false);
    expect(f.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session reclaimed'))).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ status: 'accepted', outcome: 'exact-restored', requestId, credentialRef });
    expect(f.released).toBe(1);
    f.service.dispose();
  });

  it('buffers a synchronous authenticated response until transport admission is known', async () => {
    const f = fixture({ synchronousReply: true });
    const admission = await f.service.begin({ context: context(ownerA), credentialRef });
    expect(admission.kind).toBe('transport-admitted');
    expect(f.events.map(event => event.status)).toEqual(['pending', 'transport-admitted', 'accepted']);
    expect(f.events.at(-1)?.outcome).toBe('exact-restored');
    f.service.dispose();
  });

  it('distinguishes zero-write blocks from unknown writes while allowing exact late proof', async () => {
    for (const [admission, status, reason] of [
      [{ kind: 'blocked', reason: 'backpressure' }, 'blocked', 'backpressure'],
      [{ kind: 'unknown', reason: 'transport-error' }, 'unknown', 'transport-error'],
    ] as const) {
      const f = fixture({ admission });
      const result = await f.service.begin({ context: context(ownerA), credentialRef });
      expect(result).toEqual(admission);
      expect(f.events.at(-1)).toMatchObject({ status, reason, outcome: status === 'unknown' ? 'unknown' : null });
      const proofConsumed = f.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session reclaimed'));
      if (status === 'blocked') {
        expect(proofConsumed).toBe(false);
        expect(f.events.at(-1)?.status).toBe('blocked');
      } else {
        // Unknown means the write may have reached the server; a correlated
        // success is still authoritative and must settle the same operation.
        expect(proofConsumed).toBe(true);
        expect(f.events.at(-1)).toMatchObject({ status: 'accepted', outcome: 'exact-restored' });
        expect((await f.service.begin({ context: context(ownerA, requestIdRetry), credentialRef })).kind).toBe('blocked');
        expect(f.resumeCount).toBe(1);
      }
      f.service.dispose();
    }
  });

  it('consumes only exact SESSION FAIL/WARN code replies from the current server', async () => {
    const f = fixture();
    await f.service.begin({ context: context(ownerA), credentialRef });
    expect(f.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: ':other.example FAIL SESSION INVALID_TOKEN :bad token' })).toBe(false);
    expect(f.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'FAIL SESSION INVALID_TOKEN :bad token' })).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ status: 'rejected', outcome: 'invalid', reason: 'server-rejected' });
    f.service.dispose();
  });

  it('permits an explicit same-attachment retry after a definitive retryable WARN, but not after unknown admission', async () => {
    const retryable = fixture();
    await retryable.service.begin({ context: context(ownerA), credentialRef });
    expect(retryable.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'WARN SESSION TEMPORARILY_UNAVAILABLE :retry' })).toBe(true);
    expect(retryable.events.at(-1)).toMatchObject({ status: 'blocked', outcome: 'retryable' });
    expect(retryable.forgotten).toEqual([]);
    retryable.setAdmission({ kind: 'transport-admitted' });
    expect((await retryable.service.begin({ context: context(ownerA, requestIdRetry), credentialRef })).kind).toBe('transport-admitted');
    expect(retryable.resumeCount).toBe(2);
    retryable.service.dispose();

    const unknown = fixture({ admission: { kind: 'unknown', reason: 'transport-error' } });
    await unknown.service.begin({ context: context(ownerA), credentialRef });
    expect((await unknown.service.begin({ context: context(ownerA, requestIdRetry), credentialRef })).kind).toBe('blocked');
    expect(unknown.resumeCount).toBe(1);
    unknown.service.dispose();
  });

  it('forgets only the exact missing credential and permits another credential on the same socket', async () => {
    const noAttachment = fixture();
    await noAttachment.service.begin({ context: context(ownerA), credentialRef });
    expect(noAttachment.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'FAIL SESSION NO_ATTACHMENT :not attached' })).toBe(true);
    expect(noAttachment.events.at(-1)).toMatchObject({ status: 'rejected', outcome: 'missing' });
    expect(noAttachment.forgotten).toEqual([credentialRef]);

    noAttachment.setAdmission({ kind: 'transport-admitted' });
    expect((await noAttachment.service.begin({ context: context(ownerA, requestIdRetry), credentialRef: credentialRefOther })).kind).toBe('transport-admitted');
    expect(noAttachment.resumeCount).toBe(2);
    expect(noAttachment.forgotten).toEqual([credentialRef]);
    noAttachment.service.dispose();

    const noSession = fixture();
    await noSession.service.begin({ context: context(ownerA), credentialRef });
    expect(noSession.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'FAIL SESSION NO_SESSION :not found' })).toBe(true);
    expect(noSession.events.at(-1)).toMatchObject({ status: 'rejected', outcome: 'missing' });
    expect(noSession.forgotten).toEqual([credentialRef]);
    noSession.service.dispose();
  });

  it('requires credential-kind-specific success and explicit legacy intent', async () => {
    const exactWithLogical = fixture({ kind: 'mesh-logical' });
    await exactWithLogical.service.begin({ context: context(ownerA), credentialRef });
    exactWithLogical.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session restored'));
    expect(exactWithLogical.events.at(-1)).toMatchObject({ status: 'unknown', outcome: 'exact-restored', reason: 'kind-mismatch' });
    exactWithLogical.service.dispose();

    const heldLegacy = fixture({ kind: 'local-logical' });
    await heldLegacy.service.begin({ context: context(ownerA), credentialRef });
    heldLegacy.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: legacy session attached as a new attachment'));
    expect(heldLegacy.events.at(-1)).toMatchObject({ status: 'unknown', outcome: 'legacy-new-attachment', reason: 'kind-mismatch' });
    heldLegacy.service.dispose();

    const explicitLegacy = fixture({ kind: 'local-logical' });
    await explicitLegacy.service.begin({ context: context(ownerA), credentialRef, acceptLegacyNewAttachment: true });
    explicitLegacy.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: legacy session attached as a new attachment'));
    expect(explicitLegacy.events.at(-1)).toMatchObject({ status: 'accepted', outcome: 'legacy-new-attachment' });
    explicitLegacy.service.dispose();
  });

  it('accepts only configured same-network redirects, then requires destination account proof before replay', async () => {
    const f = fixture({ kind: 'mesh-exact' });
    await f.service.begin({ context: context(ownerA), credentialRef });
    expect(f.service.consumePrivateIngress(ingress(ownerA, 'SESSION REDIRECT: exact session lives on session-node2.test; reconnect there to reclaim'))).toBe(true);
    await Promise.resolve();
    expect(f.redirectCalls).toBe(1);
    expect(f.events.at(-1)).toMatchObject({ status: 'awaiting-authentication', outcome: 'redirect', redirectNode: 'session-node2.test', hopCount: 1 });
    expect(await f.service.continueAfterAuthentication(f.owner)).toBeNull();
    f.authenticateDestination();
    expect((await f.service.continueAfterAuthentication(f.owner))?.kind).toBe('transport-admitted');
    expect(f.resumeCount).toBe(2);
    expect(f.service.consumePrivateIngress(ingress(f.owner, 'SESSION RESUME: exact session restored (cross-server)'))).toBe(true);
    expect(f.events.at(-1)?.outcome).toBe('exact-restored');
    f.service.dispose();
  });

  it('retains but never follows unknown, looping, or credential-kind-mismatched redirects', async () => {
    const untrusted = fixture();
    await untrusted.service.begin({ context: context(ownerA), credentialRef });
    untrusted.service.consumePrivateIngress(ingress(ownerA, 'SESSION REDIRECT: exact session lives on not-configured.test; reconnect there to reclaim'));
    expect(untrusted.events.at(-1)).toMatchObject({ status: 'blocked', reason: 'untrusted-redirect' });
    // Stopping an untrusted redirect releases the in-memory pin. The
    // credential owner's underlying remembered entry remains untouched.
    expect(untrusted.released).toBe(1);
    expect(untrusted.forgotten).toEqual([]);
    expect(untrusted.redirectCalls).toBe(0);
    untrusted.service.dispose();

    const mismatch = fixture({ kind: 'mesh-logical' });
    await mismatch.service.begin({ context: context(ownerA), credentialRef });
    mismatch.service.consumePrivateIngress(ingress(ownerA, 'SESSION REDIRECT: exact session lives on session-node2.test; reconnect there to reclaim'));
    expect(mismatch.events.at(-1)).toMatchObject({ status: 'blocked', reason: 'kind-mismatch' });
    mismatch.service.dispose();
  });

  it('retires the pinned lease on ordinary owner loss and times out as unknown without replay', async () => {
    vi.useFakeTimers();
    const timeout = fixture();
    await timeout.service.begin({ context: context(ownerA), credentialRef });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(timeout.events.at(-1)).toMatchObject({ status: 'unknown', outcome: 'unknown', reason: 'response-timeout' });
    expect(timeout.resumeCount).toBe(1);
    expect(timeout.released).toBe(1);
    expect(timeout.forgotten).toEqual([]);
    timeout.service.dispose();

    const retired = fixture();
    await retired.service.begin({ context: context(ownerA), credentialRef });
    retired.service.retire(ownerA);
    expect(retired.released).toBe(1);
    expect(retired.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session reclaimed'))).toBe(false);
    retired.service.dispose();
    vi.useRealTimers();
  });
  it('reports a busy exact attachment as retryable without forgetting, and stops consuming afterwards', async () => {
    const f = fixture({ kind: 'mesh-exact' });
    await f.service.begin({ context: context(ownerA), credentialRef });
    expect(f.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'FAIL SESSION ATTACHMENT_IN_USE :Exact session attachment is already active' })).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ status: 'blocked', outcome: 'attachment-in-use', reason: 'server-rejected' });
    expect(f.forgotten).toEqual([]);
    expect(f.released).toBe(1);
    expect(f.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: exact session reclaimed'))).toBe(false);
    expect(f.events.filter(event => event.status === 'accepted')).toEqual([]);
    f.service.dispose();
  });

  it('never accepts a logical or legacy body for an exact lease', async () => {
    for (const body of ['SESSION RESUME: attached to live session', 'SESSION RESUME: legacy session attached as a new attachment']) {
      const f = fixture({ kind: 'mesh-exact' });
      await f.service.begin({ context: context(ownerA), credentialRef, acceptLegacyNewAttachment: true });
      expect(f.service.consumePrivateIngress(ingress(ownerA, body))).toBe(true);
      expect(f.events.at(-1)).toMatchObject({ status: 'unknown', reason: 'kind-mismatch' });
      expect(f.events.some(event => event.status === 'accepted')).toBe(false);
      f.service.dispose();
    }
  });

  it('accepts a local logical sibling attachment and fences a second resume on the same physical owner', async () => {
    const f = fixture({ kind: 'local-logical' });
    await f.service.begin({ context: context(ownerA), credentialRef });
    expect(f.service.consumePrivateIngress(ingress(ownerA, 'SESSION RESUME: attached to live session'))).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ status: 'accepted', outcome: 'logical-attached' });
    const second = await f.service.begin({ context: context(ownerA, requestIdRetry), credentialRef: credentialRefOther });
    expect(second).toEqual({ kind: 'blocked', reason: 'policy' });
    expect(f.events.at(-1)).toMatchObject({ status: 'blocked', reason: 'busy', requestId: requestIdRetry });
    expect(f.resumeCount).toBe(1);
    f.service.dispose();
  });

  it('does not re-begin or replay after a missing session', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.service.begin({ context: context(ownerA), credentialRef });
    expect(f.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'FAIL SESSION NO_SESSION :No session matches that token' })).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ status: 'rejected', outcome: 'missing' });
    const count = f.events.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.events).toHaveLength(count);
    expect(f.resumeCount).toBe(1);
    expect(f.redirectCalls).toBe(0);
    f.service.dispose();
    vi.useRealTimers();
  });

  it('forgets a revoked credential as a definitive rejection and never replays it', async () => {
    const f = fixture();
    await f.service.begin({ context: context(ownerA), credentialRef });
    expect(f.service.consumePrivateIngress({ owner: ownerA, sourceKind: 'prefixless-protocol', line: 'FAIL SESSION SESSION_REVOKED :Logical session is revoked' })).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ status: 'rejected', outcome: 'revoked', reason: 'server-rejected' });
    expect(f.forgotten).toEqual([credentialRef]);
    expect(f.resumeCount).toBe(1);
    expect(f.released).toBe(1);
    f.service.dispose();
  });

  it('stops a redirect back to an already visited endpoint as a loop', async () => {
    const origin: TrustedRecoveryEndpoint = { networkId: network, endpointId: endpointA, nodeName: 'origin-node.test', url: 'wss://ircx-a.example/ws' };
    const f = fixture({ targets: { 'origin-node.test': origin } });
    await f.service.begin({ context: context(ownerA), credentialRef });
    f.service.consumePrivateIngress(ingress(ownerA, 'SESSION REDIRECT: exact session lives on origin-node.test; reconnect there to reclaim'));
    expect(f.events.at(-1)).toMatchObject({ status: 'blocked', outcome: 'redirect', reason: 'redirect-loop', redirectNode: 'origin-node.test' });
    expect(f.redirectCalls).toBe(0);
    expect(f.forgotten).toEqual([]);
    f.service.dispose();
  });

  it('stops after MAX_REDIRECT_HOPS trusted hops without another replay', async () => {
    const endpoints = [1, 2, 3, 4].map(index => `endpoint-n${index}` as EndpointId);
    const targets = Object.fromEntries(endpoints.map((endpointId, index) => [`n${index + 1}.test`,
      { networkId: network, endpointId, nodeName: `n${index + 1}.test`, url: `wss://n${index + 1}.example/ws` }]));
    const f = fixture({ targets, trusted: endpoints });
    await f.service.begin({ context: context(ownerA), credentialRef });
    for (let hop = 1; hop <= 3; hop += 1) {
      f.service.consumePrivateIngress(ingress(f.owner, `SESSION REDIRECT: exact session lives on n${hop}.test; reconnect there to reclaim`));
      await Promise.resolve(); await Promise.resolve();
      expect(f.events.at(-1)).toMatchObject({ status: 'awaiting-authentication', hopCount: hop });
      f.authenticateDestination();
      expect((await f.service.continueAfterAuthentication(f.owner))?.kind).toBe('transport-admitted');
    }
    expect(f.resumeCount).toBe(4);
    f.service.consumePrivateIngress(ingress(f.owner, 'SESSION REDIRECT: exact session lives on n4.test; reconnect there to reclaim'));
    expect(f.events.at(-1)).toMatchObject({ status: 'blocked', reason: 'redirect-limit', hopCount: 3 });
    expect(f.redirectCalls).toBe(3);
    expect(f.resumeCount).toBe(4);
    expect(await f.service.continueAfterAuthentication(f.owner)).toBeNull();
    f.service.dispose();
  });

  it('refuses a configured node on another network or with a non-wss URL as untrusted', async () => {
    for (const target of [
      { networkId: 'network-b' as NetworkId, endpointId: endpointB, nodeName: 'session-node2.test', url: 'wss://ircx-b.example/ws' },
      { networkId: network, endpointId: endpointB, nodeName: 'session-node2.test', url: 'ws://ircx-b.example/ws' },
      { networkId: network, endpointId: endpointB, nodeName: 'session-node2.test', url: 'https://ircx-b.example/ws' },
    ]) {
      const f = fixture({ targets: { 'session-node2.test': target } });
      await f.service.begin({ context: context(ownerA), credentialRef });
      f.service.consumePrivateIngress(ingress(ownerA, 'SESSION REDIRECT: exact session lives on session-node2.test; reconnect there to reclaim'));
      expect(f.events.at(-1)).toMatchObject({ status: 'blocked', reason: 'untrusted-redirect' });
      expect(f.redirectCalls).toBe(0);
      expect(f.forgotten).toEqual([]);
      f.service.dispose();
    }
  });

  it('blocks an expired lease before any resume write', async () => {
    const f = fixture();
    const expiredRef = 'credential_expired_0123456789' as CredentialRef;
    const liveRef = 'credential_unexpired_0123456789' as CredentialRef;
    let writes = 0;
    const service = createSessionRecoveryController({
      currentOwner: () => ownerA, isCurrent: () => true, currentEndpointId: () => endpointA,
      currentServerPrefix: () => 'ircx.example', currentNick: () => 'alice',
      pinCredential: (_request, ref) => ref === expiredRef ? { credentialKind: 'local-logical', issuerEndpointId: endpointA, expiresAtMs: 50,
        async resume() { throw new Error('expired credential must not be written'); }, forget: () => { f.forgotten.push(ref); }, release() {} }
        : ref === liveRef ? { credentialKind: 'local-logical', issuerEndpointId: endpointA, expiresAtMs: 500,
          async resume() { writes += 1; return { kind: 'transport-admitted' }; }, release() {} } : null,
      resolveRedirectNode: () => null, isTrustedEndpoint: () => true, requestRedirect: async () => 'blocked',
      emit: event => f.events.push(event), now: () => 100,
    });
    expect(await service.begin({ context: context(ownerA), credentialRef: expiredRef })).toEqual({ kind: 'blocked', reason: 'policy' });
    expect(f.events.at(-1)).toMatchObject({ status: 'blocked', reason: 'credential-expired', credentialRef: expiredRef });
    expect(f.forgotten).toEqual([]);
    expect(await service.begin({ context: context(ownerA, requestIdRetry), credentialRef: liveRef })).toEqual({ kind: 'transport-admitted' });
    expect(writes).toBe(1);
    service.dispose();
    f.service.dispose();
  });
});
