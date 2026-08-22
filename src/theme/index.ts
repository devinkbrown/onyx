// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Onyx Theme Engine — barrel export.
 *
 * Public surface:
 *   - ThemeProvider + useTheme + applyThemeToDom
 *   - ThemeStudio
 *   - Theme data (THEMES, THEME_IDS, DEFAULT_THEME_ID)
 *   - Studio tokens (STUDIO_GROUPS, ALL_STUDIO_TOKENS, EDITABLE_PROPERTIES)
 *   - Types (ThemeId, ThemeMeta, TokenMap, StudioToken, StudioGroup, StudioTokenType)
 */

export { ThemeProvider, useTheme, useThemeOptional, applyThemeToDom } from './ThemeProvider';
export type { ThemeProviderProps } from './ThemeProvider';

// ThemeStudio is intentionally NOT re-exported here. This barrel is eagerly
// imported by index.tsx (for ThemeProvider), and without `sideEffects: false`
// Rollup cannot tree-shake a re-exported module out of the entry chunk — so a
// re-export would drag the ~2k-line studio into the bundle shipped on every
// route. Consumers import it directly: `@/theme/ThemeStudio`.
export type { ThemeStudioProps } from './ThemeStudio';

export {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME_ID,
  PUBLIC_THEME_IDS,
  PUBLIC_THEME_LABELS,
  isPublicThemeId,
} from './themes';
export type { ThemeId, ThemeMeta, TokenMap, PublicThemeId } from './themes';

export {
  isCustomThemeId,
  loadCustomThemes,
  getCustomTheme,
  customThemeTokens,
} from './customThemes';
export type { CustomTheme } from './customThemes';

export {
  STUDIO_GROUPS,
  ALL_STUDIO_TOKENS,
  EDITABLE_PROPERTIES,
} from './tokens';
export type { StudioGroup, StudioToken, StudioTokenType } from './tokens';

export {
  generatePalette,
  adjustPalette,
  enforceAA,
  auditPalette,
  randomSeed,
  seedFromTokens,
  hexToOklch,
  oklchToHex,
  DEFAULT_SEED,
} from './paletteFactory';
export type { PaletteSeed, PaletteTransform, Oklch, AuditRow } from './paletteFactory';

export {
  exportThemeSeed,
  parseThemeSeed,
  paletteFromSeedExport,
  SEED_EXPORT_KIND,
  SEED_EXPORT_VERSION,
} from './seedTransfer';
export type { SeedExportEnvelope, SeedParseResult } from './seedTransfer';
