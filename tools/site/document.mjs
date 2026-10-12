// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pure rendering of the site's HTML documents: route head metadata (title,
 * description, canonical, Open Graph / Twitter, icons, manifest, structured
 * data) + the Elm head parts (device <meta>, stylesheets) + the Elm boot body.
 * No filesystem access here; tools/build-site.mjs does the I/O.
 */
import {
  HOME_ENTRYPOINT,
  NOT_FOUND_ENTRYPOINT,
  ORIGIN,
  ROUTE_ENTRYPOINTS,
  SHARE_IMAGE,
} from './routes.mjs';

/** Where the Elm build's hashed assets are served (the deploy's retained, cache-first asset tree). */
export const ASSET_PREFIX = '/assets/elm/';

/** <meta> tags the Elm shell owns (viewport-fit=cover, PWA chrome, colour scheme). */
export const DEVICE_META = [
  'viewport',
  'theme-color',
  'color-scheme',
  'mobile-web-app-capable',
  'apple-mobile-web-app-capable',
  'apple-mobile-web-app-status-bar-style',
  'apple-mobile-web-app-title',
  'format-detection',
];

export function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const LD_JSON = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: 'Onyx', url: `${ORIGIN}/` },
    {
      '@type': 'SoftwareApplication',
      name: 'Onyx',
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'Web',
      url: `${ORIGIN}/app/`,
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
    },
  ],
};

/**
 * The page models. `wrap` marks the tags the home document has always
 * serialised over several lines (kept so the emitted bytes match the deployed
 * site); the 404 document inherits the home document's share text.
 */
export function homePage() {
  const { title, description } = HOME_ENTRYPOINT;
  return {
    kind: 'home',
    file: 'index.html',
    title,
    description,
    canonical: `${ORIGIN}/`,
    ogTitle: title,
    ogDescription: description,
    ogUrl: `${ORIGIN}/`,
    twitterTitle: title,
    twitterDescription: description,
    wrap: { description: true, ogDescription: true, twitterDescription: true },
    ldJson: true,
    robots: null,
  };
}

export function routePage(entrypoint) {
  const canonicalRoute = entrypoint.canonicalRoute ?? entrypoint.route;
  const canonical = `${ORIGIN}/${canonicalRoute}/`;
  return {
    kind: 'route',
    file: `${entrypoint.route}/index.html`,
    title: entrypoint.title,
    description: entrypoint.description,
    canonical,
    ogTitle: entrypoint.title,
    ogDescription: entrypoint.description,
    ogUrl: canonical,
    twitterTitle: entrypoint.title,
    twitterDescription: entrypoint.description,
    wrap: { description: false, ogDescription: false, twitterDescription: false },
    ldJson: true,
    robots: null,
  };
}

/**
 * A branded 404 is a document, not a route: it never advertises a canonical
 * public URL, an Open Graph URL or structured data that could make crawlers
 * index an unknown address as a successful page, and it says so (noindex).
 */
export function notFoundPage() {
  const { title, description } = HOME_ENTRYPOINT;
  return {
    kind: 'not-found',
    file: '404.html',
    title: NOT_FOUND_ENTRYPOINT.title,
    description: NOT_FOUND_ENTRYPOINT.description,
    canonical: null,
    ogTitle: title,
    ogDescription: description,
    ogUrl: null,
    twitterTitle: title,
    twitterDescription: description,
    wrap: { description: false, ogDescription: true, twitterDescription: true },
    ldJson: false,
    robots: 'noindex, nofollow',
  };
}

/** Every document the site serves, in emit order. */
export function allPages() {
  return [homePage(), ...ROUTE_ENTRYPOINTS.map(routePage), notFoundPage()];
}

function meta(attr, name, value, wrap) {
  const content = escapeHtml(value);
  return wrap
    ? `<meta\n      ${attr}="${name}"\n      content="${content}"\n    />`
    : `<meta ${attr}="${name}" content="${content}" />`;
}

