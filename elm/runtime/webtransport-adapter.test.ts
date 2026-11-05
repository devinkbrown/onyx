import { describe, expect, it } from 'vitest';
import { createWebTransportAdapter, type WebTransportLike } from './webtransport-adapter';
import { makeAccountGeneration, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeRequestId, type OwnerSnapshot } from './contracts';

describe('WebTransport driver bridge', () => {
  it('carries CRLF ingress and validated IRC writes through the connected stream', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('custom:https://transport.test/irc')!, accountId: null,
      accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    const readableController: { current: ReadableStreamDefaultController<Uint8Array> | null } = { current: null };
    const writes: string[] = [];
    const encoder = new TextEncoder();
    const connection: WebTransportLike = {
      ready: Promise.resolve(), closed: new Promise(() => {}),
      async createBidirectionalStream() {
        return {
          readable: new ReadableStream<Uint8Array>({ start(value) { readableController.current = value; } }),
          writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(new TextDecoder().decode(bytes)); } }),
        };
      }, close() {},
    };
    const adapter = createWebTransportAdapter({
      ownerSnapshot: () => owner, isCurrent: () => true,
      createConnection: () => connection, fallbackWss: async () => {},
      isTrustedWebTransportUrl: () => true,
    });
    let opened!: () => void;
    const isOpened = new Promise<void>(resolve => { opened = resolve; });
    let gotLine!: (value: string) => void;
    const linePromise = new Promise<string>(resolve => { gotLine = resolve; });
    const req = { schemaVersion: 1 as const, requestId: makeRequestId('abcdefghijklmnopqrstuv')!, owner, url: 'https://transport.test/bridge', endpoint: 'fixture-endpoint' as never };
    const driver = adapter.open(req, { opened, line: gotLine, closed() {} });
    await isOpened;
    readableController.current?.enqueue(encoder.encode(':irc.transport.test 001 alice :welcome\r\n'));
    await expect(linePromise).resolves.toBe(':irc.transport.test 001 alice :welcome');
    const commandRequestId = makeRequestId('command-request-abcdefghijkl')!;
    expect(commandRequestId).not.toBe(req.requestId);
    expect(driver.sendLine({ line: 'PING :probe', requestId: commandRequestId, owner })).toEqual({ kind: 'transport-admitted' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(writes).toEqual(['PING :probe\r\n']);
    driver.close();
    adapter.dispose();
  });

  it('rebinds a live same-physical driver to the proven owner and rejects late bytes after physical change', async () => {
    const makeOwner = (ownerRef: string, accountGeneration: number, physical = '0123456789abcdef0123456789abcdef'): OwnerSnapshot => ({
      networkId: makeNetworkId('custom:https://transport.test/irc')!, accountId: accountGeneration ? 'alice' as OwnerSnapshot['accountId'] : null,
      accountGeneration: makeAccountGeneration(accountGeneration)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch(physical)!, ownerRef: makeOwnerRef(ownerRef)!,
    });
    let liveOwner = makeOwner('abcdefghijklmnopqrstuv', 0);
    const readableController: { current: ReadableStreamDefaultController<Uint8Array> | null } = { current: null };
    let resolveReady!: () => void;
    const writes: string[] = [];
    const statuses: Array<{ owner: OwnerSnapshot; state: string }> = [];
    const fallbacks: unknown[] = [];
    const connection: WebTransportLike = {
      ready: new Promise<void>(resolve => { resolveReady = resolve; }), closed: new Promise(() => {}),
      async createBidirectionalStream() {
        return {
          readable: new ReadableStream<Uint8Array>({ start(value) { readableController.current = value; } }),
          writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(new TextDecoder().decode(bytes)); } }),
        };
      }, close() {},
    };
    const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot) => a.ownerRef === b.ownerRef && a.networkId === b.networkId
      && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
      && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef;
    const adapter = createWebTransportAdapter({
      ownerSnapshot: () => liveOwner, isCurrent: candidate => sameOwner(candidate, liveOwner),
      createConnection: () => connection, fallbackWss: async () => {}, isTrustedWebTransportUrl: () => true,
      onFallbackRequired: (...args) => { fallbacks.push(args); },
    });
    adapter.subscribe(next => statuses.push({ owner: next.owner, state: next.state }));
    const prior = liveOwner;
    const requestId = makeRequestId('abcdefghijklmnopqrstuv')!;
    const req = { schemaVersion: 1 as const, requestId, owner: prior, url: 'https://transport.test/bridge', endpoint: 'fixture-endpoint' as never };
    let opened!: () => void;
    let openedCount = 0;
    const isOpened = new Promise<void>(resolve => { opened = resolve; });
    const received: string[] = [];
    const driver = adapter.open(req, { opened() { openedCount++; opened(); }, line(value) { received.push(value); }, closed() {} });
    const proven = makeOwner('bcdefghijklmnopqrstuvw', 1);
    liveOwner = proven;
    expect(adapter.rebindOwner(prior, proven)).toBe(true);
    resolveReady();
    await isOpened;
    expect(adapter.rebindOwner(prior, proven)).toBe(false);
    expect(adapter.sendLine({ line: 'PING :fresh', requestId, owner: prior })).toEqual({ kind: 'blocked', reason: 'owner-changed' });

    expect(driver.sendLine({ line: 'PING :queued-old-owner', requestId, owner: proven })).toEqual({ kind: 'transport-admitted' });
    const rebound = makeOwner('cdefghijklmnopqrstuvwx', 2);
    liveOwner = rebound;
    expect(adapter.rebindOwner(proven, rebound)).toBe(true);
    expect(openedCount).toBe(1);
    expect(driver.sendLine({ line: 'PING :fresh', requestId, owner: rebound })).toEqual({ kind: 'transport-admitted' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(writes).toEqual(['PING :fresh\r\n']);

    liveOwner = makeOwner('cdefghijklmnopqrstuvwx', 1, 'fedcba9876543210fedcba9876543210');
    expect(adapter.rebindOwner(rebound, liveOwner)).toBe(false);
    readableController.current?.enqueue(new TextEncoder().encode(':irc.transport.test 001 alice :stale\r\n'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toEqual([]);
    expect(driver.sendLine({ line: 'PING :stale', requestId, owner: liveOwner })).toEqual({ kind: 'blocked', reason: 'owner-changed' });
    expect(driver.isOpen()).toBe(false);
    expect(writes).toEqual(['PING :fresh\r\n']);
    expect(fallbacks).toEqual([]);
    driver.close();
    expect(statuses.some(next => next.state === 'offline' && sameOwner(next.owner, liveOwner))).toBe(false);
    adapter.dispose();
  });

  it('does not let a retired driver close a replacement transport', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('custom:https://transport.test/irc')!, accountId: null,
      accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    const connections: WebTransportLike[] = [];
    const makeConnection = (): WebTransportLike => ({
      ready: Promise.resolve(), closed: new Promise(() => {}),
      async createBidirectionalStream() {
        return {
          readable: new ReadableStream<Uint8Array>({ start() {} }),
          writable: new WritableStream<Uint8Array>(),
        };
      }, close() {},
    });
    const adapter = createWebTransportAdapter({
      ownerSnapshot: () => owner, isCurrent: () => true,
      createConnection: () => { const connection = makeConnection(); connections.push(connection); return connection; },
      fallbackWss: async () => {}, isTrustedWebTransportUrl: () => true,
    });
    const makeReq = (id: string) => ({ schemaVersion: 1 as const, requestId: makeRequestId(id)!, owner,
      url: 'https://transport.test/bridge', endpoint: 'fixture-endpoint' as never });
    const firstRequest = makeReq('first-request-abcdefghijkl');
    const secondRequest = makeReq('second-request-abcdefghijk');
    let firstOpened!: () => void;
    let secondOpened!: () => void;
    const firstReady = new Promise<void>(resolve => { firstOpened = resolve; });
    const secondReady = new Promise<void>(resolve => { secondOpened = resolve; });
    const first = adapter.open(firstRequest, { opened: firstOpened, line() {}, closed() {} });
    await firstReady;
    const second = adapter.open(secondRequest, { opened: secondOpened, line() {}, closed() {} });
    await secondReady;

    first.close();
    expect(second.isOpen()).toBe(true);
    expect(first.sendLine({ line: 'PING :stale', requestId: secondRequest.requestId, owner })).toEqual({ kind: 'blocked', reason: 'owner-changed' });
    expect(adapter.sendLine({ line: 'PING :replacement', requestId: secondRequest.requestId, owner })).toEqual({ kind: 'transport-admitted' });
    expect(connections).toHaveLength(2);
    second.close();
    adapter.dispose();
  });

  it('does not allocate a superseded connection after a synchronous connecting observer replaces it', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('custom:https://transport.test/irc')!, accountId: null,
      accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    const created: string[] = [];
    const writes: string[] = [];
    const makeConnection = (): WebTransportLike => ({
      ready: Promise.resolve(), closed: new Promise(() => {}),
      async createBidirectionalStream() {
        return { readable: new ReadableStream<Uint8Array>({ start() {} }),
          writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(new TextDecoder().decode(bytes)); } }) };
      }, close() {},
    });
    const reqA = { schemaVersion: 1 as const, requestId: makeRequestId('request-first-abcdefghijkl')!, owner,
      url: 'https://transport.test/first', endpoint: 'first' as never };
    const reqB = { schemaVersion: 1 as const, requestId: makeRequestId('request-second-abcdefghijk')!, owner,
      url: 'https://transport.test/second', endpoint: 'second' as never };
    const adapter = createWebTransportAdapter({ ownerSnapshot: () => owner, isCurrent: () => true,
      createConnection: url => { created.push(url); return makeConnection(); }, fallbackWss: async () => {}, isTrustedWebTransportUrl: () => true });
    let replaced = false;
    adapter.subscribe(next => {
      if (!replaced && next.state === 'connecting' && next.endpoint === reqA.endpoint) {
        replaced = true;
        void adapter.connect(reqB);
      }
    });
    let openedA = 0;
    adapter.open(reqA, { opened() { openedA++; }, line() {}, closed() {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(created).toEqual(['https://transport.test/second']);
    expect(openedA).toBe(0);
    expect(adapter.sendLine({ line: 'PING :replacement', requestId: makeRequestId('command-replacement-abc')!, owner }))
      .toEqual({ kind: 'transport-admitted' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(writes).toEqual(['PING :replacement\r\n']);
    adapter.dispose();
  });

  it('does not report successor readiness to a superseded connecting sink', async () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('custom:https://transport.test/irc')!, accountId: null,
      accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    const readyResolvers = new Map<string, () => void>();
    const makeConnection = (url: string): WebTransportLike => ({
      ready: new Promise<void>(resolve => { readyResolvers.set(url, resolve); }), closed: new Promise(() => {}),
      async createBidirectionalStream() {
        return { readable: new ReadableStream<Uint8Array>({ start() {} }), writable: new WritableStream<Uint8Array>() };
      }, close() {},
    });
    const adapter = createWebTransportAdapter({ ownerSnapshot: () => owner, isCurrent: () => true,
      createConnection: makeConnection, fallbackWss: async () => {}, isTrustedWebTransportUrl: () => true });
    const reqA = { schemaVersion: 1 as const, requestId: makeRequestId('request-first-abcdefghijkl')!, owner,
      url: 'https://transport.test/first', endpoint: 'first' as never };
    const reqB = { schemaVersion: 1 as const, requestId: makeRequestId('request-second-abcdefghijk')!, owner,
      url: 'https://transport.test/second', endpoint: 'second' as never };
    let openedA = 0;
    let openedB = 0;
    const driverA = adapter.open(reqA, { opened() { openedA++; }, line() {}, closed() {} });
    const driverB = adapter.open(reqB, { opened() { openedB++; }, line() {}, closed() {} });
    readyResolvers.get(reqB.url)?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(openedA).toBe(0);
    expect(openedB).toBe(1);
    readyResolvers.get(reqA.url)?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(openedA).toBe(0);
    expect(openedB).toBe(1);
    driverA.close();
    expect(driverB.isOpen()).toBe(true);
    driverB.close();
    adapter.dispose();
  });

  it('does not allocate after a connecting observer disposes the adapter', () => {
    const owner: OwnerSnapshot = {
      networkId: makeNetworkId('custom:https://transport.test/irc')!, accountId: null,
      accountGeneration: makeAccountGeneration(0)!, connectionGeneration: makeConnectionGeneration(1)!,
      physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
    };
    let allocations = 0;
    const adapter = createWebTransportAdapter({ ownerSnapshot: () => owner, isCurrent: () => true,
      createConnection: () => { allocations++; throw new Error('must not allocate'); },
      fallbackWss: async () => {}, isTrustedWebTransportUrl: () => true });
    adapter.subscribe(next => { if (next.state === 'connecting') adapter.dispose(); });
    adapter.connect({ schemaVersion: 1, requestId: makeRequestId('request-dispose-abcdefghijkl')!, owner,
      url: 'https://transport.test/disposed', endpoint: 'disposed' as never });
    expect(allocations).toBe(0);
  });
});
