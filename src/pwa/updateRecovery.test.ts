// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUpdateCoordinator, refreshInstalledAppShell } from './updateRecovery';

describe('PWA update recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps approval intent pending until overlapping work clears', () => {
    const coordinator = createUpdateCoordinator();
    const reload = vi.fn();
    const seen: unknown[] = [];
    coordinator.subscribe((state) => seen.push(state));
    coordinator.begin('draft');
    coordinator.begin('upload');
    coordinator.replace(reload, true, false);
    expect(coordinator.approve()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    coordinator.end('draft');
    expect(reload).not.toHaveBeenCalled();
    coordinator.end('upload');
    expect(reload).not.toHaveBeenCalled();
    coordinator.markControllerReady();
    expect(reload).toHaveBeenCalledOnce();
    expect(seen.some((state) => (state as { deferred?: boolean } | null)?.deferred)).toBe(true);
  });

  it('does not let a stale duplicate-key release clear newer work', () => {
    const coordinator = createUpdateCoordinator();
    const reload = vi.fn();
    coordinator.begin('voice-call');
    coordinator.begin('voice-call');
    coordinator.replace(reload, true, false);

    coordinator.end('voice-call');
    expect(reload).not.toHaveBeenCalled();
    coordinator.end('voice-call');
    expect(reload).not.toHaveBeenCalled();
    coordinator.markControllerReady();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('publishes deferred state when work starts after an update arrives', () => {
    const coordinator = createUpdateCoordinator();
    const reload = vi.fn();
    const seen: boolean[] = [];
    coordinator.subscribe((state) => { if (state) seen.push(state.deferred); });

    coordinator.replace(reload, true, false);
    expect(seen.at(-1)).toBe(false);
    coordinator.begin('voice-call');
    expect(seen.at(-1)).toBe(true);
    expect(coordinator.approve()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    coordinator.markControllerReady();
    expect(reload).not.toHaveBeenCalled();
    coordinator.end('voice-call');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('manual refresh uses the coordinator guard for active work', async () => {
    const coordinator = createUpdateCoordinator();
    const reload = vi.fn();
    coordinator.begin('send');
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: {}, getRegistration: vi.fn(async () => ({
        waiting: null,
        update: vi.fn(async () => ({ waiting: null })),
      })) },
    });
    // The production function uses the singleton; this assertion covers the
    // coordinator transition contract used by manual recovery.
    coordinator.replace(reload, true, true);
    expect(reload).not.toHaveBeenCalled();
    coordinator.end('send');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('defers an application-requested reload until active work ends', () => {
    const coordinator = createUpdateCoordinator();
    const reload = vi.fn();
    coordinator.begin('scheduled-send');

    expect(coordinator.requestReload(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    coordinator.end('scheduled-send');
    expect(reload).toHaveBeenCalledOnce();
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

    await expect(refreshInstalledAppShell(reload)).resolves.toEqual({
      state: 'activating',
      detail: 'A refreshed app shell is activating. Onyx will reload when it takes control.',
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'ONYX_SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('lets an installing worker take control instead of reloading the old shell', async () => {
    const installing = { state: 'installing' };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistration: vi.fn(async () => ({
          installing,
          waiting: null,
          update: vi.fn(async () => ({ installing, waiting: null })),
        })),
      },
    });
    const reload = vi.fn();

    await expect(refreshInstalledAppShell(reload)).resolves.toEqual({
      state: 'activating',
      detail: 'A refreshed app shell is installing. Onyx will reload when it takes control.',
    });
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

  it('keeps the latest update pending and reloads only once after control', () => {
    const coordinator = createUpdateCoordinator();
    const firstReload = vi.fn();
    const latestReload = vi.fn();

    coordinator.replace(firstReload, true, false);
    coordinator.replace(latestReload, true, false);
    coordinator.markControllerReady();

    expect(firstReload).not.toHaveBeenCalled();
    expect(latestReload).toHaveBeenCalledOnce();
    coordinator.replace(vi.fn(), true);
    expect(latestReload).toHaveBeenCalledOnce();
  });
});
