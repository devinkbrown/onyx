// SPDX-License-Identifier: AGPL-3.0-or-later
import { lazy, type JSX } from 'solid-js';
import type { RouteSectionProps } from '@solidjs/router';

const RouteLifecycle = lazy(() => import('./RouteLifecycle'));

/**
 * Persistent router root: render the outlet immediately beside a lazy announcer.
 * The controller (map, resolvers, pending settle) stays out of the eager graph.
 */
export function RouteLifecycleRoot(props: RouteSectionProps): JSX.Element {
  // The lazy controller owns subsequent reactive path changes; this value is
  // deliberately the router's initial hydration snapshot.
  // eslint-disable-next-line solid/reactivity
  const initialPath = props.location.pathname;
  return (
    <>
      <RouteLifecycle path={initialPath} />
      {props.children}
    </>
  );
}
