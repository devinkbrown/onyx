import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The pre-November worker cached every same-origin GET cache-first under
// `onyx-shell-*` and never yielded, so returning visitors kept the old site.
async function makeWorker(initialCaches: string[]) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const store = new Map<string, Map<string, Response>>(initialCaches.map((key) => [key, new Map()]));
  const caches = {
    async keys() { return [...store.keys()]; },
    async open(key: string) {
      if (!store.has(key)) store.set(key, new Map());
      const entries = store.get(key)!;
      return { async put(url: string, response: Response) { entries.set(url, response); }, async match(url: string) { return entries.get(url); } };
    },
    async delete(key: string) { return store.delete(key); },
  };
  const asset = new TextEncoder().encode('<!doctype html><title>app</title>');
  const build = { shellRef: 'a'.repeat(64), buildCompatibility: { buildId: 'b'.repeat(32), protocolVersion: 1,
    storageSchemas: { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 },
    shellAssets: [{ path: '/app/', sha256: createHash('sha256').update(asset).digest('hex') }], publicNavigationPaths: ['/app/'] } };
  const fetch = async (url: string) => new Response(url.endsWith('/runtime-build.json') ? JSON.stringify(build) : asset, { status: 200 });
  const navigated: string[] = [];
  const pages = [{ id: 'page-a', type: 'window', url: 'https://app.example/app/', async navigate(url: string) { navigated.push(url); return this; }, postMessage() {} }];
  let skipped = 0;
  const self = {
    location: { origin: 'https://app.example' },
    addEventListener(name: string, listener: (event: Record<string, unknown>) => void) { handlers.set(name, listener); },
    clients: { async matchAll() { return pages; }, async claim() {} },
    registration: { async showNotification() {}, pushManager: { async getSubscription() { return null; } } },
    async skipWaiting() { skipped += 1; },
  };
  const text = await readFile(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');
  runInNewContext(text.replace('__ONYX_SW_BUILD_CONFIG__', JSON.stringify(build)), {
    self, caches, fetch, crypto: globalThis.crypto, URL, TextEncoder, Response, Request, Date, setTimeout, clearTimeout, indexedDB: undefined,
  });
  const run = async (name: string) => {
    let work: Promise<unknown> | undefined;
    handlers.get(name)!({ waitUntil(value: Promise<unknown>) { work = value; } });
    await work;
  };
  return { run, store, navigated, skipped: () => skipped };
}

describe('service worker legacy cache migration', () => {
  it('replaces the old cache-first worker at once and reloads its pages onto the new build', async () => {
    const worker = await makeWorker(['onyx-shell-20261019-133720-55bfa9cf-dirty']);
    await worker.run('install');
    expect(worker.skipped()).toBe(1);
    await worker.run('activate');
    expect([...worker.store.keys()].some((key) => key.startsWith('onyx-shell-'))).toBe(false);
    expect([...worker.store.keys()]).toContain(`onyx-elm-shell:${'b'.repeat(32)}`);
    expect(worker.navigated).toEqual(['https://app.example/app/']);
  });

  it('keeps the safe activation protocol for an Elm-to-Elm update', async () => {
    const worker = await makeWorker([`onyx-elm-shell:${'c'.repeat(32)}`]);
    await worker.run('install');
    expect(worker.skipped()).toBe(0);
    await worker.run('activate');
    expect(worker.navigated).toEqual([]);
  });
});
