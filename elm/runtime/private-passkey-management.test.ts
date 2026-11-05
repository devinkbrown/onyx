import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSnapshot, PrivateIngressEvent, RequestContext, SendAdmission } from './contracts';
import { createPrivatePasskeyManagement, type PasskeyResult, type WebAuthnOperationLease } from './private-passkey-management';

const owner = {
  networkId: 'network-a', accountId: 'account-a', accountGeneration: 2, connectionGeneration: 4,
  physicalRef: 'physical-a', ownerRef: 'owner-a',
} as unknown as OwnerSnapshot;
const context = { schemaVersion: 1, requestId: 'request-a', owner } as unknown as RequestContext;

function harness() {
  const sent: string[] = [];
  const emitted: PasskeyResult[] = [];
  let currentOwner = owner;
  let ref = 0;
  let activeLease = false;
  let admission: SendAdmission = { kind: 'transport-admitted' };
  const service = createPrivatePasskeyManagement({
    currentOwner: () => currentOwner,
    isCurrent: value => value === currentOwner,
    currentServerPrefix: () => 'irc.example',
    currentNick: () => 'alice',
    sendLine: input => { sent.push(input.line); return admission; },
    acquireWebAuthnOperation: () => {
      if (activeLease) return null;
      activeLease = true;
      const lease: WebAuthnOperationLease = { isCurrent: () => activeLease, release: () => { activeLease = false; } };
      return lease;
    },
    now: () => 1234,
    randomRef: () => `passkey-ref-${++ref}`,
    emit: result => emitted.push(result),
    timeoutMs: 1_000,
  });
  return {
    service, sent, emitted,
    setAdmission(value: SendAdmission) { admission = value; },
    setCurrentOwner(value: OwnerSnapshot) { currentOwner = value; },
    ingress(line: string, sourceKind: PrivateIngressEvent['sourceKind'] = 'server', eventOwner = owner): boolean {
      return service.consumePrivateIngress({ line, owner: eventOwner, sourceKind });
    },
  };
}
function cred(id: string, label: string, count = '7', created = '1700000000'): string {
  return `@time=2026-11-04T00:00:00Z :irc.example EVENT alice WEBAUTHN CRED ${id} ${count} ${created} :${label}`;
}
function listEnd(count: number): string { return `:irc.example EVENT alice WEBAUTHN LIST :end (${count})`; }

afterEach(() => vi.useRealTimers());

