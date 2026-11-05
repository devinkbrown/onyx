import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { makeLocalPhysicalEpoch, makeNetworkId, makeRequestId, type ConversationId, type OwnerSnapshot, type RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { OWNED_DRAFTS, VAULT_DATABASE, VAULT_VERSION } from './migrations';
import { createDraftStore } from './draft-store';

describe('draft revision conditional clear', () => {
  it('does not clear a newer autosave revision after an older send is accepted', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-a')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('0123456789abcdef0123456789abcdef')!, owner };
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-a', installationDeviceId: 'device-a', localWorkspaceEpoch: 1 },
      ownerKey: 'draft-owner-a', workspaceEpoch: 1,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
    };
    const store = createDraftStore({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, plaintext) => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]) }),
      openLocalDraft: async (_request, _ticket, row) => row.ciphertext.slice(0, -16),
      now: () => 1000,
    });
    const conversationId = '#room' as ConversationId;

    expect((await store.save({ ...request, conversationId, text: 'newer text', revision: 8 })).status).toBe('saved-encrypted');
    expect(await store.clearIfRevision({ ...request, conversationId, revision: 7 })).toBe('unchanged');
    expect((await store.load({ ...request, conversationId })).text).toBe('newer text');
    expect(await store.clearIfRevision({ ...request, conversationId, revision: 8 })).toBe('cleared');
    expect((await store.load({ ...request, conversationId })).text).toBeNull();
    store.dispose();
  });

  it('fences a same-revision save that is still sealing when acceptance clears the draft', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-b')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      physicalRef: makeLocalPhysicalEpoch('1123456789abcdef0123456789abcdef')!, ownerRef: 'owner-b' as OwnerSnapshot['ownerRef'],
    };
    const request: RequestContext = { schemaVersion: 1, requestId: makeRequestId('1123456789abcdef0123456789abcdef')!, owner };
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-b', installationDeviceId: 'device-b', localWorkspaceEpoch: 1 },
      ownerKey: 'draft-owner-b', workspaceEpoch: 1,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
    };
    const releaseSeal: { current: (() => void) | null } = { current: null };
    const store = createDraftStore({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, plaintext) => new Promise((resolve) => {
        releaseSeal.current = () => resolve({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]) });
      }),
      openLocalDraft: async (_request, _ticket, row) => row.ciphertext.slice(0, -16),
      now: () => 1000,
    });
    const conversationId = '#room' as ConversationId;
    const saving = store.save({ ...request, conversationId, text: 'accepted text', revision: 5 });
    expect(await store.clearIfRevision({ ...request, conversationId, revision: 5 })).toBe('unchanged');
    releaseSeal.current?.();
    expect((await saving).status).toBe('stale-owner');
    expect((await store.load({ ...request, conversationId })).text).toBeNull();
    store.dispose();
  });

  it('lists metadata and recovers only a one-use ref in the currently selected workspace', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-recovery')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 3 as OwnerSnapshot['accountGeneration'], connectionGeneration: 5 as OwnerSnapshot['connectionGeneration'],
      physicalRef: null, ownerRef: 'owner-recovery' as OwnerSnapshot['ownerRef'],
    };
    const makeContext = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`recovery-${suffix}`.padEnd(32, '0'))!, owner });
    const request = makeContext('save');
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-recovery', installationDeviceId: 'device-recovery', localWorkspaceEpoch: 7 },
      ownerKey: 'draft-owner-recovery', workspaceEpoch: 7,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
    };
    const database = new IDBFactory();
    let sealCalls = 0;
    const openedBytes: { current: Uint8Array | null } = { current: null };
    const service = createDraftStore({
      indexedDB: database, ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, plaintext) => { sealCalls += 1; return { nonce: new Uint8Array(12), ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]) }; },
      openLocalDraft: async (_request, _ticket, row) => { openedBytes.current = row.ciphertext.slice(0, -16); return openedBytes.current; }, now: () => 2000,
    });
    const conversationId = '#room' as ConversationId;
    expect((await service.save({ ...request, conversationId, text: 'recover this draft', revision: 12 })).status).toBe('saved-encrypted');
    const listed = await service.listRecoverable(makeContext('list'));
    expect(listed.status).toBe('ready');
    expect(listed.truncated).toBe(false);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ conversationId, revision: 12, ciphertextBytes: 34 });
    expect(listed.items[0]).not.toHaveProperty('rowId');
    const recovered = await service.recoverExplicit({ ...makeContext('recover'), draftRef: listed.items[0]!.draftRef });
    expect(recovered).toMatchObject({ status: 'saved-encrypted', text: 'recover this draft', conversationId, revision: 12 });
    expect(await service.recoverExplicit({ ...makeContext('replay'), draftRef: listed.items[0]!.draftRef })).toMatchObject({ status: 'selection-expired', text: null });
    expect(sealCalls).toBe(1);
    expect(openedBytes.current?.every((byte) => byte === 0)).toBe(true);
    service.dispose();
  });

  it('rejects recovery when the exact selected row revision changes after listing', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-revision')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 3 as OwnerSnapshot['accountGeneration'], connectionGeneration: 5 as OwnerSnapshot['connectionGeneration'],
      physicalRef: null, ownerRef: 'owner-revision' as OwnerSnapshot['ownerRef'],
    };
    const makeContext = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`revision-${suffix}`.padEnd(32, '0'))!, owner });
    const ticket: LocalNamespaceTicket = {
      scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-revision', installationDeviceId: 'device-revision', localWorkspaceEpoch: 8 },
      ownerKey: 'draft-owner-revision', workspaceEpoch: 8,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('ticket'),
    };
    const service = createDraftStore({
      indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, plaintext) => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]) }),
      openLocalDraft: async (_request, _ticket, row) => row.ciphertext.slice(0, -16), now: () => 3000,
    });
    const conversationId = '#room' as ConversationId;
    expect((await service.save({ ...makeContext('save-old'), conversationId, text: 'old', revision: 1 })).status).toBe('saved-encrypted');
    const listed = await service.listRecoverable(makeContext('list'));
    expect(listed.items).toHaveLength(1);
    expect((await service.save({ ...makeContext('save-new'), conversationId, text: 'new', revision: 2 })).status).toBe('saved-encrypted');
    expect(await service.recoverExplicit({ ...makeContext('recover'), draftRef: listed.items[0]!.draftRef })).toMatchObject({ status: 'revision-changed', text: null });
    service.dispose();
  });

  it('allows explicit read-only recovery while refusing all draft writes', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('network-readonly')!, accountId: 'alice' as NonNullable<OwnerSnapshot['accountId']>,
      accountGeneration: 3 as OwnerSnapshot['accountGeneration'], connectionGeneration: 5 as OwnerSnapshot['connectionGeneration'],
      physicalRef: null, ownerRef: 'owner-readonly' as OwnerSnapshot['ownerRef'],
    };
    const makeContext = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`readonly-${suffix}`.padEnd(32, '0'))!, owner });
    const selectedScope = { kind: 'account' as const, networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null, workspaceRef: 'workspace-readonly', installationDeviceId: 'device-readonly', localWorkspaceEpoch: 9 };
    let access: LocalNamespaceTicket['access'] = 'read-write';
    const currentTicket = (): LocalNamespaceTicket => ({ scope: selectedScope, ownerKey: 'draft-owner-readonly', workspaceEpoch: 9,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access, ref: Symbol('ticket') });
    const ticketForRequest = () => currentTicket();
    const indexedDB = new IDBFactory();
    const service = createDraftStore({ indexedDB, ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: ticketForRequest, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, plaintext) => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]) }),
      openLocalDraft: async (_request, _ticket, row) => row.ciphertext.slice(0, -16), now: () => 4000,
    });
    const conversationId = '#room' as ConversationId;
    expect((await service.save({ ...makeContext('save'), conversationId, text: 'history text', revision: 1 })).status).toBe('saved-encrypted');
    access = 'read-only';
    expect((await service.save({ ...makeContext('blocked-save'), conversationId, text: 'must not write', revision: 2 })).status).toBe('read-only');
    expect((await service.delete({ ...makeContext('blocked-delete'), conversationId })).status).toBe('read-only');
    expect(await service.clearIfRevision({ ...makeContext('blocked-clear'), conversationId, revision: 1 })).toBe('read-only');
    const listed = await service.listRecoverable(makeContext('list'));
    expect(listed.status).toBe('ready');
    const recovered = await service.recoverExplicit({ ...makeContext('recover'), draftRef: listed.items[0]!.draftRef });
    expect(recovered).toMatchObject({ status: 'saved-encrypted', text: 'history text', conversationId, revision: 1 });
    service.dispose();
  });

  it('wipes decrypted bytes when the selected namespace is lost during opening', async () => {
    const owner: OwnerSnapshot = { networkId: makeNetworkId('network-lock')!, accountId: 'alice' as OwnerSnapshot['accountId'],
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      physicalRef: null, ownerRef: 'owner-lock' as OwnerSnapshot['ownerRef'] };
    const context = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`lock-${suffix}`.padEnd(32, '0'))!, owner });
    const ticket: LocalNamespaceTicket = { scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null,
      workspaceRef: 'workspace-lock', installationDeviceId: 'device-lock', localWorkspaceEpoch: 1 }, ownerKey: 'draft-owner-lock', workspaceEpoch: 1,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('lock-ticket') };
    let current = true; const opened: { bytes: Uint8Array | null } = { bytes: null };
    const service = createDraftStore({ indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => current,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => current,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, bytes) => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...bytes, ...new Uint8Array(16)]) }),
      openLocalDraft: async () => { opened.bytes = new TextEncoder().encode('secret'); current = false; return opened.bytes; }, now: () => 5000 });
    const conversationId = '#room' as ConversationId;
    expect((await service.save({ ...context('save'), conversationId, text: 'secret', revision: 1 })).status).toBe('saved-encrypted');
    current = true;
    const listed = await service.listRecoverable(context('list'));
    const recovered = await service.recoverExplicit({ ...context('recover'), draftRef: listed.items[0]!.draftRef });
    expect(recovered).toMatchObject({ status: 'stale-owner', text: null });
    expect(opened.bytes?.every((byte) => byte === 0)).toBe(true);
    service.dispose();
  });

  it('rejects a selected row rewritten while its ciphertext is being decrypted', async () => {
    const owner: OwnerSnapshot = { networkId: makeNetworkId('network-row-race')!, accountId: 'alice' as OwnerSnapshot['accountId'],
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      physicalRef: null, ownerRef: 'owner-row-race' as OwnerSnapshot['ownerRef'] };
    const context = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`row-race-${suffix}`.padEnd(32, '0'))!, owner });
    const ticket: LocalNamespaceTicket = { scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null,
      workspaceRef: 'workspace-row-race', installationDeviceId: 'device-row-race', localWorkspaceEpoch: 1 }, ownerKey: 'draft-owner-row-race', workspaceEpoch: 1,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('row-race-ticket') };
    const indexedDB = new IDBFactory(); let changed = false;
    const updateRevision = async (): Promise<void> => new Promise((resolve, reject) => {
      const opening = indexedDB.open(VAULT_DATABASE, VAULT_VERSION);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result; const tx = database.transaction(OWNED_DRAFTS, 'readwrite');
        const store = tx.objectStore(OWNED_DRAFTS); const get = store.get(JSON.stringify([ticket.ownerKey, '#room']));
        get.onsuccess = () => { const row = get.result as { revision: number } | undefined; if (row) store.put({ ...row, revision: row.revision + 1 }); };
        tx.oncomplete = () => { database.close(); resolve(); };
        tx.onabort = tx.onerror = () => { database.close(); reject(tx.error); };
      };
    });
    const service = createDraftStore({ indexedDB, ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, bytes) => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...bytes, ...new Uint8Array(16)]) }),
      openLocalDraft: async (_request, _ticket, row) => { if (!changed) { changed = true; await updateRevision(); } return row.ciphertext.slice(0, -16); }, now: () => 6000 });
    const conversationId = '#room' as ConversationId;
    expect((await service.save({ ...context('save'), conversationId, text: 'old', revision: 1 })).status).toBe('saved-encrypted');
    const listed = await service.listRecoverable(context('list'));
    const recovered = await service.recoverExplicit({ ...context('recover'), draftRef: listed.items[0]!.draftRef });
    expect(recovered).toMatchObject({ status: 'revision-changed', text: null });
    service.dispose();
  });

  it('reports a complete first hundred and an explicit truncation marker', async () => {
    const owner: OwnerSnapshot = { networkId: makeNetworkId('network-many-drafts')!, accountId: 'alice' as OwnerSnapshot['accountId'],
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      physicalRef: null, ownerRef: 'owner-many-drafts' as OwnerSnapshot['ownerRef'] };
    const context = (suffix: string): RequestContext => ({ schemaVersion: 1, requestId: makeRequestId(`many-drafts-${suffix}`.padEnd(32, '0'))!, owner });
    const ticket: LocalNamespaceTicket = { scope: { kind: 'account', networkId: owner.networkId, accountId: owner.accountId!, physicalRef: null,
      workspaceRef: 'workspace-many-drafts', installationDeviceId: 'device-many-drafts', localWorkspaceEpoch: 1 }, ownerKey: 'draft-owner-many-drafts', workspaceEpoch: 1,
      conversationScheme: { name: 'ascii', revision: 'irc-casemapping-v1:ascii' }, access: 'read-write', ref: Symbol('many-ticket') };
    let serial = 0;
    const service = createDraftStore({ indexedDB: new IDBFactory(), ownerSnapshot: () => owner, isCurrent: () => true,
      namespaceForRequest: () => ticket, isNamespaceCurrent: () => true,
      canonicalConversationKey: (_owner, target) => target.toLowerCase(),
      sealLocalDraft: async (_request, _ticket, _conversation, _revision, bytes) => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([...bytes, ...new Uint8Array(16)]) }),
      openLocalDraft: async (_request, _ticket, row) => row.ciphertext.slice(0, -16), now: () => 7000 });
    while (serial < 101) {
      serial += 1;
      const conversationId = `#room-${serial}` as ConversationId;
      const saved = await service.save({ ...context(`save-${serial}`), conversationId, text: `draft ${serial}`, revision: 1 });
      expect(saved.status).toBe('saved-encrypted');
    }
    const listed = await service.listRecoverable(context('list'));
    expect(listed).toMatchObject({ status: 'ready', truncated: true });
    expect(listed.items).toHaveLength(100);
    service.dispose();
  });
});
