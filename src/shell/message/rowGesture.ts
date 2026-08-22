// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * rowGesture.ts — Telegram-style swipe-to-reply + Discord-style long-press.
 *
 * Pure pointer state machine. No Solid, no store. MessageView attaches one
 * instance per live row and maps the two callbacks onto existing APIs:
 *   onSwipeReply     → getState().setReplyingTo(msg)
 *   onLongPressMenu  → setMenuOpen(true) (same overflow as right-click)
 *
 * Touch only. Mouse keeps the hover toolbar + context-menu path.
 * Vertical scroll wins until a horizontal swipe is committed.
 */

export const ROW_GESTURE = {
  swipeCommitPx: 12,
  swipeCancelVerticalRatio: 1.2,
  swipeArmPx: 72,
  swipeMaxPx: 96,
  longPressMs: 450,
  longPressMotionCancelPx: 8,
} as const;

export type GesturePhase =
  | 'idle'
  | 'observing'
  | 'swiping'
  | 'armed'
  | 'long-pressing'
  | 'done';

export type RowGestureHandlers = {
  onSwipeReply: () => void;
  onLongPressMenu: () => void;
};

export type RowGestureOptions = {
  swipeCommitPx?: number;
  swipeCancelVerticalRatio?: number;
  swipeArmPx?: number;
  swipeMaxPx?: number;
  longPressMs?: number;
  longPressMotionCancelPx?: number;
  prefersReducedMotion?: () => boolean;
};

export type RowGestureController = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  getPhase: () => GesturePhase;
  dispose: () => void;
};

const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [contenteditable="true"]';

const SWIPING_CLASS = 'shell-msg--swiping';
const ARMED_CLASS = 'shell-msg--armed';
const GESTURING_CLASS = 'shell-msg--gesturing';
const SPRING_CLASS = 'shell-msg--spring-back';
const CLICK_LOCK_ATTR = 'data-row-gesture-lock';

export function shouldIgnoreRowGestureClick(event: Event): boolean {
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return false;
  return row.getAttribute(CLICK_LOCK_ATTR) === '1';
}

export function rowGesturePointerProps(gesture: RowGestureController): {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
} {
  return {
    onPointerDown: gesture.onPointerDown,
    onPointerMove: gesture.onPointerMove,
    onPointerUp: gesture.onPointerUp,
    onPointerCancel: gesture.onPointerCancel,
  };
}

function isPrimaryPointer(event: PointerEvent): boolean {
  return event.isPrimary !== false;
}

function isTouchPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch';
}

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed);
}

function isInteractiveTarget(event: PointerEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(INTERACTIVE_SELECTOR));
}

function readingDirection(el: HTMLElement): 'ltr' | 'rtl' {
  const marked = el.closest('[dir]')?.getAttribute('dir');
  const docDir = typeof document !== 'undefined' ? document.documentElement.dir : '';
  const dir = (marked ?? docDir ?? '').toLowerCase();
  return dir === 'rtl' ? 'rtl' : 'ltr';
}

function naturalDelta(dx: number, dir: 'ltr' | 'rtl'): number {
  return dir === 'rtl' ? -dx : dx;
}

function defaultPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function capturePointer(el: HTMLElement, pointerId: number): void {
  if (typeof el.setPointerCapture !== 'function') return;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Capture can fail if the pointer already released.
  }
}

function releasePointer(el: HTMLElement, pointerId: number): void {
  if (typeof el.releasePointerCapture !== 'function') return;
  try {
    if (typeof el.hasPointerCapture === 'function' && !el.hasPointerCapture(pointerId)) {
      return;
    }
    el.releasePointerCapture(pointerId);
  } catch {
    // Already released.
  }
}

function applySwipeVisual(
  el: HTMLElement,
  signedPx: number,
  progress: number,
  armed: boolean,
  reducedMotion: boolean,
): void {
  const visual = reducedMotion ? 0 : signedPx;
  el.style.setProperty('--row-swipe-x', `${visual}px`);
  el.style.setProperty('--row-swipe-progress', String(progress));
  el.classList.add(SWIPING_CLASS);
  el.classList.toggle(ARMED_CLASS, armed);
  el.classList.remove(SPRING_CLASS);
}

function clearSwipeVisual(el: HTMLElement, spring: boolean, reducedMotion: boolean): void {
  el.classList.remove(SWIPING_CLASS, ARMED_CLASS, GESTURING_CLASS);
  if (!spring || reducedMotion) {
    el.classList.remove(SPRING_CLASS);
    el.style.removeProperty('--row-swipe-x');
    el.style.removeProperty('--row-swipe-progress');
    return;
  }
  el.classList.add(SPRING_CLASS);
  el.style.setProperty('--row-swipe-x', '0px');
  el.style.setProperty('--row-swipe-progress', '0');
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    el.classList.remove(SPRING_CLASS);
    el.style.removeProperty('--row-swipe-x');
    el.style.removeProperty('--row-swipe-progress');
    el.removeEventListener('transitionend', finish);
  };
  el.addEventListener('transitionend', finish);
  window.setTimeout(finish, 280);
}

