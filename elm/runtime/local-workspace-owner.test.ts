import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalWorkspaceOwner } from './local-workspace-owner';
import type { OwnerSnapshot, RequestContext } from './contracts';

const guest: OwnerSnapshot = {
  networkId: 'network' as OwnerSnapshot['networkId'], accountId: null,
  accountGeneration: 1 as OwnerSnapshot['accountGeneration'], connectionGeneration: 3 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-a' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const context: RequestContext = { schemaVersion: 1, requestId: '0123456789abcdef0123456789abcdef' as RequestContext['requestId'], owner: guest };

describe('local workspace authority', () => {
  it('keeps guest namespace memory-only and tied to the physical connection epoch', async () => {
    const service = createLocalWorkspaceOwner({ indexedDB: null, configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: () => false, isCurrentGuestOwner: (owner) => owner.ownerRef === guest.ownerRef && owner.accountId === null,
      isRequestCurrent: (request) => request.owner.ownerRef === guest.ownerRef,
      onAuthorityLost: () => undefined });
    const metadata = await service.rememberProvenOwner(guest, true);
    expect(metadata?.remembered).toBe(false);
    expect(service.current()?.kind).toBe('guest');
    expect(await service.list()).toEqual([]);
    const ticket = service.namespaceForRequest(context);
    expect(ticket?.ownerKey).toBe(JSON.stringify([guest.networkId, 'guest', guest.physicalRef]));
    expect(service.isNamespaceCurrent(ticket!, context)).toBe(true);
    service.lock();
    expect(service.isNamespaceCurrent(ticket!, context)).toBe(false);
    service.dispose();
  });

  it('does not let an offline guest request adopt another physical guest epoch', async () => {
    const service = createLocalWorkspaceOwner({ indexedDB: null, configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: (owner) => owner.ownerRef === guest.ownerRef, isRequestCurrent: (request) => request.owner.ownerRef === guest.ownerRef,
      onAuthorityLost: () => undefined });
    await service.rememberProvenOwner(guest, false);
    const changed: RequestContext = { ...context, owner: { ...guest, physicalRef: 'physical-b' as OwnerSnapshot['physicalRef'] } };
    expect(service.namespaceForRequest(changed)).toBeNull();
    service.dispose();
  });

  it('does not issue account A storage namespace to account B without an explicit selection', async () => {
    const accountA = { ...guest, accountId: 'alice' as never };
    const accountB = { ...guest, accountId: 'bob' as never, ownerRef: 'owner-b' as OwnerSnapshot['ownerRef'] };
    const service = createLocalWorkspaceOwner({ indexedDB: null, configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: () => true, isRequestCurrent: () => true, onAuthorityLost: () => undefined });
    await service.rememberProvenOwner(accountA, false);
    const requestB: RequestContext = { ...context, owner: accountB };
    expect(service.namespaceForRequest(requestB)).toBeNull();
    service.dispose();
  });

  it('captures only authenticated CASEMAPPING and invalidates tickets when it changes', async () => {
    const service = createLocalWorkspaceOwner({ indexedDB: null, configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: (owner) => owner.ownerRef === guest.ownerRef, isRequestCurrent: (request) => request.owner.ownerRef === guest.ownerRef,
      onAuthorityLost: () => undefined });
    await service.rememberProvenOwner(guest, false);
    expect(await service.recordAuthenticatedConversationScheme(guest, { name: 'rfc1459', revision: 'irc-casemapping-v1:rfc1459' })).toBe(true);
    const before = service.namespaceForRequest(context)!;
    expect(before.conversationScheme).toEqual({ name: 'rfc1459', revision: 'irc-casemapping-v1:rfc1459' });
    expect(await service.recordAuthenticatedConversationScheme(guest, { name: 'ascii', revision: 'irc-casemapping-v1:ascii' })).toBe(true);
    expect(service.isNamespaceCurrent(before, context)).toBe(false);
    expect(service.conversationSchemeForRequest(context)).toEqual({ name: 'ascii', revision: 'irc-casemapping-v1:ascii' });
    service.dispose();
  });

  it('persists an explicitly approved history-only workspace for offline reselection', async () => {
    const indexedDB = new IDBFactory(); const checkpointRef = Symbol('approved-private-checkpoint');
    const service = createLocalWorkspaceOwner({ indexedDB, configuredNetworks: () => ['wss://configured.example/irc' as OwnerSnapshot['networkId']],
      isProvenLiveOwner: () => false, isRequestCurrent: (request) => request.owner.ownerRef === guest.ownerRef,
      validateHistoryCheckpoint: (input) => input.checkpointRef === checkpointRef && input.networkId === 'wss://configured.example/irc' && input.accountId === 'alice',
      onAuthorityLost: () => undefined });
    const request: RequestContext = { ...context, owner: { ...guest, networkId: 'wss://configured.example/irc' as OwnerSnapshot['networkId'] } };
    const grant = await service.ensureImportedHistoryWorkspace({ context: request, networkId: request.owner.networkId,
      accountId: 'alice' as never, checkpointRef, explicit: true });
    expect(grant?.scope.kind).toBe('account');
    const row = (await service.list()).find((item) => item.workspaceRef === grant?.scope.workspaceRef);
    expect(row?.historyOnly).toBe(true);
    expect(row?.remembered).toBe(false);
    service.lock();
    const selected = await service.select({ workspaceRef: row!.workspaceRef, explicitUserAction: true });
    expect(selected?.kind).toBe('account');
    expect(selected?.accountId).toBe('alice');
    service.dispose();
  });

  it('does not create history custody from a forged checkpoint symbol', async () => {
    const networkB = 'network-b' as OwnerSnapshot['networkId'];
    const service = createLocalWorkspaceOwner({ indexedDB: new IDBFactory(), configuredNetworks: () => [guest.networkId, networkB],
      isProvenLiveOwner: () => false, isRequestCurrent: () => true,
      validateHistoryCheckpoint: () => false, onAuthorityLost: () => undefined });
    const created = await service.ensureImportedHistoryWorkspace({ context, networkId: guest.networkId,
      accountId: 'alice' as never, checkpointRef: Symbol('forged'), explicit: true });
    expect(created).toBeNull();
    expect(await service.list()).toEqual([]);
    service.dispose();
  });

  it('permits only explicitly imported history namespace access for a connected guest', async () => {
    const indexedDB = new IDBFactory(); const checkpointRef = Symbol('guest-approved-checkpoint');
    const service = createLocalWorkspaceOwner({ indexedDB, configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: () => false, isCurrentGuestOwner: (candidate) => candidate.ownerRef === guest.ownerRef,
      isRequestCurrent: () => true, isOfflineRequest: () => false,
      validateHistoryCheckpoint: (input) => input.checkpointRef === checkpointRef && input.accountId === 'alice',
      onAuthorityLost: () => undefined });
    await service.ensureCurrentWorkspace(guest);
    const accountGrant = await service.ensureImportedHistoryWorkspace({ context, networkId: guest.networkId,
      accountId: 'alice' as never, checkpointRef, explicit: true });
    expect(accountGrant?.scope).toMatchObject({ kind: 'account', accountId: 'alice', historyOnly: true });
    const ticket = service.namespaceForRequest(context);
    expect(ticket?.scope.kind === 'account' && ticket.scope.historyOnly).toBe(true);
    expect(ticket?.access).toBe('read-only');
    expect(service.isNamespaceCurrent(ticket!, context)).toBe(true);
    const accountB: RequestContext = { ...context, owner: { ...guest, accountId: 'bob' as never } };
    expect(service.namespaceForRequest(accountB)).toBeNull();
    service.dispose();
  });

  it('initializes account custody without changing remember consent or rotating its stable identity', async () => {
    const accountOwner = { ...guest, accountId: 'alice' as never };
    const service = createLocalWorkspaceOwner({ indexedDB: new IDBFactory(), configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: (owner) => owner.accountId === 'alice', isRequestCurrent: () => true,
      onAuthorityLost: () => undefined });
    const initial = await service.ensureCurrentWorkspace(accountOwner);
    expect(initial?.kind).toBe('account');
    expect((await service.list()).filter((row) => row.accountId === 'alice')).toEqual([]);
    const remembered = await service.rememberProvenOwner(accountOwner, true);
    expect(remembered?.workspaceRef).toBe(initial?.workspaceRef);
    const installation = service.current()?.installationDeviceId;
    service.lock();
    const restored = await service.ensureCurrentWorkspace(accountOwner);
    expect(restored?.workspaceRef).toBe(initial?.workspaceRef);
    expect(restored?.installationDeviceId).toBe(installation);
    expect((await service.list()).find((row) => row.workspaceRef === initial?.workspaceRef)?.remembered).toBe(true);
    service.dispose();
  });

  it('reuses a default false-consent account scope across reconnects and stale initialization cannot select A after B', async () => {
    let currentAccount = 'alice';
    const account = (name: string): OwnerSnapshot => ({ ...guest, accountId: name as never,
      ownerRef: `${name}-owner` as OwnerSnapshot['ownerRef'] });
    const service = createLocalWorkspaceOwner({ indexedDB: new IDBFactory(), configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: (owner) => owner.accountId === currentAccount, isRequestCurrent: () => true,
      onAuthorityLost: () => undefined });
    const a = account('alice');
    const firstA = service.ensureCurrentWorkspace(a);
    currentAccount = 'bob';
    const b = account('bob');
    const currentB = await service.ensureCurrentWorkspace(b);
    expect(await firstA).toBeNull();
    expect(currentB?.accountId).toBe('bob');
    expect(service.current()?.accountId).toBe('bob');
    currentAccount = 'alice';
    service.lock();
    const reconnectedA = await service.ensureCurrentWorkspace(a);
    expect(reconnectedA?.accountId).toBe('alice');
    expect(reconnectedA?.workspaceRef).not.toBe(currentB?.workspaceRef);
    expect((await service.list()).filter((row) => row.remembered)).toEqual([]);
    service.dispose();
  });

  it('does not expose a selected account namespace to an active guest connection', async () => {
    const accountOwner = { ...guest, accountId: 'alice' as never };
    let offline = false;
    const service = createLocalWorkspaceOwner({ indexedDB: null, configuredNetworks: () => [guest.networkId],
      isProvenLiveOwner: (owner) => owner.accountId === 'alice', isCurrentGuestOwner: (owner) => owner.accountId === null,
      isOfflineRequest: () => offline, isRequestCurrent: () => true, onAuthorityLost: () => undefined });
    await service.ensureCurrentWorkspace(accountOwner);
    expect(service.namespaceForRequest(context)).toBeNull();
    offline = true;
    expect(service.namespaceForRequest(context)?.scope.accountId).toBe('alice');
    service.dispose();
  });

  it('binds offline selection to a one-use retired-owner transition', async () => {
    let current: OwnerSnapshot = { ...guest, accountId: 'alice' as never };
    const networkB = 'network-b' as OwnerSnapshot['networkId'];
    const service = createLocalWorkspaceOwner({ indexedDB: new IDBFactory(), configuredNetworks: () => [guest.networkId, networkB],
      isProvenLiveOwner: (candidate) => candidate.accountId !== null,
      isRequestCurrent: (request) => request.owner.ownerRef === current.ownerRef,
      isOfflineRequest: (request) => request.owner.accountId === null && request.owner.physicalRef === null,
      onAuthorityLost: () => undefined });
    const account = (name: string): OwnerSnapshot => ({ ...guest, networkId: name === 'bob' ? networkB : guest.networkId, accountId: name as never,
      ownerRef: (name === 'alice' ? 'alice-owner' : 'bob-owner') as OwnerSnapshot['ownerRef'] });
    const metadataB = await service.rememberProvenOwner(account('bob'), true);
    await service.rememberProvenOwner(account('alice'), true);
    current = { ...guest, accountId: null, physicalRef: null,
      accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
      ownerRef: 'retired-owner' as OwnerSnapshot['ownerRef'] };
    const retiredContext: RequestContext = { schemaVersion: 1, requestId: 'retiredRequest000000000001' as never, owner: current };
    const prepared = await service.prepareSelection({ workspaceRef: metadataB!.workspaceRef, explicitUserAction: true, context: retiredContext });
    expect(prepared).not.toBeNull();
    expect(service.commitSelection({ prepared: prepared!, context: retiredContext })).toBeNull();
    const successor = { ...current, networkId: networkB, accountGeneration: 3 as OwnerSnapshot['accountGeneration'],
      connectionGeneration: 5 as OwnerSnapshot['connectionGeneration'], ownerRef: 'offline-successor' as OwnerSnapshot['ownerRef'] };
    current = successor;
    const successorContext: RequestContext = { schemaVersion: 1, requestId: 'offlineRequest000000000002' as never, owner: successor };
    const scope = service.commitSelection({ prepared: prepared!, context: successorContext });
    expect(scope).toMatchObject({ kind: 'account', accountId: 'bob' });
    expect(service.grant()?.scope.accountId).toBe('bob');
    expect(service.commitSelection({ prepared: prepared!, context: successorContext })).toBeNull();
    service.dispose();
  });
});
