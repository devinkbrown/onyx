// SPDX-License-Identifier: AGPL-3.0-or-later
export type PwaReadinessState = 'ready' | 'attention' | 'unavailable';

export type PwaReadinessItem = {
  key: 'window' | 'worker' | 'notifications' | 'storage';
  label: string;
  state: PwaReadinessState;
  detail: string;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function standaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const media = window.matchMedia?.('(display-mode: standalone)');
  return Boolean(media?.matches || (navigator as NavigatorWithStandalone).standalone);
}

function storageReady(): boolean {
  const key = 'onyx:pwa-readiness-test';
  let previous: string | null = null;
  let previousRead = false;
  try {
    previous = localStorage.getItem(key);
    previousRead = true;
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    if (previous !== null) localStorage.setItem(key, previous);
    return typeof indexedDB !== 'undefined';
  } catch {
    // A readiness probe must never consume an existing value, even when the
    // browser fails partway through the write/remove sequence.
    if (previousRead) {
      try {
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
      } catch {
        // Storage is unavailable; readiness remains false.
      }
    }
    return false;
  }
}

function notificationItem(): PwaReadinessItem {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      key: 'notifications',
      label: 'Notifications',
      state: 'unavailable',
      detail: 'This browser does not expose desktop notification permission to Onyx.',
    };
  }

  const permission = Notification.permission;
  if (permission === 'granted') {
    return {
      key: 'notifications',
      label: 'Notifications',
      state: 'ready',
      detail: 'Browser permission is granted; Onyx notification preferences remain the control plane.',
    };
  }

  if (permission === 'denied') {
    return {
      key: 'notifications',
      label: 'Notifications',
      state: 'unavailable',
      detail: 'Browser permission is blocked; change it in site settings before wrapper push can work.',
    };
  }

  return {
    key: 'notifications',
    label: 'Notifications',
    state: 'attention',
    detail: 'Permission has not been requested on this device yet.',
  };
}

export function pwaReadiness(): PwaReadinessItem[] {
  const standalone = standaloneMode();
  const hasServiceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const controlled = hasServiceWorker && Boolean(navigator.serviceWorker.controller);
  const hasDurableStorage = storageReady();

  return [
    {
      key: 'window',
      label: 'App window',
      state: standalone ? 'ready' : 'attention',
      detail: standalone
        ? 'Onyx is running in an installed standalone window.'
        : 'Onyx is running in a browser tab; install it for the wrapper-like window path.',
    },
    {
      key: 'worker',
      label: 'Service worker',
      state: controlled ? 'ready' : hasServiceWorker ? 'attention' : 'unavailable',
      detail: controlled
        ? 'The stamped service worker controls this page.'
        : hasServiceWorker
          ? 'Service workers are supported; reload after install or update so the stamped worker controls this page.'
          : 'This browser does not support the service-worker update path.',
    },
    notificationItem(),
    {
      key: 'storage',
      label: 'Local state',
      state: hasDurableStorage ? 'attention' : 'unavailable',
      detail: hasDurableStorage
        ? 'IndexedDB and localStorage are available, but API availability alone does not protect the vault from browser eviction. Check persistence below.'
        : 'Local storage is unavailable; vault recall, drafts, and portable transfer cannot be stored on this device.',
    },
  ];
}