function suppressFollowingClick(el: HTMLElement): void {
  el.setAttribute(CLICK_LOCK_ATTR, '1');
  const block = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    el.removeEventListener('click', block, true);
    el.removeAttribute(CLICK_LOCK_ATTR);
  };
  el.addEventListener('click', block, true);
  window.setTimeout(() => {
    el.removeEventListener('click', block, true);
    el.removeAttribute(CLICK_LOCK_ATTR);
  }, 400);
}

export function createRowGesture(
  handlers: RowGestureHandlers,
  options: RowGestureOptions = {},
): RowGestureController {
  const swipeCommitPx = options.swipeCommitPx ?? ROW_GESTURE.swipeCommitPx;
  const swipeCancelVerticalRatio =
    options.swipeCancelVerticalRatio ?? ROW_GESTURE.swipeCancelVerticalRatio;
  const swipeArmPx = options.swipeArmPx ?? ROW_GESTURE.swipeArmPx;
  const swipeMaxPx = options.swipeMaxPx ?? ROW_GESTURE.swipeMaxPx;
  const longPressMs = options.longPressMs ?? ROW_GESTURE.longPressMs;
  const longPressMotionCancelPx =
    options.longPressMotionCancelPx ?? ROW_GESTURE.longPressMotionCancelPx;
  const prefersReducedMotion = options.prefersReducedMotion ?? defaultPrefersReducedMotion;

  let phase: GesturePhase = 'idle';
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let surface: HTMLElement | null = null;
  let direction: 'ltr' | 'rtl' = 'ltr';
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let contextGuard: ((event: Event) => void) | null = null;

  function clearLongPressTimer(): void {
    if (longPressTimer === null) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function removeContextGuard(): void {
    if (!contextGuard || !surface) return;
    surface.removeEventListener('contextmenu', contextGuard);
    contextGuard = null;
  }

  function installContextGuard(el: HTMLElement): void {
    removeContextGuard();
    const guard = (event: Event): void => {
      event.preventDefault();
      removeContextGuard();
    };
    contextGuard = guard;
    el.addEventListener('contextmenu', guard);
  }

  function reset(spring: boolean): void {
    clearLongPressTimer();
    removeContextGuard();
    const el = surface;
    const id = pointerId;
    const reduced = prefersReducedMotion();
    phase = 'idle';
    pointerId = null;
    surface = null;
    if (el && id !== null) releasePointer(el, id);
    if (el) clearSwipeVisual(el, spring, reduced);
  }

  function startLongPress(el: HTMLElement): void {
    clearLongPressTimer();
    installContextGuard(el);
    phase = 'long-pressing';
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (phase !== 'long-pressing' || !surface) return;
      phase = 'done';
      suppressFollowingClick(surface);
      surface.classList.remove(GESTURING_CLASS);
      handlers.onLongPressMenu();
    }, longPressMs);
  }

  function onPointerDown(event: PointerEvent): void {
    if (phase !== 'idle') return;
    if (!isPrimaryPointer(event)) return;
    if (!isTouchPointer(event)) return;
    if (event.button !== 0) return;
    if (isInteractiveTarget(event)) return;
    if (hasActiveTextSelection()) return;
    const el = event.currentTarget;
    if (!(el instanceof HTMLElement)) return;

    phase = 'observing';
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    surface = el;
    direction = readingDirection(el);
    el.classList.add(GESTURING_CLASS);
    startLongPress(el);
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    if (phase === 'idle' || phase === 'done') return;
    if (!isPrimaryPointer(event)) return;
    const el = surface;
    if (!el) return;

    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const natural = naturalDelta(dx, direction);

    if (phase === 'observing' || phase === 'long-pressing') {
      if (absDx > longPressMotionCancelPx || absDy > longPressMotionCancelPx) {
        clearLongPressTimer();
        removeContextGuard();
      }

      if (absDy > swipeCommitPx && absDy > absDx * swipeCancelVerticalRatio) {
        reset(false);
        return;
      }

      if (natural > swipeCommitPx && absDy <= absDx * swipeCancelVerticalRatio) {
        phase = 'swiping';
        capturePointer(el, event.pointerId);
      } else {
        return;
      }
    }

    if (phase !== 'swiping' && phase !== 'armed') return;

    if (natural <= 0) {
      applySwipeVisual(el, 0, 0, false, prefersReducedMotion());
      phase = 'swiping';
      return;
    }

    const clamped = Math.min(natural, swipeMaxPx);
    const progress = Math.min(1, clamped / swipeArmPx);
    const signed = direction === 'rtl' ? -clamped : clamped;
    const armed = clamped >= swipeArmPx;
    applySwipeVisual(el, signed, progress, armed, prefersReducedMotion());
    phase = armed ? 'armed' : 'swiping';
    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    const el = surface;
    const shouldReply = phase === 'armed';
    const spring = phase === 'swiping' || phase === 'armed';
    if (shouldReply && el) suppressFollowingClick(el);
    reset(spring);
    if (shouldReply) handlers.onSwipeReply();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    reset(phase === 'swiping' || phase === 'armed');
  }

  function dispose(): void {
    reset(false);
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    getPhase: () => phase,
    dispose,
  };
}
