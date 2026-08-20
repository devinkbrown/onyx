/* Onyx service worker
 * Handles push notifications and a minimal cache-first shell strategy.
 */

// NOTE: bump this version on every deploy so the service worker re-installs,
// purges the old cache, and clients pick up the new build instead of serving
// a stale cache-first bundle. A stale SW silently breaks features baked in at
// build time (e.g. the media-upload URL).
const CACHE_NAME = 'onyx-shell-__BUILD_VERSION__';
const CACHE_PREFIX = 'onyx-shell-';
const PRIOR_SHELL_CACHE_LIMIT = 4;

// App shell assets to precache on install
const PRECACHE_URLS = [
  '/',
  '/app/',
];

const PUSH_TITLE_MAX = 160;
const PUSH_BODY_MAX = 4096;
const PUSH_TAG_MAX = 128;
const PUSH_URL_MAX = 2048;
const APP_PATH = '/app/';

function boundedPushString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

// E2EE envelopes ride ordinary message text (`ONYXDM1 ` / `ONYXDMN1 ` /
// `ONYXROOM1 ` + base64url body). The service worker cannot open them (keys
// live in the page's IndexedDB), so any envelope that reaches a push payload
// must fail closed to a neutral body — never put ciphertext on a lock screen.
// Leading whitespace is also redacted: crypto stays strict, but a lock-screen
// body must not surface a padded envelope.
const E2EE_ENVELOPE_PREFIXES = ['ONYXDM1 ', 'ONYXDMN1 ', 'ONYXROOM1 '];
const ENCRYPTED_PUSH_BODY = 'New encrypted message';

function startsWithEnvelopePrefix(text) {
  return E2EE_ENVELOPE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function isPushEnvelope(text) {
  if (startsWithEnvelopePrefix(text)) return true;
  const trimmed = text.replace(/^\s+/u, '');
  return trimmed !== text && startsWithEnvelopePrefix(trimmed);
}

function pushBodyFor(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  if (isPushEnvelope(text)) return ENCRYPTED_PUSH_BODY;
  return text;
}

function safeNotificationPath(value, fallback = APP_PATH) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PUSH_URL_MAX) {
    return fallback;
  }
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    if (url.pathname === '/app') url.pathname = APP_PATH;
    if (!isAppPath(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`.slice(0, PUSH_URL_MAX);
  } catch {
    return fallback;
  }
}

function clientUrl(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin ? url : null;
  } catch {
    return null;
  }
}

function isAppPath(pathname) {
  return pathname === '/app' || pathname.startsWith(APP_PATH);
}

function chooseNotificationClient(clientList, targetUrl) {
  const sameOrigin = clientList
    .map((client) => ({ client, url: clientUrl(client) }))
    .filter(({ url }) => url !== null);
  const exact = sameOrigin.find(({ url }) =>
    `${url.pathname}${url.search}${url.hash}` === `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
  );
  if (exact) return { client: exact.client, exact: true };
  if (isAppPath(targetUrl.pathname)) {
    const app = sameOrigin.find(({ url }) => isAppPath(url.pathname));
    if (app) return { client: app.client, exact: false };
    return null;
  }
  const first = sameOrigin[0];
  return first ? { client: first.client, exact: false } : null;
}

function focusNotificationTarget(clientList, targetPath) {
  const targetUrl = new URL(targetPath, self.location.origin);
  const selected = chooseNotificationClient(clientList, targetUrl);
  if (!selected) return self.clients.openWindow(targetPath);
  const { client, exact } = selected;
  if (exact && 'focus' in client) {
    return Promise.resolve(client.focus()).catch(() => self.clients.openWindow(targetPath));
  }
  if (!('navigate' in client)) {
    return isAppPath(targetUrl.pathname) && isAppPath(clientUrl(client)?.pathname ?? '') && 'focus' in client
      ? client.focus()
      : self.clients.openWindow(targetPath);
  }
  return Promise.resolve(client.navigate(targetPath))
    .then((navigated) => navigated && 'focus' in navigated ? navigated : client)
    .then((focused) => 'focus' in focused ? focused.focus() : undefined)
    .catch(() => self.clients.openWindow(targetPath));
}

function navigationFallbackPath(pathname) {
  // Only canonical shell documents may be cached or used as offline
  // fallbacks. In particular, /app/* must remain a real online 404 rather
  // than becoming a cacheable 200 app shell (a soft 404).
  if (pathname === '/app' || pathname === APP_PATH) return APP_PATH;
  if (pathname === '/') return '/';
  return null;
}

function isCacheableStaticPath(pathname) {
  return pathname.startsWith('/assets/')
    || pathname.startsWith('/fonts/')
    || pathname === '/favicon.ico'
    || pathname === '/icon-192.png'
    || pathname === '/icon-512.png'
    || /^\/screenshots\/[^/]+\.png$/.test(pathname);
}

