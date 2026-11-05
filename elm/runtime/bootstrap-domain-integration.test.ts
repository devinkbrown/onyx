import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { createBrowserRuntime, resolveCameraPublication, type BrowserRuntimeConfig } from './bootstrap';
import { makeConversationId } from './contracts';
import { openVaultV5, OWNED_MESSAGES, OWNED_READ_ANCHORS } from './migrations';

class FixtureWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FixtureWebSocket[] = [];
  static capabilities = 'message-tags server-time echo-message chathistory batch';
  static capabilityChunks: readonly string[] | null = null;
  static onSend: ((socket: FixtureWebSocket, line: string) => void) | null = null;
  static autoProp = true;
  readonly url: string;
  readonly protocol = 'text.ircv3.net';
  readonly bufferedAmount = 0;
  binaryType: BinaryType = 'arraybuffer';
  readyState = FixtureWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  private welcomed = false;

  constructor(url: string) { this.url = url; FixtureWebSocket.instances.push(this); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    listeners.add(typeof listener === 'function' ? listener as (event: Event) => void : event => listener.handleEvent(event));
    this.listeners.set(type, listeners);
  }
  removeEventListener(): void {}
  dispatch(type: string, event: Event): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  open(): void { this.readyState = FixtureWebSocket.OPEN; this.dispatch('open', new Event('open')); }
  server(line: string): void { this.dispatch('message', Object.assign(new Event('message'), { data: line })); }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') return;
    this.sent.push(data);
    const line = data.trim();
    const nick = this.sent.find(value => value.startsWith('NICK '))?.slice(5) ?? 'fixture';
    if (line === 'CAP LS 302') {
      const chunks = FixtureWebSocket.capabilityChunks;
      if (chunks) chunks.forEach((chunk, index) => this.server(`:fixture.test CAP * LS${index < chunks.length - 1 ? ' *' : ''} :${chunk}`));
      else this.server(`:fixture.test CAP * LS :${FixtureWebSocket.capabilities}`);
    }
    else if (line.startsWith('CAP REQ ')) this.server(`:fixture.test CAP * ACK ${line.slice('CAP REQ '.length)}`);
    else if (line === 'CAP END' && !this.welcomed) {
      this.welcomed = true;
      this.server(`:fixture.test 001 ${nick} :Welcome`);
      this.server(`:fixture.test 005 ${nick} CHANTYPES=# PREFIX=(qaohv)~&@%+ CASEMAPPING=rfc1459 STATUSMSG=. STATUSMSG=! :supported`);
    } else if (line.startsWith('JOIN ')) {
      const channel = line.slice(5).trim();
      this.server(`:${nick}!u@h JOIN ${channel}`);
    } else if (line.startsWith('MODE #')) {
      const channel = line.slice(5).trim();
      this.server(`:fixture.test 324 ${nick} ${channel} +nt`);
    } else if (line.startsWith('PROP #') && FixtureWebSocket.autoProp) {
      const channel = line.slice(5).trim();
      this.server(`:fixture.test 819 ${nick} ${channel} :End of properties`);
    } else if (line.startsWith('NAMES #')) {
      const channel = line.slice(6).trim();
      const accountTag = nick === 'audienceacct' ? '@account=audienceacct ' : '';
      this.server(`${accountTag}:fixture.test 353 ${nick} = ${channel} :${nick}`);
      this.server(`:fixture.test 366 ${nick} ${channel} :End of names`);
    }
    FixtureWebSocket.onSend?.(this,line);
  }
  close(): void { this.readyState = FixtureWebSocket.CLOSED; this.dispatch('close', new Event('close')); }
}

function memoryLocalStorage(): { readonly storage: Storage; readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return { storage, entries };
}

function registerAccount(runtime: ReturnType<typeof createBrowserRuntime>, nick: string, account: string): FixtureWebSocket {
  expect(runtime.connect().kind).toBe('transport-admitted');
  const socket = FixtureWebSocket.instances.at(-1)!;
  socket.open();
  runtime.sendLine('CAP LS 302');
  runtime.sendLine(`NICK ${nick}`);
  runtime.sendLine('USER fixture 0 * :Fixture');
  socket.server(`:fixture.test 900 ${nick} FixtureDisplay ${account} :You are now logged in`);
  socket.server(`:fixture.test 903 ${nick} :SASL authentication successful`);
  runtime.sendLine('CAP END');
  expect(runtime.ownerSnapshot().accountId).toBe(account);
  return socket;
}

function domainCommand(runtime: ReturnType<typeof createBrowserRuntime>, requestId: string, domain: string, action: string, payload: Record<string, unknown>) {
  const owner = runtime.ownerSnapshot();
  return { schemaVersion: 1, requestId, ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration),
    connectionGeneration: Number(owner.connectionGeneration), domain, action, payload };
}

