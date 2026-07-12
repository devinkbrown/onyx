// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * mediaPrefs.test.ts - verifies reactive OS media preference signals.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Accessor } from 'solid-js';

import { makeMediaSignal } from '@/lib/a11y/mediaPrefs';

type FakeMediaQueryHandler = (event: MediaQueryListEvent) => void;

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener?: (type: 'change', handler: FakeMediaQueryHandler) => void;
  removeEventListener?: (type: 'change', handler: FakeMediaQueryHandler) => void;
  addListener?: (handler: FakeMediaQueryHandler) => void;
  removeListener?: (handler: FakeMediaQueryHandler) => void;
  fireChange: (nextMatches: boolean, updateStoredMatch?: boolean) => void;
}

const QUERY = '(prefers-reduced-motion: reduce)';
const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';
const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';
const FORCED_COLORS_QUERY = '(forced-colors: active)';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

function installMatchMedia(fakeQueryList: FakeMediaQueryList) {
  const matchMedia = vi.fn((_query: string): MediaQueryList => fakeQueryList as unknown as MediaQueryList);

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return matchMedia;
}

function removeMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

function createFakeMediaQueryList(initialMatches: boolean, isLegacyOnly = false): FakeMediaQueryList {
  let eventListener: FakeMediaQueryHandler | undefined;
  let legacyListener: FakeMediaQueryHandler | undefined;

  const fakeQueryList: FakeMediaQueryList = {
    matches: initialMatches,
    media: QUERY,
    addListener: (handler) => {
      legacyListener = handler;
    },
    removeListener: (handler) => {
      if (legacyListener === handler) legacyListener = undefined;
    },
    fireChange: (nextMatches, updateStoredMatch = true) => {
      if (updateStoredMatch) fakeQueryList.matches = nextMatches;
      const event = { matches: nextMatches } as MediaQueryListEvent;

      eventListener?.(event);
      legacyListener?.(event);
    },
  };

  if (!isLegacyOnly) {
    fakeQueryList.addEventListener = (_type, handler) => {
      eventListener = handler;
    };
    fakeQueryList.removeEventListener = (_type, handler) => {
      if (eventListener === handler) eventListener = undefined;
    };
  }

  return fakeQueryList;
}

function createUnreadableMediaQueryList(): FakeMediaQueryList {
  const fakeQueryList = createFakeMediaQueryList(false);

  Object.defineProperty(fakeQueryList, 'matches', {
    configurable: true,
    get: () => {
      throw new Error('matches unavailable');
    },
  });

  return fakeQueryList;
}

function installThrowingMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((_query: string): MediaQueryList => {
      throw new Error('matchMedia unavailable');
    }),
  });
}

describe('makeMediaSignal', () => {
  it('reflects the initial media query match', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(true);
    const matchMedia = installMatchMedia(fakeQueryList);

    // Act
    const signal = makeMediaSignal(QUERY);

    // Assert
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith(QUERY);
    expect(signal()).toBe(true);
  });

  it('toggles when change events flip the match in either direction', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(false);
    installMatchMedia(fakeQueryList);
    const signal = makeMediaSignal(QUERY);

    // Act / Assert
    fakeQueryList.fireChange(true);
    expect(signal()).toBe(true);

    fakeQueryList.fireChange(false);
    expect(signal()).toBe(false);

    fakeQueryList.fireChange(true);
    expect(signal()).toBe(true);
  });

  it('reflects the change event payload without rereading MediaQueryList.matches', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(false);
    installMatchMedia(fakeQueryList);
    const signal = makeMediaSignal(QUERY);

    // Act
    fakeQueryList.fireChange(true, false);

    // Assert
    expect(fakeQueryList.matches).toBe(false);
    expect(signal()).toBe(true);
  });

  it('returns false without throwing when matchMedia is missing', () => {
    // Arrange
    removeMatchMedia();
    let signal: Accessor<boolean> = () => true;

    // Act / Assert
    expect(() => {
      signal = makeMediaSignal(QUERY);
    }).not.toThrow();
    expect(signal()).toBe(false);
  });

  it('returns false without throwing when matchMedia throws', () => {
    // Arrange
    installThrowingMatchMedia();
    let signal: Accessor<boolean> = () => true;

    // Act / Assert
    expect(() => {
      signal = makeMediaSignal(QUERY);
    }).not.toThrow();
    expect(signal()).toBe(false);
  });

  it('defaults to false when the initial matches read throws', () => {
    // Arrange
    const fakeQueryList = createUnreadableMediaQueryList();
    installMatchMedia(fakeQueryList);

    // Act
    const signal = makeMediaSignal(QUERY);

    // Assert
    expect(signal()).toBe(false);
  });

  it('keeps the initial match when listener registration throws', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(true);

    fakeQueryList.addEventListener = () => {
      throw new Error('listener rejected');
    };
    installMatchMedia(fakeQueryList);
    let signal: Accessor<boolean> = () => false;

    // Act / Assert
    expect(() => {
      signal = makeMediaSignal(QUERY);
    }).not.toThrow();
    expect(signal()).toBe(true);
  });

  it('updates through the legacy addListener fallback', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(false, true);
    installMatchMedia(fakeQueryList);
    const signal = makeMediaSignal(QUERY);

    // Act
    fakeQueryList.fireChange(true);

    // Assert
    expect(signal()).toBe(true);
  });

  it('creates exported accessors from their exact media queries', async () => {
    // Arrange
    vi.resetModules();
    const lists = new Map<string, FakeMediaQueryList>([
      [QUERY, createFakeMediaQueryList(true)],
      [MORE_CONTRAST_QUERY, createFakeMediaQueryList(false)],
      [REDUCED_TRANSPARENCY_QUERY, createFakeMediaQueryList(true)],
      [FORCED_COLORS_QUERY, createFakeMediaQueryList(false)],
    ]);
    const matchMedia = vi.fn((query: string): MediaQueryList => {
      const queryList = lists.get(query);
      if (!queryList) throw new Error(`unexpected query: ${query}`);
      return queryList as unknown as MediaQueryList;
    });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: matchMedia,
    });

    // Act
    const mediaPrefs = await import('@/lib/a11y/mediaPrefs');

    // Assert
    expect(matchMedia).toHaveBeenCalledTimes(4);
    expect(matchMedia).toHaveBeenNthCalledWith(1, QUERY);
    expect(matchMedia).toHaveBeenNthCalledWith(2, MORE_CONTRAST_QUERY);
    expect(matchMedia).toHaveBeenNthCalledWith(3, REDUCED_TRANSPARENCY_QUERY);
    expect(matchMedia).toHaveBeenNthCalledWith(4, FORCED_COLORS_QUERY);
    expect(mediaPrefs.prefersReducedMotion()).toBe(true);
    expect(mediaPrefs.prefersMoreContrast()).toBe(false);
    expect(mediaPrefs.prefersReducedTransparency()).toBe(true);
    expect(mediaPrefs.forcedColors()).toBe(false);

    lists.get(MORE_CONTRAST_QUERY)?.fireChange(true);
    lists.get(FORCED_COLORS_QUERY)?.fireChange(true);
    expect(mediaPrefs.prefersMoreContrast()).toBe(true);
    expect(mediaPrefs.forcedColors()).toBe(true);
  });
});
