export type PwaUpdateRecoveryState = 'unsupported' | 'missing' | 'checked' | 'activating' | 'reloading';

export type PwaUpdateRecoveryResult = {
  state: PwaUpdateRecoveryState;
  detail: string;
};

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
      waiting.postMessage({ type: 'ONYX_SKIP_WAITING' });
      return {
        state: 'activating',
        detail: 'A refreshed app shell is activating. Onyx will reload when it takes control.',
      };
    }

    if (navigator.serviceWorker.controller) {
      reload();
      return {
        state: 'reloading',
        detail: 'Reloading the current stamped app shell.',
      };
    }

    return {
      state: 'checked',
      detail: 'Checked for an app-shell update. Reload after install so the service worker controls this page.',
    };
  } catch {
    return {
      state: 'checked',
      detail: 'Update recovery could not complete. Use the browser reload control once.',
    };
  }
}