function renderHeadMetadata(page) {
  const lines = [
    '<meta charset="UTF-8" />',
    `<title>${escapeHtml(page.title)}</title>`,
    meta('name', 'description', page.description, page.wrap.description),
  ];
  if (page.robots) {
    lines.push(`<meta name="robots" content="${page.robots}" data-onyx-route-robots="true" />`);
  }
  lines.push(
    '<link rel="manifest" href="/manifest.json" />',
    '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />',
  );
  if (page.canonical) lines.push(`<link rel="canonical" href="${page.canonical}" />`);
  const image = `${ORIGIN}${SHARE_IMAGE.path}`;
  lines.push(
    '<meta name="application-name" content="Onyx" />',
    `<meta property="og:title" content="${escapeHtml(page.ogTitle)}" />`,
    meta('property', 'og:description', page.ogDescription, page.wrap.ogDescription),
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Onyx" />',
  );
  if (page.ogUrl) lines.push(`<meta property="og:url" content="${page.ogUrl}" />`);
  lines.push(
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:type" content="image/png" />',
    `<meta property="og:image:width" content="${SHARE_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${SHARE_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(SHARE_IMAGE.alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(page.twitterTitle)}" />`,
    meta('name', 'twitter:description', page.twitterDescription, page.wrap.twitterDescription),
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(SHARE_IMAGE.alt)}" />`,
  );
  if (page.ldJson) {
    const json = JSON.stringify(LD_JSON, null, 2)
      .split('\n')
      .map((line) => `      ${line}`)
      .join('\n');
    lines.push(`<script type="application/ld+json">\n${json}\n    </script>`);
  }
  return lines;
}

/** Make an Elm-relative `href`/`src` absolute under the deployed asset prefix. */
export function absolutize(html) {
  return html.replace(
    /(href|src)="(?!https?:|\/|#|data:)([^"]+)"/g,
    (_, attr, path) => `${attr}="${ASSET_PREFIX}${path}"`,
  );
}

const metaName = (tag) => /\bname="([^"]+)"/i.exec(tag)?.[1]?.toLowerCase() ?? '';

/**
 * Extract what the Elm build's own index.html contributes to every document:
 * its device <meta> tags, its stylesheet links (in cascade order — the order
 * in elm/index.html IS the cascade order) and its boot body. Throws a plain
 * Error naming the first thing that is missing; build-site.mjs turns that
 * into a failed build.
 */
export function elmParts(elmHtml) {
  const head = /<head>([\s\S]*?)<\/head>/i.exec(elmHtml)?.[1];
  if (head === undefined) throw new Error('elm index has no <head>');
  const styles = (head.match(/<link[^>]+rel="stylesheet"[^>]*>/gi) ?? []).map(absolutize);
  if (styles.length === 0) throw new Error('elm index has no stylesheets');
  const deviceMeta = (head.match(/<meta\b[^>]*>/gi) ?? []).filter((tag) =>
    DEVICE_META.includes(metaName(tag)),
  );
  // Fail closed if the Elm head stops carrying the viewport the safe-area
  // layout depends on.
  if (!deviceMeta.some((tag) => metaName(tag) === 'viewport' && /viewport-fit=cover/.test(tag))) {
    throw new Error('elm index lacks <meta name="viewport" … viewport-fit=cover>');
  }
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(elmHtml)?.[1];
  if (body === undefined) throw new Error('elm index has no <body>');
  const bootBody = absolutize(body);
  if (!bootBody.includes('Elm.Main.init')) throw new Error('elm body lacks Elm.Main.init');
  return { styles, deviceMeta, bootBody };
}

/** The complete HTML document for one page. */
export function renderDocument(page, parts) {
  const head = [...renderHeadMetadata(page), ...parts.deviceMeta, ...parts.styles].join('\n    ');
  return [
    '<!doctype html>',
    '<!-- data-theme="ocean" is the default theme id (elm/src/ThemeLook.elm defaultThemeId): the pre-hydration guard -->',
    '<html lang="en" data-theme="ocean">',
    '  <head>',
    `    ${head}`,
    '  </head>',
    `  <body>${parts.bootBody}</body>`,
    '</html>',
    '',
  ].join('\n');
}
