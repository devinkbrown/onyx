// SPDX-License-Identifier: AGPL-3.0-or-later
// Contract tests for the static site generator (tools/build-site.mjs +
// tools/site/*): per-route <head> metadata, the flat non-indexable 404, the
// route table <-> elm/src/Route.elm parity, fail-closed checks, and the
// locked public brand assets under public/.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SiteBuildError, buildSite } from '../build-site.mjs';
import { allPages, elmParts, renderDocument } from './document.mjs';
import { HOME_ENTRYPOINT, NOT_FOUND_ENTRYPOINT, ROUTE_ENTRYPOINTS } from './routes.mjs';
import { buildTestSite, repo, writeFixtureElmDist } from './testSite.mjs';

const expected = {
  app: {
    title: 'Open Onyx — chat on the open network',
    description: 'Open Onyx in your browser for local-first rooms, honest media security, live network context, and an identity you control.',
  },
  about: {
    title: 'About Onyx — rooms for your people',
    description: 'Onyx is a community for rooms, messages, and calls. Private DMs when you want them. No ads. Open in your browser, or invite people you already know.',
  },
  appearance: {
    title: 'Onyx appearance — look, text size, and motion',
    description: 'Choose an Onyx look, text size, and motion. Theme Studio and extra backgrounds stay under Advanced.',
  },
  stats: {
    title: 'Onyx stats — live room activity',
    description: 'See public Onyx room activity, network message trends, people online, and room sparklines.',
  },
  status: {
    title: 'Onyx status — are the rooms up?',
    description: 'See whether Onyx rooms are reachable tonight. If the public report is missing or stale, we cannot claim health.',
  },
  roadmap: {
    title: 'Onyx roadmap — rooms, calls, catch-up',
    description: 'What we are working on: rooms that stay open, calls when you want them, catch-up when you come back, and a Home Screen on this device.',
  },
  onyxos: {
    title: 'OnyxOS + Onyx — communication at home in the system',
    description: 'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
  },
  invite: {
    title: 'Join Onyx — open a room invite',
    description: 'See the room, choose a display name, and join in the browser. No account required for the first hello.',
  },
  download: {
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
  },
  install: {
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
    canonical: 'https://eshmaki.me/download/',
  },
  privacy: {
    title: 'Onyx privacy — what stays here',
    description: 'Short facts about what the server stores, history on this device, and that this site does not sell ads.',
  },
  guidelines: {
    title: 'Onyx house rules',
    description: 'How we treat each other in the rooms, how to report harm, and that Onyx is not 911.',
  },
  contact: {
    title: 'Onyx contact',
    description: 'How to reach the project for ordinary questions and security reports. No invented mailbox.',
  },
  accessibility: {
    title: 'Onyx accessibility — access is a requirement',
    description: 'Read the public Onyx accessibility contract for keyboard use, focus recovery, motion, contrast, and status announcements.',
  },
  glossary: {
    title: 'Onyx glossary — names used across the network',
    description: 'A concise guide to Onyx, Onyx Server, Cadence, Mooring, Armor, and the open network.',
  },
  integrations: {
    title: 'Onyx integrations — constrained by design',
    description: 'Learn how Onyx renders reviewed integration content and keeps extension actions capability-scoped.',
  },
  agents: {
    title: 'Onyx agent safety — automation with boundaries',
    description: 'Read the public contract for labelled, reviewed, capability-scoped automation in Onyx.',
  },
  guides: {
    title: 'Onyx guides — join a room in the official app',
    description: 'Short how-tos for joining a room, inviting a friend, private messages, calls, and keeping Onyx on this device.',
  },
  community: {
    title: 'Onyx community — how to join and be here',
    description: 'How to join a room in Onyx, invite a friend, and treat each other well. The official app is the usual way in.',
  },
};

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const attr = (document, selector, name) => document.querySelector(selector)?.getAttribute(name);

let site;
beforeAll(() => {
  site = buildTestSite();
});

