// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EndpointId, OwnerSnapshot, RequestId, RuntimeFactoryContext, SendAdmission } from './contracts';

export interface TransportConnectIntent {
  readonly schemaVersion: 1;
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
  /** Explicit trusted deployment configuration; never derived from server text. */
  readonly url: string;
  readonly endpoint: EndpointId;
}
export interface TransportStatus {
  readonly owner: OwnerSnapshot;
  readonly endpoint: EndpointId | null;
  readonly state: 'unsupported' | 'connecting' | 'ready' | 'offline' | 'failed';
  readonly reason: 'api-unavailable' | 'invalid-url' | 'owner-changed' | 'connect-failed' | 'bridge-policy-unknown' | null;
  readonly fallbackAvailable: boolean;
}
export interface WebTransportLike {
  readonly ready: Promise<void>;
  readonly closed: Promise<{ closeCode: number; reason: string }>;
  createBidirectionalStream(): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }>;
  close(info?: { closeCode?: number; reason?: string }): void;
}
export interface WebTransportAdapterDependencies extends Pick<RuntimeFactoryContext, 'ownerSnapshot' | 'isCurrent'> {
  readonly createConnection?: (url: string) => WebTransportLike;
  readonly fallbackWss: () => Promise<void>;
  readonly isTrustedWebTransportUrl: (url: URL, endpoint: EndpointId) => boolean;
  readonly maxLineBytes?: number;
  readonly maxBufferedBytes?: number;
  readonly onLine?: (line: string, owner: OwnerSnapshot) => void;
  readonly onFallbackRequired?: (status: TransportStatus, intent: TransportConnectIntent) => void;
}
export interface WebTransportAdapter {
  connect(req: TransportConnectIntent): Promise<TransportStatus>;
  open(req: TransportConnectIntent, sink: { opened(): void; line(value: string): void; closed(): void }): import('./transport-owner').AlternativeDriver;
  rebindOwner(previous: OwnerSnapshot, next: OwnerSnapshot): boolean;
  sendLine(intent: { readonly line: string; readonly requestId: RequestId; readonly owner: OwnerSnapshot }): SendAdmission;
  subscribe(listener: (status: TransportStatus) => void): () => void;
  close(reason: string): void;
  dispose(): void;
}

const CONTROL = /[\u0000\r\n]/u;
const MAX_REASON = 120;
function waitBounded<T>(promise: Promise<T>, timeoutMs: number, onLate?: (value: T) => void): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observed = promise.then(value => { if (expired) onLate?.(value); return value; });
  return Promise.race([observed, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('WebTransport operation timeout')); }, timeoutMs);
  })]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * Browser WebTransport to the server's ordinary loopback IRC bridge. Browser
 * QUIC/H3 framing is supplied by WebTransport; payloads here remain raw IRC
 * CRLF lines. We intentionally do not attach media datagrams to this bridge.
 */
