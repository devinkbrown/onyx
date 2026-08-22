// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const materializer = join(root, 'tools', 'materialize-route-entrypoints.mjs');
const baseDocument = readFileSync(join(root, 'index.html'), 'utf8');
const routeTable = readFileSync(join(root, 'src', 'index.tsx'), 'utf8');
const fallbackSitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');

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
    title: 'Onyx status — network health',
    description: 'Public Onyx network health, node uptime, peer latency, users online, and backup readiness.',
  },
  roadmap: {
    title: 'Onyx roadmap — what shipped and what is next',
    description: 'Track the public Onyx roadmap across memory, reach, privacy, presence, operations, and the time-native client work next.',
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

function readLiteralPathStrings(initializer: ts.JsxAttributeValue): readonly string[] {
  if (ts.isStringLiteral(initializer)) return [initializer.text];
  if (!ts.isJsxExpression(initializer) || initializer.expression === undefined) {
    throw new Error('Route path must be a string literal or a literal string array');
  }
  const expression = initializer.expression;
  if (ts.isStringLiteral(expression)) return [expression.text];
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new Error('Route path expression must be a literal array of string literals');
  }
  return expression.elements.map((element) => {
    if (ts.isSpreadElement(element) || !ts.isStringLiteral(element)) {
      throw new Error('Route path arrays may contain only string literals');
    }
    return element.text;
  });
}

function routerPathNames(sourceText: string): readonly string[] {
  const source = ts.createSourceFile(
    'src/index.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names: string[] = [];
  let routeCount = 0;
  let pathAttributeCount = 0;

  function visit(node: ts.Node): void {
    const element = ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) ? node : undefined;
    if (element && element.tagName.getText(source) === 'Route') {
      routeCount += 1;
      let paths: readonly string[] | undefined;
      for (const attribute of element.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          throw new Error('Route declarations cannot use attribute spreads');
        }
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== 'path') continue;
        if (attribute.initializer === undefined) {
          throw new Error('Route path attribute is missing a value');
        }
        paths = readLiteralPathStrings(attribute.initializer);
      }
      if (paths === undefined) throw new Error('Route declaration is missing a path attribute');
      if (paths.length === 0) throw new Error('Route path produced no string literals');
      pathAttributeCount += 1;
      for (const path of paths) {
        const canonical = path === '/' ? path : path.replace(/\/+$/u, '') || '/';
        if (canonical === '/' || canonical === '/*notFound') continue;
        names.push(canonical.replace(/^\//u, ''));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  expect(pathAttributeCount).toBe(routeCount);
  return names;
}

describe('SPA route entrypoint materializer', () => {
  it('keeps exactly one final client route terminus outside materialized entrypoints', () => {
    const source = ts.createSourceFile('src/index.tsx', routeTable, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const terminus: string[] = [];
    function visit(node: ts.Node): void {
      const element = ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) ? node : undefined;
      if (element?.tagName.getText(source) === 'Route') {
        const path = element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'path');
        const component = element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'component');
        if (path && ts.isJsxAttribute(path) && path.initializer && readLiteralPathStrings(path.initializer).includes('/*notFound')) {
          terminus.push(component && ts.isJsxAttribute(component) && component.initializer && ts.isJsxExpression(component.initializer)
            ? component.initializer.expression?.getText(source) ?? '' : '');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(terminus).toEqual(['NotFoundRoute']);
  });

  it('covers every non-root route in the Solid router table', () => {
    const routes = routerPathNames(routeTable);
    expect([...new Set(routes)].sort()).toEqual(Object.keys(expected).sort());
  });

  it('writes route-correct canonical, Open Graph, and descriptive metadata', () => {
    const dist = workspace();
    materialize(dist);

    for (const [route, meta] of Object.entries(expected)) {
      const html = readFileSync(join(dist, route, 'index.html'), 'utf8');
      const document = new DOMParser().parseFromString(html, 'text/html');
      const canonical = 'canonical' in meta && typeof meta.canonical === 'string'
        ? meta.canonical
        : `https://eshmaki.me/${route}/`;

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
        .toBe('https://eshmaki.me/og.png');
      expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content'), route)
        .toBe('1200');
      expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content'), route)
        .toBe('630');
      expect(document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content'), route)
        .toMatch(/quiet harbor/i);
      expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content'), route)
        .toBe('summary_large_image');
      expect(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'), route)
        .toBe(meta.title);
      expect(document.querySelector('meta[name="twitter:description"]')?.getAttribute('content'), route)
        .toBe(meta.description);
      expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'), route)
        .toBe('https://eshmaki.me/og.png');
      expect(document.querySelector('meta[name="twitter:image:alt"]')?.getAttribute('content'), route)
        .toMatch(/quiet harbor/i);
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href'), route)
        .toBe('/favicon.ico');
      expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'), route)
        .toBe('/apple-touch-icon.png');
      expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('sizes'), route)
        .toBe('180x180');
    }
  });

  it('keeps the fallback sitemap on the same final public route canonicals', () => {
    const locations = [...fallbackSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => match[1])
      .filter((location): location is string => location !== undefined);

    expect(locations.length).toBeGreaterThan(1);
    expect(new Set(locations).size).toBe(locations.length);
    expect(locations).not.toContain('https://eshmaki.me/onyxos/');
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