function isCanonicalShellResponse(pathname, response) {
  const fallbackPath = navigationFallbackPath(pathname);
  if (fallbackPath === null || response?.ok !== true) return false;
  try {
    const finalUrl = new URL(response.url);
    return finalUrl.origin === self.location.origin
      && navigationFallbackPath(finalUrl.pathname) === fallbackPath;
  } catch {
    return false;
  }
}

function isCanonicalStaticResponse(requestUrl, response) {
  if (response?.ok !== true) return false;
  try {
    const finalUrl = new URL(response.url);
    return finalUrl.origin === self.location.origin
      && finalUrl.pathname === requestUrl.pathname
      && finalUrl.search === requestUrl.search;
  } catch {
    return false;
  }
}

function priorShellCacheNames() {
  return caches.keys()
    .then((keys) => keys
      .filter((key) => typeof key === 'string'
        && key.startsWith(CACHE_PREFIX)
        && key !== CACHE_NAME)
      .sort()
      .reverse()
      .slice(0, PRIOR_SHELL_CACHE_LIMIT))
    .catch(() => []);
}

function matchNamedShellResponse(name, request, isValid) {
  return caches.open(name)
    .then((cache) => cache.match(request))
    .then((response) => isValid(response) ? response : undefined)
    .catch(() => undefined);
}

function matchRetainedShellResponse(request, isValid) {
  // The normal path stays one cache read. Enumerate retained names only when
  // the freshly stamped cache misses or contains an invalid response.
  return matchNamedShellResponse(CACHE_NAME, request, isValid)
    .then((current) => current ?? priorShellCacheNames().then((names) => names.reduce(
      (pending, name) => pending.then((matched) => matched
        ?? matchNamedShellResponse(name, request, isValid)),
      Promise.resolve(undefined)
    )));
}

function offlineNavigationFallback(pathname) {
  const fallbackPath = navigationFallbackPath(pathname);
  const unavailable = () => new Response(
    fallbackPath === '/app/'
      ? 'Onyx is unavailable offline because its app shell was not cached. Reconnect and reload once to make offline access available.'
      : 'This Onyx page is unavailable offline. Reconnect and reload to open it.',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
  if (fallbackPath === null) return Promise.resolve(unavailable());
  return matchRetainedShellResponse(
    fallbackPath,
    (cached) => isCanonicalShellResponse(fallbackPath, cached)
  )
    .then((cached) => cached ?? unavailable())
    .catch(() => unavailable());
}

function cacheSuccessfulShellNavigation(pathname, response) {
  const fallbackPath = navigationFallbackPath(pathname);
  if (fallbackPath === null
    || response?.ok !== true
    || typeof response.clone !== 'function'
    || !isCanonicalShellResponse(pathname, response)) return Promise.resolve();
  let clone;
  try {
    clone = response.clone();
  } catch {
    return Promise.resolve();
  }
  return caches.open(CACHE_NAME)
    .then((cache) => cache.put(fallbackPath, clone))
    .then(() => clearStaleShellCaches())
    .catch(() => undefined);
}

function enableNavigationPreload() {
  try {
    const navigationPreload = self.registration?.navigationPreload;
    if (!navigationPreload || typeof navigationPreload.enable !== 'function') {
      return Promise.resolve();
    }
    // Navigation preload starts the request in parallel with service-worker
    // startup. Treat it as an optional acceleration: browser policy failures
    // must never block activation or offline fallback behavior.
    return Promise.resolve(navigationPreload.enable()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function clearStaleShellCaches() {
  return caches.open(CACHE_NAME)
    .then((current) => Promise.all(PRECACHE_URLS.map((url) => current.match(url))))
    .then((entries) => {
      // A best-effort install may activate with one shell URL missing. Keep the
      // previous Onyx cache as the only available offline fallback until a
      // later complete deployment can safely retire it.
      if (!entries.every((entry, index) => isCanonicalShellResponse(PRECACHE_URLS[index], entry))) {
        return undefined;
      }
      return caches.keys().then((keys) => Promise.all(
        keys
          // This worker shares an origin with public and operational surfaces.
          // Never erase caches owned by another application.
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => Promise.resolve(caches.delete(key)).catch(() => false))
      ));
    })
    // Cache Storage can be unavailable or partially corrupted. Cleanup must
    // not brick activation of a worker whose fresh shell already installed.
    .catch(() => undefined);
}

function requestSkipWaiting() {
  return Promise.resolve()
    .then(() => self.skipWaiting())
    .catch(() => undefined);
}

function claimClientsBestEffort() {
  return Promise.resolve()
    .then(() => self.clients.claim())
    .catch(() => undefined);
}

// ── Install: precache shell ────────────────────────────────────────────────────
// CRITICAL: precache failures must NEVER abort install. cache.addAll rejects
// wholesale if any single URL 404s, which bricks the update pipeline — every
// returning client then keeps the OLD service worker (and its stale bundle)
// forever. That exact failure shipped once (/favicon.ico vanished) and froze
// live users on a weeks-old build. Precache best-effort, always install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) =>
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
      ).catch(() => undefined),
      requestSkipWaiting(),
    ])
  );
});

