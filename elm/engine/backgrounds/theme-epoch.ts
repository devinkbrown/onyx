// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared "theme generation" counter for the background engine.
 *
 * Reading the live theme tokens off `documentElement` (getComputedStyle + one
 * `getPropertyValue` per token) is comparatively expensive, yet the tokens only
 * change when the user switches theme — never between animation frames. Rather
 * than re-read them ~60 times a second in every animated variant, readers cache
 * the parsed theme keyed by this epoch and the engine bumps it (via its theme
 * `MutationObserver`) whenever a theme switch actually mutates the tokens.
 */
let epoch = 0;

/** Current theme generation. Cached theme reads compare against this. */
export function themeEpoch(): number {
  return epoch;
}

/** Invalidate every cached theme read; the next read recomputes from the DOM. */
export function bumpThemeEpoch(): void {
  epoch += 1;
}

/**
 * Memoize `compute` against an epoch source: while `getEpoch()` is unchanged the
 * cached value is returned without re-running `compute`; the first call after the
 * epoch advances recomputes and re-caches. Pure and DOM-free, so the caching
 * contract is unit-testable in isolation.
 */
export function createEpochMemo<T>(compute: () => T, getEpoch: () => number): () => T {
  let has = false;
  let cached: T;
  let cachedEpoch = -1;

  return () => {
    const current = getEpoch();
    if (has && cachedEpoch === current) return cached;
    cached = compute();
    cachedEpoch = current;
    has = true;
    return cached;
  };
}