describe('private passkey management', () => {
  it('commits a complete private list atomically and never returns credential IDs', () => {
    const h = harness();
    expect(h.service.list(context).status).toBe('pending');
    expect(h.sent).toEqual(['WEBAUTHN LIST']);
    h.ingress(cred('a_0123456789', 'Security key', '4294967295', '9223372036854775807'));
    expect(h.service.view().rows).toEqual([]);
    h.ingress(listEnd(1));
    const result = h.emitted.at(-1);
    expect(result?.status).toBe('accepted');
    expect(result?.view.rows).toEqual([{ credentialRef: 'passkey-ref-1', label: 'Security key', createdUnix: '9223372036854775807', signCount: '4294967295' }]);
    expect(JSON.stringify(result)).not.toContain('a_0123456789');
  });

  it('keeps the active operation pending when a second request is blocked as busy', () => {
    const h = harness();
    expect(h.service.list(context).status).toBe('pending');
    const second = { ...context, requestId: 'request-b' } as RequestContext;
    expect(h.service.list(second).reason).toBe('busy');
    expect(h.service.view()).toMatchObject({ status: 'pending', operation: 'list', reason: null });
    h.ingress(cred('AQ', 'Key'));
    h.ingress(listEnd(1));
    expect(h.service.view()).toMatchObject({ status: 'ready', operation: 'list', reason: null });
  });

  it('preserves prior rows when a list is duplicate, malformed, over-count, or incomplete', () => {
    const h = harness();
    h.service.list(context);
    h.ingress(cred('existing', 'Old label'));
    h.ingress(listEnd(1));
    const prior = h.service.view().rows;

    h.service.list(context);
    h.ingress(cred('AQ', 'One'));
    h.ingress(cred('AQ', 'Two'));
    expect(h.service.view().rows).toEqual(prior);
    expect(h.emitted.at(-1)?.reason).toBe('invalid-list');

    vi.useFakeTimers();
    h.service.list(context);
    h.ingress(cred('AgI', 'New'));
    vi.advanceTimersByTime(1_001);
    expect(h.service.view().rows).toEqual(prior);
    expect(h.emitted.at(-1)?.status).toBe('unknown');
  });

  it('uses the opaque reference for rename/remove and accepts only exact private acknowledgements', () => {
    const h = harness();
    h.service.list(context);
    h.ingress(cred('AQI', 'Before'));
    h.ingress(listEnd(1));
    const ref = h.service.view().rows[0]?.credentialRef;
    expect(ref).toBe('passkey-ref-1');

    h.service.rename({ context, credentialRef: ref ?? '', label: 'After' });
    expect(h.sent.at(-1)).toBe('WEBAUTHN RENAME AQI :After');
    h.ingress(':irc.example EVENT alice WEBAUTHN RENAMED Ag :After');
    expect(h.service.view().rows[0]?.label).toBe('Before');
    h.ingress(':irc.example EVENT alice WEBAUTHN RENAMED AQI :After');
    expect(h.service.view().rows[0]?.label).toBe('After');

    h.service.remove({ context, credentialRef: ref ?? '', confirm: true });
    expect(h.sent.at(-1)).toBe('WEBAUTHN REMOVE AQI');
    h.ingress(':irc.example EVENT alice WEBAUTHN REMOVED :AQI');
    expect(h.service.view().rows).toEqual([]);
  });

  it('rejects hostile labels before transport and rejects overlong or malformed UTF-8 source rows', () => {
    const h = harness();
    h.service.list(context);
    h.ingress(cred('AQI', 'Original'));
    h.ingress(listEnd(1));
    const ref = h.service.view().rows[0]?.credentialRef ?? '';
    const sentBefore = h.sent.length;
    expect(h.service.rename({ context, credentialRef: ref, label: `${'é'.repeat(32)}a` }).reason).toBe('label-invalid');
    expect(h.service.rename({ context, credentialRef: ref, label: 'bad\nlabel' }).reason).toBe('label-invalid');
    expect(h.service.rename({ context, credentialRef: ref, label: '\ud800' }).reason).toBe('label-invalid');
    expect(h.sent).toHaveLength(sentBefore);

    h.service.list(context);
    h.ingress(cred('next', `${'é'.repeat(33)}`));
    expect(h.emitted.at(-1)?.reason).toBe('invalid-list');
    expect(h.service.view().rows[0]?.label).toBe('Original');
  });

  it('requires exact server provenance and recipient, and scopes prefixless FAIL to the active request', () => {
    const h = harness();
    h.service.list(context);
    expect(h.ingress(cred('leak', 'Ignored'), 'user')).toBe(true);
    expect(h.ingress(':attacker.example EVENT alice WEBAUTHN CRED leak 1 1 :Ignored')).toBe(true);
    expect(h.service.view().rows).toEqual([]);
    expect(h.ingress(':irc.example EVENT bob WEBAUTHN CRED leak 1 1 :Ignored')).toBe(true);
    expect(h.service.view().rows).toEqual([]);
    h.ingress('FAIL WEBAUTHN NOT_OWNED :credential unavailable', 'prefixless-protocol');
    expect(h.emitted.at(-1)?.reason).toBe('not-owned');
  });

  it('marks mutation timeout unknown, blocks replay, then allows list reconciliation', () => {
    vi.useFakeTimers();
    const h = harness();
    h.service.list(context);
    h.ingress(cred('AQI', 'Key'));
    h.ingress(listEnd(1));
    const ref = h.service.view().rows[0]?.credentialRef ?? '';
    expect(h.service.remove({ context, credentialRef: ref, confirm: true }).status).toBe('pending');
    vi.advanceTimersByTime(1_001);
    expect(h.emitted.at(-1)?.status).toBe('unknown');
    const sentAfterUnknown = h.sent.length;
    expect(h.service.remove({ context, credentialRef: ref, confirm: true }).reason).toBe('busy');
    expect(h.sent).toHaveLength(sentAfterUnknown);
    h.service.list(context);
    h.ingress(cred('AQI', 'Key'));
    h.ingress(listEnd(1));
    expect(h.emitted.at(-1)?.status).toBe('accepted');
    expect(h.service.remove({ context, credentialRef: h.service.view().rows[0]?.credentialRef ?? '', confirm: true }).status).toBe('pending');
  });

  it('releases its lease on blocked admission, owner retirement, and disposal', () => {
    const h = harness();
    h.setAdmission({ kind: 'blocked', reason: 'backpressure' });
    expect(h.service.list(context).reason).toBe('backpressure');
    h.setAdmission({ kind: 'transport-admitted' });
    expect(h.service.list(context).status).toBe('pending');
    h.service.retire(owner);
    expect(h.service.view().status).toBe('idle');
    h.setCurrentOwner({ ...owner, ownerRef: 'owner-b' } as OwnerSnapshot);
    expect(h.service.list(context).reason).toBe('owner-changed');
    h.service.dispose();
    expect(h.service.view().rows).toEqual([]);
  });
});
