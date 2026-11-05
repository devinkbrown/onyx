import { IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { makeLocalPhysicalEpoch, makeNetworkId, makeRequestId, type ConversationId, type OwnerSnapshot, type RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { createOwnedStorage, type OwnedMessageInput } from './owned-storage';

describe('owned storage retention policy', () => {
  it('filters and purges expired target rows, and refuses reads while current policy is unknown', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-a')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('0123456789abcdef0123456789abcdef')!, owner };
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-a', installationDeviceId: 'device-a', localWorkspaceEpoch: 1 },
      ownerKey: 'retention-owner-a', workspaceEpoch: 1,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
    };
    let known = true;
    let ephemeralSeconds: number | null = null;
    let policyRevision = 'policy-a';
    const storage = createOwnedStorage({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, conversation) => conversation.toLowerCase(),
      projectForPersistence: async ({ candidate }) => {
        const { wireBodyRef: _ref, ...row } = candidate;
        return { kind: 'persistable', row, policyRevision: 'policy-a' };
      },
      currentPolicyRevision: () => policyRevision,
      retentionPolicy: () => known ? { keep: 400, ephemeralSeconds, complete: true } : { keep: 400, ephemeralSeconds: null, complete: false },
      now: () => 100_000, randomId: (() => { let id = 0; return () => `row-${++id}`; })(),
    });
    const conversationId = '#room' as ConversationId;
    const row = (messageId: string, atMs: number): OwnedMessageInput => ({
      messageId: messageId as OwnedMessageInput['messageId'], conversationId, from: 'Alice', body: messageId, atMs,
      serverTime: null, rowType: 'msg', deleted: false, redacted: false, replyTo: null, privacy: 'plain', wireBodyRef: null,
    });
    expect((await storage.put({ ...request, rows: [row('old-message', 1000), row('new-message', 90_000)] })).status).toBe('ready');
    ephemeralSeconds = 60;
    policyRevision = 'policy-b';
    const visible = await storage.get({ ...request, conversationId, limit: 10 });
    expect(visible.status).toBe('ready');
    expect(visible.rows.map((entry) => entry.messageId)).toEqual(['new-message']);
    known = false;
    const hidden = await storage.get({ ...request, conversationId, limit: 10 });
    expect(hidden.status).toBe('unavailable');
    expect(hidden.rows).toEqual([]);
    known = true;
    ephemeralSeconds = null;
    policyRevision = 'policy-c';
    const afterPurge = await storage.get({ ...request, conversationId, limit: 10 });
    expect(afterPurge.rows.map((entry) => entry.messageId)).toEqual(['new-message']);
    storage.dispose();
  });

  it('resolves and prunes once per target while enforcing both count and expiry limits', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-batch-prune')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 4 as OwnerSnapshot['accountGeneration'], connectionGeneration: 8 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('00112233445566778899aabbccddeeff')!, ownerRef: 'owner-batch-prune' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('00112233445566778899aabbccddeeff')!, owner };
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-batch-prune', installationDeviceId: 'device-batch-prune', localWorkspaceEpoch: 10 },
      ownerKey: 'retention-owner-batch-prune', workspaceEpoch: 10,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('batch-prune-ticket'),
    };
    const indexedDB = new IDBFactory();
    const storage = createOwnedStorage({
      indexedDB, ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, conversation) => conversation.toLowerCase(),
      projectForPersistence: async ({ candidate }) => {
        const { wireBodyRef: _ref, ...row } = candidate;
        return { kind: 'persistable', row, policyRevision: 'policy-batch-prune' };
      },
      currentPolicyRevision: () => 'policy-batch-prune',
      retentionObservation: () => ({ keep: 400, ephemeralSeconds: 60, complete: true, revision: 'policy-batch-prune' }),
      now: () => 100_000,
    });
    await storage.open();
    const row = (conversationId: ConversationId, messageId: string, atMs = 100_000): OwnedMessageInput => ({
      messageId: messageId as OwnedMessageInput['messageId'], conversationId, from: 'Alice', body: messageId, atMs,
      serverTime: null, rowType: 'msg', deleted: false, redacted: false, replyTo: null, privacy: 'plain', wireBodyRef: null,
    });
    const pruneCursor = vi.spyOn(IDBIndex.prototype, 'openCursor');
    const metaGet = vi.spyOn(IDBObjectStore.prototype, 'get');
    try {
      const room = '#room' as ConversationId;
      const hundredRows = Array.from({ length: 100 }, (_, index) => row(room, `batch-${index}`));
      const batchResult = await storage.put({ ...request, rows: hundredRows });
      expect(batchResult.status).toBe('ready');
      expect(pruneCursor).toHaveBeenCalledTimes(1);
      expect(metaGet.mock.contexts.filter((context) => (context as IDBObjectStore).name === 'vault_meta')).toHaveLength(3);
      pruneCursor.mockClear();
      metaGet.mockClear();

      const first = Array.from({ length: 200 }, (_, index) => row(room, `cap-${index}`, 90_000 + index));
      const second = Array.from({ length: 200 }, (_, index) => row(room, `cap-${index + 200}`, 90_000 + index + 200));
      expect((await storage.put({ ...request, requestId: makeRequestId('10112233445566778899aabbccddeeff')!, rows: first })).status).toBe('ready');
      expect((await storage.put({ ...request, requestId: makeRequestId('20112233445566778899aabbccddeeff')!, rows: second })).status).toBe('ready');
      expect((await storage.put({ ...request, requestId: makeRequestId('30112233445566778899aabbccddeeff')!, rows: [row(room, 'cap-400', 90_400)] })).status).toBe('ready');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open('onyx-vault', 5);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      const roomCount = await new Promise<number>((resolve, reject) => {
        const countRequest = db.transaction('messages_owned', 'readonly').objectStore('messages_owned')
          .index('by-owner-target').count(IDBKeyRange.only(['retention-owner-batch-prune', '#room']));
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => reject(countRequest.error);
      });
      db.close();
      expect(roomCount).toBe(400);
      const capped = await storage.get({ ...request, requestId: makeRequestId('40112233445566778899aabbccddeeff')!, conversationId: room, limit: 400 });
      expect(capped.status).toBe('ready');
      expect(capped.rows).toHaveLength(400);
      expect(capped.rows.map((entry) => entry.messageId)).toContain('cap-400');

      const other = '#other' as ConversationId;
      pruneCursor.mockClear();
      const mixed = await storage.put({ ...request, requestId: makeRequestId('50112233445566778899aabbccddeeff')!, rows: [
        row(room, 'late-expired', 1_000), row(other, 'other-fresh'),
      ] });
      expect(mixed.status).toBe('ready');
      expect(pruneCursor).toHaveBeenCalledTimes(2);
      const roomRows = await storage.get({ ...request, requestId: makeRequestId('60112233445566778899aabbccddeeff')!, conversationId: room, limit: 400 });
      expect(roomRows.status).toBe('ready');
      expect(roomRows.rows.some((entry) => entry.messageId === 'late-expired')).toBe(false);
      const otherRows = await storage.get({ ...request, requestId: makeRequestId('70112233445566778899aabbccddeeff')!, conversationId: other, limit: 10 });
      expect(otherRows.rows.map((entry) => entry.messageId)).toEqual(['other-fresh']);
    } finally {
      pruneCursor.mockRestore();
      metaGet.mockRestore();
      storage.dispose();
    }
  });

  it('merges overlapping same-policy observations without losing puts or rolling back the expiry floor', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-concurrent')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 3 as OwnerSnapshot['accountGeneration'], connectionGeneration: 7 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('fedcba9876543210fedcba9876543210')!, ownerRef: 'owner-concurrent' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('fedcba9876543210fedcba9876543210')!, owner };
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-concurrent', installationDeviceId: 'device-concurrent', localWorkspaceEpoch: 9 },
      ownerKey: 'retention-owner-concurrent', workspaceEpoch: 9,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('concurrent-ticket'),
    };
    let nowMs = 100_000;
    const storage = createOwnedStorage({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, conversation) => conversation.toLowerCase(),
      projectForPersistence: async ({ candidate }) => {
        const { wireBodyRef: _ref, ...row } = candidate;
        return { kind: 'persistable', row, policyRevision: 'policy-concurrent' };
      },
      currentPolicyRevision: () => 'policy-concurrent',
      retentionObservation: () => ({ keep: 400, ephemeralSeconds: 60, complete: true, revision: 'policy-concurrent' }),
      now: () => nowMs++,
    });
    await storage.open();
    const conversationId = '#room' as ConversationId;
    const rows = Array.from({ length: 121 }, (_, index): OwnedMessageInput => ({
      messageId: `concurrent-${index}` as OwnedMessageInput['messageId'], conversationId, from: 'Alice', body: `body-${index}`, atMs: 100_000,
      serverTime: null, rowType: 'msg', deleted: false, redacted: false, replyTo: null, privacy: 'plain', wireBodyRef: null,
    }));
    const writes = await Promise.all(rows.map((row, index) => storage.put({
      ...request,
      requestId: makeRequestId(index.toString(16).padStart(32, '0'))!,
      rows: [row],
    })));
    expect(writes.map((result) => result.status)).toEqual(Array.from({ length: 121 }, () => 'ready'));
    expect(writes.map((result) => result.affected)).toEqual(Array.from({ length: 121 }, () => 1));

    const beforeExpiry = await storage.get({ ...request, requestId: makeRequestId('0123456789abcdef0123456789abcdef')!, conversationId, limit: 200 });
    expect(beforeExpiry.status).toBe('ready');
    expect(beforeExpiry.rows.map((row) => row.messageId).sort()).toEqual(rows.map((row) => row.messageId).sort());

    nowMs = 200_000;
    const expired = await storage.get({ ...request, requestId: makeRequestId('1123456789abcdef0123456789abcdef')!, conversationId, limit: 200 });
    expect(expired.status).toBe('ready');
    expect(expired.rows).toEqual([]);

    nowMs = 120_000;
    const afterClockRollback = await storage.get({ ...request, requestId: makeRequestId('2123456789abcdef0123456789abcdef')!, conversationId, limit: 200 });
    expect(afterClockRollback.status).toBe('ready');
    expect(afterClockRollback.rows).toEqual([]);
    storage.dispose();
  });

  it('reads the selected workspace policy offline and keeps expiry monotonic across clock rollback', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-offline')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('abcdef0123456789abcdef0123456789')!, ownerRef: 'owner-offline' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('abcdef0123456789abcdef0123456789')!, owner };
    const liveTicket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-offline', installationDeviceId: 'device-offline', localWorkspaceEpoch: 4 },
      ownerKey: 'retention-owner-offline', workspaceEpoch: 4,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('live-ticket'),
    };
    let selectedTicket = liveTicket;
    let complete = true;
    let policyRevision = 'r'.repeat(2048);
    let ephemeralSeconds: number | null = 60;
    let offline = false;
    let time = 100_000;
    const storage = createOwnedStorage({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => selectedTicket,
      isNamespaceCurrent: (candidate) => candidate === selectedTicket,
      isOfflineReadContext: (_request, candidate) => offline && candidate === selectedTicket && candidate.scope.kind === 'account',
      canonicalConversationKey: (_owner, conversation) => conversation.toLowerCase(),
      projectForPersistence: async ({ candidate }) => {
        const { wireBodyRef: _ref, ...row } = candidate;
        return { kind: 'persistable', row, policyRevision: 'persist-policy' };
      },
      currentPolicyRevision: () => 'persist-policy',
      retentionObservation: () => ({ keep: 400, ephemeralSeconds, complete, revision: policyRevision }),
      now: () => time,
    });
    await storage.open();
    const conversationId = '#saved' as ConversationId;
    const row: OwnedMessageInput = {
      messageId: 'saved-message' as OwnedMessageInput['messageId'], conversationId, from: 'Alice', body: 'cached text', atMs: 95_000,
      serverTime: null, rowType: 'msg', deleted: false, redacted: false, replyTo: null, privacy: 'plain', wireBodyRef: null,
    };
    expect((await storage.put({ ...request, rows: [row] })).status).toBe('ready');
    expect((await storage.refreshRetention(request, conversationId)).status).toBe('refreshed');
    const noTtlConversation = '#saved-none' as ConversationId;
    ephemeralSeconds = null;
    policyRevision = 'explicit-no-ttl';
    expect((await storage.put({ ...request, rows: [{ ...row, conversationId: noTtlConversation, messageId: 'saved-none' as OwnedMessageInput['messageId'], atMs: 1_000 }] })).status).toBe('ready');
    expect((await storage.refreshRetention(request, noTtlConversation)).status).toBe('refreshed');
    ephemeralSeconds = 60;
    policyRevision = 'r'.repeat(2048);

    selectedTicket = { ...liveTicket, access: 'read-only', ref: Symbol('history-ticket') };
    complete = false;
    offline = true;
    const offlineRequest = { ...request, requestId: makeRequestId('0123456789abcdef0123456789abcdef')! };
    const cached = await storage.get({ ...offlineRequest, conversationId, limit: 10 });
    expect(cached.status).toBe('ready');
    expect(cached.retentionScope).toEqual({ kind: 'cached', policyRevision, lastSyncMs: 100_000 });
    expect(cached.rows.map((entry) => entry.messageId)).toEqual(['saved-message']);
    const cachedNone = await storage.get({ ...offlineRequest, conversationId: noTtlConversation, limit: 10 });
    expect(cachedNone.retentionScope).toEqual({ kind: 'cached', policyRevision: 'explicit-no-ttl', lastSyncMs: 100_000 });
    expect(cachedNone.rows.map((entry) => entry.messageId)).toEqual(['saved-none']);
    const cachedSearch = await storage.search({ ...offlineRequest, query: 'cached text', limit: 10 });
    expect(cachedSearch.status).toBe('ready');
    expect(cachedSearch.retentionScopes.map((entry) => [entry.conversationId, entry.scope.kind])).toEqual([
      [conversationId, 'cached'], [noTtlConversation, 'cached'],
    ]);
    const cachedExport = await storage.exportSelected({ ...offlineRequest, conversationIds: [conversationId, noTtlConversation] });
    expect(cachedExport.status).toBe('ready');
    expect(cachedExport.retentionScopes.every((entry) => entry.scope.kind === 'cached')).toBe(true);

    time = 200_000;
    const expired = await storage.get({ ...offlineRequest, conversationId, limit: 10 });
    expect(expired.status).toBe('ready');
    expect(expired.rows).toEqual([]);
    expect(expired.retentionScope?.kind).toBe('cached');

    time = 90_000;
    const rolledBack = await storage.get({ ...offlineRequest, conversationId, limit: 10 });
    expect(rolledBack.status).toBe('ready');
    expect(rolledBack.rows).toEqual([]);
    expect(rolledBack.retentionScope?.kind).toBe('cached');
    storage.dispose();
  });

  it('keeps uncached offline retention unknown and rejects revisions beyond 2048 bytes', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-unknown')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 1 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('1234567890abcdef1234567890abcdef')!, ownerRef: 'owner-unknown' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('fedcba0987654321fedcba0987654321')!, owner };
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-unknown', installationDeviceId: 'device-unknown', localWorkspaceEpoch: 5 },
      ownerKey: 'retention-owner-unknown', workspaceEpoch: 5,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('unknown-ticket'),
    };
    let selectedTicket = ticket;
    let revision = 'p'.repeat(2049);
    let complete = true;
    const storage = createOwnedStorage({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => selectedTicket, isNamespaceCurrent: (candidate) => candidate === selectedTicket, isOfflineReadContext: (_request, candidate) => candidate === selectedTicket,
      canonicalConversationKey: (_owner, conversation) => conversation.toLowerCase(),
      projectForPersistence: async () => ({ kind: 'blocked', reason: 'stale-owner' }),
      currentPolicyRevision: () => null,
      retentionObservation: () => ({ keep: 400, ephemeralSeconds: null, complete, revision }),
      now: () => 100_000,
    });
    await storage.open();
    const conversationId = '#unknown' as ConversationId;
    expect((await storage.refreshRetention(request, conversationId)).status).toBe('unavailable');
    // No snapshot was committed, so even an explicitly offline selected scope remains unknown.
    selectedTicket = { ...ticket, access: 'read-only', ref: Symbol('history-ticket') };
    complete = false;
    const offlineRequest = { ...request, requestId: makeRequestId('00112233445566778899aabbccddeeff')! };
    revision = 'q'.repeat(2048);
    const unknown = await storage.get({ ...offlineRequest, conversationId, limit: 10 });
    expect(unknown.rows).toEqual([]);
    expect(unknown.retentionScope).toEqual({ kind: 'unknown' });
    const unknownExport = await storage.exportSelected({ ...offlineRequest, conversationIds: [conversationId] });
    expect(unknownExport.status).toBe('unavailable');
    expect(unknownExport.complete).toBe(false);
    expect(unknownExport.retentionScopes).toEqual([{ conversationId, scope: { kind: 'unknown' } }]);
    storage.dispose();
  });
});
