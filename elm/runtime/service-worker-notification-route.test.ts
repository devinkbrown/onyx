import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type RequestStub = { result?: unknown; onsuccess?: () => void; onerror?: () => void; error?: Error };
type StoredStub = { key: string; route?: Record<string, unknown>; binding?: Record<string, unknown> };

function makeWorker(now: { value: number }) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const workerSettings = new Map<string, StoredStub>();
  const bindings = new Map<string, StoredStub>();
  const windowClients: Array<Record<string, unknown>> = [];
  const rowsByStore = new Map<string, Map<string, StoredStub>>([
    ['worker_settings', workerSettings], ['push_bindings', bindings], ['reconcile_tasks', new Map<string, StoredStub>()],
  ]);
  const database = {
    close() {},
    transaction(names: string | string[]) {
      const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: (name: string) => unknown; abort: () => void } = {
        objectStore(name) {
          const rows = rowsByStore.get(name)!;
          const request = (read: () => unknown): RequestStub => {
            const result: RequestStub = {};
            setTimeout(() => { result.result = read(); result.onsuccess?.(); setTimeout(() => tx.oncomplete?.(), 0); }, 0);
            return result;
          };
          return {
            getAll: () => request(() => [...rows.values()]),
            get: (key: string) => request(() => rows.get(key)),
            openCursor: () => {
              const cursorRequest: RequestStub & { result?: { key: string; value: StoredStub; continue: () => void } | null } = {};
              const values = [...rows.values()]; let index = 0;
              const advance = (): void => { setTimeout(() => {
                if (index >= values.length) {
                  cursorRequest.result = null; cursorRequest.onsuccess?.(); setTimeout(() => tx.oncomplete?.(), 0); return;
                }
                const value = values[index++]!;
                cursorRequest.result = { key: value.key, value, continue: advance };
                cursorRequest.onsuccess?.();
              }, 0); };
              advance(); return cursorRequest;
            },
            put: (row: { key: string }) => { rows.set(row.key, row); },
            delete: (key: string) => { rows.delete(key); },
          };
        },
        abort() { tx.onabort?.(); },
      };
      return tx;
    },
  };
  const indexedDB = { open() {
    const request: RequestStub & { onupgradeneeded?: () => void; onblocked?: () => void } = {};
    setTimeout(() => { request.result = database; request.onsuccess?.(); }, 0);
    return request;
  } };
  const self = {
    location: { origin: 'https://app.example' },
    addEventListener(name: string, listener: (event: Record<string, unknown>) => void) { handlers.set(name, listener); },
    clients: {
      async matchAll() { return windowClients; }, async openWindow(url: string) { return { url }; },
      async claim() {},
    },
    registration: { async showNotification() {}, pushManager: { async getSubscription() { return null; } } },
    async skipWaiting() {},
  };
  const source = readFile(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');
  return source.then((text) => {
    const build = { shellRef: 'a'.repeat(64), buildCompatibility: { buildId: 'b'.repeat(32), protocolVersion: 1,
      storageSchemas: { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 },
      shellAssets: [{ path: '/app/', sha256: 'c'.repeat(64) }], publicNavigationPaths: ['/app/'] } };
    const code = text.replace('__ONYX_SW_BUILD_CONFIG__', JSON.stringify(build));
    runInNewContext(code, { self, indexedDB, crypto: globalThis.crypto, URL, TextEncoder, Response, Request, Date: class extends Date { static override now() { return now.value; } }, setTimeout, clearTimeout, caches: { async open() { return { async put() {} }; } }, fetch: async () => new Response('') });
    return { handlers, workerSettings, bindings, windowClients, self };
  });
}