describe('browser runtime domain envelope', () => {
  let dispose: (() => void) | null = null;
  const originalWebSocket = globalThis.WebSocket;
  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator,'mediaDevices');

  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.restoreAllMocks();
    FixtureWebSocket.capabilities = 'message-tags server-time echo-message chathistory batch';
    FixtureWebSocket.capabilityChunks = null;
    FixtureWebSocket.onSend = null;
    FixtureWebSocket.autoProp = true;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
    if(originalLocalStorageDescriptor)Object.defineProperty(globalThis,'localStorage',originalLocalStorageDescriptor);
    else Reflect.deleteProperty(globalThis,'localStorage');
    if(originalMediaDevicesDescriptor)Object.defineProperty(globalThis.navigator,'mediaDevices',originalMediaDevicesDescriptor);
    else Reflect.deleteProperty(globalThis.navigator,'mediaDevices');
  });

  it('does not accept a failed camera upgrade that leaves the prior voice call alive', () => {
    const priorCall = { call: { conversationId: '#fixture', callRef: 'prior-call-reference-0123456789' } };
    const failedUpgrade = { state: 'in-call', reason: 'failed', kind: 'voice', conversationId: '#fixture' } as const;
    const failedDecision = resolveCameraPublication(failedUpgrade, priorCall, '#fixture', 'new-video-call-reference-012345',
      { conversationId: '#fixture', callRef: 'prior-call-reference-0123456789' });
    expect(failedDecision).toEqual({ accepted: false, refreshRoster: false, restorePrevious: true });

    const successfulUpgrade = { state: 'in-call', reason: null, kind: 'video', conversationId: '#fixture' } as const;
    expect(resolveCameraPublication(successfulUpgrade,
      { call: { conversationId: '#fixture', callRef: 'reserved-video-call-reference-0123' } },
      '#fixture', 'reserved-video-call-reference-0123', null)).toEqual({ accepted: true, refreshRoster: true, restorePrevious: false });
    expect(resolveCameraPublication(successfulUpgrade,
      { call: { conversationId: '#other', callRef: 'reserved-video-call-reference-0123' } },
      '#fixture', 'reserved-video-call-reference-0123', null)).toEqual({ accepted: false, refreshRoster: false, restorePrevious: false });
  });

  it('dispatches the exact eight-field envelope and rejects missing or extra envelope keys', async () => {
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network',
      endpointId: 'fixture-endpoint',
      trustedEndpoints: [],
      initialUrl: 'wss://fixture.test/ws',
      onLines: () => {},
    });
    dispose = () => runtime.dispose();
    const owner = runtime.ownerSnapshot();
    const command = {
      schemaVersion: 1,
      requestId: 'A'.repeat(24),
      ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration),
      connectionGeneration: Number(owner.connectionGeneration),
      domain: 'anchor',
      action: 'load',
      payload: { conversationId: '#fixture' },
    };

    const accepted = await runtime.dispatchDomain(command);
    expect(accepted).toMatchObject({ domain: 'anchor', action: 'load', status: 'accepted', view: { kind: 'anchor', conversationId: '#fixture' } });

    const missingPayload: Record<string, unknown> = { ...command };
    delete missingPayload.payload;
    const missing = await runtime.dispatchDomain(missingPayload);
    expect(missing).toMatchObject({ status: 'blocked', reason: 'invalid-command' });

    const extra = await runtime.dispatchDomain({ ...command, unexpected: true, requestId: 'B'.repeat(24) });
    expect(extra).toMatchObject({ status: 'blocked', reason: 'invalid-command' });
  });

  it('bounds completed request IDs behind a pending domain request without evicting that request', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const stored = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
      clear: () => { stored.clear(); },
      key: (index: number) => [...stored.keys()][index] ?? null,
      get length() { return stored.size; },
    } as Storage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });

    let credentialStatePublications = 0;
    const runtime = createBrowserRuntime({
      networkId: 'request-cache-network', endpointId: 'request-cache-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://request-cache.fixture.test/ws', onLines: () => {},
      onCredentialState: () => { credentialStatePublications += 1; },
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK requestcache');
    runtime.sendLine('USER fixture 0 * :Fixture');
    socket.server(':fixture.test 900 requestcache :Authentication failed');
    socket.server(':fixture.test 900 requestcache FixtureDisplay otheraccount :You are now logged in');
    socket.server(':fixture.test 900 requestcache FixtureDisplay cacheaccount :You are now logged in');
    socket.server(':fixture.test 903 requestcache :SASL authentication successful');
    runtime.sendLine('CAP END');

    const owner = runtime.ownerSnapshot();
    expect(owner.accountId).toBe('cacheaccount');
    const workspaceReady = await runtime.dispatchDomain({ schemaVersion: 1, requestId: 'workspace-cache-warmup-00000001',
      ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'workspace', action: 'remember', payload: { enabled: true, confirm: true } });
    expect(workspaceReady).toMatchObject({ status: 'accepted', view: { selectedWorkspaceRef: expect.any(String) } });

    const makeCommand = (requestId: string, domain: string, action: string, payload: Record<string, unknown>) => ({
      schemaVersion: 1, requestId, ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain, action, payload,
    });
    const pendingCommand = makeCommand('cache-anchor-pending-00000001', 'anchor', 'load', { conversationId: '#fixture' });
    const anchorReads = vi.spyOn(IDBObjectStore.prototype, 'get');
    const anchorStoreReads = () => anchorReads.mock.contexts.filter(context => context instanceof IDBObjectStore && context.name === OWNED_READ_ANCHORS).length;
    // The conversation-key scheme is recorded asynchronously after workspace
    // selection; until then a load correctly answers without an IndexedDB read.
    let warmups = 0;
    await vi.waitFor(async () => {
      warmups += 1;
      await runtime.dispatchDomain(makeCommand(`cache-anchor-warmup-${String(warmups).padStart(8, '0')}`, 'anchor', 'load', { conversationId: '#fixture' }));
      expect(anchorStoreReads()).toBeGreaterThan(0);
    });
    anchorReads.mockClear();
    let pendingSettled = false;
    const pending = runtime.dispatchDomain(pendingCommand);
    void pending.then(() => { pendingSettled = true; }, () => { pendingSettled = true; });

    const oldestCompletedCommand = makeCommand('cache-completed-00000000', 'session', 'remember', { enabled: false });
    const completedCommands = Array.from({ length: 257 }, (_, index) => index === 0
      ? oldestCompletedCommand
      : makeCommand(`cache-completed-${String(index).padStart(8, '0')}`, 'session', 'remember', { enabled: false }));
    const completedResults = [];
    for (const command of completedCommands) completedResults.push(await runtime.dispatchDomain(command));

    expect(completedResults.every(result => result.status === 'accepted')).toBe(true);
    expect(pendingSettled).toBe(false);
    const beforeReplay = credentialStatePublications;
    const replay = runtime.dispatchDomain(oldestCompletedCommand);
    const duplicatePending = runtime.dispatchDomain(pendingCommand);
    expect(await replay).toMatchObject({ status: 'accepted' });
    expect(credentialStatePublications).toBe(beforeReplay + 1);

    const [firstPendingResult, duplicatePendingResult] = await Promise.all([pending, duplicatePending]);
    expect(firstPendingResult).toMatchObject({ status: 'accepted', view: { kind: 'anchor', conversationId: '#fixture' } });
    expect(duplicatePendingResult).toEqual(firstPendingResult);
    expect(anchorStoreReads()).toBe(2);
  });

  it('consumes dotted group-control deliveries privately while peer look-alikes stay public', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    const publicLines: string[] = [];
    const runtime = createBrowserRuntime({
      networkId: 'group-ingress-network', endpointId: 'group-ingress-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://group-ingress.fixture.test/ws', onLines: lines => { publicLines.push(...lines); },
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('NICK groupingress');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    publicLines.length = 0;

    const deliveries = [
      ':Alice!alice@localhost E2EE.KEYPACKAGE #secure alice phone :AQIDBA',
      ':Alice!alice@localhost E2EE.COMMIT #secure alice phone :b3BhcXVl',
      '@time=2026-11-05T00:00:00.000Z :Alice!alice@localhost E2EE.WELCOME #secure alice phone Bob tablet :d2VsY29tZQ',
    ];
    for (const line of deliveries) socket.server(line);
    expect(publicLines).toEqual([]);

    const lookAlike = ':Mallory!m@h PRIVMSG #secure :E2EE.COMMIT #secure alice phone :b3BhcXVl';
    socket.server(lookAlike);
    expect(publicLines).toEqual([lookAlike]);
  });

  it('keeps legacy public-line delivery immediate when frame batching is not enabled', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const publicLines: string[] = [];
    const runtime = createBrowserRuntime({ networkId: 'legacy-batch-network', endpointId: 'legacy-batch-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://legacy-batch.fixture.test/ws', onLines: lines => publicLines.push(...lines) });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK legacybatch');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');
    publicLines.length = 0;

    const line = ':peer!u@host PRIVMSG #fixture :legacy delivery';
    socket.server(line);
    expect(publicLines).toEqual([line]);
  });

  it('batches only joined-channel peer chat and flushes its per-frame receipts before control and domain actions', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    type PublicFrameBatch = Parameters<NonNullable<BrowserRuntimeConfig['onFrames']>>[0];
    const events: Array<{ readonly kind: 'lines'; readonly lines: readonly string[] }
      | { readonly kind: 'frames'; readonly batch: PublicFrameBatch }> = [];
    const runtime = createBrowserRuntime({ networkId: 'frame-batch-network', endpointId: 'frame-batch-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://frame-batch.fixture.test/ws', onLines: lines => events.push({ kind: 'lines', lines }),
      onFrames: batch => events.push({ kind: 'frames', batch }) });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK framebatch');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');
    events.length = 0;

    const first = ':peer!u@host PRIVMSG #fixture :first';
    const second = ':other!u@host PRIVMSG #fixture :second';
    const control = ':fixture.test 421 framebatch BOGUS :Unknown command';
    socket.server(first);
    socket.server(second);
    expect(events).toHaveLength(0);
    socket.server(control);

    expect(events.map(event => event.kind)).toEqual(['frames', 'lines']);
    const batchEvent = events[0];
    expect(batchEvent?.kind).toBe('frames');
    if (batchEvent?.kind !== 'frames') throw new Error('missing chat frame batch');
    const owner = runtime.ownerSnapshot();
    expect(batchEvent.batch.owner).toEqual({ ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration) });
    expect(batchEvent.batch.frames.map(frame => frame.lines)).toEqual([[first], [second]]);
    expect(batchEvent.batch.frames[0]!.at).toBeLessThanOrEqual(batchEvent.batch.frames[1]!.at);
    expect(events[1]).toEqual({ kind: 'lines', lines: [control] });

    const third = ':peer!u@host PRIVMSG #fixture :before domain action';
    socket.server(third);
    const current = runtime.ownerSnapshot();
    const load = runtime.dispatchDomain({ schemaVersion: 1, requestId: 'frame-domain-load-00000001', ownerRef: current.ownerRef,
      accountGeneration: Number(current.accountGeneration), connectionGeneration: Number(current.connectionGeneration),
      domain: 'anchor', action: 'load', payload: { conversationId: '#fixture' } });
    expect(events.at(-1)?.kind).toBe('frames');
    const domainBatch = events.at(-1);
    expect(domainBatch?.kind).toBe('frames');
    if (domainBatch?.kind !== 'frames') throw new Error('pending chat was not flushed before the domain action');
    expect(domainBatch.batch.frames.map(frame => frame.lines)).toEqual([[third]]);
    await load;
  });

  it('does not let a close boundary retire a new owner opened reentrantly by frame delivery', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    let redirectOnFrame = false;
    let connectReentrantly: (() => void) | null = null;
    const runtime = createBrowserRuntime({ networkId: 'reentrant-batch-network', endpointId: 'reentrant-batch-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://reentrant-batch.fixture.test/ws', onLines: () => {},
      onFrames: () => { if (redirectOnFrame) { redirectOnFrame = false; connectReentrantly?.(); } } });
    connectReentrantly = () => { runtime.connect(); };
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK reentrantbatch');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');
    socket.server(':peer!u@host PRIVMSG #fixture :queued before close');

    const beforeClose = runtime.ownerSnapshot();
    redirectOnFrame = true;
    runtime.close();

    const afterClose = runtime.ownerSnapshot();
    expect(afterClose.connectionGeneration).toBe(Number(beforeClose.connectionGeneration) + 1);
    expect(afterClose.physicalRef).not.toBeNull();
  });

  it('continues physical retirement when the frame observer throws during close', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const runtime = createBrowserRuntime({ networkId: 'throwing-close-network', endpointId: 'throwing-close-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://throwing-close.fixture.test/ws', onLines: () => {},
      onFrames: () => { throw new Error('renderer unavailable'); } });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK throwingclose');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');
    socket.server(':peer!u@host PRIVMSG #fixture :pending before close');

    expect(() => runtime.close()).not.toThrow();
    expect(runtime.ownerSnapshot().physicalRef).toBeNull();
    expect(socket.readyState).toBe(FixtureWebSocket.CLOSED);
  });

  it('disposes the transport and queue when the frame observer throws during disposal', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const runtime = createBrowserRuntime({ networkId: 'throwing-dispose-network', endpointId: 'throwing-dispose-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://throwing-dispose.fixture.test/ws', onLines: () => {},
      onFrames: () => { throw new Error('renderer unavailable'); } });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK throwingdispose');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');
    socket.server(':peer!u@host PRIVMSG #fixture :pending before disposal');

    expect(() => runtime.dispose()).not.toThrow();
    expect(socket.readyState).toBe(FixtureWebSocket.CLOSED);
  });

  it('drains pending frames during disposal while rejecting reentrant send, domain, and capture work', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) } as unknown as MediaDevices,
    });
    let runtime: ReturnType<typeof createBrowserRuntime> | null = null;
    let sendAttempt: unknown = null;
    let domainAttempt: Promise<unknown> | null = null;
    let captureAttempt: unknown = null;
    runtime = createBrowserRuntime({ networkId: 'dispose-authoring-network', endpointId: 'dispose-authoring-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://dispose-authoring.fixture.test/ws', onLines: () => {}, onFrames: () => {
        if (!runtime) return;
        const owner = runtime.ownerSnapshot();
        sendAttempt = runtime.sendLine('PRIVMSG #fixture :must not send during dispose');
        domainAttempt = runtime.dispatchDomain({ schemaVersion: 1, requestId: 'dispose-domain-load-00000001', ownerRef: owner.ownerRef,
          accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
          domain: 'anchor', action: 'load', payload: { conversationId: '#fixture' } });
        captureAttempt = runtime.prepareCaptureFromGesture({ intentRef: 'capture-dispose-attempt-00000001', owner,
          conversationId: makeConversationId('soundcheck')!, kind: 'voice', purpose: 'soundcheck' });
      } });
    dispose = () => runtime?.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK disposeauthoring');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');
    socket.server(':peer!u@host PRIVMSG #fixture :pending until dispose');
    const sentBeforeDispose = socket.sent.length;

    runtime.dispose();
    dispose = null;

    expect(sendAttempt).toEqual({ kind: 'blocked', reason: 'owner-changed' });
    expect(await domainAttempt).toMatchObject({ status: 'blocked', reason: 'runtime-disposed' });
    expect(captureAttempt).toMatchObject({ available: false, reason: 'stale-owner' });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(sentBeforeDispose);
    expect(socket.readyState).toBe(FixtureWebSocket.CLOSED);
  });

  it('accepts the Elm three-field media join contract and rejects an unavailable capture before joining', async () => {
    const runtime=createBrowserRuntime({networkId:'media-contract-network',endpointId:'media-contract-endpoint',trustedEndpoints:[],
      initialUrl:'wss://media-contract.fixture.test/ws',onLines:()=>{}});
    dispose=()=>runtime.dispose();
    const owner=runtime.ownerSnapshot();
    const result=await runtime.dispatchDomain({schemaVersion:1,requestId:'media-join-contract-00000001',ownerRef:owner.ownerRef,
      accountGeneration:Number(owner.accountGeneration),connectionGeneration:Number(owner.connectionGeneration),domain:'media',action:'join',
      payload:{conversationId:'#fixture',kind:'voice',captureRef:'abcdefghijklmnopqrstuv'}});
    expect(result).toMatchObject({domain:'media',action:'join',status:'blocked',reason:'capture-intent-unavailable'});
  });

  it('keeps source-shaped MEDIA roster and recording Event Spine rows out of public IRC projection', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const publicLines: string[] = [];
    const runtime = createBrowserRuntime({ networkId: 'media-private-network', endpointId: 'media-private-endpoint',
      trustedEndpoints: [], initialUrl: 'wss://media.fixture.test/ws', onLines: lines => publicLines.push(...lines) });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();runtime.sendLine('CAP LS 302');runtime.sendLine('NICK mediauser');runtime.sendLine('USER fixture 0 * :Fixture');runtime.sendLine('CAP END');
    socket.server(':fixture.test EVENT mediauser MEDIA ROSTER #fixture mediauser voice main 0 0 - consent=0');
    socket.server(':fixture.test EVENT mediauser MEDIA ROSTER-END #fixture count=1');
    socket.server(':fixture.test EVENT mediauser MEDIA CONSENT #fixture peer off');
    expect(publicLines.some(line => line.includes('MEDIA ROSTER') || line.includes('MEDIA CONSENT'))).toBe(false);
  });

  it('reserves MEDIA ROSTER, CONSENT, and RECORD for the typed call-scoped controller', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const runtime=createBrowserRuntime({networkId:'media-reservation-network',endpointId:'media-reservation-endpoint',trustedEndpoints:[],
      initialUrl:'wss://media-reservation.fixture.test/ws',onLines:()=>{}});
    dispose=()=>runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket=FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK mediauser');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    const sentBefore=socket.sent.length;
    expect(runtime.sendLine('MEDIA ROSTER #fixture')).toEqual({kind:'blocked',reason:'policy'});
    expect(runtime.sendLine('media roster #fixture')).toEqual({kind:'blocked',reason:'policy'});
    expect(runtime.sendLine('MEDIA CONSENT #fixture on')).toEqual({kind:'blocked',reason:'policy'});
    expect(runtime.sendLine('MEDIA RECORD #fixture start')).toEqual({kind:'blocked',reason:'policy'});
    expect(socket.sent).toHaveLength(sentBefore);
  });

  it('requires current MEMO registry readiness before queueing and keeps the locally queued view truthful', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const runtime = createBrowserRuntime({ networkId: 'memo-network', endpointId: 'memo-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://memo.fixture.test/ws', onLines: () => {} });
    dispose = () => runtime.dispose();
    FixtureWebSocket.onSend = (socket, line) => {
      if (line === 'COMMANDS MEMO') {
        socket.server(':fixture.test 371 memonick :MEMO command access=account feature=messages');
        socket.server(':fixture.test 374 memonick :End of COMMANDS');
      }
    };
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK memonick');
    runtime.sendLine('USER fixture 0 * :Fixture');
    socket.server(':fixture.test 900 memonick FixtureDisplay memoacct :You are now logged in');
    runtime.sendLine('CAP END');
    const owner = runtime.ownerSnapshot();
    expect(owner.accountId).toBe('memoacct');
    const command = (requestId: string, action: string, payload: object) => ({ schemaVersion: 1, requestId,
      ownerRef: owner.ownerRef, accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'service-integration', action, payload });
    const recipientAccount = 'recipientacct';
    const unready = await runtime.dispatchDomain(command('memo-before-readiness-0001', 'memo-send', { account: recipientAccount, text: 'private memo text' }));
    expect(unready).toMatchObject({ status: 'blocked', reason: 'feature-unknown' });
    expect(socket.sent.some(line => line.startsWith('MEMO SEND '))).toBe(false);

    // Start both operations in the same turn: account proof has started the
    // default workspace's asynchronous IndexedDB initialization, while the
    // registry reply makes this MEMO eligible. The direct path must wait for
    // that exact workspace instead of attempting a queue against no ticket.
    const refreshedPromise = runtime.dispatchDomain(command('memo-registry-refresh-001', 'refresh', { feature: 'memo' }));
    const queuedPromise = runtime.dispatchDomain(command('memo-after-readiness-0001', 'memo-send', { account: recipientAccount, text: 'private memo text' }));
    const refreshed = await refreshedPromise;
    expect(refreshed).toMatchObject({ status: 'accepted', view: { kind: 'service-integration', feature: 'memo', registry: 'enabled' } });
    const queued = await queuedPromise;
    expect(['accepted', 'transport-admitted']).toContain(queued.status);
    expect(queued.view).toMatchObject({ kind: 'service-integration', feature: 'memo', operation: 'send' });
    expect(JSON.stringify(queued.view)).not.toContain('private memo text');
    expect(socket.sent.some(line => line.startsWith(`MEMO SEND ${recipientAccount} :private memo text`))).toBe(true);
    // A validated account recipient is routed directly; it is not resolved
    // as an IRC nickname and requires no WHOIS/name binding.
    expect(socket.sent.some(line => line.startsWith(`WHOIS ${recipientAccount}`))).toBe(false);
  });

  it('claims a durable notification route after account proof when the worker click message arrived before startup', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const route = { schemaVersion: 1, routeRef: 'route-ref', claimRef: 'claim-ref', createdAtMs: 1, expiresAtMs: 10_000,
      networkId: null, accountId: null, bindingRef: null, kind: 'inbox', conversationId: null } as const;
    const outcomes: string[] = [];
    let claims = 0;
    const browserPlatform = {
      serviceWorker: null,
      claimNotificationRoute: async () => { claims += 1; return route; },
      settleNotificationRoute: async (_context: unknown, input: { readonly outcome: string }) => { outcomes.push(input.outcome); return true; },
      dispose() {},
    } as unknown as import('./browser-platform').BrowserPlatform;
    const navigation: Array<{ requestId: string; ownerRef: string; accountGeneration: number; connectionGeneration: number; kind: string; conversationId: string | null }> = [];
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: 'wss://fixture.test/ws',
      buildCompatibility: { buildId: 'a'.repeat(32), protocolVersion: 1,
        storageSchemas: { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 },
        shellAssets: [{ path: '/app/', sha256: 'b'.repeat(64) }], publicNavigationPaths: ['/app/'] },
      browserPlatform,
      onLines: () => {},
      onNotificationNavigation: event => navigation.push(event),
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK accountnick');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    socket.server(':fixture.test 900 accountnick FixtureDisplay fixtureacct :You are now logged in');
    await vi.waitFor(() => expect(navigation).toHaveLength(1));
    expect(claims).toBe(1);
    const event = navigation[0]!;
    expect(event.kind).toBe('inbox');
    expect(await runtime.settleNotificationNavigation({ requestId: event.requestId, ownerRef: event.ownerRef,
      accountGeneration: event.accountGeneration, connectionGeneration: event.connectionGeneration, opened: true })).toBe(true);
    expect(outcomes).toEqual(['opened']);
  });

  it('publishes the exact destination proof before transferred recovery and issues one replacement token', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const entries = new Map<string,string>();
    const storage = {
      getItem:(key:string)=>entries.get(key)??null,
      setItem:(key:string,value:string)=>{entries.set(key,value);},
      removeItem:(key:string)=>{entries.delete(key);},
      clear:()=>entries.clear(),
      key:(index:number)=>[...entries.keys()][index]??null,
      get length(){return entries.size;},
    } as Storage;
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
    const url='wss://fixture.test/ws';
    const destinationUrl='wss://node-b.fixture.test/ws';
    const account='fixtureacct';
    const scope=JSON.stringify(['fixture-network',account,'fixture-endpoint']);
    const meshClaim='53524d02'+'a'.repeat(342);
    storage.setItem('onyx:session-credentials-v2',JSON.stringify({[scope]:{
      schemaVersion:2,networkId:'fixture-network',accountId:account,issuerEndpointId:'fixture-endpoint',
      local:{secret:'1'.repeat(32),kind:'local-logical',expiresAtMs:null},
      mesh:{secret:`srm2m.${meshClaim}.${'b'.repeat(32)}`,kind:'mesh-exact',expiresAtMs:null},
    }}));
    let meshCredentialRef:string|null=null;
    const timeline:Array<
      |{kind:'owner';ownerRef:string;accountId:string|null;accountGeneration:number;connectionGeneration:number}
      |{kind:'recovery';ownerRef:string;status:string;transferFrom:unknown}
    >=[];
    const runtime=createBrowserRuntime({networkId:'fixture-network',endpointId:'fixture-endpoint',trustedEndpoints:['fixture-endpoint','fixture-endpoint-b'],initialUrl:url,
      endpointRegistry:[{url,networkId:'fixture-network',endpointId:'fixture-endpoint',nodeName:'node-a'},
        {url:destinationUrl,networkId:'fixture-network',endpointId:'fixture-endpoint-b',nodeName:'nodeB'}],
      onLines:()=>{},
      onCredentialState:state=>{meshCredentialRef=state.credentials.find(item=>item.credentialKind==='mesh-exact')?.credentialRef??null;},
      onOwnerState:state=>timeline.push({kind:'owner',ownerRef:state.ownerRef,accountId:state.accountId,
        accountGeneration:state.accountGeneration,connectionGeneration:state.connectionGeneration})});
    dispose=()=>runtime.dispose();
    let replacementTokenRequests=0;
    let destinationResumePending=false;
    FixtureWebSocket.onSend=(socket,line)=>{
      if(line.startsWith('SESSION RESUME ')){
        if(socket.url===url)socket.server(':fixture.test NOTICE accountnick :SESSION REDIRECT: exact session lives on nodeB; reconnect there to reclaim');
        else destinationResumePending=true;
      }else if(line==='SESSION TOKEN'){
        replacementTokenRequests+=1;
        socket.server(`:fixture.test NOTICE accountnick :SESSION TOKEN ${'2'.repeat(32)}`);
      }else if(line.startsWith('PING :'))socket.server(`:fixture.test PONG :${line.slice('PING :'.length)}`);
    };
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const source=FixtureWebSocket.instances.at(-1)!;
    source.open();runtime.sendLine('CAP LS 302');runtime.sendLine('NICK accountnick');runtime.sendLine('USER fixture 0 * :Fixture');
    source.server(':fixture.test 900 accountnick FixtureDisplay fixtureacct :You are now logged in');
    runtime.sendLine('CAP END');
    expect(runtime.ownerSnapshot().accountId).toBe(account);
    expect(meshCredentialRef).not.toBeNull();
    runtime.subscribeDomainObservations(event=>{
      if(event.domain==='session'&&event.view.kind==='session-recovery'){
        const view=event.view;
        timeline.push({kind:'recovery',ownerRef:event.ownerRef,status:view.status,transferFrom:view.transferFrom});
      }
    });
    const sourceOwner=runtime.ownerSnapshot();
    const started=await runtime.dispatchDomain({schemaVersion:1,requestId:'R'.repeat(24),ownerRef:sourceOwner.ownerRef,
      accountGeneration:Number(sourceOwner.accountGeneration),connectionGeneration:Number(sourceOwner.connectionGeneration),domain:'session',action:'resume',
      payload:{credentialRef:meshCredentialRef!}});
    // The source command is admitted, but its awaited result belongs to an
    // owner that the trusted redirect retires. Stamped observations carry it
    // across the attachment boundary without restamping the old result.
    expect(started).toMatchObject({ status: 'cancelled', reason: 'owner-retired' });
    expect(source.sent.some(line => line.startsWith('SESSION RESUME '))).toBe(true);
    const destination=FixtureWebSocket.instances.at(-1)!;
    expect(destination.url).toBe(destinationUrl);
    destination.open();runtime.sendLine('CAP LS 302');runtime.sendLine('NICK accountnick');runtime.sendLine('USER fixture 0 * :Fixture');
    destination.server(':fixture.test 900 accountnick FixtureDisplay fixtureacct :You are now logged in');
    runtime.sendLine('CAP END');
    await vi.waitFor(()=>expect(destinationResumePending).toBe(true),{timeout:5_000});
    const competing=await runtime.dispatchDomain({schemaVersion:1,requestId:'S'.repeat(24),ownerRef:runtime.ownerSnapshot().ownerRef,
      accountGeneration:Number(runtime.ownerSnapshot().accountGeneration),connectionGeneration:Number(runtime.ownerSnapshot().connectionGeneration),
      domain:'session',action:'local-list',payload:{}});
    expect(competing.status).toBe('blocked');
    expect(destination.sent.some(line=>line.startsWith('SESSION LIST'))).toBe(false);
    destination.server(':fixture.test NOTICE accountnick :SESSION RESUME: exact session restored');
    await vi.waitFor(() => expect(timeline.some(item => item.kind === 'recovery' && item.status === 'accepted')).toBe(true), { timeout: 5_000 });
    const acceptedIndex=timeline.findIndex(item=>item.kind==='recovery'&&item.status==='accepted');
    const accepted=timeline[acceptedIndex];
    expect(accepted?.kind).toBe('recovery');
    if(accepted?.kind!=='recovery')throw new Error('missing source-confirmed recovery acceptance');
    const transferredPendingIndex=timeline.findIndex((item,index)=>index<acceptedIndex&&item.kind==='recovery'&&item.status==='pending'&&item.transferFrom!==null);
    expect(transferredPendingIndex).toBeGreaterThan(-1);
    const transferredPending=timeline[transferredPendingIndex];
    expect(transferredPending?.kind).toBe('recovery');
    if(transferredPending?.kind!=='recovery')throw new Error('missing destination recovery transfer');
    expect(timeline.findIndex((item,index)=>index<transferredPendingIndex&&item.kind==='owner'
      &&item.ownerRef===transferredPending.ownerRef&&item.accountId===account)).toBeGreaterThan(-1);
    expect(timeline.filter(item=>item.kind==='recovery'&&item.status==='accepted')).toHaveLength(1);
    expect(replacementTokenRequests).toBe(1);
    destination.server(':fixture.test NOTICE accountnick :SESSION RESUME: exact session restored');
    expect(replacementTokenRequests).toBe(1);
  });

  it('sends one source-authorized guest message using fresh namespace tickets', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const url = 'wss://fixture.test/ws';
    const publicLines: string[] = [];
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'fixture-network', endpointId: 'fixture-endpoint' }], onLines: lines => publicLines.push(...lines),
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const active = FixtureWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK perfguest');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');

    const owner = runtime.ownerSnapshot();
    const result = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'C'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'journal', action: 'queue',
      payload: { clientIntentId: 'D'.repeat(24), conversationId: '#fixture', intent: 'chat', text: 'guest fixture message', replyTo: null, messageKind: 'message', audiencePrefix: null },
    });
    expect(result).toMatchObject({ status: 'transport-admitted', view: { kind: 'journal', entries: [{ durability: 'volatile', state: 'transport-admitted' }] } });
    expect(active!.sent.filter(line => line.startsWith('PRIVMSG #fixture '))).toHaveLength(1);

    let guestRowReads = 0;
    const unsupportedGuestRow = new Proxy({ target: '#fixture', from: 'perfguest', body: 'not durable', at: 1_700_000_000_000 }, {
      get(target, property, receiver) { guestRowReads += 1; return Reflect.get(target, property, receiver); },
    });
    expect(await runtime.vaultPut([unsupportedGuestRow])).toEqual({ status: 'unavailable', affected: 0 });
    expect(guestRowReads).toBe(0);
    const guestOwner = runtime.ownerSnapshot();
    const guestPasskeys = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'Q'.repeat(24), ownerRef: guestOwner.ownerRef,
      accountGeneration: Number(guestOwner.accountGeneration), connectionGeneration: Number(guestOwner.connectionGeneration),
      domain: 'account-security', action: 'passkey-list', payload: {},
    });
    expect(guestPasskeys).toMatchObject({ status: 'blocked', reason: 'account-proof-required' });
    expect(active!.sent.some(line => line === 'WEBAUTHN LIST\r\n')).toBe(false);
    const auth = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'P'.repeat(24), ownerRef: guestOwner.ownerRef,
      accountGeneration: Number(guestOwner.accountGeneration), connectionGeneration: Number(guestOwner.connectionGeneration),
      domain: 'webauthn', action: 'begin', payload: { ceremony: 'authenticate', account: 'guest-account' },
    });
    expect(auth).toMatchObject({ status: 'pending', view: { kind: 'webauthn', ceremony: 'authenticate', phase: 'pending' } });
    expect(active!.sent.some(line => line === 'WEBAUTHN AUTH guest-account')).toBe(true);
    active!.server(':fixture.test EVENT perfguest WEBAUTHN CRED YWJj 0 1 :stale credential');
    expect(publicLines.some(line => line.includes('WEBAUTHN CRED'))).toBe(false);
  });

  it('queues a proven account room message through private sealing without policy recursion', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const url = 'wss://fixture.test/ws';
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'fixture-network', endpointId: 'fixture-endpoint' }], onLines: () => {},
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const active = FixtureWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK perfaccount');
    runtime.sendLine('USER fixture 0 * :Fixture');
    // SASL account proof arrives before the welcome. The two-param IRCX
    // error is not authority; the complete success must wait for 001 to
    // confirm the same tentative server prefix before it changes the owner.
    active!.server(':fixture.test 900 perfaccount :Authentication failed');
    expect(runtime.ownerSnapshot().accountId).toBeNull();
    active!.server(':other.test 900 perfaccount FixtureDisplay attacker :You are now logged in');
    expect(runtime.ownerSnapshot().accountId).toBeNull();
    active!.server(':fixture.test 900 perfaccount FixtureDisplay fixtureacct :You are now logged in');
    expect(runtime.ownerSnapshot().accountId).toBeNull();
    active!.server(':fixture.test 903 perfaccount :SASL authentication successful');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');

    const owner = runtime.ownerSnapshot();
    expect(owner.accountId).toBe('fixtureacct');
    const observations: Array<{ domain: string; ownerRef: string; accountGeneration: number; connectionGeneration: number; viewKind: string }> = [];
    runtime.subscribeDomainObservations(event => observations.push({ domain: event.domain, ownerRef: event.ownerRef,
      accountGeneration: event.accountGeneration, connectionGeneration: event.connectionGeneration, viewKind: event.view.kind }));
    const resume = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'L'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'session', action: 'resume', payload: { credentialRef: 'M'.repeat(24) },
    });
    expect(resume.status).toBe('blocked');
    expect(observations.some(event => event.domain === 'session' && event.viewKind === 'session-recovery'
      && event.ownerRef === owner.ownerRef && event.accountGeneration === Number(owner.accountGeneration)
      && event.connectionGeneration === Number(owner.connectionGeneration))).toBe(true);
    const passkeyList = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'N'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'account-security', action: 'passkey-list', payload: {},
    });
    expect(passkeyList).toMatchObject({ status: 'pending', view: { kind: 'passkey-management', operation: 'list' } });
    expect(observations.some(event => event.domain === 'account-security' && event.viewKind === 'passkey-management'
      && event.ownerRef === owner.ownerRef && event.accountGeneration === Number(owner.accountGeneration)
      && event.connectionGeneration === Number(owner.connectionGeneration))).toBe(true);
    const result = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'E'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'journal', action: 'queue',
      payload: { clientIntentId: 'F'.repeat(24), conversationId: '#FIXTURE', intent: 'chat', text: 'account fixture message', replyTo: null, messageKind: 'message', audiencePrefix: null },
    });
    expect(result.status, JSON.stringify(result)).toBe('transport-admitted');
    expect(result.view).toMatchObject({ kind: 'journal', entries: [{ durability: 'durable', state: 'transport-admitted' }] });
    expect(active!.sent.filter(line => line.startsWith('PRIVMSG #FIXTURE '))).toHaveLength(1);

  });

  it('applies ordered STATUSMSG facts and revokes audience addressing on -STATUSMSG', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const url = 'wss://fixture.test/ws';
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'fixture-network', endpointId: 'fixture-endpoint' }], onLines: () => {},
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const active = FixtureWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK audienceacct');
    runtime.sendLine('USER fixture 0 * :Fixture');
    const beforeInvalidLine = active!.sent.length;
    expect(runtime.sendLine('@bad_key=x CREATE #blocked')).toEqual({ kind: 'blocked', reason: 'invalid-intent' });
    expect(active!.sent).toHaveLength(beforeInvalidLine);
    active!.server(':fixture.test 900 audienceacct FixtureDisplay audienceacct :You are now logged in');
    runtime.sendLine('CAP END');
    runtime.sendLine('JOIN #fixture');

    const owner = runtime.ownerSnapshot();
    const queued = (requestId: string, clientIntentId: string, audiencePrefix: '!' | '.') => runtime.dispatchDomain({
      schemaVersion: 1, requestId, ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'journal', action: 'queue',
      payload: { clientIntentId, conversationId: '#fixture', intent: 'chat', text: 'audience message', replyTo: null, messageKind: 'message', audiencePrefix },
    });
    const beforeRemoval = await queued('H'.repeat(24), 'I'.repeat(24), '!');
    expect(beforeRemoval.status).toBe('transport-admitted');
    expect(active!.sent.filter(line => line.startsWith('PRIVMSG !#fixture '))).toHaveLength(1);

    active!.server(':fixture.test 005 audienceacct STATUSMSG=. -STATUSMSG :updated');
    const afterRemoval = await queued('J'.repeat(24), 'K'.repeat(24), '.');
    expect(afterRemoval).toMatchObject({ status: 'blocked', reason: 'audience-policy-unavailable' });
    expect(active!.sent.filter(line => line.startsWith('PRIVMSG !#fixture '))).toHaveLength(1);
  });

  it('advances the mapping fence for every token in a CASEMAPPING ABA 005', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const url = 'wss://fixture.test/ws';
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'fixture-network', endpointId: 'fixture-endpoint' }], onLines: () => {},
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const active = FixtureWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK mappingguest');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    const owner = runtime.ownerSnapshot();
    const capturedGeneration = runtime.conversationMappingGeneration(owner);
    const canonicalBefore = runtime.canonicalConversationKey(owner, '#Room[]');
    expect(runtime.conversationKeyScheme(owner)?.name).toBe('rfc1459');

    active!.server(':fixture.test 005 mappingguest CASEMAPPING=ascii CASEMAPPING=rfc1459 :duplicate values');

    expect(runtime.conversationKeyScheme(owner)?.name).toBe('rfc1459');
    expect(runtime.canonicalConversationKey(owner, '#Room[]')).toBe(canonicalBefore);
    expect(runtime.conversationMappingGeneration(owner)).toBe((capturedGeneration ?? 0) + 2);
  });

  it('uses only negotiated multiline aliases and the minimum advertised limits', async () => {
    FixtureWebSocket.capabilities = 'message-tags server-time echo-message chathistory batch multiline=max-bytes=2,max-lines=2 draft/multiline=max-bytes=10,max-lines=4';
    FixtureWebSocket.capabilityChunks = [
      'multiline=max-bytes=2,max-lines=2',
      'message-tags server-time echo-message chathistory batch draft/multiline=max-bytes=10,max-lines=4',
    ];
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const url = 'wss://fixture.test/ws';
    let latestCapabilityRound: string | null = null;
    const runtime = createBrowserRuntime({
      networkId: 'fixture-network', endpointId: 'fixture-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'fixture-network', endpointId: 'fixture-endpoint' }], onLines: () => {},
      onFeatureReadiness: state => { latestCapabilityRound = state.roundRef; },
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const active = FixtureWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK multilineguest');
    runtime.sendLine('USER fixture 0 * :Fixture');
    runtime.sendLine('CAP END');
    // Re-discover after registration so the runtime exposes the current round;
    // aliases become negotiated only through this explicit REQ/ACK exchange.
    runtime.sendLine('CAP LS 302');
    expect(latestCapabilityRound).not.toBeNull();
    expect(runtime.requestCapabilityGroup({ roundRef: latestCapabilityRound!, names: ['multiline', 'draft/multiline'] })).toEqual({ kind: 'transport-admitted' });
    expect(active!.sent).toContain('CAP REQ :multiline draft/multiline');
    expect(runtime.endCapabilityRound(latestCapabilityRound!)).toEqual({ kind: 'transport-admitted' });
    runtime.sendLine('JOIN #fixture');
    const owner = runtime.ownerSnapshot();
    const result = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'L'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'journal', action: 'queue',
      payload: { clientIntentId: 'M'.repeat(24), conversationId: '#fixture', intent: 'chat', text: 'a\nb\nc', replyTo: null, messageKind: 'message', audiencePrefix: null },
    });
    expect(result.status).toBe('transport-admitted');
    expect(active!.sent.filter(line => /^BATCH \+/u.test(line))).toHaveLength(2);
    expect(active!.sent.filter(line => /^@batch=.* PRIVMSG #fixture /u.test(line))).toHaveLength(3);

    // Removing the looser alias leaves the tight multiline value in place.
    // A bare NEW for that still-active capability replaces the old value with
    // no advertised limits instead of retaining the stale tight limit.
    active!.server(':fixture.test CAP * DEL :draft/multiline');
    active!.server(':fixture.test CAP * NEW :multiline');
    const previousBatchOpens = active!.sent.filter(line => /^BATCH \+/u.test(line)).length;
    const secondResult = await runtime.dispatchDomain({
      schemaVersion: 1, requestId: 'N'.repeat(24), ownerRef: owner.ownerRef,
      accountGeneration: Number(owner.accountGeneration), connectionGeneration: Number(owner.connectionGeneration),
      domain: 'journal', action: 'queue',
      payload: { clientIntentId: 'O'.repeat(24), conversationId: '#fixture', intent: 'chat', text: 'd\ne\nf', replyTo: null, messageKind: 'message', audiencePrefix: null },
    });
    expect(secondResult.status).toBe('transport-admitted');
    expect(active!.sent.filter(line => /^BATCH \+/u.test(line))).toHaveLength(previousBatchOpens + 1);
  });

  it('accepts exact CAP inventory bounds and closes on oversized LS or NEW without partial promotion', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    const openRuntime = (chunks: readonly string[]) => {
      FixtureWebSocket.instances.length = 0;
      FixtureWebSocket.capabilityChunks = chunks;
      const url = 'wss://cap-bound-fixture.test/ws';
      const runtime = createBrowserRuntime({
        networkId: 'cap-bound-network', endpointId: 'cap-bound-endpoint', trustedEndpoints: [], initialUrl: url,
        endpointRegistry: [{ url, networkId: 'cap-bound-network', endpointId: 'cap-bound-endpoint' }], onLines: () => {},
      });
      dispose = () => runtime.dispose();
      expect(runtime.connect(url).kind).toBe('transport-admitted');
      const active = FixtureWebSocket.instances.at(-1)!;
      active.open();
      runtime.sendLine('CAP LS 302');
      return { runtime, active, url };
    };

    const atNameLimit = openRuntime([
      Array.from({ length: 128 }, (_, index) => `vendor.cap-${index}`).join(' '),
      Array.from({ length: 128 }, (_, index) => `vendor.cap-${index + 128}`).join(' '),
    ]);
    expect(atNameLimit.active.readyState).toBe(FixtureWebSocket.OPEN);
    atNameLimit.runtime.dispose(); dispose = null;

    const overNameLimit = openRuntime([
      Array.from({ length: 128 }, (_, index) => `vendor.cap-${index}`).join(' '),
      Array.from({ length: 129 }, (_, index) => `vendor.cap-${index + 128}`).join(' '),
    ]);
    expect(overNameLimit.active.readyState).toBe(FixtureWebSocket.CLOSED);
    expect(overNameLimit.runtime.ownerSnapshot().physicalRef).toBeNull();
    overNameLimit.runtime.dispose(); dispose = null;

    const atValueLimit = openRuntime([`vendor.large=${'x'.repeat(4096)}`]);
    expect(atValueLimit.active.readyState).toBe(FixtureWebSocket.OPEN);
    atValueLimit.runtime.dispose(); dispose = null;

    const overValueLimit = openRuntime([`vendor.large=${'x'.repeat(4097)}`]);
    expect(overValueLimit.active.readyState).toBe(FixtureWebSocket.CLOSED);
    expect(overValueLimit.runtime.ownerSnapshot().physicalRef).toBeNull();
    overValueLimit.runtime.dispose(); dispose = null;

    const newLimit = openRuntime(['message-tags']);
    newLimit.active.server(`:fixture.test CAP * NEW :${Array.from({ length: 257 }, (_, index) => `vendor.new-${index}`).join(' ')}`);
    expect(newLimit.active.readyState).toBe(FixtureWebSocket.CLOSED);
    expect(newLimit.runtime.ownerSnapshot().physicalRef).toBeNull();
    newLimit.runtime.dispose(); dispose = null;
  });

  it('poisons one timed-out LS round, ignores its late final, and starts clean after reconnect', async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    FixtureWebSocket.capabilityChunks = null;
    const url = 'wss://cap-timeout-fixture.test/ws';
    const runtime = createBrowserRuntime({
      networkId: 'cap-timeout-network', endpointId: 'cap-timeout-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'cap-timeout-network', endpointId: 'cap-timeout-endpoint' }], onLines: () => {},
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const first = FixtureWebSocket.instances.at(-1)!;
    first.open();
    first.server(':fixture.test CAP * LS * :multiline=max-bytes=20,max-lines=2');
    await vi.advanceTimersByTimeAsync(29_000);
    first.server(':fixture.test CAP * LS * :message-tags');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(first.readyState).toBe(FixtureWebSocket.CLOSED);
    const retiredOwner = runtime.ownerSnapshot();
    first.server(':fixture.test CAP * LS :draft/multiline=max-bytes=40000,max-lines=64');
    expect(runtime.ownerSnapshot()).toEqual(retiredOwner);

    FixtureWebSocket.capabilityChunks = ['message-tags server-time'];
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const second = FixtureWebSocket.instances.at(-1)!;
    second.open();
    runtime.sendLine('CAP LS 302');
    expect(second.readyState).toBe(FixtureWebSocket.OPEN);
    runtime.dispose(); dispose = null;
    vi.useRealTimers();
  });

  it('stores numeric-time rows in bounded chunks while keeping local and wire identities distinct', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const url = 'wss://vault-fixture.test/ws';
    const runtime = createBrowserRuntime({
      networkId: 'fixture-vault-network', endpointId: 'fixture-vault-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'fixture-vault-network', endpointId: 'fixture-vault-endpoint' }], onLines: () => {},
    });
    dispose = () => runtime.dispose();
    expect(runtime.connect(url).kind).toBe('transport-admitted');
    const active = FixtureWebSocket.instances.at(-1);
    expect(active).toBeDefined();
    active!.open();
    runtime.sendLine('CAP LS 302');
    runtime.sendLine('NICK vaultaccount');
    runtime.sendLine('USER fixture 0 * :Fixture');
    active!.server(':fixture.test 900 vaultaccount FixtureDisplay vaultacct :You are now logged in');
    expect(runtime.ownerSnapshot().accountId).toBeNull();
    runtime.sendLine('CAP END');
    expect(runtime.ownerSnapshot().accountId).toBe('vaultacct');
    runtime.sendLine('JOIN #fixture');

    const rows: Array<Parameters<typeof runtime.vaultPut>[0][number]> = Array.from({ length: 121 }, (_, index) => ({
      id: index === 0 ? '#fixture:server-0' : `#fixture:local-${index}`,
      wireMessageId: `server-${index}`,
      target: '#fixture',
      from: index === 0 ? 'alice' : 'vaultaccount',
      body: `history ${index}`,
      at: 1_700_000_000_000 + index,
      rowType: 'msg',
      deleted: false,
      redacted: false,
      replyTo: index === 0 ? { id: 'parent-1', from: 'alice', text: 'quoted parent' } : null,
    }));
    // A stable local identity can contain the same token as a wire msgid; the
    // storage namespace must keep those identities separate.
    rows.push({ ...rows[0]!, wireMessageId: null, body: 'local identity server-0' });
    const messagePuts = vi.spyOn(IDBObjectStore.prototype, 'put');
    const firstPutContext = messagePuts.mock.contexts.length;
    const originalEncode = TextEncoder.prototype.encode;
    let syntheticBodyEncodes = 0;
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, input?: string): ReturnType<TextEncoder['encode']> {
      if (typeof input === 'string' && /^history \d+(?: revised)?$/u.test(input)) syntheticBodyEncodes += 1;
      return originalEncode.call(this, input);
    });
    const growing = Array.from({ length: 121 }, (_, index) => runtime.vaultPut(rows.slice(0, index + 1)));
    const expanded = runtime.vaultPut(rows);
    const editedRows = [...rows, { ...rows[0]!, body: 'history 0 revised', redacted: true,
      replyTo: { id: 'parent-1', from: 'alice', text: 'edited quoted parent' } }];
    const edited = runtime.vaultPut(editedRows);
    const shiftedRows = [...rows.slice(1), {
      id: '#fixture:shifted-canary', wireMessageId: 'shifted-canary', target: '#fixture', from: 'vaultaccount',
      body: 'late shifted canary', at: 1_700_000_000_500, rowType: 'msg', deleted: false, redacted: false, replyTo: null,
    }];
    const shifted = runtime.vaultPut(shiftedRows);
    const [growingResults, expandedResult, editedResult, shiftedResult] = await Promise.all([
      Promise.all(growing), expanded, edited, shifted,
    ]);
    expect(growingResults).toHaveLength(121);
    expect(growingResults.every(result => result.status === 'stale' && result.affected === 0)).toBe(true);
    expect(expandedResult).toEqual({ status: 'stale', affected: 0 });
    expect(editedResult).toEqual({ status: 'ready', affected: 122 });
    expect(shiftedResult).toEqual({ status: 'ready', affected: 122 });
    // The workload presents 7,381 repeated history-body occurrences across
    // growing snapshots. Reuse should normalize each admitted semantic version
    // only a small fixed number of times, while storage still performs fresh
    // policy/projection work for every durable batch.
    expect(syntheticBodyEncodes).toBeLessThan(1_000);

    const loaded = await runtime.vaultGet('#fixture', 200);
    expect(loaded.status).toBe('ready');
    expect(loaded.rows).toHaveLength(122);
    const first = loaded.rows.find(row => row.wireMessageId === 'server-0');
    const localIdentity = loaded.rows.find(row => row.wireMessageId === null && row.body === 'local identity server-0');
    const canary = loaded.rows.find(row => row.wireMessageId === 'shifted-canary');
    expect(first).toBeUndefined();
    expect(localIdentity?.id).toMatch(/^m1-[A-Za-z0-9_-]{43}$/u);
    expect(canary).toMatchObject({ wireMessageId: 'shifted-canary', body: 'late shifted canary' });
    const openedVault = await openVaultV5({ indexedDB: globalThis.indexedDB });
    expect(openedVault.kind).toBe('ready');
    if (openedVault.kind !== 'ready') throw new Error('Expected the active v5 vault');
    type StoredFixtureRow = { readonly id: string; readonly ownerKey: string; readonly targetKey: string; readonly row: { readonly recordId: string; readonly messageId: string | null;
      readonly body: string; readonly atMs: number; readonly redacted: boolean; readonly replyTo: { readonly id: string; readonly from: string; readonly text: string | null } | null } };
    const storedRows = await new Promise<StoredFixtureRow[]>((resolve, reject) => {
      const transaction = openedVault.database.transaction(OWNED_MESSAGES, 'readonly');
      const request = transaction.objectStore(OWNED_MESSAGES).getAll();
      request.onsuccess = () => resolve(request.result as StoredFixtureRow[]);
      request.onerror = () => reject(request.error);
    });
    openedVault.database.close();
    const currentOwner = runtime.ownerSnapshot();
    const fixtureTargetKey = runtime.canonicalConversationKey(currentOwner, '#fixture');
    expect(currentOwner.accountId).toBe('vaultacct');
    expect(fixtureTargetKey).not.toBeNull();
    const firstStoredMatches = storedRows.filter(value => value.ownerKey === JSON.stringify([currentOwner.networkId, 'account', currentOwner.accountId])
      && value.targetKey === fixtureTargetKey && value.row.messageId === 'server-0');
    expect(firstStoredMatches).toHaveLength(1);
    const firstStored = firstStoredMatches[0];
    expect(firstStored?.row.recordId).toMatch(/^m1-[A-Za-z0-9_-]{43}$/u);
    expect(firstStored?.row.recordId).not.toBe(localIdentity?.id);
    expect(firstStored?.row).toMatchObject({
      messageId: 'server-0', body: 'history 0 revised', atMs: 1_700_000_000_000, redacted: true,
      replyTo: { id: 'parent-1', from: 'alice', text: 'edited quoted parent' },
    });
    const ownedMessagePuts = messagePuts.mock.contexts.slice(firstPutContext)
      .filter((store): store is IDBObjectStore => store instanceof IDBObjectStore && store.name === 'messages_owned');
    expect(ownedMessagePuts).toHaveLength(123);
    expect(new Set(ownedMessagePuts.map(store => store.transaction)).size).toBe(2);

    let signalDigest!: () => void;
    let releaseDigest!: () => void;
    let digestEntered = false;
    const enteredDigest = new Promise<void>(resolve => { signalDigest = resolve; });
    const digestGate = new Promise<void>(resolve => { releaseDigest = resolve; });
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      if (!digestEntered && new TextDecoder().decode(data).includes('retirement-canary')) {
        digestEntered = true;
        signalDigest();
        await digestGate;
      }
      return originalDigest(algorithm, data);
    });
    const pendingRetirement = runtime.vaultPut([{ id: '#fixture:retired', wireMessageId: 'retirement-canary', target: '#fixture',
      from: 'vaultaccount', body: 'must not cross workspace retirement', at: 1_700_000_000_600 }]);
    await enteredDigest;
    runtime.close();
    expect(await pendingRetirement).toEqual({ status: 'stale', affected: 0 });
    releaseDigest();
    await new Promise(resolve => setTimeout(resolve, 0));
    const lateRetiredWrites = messagePuts.mock.calls.some((call, index) => {
      const store = messagePuts.mock.contexts[index];
      const value = call[0] as { readonly row?: { readonly messageId?: string | null } };
      return store instanceof IDBObjectStore && store.name === 'messages_owned' && value?.row?.messageId === 'retirement-canary';
    });
    expect(lateRetiredWrites).toBe(false);
  });
  it('keeps account ownership across self NICK changes after 900 proof', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    memoryLocalStorage();
    const runtime = createBrowserRuntime({ networkId: 'nick-network', endpointId: 'nick-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://nick.fixture.test/ws', onLines: () => {} });
    dispose = () => runtime.dispose();
    const socket = registerAccount(runtime, 'kai', 'kai');
    const proven = runtime.ownerSnapshot();
    socket.server(':kai!u@h NICK Guest123');
    socket.server(':Guest123!u@h NICK :kai_');
    const after = runtime.ownerSnapshot();
    expect(after.accountId).toBe('kai');
    expect(after.accountGeneration).toBe(proven.accountGeneration);
    expect(after.ownerRef).toBe(proven.ownerRef);
    expect(after.connectionGeneration).toBe(proven.connectionGeneration);
    // A peer taking the old nick does not move our account either.
    socket.server(':someone!u@h NICK kai');
    expect(runtime.ownerSnapshot().accountId).toBe('kai');
    expect(runtime.ownerSnapshot().accountGeneration).toBe(proven.accountGeneration);
  });

  it('keeps an unproven guest unauthenticated when it takes an account-shaped nick', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    memoryLocalStorage();
    const runtime = createBrowserRuntime({ networkId: 'guest-network', endpointId: 'guest-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://guest.fixture.test/ws', onLines: () => {} });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302'); runtime.sendLine('NICK Guest123'); runtime.sendLine('USER fixture 0 * :Fixture'); runtime.sendLine('CAP END');
    socket.server(':Guest123!u@h NICK kai');
    expect(runtime.ownerSnapshot().accountId).toBeNull();
  });

  it('keeps issued session secrets out of every public sink, console, and unconsented storage', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const { entries } = memoryLocalStorage();
    const consoleCalls: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleCalls.push(args); });
    }
    const local = '5e'.repeat(16);
    const mesh = '53524d01' + 'c7'.repeat(64);
    const publicLines: string[] = [];
    const credentialStates: unknown[] = [];
    const observations: unknown[] = [];
    let barrier: string | null = null;
    const runtime = createBrowserRuntime({ networkId: 'redact-network', endpointId: 'redact-endpoint', trustedEndpoints: ['redact-endpoint'],
      initialUrl: 'wss://redact.fixture.test/ws', onLines: lines => { publicLines.push(...lines); },
      onCredentialState: state => { credentialStates.push(state); } });
    dispose = () => runtime.dispose();
    runtime.subscribeDomainObservations(event => { observations.push(event); });
    FixtureWebSocket.onSend = (socket, line) => {
      if (line === 'SESSION TOKEN') {
        socket.server(`:fixture.test NOTICE redactnick :SESSION TOKEN ${local}`);
        socket.server(`:fixture.test NOTICE redactnick :SESSION MTOKEN ${mesh} expires=1900000000`);
      } else if (line.startsWith('PING :')) { barrier = line.slice('PING :'.length); socket.server(`:fixture.test PONG fixture.test :${barrier}`); }
    };
    registerAccount(runtime, 'redactnick', 'redactacct');
    const attached = await runtime.dispatchDomain(domainCommand(runtime, 'redact-attach-000000000001', 'session', 'new-attachment', {}));
    expect(attached).toMatchObject({ status: 'accepted' });
    expect((await runtime.issueCredentialBundle()).kind).toBe('transport-admitted');
    await vi.waitFor(() => expect(credentialStates.at(-1)).toMatchObject({ issuance: 'idle', remembered: false }));
    const latest = credentialStates.at(-1) as { credentials: Array<{ credentialKind: string; remembered: boolean }> };
    expect(latest.credentials.map(item => item.credentialKind).sort()).toEqual(['local-logical', 'mesh-logical']);
    expect(latest.credentials.every(item => item.remembered === false)).toBe(true);
    expect(barrier).not.toBeNull();
    const sinks = { publicLines, credentialStates, observations, consoleCalls, storage: [...entries.entries()] };
    for (const [name, sink] of Object.entries(sinks)) {
      const text = JSON.stringify(sink);
      expect(text, name).not.toContain(local);
      expect(text, name).not.toContain(mesh);
    }
    expect(publicLines.some(line => line.includes('SESSION TOKEN') || line.includes('SESSION MTOKEN'))).toBe(false);
    expect(publicLines.some(line => barrier !== null && line.includes(barrier))).toBe(false);
    expect([...entries.keys()].some(key => key.includes('session-credentials'))).toBe(false);
  });
  it('chunks private SASL payloads at 400 bytes with a trailing empty chunk only on an exact multiple', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    memoryLocalStorage();
    const runtime = createBrowserRuntime({ networkId: 'sasl-network', endpointId: 'sasl-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://sasl.fixture.test/ws', onLines: () => {} });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302'); runtime.sendLine('NICK saslnick'); runtime.sendLine('USER fixture 0 * :Fixture');
    const authenticateLines = () => socket.sent.map(line => line.trim()).filter(line => line.startsWith('AUTHENTICATE '));
    const context = runtime.captureSaslContext();
    expect(context).not.toBeNull();
    for (const [length, expected] of [[3, [3]], [399, [399]], [400, [400, 0]], [401, [400, 1]], [800, [400, 400, 0]]] as const) {
      const before = authenticateLines().length;
      expect(runtime.sendSaslPayload('Q'.repeat(length), context!)).toEqual({ kind: 'transport-admitted' });
      const chunks = authenticateLines().slice(before).map(line => line.slice('AUTHENTICATE '.length));
      expect(chunks.map(chunk => chunk === '+' ? 0 : chunk.length), `length ${length}`).toEqual(expected);
      expect(chunks.every(chunk => chunk === '+' || /^Q{1,400}$/u.test(chunk))).toBe(true);
    }
    const before = authenticateLines().length;
    for (const invalid of ['', 'abc$', 'abc def', 'QQ\r\nQUIT', 'Q'.repeat(32_769)]) {
      expect(runtime.sendSaslPayload(invalid, context!), JSON.stringify(invalid.slice(0, 12))).toEqual({ kind: 'blocked', reason: 'invalid-intent' });
    }
    expect(runtime.sendSaslPayload('QQQQ', 'not-a-captured-context-000000')).toEqual({ kind: 'blocked', reason: 'invalid-intent' });
    runtime.clearSaslContext(context!);
    expect(runtime.sendSaslPayload('QQQQ', context!)).toEqual({ kind: 'blocked', reason: 'invalid-intent' });
    expect(authenticateLines().length).toBe(before);
  });

  it('stops a chunked SASL payload at the first chunk the transport does not admit', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    memoryLocalStorage();
    const runtime = createBrowserRuntime({ networkId: 'sasl-stop-network', endpointId: 'sasl-stop-endpoint', trustedEndpoints: [],
      initialUrl: 'wss://sasl-stop.fixture.test/ws', onLines: () => {} });
    dispose = () => runtime.dispose();
    expect(runtime.connect().kind).toBe('transport-admitted');
    const socket = FixtureWebSocket.instances.at(-1)!;
    socket.open();
    runtime.sendLine('CAP LS 302'); runtime.sendLine('NICK saslnick'); runtime.sendLine('USER fixture 0 * :Fixture');
    const context = runtime.captureSaslContext()!;
    FixtureWebSocket.onSend = (target, line) => { if (line.startsWith('AUTHENTICATE ')) target.close(); };
    const result = runtime.sendSaslPayload('Q'.repeat(1200), context);
    expect(result.kind).toBe('blocked');
    expect(socket.sent.filter(line => line.startsWith('AUTHENTICATE '))).toHaveLength(1);
    expect(runtime.isSaslContextCurrent(context)).toBe(false);
  });
  it('forgets a missing-session credential without re-resuming or issuing a replacement token', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    const { storage } = memoryLocalStorage();
    const account = 'missingacct';
    const scope = JSON.stringify(['missing-network', account, 'missing-endpoint']);
    storage.setItem('onyx:session-credentials-v2', JSON.stringify({ [scope]: { schemaVersion: 2, networkId: 'missing-network', accountId: account,
      issuerEndpointId: 'missing-endpoint', local: { secret: '7'.repeat(32), kind: 'local-logical', expiresAtMs: null }, mesh: null } }));
    let credentialRefs: string[] = [];
    const recovery: Array<{ status: string; outcome: string | null }> = [];
    const runtime = createBrowserRuntime({ networkId: 'missing-network', endpointId: 'missing-endpoint', trustedEndpoints: ['missing-endpoint'],
      initialUrl: 'wss://missing.fixture.test/ws', onLines: () => {},
      endpointRegistry: [{ url: 'wss://missing.fixture.test/ws', networkId: 'missing-network', endpointId: 'missing-endpoint', nodeName: 'node-a' }],
      onCredentialState: state => { credentialRefs = state.credentials.map(item => item.credentialRef); } });
    dispose = () => runtime.dispose();
    runtime.subscribeDomainObservations(event => {
      if (event.domain === 'session' && event.view.kind === 'session-recovery') recovery.push({ status: event.view.status, outcome: event.view.outcome });
    });
    FixtureWebSocket.onSend = (socket, line) => {
      if (line.startsWith('SESSION RESUME ')) socket.server('FAIL SESSION NO_SESSION :No session matches that token');
      else if (line.startsWith('PING :')) socket.server(`:fixture.test PONG :${line.slice('PING :'.length)}`);
    };
    const socket = registerAccount(runtime, 'missingnick', account);
    expect(credentialRefs).toHaveLength(1);
    const result = await runtime.dispatchDomain(domainCommand(runtime, 'missing-resume-0000000001', 'session', 'resume', { credentialRef: credentialRefs[0]! }));
    expect(result.status).toBe('transport-admitted');
    await vi.waitFor(() => expect(recovery.at(-1)).toEqual({ status: 'rejected', outcome: 'missing' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(socket.sent.filter(line => line.startsWith('SESSION RESUME '))).toHaveLength(1);
    expect(socket.sent.some(line => line.trim() === 'SESSION TOKEN')).toBe(false);
    expect(credentialRefs).toEqual([]);
    expect(storage.getItem('onyx:session-credentials-v2') ?? '').not.toContain('7'.repeat(32));
  });
  it('fails storage reads closed on a live PROP EPHEMERAL change until the requery lands, then drops expired rows', async () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureWebSocket });
    FixtureWebSocket.instances.length = 0;
    memoryLocalStorage();
    const url = 'wss://ttl-fixture.test/ws';
    const runtime = createBrowserRuntime({ networkId: 'ttl-network', endpointId: 'ttl-endpoint', trustedEndpoints: [], initialUrl: url,
      endpointRegistry: [{ url, networkId: 'ttl-network', endpointId: 'ttl-endpoint' }], onLines: () => {} });
    dispose = () => runtime.dispose();
    const socket = registerAccount(runtime, 'ttlnick', 'ttlacct');
    runtime.sendLine('JOIN #ttl');
    const now = Date.now();
    const row = (id: string, at: number, body: string) => ({ id: `#ttl:${id}`, wireMessageId: id, target: '#ttl', from: 'alice', body, at,
      rowType: 'msg', deleted: false, redacted: false, replyTo: null });
    const rows = [row('old-1', now - 3_600_000, 'an hour old'), row('fresh-1', now - 1_000, 'just now')];
    await vi.waitFor(async () => expect(await runtime.vaultPut(rows)).toEqual({ status: 'ready', affected: 2 }));
    expect((await runtime.vaultGet('#ttl', 50)).rows.map(item => item.wireMessageId).sort()).toEqual(['fresh-1', 'old-1']);

    FixtureWebSocket.autoProp = false;
    const propQueries = () => socket.sent.filter(line => line.trim() === 'PROP #ttl').length;
    const queriesBefore = propQueries();
    socket.server(':alice!u@h PROP #ttl EPHEMERAL 60');
    expect(propQueries()).toBe(queriesBefore + 1);
    const during = await runtime.vaultGet('#ttl', 50);
    expect(during.status).not.toBe('ready');
    expect(during.rows).toEqual([]);

    socket.server(':fixture.test 818 ttlnick #ttl EPHEMERAL :60');
    socket.server(':fixture.test 819 ttlnick #ttl :End of properties');
    await vi.waitFor(async () => {
      const after = await runtime.vaultGet('#ttl', 50);
      expect(after.status).toBe('ready');
      expect(after.rows.map(item => item.wireMessageId)).toEqual(['fresh-1']);
    });
  });
});
