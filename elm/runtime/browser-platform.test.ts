import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createBrowserPlatform, loadBrowserBuildCompatibility } from './browser-platform';
import { makeAccountGeneration, makeAccountId, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, makeOwnerSnapshot, makeRequestId } from './contracts';

const compatibility = {
  buildId: 'a'.repeat(32), protocolVersion: 1,
  storageSchemas: { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 },
  shellAssets: [{ path: '/app/', sha256: 'b'.repeat(64) }], publicNavigationPaths: ['/app/'],
};

describe('browser build compatibility loading', () => {
  it('accepts the exact same-origin sidecar only when index and runtime shell refs agree', async () => {
    const shellRef = 'c'.repeat(64);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ shellRef, buildCompatibility: compatibility }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    expect(await loadBrowserBuildCompatibility({ fetch: fetcher as typeof fetch, origin: 'https://app.example', expectedShellRef: shellRef, runtimeShellRef: shellRef })).toEqual(compatibility);
    expect(fetcher).toHaveBeenCalledWith('https://app.example/runtime-build.json', expect.objectContaining({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' }));
  });

  it('rejects duplicate keys, foreign origins, oversized metadata, unknown fields and shell mismatches', async () => {
    const shellRef = 'c'.repeat(64);
    const response = (text: string) => vi.fn(async () => new Response(text, { status: 200 }));
    expect(await loadBrowserBuildCompatibility({ fetch: response('{"shellRef":"x","shellRef":"y","buildCompatibility":{}}') as typeof fetch,
      origin: 'https://app.example', expectedShellRef: shellRef, runtimeShellRef: shellRef })).toBeNull();
    expect(await loadBrowserBuildCompatibility({ fetch: response(JSON.stringify({ shellRef, buildCompatibility: { ...compatibility, debug: true } })) as typeof fetch,
      origin: 'https://app.example', expectedShellRef: shellRef, runtimeShellRef: shellRef })).toBeNull();
    expect(await loadBrowserBuildCompatibility({ fetch: response(JSON.stringify({ shellRef: 'd'.repeat(64), buildCompatibility: compatibility })) as typeof fetch,
      origin: 'https://app.example', expectedShellRef: shellRef, runtimeShellRef: shellRef })).toBeNull();
    expect(await loadBrowserBuildCompatibility({ fetch: response(' '.repeat(1024 * 1024 + 1)) as typeof fetch,
      origin: 'https://app.example', expectedShellRef: shellRef, runtimeShellRef: shellRef })).toBeNull();
    expect(await loadBrowserBuildCompatibility({ fetch: response('{}') as typeof fetch,
      origin: 'https://app.example', expectedShellRef: shellRef, runtimeShellRef: 'e'.repeat(64) })).toBeNull();
  });

  it('bounds the response body read and cancels a stream that never finishes', async () => {
    const shellRef = 'c'.repeat(64);
    const cancelled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), { status: 200 }));
    vi.useFakeTimers();
    try {
      const pending = loadBrowserBuildCompatibility({ fetch: fetcher as typeof fetch, origin: 'https://app.example',
        expectedShellRef: shellRef, runtimeShellRef: shellRef });
      await vi.advanceTimersByTimeAsync(2501);
      await expect(pending).resolves.toBeNull();
      expect(cancelled).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('roundtrips the shell reference through the real index template DOM and runtime marker', async () => {
    const shellRef = 'f'.repeat(64);
    const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    expect(template).toContain('getCurrentOwner: function () { return runtime ? runtime.ownerSnapshot()');
    expect(template).toContain('isCurrent: function (owner) { return !!runtime && runtime.isCurrent(owner); }');
    expect(template).not.toContain('physicalRef: null, ownerRef: state.ownerRef');
    expect(template.split('__ONYX_PUBLIC_INDEX_SHELL_REF__')).toHaveLength(2);
    const stampedIndex = template.replace('__ONYX_PUBLIC_INDEX_SHELL_REF__', shellRef);
    const parsed = new JSDOM(stampedIndex).window.document;
    expect(parsed.querySelector('meta[name="onyx-shell-ref"]')?.getAttribute('content')).toBe(shellRef);
    const runtimeTemplate = await readFile(new URL('./browser-entry.ts', import.meta.url), 'utf8');
    expect(runtimeTemplate).toContain("shellRef: '__ONYX_PUBLIC_RUNTIME_SHELL_REF__'");
    expect(runtimeTemplate.replace('__ONYX_PUBLIC_RUNTIME_SHELL_REF__', shellRef)).toContain(`shellRef: '${shellRef}'`);
    const sidecar = { shellRef, buildCompatibility: compatibility };
    expect(sidecar.shellRef).toBe(parsed.querySelector('meta[name="onyx-shell-ref"]')?.getAttribute('content'));
  });

  it('uses the exact full physical owner for notification claims and update freeze', async () => {
    const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://app.example/app/' });
    dom.window.document.getElementById('app')!.inert = false;
    dom.window.document.getElementById('app')!.inert = false;
    const makeOwner = (physicalByte: 'a' | 'b') => makeOwnerSnapshot({ networkId: makeNetworkId('network-a'), accountId: makeAccountId('alice'),
      accountGeneration: makeAccountGeneration(2), connectionGeneration: makeConnectionGeneration(3),
      physicalRef: makeLocalPhysicalEpoch(physicalByte.repeat(32)), ownerRef: makeOwnerRef('owner-abcdefghijklmnopqrstuv')! })!;
    let current = makeOwner('a');
    let posts = 0;
    class FakeMessageChannel {
      port1: { onmessage: ((event: { data: unknown }) => void) | null; close: () => void };
      port2: { onmessage: ((event: { data: unknown }) => void) | null; close: () => void; postMessage: (value: unknown) => void };
      constructor() {
        this.port1 = { onmessage: null, close() {} };
        this.port2 = { onmessage: null, close() {}, postMessage: (value) => this.port1.onmessage?.({ data: value }) };
      }
    }
    const controller = { postMessage(value: { requestId: string }, ports: Array<{ postMessage: (message: unknown) => void }>) {
      posts += 1;
      queueMicrotask(() => ports[0]?.postMessage({ schemaVersion: 1, type: 'NOTIFICATION_ROUTE_CLAIM_RESULT', requestId: value.requestId,
        status: 'claimed', route: { schemaVersion: 1, routeRef: '11111111-1111-4111-8111-111111111111',
          claimRef: '22222222-2222-4222-8222-222222222222', networkId: 'network-a', accountId: 'alice',
          bindingRef: '33333333-3333-4333-8333-333333333333', kind: 'dm', conversationId: 'bob', createdAtMs: 1, expiresAtMs: 60_001 } }));
    } };
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', { serviceWorker: { controller } });
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    const owner = makeOwner('a');
    const context = { schemaVersion: 1 as const, requestId: makeRequestId('request-abcdefghijklmnopqrstuv')!, owner };
    const platform = createBrowserPlatform({ serviceWorker: { controller } as unknown as ServiceWorkerContainer,
      applicationOrigin: 'https://app.example', allowedPaths: ['/app/'], getCurrentOwner: () => current,
      isCurrent: (candidate) => candidate.networkId === current.networkId && candidate.accountId === current.accountId
        && candidate.accountGeneration === current.accountGeneration && candidate.connectionGeneration === current.connectionGeneration
        && candidate.physicalRef === current.physicalRef && candidate.ownerRef === current.ownerRef, now: () => 100 });
    try {
      await expect(platform.claimNotificationRoute(context)).resolves.toMatchObject({ networkId: 'network-a', accountId: 'alice' });
      const release = platform.freezeAuthoring('a'.repeat(32), context.requestId, owner);
      expect(release).toBeTypeOf('function');
      expect(dom.window.document.getElementById('app')?.inert).toBe(true);
      expect(dom.window.document.getElementById('onyx-platform-update-status')?.parentElement).toBe(dom.window.document.body);
      release?.();
      expect(dom.window.document.getElementById('app')?.inert).toBe(false);
      expect(dom.window.document.getElementById('onyx-platform-update-status')).toBeNull();

      dom.window.document.getElementById('app')!.inert = true;
      const releaseInertRoot = platform.freezeAuthoring('b'.repeat(32), makeRequestId('next-request-abcdefghijkl')!, current);
      expect(releaseInertRoot).toBeTypeOf('function');
      releaseInertRoot?.();
      expect(dom.window.document.getElementById('app')?.inert).toBe(true);

      current = makeOwner('b');
      await expect(platform.claimNotificationRoute(context)).resolves.toBeNull();
      expect(platform.freezeAuthoring('a'.repeat(32), context.requestId, owner)).toBeNull();
      expect(posts).toBe(1);
    } finally {
      platform.dispose();
      vi.unstubAllGlobals();
      dom.window.close();
    }
  });
});
