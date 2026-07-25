// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * linkPreview.ts — OpenGraph unfurl client.
 *
 * The browser never touches the target site: previews come from the network's
 * own same-origin `/linkpreview?url=` endpoint (upload_server.py), which
 * fetches the page server-side, extracts OG metadata, and caches it.
 *
 * Module-level cache + in-flight dedupe so a busy channel doesn't stampede
 * the endpoint with one request per rendered message.
 *
 * SECURITY: every URL is validated (`isPreviewableUrl`) before it is enqueued —
 * only plain http(s) web targets with no credentials and no internal/private
 * host reach the fetcher. The same-origin `/linkpreview` endpoint is the real
 * SSRF boundary; this client-side gate is defense in depth and keeps obviously
 * hostile URLs (javascript:/data:, localhost, 169.254.169.254, …) off the wire.
 */
import { fetchPublicJson } from '@/lib/stats/fetchPublicJson';
import {
  mayUnfurlUrl,
  PREVIEW_SSRF_ONLY,
  type UnfurlPrivacyPrefs,
} from './unfurlPrivacy';

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  site: string;
}

/** Hosts whose links never get an OG card (our own media already unfurls). */
const SKIP_HOSTS = new Set(['eshmaki.me', 'www.eshmaki.me']);
export const LINK_PREVIEW_URL_MAX = 2048;
export const LINK_PREVIEW_HREF_SCAN_MAX = 64;
export const LINK_PREVIEW_TITLE_MAX = 512;
export const LINK_PREVIEW_DESCRIPTION_MAX = 2048;
export const LINK_PREVIEW_SITE_MAX = 128;

/** Non-routable / internal host names that must never reach the fetcher. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
]);

/**
 * True when a bare IPv4 dotted-quad falls in a private / loopback / link-local /
 * CGNAT / unspecified range (defense in depth vs SSRF — the server guards too).
 */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return true; // malformed quad → reject
  return (
    a === 0 || // 0.0.0.0/8 unspecified
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (incl. cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 CGNAT
  );
}

/**
 * True when an IPv6 literal (URL.hostname keeps the brackets) is loopback,
 * unspecified, unique-local (fc00::/7), link-local (fe80::/10), or an
 * IPv4-mapped address pointing at a private IPv4.
 */
function isPrivateIPv6(host: string): boolean {
  if (!host.startsWith('[') || !host.endsWith(']')) return false;
  const inner = host.slice(1, -1).toLowerCase();
  if (inner === '::1' || inner === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(inner)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(inner)) return true; // fe80::/10 link-local
  // IPv4-mapped (::ffff:a.b.c.d) — the URL parser may normalize the trailing
  // octets to hex (::ffff:7f00:1), so accept both spellings.
  const mappedDotted = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(inner);
  if (mappedDotted && isPrivateIPv4(mappedDotted[1] ?? '')) return true;
  const mappedHex = /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1] ?? '', 16);
    const lo = parseInt(mappedHex[2] ?? '', 16);
    const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    if (isPrivateIPv4(dotted)) return true;
  }
  return false;
}

/**
 * Validate an href as a safe preview TARGET before it is ever enqueued for the
 * fetcher. Rejects anything that isn't a plain http(s) web URL: non-http(s)
 * schemes (javascript:/data:/file:/…), embedded credentials, and hosts that
 * look internal (localhost, `.local`/`.internal`, private/loopback/link-local
 * IP literals). This is defense in depth — the server endpoint is the real
 * SSRF boundary — but it keeps obviously-hostile URLs off the wire entirely.
 */
export function isPreviewableUrl(
  href: string,
  privacy: UnfurlPrivacyPrefs = PREVIEW_SSRF_ONLY,
): boolean {
  if (href.length === 0 || href.length > LINK_PREVIEW_URL_MAX) return false;
  // Shared privacy gate (linkPreviews off, https-only, blocked hosts, private
  // nets) — fail closed. Unfurl sinks must pass privacy from
  // `unfurlPrivacyFromPrefs(preferences())` so https-only + host blocklist apply.
  if (!mayUnfurlUrl(href, privacy)) return false;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // Credentials in the authority are a classic SSRF/parser-confusion vector.
  if (parsed.username !== '' || parsed.password !== '') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === '') return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return false;
  }
  if (isPrivateIPv4(host)) return false;
  if (isPrivateIPv6(host)) return false;
  return true;
}

