// SPDX-License-Identifier: AGPL-3.0-or-later

export type BoundedAbortCause = 'caller' | 'timeout' | null;

export interface BoundedAbort {
  readonly signal: AbortSignal;
  cause(): BoundedAbortCause;
  dispose(): void;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

function timeoutError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation timed out.', 'TimeoutError');
  }
  const error = new Error('The operation timed out.');
  error.name = 'TimeoutError';
  return error;
}

function boundedTimeout(value: number): number {
  if (!Number.isFinite(value)) return MAX_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.floor(value)));
}

/**
 * Compose caller cancellation with a bounded timeout. Modern browsers use
 * AbortSignal.timeout/any; the controller fallback preserves the first abort
 * reason and owns a clearable timer for older engines and deterministic tests.
 */
export function createBoundedAbort(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): BoundedAbort {
  if (callerSignal?.aborted) {
    return {
      signal: callerSignal,
      cause: () => 'caller',
      dispose: () => undefined,
    };
  }

  const delay = boundedTimeout(timeoutMs);
  let cause: BoundedAbortCause = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutSignal: AbortSignal;

  try {
    if (typeof AbortSignal.timeout !== 'function') throw new Error('unsupported');
    timeoutSignal = AbortSignal.timeout(delay);
  } catch {
    const timeoutController = new AbortController();
    timeoutSignal = timeoutController.signal;
    fallbackTimer = setTimeout(() => {
      if (cause === null) cause = 'timeout';
      timeoutController.abort(timeoutError());
    }, delay);
  }

  const onCallerAbort = (): void => {
    if (cause === null) cause = 'caller';
  };
  const onTimeoutAbort = (): void => {
    if (cause === null) cause = 'timeout';
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true });

  let signal = timeoutSignal;
  const fallbackListeners: Array<() => void> = [];
  if (callerSignal) {
    try {
      if (typeof AbortSignal.any !== 'function') throw new Error('unsupported');
      signal = AbortSignal.any([callerSignal, timeoutSignal]);
    } catch {
      const combined = new AbortController();
      const forwardCaller = (): void => {
        if (!combined.signal.aborted) combined.abort(callerSignal.reason);
      };
      const forwardTimeout = (): void => {
        if (!combined.signal.aborted) combined.abort(timeoutSignal.reason);
      };
      callerSignal.addEventListener('abort', forwardCaller, { once: true });
      timeoutSignal.addEventListener('abort', forwardTimeout, { once: true });
      fallbackListeners.push(
        () => callerSignal.removeEventListener('abort', forwardCaller),
        () => timeoutSignal.removeEventListener('abort', forwardTimeout),
      );
      signal = combined.signal;
    }
  }

  let disposed = false;
  return {
    signal,
    cause: () => cause,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = null;
      callerSignal?.removeEventListener('abort', onCallerAbort);
      timeoutSignal.removeEventListener('abort', onTimeoutAbort);
      for (const cleanup of fallbackListeners) cleanup();
    },
  };
}
