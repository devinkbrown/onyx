// SPDX-License-Identifier: AGPL-3.0-or-later

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
    reloaded = true;
    reload();
  });
}
