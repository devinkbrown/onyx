// SPDX-License-Identifier: AGPL-3.0-or-later
import { preferences } from '@/lib/prefs/preferences';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * App-aware reduced-motion check for interaction animation gates.
 * In-app preference must suppress motion even when the OS query is unset.
 */
export function prefersReducedMotionForInteraction(): boolean {
  if (preferences().reduceMotion) return true;
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}
