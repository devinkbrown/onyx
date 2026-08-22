// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://eshmaki.me';
const NOT_FOUND_ENTRYPOINT = {
  title: 'Onyx — page not found',
  description: 'This Onyx address does not exist or is no longer available.',
};

// Keep this list in sync with the public <Route> table in src/index.tsx.
// The Vite/Solid SPA owns root and these SPA route documents. deploy.sh may
// stage allowlisted legacy support paths from /home/kain/landing, but never
// replaces SPA-owned documents (root index, robots/sitemap/favicons, route
// entrypoints, assets, service worker, icons, or SPA public routes).
export const ROUTE_ENTRYPOINTS = [
  {
    route: 'app',
    title: 'Open Onyx — chat on the open network',
    description: 'Open Onyx in your browser for local-first rooms, honest media security, live network context, and an identity you control.',
  },
  {
    route: 'about',
    title: 'About Onyx — rooms for your people',
    description: 'Onyx is a community for rooms, messages, and calls. Private DMs when you want them. No ads. Open in your browser, or invite people you already know.',
  },
  {
    route: 'appearance',
    title: 'Onyx appearance — look, text size, and motion',
    description: 'Choose an Onyx look, text size, and motion. Theme Studio and extra backgrounds stay under Advanced.',
  },
  {
    route: 'stats',
    title: 'Onyx stats — live room activity',
    description: 'See public Onyx room activity, network message trends, people online, and room sparklines.',
  },
  {
    route: 'status',
    title: 'Onyx status — network health',
    description: 'Public Onyx network health, node uptime, peer latency, users online, and backup readiness.',
  },
  {
    route: 'roadmap',
    title: 'Onyx roadmap — what shipped and what is next',
    description: 'Track the public Onyx roadmap across memory, reach, privacy, presence, operations, and the time-native client work next.',
  },
  {
    route: 'onyxos',
    title: 'OnyxOS + Onyx — communication at home in the system',
    description: 'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
  },
  {
    route: 'invite',
    title: 'Join Onyx — open a room invite',
    description: 'Open an Onyx invite to join a room as a guest or with your account, carrying its topic, moment, and reading context.',
  },
  {
    route: 'download',
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
  },
  {
    route: 'install',
    title: 'Install Onyx on this device — browser first',
    description:
      'Install Onyx in your browser, or keep it on this device. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
  },
  {
    route: 'accessibility',
    title: 'Onyx accessibility — access is a requirement',
    description: 'Read the public Onyx accessibility contract for keyboard use, focus recovery, motion, contrast, and status announcements.',
  },
  {
    route: 'glossary',
    title: 'Onyx glossary — names used across the network',
    description: 'A concise guide to Onyx, Onyx Server, Cadence, Mooring, Armor, and the open network.',
  },
  {
    route: 'integrations',
    title: 'Onyx integrations — constrained by design',
    description: 'Learn how Onyx renders reviewed integration content and keeps extension actions capability-scoped.',
  },
  {
    route: 'agents',
    title: 'Onyx agent safety — automation with boundaries',
    description: 'Read the public contract for labelled, reviewed, capability-scoped automation in Onyx.',
  },
];

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function replaceExactlyOnce(html, pattern, replacement, label) {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  if (matches?.length !== 1) {
    throw new Error(`Expected exactly one ${label} tag in the Vite entry document; found ${matches?.length ?? 0}`);
  }
  return html.replace(pattern, replacement);
}

export function stampRouteMetadata(html, entrypoint) {
  const title = escapeHtml(entrypoint.title);
  const description = escapeHtml(entrypoint.description);
  const canonical = `${ORIGIN}/${entrypoint.route}/`;
  let stamped = html;

  stamped = replaceExactlyOnce(stamped, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`, 'title');
  stamped = replaceExactlyOnce(
    stamped,
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${description}" />`,
    'description',
  );
  stamped = replaceExactlyOnce(
    stamped,
    /<link\s+rel="canonical"[\s\S]*?\/>/,
    `<link rel="canonical" href="${canonical}" />`,
    'canonical',
  );

  for (const [property, content] of [
    ['og:title', title],
    ['og:description', description],
    ['og:url', canonical],
  ]) {
    stamped = replaceExactlyOnce(
      stamped,
      new RegExp(`<meta\\s+property="${property}"[\\s\\S]*?\\/>`),
      `<meta property="${property}" content="${content}" />`,
      property,
    );
  }

  for (const [name, content] of [
    ['twitter:title', title],
    ['twitter:description', description],
  ]) {
    stamped = replaceExactlyOnce(
      stamped,
      new RegExp(`<meta\\s+name="${name}"[\\s\\S]*?\\/>`),
      `<meta name="${name}" content="${content}" />`,
      name,
    );
  }

  return stamped;
}

function removeExactlyOnce(html, pattern, label) {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  if (matches?.length !== 1) {
    throw new Error(`Expected exactly one ${label} tag in the Vite entry document; found ${matches?.length ?? 0}`);
  }
  return html.replace(pattern, '');
}

// A branded 404 is a document, not an SPA route: it must never advertise a
// canonical public URL, an Open Graph URL, or route structured data that can
// cause crawlers to index an unknown address as a successful page.
export function stampNotFoundMetadata(html) {
  let stamped = html;
  stamped = replaceExactlyOnce(
    stamped,
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(NOT_FOUND_ENTRYPOINT.title)}</title>`,
    'title',
  );
  stamped = replaceExactlyOnce(
    stamped,
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${escapeHtml(NOT_FOUND_ENTRYPOINT.description)}" />`,
    'description',
  );
  stamped = removeExactlyOnce(stamped, /\s*<link\s+rel="canonical"[\s\S]*?\/>/, 'canonical');
  stamped = removeExactlyOnce(stamped, /\s*<meta\s+property="og:url"[\s\S]*?\/>/, 'og:url');
  stamped = stamped.replace(/\s*<script\s+type="application\/ld\+json"[\s\S]*?<\/script>/g, '');
  stamped = stamped.replace(
    /(<meta\s+name="description"[\s\S]*?\/>)/,
    '$1\n    <meta name="robots" content="noindex, nofollow" data-onyx-route-robots="true" />',
  );
  return stamped;
}

export async function materializeRouteEntrypoints(distDir) {
  const root = resolve(distDir);
  const base = await readFile(resolve(root, 'index.html'), 'utf8');

  for (const entrypoint of ROUTE_ENTRYPOINTS) {
    const routeDir = resolve(root, entrypoint.route);
    await mkdir(routeDir, { recursive: true });
    await writeFile(
      resolve(routeDir, 'index.html'),
      stampRouteMetadata(base, entrypoint),
      'utf8',
    );
  }

  // Keep this flat. nginx internally serves this exact file while retaining
  // the original 404 status; a /404/index.html directory would invite a
  // successful SPA fallback and a soft-404 response.
  await writeFile(resolve(root, '404.html'), stampNotFoundMetadata(base), 'utf8');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const distDir = process.argv[2];
  if (!distDir) {
    console.error('Usage: node tools/materialize-route-entrypoints.mjs <dist-directory>');
    process.exitCode = 2;
  } else {
    await materializeRouteEntrypoints(distDir);
  }
}
