'use client';

import { useEffect, type RefObject } from 'react';

export interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum horizontal distance in px to trigger a swipe (default 50) */
  threshold?: number;
}

/**
 * Attaches touchstart/touchmove/touchend listeners to the given element ref.
 * Fires onSwipeLeft / onSwipeRight when a predominantly horizontal swipe
 * exceeds `threshold` px and vertical movement stays under 100 px.
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  opts: SwipeOptions,
): void {
  const { onSwipeLeft, onSwipeRight, threshold = 50 } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      // Only fire if horizontal movement dominates and vertical is small
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dy) > 100) return;

      if (dx > 0) {
        onSwipeRight?.();
      } else {
        onSwipeLeft?.();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [ref, onSwipeLeft, onSwipeRight, threshold]);
}
