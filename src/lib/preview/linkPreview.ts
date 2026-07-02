/**
 * linkPreview.ts — OpenGraph unfurl client.
 *
 * The browser never touches the target site: previews come from the network's
 * own same-origin `/linkpreview?url=` endpoint (upload_server.py), which
 * fetches the page server-side, extracts OG metadata, and caches it.
 *
 * Module-level cache + in-flight dedupe so a busy channel doesn't stampede
 * the endpoint with one request per rendered message.
 */

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  site: string;
}

/** Hosts whose links never get an OG card (our own media already unfurls). */
const SKIP_HOSTS = new Set(['eshmaki.me', 'www.eshmaki.me']);

/**
 * Pick the URL to preview from a message's link hrefs: the first plain http(s)
 * web link that is not one of our own uploads (those render as inline media).
 */
export function pickPreviewUrl(hrefs: readonly string[]): string | null {
  for (const href of hrefs) {
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (SKIP_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/uploads/')) continue;
    return href;
  }
  return null;
}

function normalize(raw: unknown, url: string): LinkPreview | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const preview: LinkPreview = {
    url: str(r['url']) || url,
    title: str(r['title']),
    description: str(r['description']),
    image: str(r['image']),
    site: str(r['site']),
  };
  // A card with neither title nor description nor image is worthless — treat
  // as "no preview" so the message renders clean.
  if (!preview.title && !preview.description && !preview.image) return null;
  return preview;
}

const cache = new Map<string, Promise<LinkPreview | null>>();
const CACHE_CAP = 300;

/** Fetch (or replay) the preview for a URL. Resolves null on any failure. */
export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const cached = cache.get(url);
  if (cached) return cached;

  const promise = (async (): Promise<LinkPreview | null> => {
    try {
      const res = await fetch(`/linkpreview?url=${encodeURIComponent(url)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      return normalize(await res.json(), url);
    } catch {
      return null;
    }
  })();

  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, promise);
  return promise;
}

/** Test hook: reset the module cache. */
export function _clearPreviewCache(): void {
  cache.clear();
}
