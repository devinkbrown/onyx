// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://eshmaki.me';

// Keep this list in sync with the public <Route> table in src/index.tsx.
// The landing overlay may replace some documents later in deploy.sh, but every
// SPA entrypoint is truthful on its own before that overlay is applied.
export const ROUTE_ENTRYPOINTS = [
  {
    route: 'app',
    title: 'Open Onyx — chat on the open mesh',
    description: 'Open Onyx in your browser for local-first rooms, honest media security, live network context, and an identity you control.',
  },
  {
    route: 'about',
    title: 'About Onyx — open protocol, sovereign mesh',
    description: 'Learn how Onyx, Cadence media, and the open mesh work together without closed-platform lock-in.',
  },
  {
    route: 'appearance',
    title: 'Onyx appearance — themes and backgrounds',
    description: 'Customize Onyx with accessible OKLCH themes, living backgrounds, and controls for motion, contrast, and transparency.',
  },
  {
    route: 'stats',
    title: 'Onyx stats — live room activity',
    description: 'See public Onyx room activity, network message trends, people online, and channel sparklines.',
  },
  {
    route: 'status',
    title: 'Onyx status — mesh health',
    description: 'Public Onyx mesh health, node uptime, peer latency, users online, and backup readiness.',
  },
  {
    route: 'roadmap',
    title: 'Onyx roadmap — what shipped and what is next',
    description: 'Track the public Onyx roadmap across memory, reach, privacy, presence, operations, and the time-native client work next.',
  },
  {
    route: 'invite',
    title: 'Join Onyx — open a room invite',
    description: 'Open an Onyx invite to join a room as a guest or with your account, carrying its topic, moment, and reading context.',
  },
  {
    route: 'accessibility',
    title: 'Onyx accessibility — access is a requirement',
    description: 'Read the public Onyx accessibility contract for keyboard use, focus recovery, motion, contrast, and status announcements.',
  },
  {
    route: 'glossary',
    title: 'Onyx glossary — names used across the mesh',
    description: 'A concise guide to Onyx, Onyx Server, Cadence, Mooring, Armor, and the open mesh.',
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