describe('route table', () => {
  it('pins every route entrypoint (title + description)', () => {
    const table = Object.fromEntries(ROUTE_ENTRYPOINTS.map((e) => [e.route, e]));
    expect(Object.keys(table).sort()).toEqual(Object.keys(expected).sort());
    for (const [route, meta] of Object.entries(expected)) {
      expect(table[route].title, route).toBe(meta.title);
      expect(table[route].description, route).toBe(meta.description);
    }
    expect(new Set(ROUTE_ENTRYPOINTS.map((e) => e.route)).size).toBe(ROUTE_ENTRYPOINTS.length);
  });

  it('covers exactly the non-root routes of elm/src/Route.elm', () => {
    const elm = readFileSync(join(repo, 'elm/src/Route.elm'), 'utf8');
    const parser = elm.slice(elm.indexOf('parser ='), elm.indexOf('fromUrl :'));
    const paths = [...parser.matchAll(/\(s "([a-z]+)"\)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    expect([...new Set(paths)].sort()).toEqual(ROUTE_ENTRYPOINTS.map((e) => e.route).sort());
    // the Landing route is the root document; NotFound is the flat 404
    expect(parser).toContain('map Landing top');
    expect(elm).toContain('| NotFound');
  });

  it('keeps the fallback sitemap on the same final public route canonicals', () => {
    const sitemap = readFileSync(join(repo, 'public/sitemap.xml'), 'utf8');
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locations.length).toBeGreaterThan(1);
    expect(new Set(locations).size).toBe(locations.length);
    expect(locations).not.toContain('https://eshmaki.me/onyxos/');
    expect(locations).not.toContain('https://eshmaki.me/stats/');
    for (const location of locations) {
      const url = new URL(location);
      expect(url.origin, location).toBe('https://eshmaki.me');
      expect(url.search, location).toBe('');
      expect(url.hash, location).toBe('');
      expect(url.pathname === '/' || url.pathname.endsWith('/'), location).toBe(true);
    }
  });
});

describe('generated documents', () => {
  it('emits one document per route, the root and the flat 404', () => {
    expect(site.summary.pages).toBe(ROUTE_ENTRYPOINTS.length + 2);
    for (const route of Object.keys(expected)) expect(existsSync(join(site.dist, route, 'index.html')), route).toBe(true);
    expect(existsSync(join(site.dist, 'index.html'))).toBe(true);
    expect(existsSync(join(site.dist, '404.html'))).toBe(true);
    expect(existsSync(join(site.dist, '404'))).toBe(false);
  });

  it('writes route-correct canonical, Open Graph, and descriptive metadata', () => {
    for (const [route, meta] of Object.entries(expected)) {
      const html = site.read(`${route}/index.html`);
      const document = parse(html);
      const canonical = meta.canonical ?? `https://eshmaki.me/${route}/`;
      expect(html, route).not.toMatch(/IRCXNet/i);
      expect(document.title, route).toBe(meta.title);
      expect(attr(document, 'meta[name="description"]', 'content'), route).toBe(meta.description);
      expect(attr(document, 'link[rel="canonical"]', 'href'), route).toBe(canonical);
      expect(attr(document, 'meta[property="og:title"]', 'content'), route).toBe(meta.title);
      expect(attr(document, 'meta[property="og:description"]', 'content'), route).toBe(meta.description);
      expect(attr(document, 'meta[property="og:url"]', 'content'), route).toBe(canonical);
      expect(attr(document, 'meta[property="og:site_name"]', 'content'), route).toBe('Onyx');
      expect(attr(document, 'meta[property="og:image"]', 'content'), route).toBe('https://eshmaki.me/og.png');
      expect(attr(document, 'meta[property="og:image:width"]', 'content'), route).toBe('1200');
      expect(attr(document, 'meta[property="og:image:height"]', 'content'), route).toBe('630');
      expect(attr(document, 'meta[property="og:image:alt"]', 'content'), route)
        .toBe('Onyx — a social room for game nights, messages, and calls.');
      expect(attr(document, 'meta[name="twitter:card"]', 'content'), route).toBe('summary_large_image');
      expect(attr(document, 'meta[name="twitter:title"]', 'content'), route).toBe(meta.title);
      expect(attr(document, 'meta[name="twitter:description"]', 'content'), route).toBe(meta.description);
      expect(attr(document, 'meta[name="twitter:image"]', 'content'), route).toBe('https://eshmaki.me/og.png');
      expect(attr(document, 'link[rel="icon"]', 'href'), route).toBe('/favicon.ico');
      expect(attr(document, 'link[rel="apple-touch-icon"]', 'href'), route).toBe('/apple-touch-icon.png');
      expect(attr(document, 'link[rel="apple-touch-icon"]', 'sizes'), route).toBe('180x180');
      expect(attr(document, 'link[rel="manifest"]', 'href'), route).toBe('/manifest.json');
      expect(JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph']).toHaveLength(2);
    }
  });

  it('writes the root document with the home metadata and boots the Elm client', () => {
    const html = site.read('index.html');
    const document = parse(html);
    expect(document.title).toBe(HOME_ENTRYPOINT.title);
    expect(attr(document, 'meta[name="description"]', 'content')).toBe(HOME_ENTRYPOINT.description);
    expect(attr(document, 'link[rel="canonical"]', 'href')).toBe('https://eshmaki.me/');
    expect(attr(document, 'meta[property="og:url"]', 'content')).toBe('https://eshmaki.me/');
    expect(html).toContain('<html lang="en" data-theme="ocean">');
    expect(html).toContain('Elm.Main.init');
  });

  it('boots the Elm client from /assets/elm/ only, with no legacy bundle entry', () => {
    for (const page of allPages()) {
      const html = site.read(page.file);
      expect(html, page.file).not.toMatch(/\/assets\/index-/);
      expect(html, page.file).not.toContain('type="module"');
      const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      expect(refs.length, page.file).toBeGreaterThan(5);
      for (const ref of refs) {
        expect(ref, page.file).toMatch(/^\/assets\/elm\//);
        expect(existsSync(join(site.dist, ref)), `${page.file} -> ${ref}`).toBe(true);
      }
      // scripts load in the order the boot code needs: engine bundles before ports.js
      const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split('/').pop().split('.')[0]);
      expect(scripts, page.file).toEqual(['app', 'voice', 'backdrop', 'historyImport', 'ports']);
    }
  });

  it('keeps the Elm shell device meta and stylesheet cascade order in every document', () => {
    for (const page of allPages()) {
      const document = parse(site.read(page.file));
      expect(attr(document, 'meta[name="viewport"]', 'content'), page.file).toMatch(/viewport-fit=cover/);
      for (const name of ['theme-color', 'color-scheme', 'apple-mobile-web-app-capable', 'format-detection']) {
        expect(document.querySelectorAll(`meta[name="${name}"]`).length, `${page.file} ${name}`).toBe(1);
      }
      const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href'));
      expect(sheets.map((href) => href.split('/').pop().split('.')[0]), page.file)
        .toEqual(['app', 'gap-appearance', 'pol-stats']);
    }
  });

  it('writes a flat, non-indexable branded 404 with no canonical, og:url or structured data', () => {
    const html = site.read('404.html');
    const document = parse(html);
    expect(document.title).toBe(NOT_FOUND_ENTRYPOINT.title);
    expect(attr(document, 'meta[name="description"]', 'content')).toBe(NOT_FOUND_ENTRYPOINT.description);
    expect(attr(document, 'meta[name="robots"]', 'content')).toBe('noindex, nofollow');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(html).toContain('Onyx — page not found');
  });

  it('emits no robots meta on indexable documents', () => {
    for (const page of allPages().filter((p) => p.kind !== 'not-found')) {
      expect(site.read(page.file), page.file).not.toContain('name="robots"');
    }
  });

  it('copies public/ verbatim and leaves sw.js unstamped for deploy.sh', () => {
    for (const file of ['sw.js', 'manifest.json', 'robots.txt', 'sitemap.xml', 'favicon.svg', 'opcodec_wasm.wasm', 'brand/mark.png']) {
      expect(readFileSync(join(site.dist, file)).equals(readFileSync(join(repo, 'public', file))), file).toBe(true);
    }
    expect(site.read('sw.js')).toContain('onyx-shell-__BUILD_VERSION__');
  });

  it('serves nothing but the Elm assets under /assets/', () => {
    expect(readdirSync(join(site.dist, 'assets'))).toEqual(['elm']);
  });

  it('is deterministic for identical inputs', () => {
    const again = buildTestSite();
    // fixtures use fixed hashed names, so the whole tree must match
    for (const page of allPages()) expect(again.read(page.file), page.file).toBe(site.read(page.file));
  });
});

describe('document rendering', () => {
  it('escapes metadata that would break out of an attribute', () => {
    const parts = elmParts(readFileSync(join(repo, 'elm/index.html'), 'utf8'));
    const html = renderDocument(
      {
        ...allPages()[1],
        title: 'A "quoted" <title> & more',
        description: 'x" onload="alert(1)',
        ogTitle: 'A "quoted" <title> & more',
        ogDescription: 'x" onload="alert(1)',
        twitterTitle: 'A "quoted" <title> & more',
        twitterDescription: 'x" onload="alert(1)',
      },
      parts,
    );
    expect(html).toContain('<title>A &quot;quoted&quot; &lt;title&gt; &amp; more</title>');
    expect(html).not.toContain('onload="alert(1)');
    expect(html).toContain('content="x&quot; onload=&quot;alert(1)"');
  });

  it('accepts the real elm/index.html and finds its whole stylesheet cascade', () => {
    const source = readFileSync(join(repo, 'elm/index.html'), 'utf8');
    const parts = elmParts(source);
    const links = source.match(/<link rel="stylesheet" href="[^"]+">/g) ?? [];
    expect(parts.styles).toHaveLength(links.length);
    expect(parts.styles[0]).toContain('/assets/elm/app.css');
    expect(parts.styles.some((tag) => tag.includes('/assets/elm/css/gap-appearance.css'))).toBe(true);
    expect(parts.deviceMeta.length).toBeGreaterThanOrEqual(8);
    expect(parts.bootBody).toContain('Elm.Main.init');
  });
});

describe('fail-closed build checks', () => {
  const run = (mutate, options = {}) => {
    const base = mkdtempSync(join(tmpdir(), 'onyx-site-bad-'));
    const elmDist = join(base, 'elm-dist');
    mkdirSync(elmDist);
    const names = writeFixtureElmDist(elmDist, { mutate: options.mutateHtml });
    options.afterWrite?.(elmDist, names);
    return () => buildSite({
      repo,
      elmDist,
      publicDir: options.publicDir ?? join(repo, 'public'),
      out: options.out ?? join(base, 'dist'),
    });
  };

  it('fails when the Elm build has no index.html', () => {
    const base = mkdtempSync(join(tmpdir(), 'onyx-site-bad-'));
    expect(() => buildSite({ repo, elmDist: join(base, 'none'), publicDir: join(repo, 'public'), out: join(base, 'dist') }))
      .toThrow(SiteBuildError);
  });

  it('fails when the Elm head loses viewport-fit=cover', () => {
    expect(run(null, { mutateHtml: (html) => html.replace('viewport-fit=cover', '') })).toThrow(/viewport-fit=cover/);
  });

  it('fails when the Elm body no longer boots the program', () => {
    expect(run(null, { mutateHtml: (html) => html.replaceAll('Elm.Main.init', 'Elm.Other.init') })).toThrow(/Elm\.Main\.init/);
  });

  it('fails when the document has no stylesheets', () => {
    expect(run(null, { mutateHtml: (html) => html.replace(/<link rel="stylesheet"[^>]*>/g, '') })).toThrow(/stylesheets/);
  });

  it('fails when a required hashed asset is missing', async () => {
    const { rmSync } = await import('node:fs');
    expect(run(null, { afterWrite: (dir, names) => rmSync(join(dir, names.backdrop)) })).toThrow(/backdrop/);
    expect(run(null, { afterWrite: (dir, names) => rmSync(join(dir, names.worker)) })).toThrow(/voice-worker/);
    expect(run(null, { afterWrite: (dir, names) => rmSync(join(dir, 'css', names.appearanceCss)) })).toThrow(/gap-appearance/);
  });

  it('fails when the document references an asset that is not in the build', async () => {
    const { rmSync } = await import('node:fs');
    expect(run(null, { afterWrite: (dir, names) => rmSync(join(dir, 'css', names.statsCss)) })).toThrow(/pol-stats/);
  });

  it('refuses to write into an out/ directory (only deploy.sh writes the live tree)', () => {
    const base = mkdtempSync(join(tmpdir(), 'onyx-site-out-'));
    expect(run(null, { out: join(base, 'out') })).toThrow(/only deploy\.sh writes the live out/);
  });

  it('refuses to clear a source tree or the repository', () => {
    expect(run(null, { out: repo })).toThrow(/contains the repository|source tree/);
    expect(run(null, { out: join(repo, '..') })).toThrow(/contains the repository/);
  });

  it('fails when public/ is missing the service worker or its stamp placeholder', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'onyx-public-'));
    for (const file of ['manifest.json', 'robots.txt', 'sitemap.xml', 'opcodec_wasm.js', 'opcodec_wasm.wasm']) {
      writeFileSync(join(publicDir, file), 'x');
    }
    expect(run(null, { publicDir })).toThrow(/public\/sw\.js missing/);
    writeFileSync(join(publicDir, 'sw.js'), "const CACHE_NAME = 'onyx-shell-stamped';");
    expect(run(null, { publicDir })).toThrow(/exactly one 'onyx-shell-__BUILD_VERSION__'/);
  });

  it('fails when public/ would be overwritten by (or collide with) generated output', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'onyx-public-'));
    for (const file of ['manifest.json', 'robots.txt', 'sitemap.xml', 'opcodec_wasm.js', 'opcodec_wasm.wasm']) {
      writeFileSync(join(publicDir, file), 'x');
    }
    writeFileSync(join(publicDir, 'sw.js'), "const CACHE_NAME = 'onyx-shell-__BUILD_VERSION__';");
    writeFileSync(join(publicDir, '404.html'), 'stale');
    expect(run(null, { publicDir })).toThrow(/404\.html would be overwritten/);
  });

  it('refuses symlinks in public/', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'onyx-public-'));
    symlinkSync('/etc/hostname', join(publicDir, 'link.txt'));
    expect(run(null, { publicDir })).toThrow(/symlink/);
  });
});

