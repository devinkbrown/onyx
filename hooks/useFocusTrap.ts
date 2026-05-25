'use client';

import { useEffect } from 'react';

/**
 * Traps keyboard focus within a container element while active.
 * Focuses the first focusable element on activation and cycles
 * Tab / Shift+Tab within the container.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const el = containerRef.current;

    const focusable = el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    // Focus first element on open
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [active, containerRef]);
}
