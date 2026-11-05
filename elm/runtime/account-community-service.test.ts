import { describe, expect, it } from 'vitest';
import { makeNetworkId, makeRequestId, type OwnerSnapshot, type RequestContext, type SendAdmission } from './contracts';
import { createAccountCommunityService } from './account-community-service';

const owner: OwnerSnapshot = { networkId: makeNetworkId('community-net')!, accountId: 'alice' as OwnerSnapshot['accountId'], accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'], physicalRef: null, ownerRef: 'community-owner' as OwnerSnapshot['ownerRef'] };
const context = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`community-request-${suffix}`.padEnd(32, '0'))!, owner });
const event = (line: string, sourceKind: 'server' | 'user' | 'prefixless-protocol' = 'server') => ({ line, owner, sourceKind });

function setup(admission: () => SendAdmission = () => ({ kind: 'transport-admitted' }), onSend?: (line: string, service: ReturnType<typeof createAccountCommunityService>) => void) {
  const sent: Array<{ context: RequestContext; line: string }> = [];
  const results: unknown[] = [];
  let serial = 0;
  let service!: ReturnType<typeof createAccountCommunityService>;
  service = createAccountCommunityService({
    currentOwner: () => owner,
    isCurrent: (candidate) => candidate.ownerRef === owner.ownerRef && candidate.connectionGeneration === owner.connectionGeneration,
    currentNick: () => 'Alice',
    currentServerPrefix: () => 'irc.example.test',
    sendLine: (input) => { sent.push(input); onSend?.(input.line, service); return admission(); },
    now: () => 1000,
    randomRef: () => `community-ref-${++serial}`,
    emit: (result) => results.push(result),
    timeoutMs: 60_000,
  });
  return { service, sent, results };
}

