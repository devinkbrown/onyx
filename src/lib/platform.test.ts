// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  capabilitiesForSurface,
  clientSurfaceLabel,
  detectClientSurface,
  hasNativeSdkBridge,
  isNativeDesktopHost,
  isStandaloneDisplayMode,
  isZeroAppOrigin,
  MINIMAL_HOST_CAPABILITIES,
  type PlatformWindow,
} from './platform';

function fakeWindow(partial: {
  zero?: PlatformWindow['zero'];
  protocol?: string;
  origin?: string;
  href?: string;
  matchMedia?: PlatformWindow['matchMedia'];
  navigator?: PlatformWindow['navigator'];
}): PlatformWindow {
  return {
    zero: partial.zero,
    location: {
      protocol: partial.protocol ?? 'https:',
      origin: partial.origin ?? 'https://eshmaki.me',
      href: partial.href ?? 'https://eshmaki.me/',
    },
    matchMedia: partial.matchMedia,
    navigator: partial.navigator,
  };
}

describe('platform surface detection', () => {
  it('treats a normal browser window as browser', () => {
    const win = fakeWindow({
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: false },
    });
    expect(detectClientSurface(win)).toBe('browser');
    expect(isNativeDesktopHost(win)).toBe(false);
    expect(hasNativeSdkBridge(win)).toBe(false);
    expect(clientSurfaceLabel('browser')).toMatch(/Browser/i);
  });

  it('detects Zig desktop via window.zero bridge first', () => {
    const win = fakeWindow({
      zero: { invoke: async () => null },
      // Even if standalone media would match, bridge wins.
      matchMedia: (q: string) => ({ matches: q.includes('standalone') }),
    });
    expect(hasNativeSdkBridge(win)).toBe(true);
    expect(detectClientSurface(win)).toBe('zig-desktop');
    expect(isNativeDesktopHost(win)).toBe(true);
    expect(clientSurfaceLabel('zig-desktop')).toMatch(/Desktop host/i);
    expect(clientSurfaceLabel('zig-desktop')).toMatch(/system WebView/i);
    expect(clientSurfaceLabel('zig-desktop')).toMatch(/Zig/i);
    expect(clientSurfaceLabel('zig-desktop')).not.toMatch(/Chromium/i);
  });

  it('detects packaged zero://app origin without requiring bridge', () => {
    const win = fakeWindow({
      protocol: 'zero:',
      origin: 'zero://app',
      href: 'zero://app/index.html',
    });
    expect(isZeroAppOrigin(win.location)).toBe(true);
    expect(detectClientSurface(win)).toBe('zig-desktop');
  });

  it('does not treat zero://inline as the Onyx packaged host origin', () => {
    expect(
      isZeroAppOrigin({
        protocol: 'zero:',
        origin: 'zero://inline',
        href: 'zero://inline/',
      }),
    ).toBe(false);
    const win = fakeWindow({
      protocol: 'zero:',
      origin: 'zero://inline',
      href: 'zero://inline/',
      matchMedia: () => ({ matches: false }),
    });
    expect(detectClientSurface(win)).toBe('browser');
  });

  it('does not treat bare zero: protocol without zero://app origin as host', () => {
    expect(
      isZeroAppOrigin({
        protocol: 'zero:',
        origin: 'null',
        href: 'zero://other/path',
      }),
    ).toBe(false);
  });

  it('does not treat https origins as zero app', () => {
    expect(
      isZeroAppOrigin({
        protocol: 'https:',
        origin: 'https://eshmaki.me',
        href: 'https://eshmaki.me/app/',
      }),
    ).toBe(false);
  });

  it('detects installed PWA via display-mode standalone', () => {
    const win = fakeWindow({
      matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' }),
    });
    expect(detectClientSurface(win)).toBe('pwa');
    expect(clientSurfaceLabel('pwa')).toMatch(/PWA|standalone/i);
    expect(isNativeDesktopHost(win)).toBe(false);
  });

  it('detects installed PWA via iOS navigator.standalone', () => {
    const win = fakeWindow({
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    });
    expect(detectClientSurface(win)).toBe('pwa');
  });

  it('accepts injected standalone probe without window.matchMedia', () => {
    const win = fakeWindow({});
    expect(
      detectClientSurface(win, {
        matchMedia: (q) => ({ matches: q.includes('standalone') }),
      }),
    ).toBe('pwa');
    expect(isStandaloneDisplayMode({ navigator: { standalone: true } })).toBe(true);
    expect(isStandaloneDisplayMode({ matchMedia: () => ({ matches: false }), navigator: { standalone: false } })).toBe(
      false,
    );
  });

  it('exposes a fully-false capability matrix for the minimal host', () => {
    for (const surface of ['browser', 'pwa', 'zig-desktop'] as const) {
      const caps = capabilitiesForSurface(surface);
      expect(caps).toEqual({
        bridge: false,
        notifications: false,
        deepLinks: false,
        windowControls: false,
        updater: false,
        secureStorage: false,
      });
      expect(caps.bridge).toBe(MINIMAL_HOST_CAPABILITIES.bridge);
    }
  });

  it('does not hardcode project scaffold claims in runtime exports', async () => {
    // Guard against reintroducing desktopHostScaffolded / launch-status claims.
    const mod = await import('./platform');
    expect('desktopLaunchStatus' in mod).toBe(false);
    expect('desktopHostScaffolded' in mod).toBe(false);
    expect(Object.keys(mod).join(' ')).not.toMatch(/desktopHostScaffolded|desktopLaunchStatus/);
  });

  it('handles missing window as browser', () => {
    expect(detectClientSurface(undefined)).toBe('browser');
    expect(isNativeDesktopHost(null)).toBe(false);
  });
});
