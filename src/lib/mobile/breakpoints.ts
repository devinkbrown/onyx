// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * breakpoints.ts — the one place the shell's mobile boundary is written down.
 *
 * WHY A CONSTANT AND NOT A CSS VARIABLE: a custom property cannot be used in a
 * media feature — `@media (max-width: var(--x))` is invalid per the Media
 * Queries spec, because media queries are evaluated before the cascade that
 * would resolve the variable. So the boundary is inherently written twice: once
 * in `shell.css` (`max-width: 900px` / `min-width: 901px`) and once here for
 * `matchMedia`. The pair is kept honest by `shell-grid.contract.test.ts`, which
 * asserts the CSS literals match these values — that guard is the substitute
 * for the single source CSS cannot give us.
 */

/** Widest viewport still treated as the phone/drawer layout, in px. */
export const MOBILE_MAX_WIDTH_PX = 900;

/** Narrowest viewport that gets the desktop grid with its side rails, in px. */
export const DESKTOP_MIN_WIDTH_PX = MOBILE_MAX_WIDTH_PX + 1;

/** `matchMedia` query for the phone/drawer layout. */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/** `matchMedia` query for the desktop grid. */
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`;

/** True when the current viewport is the phone/drawer layout. SSR-safe. */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}
