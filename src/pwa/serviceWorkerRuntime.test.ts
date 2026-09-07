// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { startServiceWorkerRuntime } from './serviceWorkerRuntime';
import { createUpdateCoordinator } from './updateRecovery';

type ControllerChangeListener = () => void;

function serviceWorkerHarness(initiallyControlled: boolean) {
  let listener: ControllerChangeListener | undefined;
  const serviceWorker = {
    controller: initiallyControlled ? {} : null as object | null,
    register: vi.fn(async () => ({} as ServiceWorkerRegistration)),
    addEventListener: vi.fn((type: string, next: ControllerChangeListener) => {
      if (type === 'controllerchange') listener = next;
    }),
  };
  return {
    serviceWorker,
    changeController(controller: object | null) {
      serviceWorker.controller = controller;
      listener?.();
    },
  };
}

describe('service-worker page runtime', () => {
  it('does not reload when the first worker claims an uncontrolled app page', async () => {
    const harness = serviceWorkerHarness(false);
    const reload = vi.fn();

    startServiceWorkerRuntime(harness.serviceWorker, reload, undefined, createUpdateCoordinator());
    harness.changeController({ first: true });
    await Promise.resolve();

    expect(harness.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      updateViaCache: 'none',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads exactly once when an existing controller is replaced', () => {
    const harness = serviceWorkerHarness(true);
    const reload = vi.fn();

    startServiceWorkerRuntime(harness.serviceWorker, reload, undefined, createUpdateCoordinator());
    harness.changeController({ replacement: 1 });
    harness.changeController({ replacement: 2 });

    expect(reload).toHaveBeenCalledOnce();
  });

  it('arms replacement recovery after the non-reloading first acquisition', () => {
    const harness = serviceWorkerHarness(false);
    const reload = vi.fn();

    startServiceWorkerRuntime(harness.serviceWorker, reload, undefined, createUpdateCoordinator());
    harness.changeController({ first: true });
    harness.changeController({ replacement: true });

    expect(reload).toHaveBeenCalledOnce();
  });

  it('defers replacement while local work is active and retries when it clears', () => {
    const harness = serviceWorkerHarness(true);
    const reload = vi.fn();
    const coordinator = createUpdateCoordinator();
    coordinator.begin('call');

    startServiceWorkerRuntime(harness.serviceWorker, reload, undefined, coordinator);
    harness.changeController({ replacement: true });
    expect(reload).not.toHaveBeenCalled();

    coordinator.end('call');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('allows deliberate approval after deferred work and ignores duplicate approval', () => {
    const harness = serviceWorkerHarness(true);
    const reload = vi.fn();
    const coordinator = createUpdateCoordinator();
    coordinator.begin('upload');

    startServiceWorkerRuntime(harness.serviceWorker, reload, undefined, coordinator);
    harness.changeController({ replacement: true });
    coordinator.end('upload');
    expect(reload).toHaveBeenCalledOnce();
    coordinator.approve();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('waits for an explicit approval when the host reports unsafe state', () => {
    const harness = serviceWorkerHarness(true);
    const reload = vi.fn();
    const coordinator = createUpdateCoordinator();

    startServiceWorkerRuntime(harness.serviceWorker, reload, () => false, coordinator);
    harness.changeController({ replacement: true });
    expect(reload).not.toHaveBeenCalled();
    expect(coordinator.approve()).toBe(true);
    coordinator.approve();
    expect(reload).toHaveBeenCalledOnce();
  });
});
