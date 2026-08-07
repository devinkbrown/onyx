// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client surface detection for Onyx.
 *
 * The product is one SolidJS/Vite SPA. It may run as:
 * - a normal browser tab (`browser`)
 * - an installed/standalone PWA (`pwa`)
 * - the Zig + Native SDK desktop host (`zig-desktop`) — system WebView only,
 *   not a Chromium-parity claim — with packaged assets from `zero://app` or
 *   the exact Vite dev origin `http://127.0.0.1:3000`.
 *
 * This module is pure and testable. It does **not** embed project/build status
 * claims (scaffold progress, installers, signing, deploy). Those belong in
 * docs (`docs/PUBLIC_LAUNCH_ROADMAP.md`, `docs/desktop-host.md`), not runtime.
 *
 * Native SDK bridge shape: https://native-sdk.dev/frontend
 * Security model (origins, default-deny commands): https://native-sdk.dev/security
 */

export type ClientSurface = 'browser' | 'pwa' | 'zig-desktop';

/**
 * Native capability matrix for the host surface.
 * The minimal Zig host currently exposes none of these to the SPA.
 * Values stay false until a capability is implemented and verified.
 */
export type PlatformCapabilities = {
  bridge: boolean;
  notifications: boolean;
  deepLinks: boolean;
  windowControls: boolean;
  updater: boolean;
  secureStorage: boolean;
};

/** Capability defaults for the current minimal host / browser / PWA surfaces. */
export const MINIMAL_HOST_CAPABILITIES: PlatformCapabilities = Object.freeze({
  bridge: false,
  notifications: false,
  deepLinks: false,
  windowControls: false,
  updater: false,
  secureStorage: false,
});

export type ZeroBridge = {
  /** Present when the Native SDK injects the JS bridge (`window.zero`). */
  invoke?: (command: string, payload?: unknown) => Promise<unknown>;
};

/** Minimal window shape for detection (real `Window` or a unit-test double). */
export type PlatformWindow = {
  zero?: ZeroBridge;
  location?: Pick<Location, 'protocol' | 'origin' | 'href'>;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
};

/** Injectable inputs for standalone/PWA detection (unit-test friendly). */
export type StandaloneProbe = {
  /** `window.matchMedia` or a test double. */
  matchMedia?: ((query: string) => { matches: boolean }) | null;
  /** `navigator` or a test double (`standalone` is iOS Safari install mode). */
  navigator?: { standalone?: boolean } | null;
};

/**
 * True when the page is running under the Onyx desktop host packaged origin.
 * Production assets use `zero://app` only (`frontend.productionSource`).
 * `zero://inline` is not part of the Onyx host allowlist and is not treated
 * as the desktop surface here.
 */
export function isZeroAppOrigin(locationLike: Pick<Location, 'protocol' | 'origin' | 'href'> | null | undefined): boolean {
  if (!locationLike) return false;
  const origin = locationLike.origin ?? '';
  if (origin === 'zero://app') return true;
  // Some WebViews report opaque origins; fall back to exact href prefix.
  const href = locationLike.href ?? '';
  if (href === 'zero://app' || href.startsWith('zero://app/') || href.startsWith('zero://app?') || href.startsWith('zero://app#')) {
    return true;
  }
  // protocol === 'zero:' alone is insufficient (would also match zero://inline).
  return false;
}

/** True when the Native SDK injected `window.zero` (bridge may still be policy-gated). */
export function hasNativeSdkBridge(win: PlatformWindow | null | undefined): boolean {
  if (!win) return false;
  return typeof win.zero === 'object' && win.zero !== null;
}

/**
 * Truthful installed/standalone PWA probe.
 * Uses `display-mode: standalone` and the iOS `navigator.standalone` fallback.
 * Callers should inject matchMedia/navigator in tests.
 */
export function isStandaloneDisplayMode(probe: StandaloneProbe = {}): boolean {
  const nav = probe.navigator;
  if (nav && nav.standalone === true) return true;
  const matchMedia = probe.matchMedia;
  if (typeof matchMedia === 'function') {
    try {
      if (matchMedia('(display-mode: standalone)').matches) return true;
    } catch {
      // Restricted or non-browser environments — not standalone.
    }
  }
  return false;
}

/**
 * Detect the runtime surface for this SPA instance.
 * Order: zig-desktop (bridge or zero://app) → pwa (standalone) → browser.
 */
export function detectClientSurface(
  win: PlatformWindow | null | undefined = typeof window !== 'undefined'
    ? (window as unknown as PlatformWindow)
    : undefined,
  probe: StandaloneProbe = {},
): ClientSurface {
  if (!win) return 'browser';
  if (hasNativeSdkBridge(win)) return 'zig-desktop';
  try {
    if (isZeroAppOrigin(win.location)) return 'zig-desktop';
  } catch {
    // Cross-origin / restricted location access — continue to PWA/browser.
  }

  const matchMedia =
    probe.matchMedia !== undefined
      ? probe.matchMedia
      : typeof win.matchMedia === 'function'
        ? win.matchMedia.bind(win)
        : null;
  const navigatorProbe =
    probe.navigator !== undefined
      ? probe.navigator
      : win.navigator ?? null;

  if (isStandaloneDisplayMode({ matchMedia, navigator: navigatorProbe })) return 'pwa';
  return 'browser';
}

export function isNativeDesktopHost(
  win: PlatformWindow | null | undefined = typeof window !== 'undefined'
    ? (window as unknown as PlatformWindow)
    : undefined,
): boolean {
  return detectClientSurface(win) === 'zig-desktop';
}

/**
 * Capability matrix for a surface. The minimal host does not expose native
 * capabilities yet — all flags stay false until implemented and verified.
 * Surface is accepted for future per-surface differentiation; do not invent
 * optimistic true values.
 */
export function capabilitiesForSurface(_surface: ClientSurface): PlatformCapabilities {
  return {
    bridge: MINIMAL_HOST_CAPABILITIES.bridge,
    notifications: MINIMAL_HOST_CAPABILITIES.notifications,
    deepLinks: MINIMAL_HOST_CAPABILITIES.deepLinks,
    windowControls: MINIMAL_HOST_CAPABILITIES.windowControls,
    updater: MINIMAL_HOST_CAPABILITIES.updater,
    secureStorage: MINIMAL_HOST_CAPABILITIES.secureStorage,
  };
}

/**
 * Short label for diagnostics / marketing copy.
 * Describes the runtime surface only — not distribution status.
 */
export function clientSurfaceLabel(surface: ClientSurface): string {
  switch (surface) {
    case 'zig-desktop':
      return 'Desktop host (Zig + Native SDK system WebView)';
    case 'pwa':
      return 'Installed PWA (standalone)';
    case 'browser':
    default:
      return 'Browser';
  }
}
