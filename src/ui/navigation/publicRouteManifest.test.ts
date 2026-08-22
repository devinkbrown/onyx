// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PUBLIC_NAV_ITEMS } from '../public/PublicNav';
import {
  PUBLIC_ROUTE_GROUPS,
  PUBLIC_ROUTE_MANIFEST,
  normalisePublicRoutePath,
  publicNavigationRoutes,
  publicRouteById,
  publicRouteByPath,
} from './publicRouteManifest';

type RouterDeclaration = Readonly<{ path: string; component: string | null }>;

function canonicalPath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/u, '');
}

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

/** Read the authoritative JSX route declarations structurally, without text matching. */
function routerDeclarations(): readonly RouterDeclaration[] {
  const fileName = resolve(process.cwd(), 'src/index.tsx');
  const source = ts.createSourceFile(
    fileName,
    readFileSync(fileName, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routes: RouterDeclaration[] = [];
  let routeCount = 0;
  let pathAttributeCount = 0;

  function visit(node: ts.Node): void {
    const element = ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) ? node : undefined;
    if (element && element.tagName.getText(source) === 'Route') {
      routeCount += 1;
      let paths: readonly string[] | undefined;
      let component: string | null = null;
      for (const attribute of element.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          throw new Error('Route declarations cannot use attribute spreads');
        }
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (name === 'path') {
          if (attribute.initializer === undefined) {
            throw new Error('Route path attribute is missing a value');
          }
          paths = readLiteralPathStrings(attribute.initializer);
        }
        if (name === 'component' && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          component = attribute.initializer.expression?.getText(source) ?? null;
        }
      }
      if (paths === undefined) throw new Error('Route declaration is missing a path attribute');
      if (paths.length === 0) throw new Error('Route path produced no string literals');
      pathAttributeCount += 1;
      for (const path of paths) {
        routes.push({ path, component });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  expect(pathAttributeCount).toBe(routeCount);
  return routes;
}

describe('PUBLIC_ROUTE_MANIFEST', () => {
  it('uses unique IDs, slashless match paths, and canonical hrefs', () => {
    const ids = PUBLIC_ROUTE_MANIFEST.map((route) => route.id);
    const paths = PUBLIC_ROUTE_MANIFEST.map((route) => route.path);

    expect(new Set(ids)).toHaveLength(ids.length);
    expect(new Set(paths)).toHaveLength(paths.length);
    expect(paths).toEqual(paths.map((path) => path === '/' ? path : path.replace(/\/$/, '')));
    expect(paths.every((path) => path.startsWith('/'))).toBe(true);
    expect(PUBLIC_ROUTE_MANIFEST.map((route) => route.href)).toEqual([
      '/',
      '/about/',
      '/download/',
      '/onyxos/',
      '/status/',
      '/accessibility/',
      '/privacy/',
      '/guidelines/',
      '/contact/',
      '/integrations/',
      '/agents/',
      '/glossary/',
      '/stats/',
      '/roadmap/',
      '/invite/',
      '/appearance/',
      '/guides/',
      '/community/',
    ]);
    for (const route of PUBLIC_ROUTE_MANIFEST) {
      expect(route.href === '/' ? route.path : route.href).toBe(
        route.path === '/' ? '/' : `${route.path}/`,
      );
    }
  });

  it('preserves group ordering without omitting or duplicating a route', () => {
    const grouped = Object.values(PUBLIC_ROUTE_GROUPS).flat();
    expect(grouped).toEqual(PUBLIC_ROUTE_MANIFEST.map((route) => route.id));
    expect(PUBLIC_ROUTE_MANIFEST.map((route) => route.group)).toEqual([
      'product', 'product', 'product', 'product', 'trust', 'trust', 'trust', 'trust', 'trust',
      'resources', 'resources', 'resources', 'resources', 'resources', 'resources', 'resources',
      'resources', 'resources',
    ]);
  });

  it('models brand, primary-navigation, and non-header placement explicitly', () => {
    for (const route of PUBLIC_ROUTE_MANIFEST) {
      expect(route.placement === 'primary').toBe(route.navigation.desktop);
      expect(route.navigationOrder === null).toBe(route.placement !== 'primary');
    }
    expect(publicRouteById('home')).toMatchObject({ placement: 'brand', navigationOrder: null });
    expect(publicRouteById('accessibility')).toMatchObject({ placement: 'none', navigationOrder: null });
  });

  it('projects the manifest-owned responsive navigation list in declared order', () => {
    const runtime = PUBLIC_NAV_ITEMS.map((item) => ({ label: item.label, href: item.href }));
    const metadata = publicNavigationRoutes().map((route) => ({ label: route.label, href: route.href }));
    const declared = PUBLIC_ROUTE_MANIFEST
      .filter((route) => route.placement === 'primary')
      .toSorted((left, right) => (left.navigationOrder ?? 0) - (right.navigationOrder ?? 0));

    expect(publicNavigationRoutes()).toEqual(declared);
    expect(metadata).toEqual(runtime);
    expect(publicNavigationRoutes().map((route) => route.navigationOrder)).toEqual([0, 1]);
    expect(publicNavigationRoutes().map((route) => route.label)).toEqual(['About', 'Download']);
    expect(publicRouteById('onyxos')).toMatchObject({
      placement: 'none',
      navigation: { desktop: false, mobile: false },
      navigationOrder: null,
    });
    expect(publicRouteById('stats')).toMatchObject({
      placement: 'none',
      navigation: { desktop: false, mobile: false },
      navigationOrder: null,
    });
  });

  it('covers every public router destination and preserves the install compatibility alias', () => {
    const declarations = routerDeclarations();
    const terminus = declarations.filter((route) => route.path === '/*notFound');
    expect(terminus).toEqual([{ path: '/*notFound', component: 'NotFoundRoute' }]);
    const publicRouterPaths = new Set(
      declarations
        .map((route) => canonicalPath(route.path))
        .filter((path) => path !== '/app' && path !== '/install' && path !== '/*notFound'),
    );
    expect([...publicRouterPaths].sort()).toEqual(
      PUBLIC_ROUTE_MANIFEST.map((route) => route.path).toSorted(),
    );

    const downloadComponents = declarations
      .filter((route) => ['/download', '/install'].includes(canonicalPath(route.path)))
      .map((route) => route.component);
    expect(new Set(downloadComponents)).toEqual(new Set(['DownloadRoute']));
    expect(declarations.some((route) => canonicalPath(route.path) === '/install')).toBe(true);
  });

  it('looks up canonical metadata by ID', () => {
    expect(publicRouteById('download')).toMatchObject({ href: '/download/', path: '/download', label: 'Download' });
    expect(publicRouteById('about')).toMatchObject({ href: '/about/', path: '/about', label: 'About' });
    expect(publicRouteById('invite')).toMatchObject({ href: '/invite/', path: '/invite', label: 'Join', placement: 'none' });
    expect(publicRouteById('privacy')).toMatchObject({ href: '/privacy/', placement: 'none' });
    expect(publicRouteById('guidelines')).toMatchObject({ href: '/guidelines/', label: 'House rules' });
    expect(publicRouteById('contact')).toMatchObject({ href: '/contact/', placement: 'none' });
    expect(publicRouteById('status')).toMatchObject({ placement: 'none', navigationOrder: null });
    expect(publicRouteById('roadmap')).toMatchObject({ placement: 'none' });
    expect(publicRouteById('onyxos')).toMatchObject({ placement: 'none' });
  });

  it('normalizes path identity before lookup without promoting router aliases', () => {
    expect(normalisePublicRoutePath('/roadmap/?tab=now#focus')).toBe('/roadmap');
    expect(normalisePublicRoutePath('/')).toBe('/');
    expect(normalisePublicRoutePath(undefined)).toBe('');
    expect(normalisePublicRoutePath('?join=%23root')).toBe('');

    expect(publicRouteByPath('/download/?platform=linux#packages')).toMatchObject({ id: 'download' });
    expect(publicRouteByPath('/install/')).toBeUndefined();
    expect(publicRouteByPath('/missing/')).toBeUndefined();
  });
});
