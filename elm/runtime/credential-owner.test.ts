import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeAccountGeneration,
  makeConnectionGeneration,
  makeLocalPhysicalEpoch,
  makeOwnerRef,
  makeOwnerSnapshot,
  makeNetworkId,
  makeEndpointId,
  makeAccountId,
} from './contracts';
import { createCredentialOwner } from './credential-owner';
import type { CredentialStorageAdapter, CredentialState, ResumeTransport } from './credential-owner';
import type { OwnerSnapshot, SendAdmission } from './contracts';

function branded<T>(value: T | null): T {
  if (value === null) throw new Error('invalid test brand');
  return value;
}

const owner = branded<OwnerSnapshot>(makeOwnerSnapshot({
  networkId: makeNetworkId('network-one'),
  accountId: makeAccountId('alice'),
  accountGeneration: makeAccountGeneration(1),
  connectionGeneration: makeConnectionGeneration(1),
  physicalRef: makeLocalPhysicalEpoch('44444444444444444444444444444444'),
  ownerRef: makeOwnerRef('AAAAAAAAAAAAAAAAAAAAAA'),
}));
const issuer = branded(makeEndpointId('wss://irc.example/'));

function harness() {
  let current = owner;
  let seq = 0;
  const values = new Map<string, string>();
  const storage: CredentialStorageAdapter = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  const states: CredentialState[] = [];
  const service = createCredentialOwner({
    storage,
    ownerSnapshot: () => current,
    isCurrent: (snapshot) => snapshot.ownerRef === current.ownerRef,
    issuerEndpoint: () => issuer,
    randomRef: () => `ref_${String(++seq).padStart(20, '0')}`,
    now: () => 1000,
    emit: (state) => states.push(state),
  });
  const sent: string[] = [];
  const transport: ResumeTransport = {
    sendLine: ({ line }): SendAdmission => { sent.push(line); return { kind: 'transport-admitted' }; },
  };
  return { service, storage, values, states, sent, transport, current: () => current, setCurrent: (value: OwnerSnapshot) => { current = value; } };
}

function finishIssuance(h: ReturnType<typeof harness>, local: string, mesh?: string) {
  h.service.learnServerPrefix('irc.example', h.current());
  expect(h.service.setRememberConsent(h.current(), true)).toBe(true);
  expect(h.service.issueBundle(h.current(), h.transport)).toEqual({ kind: 'transport-admitted' });
  if (local) h.service.consumePrivateLine(`:irc.example NOTICE me :SESSION TOKEN ${local}`, 'irc.example', h.current());
  if (mesh) h.service.consumePrivateLine(`:irc.example NOTICE me :SESSION MTOKEN ${mesh}`, 'irc.example', h.current());
  const barrierLine = h.sent.find((line) => line.startsWith('PING :'));
  const barrier = barrierLine?.slice('PING :'.length).trim();
  expect(barrier).toBeTruthy();
  h.service.consumePrivateLine(`:irc.example PONG :${barrier}`, 'irc.example', h.current());
}

afterEach(() => vi.useRealTimers());

