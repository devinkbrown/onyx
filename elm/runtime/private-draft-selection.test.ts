import { describe, expect, it } from 'vitest';
import { makeNetworkId, makeRequestId, type ConversationId, type OwnerSnapshot, type RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { createPrivateDraftSelection } from './private-draft-selection';

const owner: OwnerSnapshot = { networkId: makeNetworkId('network-a')!, accountId: 'alice' as OwnerSnapshot['accountId'], accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 2 as OwnerSnapshot['connectionGeneration'], physicalRef: null, ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'] };
const context = (id: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(id.padEnd(32, '0'))!, owner });
const scope = { kind: 'account' as const, networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'selected-workspace', installationDeviceId: 'device-a', localWorkspaceEpoch: 4 };
const ticket = (): LocalNamespaceTicket => ({ scope, ownerKey: 'selected-owner', workspaceEpoch: 4, conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('request-ticket') });
const record = { rowId: '[selected-owner,#room]', ownerKey: 'selected-owner', targetKey: '#room', conversationId: '#room' as ConversationId, revision: 7, updatedAtMs: 1234, ciphertextBytes: 64 };

function setup(now = 1000) {
  let counter = 0;
  return createPrivateDraftSelection({ isCurrent: () => true, isNamespaceCurrent: () => true, now: () => now,
    randomRef: () => `opaque-draft-reference-${String(++counter).padStart(4, '0')}` });
}

describe('private draft recovery selections', () => {
  it('consumes one metadata ref within the same selected namespace across a fresh request', () => {
    const selection = setup(); const initialTicket = ticket();
    const [metadata] = selection.replace(context('a'), initialTicket, [record])!;
    expect(metadata).toMatchObject({ conversationId: '#room', revision: 7, updatedAtMs: 1234, ciphertextBytes: 64 });
    expect(metadata).not.toHaveProperty('rowId');
    const captured = selection.consume(context('b'), ticket(), metadata!.draftRef);
    expect(captured).toMatchObject({ rowId: record.rowId, ownerKey: record.ownerKey, targetKey: record.targetKey, revision: 7 });
    expect(selection.consume(context('c'), ticket(), metadata!.draftRef)).toBeNull();
    selection.dispose();
  });

  it('preserves issued namespace-ticket identity across list and recovery requests', () => {
    const issued = new WeakMap<object, RequestContext>();
    const issue = (request: RequestContext): LocalNamespaceTicket => {
      const value = ticket();
      issued.set(value, request);
      return value;
    };
    let counter = 0;
    const selection = createPrivateDraftSelection({ isCurrent: () => true,
      isNamespaceCurrent: (candidate, request) => issued.get(candidate)?.requestId === request.requestId,
      now: () => 1000, randomRef: () => `opaque-draft-reference-${String(++counter).padStart(4, '0')}` });
    const listedContext = context('list-issued');
    const listedTicket = issue(listedContext);
    const [metadata] = selection.replace(listedContext, listedTicket, [record])!;
    const recoveryContext = context('recover-issued');
    const recoveryTicket = issue(recoveryContext);
    const captured = selection.consume(recoveryContext, recoveryTicket, metadata!.draftRef);
    expect(captured).toMatchObject({ rowId: record.rowId });
    expect(captured?.ticket).toBe(recoveryTicket);
    selection.dispose();
  });

  it('invalidates refs on namespace change, owner retirement, expiry, or replacement', () => {
    const selection = setup(); const [ref] = selection.replace(context('d'), ticket(), [record])!;
    expect(selection.consume(context('e'), { ...ticket(), scope: { ...scope, workspaceRef: 'other' } }, ref!.draftRef)).toBeNull();
    const [ownerRef] = selection.replace(context('f'), ticket(), [record])!;
    selection.retireOwner(owner);
    expect(selection.consume(context('g'), ticket(), ownerRef!.draftRef)).toBeNull();
    const [scopeRef] = selection.replace(context('h'), ticket(), [record])!;
    selection.retireScope(scope);
    expect(selection.consume(context('i'), ticket(), scopeRef!.draftRef)).toBeNull();
    selection.dispose();
  });

  it('rejects oversized or malformed metadata sets without partial selection', () => {
    const selection = setup();
    expect(selection.replace(context('j'), ticket(), Array.from({ length: 101 }, () => record))).toBeNull();
    expect(selection.replace(context('k'), ticket(), [{ ...record, revision: -1 }])).toBeNull();
    selection.dispose();
  });

  it('expires selection references after their 60 second lifetime', () => {
    let now = 1_000; let counter = 0;
    const selection = createPrivateDraftSelection({ isCurrent: () => true, isNamespaceCurrent: () => true,
      now: () => now, randomRef: () => `opaque-draft-reference-${String(++counter).padStart(4, '0')}` });
    const [metadata] = selection.replace(context('expiry-list'), ticket(), [record])!;
    now = 61_000;
    expect(selection.consume(context('expiry-recover'), ticket(), metadata!.draftRef)).toBeNull();
    selection.dispose();
  });
});
