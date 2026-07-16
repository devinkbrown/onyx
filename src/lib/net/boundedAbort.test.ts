// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoundedAbort } from './boundedAbort';

const staticRestorers: Array<() => void> = [];

function replaceAbortSignalStatic(
  name: 'timeout' | 'any',
  value: unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, name);
  Object.defineProperty(AbortSignal, name, { configurable: true, writable: true, value });
  staticRestorers.push(() => {
    if (descriptor) Object.defineProperty(AbortSignal, name, descriptor);
    else Reflect.deleteProperty(AbortSignal, name);
  });
}

function forceFallback(): void {
  replaceAbortSignalStatic('timeout', undefined);
  replaceAbortSignalStatic('any', undefined);
}

afterEach(() => {
  vi.useRealTimers();
  for (const restore of staticRestorers.splice(0).reverse()) restore();
  vi.restoreAllMocks();
});

describe('createBoundedAbort', () => {
  it('uses AbortSignal.timeout and AbortSignal.any when both are available', () => {
    const timeoutController = new AbortController();
    const combinedController = new AbortController();
    const timeout = vi.fn(() => timeoutController.signal);
    const any = vi.fn(() => combinedController.signal);
    replaceAbortSignalStatic('timeout', timeout);
    replaceAbortSignalStatic('any', any);
    const caller = new AbortController();

    const bounded = createBoundedAbort(250, caller.signal);

    expect(timeout).toHaveBeenCalledWith(250);
    expect(any).toHaveBeenCalledWith([caller.signal, timeoutController.signal]);
    expect(bounded.signal).toBe(combinedController.signal);
    bounded.dispose();
  });

  it('falls back to a deterministic TimeoutError when modern statics are unavailable', () => {
    forceFallback();
    vi.useFakeTimers();
    const bounded = createBoundedAbort(25);

    vi.advanceTimersByTime(24);
    expect(bounded.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);

    expect(bounded.signal.aborted).toBe(true);
    expect(bounded.cause()).toBe('timeout');
    expect((bounded.signal.reason as Error).name).toBe('TimeoutError');
    bounded.dispose();
  });

  it('preserves caller cancellation when it wins the fallback race', () => {
    forceFallback();
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new DOMException('User cancelled', 'AbortError');
    const bounded = createBoundedAbort(50, caller.signal);

    caller.abort(reason);
    vi.advanceTimersByTime(50);

    expect(bounded.signal.aborted).toBe(true);
    expect(bounded.signal.reason).toBe(reason);
    expect(bounded.cause()).toBe('caller');
    bounded.dispose();
  });

  it('keeps timeout classification when caller abort arrives after the deadline', () => {
    forceFallback();
    vi.useFakeTimers();
    const caller = new AbortController();
    const bounded = createBoundedAbort(10, caller.signal);

    vi.advanceTimersByTime(10);
    caller.abort(new DOMException('late', 'AbortError'));

    expect(bounded.cause()).toBe('timeout');
    expect((bounded.signal.reason as Error).name).toBe('TimeoutError');
    bounded.dispose();
  });

  it('clears fallback timers and forwarding listeners on early disposal', () => {
    forceFallback();
    vi.useFakeTimers();
    const caller = new AbortController();
    const bounded = createBoundedAbort(100, caller.signal);

    expect(vi.getTimerCount()).toBe(1);
    bounded.dispose();
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    vi.advanceTimersByTime(100);

    expect(bounded.signal.aborted).toBe(false);
    expect(bounded.cause()).toBeNull();
  });

  it('short-circuits an already-aborted caller without allocating a timeout', () => {
    const timeout = vi.fn();
    replaceAbortSignalStatic('timeout', timeout);
    const caller = new AbortController();
    caller.abort(new DOMException('cancelled', 'AbortError'));

    const bounded = createBoundedAbort(100, caller.signal);

    expect(bounded.signal).toBe(caller.signal);
    expect(bounded.cause()).toBe('caller');
    expect(timeout).not.toHaveBeenCalled();
  });
});
