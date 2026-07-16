// SPDX-License-Identifier: AGPL-3.0-or-later

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

interface LifecycleClient {
  dropConnection(reason?: string): void;
}

export interface ConnectLifecycleState {
  connectionStatus: ConnectionStatus;
  autoReconnect: boolean;
  client: LifecycleClient | null;
  setConnectionStatus(status: ConnectionStatus): void;
  reconnectNow(): void;
}

interface LifecycleEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface ConnectPageLifecycleOptions {
  pageTarget?: LifecycleEventTarget;
  lifecycleTarget?: LifecycleEventTarget;
  supportsFreezeResume?: boolean;
  isOnline?: () => boolean;
}

/**
 * Reconcile Connect's existing IRC session after the browser restores a frozen
 * page. This is intentionally only a bridge to the store's reconnect actions:
 * it does not own a timer, socket, or visibility-driven connection policy.
 */
export function installConnectPageLifecycle(
  getConnectionState: () => ConnectLifecycleState,
  options: ConnectPageLifecycleOptions = {},
): () => void {
  if (typeof window === 'undefined' && !options.pageTarget) return () => undefined;

  const pageTarget = options.pageTarget
    ?? (window as unknown as LifecycleEventTarget);
  const lifecycleTarget = options.lifecycleTarget
    ?? (document as unknown as LifecycleEventTarget);
  const supportsFreezeResume = options.supportsFreezeResume
    ?? ('onfreeze' in lifecycleTarget || 'onresume' in lifecycleTarget);
  const isOnline = options.isOnline
    ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);

  let suspended = false;
  let restoreHandled = false;

  const reconcile = (): void => {
    const state = getConnectionState();
    if (!state.autoReconnect || state.connectionStatus === 'connecting') return;

    if (isOnline()) {
      // reconnectNow closes any stale socket before opening the replacement and
      // preserves the server/account snapshot until the fresh handshake lands.
      state.reconnectNow();
      return;
    }

    if (state.connectionStatus === 'connected') {
      // The existing global `online` handler reconnects reconnecting sessions.
      // Mark this restored socket honestly now so it cannot keep accepting
      // messages while the browser is offline.
      state.setConnectionStatus('reconnecting');
      state.client?.dropConnection('page restored while offline');
    }
  };

  const beginSuspension = (): void => {
    suspended = true;
    restoreHandled = false;
  };

  const onPageHide: EventListener = (event) => {
    if ((event as PageTransitionEvent).persisted) {
      beginSuspension();
      return;
    }
    suspended = false;
    restoreHandled = false;
  };

  const onPageShow: EventListener = (event) => {
    if (!(event as PageTransitionEvent).persisted) {
      suspended = false;
      restoreHandled = false;
      return;
    }
    suspended = false;
    if (restoreHandled) return;
    restoreHandled = true;
    reconcile();
  };

  const onFreeze: EventListener = () => beginSuspension();
  const onResume: EventListener = () => {
    if (!suspended || restoreHandled) return;
    suspended = false;
    restoreHandled = true;
    reconcile();
  };

  pageTarget.addEventListener('pagehide', onPageHide);
  pageTarget.addEventListener('pageshow', onPageShow);
  if (supportsFreezeResume) {
    lifecycleTarget.addEventListener('freeze', onFreeze);
    lifecycleTarget.addEventListener('resume', onResume);
  }

  return () => {
    pageTarget.removeEventListener('pagehide', onPageHide);
    pageTarget.removeEventListener('pageshow', onPageShow);
    if (supportsFreezeResume) {
      lifecycleTarget.removeEventListener('freeze', onFreeze);
      lifecycleTarget.removeEventListener('resume', onResume);
    }
  };
}
