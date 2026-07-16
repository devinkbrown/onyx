// SPDX-License-Identifier: AGPL-3.0-or-later
/** Central lifecycle policy for CSS-animated DOM/SVG background scenes. */
import {
  ACTIVITY_THROTTLE_MS,
  IDLE_DECEL_AFTER_MS,
  IDLE_DECEL_RAMP_MS,
} from '../engine';

/** Canvas reaches its idle cadence floor after this same total window. */
export const SCENE_IDLE_HOLD_MS = IDLE_DECEL_AFTER_MS + IDLE_DECEL_RAMP_MS;

const PASSIVE_ACTIVITY_OPTIONS: AddEventListenerOptions = { passive: true };
const PASSIVE_CAPTURE_ACTIVITY_OPTIONS: AddEventListenerOptions = { passive: true, capture: true };

export interface SceneRuntimeOptions {
  idleHoldMs?: number;
  now?: () => number;
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function documentIsHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * Attach one scene's visibility, focus, activity, and idle lifecycle. Runtime
 * pause is deliberately separate from the user's Still preference: callers
 * freeze CSS playback without reclassifying the selected scene as `solid`.
 */
export function startSceneRuntime(
  onPausedChange: (paused: boolean) => void,
  options: SceneRuntimeOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const idleHoldMs = options.idleHoldMs ?? SCENE_IDLE_HOLD_MS;
  const now = options.now ?? defaultNow;
  let hidden = documentIsHidden();
  let blurred = typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
  let paused = false;
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityAt: number | null = null;

  const emitPaused = (next: boolean): void => {
    if (disposed || paused === next) return;
    paused = next;
    onPausedChange(next);
  };

  const clearIdleTimer = (): void => {
    if (idleTimer === null) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const armIdleHold = (): void => {
    clearIdleTimer();
    if (hidden || blurred) {
      emitPaused(true);
      return;
    }

    emitPaused(false);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      emitPaused(true);
    }, Math.max(0, idleHoldMs));
  };

  const handleActivity = (): void => {
    const at = now();
    if (lastActivityAt !== null && at - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityAt = at;
    if (!hidden && !blurred) armIdleHold();
  };

  const handleVisibilityChange = (): void => {
    hidden = documentIsHidden();
    lastActivityAt = null;
    if (hidden) {
      clearIdleTimer();
      emitPaused(true);
    } else if (!blurred) {
      armIdleHold();
    }
  };

  const handleBlur = (): void => {
    blurred = true;
    lastActivityAt = null;
    clearIdleTimer();
    emitPaused(true);
  };

  const handleFocus = (): void => {
    blurred = false;
    lastActivityAt = null;
    if (!hidden) armIdleHold();
  };

  window.addEventListener('blur', handleBlur);
  window.addEventListener('focus', handleFocus);
  window.addEventListener('pointerdown', handleActivity, PASSIVE_ACTIVITY_OPTIONS);
  window.addEventListener('keydown', handleActivity);
  window.addEventListener('wheel', handleActivity, PASSIVE_ACTIVITY_OPTIONS);
  window.addEventListener('touchstart', handleActivity, PASSIVE_ACTIVITY_OPTIONS);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('scroll', handleActivity, PASSIVE_CAPTURE_ACTIVITY_OPTIONS);

  if (hidden) emitPaused(true);
  else armIdleHold();

  return () => {
    if (disposed) return;
    disposed = true;
    clearIdleTimer();
    window.removeEventListener('blur', handleBlur);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('pointerdown', handleActivity, PASSIVE_ACTIVITY_OPTIONS);
    window.removeEventListener('keydown', handleActivity);
    window.removeEventListener('wheel', handleActivity, PASSIVE_ACTIVITY_OPTIONS);
    window.removeEventListener('touchstart', handleActivity, PASSIVE_ACTIVITY_OPTIONS);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('scroll', handleActivity, PASSIVE_CAPTURE_ACTIVITY_OPTIONS);
  };
}
