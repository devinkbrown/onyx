// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshInstalledAppShell } from './updateRecovery';

describe('PWA update recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('navigator', {});

    await expect(refreshInstalledAppShell()).resolves.toMatchObject({
      state: 'unsupported',
    });
  });

  it('activates a waiting worker without forcing an immediate reload', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistration: vi.fn(async () => ({
          waiting: { postMessage },
          update: vi.fn(async () => ({ waiting: { postMessage } })),
        })),
      },
    });
    const reload = vi.fn();

    await expect(refreshInstalledAppShell(reload)).resolves.toMatchObject({
      state: 'activating',
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'ONYX_SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the stamped shell when the current worker already controls the page', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistration: vi.fn(async () => ({
          waiting: null,
          update: vi.fn(async () => ({ waiting: null })),
        })),
      },
    });
    const reload = vi.fn();

    await expect(refreshInstalledAppShell(reload)).resolves.toMatchObject({
      state: 'reloading',
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reports a failed recovery instead of presenting an update error as checked', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistration: vi.fn(async () => ({
          waiting: null,
          update: vi.fn(async () => {
            throw new Error('offline');
          }),
        })),
      },
    });

    await expect(refreshInstalledAppShell(vi.fn())).resolves.toEqual({
      state: 'failed',
      detail: 'Update recovery could not complete. Use the browser reload control once.',
    });
  });
});
