// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReducedDataSignal, makeSaveDataSignal } from './reducedData';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'connection');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  vi.restoreAllMocks();
});

describe('reduced data preference', () => {
  it('reacts to Network Information saveData changes and removes its listener', () => {
    let listener: (() => void) | undefined;
    const connection = {
      saveData: false,
      addEventListener: vi.fn((_type: string, next: () => void) => {
        listener = next;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
    let read: (() => boolean) | undefined;

    const mounted = render(() => {
      read = makeSaveDataSignal();
      return null;
    });
    expect(read?.()).toBe(false);

    connection.saveData = true;
    listener?.();
    expect(read?.()).toBe(true);
    mounted.unmount();
    expect(connection.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('combines prefers-reduced-data with saveData and degrades without either API', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    let read: (() => boolean) | undefined;
    const mounted = render(() => {
      read = makeReducedDataSignal();
      return null;
    });
    expect(read?.()).toBe(true);
    mounted.unmount();

    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    const unsupported = render(() => {
      read = makeReducedDataSignal();
      return null;
    });
    expect(read?.()).toBe(false);
    unsupported.unmount();
  });
});
