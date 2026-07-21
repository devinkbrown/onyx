// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_THEME_ID, THEMES, type ThemeId } from './themes';
import { getCustomTheme, isCustomThemeId } from './customThemes';

export const THEME_STORAGE_KEY = 'onyx:theme';

/** English-only theme id remaps for retired English aliases (no Japanese brands). */
const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  lacquer: 'shu',
  midnight: 'ocean',
  amoled: 'abyss',
  light: 'pearl',
  ash: 'slate',
  bathyal: 'abyss',
  coral: 'shu',
  kelp: 'hisui',
  brine: 'teal',
  arctic: 'frost',
  system: DEFAULT_THEME_ID,
};

export function normalizeThemeId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const mapped = LEGACY_THEME_MAP[raw] ?? raw;
  if (mapped in THEMES) return mapped;
  if (isCustomThemeId(mapped) && getCustomTheme(mapped)) return mapped;
  return null;
}

export function readThemeId(): string {
  try {
    return normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function persistThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Ignore write failures.
  }
}
