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

// ── Install: precache shell ────────────────────────────────────────────────────
// CRITICAL: precache failures must NEVER abort install. cache.addAll rejects
// wholesale if any single URL 404s, which bricks the update pipeline — every
// returning client then keeps the OLD service worker (and its stale bundle)
// forever. That exact failure shipped once (/favicon.ico vanished) and froze
// live users on a weeks-old build. Precache best-effort, always install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
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
    )
  );
  self.clients.claim();
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
      fetch(request).catch(() => caches.match('/'))
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
  // Orochi's webpushNotify sends {type:'dm', from, text} (RFC 8291-encrypted
  // end to end); map it onto the generic {title, body, url} shape.
  if (data.type === 'dm' && data.from) {
    data = {
      title: `Message from ${data.from}`,
      body: data.text ?? '',
      tag: `onyx-dm-${data.from}`,
      url: '/app',
    };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Onyx', {
      body: data.body ?? '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.tag ?? 'onyx-notification',
      renotify: !!data.tag,
      data: { url: data.url ?? '/' },
      vibrate: [100, 50, 100],
    })
  );
});

// ── Notification click: focus or open the app ─────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // No window open — open a new one
        return self.clients.openWindow(targetUrl);
      })
  );
});
