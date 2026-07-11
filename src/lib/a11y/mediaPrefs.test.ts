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
  fireChange: (nextMatches: boolean) => void;
}

const QUERY = '(prefers-reduced-motion: reduce)';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

function installMatchMedia(fakeQueryList: FakeMediaQueryList): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((_query: string): MediaQueryList => fakeQueryList as unknown as MediaQueryList),
  });
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
    fireChange: (nextMatches) => {
      fakeQueryList.matches = nextMatches;
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

describe('makeMediaSignal', () => {
  it('reflects the initial media query match', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(true);
    installMatchMedia(fakeQueryList);

    // Act
    const signal = makeMediaSignal(QUERY);

    // Assert
    expect(signal()).toBe(true);
  });

  it('updates when a change event flips the match', () => {
    // Arrange
    const fakeQueryList = createFakeMediaQueryList(false);
    installMatchMedia(fakeQueryList);
    const signal = makeMediaSignal(QUERY);

    // Act
    fakeQueryList.fireChange(true);

    // Assert
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
});
