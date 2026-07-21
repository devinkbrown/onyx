// SPDX-License-Identifier: AGPL-3.0-or-later
// Theme ⇄ background composition.
//
// The animated background used to be a standalone preference that defaulted to
// a gold "gold seam" scene, so every theme read as gold regardless of its
// palette. The `'auto'` mode (now the default) follows the ACTIVE theme: each
// theme declares a `signatureBg` in src/theme/themes.ts and the shell resolves
// it here. Users can still pin a specific background from the appearance panel.

import { THEMES, DEFAULT_THEME_ID, type ThemeId } from '@/theme/themes';
import { getCustomTheme, isCustomThemeId } from '@/theme/customThemes';

/** Sentinel background id meaning "follow the active theme's signature". */
export const AUTO_BACKGROUND_ID = 'auto';

/** Fallback when a theme somehow declares no signature background. */
const FALLBACK_BACKGROUND_ID = 'deep-current';

/**
 * Resolve the concrete background variant id to render, given the stored
 * preference and the active theme. `'auto'` (or an empty/unknown value) maps to
 * the theme's `signatureBg`; a pinned id passes through unchanged.
 */
export function resolveBackgroundId(preference: string | null | undefined, themeId: string): string {
  if (preference && preference !== AUTO_BACKGROUND_ID) return preference;

  // Custom themes inherit their base theme's signature background.
  const baseId: string = isCustomThemeId(themeId)
    ? (getCustomTheme(themeId)?.base ?? DEFAULT_THEME_ID)
    : themeId;

  return THEMES[baseId as ThemeId]?.signatureBg ?? FALLBACK_BACKGROUND_ID;
}
