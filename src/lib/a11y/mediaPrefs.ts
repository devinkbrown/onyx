// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * mediaPrefs.ts - reactive OS accessibility media preference accessors.
 */

import { createSignal, getOwner, onCleanup, type Accessor } from 'solid-js';

const PREFERS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const PREFERS_MORE_CONTRAST_QUERY = '(prefers-contrast: more)';
const PREFERS_REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';
const FORCED_COLORS_QUERY = '(forced-colors: active)';

const STATIC_FALSE: Accessor<boolean> = () => false;

type MediaSignalEvent = Pick<MediaQueryListEvent, 'matches'>;
type MediaSignalHandler = (event: MediaSignalEvent) => void;

function readMatches(queryList: MediaQueryList): boolean {
  try {
    return queryList.matches;
  } catch {
    return false;
  }
}

function registerCleanup(cleanup: () => void): void {
  if (!getOwner()) return;
  onCleanup(cleanup);
}

function subscribeToQueryList(queryList: MediaQueryList, handler: MediaSignalHandler): void {
  try {
    if (typeof queryList.addEventListener === 'function') {
      queryList.addEventListener('change', handler);
      registerCleanup(() => queryList.removeEventListener('change', handler));
      return;
    }

    if (typeof queryList.addListener === 'function') {
      queryList.addListener(handler);
      if (typeof queryList.removeListener === 'function') {
        registerCleanup(() => queryList.removeListener(handler));
      }
    }
  } catch {
    /* media preference listeners are advisory; the initial value is still useful */
  }
}

export function makeMediaSignal(query: string): Accessor<boolean> {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return STATIC_FALSE;

  let queryList: MediaQueryList;

  try {
    queryList = window.matchMedia(query);
  } catch {
    return STATIC_FALSE;
  }

  const [matches, setMatches] = createSignal(readMatches(queryList));
  const syncMatches: MediaSignalHandler = (event) => {
    setMatches(event.matches);
  };

  subscribeToQueryList(queryList, syncMatches);

  return matches;
}

export const prefersReducedMotion: Accessor<boolean> = makeMediaSignal(PREFERS_REDUCED_MOTION_QUERY);
export const prefersMoreContrast: Accessor<boolean> = makeMediaSignal(PREFERS_MORE_CONTRAST_QUERY);
export const prefersReducedTransparency: Accessor<boolean> = makeMediaSignal(PREFERS_REDUCED_TRANSPARENCY_QUERY);
export const forcedColors: Accessor<boolean> = makeMediaSignal(FORCED_COLORS_QUERY);
