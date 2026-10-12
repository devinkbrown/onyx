// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { BoundedAbort } from '@/lib/net/boundedAbort';
import {
  constrainHighResolutionQuality,
  createHighResolutionCapabilityProbe,
} from './mediaCapabilities';

function abortHarness(): {
  controller: AbortController;
  bounded: BoundedAbort;
  dispose: ReturnType<typeof vi.fn>;
} {
  const controller = new AbortController();
  const dispose = vi.fn();
  return {
    controller,
    dispose,
    bounded: {
      signal: controller.signal,
      cause: () => controller.signal.aborted ? 'timeout' : null,
      dispose,
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

describe('high-resolution Media Capabilities probe', () => {
  it('keeps current behavior when the API is unsupported', () => {
    const probe = createHighResolutionCapabilityProbe({ mediaCapabilities: null });

    probe.prime();
    probe.prime();

    expect(probe.current()).toBe('unknown');
    expect(constrainHighResolutionQuality('4k60', probe.current())).toBe('4k60');
  });

  it('caches a supported, smooth, power-efficient 4K workload', async () => {
    const harness = abortHarness();
    const encodingInfo = vi.fn(async () => ({
      supported: true,
      smooth: true,
      powerEfficient: true,
    }));
    const createAbort = vi.fn(() => harness.bounded);
    const probe = createHighResolutionCapabilityProbe({
      mediaCapabilities: { encodingInfo },
      createAbort,
    });

    probe.prime();
    probe.prime();

    await vi.waitFor(() => expect(probe.current()).toBe('efficient'));
    expect(encodingInfo).toHaveBeenCalledOnce();
    expect(encodingInfo).toHaveBeenCalledWith(expect.objectContaining({
      type: 'record',
      video: expect.objectContaining({ width: 3_840, height: 2_160, framerate: 60 }),
    }));
    expect(createAbort).toHaveBeenCalledWith(250);
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(constrainHighResolutionQuality('4k60', probe.current())).toBe('4k60');
  });

  it('constrains only 4K when the workload is explicitly unsupported', async () => {
    const harness = abortHarness();
    const probe = createHighResolutionCapabilityProbe({
      mediaCapabilities: {
        encodingInfo: vi.fn(async () => ({
          supported: false,
          smooth: false,
          powerEfficient: false,
        })),
      },
      createAbort: () => harness.bounded,
    });

    probe.prime();
    await vi.waitFor(() => expect(probe.current()).toBe('constrained'));

    expect(constrainHighResolutionQuality('4k60', probe.current())).toBe('1080p60');
    expect(constrainHighResolutionQuality('1080p60', probe.current())).toBe('1080p60');
    expect(constrainHighResolutionQuality('auto', probe.current())).toBe('auto');
  });

  it.each([
    { smooth: false, powerEfficient: true, reason: 'not smooth' },
    { smooth: true, powerEfficient: false, reason: 'not power-efficient' },
  ])('constrains a supported workload when it is $reason', async ({ smooth, powerEfficient }) => {
    const harness = abortHarness();
    const probe = createHighResolutionCapabilityProbe({
      mediaCapabilities: {
        encodingInfo: vi.fn(async () => ({ supported: true, smooth, powerEfficient })),
      },
      createAbort: () => harness.bounded,
    });

    probe.prime();

    await vi.waitFor(() => expect(probe.current()).toBe('constrained'));
    expect(constrainHighResolutionQuality('4k60', probe.current())).toBe('1080p60');
  });

  it('falls back to current behavior when encodingInfo rejects', async () => {
    const harness = abortHarness();
    const encodingInfo = vi.fn(() => Promise.reject(new DOMException('Blocked', 'NotAllowedError')));
    const probe = createHighResolutionCapabilityProbe({
      mediaCapabilities: { encodingInfo },
      createAbort: () => harness.bounded,
    });

    probe.prime();
    await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

    expect(probe.current()).toBe('unknown');
    expect(constrainHighResolutionQuality('4k60', probe.current())).toBe('4k60');
  });

  it('times out without blocking and ignores a late capability result', async () => {
    const harness = abortHarness();
    const pending = deferred<{ supported: boolean; smooth: boolean; powerEfficient: boolean }>();
    const encodingInfo = vi.fn(() => pending.promise);
    const probe = createHighResolutionCapabilityProbe({
      mediaCapabilities: { encodingInfo },
      createAbort: () => harness.bounded,
    });

    probe.prime();
    expect(probe.current()).toBe('unknown');
    harness.controller.abort();
    await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
    expect(probe.current()).toBe('unknown');

    pending.resolve({ supported: true, smooth: true, powerEfficient: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(probe.current()).toBe('unknown');
    expect(encodingInfo).toHaveBeenCalledOnce();
  });
});