// ── Activate: clear stale caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clearStaleShellCaches(),
      enableNavigationPreload(),
    ]).then(() => claimClientsBestEffort())
  );
});

// ── Manual update recovery from Preferences ──────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'ONYX_SKIP_WAITING') return;
  const work = requestSkipWaiting();
  // ExtendableMessageEvent keeps the worker alive until the update transition
  // is requested. Preserve compatibility with older test/webview shims that
  // expose a plain MessageEvent.
  if (typeof event.waitUntil === 'function') event.waitUntil(work);
});

// ── Fetch: network-first for API/WS, cache-first for shell assets ─────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // For navigation requests, try network then fall back to cached index
  if (request.mode === 'navigate') {
    const loaded = Promise.resolve(event.preloadResponse)
      .catch(() => undefined)
      .then((preloaded) => preloaded ?? fetch(request));
    const cacheWork = loaded
      .then((response) => cacheSuccessfulShellNavigation(url.pathname, response))
      .catch(() => undefined);
    if (typeof event.waitUntil === 'function') event.waitUntil(cacheWork);
    event.respondWith(loaded.catch(() => offlineNavigationFallback(url.pathname)));
    return;
  }

  // Cache-first for static assets (hashed /assets from Vite, fonts, icons)
  if (isCacheableStaticPath(url.pathname)) {
    const loaded = matchRetainedShellResponse(
      request,
      (cached) => isCanonicalStaticResponse(url, cached)
    )
      .then((cached) => {
        if (cached) {
          return { response: cached, shouldCache: false };
        }
        return fetch(request).then((response) => ({
          response,
          shouldCache: response.ok && isCanonicalStaticResponse(url, response),
        }));
      });
    // Keep the worker alive until a newly fetched asset is actually stored.
    // Without waitUntil(), the browser may terminate the worker after the
    // response is delivered and silently drop this best-effort cache write.
    event.waitUntil(
      loaded.then(({ response, shouldCache }) => {
        if (!shouldCache) return undefined;
        const clone = response.clone();
        return caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }).catch(() => undefined)
    );
    event.respondWith(loaded.then(({ response }) => response));
  }
});

// ── Push notifications ─────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() ?? '' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  // Onyx Server webpushNotifyKind seals JSON to the push subscription:
  //   {type:'dm'|'mention'|'call', from, text, channel?}
  // The *message* text may still be an E2EE envelope the SW cannot open;
  // pushBodyFor redacts those so ciphertext never hits a lock screen.
  const from = boundedPushString(data.from, PUSH_TITLE_MAX - 16);
  const channel = boundedPushString(data.channel, 64);
  if (data.type === 'dm' && from) {
    data = {
      title: `Message from ${from}`,
      body: pushBodyFor(data.text),
      tag: `onyx-dm-${from}`,
      url: APP_PATH,
    };
  } else if (data.type === 'mention' && from) {
    data = {
      title: channel ? `${from} mentioned you in ${channel}` : `${from} mentioned you`,
      body: pushBodyFor(data.text),
      tag: `onyx-mention-${channel || from}`,
      url: channel ? `${APP_PATH}?join=${encodeURIComponent(channel)}` : APP_PATH,
    };
  } else if (data.type === 'call' && from) {
    data = {
      title: channel ? `Call in ${channel}` : 'Incoming call',
      body: pushBodyFor(data.text) || `${from} started a call`,
      tag: `onyx-call-${channel || from}`,
      url: channel ? `${APP_PATH}?join=${encodeURIComponent(channel)}` : APP_PATH,
    };
  }
  const rawTag = boundedPushString(data.tag, PUSH_TAG_MAX);
  const title = boundedPushString(data.title, PUSH_TITLE_MAX) || 'Onyx';
  const body = boundedPushString(pushBodyFor(data.body), PUSH_BODY_MAX);
  const targetUrl = safeNotificationPath(data.url);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: rawTag || 'onyx-notification',
      renotify: Boolean(rawTag),
      data: { url: targetUrl },
      vibrate: [100, 50, 100],
    }).catch(() =>
      // A failed rich notification must not drop the push silently — try a
      // minimal fallback so the user still learns something arrived.
      self.registration.showNotification(title || 'Onyx', {
        body: body || 'You have a new message.',
        data: { url: targetUrl },
      }).catch(() => undefined)
    )
  );
});

// ── Notification click: focus or open the app ─────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Revalidate click data independently: it may have been authored by an old
  // worker or another notification source, not this push handler.
  const targetUrl = safeNotificationPath(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        return focusNotificationTarget(clientList, targetUrl);
      })
      .catch(() => self.clients.openWindow(targetUrl))
  );
});