describe('account community server reconciliation', () => {
  it('commits AUTOJOIN list rows only after an exact server end marker', () => {
    const { service, sent, results } = setup();
    service.listAutojoin(context('list'));
    expect(sent.map((item) => item.line)).toEqual(['AUTOJOIN LIST']);
    expect(service.consumePrivateIngress(event(':wrong.example NOTICE Alice :AUTOJOIN #public'))).toBe(false);
    expect(service.consumePrivateIngress(event(':irc.example.test NOTICE Mallory :AUTOJOIN #public'))).toBe(false);
    expect(service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN #one'))).toBe(true);
    expect(results.at(-1)).toMatchObject({ status: 'pending', view: { autojoinRows: [] } });
    expect(service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN: end of list'))).toBe(true);
    expect(results.at(-1)).toMatchObject({ status: 'accepted', reason: null, view: { status: 'ready', autojoinRows: ['#one'] } });
    service.dispose();
  });

  it('requires the authoritative NOTICE plus a fresh list after AUTOJOIN ADD', () => {
    const { service, sent, results } = setup();
    service.addAutojoin({ context: context('add'), channel: '#room' });
    expect(sent[0]?.line).toBe('AUTOJOIN ADD #room');
    expect(service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN added'))).toBe(true);
    expect(sent[1]?.line).toBe('AUTOJOIN LIST');
    expect(results.at(-1)).toMatchObject({ status: 'pending', view: { status: 'pending', autojoinRows: [] } });
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN #room'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN: end of list'));
    expect(results.at(-1)).toMatchObject({ status: 'accepted', view: { operation: 'add', autojoinRows: ['#room'] } });
    service.dispose();
  });

  it('uses exact GROUP nick identity and server primary annotation', () => {
    const { service, sent, results } = setup();
    service.listGroup(context('group'));
    expect(sent[0]?.line).toBe('GROUP LIST');
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :GROUP Alice'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :GROUP Alice2 (primary)'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :GROUP: end of list'));
    expect(results.at(-1)).toMatchObject({ status: 'accepted', view: { groupRows: [{ nick: 'Alice', primary: false }, { nick: 'Alice2', primary: true }] } });
    service.dispose();
  });

  it('does not resend an unknown mutation and permits explicit list reconciliation', () => {
    let next: SendAdmission = { kind: 'unknown', reason: 'transport-error' };
    const { service, sent, results } = setup(() => next);
    service.addGroup({ context: context('uncertain'), nick: 'AltNick' });
    expect(results.at(-1)).toMatchObject({ status: 'unknown', reason: 'transport-error' });
    next = { kind: 'transport-admitted' };
    service.addGroup({ context: context('blocked'), nick: 'AltNick' });
    expect(results.at(-1)).toMatchObject({ status: 'blocked', reason: 'invalid-request' });
    service.listGroup(context('reconcile'));
    expect(sent.map((item) => item.line)).toEqual(['GROUP ADD AltNick', 'GROUP LIST']);
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :GROUP AltNick (primary)'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :GROUP: end of list'));
    expect(results.at(-1)).toMatchObject({ status: 'accepted', view: { operation: 'list', groupRows: [{ nick: 'AltNick', primary: true }] } });
    service.setPrimary({ context: context('after-reconcile'), nick: 'AltNick' });
    expect(sent.at(-1)?.line).toBe('GROUP PRIMARY AltNick');
    service.dispose();
  });

  it('keeps AUTOJOIN and GROUP operations independently serialized', () => {
    const { service, sent } = setup();
    service.listAutojoin(context('auto'));
    service.listGroup(context('groups'));
    expect(sent.map((item) => item.line)).toEqual(['AUTOJOIN LIST', 'GROUP LIST']);
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN: end of list'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :GROUP: end of list'));
    service.dispose();
  });

  it('rejects raw control framing without settling, then rejects a well-framed invalid row', () => {
    const { service, results } = setup();
    service.listAutojoin(context('malformed'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN #ok'));
    expect(service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN bad\nINJECT'))).toBe(false);
    expect(results.at(-1)).toMatchObject({ status: 'pending', view: { status: 'pending', autojoinRows: [] } });
    expect(service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN bad'))).toBe(true);
    expect(results.at(-1)).toMatchObject({ status: 'unknown', reason: 'invalid-response', view: { autojoinRows: [] } });
    service.dispose();
  });

  it('does not expose Account A cached rows or uncertainty to Account B', () => {
    let activeOwner = owner;
    const ownerB: OwnerSnapshot = { ...owner, accountId: 'bob' as OwnerSnapshot['accountId'], accountGeneration: 9 as OwnerSnapshot['accountGeneration'], ownerRef: 'community-owner-b' as OwnerSnapshot['ownerRef'] };
    const results: unknown[] = [];
    const service = createAccountCommunityService({
      currentOwner: () => activeOwner, isCurrent: (candidate) => candidate.ownerRef === activeOwner.ownerRef,
      currentNick: () => 'Alice', currentServerPrefix: () => 'irc.example.test',
      sendLine: () => ({ kind: 'transport-admitted' }), now: () => 1000, randomRef: () => 'unused-ref', emit: (result) => results.push(result), timeoutMs: 60_000,
    });
    service.listAutojoin(context('owner-a'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN #private-a'));
    service.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN: end of list'));
    activeOwner = ownerB;
    const contextB: RequestContext = { ...context('owner-b'), owner: ownerB };
    service.listAutojoin(contextB);
    expect(results.at(-1)).toMatchObject({ view: { autojoinRows: [] } });
    service.consumePrivateIngress({ line: ':irc.example.test NOTICE Alice :AUTOJOIN: end of list', owner: ownerB, sourceKind: 'server' });
    expect(results.at(-1)).toMatchObject({ status: 'accepted', view: { autojoinRows: [] } });
    service.dispose();
  });

  it('buffers synchronous source replies until transport admission is known', () => {
    const { service, results, sent } = setup(() => ({ kind: 'transport-admitted' }), (line, current) => {
      if (line === 'AUTOJOIN ADD #sync') current.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN added'));
      if (line === 'AUTOJOIN LIST') {
        current.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN #sync'));
        current.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN: end of list'));
      }
    });
    service.addAutojoin({ context: context('sync'), channel: '#sync' });
    expect(sent.map((item) => item.line)).toEqual(['AUTOJOIN ADD #sync', 'AUTOJOIN LIST']);
    expect(results.at(-1)).toMatchObject({ status: 'accepted', view: { status: 'ready', autojoinRows: ['#sync'] } });
    expect(results.filter((item) => (item as { status?: string }).status === 'accepted')).toHaveLength(1);
    service.dispose();
  });

  it('discards synchronous replies when initial transport admission is definitely blocked', () => {
    const { service, results } = setup(() => ({ kind: 'blocked', reason: 'backpressure' }), (line, current) => {
      if (line === 'AUTOJOIN ADD #blocked') current.consumePrivateIngress(event(':irc.example.test NOTICE Alice :AUTOJOIN added'));
    });
    service.addAutojoin({ context: context('blocked-sync'), channel: '#blocked' });
    expect(results.at(-1)).toMatchObject({ status: 'blocked', reason: 'backpressure', view: { status: 'unsupported' } });
    expect(results.some((item) => (item as { status?: string }).status === 'accepted')).toBe(false);
    service.dispose();
  });
});
