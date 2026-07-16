/* Onyx service worker
 * Handles push notifications and a minimal cache-first shell strategy.
 */

// NOTE: bump this version on every deploy so the service worker re-installs,
// purges the old cache, and clients pick up the new build instead of serving
// a stale cache-first bundle. A stale SW silently breaks features baked in at
// build time (e.g. the media-upload URL).
const CACHE_NAME = 'onyx-shell-__BUILD_VERSION__';

// App shell assets to precache on install
const PRECACHE_URLS = [
  '/',
  '/app',
];

const PUSH_TITLE_MAX = 160;
const PUSH_BODY_MAX = 4096;
const PUSH_TAG_MAX = 128;
const PUSH_URL_MAX = 2048;

function boundedPushString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeNotificationPath(value, fallback = '/') {
  if (typeof value !== 'string' || value.length === 0 || value.length > PUSH_URL_MAX) {
    return fallback;
  }
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`.slice(0, PUSH_URL_MAX);
  } catch {
    return fallback;
  }
}

function isSameOriginClient(client) {
  try {
    return new URL(client.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function navigationFallbackPath(pathname) {
  return pathname === '/app' || pathname.startsWith('/app/') ? '/app' : '/';
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
      ),
      self.skipWaiting(),
    ])
  );
});

// ── Activate: clear stale caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Manual update recovery from Preferences ──────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ONYX_SKIP_WAITING') self.skipWaiting();
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
    event.respondWith(
      fetch(request).catch(() => caches.match(navigationFallbackPath(url.pathname)))
    );
    return;
  }

  // Cache-first for static assets (hashed /assets from Vite, fonts, icons)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
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
  // Orochi's webpushNotify sends {type:'dm', from, text} (RFC 8291-encrypted
  // end to end); map it onto the generic {title, body, url} shape.
  const dmFrom = boundedPushString(data.from, PUSH_TITLE_MAX - 13);
  if (data.type === 'dm' && dmFrom) {
    data = {
      title: `Message from ${dmFrom}`,
      body: data.text ?? '',
      tag: `onyx-dm-${dmFrom}`,
      url: '/app',
    };
  }
  const rawTag = boundedPushString(data.tag, PUSH_TAG_MAX);
  const title = boundedPushString(data.title, PUSH_TITLE_MAX) || 'Onyx';
  const body = boundedPushString(data.body, PUSH_BODY_MAX);
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
    })
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
        // If a window is already open, focus it and navigate
        for (const client of clientList) {
          if (isSameOriginClient(client) && 'focus' in client) {
            const navigation = 'navigate' in client
              ? client.navigate(targetUrl)
              : Promise.resolve();
            return Promise.resolve(navigation)
              .catch(() => undefined)
              .then(() => client.focus());
          }
        }
        // No window open — open a new one
        return self.clients.openWindow(targetUrl);
      })
  );
});
