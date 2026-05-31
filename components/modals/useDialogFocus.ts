'use client';

import { useEffect, useRef } from 'react';

/**
 * Shared focus-management hook for modal dialogs.
 *
 * On mount it:
 *   1. Captures the element that held focus before the dialog opened.
 *   2. Moves focus to `containerRef` (or its first focusable descendant if
 *      the container itself is not focusable).
 *
 * On unmount it restores focus to the previously captured element so that
 * keyboard / screen-reader position is not lost after the dialog closes.
 *
 * Usage:
 *   const dialogRef = useRef<HTMLDivElement>(null);
 *   useDialogFocus(dialogRef);
 */
export function useDialogFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  options: {
    /** When true, focus the container element itself (useful for read-only panels
     *  where there is no interactive first child, e.g. tabIndex={-1} wrappers). */
    focusSelf?: boolean;
  } = {},
) {
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    // Capture current focus so we can restore it on close.
    previousFocusRef.current = document.activeElement;

    const el = containerRef.current;
    if (!el) return;

    if (options.focusSelf) {
      (el as HTMLElement).focus();
    } else {
      const focusable = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      if (first) {
        first.focus();
      } else {
        // No focusable child — fall back to focusing the container itself.
        (el as HTMLElement).focus();
      }
    }

    return () => {
      const prev = previousFocusRef.current;
      if (prev && (prev as HTMLElement).focus) {
        (prev as HTMLElement).focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