function message(worker: Awaited<ReturnType<typeof makeWorker>>, data: Record<string, unknown>, clientId = 'client-a') {
  let reply: Record<string, unknown> | null = null;
  const client = { id: clientId, type: 'window', url: 'https://app.example/app/' };
  const port = { postMessage(value: Record<string, unknown>) { reply = value; }, close() {} };
  let work: Promise<void> | undefined;
  worker.handlers.get('message')!({ data: { schemaVersion: 1, ...data }, source: client, ports: [port], waitUntil(value: Promise<void>) { work = value; } });
  return Promise.resolve(work).then(() => reply);
}

describe('service worker pending notification route claims', () => {
  it('retains a pending route after claim expiry and fences stale claims', async () => {
    const now = { value: 1000 };
    const worker = await makeWorker(now);
    worker.bindings.set('binding-row', { key: 'binding-row', binding: { schemaVersion: 1, ownerRef: 'owner-a',
      networkId: 'network-a', accountId: 'alice', node: 'node-a', endpointRef: '11111111-1111-4111-8111-111111111111',
      endpointSha256: 'd'.repeat(64), vapidSha256: 'e'.repeat(64), explicitIntent: true, previewPolicy: 'private', serverState: 'registered' } });
    let clickWork: Promise<void> | undefined;
    worker.handlers.get('notificationclick')!({ notification: { close() {}, data: { schemaVersion: 1, route: {
      schemaVersion: 1, networkId: 'network-a', accountId: 'alice', bindingRef: '11111111-1111-4111-8111-111111111111',
      kind: 'dm', conversationId: 'bob',
    } } }, waitUntil(value: Promise<void>) { clickWork = value; } });
    await clickWork;
    const first = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'request-1', networkId: 'network-a', accountId: 'alice' });
    expect(first).toMatchObject({ type: 'NOTIFICATION_ROUTE_CLAIM_RESULT', status: 'claimed' });
    const firstRoute = (first as { route: { routeRef: string; claimRef: string } }).route;
    now.value += 30_001;
    const second = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'request-2', networkId: 'network-a', accountId: 'alice' }, 'client-b');
    expect(second).toMatchObject({ status: 'claimed' });
    const secondRoute = (second as { route: { routeRef: string; claimRef: string } }).route;
    expect(secondRoute.routeRef).toBe(firstRoute.routeRef);
    expect(secondRoute.claimRef).not.toBe(firstRoute.claimRef);
    const stale = await message(worker, { type: 'SETTLE_NOTIFICATION_ROUTE', requestId: 'request-3', routeRef: firstRoute.routeRef,
      claimRef: firstRoute.claimRef, outcome: 'opened' });
    expect(stale).toMatchObject({ status: 'stale' });
    expect(worker.workerSettings.has(`notification-route:${firstRoute.routeRef}`)).toBe(true);
    const settled = await message(worker, { type: 'SETTLE_NOTIFICATION_ROUTE', requestId: 'request-4', routeRef: secondRoute.routeRef,
      claimRef: secondRoute.claimRef, outcome: 'opened' }, 'client-b');
    expect(settled).toMatchObject({ status: 'settled' });
    expect(worker.workerSettings.has(`notification-route:${firstRoute.routeRef}`)).toBe(false);
  });

  it('does not expose an expired account claim to another account before reclaiming it for its owner', async () => {
    const now = { value: 1000 };
    const worker = await makeWorker(now);
    worker.bindings.set('binding-row', { key: 'binding-row', binding: { schemaVersion: 1, ownerRef: 'owner-a',
      networkId: 'network-a', accountId: 'alice', node: 'node-a', endpointRef: '11111111-1111-4111-8111-111111111111',
      endpointSha256: 'd'.repeat(64), vapidSha256: 'e'.repeat(64), explicitIntent: true, previewPolicy: 'private', serverState: 'registered' } });
    let clickWork: Promise<void> | undefined;
    worker.handlers.get('notificationclick')!({ notification: { close() {}, data: { schemaVersion: 1, route: {
      schemaVersion: 1, networkId: 'network-a', accountId: 'alice', bindingRef: '11111111-1111-4111-8111-111111111111',
      kind: 'dm', conversationId: 'bob',
    } } }, waitUntil(value: Promise<void>) { clickWork = value; } });
    await clickWork;
    const first = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'owner-first', networkId: 'network-a', accountId: 'alice' }, 'client-a');
    const firstRoute = (first as { route: { routeRef: string; claimRef: string } }).route;
    now.value += 30_001;

    const otherAccount = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'other-account', networkId: 'network-b', accountId: 'mallory' }, 'client-b');
    expect(otherAccount).toMatchObject({ status: 'empty', route: null });
    expect(worker.workerSettings.has(`notification-route:${firstRoute.routeRef}`)).toBe(true);

    const ownerAgain = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'owner-again', networkId: 'network-a', accountId: 'alice' }, 'client-c');
    expect(ownerAgain).toMatchObject({ status: 'claimed', route: { routeRef: firstRoute.routeRef, networkId: 'network-a', accountId: 'alice' } });
    expect((ownerAgain as { route: { claimRef: string } }).route.claimRef).not.toBe(firstRoute.claimRef);
  });

  it('prunes an expired route and returns empty instead of claiming it', async () => {
    const now = { value: 1000 };
    const worker = await makeWorker(now);
    let clickWork: Promise<void> | undefined;
    worker.handlers.get('notificationclick')!({ notification: { close() {}, data: { schemaVersion: 1, route: { schemaVersion: 1, kind: 'inbox' } } },
      waitUntil(value: Promise<void>) { clickWork = value; } });
    await clickWork;
    const routeKey = [...worker.workerSettings.keys()][0]!;
    now.value += 10 * 60_000 + 1;
    const result = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'request-expired', networkId: 'network-a', accountId: null });
    expect(result).toMatchObject({ status: 'empty', route: null });
    expect(worker.workerSettings.has(routeKey)).toBe(false);
  });

  it('keeps a same-origin app client with startup query eligible without trusting the query', async () => {
    const now = { value: 1000 };
    const worker = await makeWorker(now);
    let focused = false;
    const messages: unknown[] = [];
    worker.windowClients.push({ id: 'query-client', type: 'window', url: 'https://app.example/app/?ws=wss%3A%2F%2Firc.example%2Fws',
      postMessage(value: unknown) { messages.push(value); }, async focus() { focused = true; } });
    worker.bindings.set('binding-row', { key: 'binding-row', binding: { schemaVersion: 1, ownerRef: 'owner-a',
      networkId: 'network-a', accountId: 'alice', node: 'node-a', endpointRef: '11111111-1111-4111-8111-111111111111',
      endpointSha256: 'd'.repeat(64), vapidSha256: 'e'.repeat(64), explicitIntent: true, previewPolicy: 'private', serverState: 'registered' } });
    let work: Promise<void> | undefined;
    worker.handlers.get('notificationclick')!({ notification: { close() {}, data: { schemaVersion: 1, route: {
      schemaVersion: 1, networkId: 'network-a', accountId: 'alice', bindingRef: '11111111-1111-4111-8111-111111111111',
      kind: 'dm', conversationId: 'bob',
    } } }, waitUntil(value: Promise<void>) { work = value; } });
    await work;
    expect(focused).toBe(true);
    expect(messages).toEqual([expect.objectContaining({ schemaVersion: 1, type: 'PENDING_NOTIFICATION_ROUTE', routeRef: expect.any(String) })]);
    const key = [...worker.workerSettings.keys()][0]!;
    expect(key).toMatch(/^notification-route:/u);
    const wrongNetwork = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'wrong-network', networkId: 'other-network', accountId: 'alice' }, 'query-client');
    expect(wrongNetwork).toMatchObject({ status: 'empty', route: null });
    const exact = await message(worker, { type: 'CLAIM_NOTIFICATION_ROUTE', requestId: 'exact-network', networkId: 'network-a', accountId: 'alice' }, 'query-client');
    expect(exact).toMatchObject({ status: 'claimed', route: { networkId: 'network-a', accountId: 'alice' } });
  });
});
