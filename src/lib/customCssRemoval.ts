// SPDX-License-Identifier: AGPL-3.0-or-later

/** Retired local custom-CSS storage/style identifier. */
export const LEGACY_CUSTOM_CSS_KEY = 'onyx:custom-css';

/**
 * Remove the retired custom-CSS payload without ever parsing or applying it.
 *
 * Older builds exposed this value as unrestricted CSS, so even reading it into
 * live state would preserve a dormant resource-loading surface. Removal is the
 * migration: the feature and its persisted payload are intentionally deleted.
 */
export function purgeLegacyCustomCss(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_CUSTOM_CSS_KEY);
    }
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }

  try {
    if (typeof document !== 'undefined') {
      document.getElementById(LEGACY_CUSTOM_CSS_KEY)?.remove();
    }
  } catch {
    // A hostile or incomplete DOM shim must not block application startup.
  }
}

// The store imports this module before building its initial state, so a legacy
// payload is erased before any connected-app state can observe it.
purgeLegacyCustomCss();
