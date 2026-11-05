// SPDX-License-Identifier: AGPL-3.0-or-later
// Materialize per-route entry documents for the Elm client.
//
// Usage: node tools/materialize-elm-routes.mjs <distDir>
//
// Reads <distDir>/index.html (the Elm base document built from
// elm/index.html: exactly one <title>, meta description, canonical link,
// og:title/og:description/og:url, twitter:title/twitter:description) and
// writes <route>/index.html for every SPA route with stamped metadata,
// plus a noindex flat 404.html. Titles mirror `documentTitle` in
// elm/src/View.elm; descriptions mirror the public route table.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://eshmaki.me';

export const ELM_ROUTE_ENTRYPOINTS = [
  {
    route: 'app',
    title: 'Open Onyx — chat on the open network',
    description:
      'Open Onyx in your browser for local-first rooms, honest media security, live network context, and an identity you control.',
  },
  {
    route: 'about',
    title: 'About Onyx — rooms for your people',
    description:
      'Onyx is a community for rooms, messages, and calls. Private DMs when you want them. No ads. Open in your browser, or invite people you already know.',
  },
  {
    route: 'appearance',
    title: 'Appearance — Onyx',
    description: 'Choose an Onyx look, text size, and motion. Theme Studio and extra backgrounds stay under Advanced.',
  },
  {
    route: 'stats',
    title: 'Onyx stats — live room activity',
    description: 'See public Onyx room activity, network message trends, people online, and room sparklines.',
  },
  {
    route: 'status',
    title: 'Onyx status — are the rooms up?',
    description: 'See whether Onyx rooms are reachable tonight. If the public report is missing or stale, we cannot claim health.',
  },
  {
    route: 'roadmap',
    title: 'Onyx roadmap — rooms, calls, catch-up',
    description:
      'What we are working on: rooms that stay open, calls when you want them, catch-up when you come back, and a Home Screen on this device.',
  },
  {
    route: 'onyxos',
    title: 'OnyxOS + Onyx — communication at home in the system',
    description:
      'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
  },
  {
    route: 'invite',
    title: 'Join Onyx — open a room invite',
    description: 'See the room, choose a display name, and join in the browser. No account required for the first hello.',
  },
  {
    route: 'download',
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
  },
  {
    route: 'install',
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
    canonicalRoute: 'download',
  },
  {
    route: 'privacy',
    title: 'Onyx privacy — what stays here',
    description: 'Short facts about what the server stores, history on this device, and that this site does not sell ads.',
  },
  {
    route: 'guidelines',
    title: 'Onyx house rules',
    description: 'How we treat each other in the rooms, how to report harm, and that Onyx is not 911.',
  },
  {
    route: 'contact',
    title: 'Onyx contact',
    description: 'How to reach the project for ordinary questions and security reports. No invented mailbox.',
  },
  {
    route: 'accessibility',
    title: 'Onyx accessibility — access is a requirement',
    description:
      'Read the public Onyx accessibility contract for keyboard use, focus recovery, motion, contrast, and status announcements.',
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
  {
    route: 'guides',
    title: 'Onyx guides — join a room in the official app',
    description: 'Short how-tos for joining a room, inviting a friend, private messages, calls, and keeping Onyx on this device.',
  },
  {
    route: 'community',
    title: 'Onyx community — how to join and be here',
    description: 'How to join a room in Onyx, invite a friend, and treat each other well. The official app is the usual way in.',
  },
];

const NOT_FOUND = {
  title: 'Onyx — page not found',
  description: 'This Onyx address does not exist or is no longer available.',
};

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
    throw new Error(`Expected exactly one ${label} tag in the Elm entry document; found ${matches?.length ?? 0}`);
  }
  return html.replace(pattern, replacement);
}

export function stampElmRouteMetadata(html, entrypoint) {
  const title = escapeHtml(entrypoint.title);
  const description = escapeHtml(entrypoint.description);
  const canonicalRoute = entrypoint.canonicalRoute ?? entrypoint.route;
  const canonical = `${ORIGIN}/${canonicalRoute}/`;
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
    throw new Error(`Expected exactly one ${label} tag in the Elm entry document; found ${matches?.length ?? 0}`);
  }
  return html.replace(pattern, '');
}

// A branded 404 is a document, not a route: noindex, and never a
// canonical URL, OG url, or route structured data.
export function stampElmNotFoundMetadata(html) {
  let stamped = html;
  stamped = replaceExactlyOnce(
    stamped,
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(NOT_FOUND.title)}</title>`,
    'title',
  );
  stamped = replaceExactlyOnce(
    stamped,
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${escapeHtml(NOT_FOUND.description)}" />`,
    'description',
  );
  stamped = removeExactlyOnce(stamped, /<link\s+rel="canonical"[\s\S]*?\/>/, 'canonical');
  stamped = removeExactlyOnce(stamped, /<meta\s+property="og:url"[\s\S]*?\/>/, 'og:url');
  stamped = stamped.replace('</head>', '  <meta name="robots" content="noindex, nofollow" />\n</head>');
  return stamped;
}

async function main() {
  const distDir = resolve(process.argv[2] ?? '');
  if (!distDir || process.argv[2] === undefined) {
    console.error('FAIL: usage: node tools/materialize-elm-routes.mjs <distDir>');
    process.exit(1);
  }
  const base = await readFile(resolve(distDir, 'index.html'), 'utf8');
  for (const entry of ELM_ROUTE_ENTRYPOINTS) {
    const stamped = stampElmRouteMetadata(base, entry);
    const dir = resolve(distDir, entry.route);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'index.html'), stamped);
  }
  await writeFile(resolve(distDir, '404.html'), stampElmNotFoundMetadata(base));
  console.log(`materialized ${ELM_ROUTE_ENTRYPOINTS.length} Elm route documents + 404.html`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
