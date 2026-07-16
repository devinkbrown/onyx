// SPDX-License-Identifier: AGPL-3.0-or-later

export type CancelBackgroundTask = () => void;

export interface BackgroundTaskScheduler {
  postTask(
    callback: () => void,
    options: { priority: 'background'; signal: AbortSignal },
  ): Promise<unknown>;
}

export interface BackgroundTaskEnvironment {
  readonly scheduler?: BackgroundTaskScheduler;
  readonly requestIdleCallback?: (
    callback: () => void,
    options: { timeout: number },
  ) => number;
  readonly cancelIdleCallback?: (id: number) => void;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
}

export interface BackgroundTaskOptions {
  /** Maximum wait supplied to requestIdleCallback. */
  idleTimeoutMs?: number;
  /** Delay used by the final timer fallback. Clamped to a bounded window. */
  timerDelayMs?: number;
  /** Injectable browser surface for deterministic tests. */
  environment?: BackgroundTaskEnvironment;
}

const DEFAULT_IDLE_TIMEOUT_MS = 2_000;
const DEFAULT_TIMER_DELAY_MS = 200;
const MAX_BACKGROUND_WAIT_MS = 5_000;

function boundedDelay(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_BACKGROUND_WAIT_MS, Math.max(0, value));
}

function browserEnvironment(): BackgroundTaskEnvironment | undefined {
  if (typeof globalThis === 'undefined') return undefined;

  let scheduler: BackgroundTaskScheduler | undefined;
  try {
    const candidate = (globalThis as typeof globalThis & {
      scheduler?: Partial<BackgroundTaskScheduler>;
    }).scheduler;
    if (candidate && typeof candidate.postTask === 'function') {
      scheduler = candidate as BackgroundTaskScheduler;
    }
  } catch {
    // Cross-origin/restricted capability getters can throw. Continue down the
    // scheduling ladder rather than making idle preload a boot dependency.
  }

  let requestIdleCallback: BackgroundTaskEnvironment['requestIdleCallback'];
  let cancelIdleCallback: BackgroundTaskEnvironment['cancelIdleCallback'];
  try {
    const idleWindow = globalThis as typeof globalThis & {
      requestIdleCallback?: BackgroundTaskEnvironment['requestIdleCallback'];
      cancelIdleCallback?: BackgroundTaskEnvironment['cancelIdleCallback'];
    };
    if (
      typeof idleWindow.requestIdleCallback === 'function'
      && typeof idleWindow.cancelIdleCallback === 'function'
    ) {
      requestIdleCallback = idleWindow.requestIdleCallback.bind(globalThis);
      cancelIdleCallback = idleWindow.cancelIdleCallback.bind(globalThis);
    }
  } catch {
    // Fall through to the bounded timer.
  }

  return {
    scheduler,
    requestIdleCallback,
    cancelIdleCallback,
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

/**
 * Schedule non-essential work at background priority and return cancellation.
 *
 * The tier order is Web Scheduling API, requestIdleCallback, then a short
 * bounded timer. Scheduler rejection falls through to the next tier unless the
 * task was cancelled. Every callback is guarded as well as natively cancelled,
 * so a browser that delivers an already-queued callback after cancellation
 * still cannot execute disposed-shell work.
 */
export function scheduleBackgroundTask(
  task: () => void,
  options: BackgroundTaskOptions = {},
): CancelBackgroundTask {
  const environment = options.environment ?? browserEnvironment();
  if (!environment) return () => {};

  const idleTimeoutMs = boundedDelay(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  const timerDelayMs = boundedDelay(options.timerDelayMs, DEFAULT_TIMER_DELAY_MS);

  let cancelled = false;
  let completed = false;
  let abortController: AbortController | null = null;
  let idleId: number | null = null;
  let timerId: unknown = null;

  const run = () => {
    if (cancelled || completed) return;
    completed = true;
    task();
  };

  const scheduleTimer = () => {
    if (cancelled || completed || timerId !== null) return;
    timerId = environment.setTimeout(() => {
      timerId = null;
      run();
    }, timerDelayMs);
  };

  const scheduleIdleOrTimer = () => {
    if (cancelled || completed || idleId !== null || timerId !== null) return;
    const requestIdle = environment.requestIdleCallback;
    const cancelIdle = environment.cancelIdleCallback;
    if (typeof requestIdle === 'function' && typeof cancelIdle === 'function') {
      try {
        idleId = requestIdle(() => {
          idleId = null;
          run();
        }, { timeout: idleTimeoutMs });
        return;
      } catch {
        // A present-but-unusable idle API is equivalent to no API.
      }
    }
    scheduleTimer();
  };

  const postTask = environment.scheduler?.postTask;
  if (typeof postTask === 'function' && typeof AbortController !== 'undefined') {
    abortController = new AbortController();
    try {
      const scheduled = postTask.call(environment.scheduler, run, {
        priority: 'background',
        signal: abortController.signal,
      });
      if (scheduled && typeof scheduled.catch === 'function') {
        void scheduled.catch(() => {
          if (!cancelled && !completed) scheduleIdleOrTimer();
        });
      } else {
        // A non-standard lookalike is not a usable Web Scheduling API.
        scheduleIdleOrTimer();
      }
    } catch {
      scheduleIdleOrTimer();
    }
  } else {
    scheduleIdleOrTimer();
  }

  return () => {
    if (cancelled || completed) return;
    cancelled = true;
    abortController?.abort();
    if (idleId !== null) {
      environment.cancelIdleCallback?.(idleId);
      idleId = null;
    }
    if (timerId !== null) {
      environment.clearTimeout(timerId);
      timerId = null;
    }
  };
}
