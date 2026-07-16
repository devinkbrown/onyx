// SPDX-License-Identifier: AGPL-3.0-or-later

/** The small part of WakeLockSentinel used by the lifecycle controller. */
export interface ScreenWakeLockSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

/** The small part of WakeLock used by the lifecycle controller. */
export interface ScreenWakeLockManager {
  request(type: 'screen'): Promise<ScreenWakeLockSentinel>;
}

interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface ScreenWakeLockController {
  /** Hold a screen wake lock while active; false releases any held lock. */
  setActive(active: boolean): void;
  /** Remove listeners and release any held lock. Safe to call more than once. */
  dispose(): void;
}

interface ScreenWakeLockOptions {
  document?: VisibilityDocument;
  manager?: ScreenWakeLockManager;
}

function browserWakeLockManager(): ScreenWakeLockManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  try {
    return (navigator as Navigator & { wakeLock?: ScreenWakeLockManager }).wakeLock;
  } catch {
    // Capability getters can throw in restricted browsing contexts.
    return undefined;
  }
}

/**
 * Coordinate a screen wake lock with an explicit activity lifecycle.
 *
 * Creation never requests a lock. A request is made only after setActive(true)
 * while the document is visible. Browser denial and lack of API support are
 * silent capability fallbacks: they never alter the media session itself.
 *
 * A browser-initiated sentinel release deliberately does not trigger an
 * immediate replacement request. Some user agents release locks under system
 * pressure while still reporting the document as visible; retrying in that
 * event handler can become a tight request/release loop. A later visibility
 * return or a new inactive-to-active transition is the safe retry boundary.
 */
export function createScreenWakeLockController(
  options: ScreenWakeLockOptions = {},
): ScreenWakeLockController {
  const visibilityDocument = options.document
    ?? (typeof document !== 'undefined' ? document : undefined);
  const manager = options.manager ?? browserWakeLockManager();

  let active = false;
  let disposed = false;
  let epoch = 0;
  let pendingRequest: number | null = null;
  let sentinel: ScreenWakeLockSentinel | null = null;
  let sentinelReleaseListener: (() => void) | null = null;

  const invalidatePendingRequest = () => {
    epoch += 1;
    pendingRequest = null;
  };

  const releaseHeldLock = () => {
    const held = sentinel;
    const listener = sentinelReleaseListener;
    sentinel = null;
    sentinelReleaseListener = null;
    if (!held) return;
    if (listener) held.removeEventListener('release', listener);
    void held.release().catch(() => {
      // Release is best-effort; call teardown must continue regardless.
    });
  };

  const acquire = async () => {
    if (
      disposed
      || !active
      || !manager
      || !visibilityDocument
      || visibilityDocument.visibilityState !== 'visible'
      || sentinel
      || pendingRequest !== null
    ) return;

    const requestId = ++epoch;
    pendingRequest = requestId;
    try {
      const next = await manager.request('screen');
      if (
        disposed
        || !active
        || visibilityDocument.visibilityState !== 'visible'
        || pendingRequest !== requestId
        || epoch !== requestId
      ) {
        await next.release().catch(() => {
          // A stale request must not survive a call-end/visibility race.
        });
        return;
      }

      // A user agent may return an already-released sentinel. Treat it exactly
      // like an external release and wait for the next safe retry boundary.
      if (next.released) return;

      const onRelease = () => {
        if (sentinel !== next) return;
        next.removeEventListener('release', onRelease);
        sentinel = null;
        sentinelReleaseListener = null;
      };
      sentinel = next;
      sentinelReleaseListener = onRelease;
      next.addEventListener('release', onRelease);
    } catch {
      // Denial/unsupported contexts must not affect the active media call.
    } finally {
      if (pendingRequest === requestId) pendingRequest = null;
    }
  };

  const handleVisibilityChange = () => {
    if (disposed || !visibilityDocument) return;
    if (visibilityDocument.visibilityState === 'visible') {
      void acquire();
      return;
    }
    invalidatePendingRequest();
    releaseHeldLock();
  };

  visibilityDocument?.addEventListener('visibilitychange', handleVisibilityChange);

  return {
    setActive(nextActive) {
      if (disposed || active === nextActive) return;
      active = nextActive;
      if (active) {
        void acquire();
      } else {
        invalidatePendingRequest();
        releaseHeldLock();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      visibilityDocument?.removeEventListener('visibilitychange', handleVisibilityChange);
      invalidatePendingRequest();
      releaseHeldLock();
    },
  };
}
