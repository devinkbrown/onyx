// SPDX-License-Identifier: AGPL-3.0-or-later
export interface BrowserLifecycleSnapshot {
  readonly visibility: 'visible' | 'hidden';
  readonly online: boolean;
  readonly pageState: 'active' | 'hidden' | 'frozen' | 'bfcache';
  readonly atMonotonicMs: number;
  readonly capabilities: { readonly freezeEvents: boolean; readonly deviceChange: boolean };
}

export type BrowserLifecycleKind = 'visibility' | 'online' | 'offline' | 'pagehide' | 'pageshow' | 'freeze' | 'resume' | 'devicechange';
export interface BrowserLifecycleEvent {
  readonly schemaVersion: 1;
  readonly kind: BrowserLifecycleKind;
  readonly atMonotonicMs: number;
  readonly visible?: boolean;
  readonly persisted?: boolean;
}

export interface BrowserLifecycleDependencies {
  readonly window?: Window | null;
  readonly document?: Document | null;
  readonly navigator?: Navigator | null;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => () => void;
}

/** Captures lifecycle changes with bounded event coalescing and deterministic cleanup. */
export function createBrowserLifecycle(deps: BrowserLifecycleDependencies = {}): {
  subscribe(listener: (snapshot: BrowserLifecycleSnapshot, event: BrowserLifecycleEvent) => void): () => void;
  dispose(): void;
} {
  const win = deps.window === undefined ? (typeof window === 'undefined' ? null : window) : deps.window;
  const doc = deps.document === undefined ? (typeof document === 'undefined' ? null : document) : deps.document;
  const nav = deps.navigator === undefined ? (typeof navigator === 'undefined' ? null : navigator) : deps.navigator;
  const now = deps.now ?? (() => win?.performance.now() ?? 0);
  const listeners = new Set<(snapshot: BrowserLifecycleSnapshot, event: BrowserLifecycleEvent) => void>();
  const timer = deps.schedule ?? ((fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });
  let pageState: BrowserLifecycleSnapshot['pageState'] = doc?.visibilityState === 'hidden' ? 'hidden' : 'active';
  let disposed = false;
  const capabilities = { freezeEvents: !!doc && 'onfreeze' in doc, deviceChange: !!nav?.mediaDevices && 'ondevicechange' in nav.mediaDevices };
  let pendingDeviceEvent: BrowserLifecycleEvent | null = null;
  let cancelDeviceTimer: (() => void) | null = null;

  const snapshot = (): BrowserLifecycleSnapshot => ({
    visibility: doc?.visibilityState === 'hidden' ? 'hidden' : 'visible',
    online: nav?.onLine ?? false,
    pageState,
    atMonotonicMs: now(),
    capabilities,
  });
  const flush = (kind: BrowserLifecycleKind): void => {
    const event = kind === 'devicechange' ? pendingDeviceEvent : null;
    pendingDeviceEvent = null;
    cancelDeviceTimer?.(); cancelDeviceTimer = null;
    if (!event || disposed) return;
    const current = snapshot();
    for (const listener of [...listeners]) { try { listener(current, event); } catch { /* isolate observers */ } }
  };
  const publish = (kind: BrowserLifecycleKind, extra: { visible?: boolean; persisted?: boolean } = {}): void => {
    if (disposed) return;
    const event = Object.freeze({ schemaVersion: 1 as const, kind, atMonotonicMs: now(), ...extra });
    if (kind === 'devicechange') {
      pendingDeviceEvent = event;
      if (!cancelDeviceTimer) cancelDeviceTimer = timer(() => flush(kind), 40);
      return;
    }
    const current = snapshot();
    for (const listener of [...listeners]) { try { listener(current, event); } catch { /* isolate observers */ } }
  };
  const onVisibility = () => { pageState = doc?.visibilityState === 'hidden' ? 'hidden' : 'active'; publish('visibility', { visible: doc?.visibilityState !== 'hidden' }); };
  const onOnline = () => publish(nav?.onLine ? 'online' : 'offline');
  const onPageHide = (event: PageTransitionEvent) => { pageState = event.persisted ? 'bfcache' : (doc?.visibilityState === 'hidden' ? 'hidden' : 'active'); publish('pagehide', { persisted: event.persisted }); };
  const onPageShow = (event: PageTransitionEvent) => { pageState = doc?.visibilityState === 'hidden' ? 'hidden' : 'active'; publish('pageshow', { persisted: event.persisted }); };
  const onFreeze = () => { pageState = 'frozen'; publish('freeze'); };
  const onResume = () => { pageState = 'active'; publish('resume'); };
  const onDeviceChange = () => publish('devicechange');

  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('online', onOnline);
  win?.addEventListener('offline', onOnline);
  win?.addEventListener('pagehide', onPageHide);
  win?.addEventListener('pageshow', onPageShow);
  if (capabilities.freezeEvents) {
    doc?.addEventListener('freeze', onFreeze as EventListener);
    doc?.addEventListener('resume', onResume as EventListener);
  }
  nav?.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

  return {
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot(), { schemaVersion: 1, kind: 'visibility', atMonotonicMs: now(), visible: doc?.visibilityState !== 'hidden' });
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('online', onOnline);
      win?.removeEventListener('offline', onOnline);
      win?.removeEventListener('pagehide', onPageHide);
      win?.removeEventListener('pageshow', onPageShow);
      if (capabilities.freezeEvents) {
        doc?.removeEventListener('freeze', onFreeze as EventListener);
        doc?.removeEventListener('resume', onResume as EventListener);
      }
      nav?.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      cancelDeviceTimer?.(); cancelDeviceTimer = null; pendingDeviceEvent = null; listeners.clear();
    },
  };
}
