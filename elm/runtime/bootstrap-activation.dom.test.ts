import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserRuntime } from './bootstrap';

class PairPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  peer: PairPort | null = null;
  postMessage(data: unknown): void {
    const peer = this.peer;
    if (peer) queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent));
  }
  close(): void {}
  start(): void {}
}

class PairMessageChannel {
  readonly port1 = new PairPort();
  readonly port2 = new PairPort();
  constructor() { this.port1.peer = this.port2; this.port2.peer = this.port1; }
}

class FakeWaitingWorker {
  readonly state = 'installed';
  readonly clientStates: Array<Record<string, unknown>> = [];
  onClientState: ((state: Record<string, unknown>) => void) | null = null;
  serviceWorker!: FakeServiceWorkerContainer;

  postMessage(raw: unknown, transfer: Transferable[] = []): void {
    const message = raw as Record<string, unknown>;
    const port = transfer[0] as unknown as PairPort | undefined;
    if (message.type === 'HELLO') {
      const build = message.buildCompatibility as { buildId: string; protocolVersion: number; storageSchemas: unknown };
      queueMicrotask(() => port?.postMessage({ schemaVersion: 1, type: 'STATUS', status: 'ready', ...build }));
      return;
    }
    if (message.type !== 'REQUEST_ACTIVATION' || !port) return;
    const clientState = new PairMessageChannel();
    clientState.port1.onmessage = event => {
      const stateMessage = event.data as { state?: Record<string, unknown> };
      const state = stateMessage.state ?? {};
      this.clientStates.push(state);
      this.onClientState?.(state);
      port.postMessage({ schemaVersion: 1, type: 'STATUS', requestId: message.requestId,
        targetBuildId: message.targetBuildId, buildId: 'b'.repeat(32), status: 'failed',
        reason: 'activation-failed', pendingClients: 0, leaseIds: [] });
    };
    this.serviceWorker.dispatchMessage({ schemaVersion: 1, type: 'STATE_REQUEST', requestId: 'state-request-000000000001',
      targetBuildId: message.targetBuildId }, this, clientState.port2 as unknown as MessagePort);
  }
}

class FakeServiceWorkerContainer {
  controller: ServiceWorker | null = null;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  readonly waiting = new FakeWaitingWorker();
  readonly registration = { installing: null, waiting: this.waiting, active: null } as unknown as ServiceWorkerRegistration;
  constructor() { this.waiting.serviceWorker = this; }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MessageEvent) => void>();
    listeners.add(typeof listener === 'function' ? listener as (event: MessageEvent) => void : event => listener.handleEvent(event));
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const candidate of listeners) if (candidate === listener) listeners.delete(candidate);
  }
  dispatchMessage(data: unknown, source: FakeWaitingWorker, port: MessagePort): void {
    const event = new MessageEvent('message', { data });
    Object.defineProperties(event, { source: { value: source }, ports: { value: [port] } });
    for (const listener of this.listeners.get('message') ?? []) listener(event);
  }
  register(): Promise<ServiceWorkerRegistration> { return Promise.resolve(this.registration); }
}

describe('runtime worker activation barrier', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalMessageChannel = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.(); dispose = null;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalMessageChannel) Object.defineProperty(globalThis, 'MessageChannel', originalMessageChannel);
    else Reflect.deleteProperty(globalThis, 'MessageChannel');
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('excludes only the exact pending activation and denies new work while its barrier is held', async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker } });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: PairMessageChannel });
    const buildCompatibility = { buildId: 'b'.repeat(32), protocolVersion: 1 as const,
      storageSchemas: { vault: 5 as const, privateCrypto: 2 as const, platform: 1 as const, tabIntents: 1 as const, localWorkspaces: 1 as const },
      shellAssets: [{ path: '/app/', sha256: 'a'.repeat(64) }], publicNavigationPaths: ['/app/'] };
    let frozen = false;
    const browserPlatform = {
      serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      freezeAuthoring: () => { frozen = true; return () => { frozen = false; }; },
      claimNotificationRoute: async () => null,
      settleNotificationRoute: async () => true,
      dispose() { frozen = false; },
    } as unknown as import('./browser-platform').BrowserPlatform;
    const runtime = createBrowserRuntime({ networkId: 'activation-network', endpointId: 'activation-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://activation.test/ws', buildCompatibility, browserPlatform, onLines: () => {} });
    dispose = () => runtime.dispose();
    const owner = runtime.ownerSnapshot();
    expect(runtime.reportClientSafetyState({ schemaVersion: 1, ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      hasUnsavedDraft: false, composing: false, pendingAuthoring: false })).toBe(true);
    const command = (requestId: string, action: string, payload: object) => ({ schemaVersion: 1, requestId,
      ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'platform', action, payload });
    const registered = await runtime.dispatchDomain(command('register-worker-request-0001', 'worker-register', {}));
    expect(registered.view).toMatchObject({ kind: 'platform', worker: { status: 'waiting', targetRef: expect.any(String) } });
    const targetRef = (registered.view as { worker: { targetRef: string } }).worker.targetRef;

    let unrelatedResult: Promise<Awaited<ReturnType<typeof runtime.dispatchDomain>>> | null = null;
    let pickerResult: Promise<string | null> | null = null;
    serviceWorker.waiting.onClientState = state => {
      if (state.canActivate !== true || state.pendingPrivateMutation !== false) return;
      expect(frozen).toBe(true);
      unrelatedResult = runtime.dispatchDomain({ schemaVersion: 1, requestId: 'unrelated-domain-request-001',
        ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
        domain: 'anchor', action: 'load', payload: { conversationId: '#fixture' } });
      pickerResult = runtime.selectPrivateFile('settings-import');
    };
    const activated = await runtime.dispatchDomain(command('activate-worker-request-0001', 'worker-activate',
      { targetRef, confirm: true }));
    expect(serviceWorker.waiting.clientStates.at(-1)).toMatchObject({ canActivate: true, pendingPrivateMutation: false });
    expect(activated.status).toBe('failed');
    expect(unrelatedResult).not.toBeNull();
    await expect(unrelatedResult!).resolves.toMatchObject({ status: 'blocked', reason: 'activation-in-progress' });
    await expect(pickerResult!).resolves.toBeNull();
    expect(frozen).toBe(false);
  });
});