describe('locked public identity assets', () => {
  const png = (path) => {
    const bytes = readFileSync(join(repo, path));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25], bytes };
  };

  it('keeps the brand set under public/brand and the share/install derivatives', () => {
    for (const path of [
      'brand/mark.png', 'brand/lockup.png', 'brand/wordmark.png', 'brand/mascot.png',
      'brand/mascot-transparent.png', 'brand/mascot-wave.png', 'brand/mascot-still.png',
      'brand/app-icon.png', 'brand/og.png', 'brand/favicon.png', 'og.png', 'icon-192.png',
      'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png', 'apple-touch-icon.png',
      'favicon-32.png', 'favicon.ico', 'favicon.svg',
    ]) {
      expect(existsSync(join(repo, 'public', path)), path).toBe(true);
      expect(existsSync(join(site.dist, path)), `dist/${path}`).toBe(true);
    }
  });

  it('exports the share image at exactly 1200x630 and the install icons at their sizes', () => {
    expect(png('public/og.png')).toMatchObject({ width: 1200, height: 630 });
    expect(png('public/brand/og.png')).toMatchObject({ width: 1200, height: 630 });
    expect(png('public/icon-512.png')).toMatchObject({ width: 512, height: 512 });
    expect(png('public/icon-192-maskable.png')).toMatchObject({ width: 192, height: 192 });
    expect(png('public/icon-512-maskable.png')).toMatchObject({ width: 512, height: 512 });
    const apple = png('public/apple-touch-icon.png');
    expect(apple).toMatchObject({ width: 180, height: 180 });
    expect(apple.colorType, 'apple-touch must be opaque RGB, not alpha').toBe(2);
    expect(apple.bytes.equals(png('public/favicon-32.png').bytes)).toBe(false);
    expect(png('public/brand/mascot-transparent.png').colorType, 'transparent mascot must use RGBA pixels').toBe(6);
  });

  it('derives install icons from the product mark, not the mascot', () => {
    const icon512 = png('public/icon-512.png').bytes;
    const maskable = png('public/icon-512-maskable.png').bytes;
    const apple = png('public/apple-touch-icon.png').bytes;
    const appIcon = png('public/brand/app-icon.png').bytes;
    const mascotStill = png('public/brand/mascot-still.png').bytes;
    const wordmark = png('public/brand/wordmark.png');
    const faviconSvg = readFileSync(join(repo, 'public/favicon.svg'), 'utf8');

    expect(wordmark.width).toBeGreaterThan(wordmark.height);
    expect(png('public/brand/app-icon.png')).toMatchObject({ width: 1024, height: 1024 });
    expect(png('public/brand/mascot-still.png')).toMatchObject({ width: 1024, height: 1024 });
    expect(apple.equals(icon512)).toBe(false);
    expect(maskable.equals(icon512)).toBe(false);
    expect(icon512.equals(mascotStill)).toBe(false);
    expect(appIcon.equals(mascotStill)).toBe(false);
    expect(faviconSvg).toContain('#05070a');
    expect(faviconSvg).toContain('#5ba3c9');
    expect(faviconSvg).toContain('rx="7.2"');
    expect(faviconSvg).toMatch(/<circle cx="20\.25" cy="12\.44"/);
  });
});
