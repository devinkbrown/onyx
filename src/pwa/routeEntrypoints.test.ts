// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const materializer = join(root, 'tools', 'materialize-route-entrypoints.mjs');
const baseDocument = readFileSync(join(root, 'index.html'), 'utf8');
const routeTable = readFileSync(join(root, 'src', 'index.tsx'), 'utf8');
const fallbackSitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');

const expected = {
  app: {
    title: 'Open Onyx — chat on the open mesh',
    description: 'Open Onyx in your browser for local-first rooms, honest media security, live network context, and an identity you control.',
  },
  about: {
    title: 'About Onyx — open protocol, sovereign mesh',
    description: 'Learn how Onyx, Cadence media, and the open mesh work together without closed-platform lock-in.',
  },
  appearance: {
    title: 'Onyx appearance — themes and backgrounds',
    description: 'Customize Onyx with accessible OKLCH themes, living backgrounds, and controls for motion, contrast, and transparency.',
  },
  stats: {
    title: 'Onyx stats — live room activity',
    description: 'See public Onyx room activity, network message trends, people online, and channel sparklines.',
  },
  status: {
    title: 'Onyx status — mesh health',
    description: 'Public Onyx mesh health, node uptime, peer latency, users online, and backup readiness.',
  },
  roadmap: {
    title: 'Onyx roadmap — what shipped and what is next',
    description: 'Track the public Onyx roadmap across memory, reach, privacy, presence, operations, and the time-native client work next.',
  },
  invite: {
    title: 'Join Onyx — open a room invite',
    description: 'Open an Onyx invite to join a room as a guest or with your account, carrying its topic, moment, and reading context.',
  },
  download: {
    title: 'Download Onyx — FreeBSD & OpenBSD native hosts',
    description: 'Download unsigned Onyx v0.1.3 FreeBSD and OpenBSD native host tarballs with install.sh. Not signed. Browser and PWA remain the primary paths.',
  },
  accessibility: {
    title: 'Onyx accessibility — access is a requirement',
    description: 'Read the public Onyx accessibility contract for keyboard use, focus recovery, motion, contrast, and status announcements.',
  },
  glossary: {
    title: 'Onyx glossary — names used across the mesh',
    description: 'A concise guide to Onyx, Onyx Server, Cadence, Mooring, Armor, and the open mesh.',
  },
  integrations: {
    title: 'Onyx integrations — constrained by design',
    description: 'Learn how Onyx renders reviewed integration content and keeps extension actions capability-scoped.',
  },
  agents: {
    title: 'Onyx agent safety — automation with boundaries',
    description: 'Read the public contract for labelled, reviewed, capability-scoped automation in Onyx.',
  },
} as const;

const workspaces: string[] = [];

function workspace(document = baseDocument): string {
  const directory = mkdtempSync(join(tmpdir(), 'onyx-entrypoints-'));
  workspaces.push(directory);
  mkdirSync(join(directory, 'dist'));
  writeFileSync(join(directory, 'dist', 'index.html'), document);
  return join(directory, 'dist');
}

function materialize(dist: string): void {
  execFileSync(process.execPath, [materializer, dist], { stdio: 'pipe' });
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SPA route entrypoint materializer', () => {
  it('covers every non-root route in the Solid router table', () => {
    // Whitespace-robust: lazy PublicInfo routes use multiline <Route\n path=.../>.
    const routes = [...routeTable.matchAll(/<Route\s+path="\/([^"/]+)\/?"/g)]
      .map((match) => match[1])
      .filter((route): route is string => route !== undefined);

    expect([...new Set(routes)].sort()).toEqual(Object.keys(expected).sort());
  });

  it('writes route-correct canonical, Open Graph, and descriptive metadata', () => {
    const dist = workspace();
    materialize(dist);

    for (const [route, meta] of Object.entries(expected)) {
      const html = readFileSync(join(dist, route, 'index.html'), 'utf8');
      const document = new DOMParser().parseFromString(html, 'text/html');
      const canonical = `https://eshmaki.me/${route}/`;

      expect(html, route).not.toMatch(/IRCXNet/i);
      expect(document.title, route).toBe(meta.title);
      expect(document.querySelector('meta[name="description"]')?.getAttribute('content'), route)
        .toBe(meta.description);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), route)
        .toBe(canonical);
      expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content'), route)
        .toBe(meta.title);
      expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content'), route)
        .toBe(meta.description);
      expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content'), route)
        .toBe(canonical);
      expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content'), route)
        .toBe('Onyx');
      expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content'), route)
        .toBe('https://eshmaki.me/icon-512.png');
      expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content'), route)
        .toBe('512');
      expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content'), route)
        .toBe('512');
      expect(document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content'), route)
        .toMatch(/Onyx water-current mark/i);
      expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'), route)
        .toBe(meta.title);
      expect(document.querySelector('meta[name="twitter:description"]')?.getAttribute('content'), route)
        .toBe(meta.description);
      expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'), route)
        .toBe('https://eshmaki.me/icon-512.png');
      expect(document.querySelector('meta[name="twitter:image:alt"]')?.getAttribute('content'), route)
        .toMatch(/Onyx water-current mark/i);
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href'), route)
        .toBe('/favicon.ico');
      expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'), route)
        .toBe('/icon-192.png');
    }
  });

  it('keeps the fallback sitemap on the same final public route canonicals', () => {
    const locations = [...fallbackSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => match[1])
      .filter((location): location is string => location !== undefined);

    expect(locations.length).toBeGreaterThan(1);
    expect(new Set(locations).size).toBe(locations.length);
    for (const location of locations) {
      const url = new URL(location);
      expect(url.origin, location).toBe('https://eshmaki.me');
      expect(url.search, location).toBe('');
      expect(url.hash, location).toBe('');
      expect(url.pathname === '/' || url.pathname.endsWith('/'), location).toBe(true);
    }
  });

  it('leaves the root Vite document untouched', () => {
    const dist = workspace();
    materialize(dist);

    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(baseDocument);
  });

  it('fails before deployment when the Vite metadata contract drifts', () => {
    const dist = workspace('<!doctype html><html><head><title>Onyx</title></head><body></body></html>');

    expect(() => materialize(dist)).toThrow();
  });
});
