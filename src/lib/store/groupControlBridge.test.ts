// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type {
  GroupControlIntegration,
  GroupControlIntegrationOptions,
  GroupControlIntegrationState,
} from '@/lib/e2ee/groupControlIntegration';
import type { GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';
import type {
  GroupDevicePublisher,
  GroupDevicePublisherOptions,
} from '@/lib/e2ee/groupDevicePublisher';
import { createGroupControlBridge } from './groupControlBridge';

function runtime(account: string | null = null): GroupControlRuntimeState {
  return {
    generation: 1,
    lifecycle: account ? 'ready' : 'identity-pending',
    activation: 'hold',
    identity: { clientId: 'client-1', endpoint: 'wss://chat.example/irc?realm=one', account, deviceId: null },
    rooms: [],
    counters: { accepted: 0, processed: 0, queued: 0, applied: 0, locked: 0, rejected: 0, ignored: 0, coalesced: 0, evicted: 0, expired: 0 },
    queueDepth: 0,
    sessionCount: 0,
  };
}

function harness(options: { current?: boolean; account?: string | null } = {}) {
  const handlers = new Set<(message: ReturnType<typeof parseIRCMessage>) => void>();
  const client = { extraMessageHandlers: handlers, sendRaw: vi.fn(() => true) };
  const published: Array<GroupControlRuntimeState | null> = [];
  const setIdentity = vi.fn(async () => true);
  const onConnected = vi.fn(async () => true);
  const onDisconnected = vi.fn();
  const accept = vi.fn(async (_message: unknown) => ({ status: 'ignored' as const, generation: 1 }));
  const observeDirectory = vi.fn(() => true);
  const onRoomPart = vi.fn();
  const onRoomKick = vi.fn();
  const destroy = vi.fn(async () => undefined);
  const unsubscribe = vi.fn();
  let listener: ((state: GroupControlIntegrationState) => void) | null = null;
  let current = options.current ?? true;
  let account = options.account ?? null;
  let capturedOptions: GroupControlIntegrationOptions | null = null;
  const state: GroupControlIntegrationState = {
    generation: 1,
    directoryGeneration: 0,
    clientId: 'client-1',
    endpoint: 'wss://chat.example/irc?realm=one',
    connected: false,
    attached: false,
    trustedSignerConfigured: true,
    runtime: runtime(account),
  };
  const integrationFactory = (integrationOptions: GroupControlIntegrationOptions): GroupControlIntegration => {
    capturedOptions = integrationOptions;
    return {
      client,
      clientId: state.clientId,
      endpoint: state.endpoint,
      runtime: null,
      state,
      initialization: Promise.resolve(false),
      directoryGeneration: 0,
      isDestroyed: false,
      getState: () => state,
      subscribe(next) { listener = next; next(state); return unsubscribe; },
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      refreshIdentity: vi.fn(async () => true),
      setIdentity,
      onConnected,
      onDisconnected,
      reconnect: vi.fn(),
      markRecovered: vi.fn(() => false),
      requestCurrentEpochWelcome: vi.fn(async () => ({ ok: false as const, reason: 'runtime-inactive' })),
      accept,
      acceptControl: accept,
      ingest: accept,
      requestDirectory: vi.fn(async () => ({ ok: false as const, reason: 'aborted' as const })),
      observeAuthenticatedDirectoryBody: observeDirectory,
      observeServerReply: vi.fn(() => false),
      onRoomPart,
      onRoomKick,
      onVaultReset: vi.fn(async () => undefined),
      destroy,
    };
  };
  const signerStoreFactory = vi.fn(() => ({
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  }));
  const publisherSetAccount = vi.fn(async () => true);
  const publisherOnConnected = vi.fn(async () => true);
  const publisherOnRegistered = vi.fn(async () => true);
  const publisherOnDisconnected = vi.fn();
  const publisherOnVaultReset = vi.fn(async () => true);
  const publisherObserveBody = vi.fn(() => false);
  const publisherObserveFailure = vi.fn(() => false);
  const publisherDestroy = vi.fn();
  let publisherOptions: GroupDevicePublisherOptions | null = null;
  const publisherFactory = (value: GroupDevicePublisherOptions): GroupDevicePublisher => {
    publisherOptions = value;
    const publisherState = {
      status: 'inactive' as const,
      generation: 0,
      connectionGeneration: 0,
      endpoint: value.endpoint,
      clientId: value.clientId,
      account: value.account ?? null,
      deviceId: null,
      attempts: 0 as const,
      failure: null,
    };
    return {
      state: publisherState,
      getState: () => publisherState,
      setAuthenticatedAccount: publisherSetAccount,
      onConnected: publisherOnConnected,
      onRegistered: publisherOnRegistered,
      onDisconnected: publisherOnDisconnected,
      onVaultReset: publisherOnVaultReset,
      observeTrustedServerBody: publisherObserveBody,
      observeTrustedFailure: publisherObserveFailure,
      destroy: publisherDestroy,
    };
  };
  let vaultResetListener: (() => void) | null = null;
  const vaultUnsubscribe = vi.fn();
  const vaultResetSubscribe = vi.fn((listener: () => void) => {
    vaultResetListener = listener;
    return vaultUnsubscribe;
  });
  const bridge = createGroupControlBridge({
    client,
    endpoint: state.endpoint,
    authenticatedAccount: () => account,
    isConnected: () => true,
    isCurrent: () => current,
    publish: (value) => published.push(value),
    integrationFactory,
    signerStoreFactory,
    publisherFactory,
    vaultResetSubscribe,
  });
  return {
    bridge,
    handlers,
    published,
    setIdentity,
    onConnected,
    onDisconnected,
    accept,
    observeDirectory,
    onRoomPart,
    onRoomKick,
    destroy,
    unsubscribe,
    signerStoreFactory,
    publisherSetAccount,
    publisherOnConnected,
    publisherOnRegistered,
    publisherOnDisconnected,
    publisherOnVaultReset,
    publisherObserveBody,
    publisherObserveFailure,
    publisherDestroy,
    vaultUnsubscribe,
    get publisherOptions() { return publisherOptions!; },
    resetVault: () => vaultResetListener?.(),
    get integrationOptions() { return capturedOptions!; },
    emit: (next: GroupControlRuntimeState | null) => listener?.({ ...state, runtime: next }),
    setCurrent: (value: boolean) => { current = value; },
    setAccount: (value: string | null) => { account = value; },
    feed: (line: string) => {
      const message = parseIRCMessage(line);
      for (const handler of [...handlers]) handler(message);
    },
  };
}

describe('group-control store bridge', () => {
  it('publishes only the safe runtime projection and owns one handler per connected client', () => {
    const h = harness();
    expect(h.integrationOptions.autoAttach).toBe(false);
    expect(h.handlers).toHaveLength(0);
    h.bridge.start();
    expect(h.published).toEqual([runtime(null)]);
    expect(JSON.stringify(h.published)).not.toMatch(/payload|signerPub|privateKey|directoryKey/u);

    h.bridge.onConnected();
    h.bridge.onConnected();
    expect(h.handlers).toHaveLength(1);
    expect(h.onConnected).toHaveBeenCalledTimes(2);
    h.bridge.onDisconnected();
    expect(h.handlers).toHaveLength(0);
    expect(h.onDisconnected).toHaveBeenCalledOnce();
  });

  it('dispatches directory bodies only from the exact prefix learned from 001', () => {
    const h = harness();
    h.bridge.start();
    h.bridge.onConnected();
    expect(h.bridge.onRegistered(parseIRCMessage(':node-a.example 001 alice :Welcome'))).toBe(true);

    h.feed(':mallory!m@evil NOTICE alice :E2EEKEY END account=alice devices=0');
    h.feed(':node-b.example NOTICE alice :E2EEKEY END account=alice devices=0');
    expect(h.observeDirectory).not.toHaveBeenCalled();

    h.feed(':node-a.example NOTICE alice :E2EEKEY END account=alice devices=0');
    expect(h.observeDirectory).toHaveBeenCalledOnce();
    expect(h.observeDirectory).toHaveBeenCalledWith('E2EEKEY END account=alice devices=0');

    expect(h.bridge.onRegistered(parseIRCMessage(':node-b.example 001 alice :Duplicate'))).toBe(false);
    h.feed(':node-b.example NOTICE alice :E2EEKEY END account=alice devices=0');
    expect(h.observeDirectory).toHaveBeenCalledOnce();
  });

  it('drives canonical publication from the same authenticated owner lifecycle', async () => {
    const h = harness({ account: null });
    expect(h.publisherOptions).toMatchObject({
      sender: expect.any(Object),
      endpoint: 'wss://chat.example/irc?realm=one',
      clientId: 'client-1',
      account: null,
    });
    h.bridge.start();
    h.bridge.onConnected();
    expect(h.publisherOnConnected).toHaveBeenCalledOnce();
    expect(h.handlers).toHaveLength(1);

    h.setAccount(' Alice ');
    await h.bridge.refreshAuthenticatedAccount();
    expect(h.publisherSetAccount).toHaveBeenLastCalledWith('alice');
    expect(h.bridge.onRegistered(parseIRCMessage(':node-a.example 001 alice :Welcome'))).toBe(true);
    expect(h.publisherOnRegistered).toHaveBeenCalledOnce();

    h.resetVault();
    expect(h.publisherOnVaultReset).toHaveBeenCalledOnce();
    h.bridge.onDisconnected();
    expect(h.publisherOnDisconnected).toHaveBeenCalledOnce();
    expect(h.handlers).toHaveLength(0);

    await h.bridge.setAuthenticatedAccount(null);
    expect(h.publisherSetAccount).toHaveBeenLastCalledWith(null);
    await h.bridge.destroy();
    expect(h.publisherDestroy).toHaveBeenCalledOnce();
    expect(h.vaultUnsubscribe).toHaveBeenCalledOnce();
  });

  it('admits publication acknowledgements and failures only from the frozen server prefix', () => {
    const h = harness({ account: 'alice' });
    h.bridge.start();
    h.bridge.onConnected();
    h.bridge.onRegistered(parseIRCMessage(':node-a.example 001 alice :Welcome'));

    h.feed(':mallory!m@evil NOTICE alice :E2EEKEY ADDED id=ogc1-device alg=onyx-ogc1-v1');
    h.feed(':node-b.example NOTICE alice :E2EEKEY ADDED id=ogc1-device alg=onyx-ogc1-v1');
    h.feed(':node-b.example FAIL E2EEKEY STORE_FAILED :no');
    expect(h.publisherObserveBody).not.toHaveBeenCalled();
    expect(h.publisherObserveFailure).not.toHaveBeenCalled();

    h.feed(':node-a.example NOTICE alice :E2EEKEY ADDED id=ogc1-device alg=onyx-ogc1-v1');
    expect(h.publisherObserveBody).toHaveBeenCalledOnce();
    expect(h.publisherObserveBody).toHaveBeenCalledWith(
      'E2EEKEY ADDED id=ogc1-device alg=onyx-ogc1-v1',
    );
    // ADDED is never forwarded into the DEVICE...END collector.
    expect(h.observeDirectory).not.toHaveBeenCalled();

    h.feed(':node-a.example FAIL E2EEKEY STORE_FAILED :write failed');
    expect(h.publisherObserveFailure).toHaveBeenCalledOnce();
    expect(h.publisherObserveFailure).toHaveBeenCalledWith('STORE_FAILED');
    expect(h.handlers).toHaveLength(1);

    h.setCurrent(false);
    h.feed(':node-a.example NOTICE alice :E2EEKEY ADDED id=ogc1-device alg=onyx-ogc1-v1');
    h.resetVault();
    expect(h.publisherObserveBody).toHaveBeenCalledOnce();
    expect(h.publisherOnVaultReset).not.toHaveBeenCalled();
  });

  it('forwards only group-control commands and accepts dotted commands from original raw bytes', () => {
    const h = harness();
    h.bridge.start();
    h.bridge.onConnected();
    h.feed(':node-a.example PRIVMSG #room :ordinary');
    h.feed(':node-a.example E2EE.COMMIT #room alice phone :opaque');
    expect(h.accept).toHaveBeenCalledOnce();
    expect((h.accept.mock.calls[0]?.[0] as { raw: string }).raw).toContain('E2EE.COMMIT');
  });

  it('exposes no key material and fails closed when its runtime owner is unavailable', async () => {
    const h = harness({ account: 'alice' });
    await expect(h.bridge.sealRoomMessage('#room', 'transient plaintext')).resolves.toEqual({
      ok: false, status: 'locked', reason: 'session-not-provisioned',
    });
    await expect(h.bridge.openRoomMessage('#room', 'ONYXROOM1 malformed')).resolves.toEqual({
      ok: false, status: 'locked', reason: 'session-not-provisioned',
    });
    expect(JSON.stringify(h.bridge)).not.toMatch(/key|epochKey|privateKey/u);
    await h.bridge.destroy();
    await expect(h.bridge.sealRoomMessage('#room', 'after destroy')).resolves.toEqual({
      ok: false, status: 'locked', reason: 'runtime-inactive',
    });
  });

  it('uses authenticated accounts only, omits device id, and scopes durable adapters exactly', async () => {
    const h = harness({ account: null });
    h.bridge.start();
    expect(h.integrationOptions.identity).toBeNull();
    expect(typeof h.integrationOptions.trustedSignerStore).toBe('function');
    const resolveStore = h.integrationOptions.trustedSignerStore as () => unknown;
    expect(resolveStore()).toBeNull();

    h.setAccount(' Alice ');
    await expect(h.bridge.refreshAuthenticatedAccount()).resolves.toBe(true);
    expect(h.setIdentity).toHaveBeenLastCalledWith({ account: 'alice' });
    expect(resolveStore()).not.toBeNull();
    expect(resolveStore()).not.toBeNull();
    expect(h.signerStoreFactory).toHaveBeenCalledOnce();
    expect(h.signerStoreFactory).toHaveBeenCalledWith({
      endpoint: 'wss://chat.example/irc?realm=one',
      localAccount: 'alice',
    });

    await h.bridge.setAuthenticatedAccount(null);
    expect(h.setIdentity).toHaveBeenLastCalledWith({ account: null, deviceId: null });
    expect(resolveStore()).toBeNull();
  });

  it('removes rooms only on explicit owner calls and suppresses stale work', async () => {
    const h = harness();
    h.bridge.start();
    h.bridge.onRoomPart('#one');
    h.bridge.onRoomKick('#two');
    expect(h.onRoomPart).toHaveBeenCalledWith('#one');
    expect(h.onRoomKick).toHaveBeenCalledWith('#two');

    h.setCurrent(false);
    h.bridge.onConnected();
    h.bridge.onRoomPart('#stale');
    h.emit(runtime('stale-owner'));
    expect(h.handlers).toHaveLength(0);
    expect(h.onRoomPart).not.toHaveBeenCalledWith('#stale');
    expect(h.published).not.toContainEqual(runtime('stale-owner'));
  });

  it('clears synchronously and tears down subscriptions before async destruction', async () => {
    const h = harness();
    h.bridge.start();
    h.bridge.onConnected();
    const pending = h.bridge.destroy();
    expect(h.handlers).toHaveLength(0);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.vaultUnsubscribe).toHaveBeenCalledOnce();
    expect(h.publisherDestroy).toHaveBeenCalledOnce();
    expect(h.published.at(-1)).toBeNull();
    await pending;
    expect(h.destroy).toHaveBeenCalledOnce();
  });
});
