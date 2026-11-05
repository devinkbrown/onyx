import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { makeConversationId, makeLocalPhysicalEpoch } from './contracts';
import type { OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { createDraftStore } from './draft-store';
import { createOutboxJournal } from './outbox-journal';

const accountOwner: OwnerSnapshot = {
  networkId: 'network' as OwnerSnapshot['networkId'],
  accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
  accountGeneration: 4 as OwnerSnapshot['accountGeneration'],
  connectionGeneration: 7 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-a' as OwnerSnapshot['physicalRef'],
  ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const accountRequest: RequestContext = {
  schemaVersion: 1,
  requestId: '0123456789abcdef0123456789abcdef' as RequestContext['requestId'],
  owner: accountOwner,
};
const accountTicket: LocalNamespaceTicket = {
  scope: {
    kind: 'account', networkId: accountOwner.networkId, accountId: accountOwner.accountId!,
    physicalRef: null, workspaceRef: 'workspace-a', installationDeviceId: 'device-a', localWorkspaceEpoch: 1,
  },
  ownerKey: 'local-account-a', workspaceEpoch: 1,
  conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
};

describe('durable stores honor frozen local namespace tickets', () => {
  it('does not keep a draft result after the namespace changes during sealing', async () => {
    let namespaceCurrent = true;
    const namespaceForRequest = vi.fn(() => accountTicket);
    const sealLocalDraft = vi.fn(async () => {
      namespaceCurrent = false;
      return { nonce: new Uint8Array(12), ciphertext: new Uint8Array(32) };
    });
    const store = createDraftStore({
      indexedDB: new IDBFactory(),
      ownerSnapshot: () => accountOwner,
      isCurrent: () => true,
      namespaceForRequest,
      isNamespaceCurrent: () => namespaceCurrent,
      canonicalConversationKey: () => 'target-a',
      sealLocalDraft,
      openLocalDraft: async () => null,
    });
    const result = await store.save({ ...accountRequest, conversationId: makeConversationId('#room')!, text: 'draft', revision: 1 });

    expect(result.status).toBe('stale-owner');
    expect(namespaceForRequest).toHaveBeenCalledTimes(1);
    expect(sealLocalDraft).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('does not create a durable outbox row after its async payload preparation loses the ticket', async () => {
    let namespaceCurrent = true;
    const sendLineGroup = vi.fn(() => []);
    const prepareQueuedPayload = vi.fn(async () => {
      namespaceCurrent = false;
      return {
        kind: 'ready' as const,
        payload: { kind: 'sealed-local-plaintext' as const, ciphertext: new Uint8Array(32), payloadCommitment: 'a'.repeat(64) },
        policyRevision: 'policy-a',
      };
    });
    const journal = createOutboxJournal({
      indexedDB: new IDBFactory(),
      ownerSnapshot: () => accountOwner,
      isCurrent: () => true,
      namespaceForRequest: () => accountTicket,
      isNamespaceCurrent: () => namespaceCurrent,
      transport: { sendLineGroup },
      policySnapshot: () => ({ ownerProven: false, policyGeneration: 1, channelMembership: 'unknown', encryption: 'unknown', canSend: 'unknown', networkReady: false, offlineMemoAllowed: true }),
      canonicalConversationKey: () => 'target-a',
      prepareQueuedPayload,
      prepareDispatch: async () => ({ kind: 'held', reason: 'offline' }),
      validatePreparedDispatch: () => false,
      withDispatchGroup: async (_request, _ticket, run) => run(),
      memoCorrelationClear: () => false,
      verifyAcceptanceProof: () => false,
    });

    const result = await journal.queueMessage({
      ...accountRequest, clientIntentId: accountRequest.requestId,
      operation: 'privmsg', conversationId: makeConversationId('#room')!, body: 'hello',
    });

    expect(result.status).toBe('stale-owner');
    expect(prepareQueuedPayload).toHaveBeenCalledTimes(1);
    expect(sendLineGroup).not.toHaveBeenCalled();
    journal.dispose();
  });

  it('keeps guest outbox intents in memory without opening durable storage', async () => {
    const guestOwner = { ...accountOwner, accountId: null } as OwnerSnapshot;
    const guestRequest = { ...accountRequest, owner: guestOwner };
    const guestTicket: LocalNamespaceTicket = {
      ...accountTicket,
      scope: { ...accountTicket.scope, kind: 'guest', accountId: null, physicalRef: makeLocalPhysicalEpoch('abcdef0123456789abcdef0123456789')! },
      ownerKey: 'local-guest-a', conversationScheme: null,
    };
    const prepareQueuedPayload = vi.fn();
    const journal = createOutboxJournal({
      indexedDB: new IDBFactory(),
      ownerSnapshot: () => guestOwner,
      isCurrent: () => true,
      namespaceForRequest: () => guestTicket,
      isNamespaceCurrent: () => true,
      transport: { sendLineGroup: vi.fn(() => []) },
      policySnapshot: () => ({ ownerProven: false, policyGeneration: 1, channelMembership: 'unknown', encryption: 'unknown', canSend: 'unknown', networkReady: false, offlineMemoAllowed: true }),
      canonicalConversationKey: () => null,
      prepareQueuedPayload,
      prepareDispatch: async () => ({ kind: 'held', reason: 'offline' }),
      validatePreparedDispatch: () => false,
      withDispatchGroup: async (_request, _ticket, run) => run(),
      memoCorrelationClear: () => false,
      verifyAcceptanceProof: () => false,
    });

    const result = await journal.queueMessage({
      ...guestRequest, clientIntentId: guestRequest.requestId,
      operation: 'privmsg', conversationId: makeConversationId('#room')!, body: 'hello',
    });

    expect(result.status).toBe('memory-only');
    expect(prepareQueuedPayload).not.toHaveBeenCalled();
    journal.dispose();
  });
});
