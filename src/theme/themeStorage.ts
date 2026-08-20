// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_THEME_ID, THEMES, type ThemeId } from './themes';
import { getCustomTheme, isCustomThemeId } from './customThemes';

export const THEME_STORAGE_KEY = 'onyx:theme';
/** Same-tab bridge used by store/command entry points that cannot reach context. */
export const THEME_CHANGE_EVENT = 'onyx:theme-change';

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
  if (Object.hasOwn(THEMES, mapped)) return mapped;
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
  const valid = normalizeThemeId(id) ?? DEFAULT_THEME_ID;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, valid);
  } catch {
    // Ignore write failures.
  }
  // `storage` only fires in *other* browsing contexts. Notify this document as
  // well so store/command entry points and ThemeProvider cannot drift.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { id: valid } }));
  }
}
