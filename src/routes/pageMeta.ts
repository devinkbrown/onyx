// SPDX-License-Identifier: AGPL-3.0-or-later
const DEFAULT_ORIGIN = 'https://eshmaki.me';

function upsertMeta(selector: string, attrs: Record<string, string>): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    document.head.append(meta);
  }
  for (const [key, value] of Object.entries(attrs)) meta.setAttribute(key, value);
  return meta;
}

function upsertLink(selector: string, attrs: Record<string, string>): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement('link');
    document.head.append(link);
  }
  for (const [key, value] of Object.entries(attrs)) link.setAttribute(key, value);
  return link;
}

function canonicalUrl(path = '/'): string {
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : DEFAULT_ORIGIN;
  const url = new URL(path, origin);
  // nginx canonicalises directory entrypoints to a trailing slash. Keep the
  // metadata on that final URL so hydration never replaces a truthful stamped
  // canonical with one that redirects. Query context may be meaningful for a
  // rich invite; fragments are local-only and never belong in canonical URLs.
  if (
    url.origin === origin
    && url.pathname !== '/'
    && !url.pathname.endsWith('/')
    && !url.pathname.split('/').at(-1)?.includes('.')
  ) {
    url.pathname += '/';
  }
  url.hash = '';
  return url.toString();
}

/**
 * Small client-side metadata helper for the static SPA routes.
 *
 * Vite serves one index.html, so each public route updates metadata after
 * navigation. Tests run in jsdom; production runs in the browser.
 */
export function setPageMeta(title: string, description: string, path = '/'): void {
  if (typeof document === 'undefined') return;
  document.querySelector('meta[data-onyx-route-robots]')?.remove();
  const url = canonicalUrl(path);
  document.title = title;
  upsertMeta('meta[name="description"]', { name: 'description', content: description });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
  const image = new URL('/og.png', url).toString();
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: image });
  upsertMeta('meta[property="og:image:type"]', { property: 'og:image:type', content: 'image/png' });
  upsertMeta('meta[property="og:image:width"]', { property: 'og:image:width', content: '1200' });
  upsertMeta('meta[property="og:image:height"]', { property: 'og:image:height', content: '630' });
  upsertMeta('meta[property="og:image:alt"]', {
    property: 'og:image:alt',
    content: 'Onyx — a quiet harbor at night. Conversation glowing on a dark pier.',
  });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: image });
  upsertMeta('meta[name="twitter:image:alt"]', {
    name: 'twitter:image:alt',
    content: 'Onyx — a quiet harbor at night. Conversation glowing on a dark pier.',
  });
  upsertLink('link[rel="canonical"]', { rel: 'canonical', href: url });

  let json = document.querySelector<HTMLScriptElement>('script[data-onyx-route-jsonld]');
  if (!json) {
    json = document.createElement('script');
    json.type = 'application/ld+json';
    json.dataset.onyxRouteJsonld = 'true';
    document.head.append(json);
  }
  json.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Onyx',
      url: canonicalUrl('/'),
    },
  });
}
