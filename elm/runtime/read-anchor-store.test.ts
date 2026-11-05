import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  makeLocalPhysicalEpoch, makeNetworkId, makeReadMarkerTimestamp, makeRequestId,
  type ConversationId, type OwnerSnapshot, type ReadMarkerTimestamp, type RequestContext,
} from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { createReadAnchorStore, type AcceptedMarkerProof, type MarkerProofRef } from './read-anchor-store';

const network = makeNetworkId('network-anchor')!;
const conversationId = '#room' as ConversationId;
const stamp = (value: string): ReadMarkerTimestamp => makeReadMarkerTimestamp(value)!;

function ownerFor(physical: string, accountId: string | null, ownerRef: string): OwnerSnapshot {
  return {
    networkId: network,
    accountId: accountId as OwnerSnapshot['accountId'],
    accountGeneration: 1 as OwnerSnapshot['accountGeneration'],
    connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
    physicalRef: makeLocalPhysicalEpoch(physical)!,
    ownerRef: ownerRef as OwnerSnapshot['ownerRef'],
  };
}

function requestFor(owner: OwnerSnapshot, id: string): RequestContext {
  return { schemaVersion: 1, requestId: makeRequestId(id)!, owner };
}

function accountTicket(owner: OwnerSnapshot): LocalNamespaceTicket {
  return {
    scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-anchor', installationDeviceId: 'device-anchor', localWorkspaceEpoch: 1 },
    ownerKey: 'anchor-owner-account', workspaceEpoch: 1,
    conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('account-ticket'),
  };
}

function guestTicket(owner: OwnerSnapshot, ownerKey: string): LocalNamespaceTicket {
  return {
    scope: { kind: 'guest', networkId: owner.networkId, accountId: null, physicalRef: owner.physicalRef!, workspaceRef: `${ownerKey}-workspace`, installationDeviceId: `${ownerKey}-device`, localWorkspaceEpoch: 1 },
    ownerKey, workspaceEpoch: 1,
    conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol(ownerKey),
  };
}

describe('read anchor store', () => {
  it('keeps the accepted marker monotonic: a lower marker after a higher one is unchanged', async () => {
    const owner = ownerFor('0123456789abcdef0123456789abcdef', 'alice', 'owner-anchor-a');
    const ticket = accountTicket(owner);
    const proofs = new Map<MarkerProofRef, AcceptedMarkerProof>();
    const store = createReadAnchorStore({
      indexedDB: new IDBFactory(),
      namespaceForRequest: () => ticket,
      isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      conversationMappingRevision: () => 'mapping-1',
      consumeMarkerProof: (ref) => { const proof = proofs.get(ref) ?? null; proofs.delete(ref); return proof; },
    });
    const proofAt = (timestamp: string): MarkerProofRef => {
      const ref: MarkerProofRef = Symbol(timestamp);
      proofs.set(ref, { timestamp: stamp(timestamp), targetKey: '#room', mappingRevision: 'mapping-1' });
      return ref;
    };
    const t1 = '2026-11-05T10:00:00.000Z';
    const t2 = '2026-11-05T11:00:00.000Z';

    expect(await store.persistAccepted({ ...requestFor(owner, '0123456789abcdef0123456789abcde1'), conversationId, proofRef: proofAt(t2) })).toBe('persisted-accepted');
    expect(await store.persistAccepted({ ...requestFor(owner, '0123456789abcdef0123456789abcde2'), conversationId, proofRef: proofAt(t1) })).toBe('unchanged');
    expect(await store.persistAccepted({ ...requestFor(owner, '0123456789abcdef0123456789abcde3'), conversationId, proofRef: proofAt(t2) })).toBe('unchanged');
    expect((await store.get({ ...requestFor(owner, '0123456789abcdef0123456789abcde4'), conversationId }))?.timestamp).toBe(t2);
    store.dispose();
  });

  it('isolates guest anchors by physical owner even when the nick is reused', async () => {
    const guestA = ownerFor('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null, 'owner-guest-a');
    const guestB = ownerFor('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', null, 'owner-guest-b');
    const tickets = new Map<string, LocalNamespaceTicket>([
      [String(guestA.physicalRef), guestTicket(guestA, 'guest-owner-a')],
      [String(guestB.physicalRef), guestTicket(guestB, 'guest-owner-b')],
    ]);
    const store = createReadAnchorStore({
      indexedDB: new IDBFactory(),
      namespaceForRequest: (request) => tickets.get(String(request.owner.physicalRef)) ?? null,
      isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      conversationMappingRevision: () => 'mapping-1',
      consumeMarkerProof: () => ({ timestamp: stamp('2026-11-05T12:00:00.000Z'), targetKey: '#room', mappingRevision: 'mapping-1' }),
    });
    const anchor = { messageId: null, timestamp: stamp('2026-11-05T12:00:00.000Z'), viewportRef: 'viewport-1', firstUnreadRef: null };

    expect(await store.persistViewedCandidate({ ...requestFor(guestA, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'), conversationId, anchor })).toBe('local-saved');
    expect(await store.getViewedCandidate({ ...requestFor(guestA, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'), conversationId })).toEqual(anchor);
    expect(await store.getViewedCandidate({ ...requestFor(guestB, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1'), conversationId })).toBeNull();
    expect(store.localViewed(requestFor(guestB, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'), conversationId)).toBeNull();
    // Guests never persist or read an accepted (server) anchor.
    expect(await store.persistAccepted({ ...requestFor(guestA, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3'), conversationId, proofRef: Symbol('guest') })).toBe('stale-owner');
    expect(await store.get({ ...requestFor(guestA, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4'), conversationId })).toBeNull();
    store.dispose();
  });
});