describe('private credential owner (replacement for the retired OnyxPorts bearer store)', () => {
  it('expires a pending issuance as unknown after its bounded barrier timeout', () => {
    vi.useFakeTimers();
    const h = harness();
    h.service.learnServerPrefix('irc.example', h.current());
    h.service.issueBundle(h.current(), h.transport);
    expect(h.service.state().issuance).toBe('pending');
    vi.advanceTimersByTime(10_000);
    expect(h.service.state().issuance).toBe('unknown');
    expect(h.service.state().credentials).toEqual([]);
    h.service.dispose();
  });

  it('stores recognized local and mesh slots together and restores only metadata', () => {
    const h = harness();
    const local = '11111111111111111111111111111111';
    const mesh = '53524d01' + '22'.repeat(64);
    finishIssuance(h, local, mesh);
    const issued = h.service.state();
    expect(issued.credentials.map(({ credentialKind }) => credentialKind).sort()).toEqual(['local-logical', 'mesh-logical']);
    expect(JSON.stringify(issued)).not.toContain(local);
    expect(JSON.stringify(issued)).not.toContain(mesh);
    const restoredHarness = harness();
    for (const [key, value] of h.values) restoredHarness.values.set(key, value);
    restoredHarness.service.learnServerPrefix('irc.example', restoredHarness.current());
    expect(restoredHarness.service.state().credentials.map(({ credentialKind }) => credentialKind).sort()).toEqual(['local-logical', 'mesh-logical']);
    expect(JSON.stringify(restoredHarness.service.state())).not.toContain(local);
    h.service.dispose();
    restoredHarness.service.dispose();
  });

  it('forgets one credential ref without clearing its sibling', () => {
    const h = harness();
    finishIssuance(h, '11111111111111111111111111111111', '53524d01' + '33'.repeat(64));
    const before = h.service.state().credentials;
    expect(before).toHaveLength(2);
    expect(h.service.forget(h.current(), before[0]!.credentialRef)).toBe(true);
    expect(h.service.state().credentials).toHaveLength(1);
    expect(h.service.state().credentials[0]!.credentialRef).toBe(before[1]!.credentialRef);
    h.service.dispose();
  });

  it('keeps malformed or wrong-family tokens non-restorable and does not guess their kind', () => {
    const h = harness();
    h.service.learnServerPrefix('irc.example', h.current());
    h.service.issueBundle(h.current(), h.transport);
    h.service.consumePrivateLine(':irc.example NOTICE me :SESSION MTOKEN 11111111111111111111111111111111', 'irc.example', h.current());
    h.service.consumePrivateLine(':irc.example NOTICE me :SESSION TOKEN has space', 'irc.example', h.current());
    const barrier = h.sent.find((line) => line.startsWith('PING :'))?.slice('PING :'.length).trim();
    h.service.consumePrivateLine(`:irc.example PONG :${barrier}`, 'irc.example', h.current());
    expect(h.service.state().credentials).toEqual([]);
    expect(h.service.state().issuance).toBe('unknown');
    h.service.dispose();
  });

  it('scopes an issued bundle to its account: invisible and unusable under another account, restored on switch back', () => {
    const h = harness();
    const local = '11111111111111111111111111111111';
    finishIssuance(h, local);
    const aliceRefs = h.service.state().credentials.map(item => item.credentialRef);
    expect(aliceRefs).toHaveLength(1);
    const bob = { ...owner, accountId: branded(makeAccountId('bob')), accountGeneration: branded(makeAccountGeneration(2)) };
    h.setCurrent(bob);
    expect(h.service.state().credentials).toEqual([]);
    expect(h.service.state().remembered).toBe(false);
    const before = h.sent.length;
    expect(h.service.resume(bob, aliceRefs[0]!, h.transport)).toEqual({ kind: 'blocked', reason: 'policy' });
    expect(h.service.pinForRecovery(bob, aliceRefs[0]!, h.transport)).toBeNull();
    expect(h.service.forget(bob, aliceRefs[0]!)).toBe(false);
    expect(h.sent.slice(before)).toEqual([]);
    const aliceAgain = { ...owner, accountGeneration: branded(makeAccountGeneration(3)) };
    h.setCurrent(aliceAgain);
    expect(h.service.state().credentials.map(item => item.credentialRef)).toEqual(aliceRefs);
    expect(h.service.state().remembered).toBe(true);
    expect(h.values.get('onyx:session-credentials-v2')).toContain(local);
    h.service.dispose();
  });

  it('rotates a bundle only at the PONG barrier and replaces the remembered secret in the same scope', () => {
    const h = harness();
    const first = '11111111111111111111111111111111';
    const second = '22222222222222222222222222222222';
    finishIssuance(h, first);
    const oldRefs = h.service.state().credentials.map(item => item.credentialRef);
    expect(h.service.issueBundle(h.current(), h.transport)).toEqual({ kind: 'transport-admitted' });
    h.service.consumePrivateLine(`:irc.example NOTICE me :SESSION TOKEN ${second}`, 'irc.example', h.current());
    expect(h.service.state().issuance).toBe('pending');
    expect(h.service.state().credentials.map(item => item.credentialRef)).toEqual(oldRefs);
    expect(h.values.get('onyx:session-credentials-v2')).toContain(first);
    const barrier = h.sent.filter(line => line.startsWith('PING :')).at(-1)!.slice('PING :'.length);
    h.service.consumePrivateLine(`:irc.example PONG :${barrier}`, 'irc.example', h.current());
    const rotated = h.service.state();
    expect(rotated.issuance).toBe('idle');
    expect(rotated.credentials).toHaveLength(1);
    expect(rotated.credentials[0]!.credentialRef).not.toBe(oldRefs[0]);
    expect(rotated.credentials[0]!.remembered).toBe(true);
    const stored = h.values.get('onyx:session-credentials-v2')!;
    expect(stored).toContain(second);
    expect(stored).not.toContain(first);
    expect(Object.keys(JSON.parse(stored) as Record<string, unknown>)).toHaveLength(1);
    h.service.dispose();
  });

  it('keeps the previous bundle and reports unknown when the server refuses a reissue with a standard reply', () => {
    for (const refusal of [
      'WARN SESSION RESUME_CREDENTIAL_PRESERVED :retryable resume did not consume the stored credential; repeat SESSION TOKEN to replace it',
      'FAIL SESSION TEMPORARILY_UNAVAILABLE :try later',
      ':irc.example FAIL SESSION TEMPORARILY_UNAVAILABLE :try later',
    ]) {
      const h = harness();
      const first = '11111111111111111111111111111111';
      finishIssuance(h, first);
      const oldRefs = h.service.state().credentials.map(item => item.credentialRef);
      expect(h.service.issueBundle(h.current(), h.transport)).toEqual({ kind: 'transport-admitted' });
      expect(h.service.state().issuance).toBe('pending');
      expect(h.service.consumePrivateLine(refusal, 'irc.example', h.current())).toBe(true);
      expect(h.service.state().issuance).toBe('unknown');
      expect(h.service.state().credentials.map(item => item.credentialRef)).toEqual(oldRefs);
      expect(h.values.get('onyx:session-credentials-v2')).toContain(first);
      // A late token after the refusal cannot complete the abandoned issuance.
      h.service.consumePrivateLine(':irc.example NOTICE me :SESSION TOKEN 22222222222222222222222222222222', 'irc.example', h.current());
      const barrier = h.sent.filter(line => line.startsWith('PING :')).at(-1)!.slice('PING :'.length);
      h.service.consumePrivateLine(`:irc.example PONG :${barrier}`, 'irc.example', h.current());
      expect(h.service.state().credentials.map(item => item.credentialRef)).toEqual(oldRefs);
      expect(h.values.get('onyx:session-credentials-v2')).not.toContain('2222222222');
      h.service.dispose();
    }
  });

  it('does not accept a peer-prefixed or wrong-server refusal as an issuance failure', () => {
    const h = harness();
    h.service.learnServerPrefix('irc.example', h.current());
    h.service.issueBundle(h.current(), h.transport);
    h.service.consumePrivateLine(':mallory!u@h FAIL SESSION TEMPORARILY_UNAVAILABLE :forged', 'irc.example', h.current());
    h.service.consumePrivateLine(':evil.example FAIL SESSION TEMPORARILY_UNAVAILABLE :forged', 'irc.example', h.current());
    expect(h.service.state().issuance).toBe('pending');
    h.service.dispose();
  });

  it('stores nothing without remember consent and marks every issued credential non-remembered', () => {
    const h = harness();
    const local = '11111111111111111111111111111111';
    const mesh = '53524d01' + '44'.repeat(64);
    h.service.learnServerPrefix('irc.example', h.current());
    expect(h.service.issueBundle(h.current(), h.transport)).toEqual({ kind: 'transport-admitted' });
    h.service.consumePrivateLine(`:irc.example NOTICE me :SESSION TOKEN ${local}`, 'irc.example', h.current());
    h.service.consumePrivateLine(`:irc.example NOTICE me :SESSION MTOKEN ${mesh}`, 'irc.example', h.current());
    const barrier = h.sent.find(line => line.startsWith('PING :'))!.slice('PING :'.length);
    h.service.consumePrivateLine(`:irc.example PONG :${barrier}`, 'irc.example', h.current());
    const issued = h.service.state();
    expect(issued.issuance).toBe('idle');
    expect(issued.remembered).toBe(false);
    expect(issued.credentials).toHaveLength(2);
    expect(issued.credentials.every(item => item.remembered === false)).toBe(true);
    expect(h.values.size).toBe(0);
    expect(JSON.stringify(h.states)).not.toContain(local);
    expect(JSON.stringify(h.states)).not.toContain(mesh);

    // Withdrawing consent after a remembered issuance deletes the stored scope.
    expect(h.service.setRememberConsent(h.current(), true)).toBe(true);
    expect(h.values.get('onyx:session-credentials-v2')).toContain(local);
    expect(h.service.setRememberConsent(h.current(), false)).toBe(true);
    expect(h.values.get('onyx:session-credentials-v2')).toBe('{}');
    expect(h.service.state().credentials.every(item => item.remembered === false)).toBe(true);
    h.service.dispose();
  });

  it('does not interpret an unrelated server command as a credential', () => {
    const h = harness();
    h.service.learnServerPrefix('irc.example', h.current());
    expect(h.service.consumePrivateLine(':irc.example FROBNICATE SESSION TOKEN 11111111111111111111111111111111', 'irc.example', h.current())).toBe(false);
    expect(h.service.state().credentials).toEqual([]);
    h.service.dispose();
  });
});
