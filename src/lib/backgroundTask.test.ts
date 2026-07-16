// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  scheduleBackgroundTask,
  type BackgroundTaskEnvironment,
  type BackgroundTaskScheduler,
} from './backgroundTask';

function environment(
  overrides: Partial<BackgroundTaskEnvironment> = {},
): BackgroundTaskEnvironment {
  return {
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    ...overrides,
  };
}

describe('scheduleBackgroundTask', () => {
  it('prefers scheduler.postTask with background priority', () => {
    let scheduledCallback: (() => void) | undefined;
    let scheduledSignal: AbortSignal | undefined;
    const postTask = vi.fn<BackgroundTaskScheduler['postTask']>((callback, options) => {
      scheduledCallback = callback;
      scheduledSignal = options.signal;
      return new Promise(() => {});
    });
    const requestIdleCallback = vi.fn(() => 7);
    const setTimeout = vi.fn(() => 8);
    const task = vi.fn();

    scheduleBackgroundTask(task, {
      environment: environment({
        scheduler: { postTask },
        requestIdleCallback,
        cancelIdleCallback: vi.fn(),
        setTimeout,
      }),
    });

    expect(postTask).toHaveBeenCalledOnce();
    expect(postTask.mock.calls[0]?.[1].priority).toBe('background');
    expect(scheduledSignal).toBeInstanceOf(AbortSignal);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();

    scheduledCallback?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it('falls back to requestIdleCallback with a bounded timeout', () => {
    let idleCallback: (() => void) | undefined;
    const requestIdleCallback = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 23;
    });
    const setTimeout = vi.fn(() => 8);
    const task = vi.fn();

    scheduleBackgroundTask(task, {
      idleTimeoutMs: 20_000,
      environment: environment({
        requestIdleCallback,
        cancelIdleCallback: vi.fn(),
        setTimeout,
      }),
    });

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000 });
    expect(setTimeout).not.toHaveBeenCalled();
    idleCallback?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it('uses a bounded timer when neither background API tier is usable', () => {
    let timerCallback: (() => void) | undefined;
    const setTimeout = vi.fn((callback: () => void) => {
      timerCallback = callback;
      return 41;
    });
    const task = vi.fn();

    scheduleBackgroundTask(task, {
      timerDelayMs: Number.POSITIVE_INFINITY,
      environment: environment({ setTimeout }),
    });

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 200);
    timerCallback?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it('cancels idle work before execution and guards against a late callback', () => {
    let idleCallback: (() => void) | undefined;
    const requestIdleCallback = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 51;
    });
    const cancelIdleCallback = vi.fn();
    const task = vi.fn();
    const cancel = scheduleBackgroundTask(task, {
      environment: environment({ requestIdleCallback, cancelIdleCallback }),
    });

    cancel();
    idleCallback?.();

    expect(cancelIdleCallback).toHaveBeenCalledWith(51);
    expect(task).not.toHaveBeenCalled();
  });

  it('falls through to idle work when postTask rejects', async () => {
    let idleCallback: (() => void) | undefined;
    const postTask = vi.fn<BackgroundTaskScheduler['postTask']>(() => (
      Promise.reject(new DOMException('Unavailable', 'NotSupportedError'))
    ));
    const requestIdleCallback = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 61;
    });
    const task = vi.fn();

    scheduleBackgroundTask(task, {
      environment: environment({
        scheduler: { postTask },
        requestIdleCallback,
        cancelIdleCallback: vi.fn(),
      }),
    });

    await vi.waitFor(() => expect(requestIdleCallback).toHaveBeenCalledOnce());
    idleCallback?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it('aborts postTask on cleanup without falling back after its rejection', async () => {
    let scheduledCallback: (() => void) | undefined;
    let rejectPostTask: ((reason?: unknown) => void) | undefined;
    let scheduledSignal: AbortSignal | undefined;
    const scheduled = new Promise<unknown>((_resolve, reject) => {
      rejectPostTask = reject;
    });
    const postTask = vi.fn<BackgroundTaskScheduler['postTask']>((callback, options) => {
      scheduledCallback = callback;
      scheduledSignal = options.signal;
      return scheduled;
    });
    const requestIdleCallback = vi.fn(() => 71);
    const setTimeout = vi.fn(() => 72);
    const task = vi.fn();
    const cancel = scheduleBackgroundTask(task, {
      environment: environment({
        scheduler: { postTask },
        requestIdleCallback,
        cancelIdleCallback: vi.fn(),
        setTimeout,
      }),
    });

    cancel();
    rejectPostTask?.(new DOMException('Aborted', 'AbortError'));
    await Promise.resolve();
    scheduledCallback?.();

    expect(scheduledSignal?.aborted).toBe(true);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
  });

  it('clears the final timer during cleanup and remains idempotent', () => {
    let timerCallback: (() => void) | undefined;
    const timerToken = { id: 81 };
    const setTimeout = vi.fn((callback: () => void) => {
      timerCallback = callback;
      return timerToken;
    });
    const clearTimeout = vi.fn();
    const task = vi.fn();
    const cancel = scheduleBackgroundTask(task, {
      environment: environment({ setTimeout, clearTimeout }),
    });

    cancel();
    cancel();
    timerCallback?.();

    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(clearTimeout).toHaveBeenCalledWith(timerToken);
    expect(task).not.toHaveBeenCalled();
  });
});
