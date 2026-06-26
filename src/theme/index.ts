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

export { ThemeProvider, useTheme, applyThemeToDom } from './ThemeProvider';
export type { ThemeProviderProps } from './ThemeProvider';

export { ThemeStudio } from './ThemeStudio';
export type { ThemeStudioProps } from './ThemeStudio';

export {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME_ID,
} from './themes';
export type { ThemeId, ThemeMeta, TokenMap } from './themes';

export {
  STUDIO_GROUPS,
  ALL_STUDIO_TOKENS,
  EDITABLE_PROPERTIES,
} from './tokens';
export type { StudioGroup, StudioToken, StudioTokenType } from './tokens';
