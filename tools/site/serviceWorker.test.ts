// SPDX-License-Identifier: AGPL-3.0-or-later
// Behaviour of public/sw.js, run in a vm sandbox with fake Service Worker
// globals. The worker is shared by every deployment (the same /sw.js URL and
// scope, skip-waiting + clients-claim, `onyx-shell-<stamp>` caches), so these
// contracts also keep browsers that still hold an older worker updating
// cleanly to this one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serviceWorkerPath = join(root, 'public', 'sw.js');

function loadManifest(): { start_url: string } {
  return JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8')) as { start_url: string };
}

describe('service worker', () => {
  it('bounds push content and keeps notification targets on canonical app routes', async () => {
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
      data: { url: '/app/' },
    }));

    for (const payload of [
      { title: 'Missing target' },
      { title: 'Marketing target', url: '/' },
    ]) {
      pushWork = undefined;
      push!({
        data: { json: () => payload },
        waitUntil: (work: Promise<unknown>) => {
          pushWork = work;
        },
      });
      await pushWork;
      expect(showNotification).toHaveBeenLastCalledWith(payload.title, expect.objectContaining({
        data: { url: '/app/' },
      }));
    }

    pushWork = undefined;
    push!({
      data: {
        json: () => ({
          title: 'Room mention',
          url: 'https://onyx.test/app?join=%23root&at=42#message',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith('Room mention', expect.objectContaining({
      data: { url: '/app/?join=%23root&at=42#message' },
    }));

    pushWork = undefined;
    push!({
      data: {
        json: () => ({
          type: 'dm',
          from: 'Alice',
          text: 'Hello',
          url: '/',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith('Message from Alice', expect.objectContaining({
      body: 'Hello',
      data: { url: '/app/' },
    }));

    // E2EE envelope in a DM push payload must never reach the OS alert body.
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'dm',
          from: 'Bob',
          text: 'ONYXDM1 AAAA_ciphertext_must_not_leak_to_lock_screen',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith('Message from Bob', expect.objectContaining({
      body: 'New encrypted message',
    }));
    const encryptedCall = showNotification.mock.calls.at(-1);
    expect(JSON.stringify(encryptedCall)).not.toContain('TSUMUGI1');
    expect(JSON.stringify(encryptedCall)).not.toContain('ciphertext');

    // Leading whitespace must not defeat envelope redaction on the push plane.
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'dm',
          from: 'Bob',
          text: ' \tONYXDM1 padded_ciphertext_must_not_leak',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith('Message from Bob', expect.objectContaining({
      body: 'New encrypted message',
    }));
    expect(JSON.stringify(showNotification.mock.calls.at(-1))).not.toContain('TSUMUGI1');
    expect(JSON.stringify(showNotification.mock.calls.at(-1))).not.toContain('ciphertext');

    // Era 3 C2 multi-device DM envelopes must redact exactly like ONYXDM1.
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'dm',
          from: 'Bob',
          text: 'ONYXDMN1 multi_device_ciphertext_must_not_leak',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith('Message from Bob', expect.objectContaining({
      body: 'New encrypted message',
    }));
    expect(JSON.stringify(showNotification.mock.calls.at(-1))).not.toContain('ciphertext');

    // Leading whitespace must not defeat ONYXDMN1 redaction either.
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'dm',
          from: 'Bob',
          text: '\n  ONYXDMN1 padded_multi_device_ciphertext_must_not_leak',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith('Message from Bob', expect.objectContaining({
      body: 'New encrypted message',
    }));
    expect(JSON.stringify(showNotification.mock.calls.at(-1))).not.toContain('ciphertext');

    // Room envelopes can arrive in mention payloads and must fail closed.
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'mention',
          from: 'Carol',
          channel: '#root',
          text: 'ONYXROOM1 room_ciphertext_must_not_leak',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith(
      'Carol mentioned you in #root',
      expect.objectContaining({ body: 'New encrypted message' }),
    );
    expect(JSON.stringify(showNotification.mock.calls.at(-1))).not.toContain('ciphertext');

    // Leading whitespace must not defeat ONYXROOM1 mention redaction.
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'mention',
          from: 'Carol',
          channel: '#root',
          text: ' \tONYXROOM1 padded_room_ciphertext_must_not_leak',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith(
      'Carol mentioned you in #root',
      expect.objectContaining({ body: 'New encrypted message' }),
    );
    expect(JSON.stringify(showNotification.mock.calls.at(-1))).not.toContain('ciphertext');

    // Near-prefix and malformed non-envelopes must stay plaintext on the SW path.
    for (const [from, text] of [
      ['Eve', 'ONYXDM1'],
      ['Eve', 'ONYXDMN1'],
      ['Eve', 'ONYXROOM1'],
      ['Eve', 'talking about ONYXDM1 offline'],
      ['Eve', 'talking about ONYXDMN1 offline'],
      ['Eve', 'talking about ONYXROOM1 offline'],
      ['Eve', 'onyxdm1 ciphertext_must_remain_visible_when_not_an_envelope'],
      ['Eve', 'ONYXDM1X not-an-envelope'],
    ] as const) {
      pushWork = undefined;
      showNotification.mockClear();
      push!({
        data: {
          json: () => ({
            type: 'dm',
            from,
            text,
          }),
        },
        waitUntil: (work: Promise<unknown>) => {
          pushWork = work;
        },
      });
      await pushWork;
      expect(showNotification).toHaveBeenLastCalledWith(`Message from ${from}`, expect.objectContaining({
        body: text,
      }));
    }

    // Era 3 C3: mention + call push types
    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'mention',
          from: 'Carol',
          text: 'hey Alice look',
          channel: '#root',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith(
      'Carol mentioned you in #root',
      expect.objectContaining({ body: 'hey Alice look' }),
    );

    pushWork = undefined;
    showNotification.mockClear();
    push!({
      data: {
        json: () => ({
          type: 'call',
          from: 'Dave',
          text: 'Voice/video call started',
          channel: '#voice',
        }),
      },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    });
    await pushWork;
    expect(showNotification).toHaveBeenLastCalledWith(
      'Call in #voice',
      expect.objectContaining({ body: 'Voice/video call started' }),
    );

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
    expect(openWindow).toHaveBeenCalledWith('/app/');

    const prefixClient = {
      url: 'https://onyx.test.evil.example/app',
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    workerSelf.clients.matchAll.mockResolvedValueOnce([prefixClient]);
    openWindow.mockClear();
    clickWork = undefined;
    click!({
      notification: { close: vi.fn(), data: { url: '/app/' } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(prefixClient.navigate).not.toHaveBeenCalled();
    expect(prefixClient.focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('/app/');

    const landingClient = {
      url: 'https://onyx.test/',
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const appClient = {
      url: 'https://onyx.test/app/',
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const roomTarget = '/app/?join=%23root#message-42';
    workerSelf.clients.matchAll.mockResolvedValueOnce([landingClient, appClient]);
    openWindow.mockClear();
    clickWork = undefined;
    click!({
      notification: { close: vi.fn(), data: { url: roomTarget } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(appClient.navigate).toHaveBeenCalledWith(roomTarget);
    expect(appClient.focus).toHaveBeenCalledOnce();
    expect(landingClient.navigate).not.toHaveBeenCalled();
    expect(landingClient.focus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();

    appClient.url = `https://onyx.test${roomTarget}`;
    appClient.navigate.mockClear();
    appClient.focus.mockClear();
    workerSelf.clients.matchAll.mockResolvedValueOnce([landingClient, appClient]);
    clickWork = undefined;
    click!({
      notification: { close: vi.fn(), data: { url: roomTarget } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(appClient.navigate).not.toHaveBeenCalled();
    expect(appClient.focus).toHaveBeenCalledOnce();

    const marketingOnlyClient = {
      url: 'https://onyx.test/',
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    workerSelf.clients.matchAll.mockResolvedValueOnce([marketingOnlyClient]);
    openWindow.mockClear();
    clickWork = undefined;
    click!({
      notification: { close: vi.fn(), data: { url: roomTarget } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(marketingOnlyClient.navigate).not.toHaveBeenCalled();
    expect(marketingOnlyClient.focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(roomTarget);

    workerSelf.clients.matchAll.mockRejectedValueOnce(new Error('client enumeration unavailable'));
    openWindow.mockClear();
    clickWork = undefined;
    click!({
      notification: { close: vi.fn(), data: { url: roomTarget } },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    });
    await clickWork;
    expect(openWindow).toHaveBeenCalledWith(roomTarget);
  });

  it('keeps install and activation alive without substituting shells for offline document routes', async () => {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const add = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const put = vi.fn(async () => undefined);
    const currentCacheMatch = vi.fn<(url: string) => Promise<unknown>>(async (url) => ({
      fallback: url,
      ok: true,
      url: `https://onyx.test${url}`,
    }));
    const cache = { add, match: currentCacheMatch, put };
    const priorCacheMatch = vi.fn<(key: unknown) => Promise<unknown>>(async () => undefined);
    const priorCache = { match: priorCacheMatch };
    const matchAnyCache = vi.fn<(key: unknown) => Promise<unknown>>(async (key) => ({
      fallback: key,
      ok: true,
      url: `https://onyx.test${String(key)}`,
    }));
    const deleteCache = vi.fn(async () => {
      throw new Error('stale cache is unavailable');
    });
    const caches = {
      open: vi.fn(async (name: string) => name.startsWith('onyx-shell-')
        && name !== 'onyx-shell-__BUILD_VERSION__'
        ? priorCache
        : cache),
      keys: vi.fn(async () => [
        'public-site-cache',
        'onyx-shell-old-build',
        'onyx-shell-__BUILD_VERSION__',
      ]),
      delete: deleteCache,
      match: matchAnyCache,
    };
    const skipWaiting = vi.fn(async () => undefined);
    const claim = vi.fn(async () => undefined);
    const enableNavigationPreload = vi.fn(async () => undefined);
    const networkFetch = vi.fn<(request: unknown) => Promise<unknown>>(async () => {
      throw new Error('offline');
    });
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
      Response,
    });

    let installWork: Promise<unknown> | undefined;
    listeners.get('install')?.({
      waitUntil: (work: Promise<unknown>) => {
        installWork = work;
      },
    });
    await installWork;
    const precachedUrls = add.mock.calls.map(([url]) => url);
    expect(precachedUrls).toEqual(['/', '/app/']);
    expect(precachedUrls).toContain(loadManifest().start_url);
    expect(skipWaiting).toHaveBeenCalledOnce();

    caches.open.mockRejectedValueOnce(new Error('Cache Storage unavailable'));
    skipWaiting.mockRejectedValueOnce(new Error('activation request unavailable'));
    let cacheFailureInstallWork: Promise<unknown> | undefined;
    listeners.get('install')?.({
      waitUntil: (work: Promise<unknown>) => {
        cacheFailureInstallWork = work;
      },
    });
    await expect(cacheFailureInstallWork).resolves.toBeDefined();
    expect(skipWaiting).toHaveBeenCalledTimes(2);

    let messageWork: Promise<unknown> | undefined;
    listeners.get('message')?.({
      data: { type: 'ONYX_SKIP_WAITING' },
      waitUntil: (work: Promise<unknown>) => {
        messageWork = work;
      },
    });
    await messageWork;
    expect(skipWaiting).toHaveBeenCalledTimes(3);

    listeners.get('message')?.({
      data: { type: 'UNRELATED_MESSAGE' },
      waitUntil: vi.fn(),
    });
    expect(skipWaiting).toHaveBeenCalledTimes(3);

    let activateWork: Promise<unknown> | undefined;
    listeners.get('activate')?.({
      waitUntil: (work: Promise<unknown>) => {
        activateWork = work;
      },
    });
    await expect(activateWork).resolves.toBeUndefined();
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith('onyx-shell-old-build');
    expect(deleteCache).not.toHaveBeenCalledWith('public-site-cache');
    expect(deleteCache).not.toHaveBeenCalledWith('onyx-shell-__BUILD_VERSION__');
    expect(claim).toHaveBeenCalledOnce();
    expect(enableNavigationPreload).toHaveBeenCalledOnce();

    deleteCache.mockClear();
    currentCacheMatch.mockResolvedValueOnce({ url: 'https://login.example/app/' });
    claim.mockRejectedValueOnce(new Error('client claim unavailable'));
    activateWork = undefined;
    listeners.get('activate')?.({
      waitUntil: (work: Promise<unknown>) => {
        activateWork = work;
      },
    });
    await expect(activateWork).resolves.toBeUndefined();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(enableNavigationPreload).toHaveBeenCalledTimes(2);

    let navigationWork: Promise<unknown> | undefined;
    let navigationCacheWork: Promise<unknown> | undefined;
    const navigationClone = { source: 'navigation-cache-clone' };
    const preloadedResponse = {
      source: 'navigation-preload',
      ok: true,
      url: 'https://onyx.test/app/',
      clone: vi.fn(() => navigationClone),
    };
    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app' },
      preloadResponse: Promise.resolve(preloadedResponse),
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        navigationCacheWork = work;
      },
    });
    await expect(navigationWork).resolves.toBe(preloadedResponse);
    await navigationCacheWork;
    expect(networkFetch).not.toHaveBeenCalled();
    expect(preloadedResponse.clone).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith('/app/', navigationClone);
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith('onyx-shell-old-build');
    expect(deleteCache).not.toHaveBeenCalledWith('public-site-cache');

    const redirectedClone = vi.fn(() => ({ source: 'unsafe-clone' }));
    navigationCacheWork = undefined;
    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app/' },
      preloadResponse: Promise.resolve({
        ok: true,
        url: 'https://login.example/app/',
        clone: redirectedClone,
      }),
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        navigationCacheWork = work;
      },
    });
    await navigationWork;
    await navigationCacheWork;
    expect(redirectedClone).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);

    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app?join=%23root' },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    await expect(navigationWork).resolves.toMatchObject({ fallback: '/app/' });
    expect(currentCacheMatch).toHaveBeenLastCalledWith('/app/');

    listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://onyx.test/app/?join=%23root#message-42',
      },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    await expect(navigationWork).resolves.toMatchObject({ fallback: '/app/' });
    expect(currentCacheMatch).toHaveBeenLastCalledWith('/app/');

    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/' },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    await expect(navigationWork).resolves.toMatchObject({ fallback: '/' });
    expect(currentCacheMatch).toHaveBeenLastCalledWith('/');

    // Unknown app descendants are not aliases for the shell. An online 404 is
    // returned unchanged and is never cached; an offline request gets a plain
    // 503/no-store response without consulting any shell cache.
    const cacheLookupsBeforeUnknownApp = currentCacheMatch.mock.calls.length;
    const retainedLookupsBeforeUnknownApp = priorCacheMatch.mock.calls.length;
    const cacheKeysBeforeUnknownApp = caches.keys.mock.calls.length;
    const unknownAppOnline = {
      source: 'network-404',
      ok: false,
      status: 404,
      url: 'https://onyx.test/app/retained',
      clone: vi.fn(),
    };
    networkFetch.mockResolvedValueOnce(unknownAppOnline);
    navigationCacheWork = undefined;
    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app/retained' },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        navigationCacheWork = work;
      },
    });
    await expect(navigationWork).resolves.toBe(unknownAppOnline);
    await navigationCacheWork;
    expect(unknownAppOnline.clone).not.toHaveBeenCalled();
    expect(currentCacheMatch).toHaveBeenCalledTimes(cacheLookupsBeforeUnknownApp);
    expect(priorCacheMatch).toHaveBeenCalledTimes(retainedLookupsBeforeUnknownApp);
    expect(caches.keys).toHaveBeenCalledTimes(cacheKeysBeforeUnknownApp);

    networkFetch.mockRejectedValueOnce(new Error('offline unknown app path'));
    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://onyx.test/app/offline' },
      respondWith: (work: Promise<unknown>) => {
        navigationWork = work;
      },
    });
    const unavailableUnknownApp = await navigationWork as Response;
    expect(unavailableUnknownApp).toBeInstanceOf(Response);
    expect(unavailableUnknownApp.status).toBe(503);
    expect(unavailableUnknownApp.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(unavailableUnknownApp.headers.get('Cache-Control')).toBe('no-store');
    expect(currentCacheMatch).toHaveBeenCalledTimes(cacheLookupsBeforeUnknownApp);
    expect(priorCacheMatch).toHaveBeenCalledTimes(retainedLookupsBeforeUnknownApp);
    expect(caches.keys).toHaveBeenCalledTimes(cacheKeysBeforeUnknownApp);

    let assetResponseWork: Promise<unknown> | undefined;
    let assetLifetimeWork: Promise<unknown> | undefined;
    const retainedAssetRequest = {
      method: 'GET',
      mode: 'cors',
      url: 'https://onyx.test/assets/retained.101.js',
    };
    const retainedAssetResponse = {
      source: 'retained-static-asset',
      ok: true,
      url: retainedAssetRequest.url,
    };
    currentCacheMatch.mockResolvedValueOnce(undefined);
    priorCacheMatch.mockResolvedValueOnce(retainedAssetResponse);
    networkFetch.mockClear();
    listeners.get('fetch')?.({
      request: retainedAssetRequest,
      respondWith: (work: Promise<unknown>) => {
        assetResponseWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        assetLifetimeWork = work;
      },
    });
    await expect(assetResponseWork).resolves.toBe(retainedAssetResponse);
    await assetLifetimeWork;
    expect(networkFetch).not.toHaveBeenCalled();

    const cachedClone = { kind: 'asset-clone' };
    const assetResponse = {
      ok: true,
      url: 'https://onyx.test/assets/app.123.js',
      clone: vi.fn(() => cachedClone),
    };
    const assetRequest = { method: 'GET', mode: 'cors', url: 'https://onyx.test/assets/app.123.js' };
    currentCacheMatch.mockRejectedValueOnce(new Error('static cache read unavailable'));
    networkFetch.mockResolvedValueOnce(assetResponse);
    listeners.get('fetch')?.({
      request: assetRequest,
      respondWith: (work: Promise<unknown>) => {
        assetResponseWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        assetLifetimeWork = work;
      },
    });
    await expect(assetResponseWork).resolves.toBe(assetResponse);
    await assetLifetimeWork;
    expect(assetResponse.clone).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(assetRequest, cachedClone);

    const repairedClone = { kind: 'repaired-asset-clone' };
    const repairedResponse = {
      ok: true,
      url: 'https://onyx.test/assets/repair.456.js',
      clone: vi.fn(() => repairedClone),
    };
    const repairRequest = {
      method: 'GET',
      mode: 'cors',
      url: 'https://onyx.test/assets/repair.456.js',
    };
    currentCacheMatch.mockResolvedValueOnce({
      ok: true,
      url: 'https://cdn.example/assets/repair.456.js',
    });
    networkFetch.mockResolvedValueOnce(repairedResponse);
    listeners.get('fetch')?.({
      request: repairRequest,
      respondWith: (work: Promise<unknown>) => {
        assetResponseWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        assetLifetimeWork = work;
      },
    });
    await expect(assetResponseWork).resolves.toBe(repairedResponse);
    await assetLifetimeWork;
    expect(repairedResponse.clone).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(repairRequest, repairedClone);

    const recoveredClone = { kind: 'recovered-asset-clone' };
    const recoveredResponse = {
      ok: true,
      url: 'https://onyx.test/assets/recover.789.js',
      clone: vi.fn(() => recoveredClone),
    };
    const recoverRequest = {
      method: 'GET',
      mode: 'cors',
      url: 'https://onyx.test/assets/recover.789.js',
    };
    currentCacheMatch.mockResolvedValueOnce({
      ok: false,
      url: 'https://onyx.test/assets/recover.789.js',
    });
    networkFetch.mockResolvedValueOnce(recoveredResponse);
    listeners.get('fetch')?.({
      request: recoverRequest,
      respondWith: (work: Promise<unknown>) => {
        assetResponseWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        assetLifetimeWork = work;
      },
    });
    await expect(assetResponseWork).resolves.toBe(recoveredResponse);
    await assetLifetimeWork;
    expect(recoveredResponse.clone).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(recoverRequest, recoveredClone);

    const queryClone = { kind: 'query-asset-clone' };
    const queryResponse = {
      ok: true,
      url: 'https://onyx.test/assets/query.js?v=current',
      clone: vi.fn(() => queryClone),
    };
    const queryRequest = {
      method: 'GET',
      mode: 'cors',
      url: 'https://onyx.test/assets/query.js?v=current',
    };
    currentCacheMatch.mockResolvedValueOnce({
      ok: true,
      url: 'https://onyx.test/assets/query.js?v=stale',
    });
    networkFetch.mockResolvedValueOnce(queryResponse);
    listeners.get('fetch')?.({
      request: queryRequest,
      respondWith: (work: Promise<unknown>) => {
        assetResponseWork = work;
      },
      waitUntil: (work: Promise<unknown>) => {
        assetLifetimeWork = work;
      },
    });
    await expect(assetResponseWork).resolves.toBe(queryResponse);
    await assetLifetimeWork;
    expect(queryResponse.clone).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(queryRequest, queryClone);

    const matchCallsBeforeUpload = currentCacheMatch.mock.calls.length;
    const fetchCallsBeforeUpload = networkFetch.mock.calls.length;
    const uploadRespondWith = vi.fn();
    const uploadWaitUntil = vi.fn();
    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'cors', url: 'https://onyx.test/uploads/private.png' },
      respondWith: uploadRespondWith,
      waitUntil: uploadWaitUntil,
    });
    expect(uploadRespondWith).not.toHaveBeenCalled();
    expect(uploadWaitUntil).not.toHaveBeenCalled();
    expect(currentCacheMatch).toHaveBeenCalledTimes(matchCallsBeforeUpload);
    expect(networkFetch).toHaveBeenCalledTimes(fetchCallsBeforeUpload);
    expect(matchAnyCache).not.toHaveBeenCalled();
  });
});
