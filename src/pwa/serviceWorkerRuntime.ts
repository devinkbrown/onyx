// SPDX-License-Identifier: AGPL-3.0-or-later

import { updateCoordinator } from './updateCoordinator';

type OnyxServiceWorkerContainer = {
  readonly controller: unknown;
  register: ServiceWorkerContainer['register'];
  addEventListener(
    type: 'controllerchange',
    listener: () => void,
  ): void;
};

function reloadCurrentWindow(): void {
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * Register the stamped Onyx worker and recover from a replaced controller.
 *
 * The first worker to claim a previously uncontrolled page is already paired
 * with the bundle that registered it, so reloading then only disrupts connect
 * input. Later controller replacements can invalidate old hashed chunks and
 * must reload once.
 */
export function startServiceWorkerRuntime(
  serviceWorker: OnyxServiceWorkerContainer,
  reload: () => void = reloadCurrentWindow,
  isSafeToReload: (() => boolean) | undefined = undefined,
  coordinator = updateCoordinator,
): void {
  let hasControlledShell = Boolean(serviceWorker.controller);
  let reloaded = false;

  void serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  serviceWorker.addEventListener('controllerchange', () => {
    const controlledNow = Boolean(serviceWorker.controller);
    if (!hasControlledShell) {
      hasControlledShell = controlledNow;
      return;
    }
    if (!controlledNow || reloaded) return;
    if (reloaded) return;
    // Active work is a temporary coordinator hold; an independently unsafe
    // host decision remains an explicit-approval gate.
    // A host may add extra safety policy, but local protected work always
    // wins.  Never turn a stuck hold into permission to reload.
    coordinator.replace(
      () => { reloaded = true; reload(); },
      // `replace` records host approval; its own attempt gate separately
      // blocks while protected work is active and retries on release.
      isSafeToReload?.() ?? true,
      true,
    );
    coordinator.markControllerReady();
  });
}
