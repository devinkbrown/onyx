// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, untrack, type JSX } from 'solid-js';
import { useIsRouting, useLocation } from '@solidjs/router';
import { RouteAnnouncer } from './RouteAnnouncer';

/**
 * Persistent router live-region controller. Labels are a frozen lifecycle map.
 * /install shares the download identity without adding a public-navigation alias.
 */
export const ROUTE_LIFECYCLE_APP_LABEL = 'App';
export const ROUTE_LIFECYCLE_NOT_FOUND_LABEL = 'Route not found';

export type RouteLifecycleId =
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
  | 'appearance'
  | 'app';

export type RouteLifecycleEntry = {
  readonly id: RouteLifecycleId;
  readonly label: string;
  /** Whether this identity appears in public primary navigation. */
  readonly publicNavigation: boolean;
};

const ROUTE_LIFECYCLE_SEEDS = [
  { path: '/', id: 'home', label: 'Home', publicNavigation: false },
  { path: '/about', id: 'about', label: 'About', publicNavigation: true },
  { path: '/download', id: 'download', label: 'Downloads', publicNavigation: true },
  { path: '/onyxos', id: 'onyxos', label: 'OnyxOS', publicNavigation: true },
  { path: '/status', id: 'status', label: 'Status', publicNavigation: true },
  { path: '/accessibility', id: 'accessibility', label: 'Accessibility', publicNavigation: false },
  { path: '/integrations', id: 'integrations', label: 'Integrations', publicNavigation: false },
  { path: '/agents', id: 'agents', label: 'Agents', publicNavigation: false },
  { path: '/glossary', id: 'glossary', label: 'Glossary', publicNavigation: false },
  { path: '/stats', id: 'stats', label: 'Stats', publicNavigation: false },
  { path: '/roadmap', id: 'roadmap', label: 'Roadmap', publicNavigation: true },
  { path: '/invite', id: 'invite', label: 'Invite', publicNavigation: false },
  { path: '/appearance', id: 'appearance', label: 'Appearance', publicNavigation: false },
  { path: '/app', id: 'app', label: ROUTE_LIFECYCLE_APP_LABEL, publicNavigation: false },
] as const satisfies readonly Readonly<{
  path: string;
  id: RouteLifecycleId;
  label: string;
  publicNavigation: boolean;
}>[];

export const ROUTE_LIFECYCLE_MAP: Readonly<Record<string, RouteLifecycleEntry>> = Object.freeze(
  Object.fromEntries(
    ROUTE_LIFECYCLE_SEEDS.map((entry) => [
      entry.path,
      { id: entry.id, label: entry.label, publicNavigation: entry.publicNavigation },
    ]),
  ),
);

const INSTALL_LIFECYCLE_PATH = '/install';

/**
 * Pathname identity only. Query and hash never participate.
 * Trailing slashes collapse; `/` stays `/`.
 */
export function normalizeRouteLifecyclePath(value: string | undefined): string {
  const path = value?.split(/[?#]/u)[0] ?? '';
  if (path === '' || path === '/') return path;
  return path.replace(/\/+$/u, '') || '/';
}

export function resolveRouteLifecycleEntry(
  value: string | undefined,
): RouteLifecycleEntry | undefined {
  const path = normalizeRouteLifecyclePath(value);
  if (path === '') return undefined;
  if (path === INSTALL_LIFECYCLE_PATH) return ROUTE_LIFECYCLE_MAP['/download'];
  return ROUTE_LIFECYCLE_MAP[path];
}

export function resolveRouteLifecycleIdentity(value: string | undefined): RouteLifecycleId | undefined {
  return resolveRouteLifecycleEntry(value)?.id;
}

export function resolveRouteLifecycleLabel(value: string | undefined): string | undefined {
  return resolveRouteLifecycleEntry(value)?.label;
}

/** Unknown routes are not public identities, but still deserve a settled announcement. */
export function resolveNotFoundRouteLifecycleEntry(value: string | undefined): RouteLifecycleEntry | undefined {
  const path = normalizeRouteLifecyclePath(value);
  if (path === '' || resolveRouteLifecycleEntry(path)) return undefined;
  return {
    id: `not-found:${path}` as RouteLifecycleId,
    label: ROUTE_LIFECYCLE_NOT_FOUND_LABEL,
    publicNavigation: false,
  };
}

export default function RouteLifecycle(props: { path: string }): JSX.Element {
  const isRouting = useIsRouting();
  const location = useLocation();
  const initialEntry = untrack(() => (
    resolveRouteLifecycleEntry(props.path) ?? resolveNotFoundRouteLifecycleEntry(props.path)
  ));
  const entry = createMemo(() => (
    resolveRouteLifecycleEntry(location.pathname) ?? resolveNotFoundRouteLifecycleEntry(location.pathname)
  ));

  return (
    <RouteAnnouncer
      title={entry()?.label}
      routeKey={entry()?.id}
      pending={isRouting()}
      politeness="polite"
      initial={{
        title: initialEntry?.label,
        routeKey: initialEntry?.id,
      }}
    />
  );
}