/**
 * Pick the URL to preview from a message's link hrefs: the first plain http(s)
 * web link that is not one of our own uploads (those render as inline media)
 * and is not an internal / non-routable target.
 *
 * Pass `privacy` from user preferences at unfurl sinks so `linkPreviews` /
 * https-only / blocked hosts are enforced via `mayUnfurlUrl`.
 */
export function pickPreviewUrl(
  hrefs: readonly string[],
  privacy: UnfurlPrivacyPrefs = PREVIEW_SSRF_ONLY,
): string | null {
  for (const href of hrefs.slice(0, LINK_PREVIEW_HREF_SCAN_MAX)) {
    if (!isPreviewableUrl(href, privacy)) continue;
    const parsed = new URL(href);
    if (SKIP_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/uploads/')) continue;
    return href;
  }
  return null;
}

function normalize(raw: unknown, url: string): LinkPreview | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, maxLength: number): string => (
    typeof v === 'string' ? v.slice(0, maxLength).trim() : ''
  );
  const canonical = str(r['url'], LINK_PREVIEW_URL_MAX);
  const image = str(r['image'], LINK_PREVIEW_URL_MAX);
  const preview: LinkPreview = {
    url: canonical && isPreviewableUrl(canonical) ? canonical : url,
    title: str(r['title'], LINK_PREVIEW_TITLE_MAX),
    description: str(r['description'], LINK_PREVIEW_DESCRIPTION_MAX),
    image: image && isPreviewableUrl(image) ? image : '',
    site: str(r['site'], LINK_PREVIEW_SITE_MAX),
  };
  // A card with neither title nor description nor image is worthless — treat
  // as "no preview" so the message renders clean.
  if (!preview.title && !preview.description && !preview.image) return null;
  return preview;
}

const cache = new Map<string, Promise<LinkPreview | null>>();
const CACHE_CAP = 300;

/**
 * Fetch (or replay) the preview for a URL. Resolves null on any failure.
 * Pass `privacy` at unfurl sinks so disabled `linkPreviews` never hits the wire.
 */
export function fetchLinkPreview(
  url: string,
  privacy: UnfurlPrivacyPrefs = PREVIEW_SSRF_ONLY,
): Promise<LinkPreview | null> {
  // Fail closed: an unsafe / privacy-blocked target never reaches the network.
  // Not cached — a rejected URL is cheap to re-validate and we don't want it
  // holding a slot.
  if (!isPreviewableUrl(url, privacy)) return Promise.resolve(null);

  const cached = cache.get(url);
  if (cached) return cached;

  // `transient` flags a network error / non-ok response (as opposed to a
  // legitimate empty-metadata result). Transient failures are evicted from the
  // cache after they settle, so a single endpoint blip doesn't permanently
  // suppress a link's preview for the rest of the session; a stable
  // empty-metadata answer stays cached to avoid a retry storm.
  let transient = false;
  const promise = (async (): Promise<LinkPreview | null> => {
    const raw = await fetchPublicJson(`/linkpreview?url=${encodeURIComponent(url)}`);
    if (raw === null) {
      transient = true;
      return null;
    }
    return normalize(raw, url);
  })();

  // Evict only if this exact promise is still cached, so a newer in-flight
  // fetch for the same URL is never clobbered.
  void promise.then(() => {
    if (transient && cache.get(url) === promise) cache.delete(url);
  });

  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, promise);
  return promise;
}

/** Release URL keys and fetched metadata at an account/session boundary. */
export function clearLinkPreviewCache(): void {
  cache.clear();
}

/** @deprecated Test compatibility alias. */
export const _clearPreviewCache = clearLinkPreviewCache;
