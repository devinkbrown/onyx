// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

type WebManifest = {
  start_url: string;
  scope: string;
  display: string;
  display_override?: string[];
  launch_handler?: { client_mode?: string[] };
  shortcuts?: Array<{ name: string; url: string }>;
  screenshots?: Array<{ src: string; sizes: string; form_factor: string; label: string }>;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(root, 'public', 'manifest.json');
const serviceWorkerPath = join(root, 'public', 'sw.js');

function loadManifest(): WebManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as WebManifest;
}

describe('PWA manifest', () => {
  it('keeps installed launches on the app route with wrapper-safe display metadata', () => {
    const manifest = loadManifest();

    expect(manifest.start_url).toBe('/app');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toContain('window-controls-overlay');
    expect(manifest.launch_handler?.client_mode).toContain('navigate-existing');
  });

  it('declares app shortcuts and install screenshots backed by public assets', () => {
    const manifest = loadManifest();

    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual(['/app', '/status', '/stats']);
    expect(manifest.screenshots?.map((shot) => shot.form_factor).sort()).toEqual(['narrow', 'wide']);

    for (const screenshot of manifest.screenshots ?? []) {
      expect(screenshot.label).toMatch(/^Onyx /);
      expect(screenshot.sizes).toMatch(/^\d+x\d+$/);
      expect(existsSync(join(root, 'public', screenshot.src))).toBe(true);
    }
  });

  it('references notification icons that exist in public assets', () => {
    const worker = readFileSync(serviceWorkerPath, 'utf8');
    const notificationAssets = [...worker.matchAll(/(?:icon|badge):\s*'\/([^']+)'/g)]
      .map((match) => match[1])
      .filter((asset): asset is string => asset !== undefined);

    expect(notificationAssets.length).toBeGreaterThan(0);
    for (const asset of notificationAssets) {
      expect(existsSync(join(root, 'public', asset))).toBe(true);
    }
  });

  it('bounds push content and rejects cross-origin notification destinations', async () => {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const showNotification = vi.fn(async () => undefined);
    const openWindow = vi.fn(async () => undefined);
    const matchAll = vi.fn<() => Promise<unknown[]>>(async () => []);
    const workerSource = readFileSync(serviceWorkerPath, 'utf8');
    const workerSelf = {
      location: { origin: 'https://onyx.test' },
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.set(type, listener);
      },
      skipWaiting: vi.fn(),
      clients: {
        claim: vi.fn(),
        matchAll,
        openWindow,
      },
      registration: { showNotification },
    };
    runInNewContext(workerSource, {
      self: workerSelf,
      caches: { open: vi.fn(), keys: vi.fn() },
      fetch: vi.fn(),
      URL,
      Promise,
    });
    const push = listeners.get('push');
    expect(push).toBeDefined();
    let pushWork: Promise<unknown> | undefined;
    push!({
      data: {
        json: () => ({
          title: 't'.repeat(200),
          body: 'b'.repeat(5000),
          tag: 'g'.repeat(200),
          url: 'https://evil.example/phish',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;

    expect(showNotification).toHaveBeenCalledWith('t'.repeat(160), expect.objectContaining({
      body: 'b'.repeat(4096),
      tag: 'g'.repeat(128),
      data: { url: '/' },
    }));

    const click = listeners.get('notificationclick');
    expect(click).toBeDefined();
    let clickWork: Promise<unknown> | undefined;
    click!({
      notification: { close: vi.fn(), data: { url: 'javascript:alert(1)' } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(openWindow).toHaveBeenCalledWith('/');

    const prefixClient = {
      url: 'https://onyx.test.evil.example/app',
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    workerSelf.clients.matchAll.mockResolvedValueOnce([prefixClient]);
    openWindow.mockClear();
    clickWork = undefined;
    click!({
      notification: { close: vi.fn(), data: { url: '/app' } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(prefixClient.navigate).not.toHaveBeenCalled();
    expect(prefixClient.focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('/app');
  });

  it('keeps install and activation work alive and uses the cached app for offline app routes', async () => {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const add = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const cache = { add };
    const match = vi.fn(async (key: string) => ({ fallback: key }));
    const deleteCache = vi.fn(async () => true);
    const caches = {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => ['old-shell', 'onyx-shell-__BUILD_VERSION__']),
      delete: deleteCache,
      match,
    };
    const skipWaiting = vi.fn(async () => undefined);
    const claim = vi.fn(async () => undefined);
    const enableNavigationPreload = vi.fn(async () => undefined);
    const networkFetch = vi.fn(async () => Promise.reject(new Error('offline')));
    const workerSource = readFileSync(serviceWorkerPath, 'utf8');
    const workerSelf = {
      location: { origin: 'https://onyx.test' },
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.set(type, listener);
      },
      skipWaiting,
      clients: { claim, matchAll: vi.fn(), openWindow: vi.fn() },
      registration: {
        showNotification: vi.fn(),
        navigationPreload: { enable: enableNavigationPreload },
      },
    };
    runInNewContext(workerSource, {
      self: workerSelf,
      caches,
      fetch: networkFetch,
      URL,
      Promise,
    });

    let installWork: Promise<unknown> | undefined;
    listeners.get('install')?.({
      waitUntil: (work: Promise<unknown>) => {
        installWork = work;
      },
    });
    await installWork;
    expect(add.mock.calls.map(([url]) => url)).toEqual(['/', '/app']);
    expect(skipWaiting).toHaveBeenCalledOnce();

    let activateWork: Promise<unknown> | undefined;
    listeners.get('activate')?.({
      waitUntil: (work: Promise<unknown>) => {
        activateWork = work;
      },
    });
    await activateWork;
    expect(deleteCache).toHaveBeenCalledWith('old-shell');
    expect(deleteCache).not.toHaveBeenCalledWith('onyx-shell-__BUILD_VERSION__');
    expect(claim).toHaveBeenCalledOnce();
    expect(enableNavigationPreload).toHaveBeenCalledOnce();

    let navigationWork: Promise<unknown> | undefined;
    const preloadedResponse = { source: 'navigation-preload' };
    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app' },
      preloadResponse: Promise.resolve(preloadedResponse),
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    await expect(navigationWork).resolves.toBe(preloadedResponse);
    expect(networkFetch).not.toHaveBeenCalled();

    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app?join=%23root' },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    await expect(navigationWork).resolves.toEqual({ fallback: '/app' });
    expect(match).toHaveBeenLastCalledWith('/app');

    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/install/' },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    await expect(navigationWork).resolves.toEqual({ fallback: '/' });
    expect(match).toHaveBeenLastCalledWith('/');
  });
});
