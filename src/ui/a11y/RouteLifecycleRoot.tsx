// SPDX-License-Identifier: AGPL-3.0-or-later
import { Suspense, type JSX } from 'solid-js';
import type { RouteSectionProps } from '@solidjs/router';
import { DeferredLoading, retryableLazy } from '../../app/StaleChunkRecovery';

const RouteLifecycle = retryableLazy(() => import('./RouteLifecycle'), 'route accessibility');

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
      <Suspense fallback={<DeferredLoading label="Loading route accessibility…" />}><RouteLifecycle path={initialPath} /></Suspense>
      {props.children}
    </>
  );
}
