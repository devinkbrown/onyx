import { describe, expect, it } from 'vitest';
import { createIdentityOwner, type IdentityPrivateStorage } from './identity-owner';
import type { AccountId, EndpointId, OwnerSnapshot, RequestContext } from './contracts';

const initialOwner: OwnerSnapshot = {
  networkId: 'network-a' as OwnerSnapshot['networkId'], accountId: 'alice' as OwnerSnapshot['accountId'],
  accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-a' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const token = 'sst_0123456789abcdef0123456789abcdef';
const request = (owner: OwnerSnapshot, suffix: string): RequestContext => ({ schemaVersion: 1,
  requestId: `${suffix}0123456789abcdef01234567` as RequestContext['requestId'], owner });

class MemoryStorage implements IdentityPrivateStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function fixture() {
  let owner = initialOwner;
  let endpoint: EndpointId = 'endpoint-a' as EndpointId;
  let now = 1_800_000_000_000;
  let ref = 0;
  const storage = new MemoryStorage();
  const service = createIdentityOwner({
    ownerSnapshot: () => owner,
    isCurrent: (value) => value.ownerRef === owner.ownerRef && value.accountGeneration === owner.accountGeneration
      && value.connectionGeneration === owner.connectionGeneration && value.physicalRef === owner.physicalRef,
    now: () => now, storage, issuerEndpointId: () => endpoint,
    isTrustedIssuer: (_network, issuer) => issuer === 'endpoint-a',
    isAuthContextCurrent: (authRef, context) => authRef.startsWith('auth-') && context.owner.ownerRef === owner.ownerRef,
    randomRef: () => `continuation-reference-${String(++ref).padStart(12, '0')}`,
  });
  const setOwner = (value: OwnerSnapshot) => { owner = value; };
  const setEndpoint = (value: EndpointId) => { endpoint = value; };
  const setNow = (value: number) => { now = value; };
  return { service, storage, setOwner, setEndpoint, setNow };
}

function stageAndProve(service: ReturnType<typeof createIdentityOwner>, owner: OwnerSnapshot, expiresAt: number) {
  expect(service.observePrivateLine(`:onyx.example NOTICE alice :SESSIONTOKEN alice ${token} expires=${expiresAt}`, owner)).toBe(true);
  service.learnServerPrefix('onyx.example', owner);
  expect(service.proveAccount(owner)).toBe(true);
}

describe('private identity continuation custody', () => {
  it('stages SESSIONTOKEN until exact server-prefix and account proof, then prepares the SASL payload privately', async () => {
    const { service, setNow } = fixture();
    const expiry = 1_800_086_400;
    stageAndProve(service, initialOwner, expiry);
    const rows = service.listAccountContinuations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ networkId: initialOwner.networkId, accountId: 'alice', usable: true, remembered: false });
    expect(JSON.stringify(rows)).not.toContain(token);
    const prepared = await service.prepareSessionTokenSasl({ context: request(initialOwner, 'request'), continuationRef: rows[0]!.continuationRef, authContextRef: 'auth-current' });
    expect(prepared.kind).toBe('ready');
    if (prepared.kind === 'ready') {
      expect(new TextDecoder().decode(prepared.payload)).toBe(`alice\u0000${token}`);
      prepared.payload.fill(0);
      service.settleSessionTokenSasl({ authContextRef: 'auth-current', result: 'unknown' });
    }
    setNow(1_800_100_000_000);
    expect(service.listAccountContinuations()).toEqual([]);
    service.dispose();
  });

  it('rejects malformed, expired, and foreign-issuer SESSIONTOKEN lines without exposing token text', () => {
    const { service, setEndpoint } = fixture();
    expect(service.observePrivateLine(`:onyx.example NOTICE alice :SESSIONTOKEN mallory ${token} expires=1800086400`, initialOwner)).toBe(true);
    expect(service.observePrivateLine(`:onyx.example NOTICE alice :SESSIONTOKEN alice ${token} expires=1799999999`, initialOwner)).toBe(true);
    service.learnServerPrefix('onyx.example', initialOwner);
    service.proveAccount(initialOwner);
    expect(service.listAccountContinuations()).toHaveLength(0);
    stageAndProve(service, initialOwner, 1_800_086_400);
    setEndpoint('endpoint-b' as EndpointId);
    const rows = service.listAccountContinuations();
    expect(rows[0]?.usable).toBe(false);
    service.dispose();
  });

  it('retains committed custody across physical retirement', () => {
    const { service, storage, setOwner } = fixture();
    stageAndProve(service, initialOwner, 1_800_086_400);
    const newOwner: OwnerSnapshot = { ...initialOwner, accountId: null,
      accountGeneration: 3 as OwnerSnapshot['accountGeneration'], connectionGeneration: 5 as OwnerSnapshot['connectionGeneration'],
      physicalRef: 'physical-b' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-b' as OwnerSnapshot['ownerRef'] };
    service.retire(initialOwner);
    setOwner(newOwner);
    expect(service.listAccountContinuations()).toHaveLength(1);
    expect(storage.getItem('onyx:elm:account-continuations:v1')).toBeNull();
    service.dispose();
  });

  it('revokes committed tokens after the exact TOTP activation notice', () => {
    const { service, storage } = fixture();
    stageAndProve(service, initialOwner, 1_800_086_400);
    expect(service.observePrivateLine(':onyx.example NOTICE alice :TOTP: two-factor authentication is now ACTIVE — future logins require a code', initialOwner)).toBe(true);
    expect(service.listAccountContinuations()).toHaveLength(0);
    expect(storage.getItem('onyx:elm:account-continuations:v1')).toBeNull();
    service.dispose();
  });

  it('persists only after explicit consent and removes the continuation only on definitive SASL rejection', async () => {
    const { service, storage } = fixture();
    // Consent is scoped to an already authenticated, proved account. A token
    // staged before consent remains memory-only until this explicit choice.
    stageAndProve(service, initialOwner, 1_800_086_400);
    expect(await service.setContinuationRememberConsent({ networkId: initialOwner.networkId, accountId: 'alice' as AccountId, enabled: true })).toBe(true);
    expect(storage.getItem('onyx:elm:account-continuations:v1')).toContain(token);
    const continuation = service.listAccountContinuations()[0]!;
    const prepared = await service.prepareSessionTokenSasl({ context: request(initialOwner, 'request'), continuationRef: continuation.continuationRef, authContextRef: 'auth-rejected' });
    expect(prepared.kind).toBe('ready');
    if (prepared.kind === 'ready') prepared.payload.fill(0);
    service.settleSessionTokenSasl({ authContextRef: 'auth-rejected', result: 'rejected' });
    expect(service.listAccountContinuations()).toHaveLength(0);
    expect(storage.getItem('onyx:elm:account-continuations:v1')).toBeNull();
    service.dispose();
  });
  it('refuses another account\'s continuation as wrong-account and keeps its custody intact', async () => {
    const { service, storage, setOwner } = fixture();
    stageAndProve(service, initialOwner, 1_800_086_400);
    expect(await service.setContinuationRememberConsent({ networkId: initialOwner.networkId, accountId: 'alice' as AccountId, enabled: true })).toBe(true);
    const aliceRef = service.listAccountContinuations()[0]!.continuationRef;
    const bob: OwnerSnapshot = { ...initialOwner, accountId: 'bob' as OwnerSnapshot['accountId'], accountGeneration: 3 as OwnerSnapshot['accountGeneration'] };
    setOwner(bob);
    service.proveAccount(bob);
    expect(service.state(bob).continuationAvailable).toBe(false);
    const prepared = await service.prepareSessionTokenSasl({ context: request(bob, 'request'), continuationRef: aliceRef, authContextRef: 'auth-bob' });
    expect(prepared).toEqual({ kind: 'blocked', reason: 'wrong-account' });
    expect(storage.getItem('onyx:elm:account-continuations:v1')).toContain(token);
    expect(service.listAccountContinuations().map(row => row.continuationRef)).toEqual([aliceRef]);
    service.dispose();
  });

  it('blocks an expired continuation as expired and removes only that account\'s row', async () => {
    const { service, storage, setNow } = fixture();
    const bobToken = 'sst_fedcba9876543210fedcba9876543210';
    storage.setItem('onyx:elm:account-continuations:v1', JSON.stringify({ schemaVersion: 1, records: [
      { networkId: 'network-a', accountId: 'alice', issuerEndpointId: 'endpoint-a', token, expiresAtMs: 1_800_000_100_000 },
      { networkId: 'network-a', accountId: 'bob', issuerEndpointId: 'endpoint-a', token: bobToken, expiresAtMs: 1_900_000_000_000 },
    ] }));
    const rows = service.listAccountContinuations();
    expect(rows.map(row => row.accountId).sort()).toEqual(['alice', 'bob']);
    const aliceRef = rows.find(row => row.accountId === 'alice')!.continuationRef;
    service.learnServerPrefix('onyx.example', initialOwner);
    service.proveAccount(initialOwner);
    setNow(1_800_000_200_000);
    const prepared = await service.prepareSessionTokenSasl({ context: request(initialOwner, 'request'), continuationRef: aliceRef, authContextRef: 'auth-expired' });
    expect(prepared).toEqual({ kind: 'blocked', reason: 'expired' });
    const stored = storage.getItem('onyx:elm:account-continuations:v1')!;
    expect(stored).not.toContain(token);
    expect(stored).toContain(bobToken);
    expect(service.listAccountContinuations().map(row => row.accountId)).toEqual(['bob']);
    service.dispose();
  });

  it('keeps a continuation usable after an unknown SASL settlement without advancing the clock', async () => {
    const { service } = fixture();
    stageAndProve(service, initialOwner, 1_800_086_400);
    const ref = service.listAccountContinuations()[0]!.continuationRef;
    const first = await service.prepareSessionTokenSasl({ context: request(initialOwner, 'request'), continuationRef: ref, authContextRef: 'auth-one' });
    expect(first.kind).toBe('ready');
    if (first.kind === 'ready') first.payload.fill(0);
    // The same auth context cannot be replayed while its attempt is unsettled.
    expect(await service.prepareSessionTokenSasl({ context: request(initialOwner, 'request'), continuationRef: ref, authContextRef: 'auth-one' }))
      .toEqual({ kind: 'blocked', reason: 'unavailable' });
    service.settleSessionTokenSasl({ authContextRef: 'auth-one', result: 'unknown' });
    expect(service.listAccountContinuations()).toEqual([expect.objectContaining({ continuationRef: ref, usable: true })]);
    expect(service.state(initialOwner).continuationAvailable).toBe(true);
    const second = await service.prepareSessionTokenSasl({ context: request(initialOwner, 'request'), continuationRef: ref, authContextRef: 'auth-two' });
    expect(second.kind).toBe('ready');
    if (second.kind === 'ready') second.payload.fill(0);
    service.dispose();
  });

  it('does not revoke continuations on a TOTP failure or a non-activation TOTP notice', () => {
    const { service, storage } = fixture();
    stageAndProve(service, initialOwner, 1_800_086_400);
    for (const line of [
      ':onyx.example NOTICE alice :FAIL TOTP INVALID_CODE: that code is not valid',
      ':onyx.example NOTICE alice :TOTP: invalid code — two-factor authentication is still pending',
      ':onyx.example NOTICE alice :TOTP: two-factor authentication is now ACTIVE — future logins require a code (forged suffix)',
    ]) service.observePrivateLine(line, initialOwner);
    expect(service.listAccountContinuations()).toHaveLength(1);
    expect(service.state(initialOwner).continuationAvailable).toBe(true);
    expect(storage.getItem('onyx:elm:account-continuations:v1')).toBeNull();
    service.dispose();
  });
});
