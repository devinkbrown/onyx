// SPDX-License-Identifier: AGPL-3.0-or-later
export type PwaUpdateRecoveryState =
  | 'unsupported'
  | 'missing'
  | 'checked'
  | 'activating'
  | 'reloading'
  | 'failed';

export type PwaUpdateRecoveryResult = {
  state: PwaUpdateRecoveryState;
  detail: string;
};
export { createUpdateCoordinator, updateCoordinator, type UpdateAvailability } from './updateCoordinator';
import { updateCoordinator } from './updateCoordinator';

function reloadCurrentWindow(): void {
  if (typeof window !== 'undefined') window.location.reload();
}

export async function refreshInstalledAppShell(
  reload: () => void = reloadCurrentWindow,
): Promise<PwaUpdateRecoveryResult> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return {
      state: 'unsupported',
      detail: 'This browser does not support service-worker update recovery.',
    };
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration?.();
    if (!registration) {
      return {
        state: 'missing',
        detail: 'No Onyx service worker is registered for this page yet.',
      };
    }

    const updated = await registration.update();
    const waiting = updated.waiting ?? registration.waiting;
    if (waiting) {
      // Activation is asynchronous; controllerchange will make the safe
      // transition decision once the new worker actually takes control.
      updateCoordinator.replace(reload, true, false);
      waiting.postMessage({ type: 'ONYX_SKIP_WAITING' });
      return {
        state: 'activating',
        detail: 'A refreshed app shell is activating. Onyx will reload when it takes control.',
      };
    }

    const installing = updated.installing ?? registration.installing;
    if (installing && installing.state !== 'redundant') {
      return {
        state: 'activating',
        detail: 'A refreshed app shell is installing. Onyx will reload when it takes control.',
      };
    }

    if (navigator.serviceWorker.controller) {
      updateCoordinator.replace(reload, !updateCoordinator.hasActiveWork, true);
      updateCoordinator.approve();
      return {
        state: updateCoordinator.hasActiveWork ? 'activating' : 'reloading',
        detail: updateCoordinator.hasActiveWork
          ? 'The app shell is update-ready. Reload is queued until current work finishes.'
          : 'Reloading the current stamped app shell.',
      };
    }

    return {
      state: 'checked',
      detail: 'Checked for an app-shell update. Reload after install so the service worker controls this page.',
    };
  } catch {
    return {
      state: 'failed',
      detail: 'Update recovery could not complete. Use the browser reload control once.',
    };
  }
}
