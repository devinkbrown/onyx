// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { startServiceWorkerRuntime } from './serviceWorkerRuntime';

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

    startServiceWorkerRuntime(harness.serviceWorker, reload);
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

    startServiceWorkerRuntime(harness.serviceWorker, reload);
    harness.changeController({ replacement: 1 });
    harness.changeController({ replacement: 2 });

    expect(reload).toHaveBeenCalledOnce();
  });

  it('arms replacement recovery after the non-reloading first acquisition', () => {
    const harness = serviceWorkerHarness(false);
    const reload = vi.fn();

    startServiceWorkerRuntime(harness.serviceWorker, reload);
    harness.changeController({ first: true });
    harness.changeController({ replacement: true });

    expect(reload).toHaveBeenCalledOnce();
  });
});
