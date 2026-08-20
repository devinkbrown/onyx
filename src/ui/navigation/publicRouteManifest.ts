// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Canonical, public-site route information architecture.
 *
 * This is descriptive metadata only. Router declarations remain the runtime
 * authority until the public routes migrate to consume this manifest.
 */

export type PublicRouteGroup = 'product' | 'trust' | 'resources';
export type PublicRoutePlacement = 'brand' | 'primary' | 'none';

export type PublicRouteId =
  | 'home'
  | 'about'
  | 'download'
  | 'onyxos'
  | 'status'
  | 'accessibility'
  | 'integrations'
  | 'agents'
  | 'glossary'
  | 'stats'
  | 'roadmap'
  | 'invite'
  | 'appearance';

export type PublicRouteMetadata = {
  id: PublicRouteId;
  /** Canonical document destination. Root stays `/`; every other href ends in `/`. */
  href: `/${string}`;
  /** Slashless path used exclusively for route matching. */
  path: `/${string}`;
  label: string;
  group: PublicRouteGroup;
  /** Where this destination appears in the shared public header. */
  placement: PublicRoutePlacement;
  /** Whether this destination belongs in each responsive public navigation. */
  navigation: Readonly<{ desktop: boolean; mobile: boolean }>;
  /** Stable order within the primary navigation; null outside that landmark. */
  navigationOrder: number | null;
};

/**
 * Public destinations grouped by product domain. `path` never includes a
 * trailing slash (except root), while `href` is the canonical link target.
 * The current router may accept compatibility aliases, but they are not
 * destinations in this manifest; primary-header order is carried separately.
 */
type PublicRouteSeed = Omit<PublicRouteMetadata, 'href'>;

const PUBLIC_ROUTE_SEEDS = [
  { id: 'home', path: '/', label: 'Home', group: 'product', placement: 'brand', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'about', path: '/about', label: 'About', group: 'product', placement: 'primary', navigation: { desktop: true, mobile: true }, navigationOrder: 0 },
  { id: 'download', path: '/download', label: 'Downloads', group: 'product', placement: 'primary', navigation: { desktop: true, mobile: true }, navigationOrder: 4 },
  { id: 'onyxos', path: '/onyxos', label: 'OnyxOS', group: 'product', placement: 'primary', navigation: { desktop: true, mobile: true }, navigationOrder: 1 },
  { id: 'status', path: '/status', label: 'Status', group: 'trust', placement: 'primary', navigation: { desktop: true, mobile: true }, navigationOrder: 3 },
  { id: 'accessibility', path: '/accessibility', label: 'Accessibility', group: 'trust', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'integrations', path: '/integrations', label: 'Integrations', group: 'resources', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'agents', path: '/agents', label: 'Agents', group: 'resources', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'glossary', path: '/glossary', label: 'Glossary', group: 'resources', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'stats', path: '/stats', label: 'Stats', group: 'resources', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'roadmap', path: '/roadmap', label: 'Roadmap', group: 'resources', placement: 'primary', navigation: { desktop: true, mobile: true }, navigationOrder: 2 },
  { id: 'invite', path: '/invite', label: 'Invite', group: 'resources', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
  { id: 'appearance', path: '/appearance', label: 'Appearance', group: 'resources', placement: 'none', navigation: { desktop: false, mobile: false }, navigationOrder: null },
] as const satisfies readonly PublicRouteSeed[];

export const PUBLIC_ROUTE_MANIFEST: readonly PublicRouteMetadata[] = PUBLIC_ROUTE_SEEDS.map((route) => ({
  ...route,
  href: route.path === '/' ? '/' : `${route.path}/`,
}));

export const PUBLIC_ROUTE_GROUPS: Readonly<Record<PublicRouteGroup, readonly PublicRouteId[]>> = {
  product: ['home', 'about', 'download', 'onyxos'],
  trust: ['status', 'accessibility'],
  resources: ['integrations', 'agents', 'glossary', 'stats', 'roadmap', 'invite', 'appearance'],
};

export function publicRouteById(id: PublicRouteId): PublicRouteMetadata {
  return PUBLIC_ROUTE_MANIFEST.find((route) => route.id === id)!;
}

/**
 * Converts a browser location or href to the manifest's slashless match key.
 * Queries and fragments are intentionally not part of public-route identity.
 */
export function normalisePublicRoutePath(value: string | undefined): string {
  const path = value?.split(/[?#]/)[0] || '';
  return path.replace(/\/+$/, '') || path;
}

/** Finds a destination by its normalized match key; aliases are never matched. */
export function publicRouteByPath(value: string | undefined): PublicRouteMetadata | undefined {
  const path = normalisePublicRoutePath(value);
  return PUBLIC_ROUTE_MANIFEST.find((route) => route.path === path);
}

/** Manifest-owned order for the single responsive public navigation DOM list. */
const PUBLIC_PRIMARY_NAVIGATION = [
  PUBLIC_ROUTE_MANIFEST[1]!,
  PUBLIC_ROUTE_MANIFEST[3]!,
  PUBLIC_ROUTE_MANIFEST[10]!,
  PUBLIC_ROUTE_MANIFEST[4]!,
  PUBLIC_ROUTE_MANIFEST[2]!,
] as const;

/** Compact shared-header projection, pinned to manifest parity by its tests. */
/** Returns shared-header links in their explicit, breakpoint-stable order. */
export function publicNavigationRoutes(): readonly PublicRouteMetadata[] {
  return PUBLIC_PRIMARY_NAVIGATION;
}