export function createWebTransportAdapter(deps: WebTransportAdapterDependencies): WebTransportAdapter {
  const makeTransport = deps.createConnection ?? ((url: string) => new WebTransport(url) as unknown as WebTransportLike);
  const listeners = new Set<(status: TransportStatus) => void>();
  const maxLineBytes = Math.max(512, Math.min(deps.maxLineBytes ?? 8192, 64 * 1024));
  const maxBufferBytes = Math.max(maxLineBytes, Math.min(deps.maxBufferedBytes ?? 256 * 1024, 1024 * 1024));
  let transport: WebTransportLike | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let status: TransportStatus = { owner: deps.ownerSnapshot(), endpoint: null, state: 'offline', reason: null, fallbackAvailable: true };
  let generation = 0;
  let disposed = false;
  let writeChain: Promise<void> = Promise.resolve();
  let queueEpoch = { generation: 0, queuedBytes: 0, queuedLines: 0 };
  let activeIntent: TransportConnectIntent | null = null;
  let activeConnectionToken: symbol | null = null;
  let publishingConnectionToken: symbol | null = null;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let activeSink: { opened(): void; line(value: string): void; closed(): void } | null = null;
  let activeSinkToken: symbol | null = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot) => a.ownerRef === b.ownerRef && a.networkId === b.networkId
    && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef;
  const samePhysicalBinding = (a: OwnerSnapshot, b: OwnerSnapshot) => a.networkId === b.networkId
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef;
  const publish = (next: TransportStatus, connectionToken: symbol | null = null, expectedGeneration = generation) => {
    if (disposed) return;
    status = next;
    const previousToken = publishingConnectionToken;
    publishingConnectionToken = connectionToken;
    try {
      for (const listener of [...listeners]) {
        try { listener(next); } catch { /* isolate observers */ }
        if (connectionToken !== null && (disposed || generation !== expectedGeneration)) break;
      }
    } finally { publishingConnectionToken = previousToken; }
  };
  const current = (owner: OwnerSnapshot) => !disposed && deps.isCurrent(owner) && sameOwner(deps.ownerSnapshot(), owner);
  const physicalCurrent = (owner: OwnerSnapshot) => {
    if (disposed) return false;
    const live = deps.ownerSnapshot();
    return live.networkId === owner.networkId && live.connectionGeneration === owner.connectionGeneration
      && live.physicalRef === owner.physicalRef;
  };
  const retire = (reason: string) => {
    generation++;
    const old = transport;
    transport = null;
    activeIntent = null;
    activeConnectionToken = null;
    activeSink = null;
    activeSinkToken = null;
    const oldWriter = writer;
    writer = null;
    writeChain = Promise.resolve(); queueEpoch = { generation: generation, queuedBytes: 0, queuedLines: 0 };
    if (activeReader) { void activeReader.cancel(reason).catch(() => {}); activeReader = null; }
    try { void oldWriter?.abort(reason).catch(() => {}); } catch { /* writer already closed */ }
    try { oldWriter?.releaseLock(); } catch { /* already released */ }
    try { old?.close({ closeCode: 0, reason: reason.slice(0, MAX_REASON) }); } catch { /* closing */ }
  };

  const read = async (stream: ReadableStream<Uint8Array>, req: TransportConnectIntent, ownGeneration: number, connectionToken: symbol) => {
    const { owner } = req;
    const reader = stream.getReader();
    activeReader = reader;
    let pending = new Uint8Array(0);
    const retireStalePhysicalBinding = () => {
      if (generation !== ownGeneration || physicalCurrent(owner)) return false;
      retire('physical owner changed');
      // This reader belongs to the retired physical connection. Do not publish
      // its teardown against the replacement owner or ask that owner to fall back.
      return true;
    };
    try {
      while (physicalCurrent(owner) && generation === ownGeneration) {
        const { value, done } = await reader.read();
        if (generation !== ownGeneration) break;
        if (retireStalePhysicalBinding()) break;
        if (done) {
          if (pending.byteLength) throw new Error('Truncated IRC bridge line');
          const currentIntent = activeIntent;
          retire('bridge stream ended');
          const terminalGeneration = generation;
          const offlineOwner = deps.ownerSnapshot();
          const offline: TransportStatus = { owner: offlineOwner, endpoint: req.endpoint, state: 'offline', reason: 'connect-failed', fallbackAvailable: true };
          publish(offline, connectionToken, terminalGeneration);
          if (!disposed && generation === terminalGeneration && activeConnectionToken === null && currentIntent) {
            deps.onFallbackRequired?.(offline, { ...currentIntent, owner: offlineOwner });
          }
          break;
        }
        if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
        if (pending.byteLength + value.byteLength > maxBufferBytes) throw new Error('IRC bridge buffer limit exceeded');
        const combined = new Uint8Array(pending.byteLength + value.byteLength);
        combined.set(pending); combined.set(value, pending.byteLength);
        let start = 0;
        for (let i = 0; i < combined.byteLength; i++) {
          if (combined[i] !== 10) continue;
          if (i === 0 || combined[i - 1] !== 13) throw new Error('IRC bridge requires CRLF framing');
          const end = i > start && combined[i - 1] === 13 ? i - 1 : i;
          if (end - start > maxLineBytes) throw new Error('IRC bridge line limit exceeded');
          const line = decoder.decode(combined.subarray(start, end));
          if (CONTROL.test(line)) throw new Error('Invalid IRC bridge line');
          if (generation !== ownGeneration) return;
          if (retireStalePhysicalBinding()) return;
          const currentOwner = deps.ownerSnapshot();
          if (!deps.isCurrent(currentOwner)) return;
          if (activeSink) activeSink.line(line); else deps.onLine?.(line, currentOwner);
          if (generation !== ownGeneration || retireStalePhysicalBinding()) return;
          start = i + 1;
        }
        pending = combined.slice(start);
        if (pending.byteLength > maxLineBytes) throw new Error('IRC bridge line limit exceeded');
      }
      if (generation === ownGeneration && !physicalCurrent(owner)) retireStalePhysicalBinding();
      if (pending.byteLength && generation === ownGeneration) throw new Error('Truncated IRC bridge line');
    } finally { try { await reader.cancel(); } catch { /* closed */ } reader.releaseLock(); if (activeReader === reader) activeReader = null; }
  };

  const connectAttempt = async (req: TransportConnectIntent, connectionToken: symbol): Promise<TransportStatus> => {
    if (disposed || !current(req.owner)) return { owner: req.owner, endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true };
    retire('replace connection');
    const generationAtStart = generation;
    activeIntent = req;
    activeConnectionToken = connectionToken;
    const attemptCurrent = () => !disposed && generation === generationAtStart && activeConnectionToken === connectionToken
      && activeIntent?.requestId === req.requestId && physicalCurrent(req.owner) && current(activeIntent.owner);
    const parsed = (() => { try { return new URL(req.url); } catch { return null; } })();
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !deps.isTrustedWebTransportUrl(parsed, req.endpoint)) {
      const invalid: TransportStatus = { owner: req.owner, endpoint: req.endpoint, state: 'failed', reason: 'invalid-url', fallbackAvailable: true };
      publish(invalid, connectionToken);
      if (attemptCurrent()) deps.onFallbackRequired?.(invalid, req);
      return invalid;
    }
    if (typeof WebTransport === 'undefined' && !deps.createConnection) {
      const unsupported: TransportStatus = { owner: req.owner, endpoint: req.endpoint, state: 'unsupported', reason: 'api-unavailable', fallbackAvailable: true };
      publish(unsupported, connectionToken);
      if (attemptCurrent()) deps.onFallbackRequired?.(unsupported, req);
      return unsupported;
    }
      publish({ owner: req.owner, endpoint: req.endpoint, state: 'connecting', reason: null, fallbackAvailable: true }, connectionToken, generationAtStart);
    if (!attemptCurrent()) return { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true };
    try {
      const connection = makeTransport(parsed.href);
      if (!attemptCurrent()) {
        try { connection.close({ closeCode: 0, reason: 'connection superseded' }); } catch { /* stale local connection */ }
        return { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true };
      }
      transport = connection;
      const handleClosed = () => {
        if (!attemptCurrent()) return;
        const currentIntent = activeIntent;
        retire('bridge closed');
        const terminalGeneration = generation;
        const offline: TransportStatus = { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'offline', reason: 'connect-failed', fallbackAvailable: true };
        publish(offline, connectionToken, terminalGeneration);
        if (!disposed && generation === terminalGeneration && activeConnectionToken === null && currentIntent) {
          deps.onFallbackRequired?.(offline, { ...currentIntent, owner: offline.owner });
        }
      };
      const closedOutcome = connection.closed.then(handleClosed, handleClosed);
      void closedOutcome;
      await waitBounded(connection.ready, 10_000);
      if (!attemptCurrent()) { connection.close({ closeCode: 0, reason: 'owner changed' }); return { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true }; }
      let streamReceived = false;
      const streamPromise = connection.createBidirectionalStream();
      const cancelLate = (late: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }) => {
        if (streamReceived) return;
        void late.readable.cancel('stream arrived after cancellation').catch(() => {});
        void late.writable.abort('stream arrived after cancellation').catch(() => {});
      };
      const stream = await waitBounded(streamPromise, 10_000, cancelLate);
      streamReceived = true;
      if (!attemptCurrent()) { connection.close({ closeCode: 0, reason: 'owner changed' }); void stream.readable.cancel('owner changed').catch(() => {}); void stream.writable.abort('owner changed').catch(() => {}); return { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true }; }
      writer = stream.writable.getWriter();
      const ready: TransportStatus = { owner: activeIntent.owner, endpoint: req.endpoint, state: 'ready', reason: 'bridge-policy-unknown', fallbackAvailable: true };
      publish(ready, connectionToken, generationAtStart);
      if (!attemptCurrent() || transport !== connection || !writer) {
        connection.close({ closeCode: 0, reason: 'connection superseded' });
        void stream.readable.cancel('connection superseded').catch(() => {});
        void stream.writable.abort('connection superseded').catch(() => {});
        return { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true };
      }
      void read(stream.readable, req, generationAtStart, connectionToken).catch(() => {
      if (!attemptCurrent()) return;
      const currentIntent = activeIntent;
        retire('bridge stream failed');
        const terminalGeneration = generation;
        const currentOwner = deps.ownerSnapshot();
        const failed: TransportStatus = { owner: currentOwner, endpoint: req.endpoint, state: 'failed', reason: 'connect-failed', fallbackAvailable: true };
        publish(failed, connectionToken, terminalGeneration);
        if (!disposed && generation === terminalGeneration && activeConnectionToken === null && currentIntent) {
          deps.onFallbackRequired?.(failed, { ...currentIntent, owner: currentOwner });
        }
      });
      return ready;
    } catch {
      const currentIntent = activeIntent;
      if (!attemptCurrent() || !currentIntent) return { owner: deps.ownerSnapshot(), endpoint: req.endpoint, state: 'failed', reason: 'owner-changed', fallbackAvailable: true };
      retire('connect failed');
      const terminalGeneration = generation;
      const currentOwner = deps.ownerSnapshot();
      const failed: TransportStatus = { owner: currentOwner, endpoint: req.endpoint, state: 'failed', reason: 'connect-failed', fallbackAvailable: true };
      publish(failed, connectionToken, terminalGeneration);
      if (!disposed && generation === terminalGeneration && activeConnectionToken === null) {
        deps.onFallbackRequired?.(failed, { ...currentIntent, owner: currentOwner });
      }
      return failed;
    }
  };
  const connect = (req: TransportConnectIntent): Promise<TransportStatus> => connectAttempt(req, Symbol('webtransport-connection'));

  const sendLine = (intent: { readonly line: string; readonly requestId: RequestId; readonly owner: OwnerSnapshot }): SendAdmission => {
    const binding = activeIntent;
    if (!current(intent.owner) || !binding || !sameOwner(binding.owner, intent.owner) || !physicalCurrent(binding.owner)) {
      return { kind: 'blocked', reason: 'owner-changed' };
    }
    if (status.state !== 'ready' || !writer) return { kind: 'blocked', reason: 'offline' };
    if (CONTROL.test(intent.line) || !intent.line || encoder.encode(intent.line).byteLength > maxLineBytes) return { kind: 'blocked', reason: 'invalid-intent' };
    const activeWriter = writer;
    const activeGeneration = generation;
    const bindingOwner = binding.owner;
    const lineBytes = encoder.encode(`${intent.line}\r\n`);
    const activeQueue = queueEpoch;
    const desired = activeWriter.desiredSize;
    if ((desired !== null && desired <= 0) || activeQueue.queuedLines >= 64 || activeQueue.queuedBytes + lineBytes.byteLength > maxBufferBytes) return { kind: 'blocked', reason: 'backpressure' };
    activeQueue.queuedLines++; activeQueue.queuedBytes += lineBytes.byteLength;
    writeChain = writeChain.then(async () => {
      const writerStillBound = () => activeWriter === writer && activeGeneration === generation
        && status.state === 'ready' && activeIntent !== null && sameOwner(activeIntent.owner, bindingOwner)
        && current(bindingOwner) && physicalCurrent(bindingOwner);
      if (!writerStillBound()) throw new Error('stale writer');
      await activeWriter.ready;
      if (!writerStillBound()) throw new Error('stale writer');
      await activeWriter.write(lineBytes);
    }).catch(() => {
      // Rebinding invalidates queued writes admitted under the prior full
      // owner. Drop them without retiring the still-live physical driver.
      if (activeWriter === writer && activeGeneration === generation && activeIntent !== null
        && sameOwner(activeIntent.owner, bindingOwner) && current(bindingOwner) && physicalCurrent(bindingOwner)) {
        const fallbackIntent = activeIntent;
        const connectionToken = activeConnectionToken;
        retire('write failed');
        const terminalGeneration = generation;
        const failed: TransportStatus = { owner: bindingOwner, endpoint: status.endpoint, state: 'failed', reason: 'connect-failed', fallbackAvailable: true };
        publish(failed, connectionToken, terminalGeneration);
        if (!disposed && generation === terminalGeneration && activeConnectionToken === null
          && fallbackIntent && physicalCurrent(fallbackIntent.owner)) {
          deps.onFallbackRequired?.(failed, { ...fallbackIntent, owner: deps.ownerSnapshot() });
        }
      }
    }).finally(() => { activeQueue.queuedLines = Math.max(0, activeQueue.queuedLines - 1); activeQueue.queuedBytes = Math.max(0, activeQueue.queuedBytes - lineBytes.byteLength); });
    return { kind: 'transport-admitted' };
  };

  const open = (req: TransportConnectIntent, sink: { opened(): void; line(value: string): void; closed(): void }) => {
    const sinkToken = Symbol('webtransport-sink');
    let opened = false;
    let sinkClosed = false;
    let closed = false;
    const statusListener = (next: TransportStatus) => {
      if (publishingConnectionToken !== sinkToken || closed) return;
      if (next.state === 'ready' && !opened && !sinkClosed) { opened = true; sink.opened(); }
      else if ((next.state === 'offline' || next.state === 'failed' || next.state === 'unsupported') && !sinkClosed) { sinkClosed = true; sink.closed(); }
    };
    listeners.add(statusListener);
    const unsubscribe = () => listeners.delete(statusListener);
    void connectAttempt(req, sinkToken);
    if (activeConnectionToken === sinkToken && activeIntent?.requestId === req.requestId && status.state === 'connecting' && current(req.owner)) {
      activeSink = sink;
      activeSinkToken = sinkToken;
    }
    return {
      sendLine(intent: { readonly line: string; readonly requestId: RequestId; readonly owner: OwnerSnapshot }) {
        if (closed || activeSink !== sink || activeSinkToken !== sinkToken || activeIntent?.requestId !== req.requestId
          || !activeIntent || !sameOwner(intent.owner, activeIntent.owner)) {
          return { kind: 'blocked', reason: 'owner-changed' } as const;
        }
        return sendLine(intent);
      },
      isOpen() {
        const binding = activeIntent;
        return !closed && activeSink === sink && activeSinkToken === sinkToken && status.state === 'ready' && !!binding
          && current(binding.owner) && physicalCurrent(binding.owner);
      },
      close() {
        if (closed) return;
        closed = true; unsubscribe();
        if (activeSink !== sink || activeSinkToken !== sinkToken || activeIntent?.requestId !== req.requestId) return;
        activeSink = null;
        activeSinkToken = null;
        const bindingStillPhysical = !!activeIntent && physicalCurrent(activeIntent.owner);
        retire('transport owner retired');
        if (bindingStillPhysical) publish({ owner: deps.ownerSnapshot(), endpoint: status.endpoint, state: 'offline', reason: null, fallbackAvailable: true });
      },
    };
  };

  const rebindOwner = (previous: OwnerSnapshot, next: OwnerSnapshot): boolean => {
    if (disposed || (status.state !== 'ready' && status.state !== 'connecting') || !transport || !activeIntent
      || !sameOwner(activeIntent.owner, previous) || !samePhysicalBinding(previous, next)
      || !deps.isCurrent(next) || !sameOwner(deps.ownerSnapshot(), next)) return false;
    activeIntent = { ...activeIntent, owner: next };
    publish({ ...status, owner: next });
    return true;
  };

  return {
    connect,
    open,
    rebindOwner,
    sendLine,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close(reason) { retire(reason); publish({ owner: deps.ownerSnapshot(), endpoint: status.endpoint, state: 'offline', reason: null, fallbackAvailable: true }); },
    dispose() { if (disposed) return; disposed = true; retire('disposed'); listeners.clear(); },
  };
}
