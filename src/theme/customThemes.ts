/**
 * customThemes.ts — user-created themes built in the Theme Studio.
 *
 * A custom theme is a base built-in theme plus a set of token overrides, given
 * a name so it can be selected like any built-in. They persist in localStorage
 * and are merged into the theme pickers (Appearance panel, /appearance route,
 * Theme Studio). Effective tokens = base theme tokens overlaid with overrides.
 */

import { THEMES, type ThemeId, type TokenMap } from './themes';

export type CustomTheme = {
  /** Stable id, always prefixed `custom:` so it never collides with a built-in. */
  id: string;
  /** User-facing name. */
  name: string;
  /** Built-in theme the overrides are layered on top of. */
  base: ThemeId;
  /** CSS-custom-property overrides on top of the base. */
  overrides: TokenMap;
};

const STORAGE_KEY = 'onyx:custom-themes';
/** Legacy key from the previous brand name; read-only for one-time migration. */
const LEGACY_STORAGE_KEY = 'ruri:custom-themes';
const CUSTOM_PREFIX = 'custom:';
/** Legacy built-in theme id that was renamed; migrate custom-theme `base` refs. */
const LEGACY_BASE_ID = 'ruri';
const MIGRATED_BASE_ID = 'onyx';

/** True when `id` names a custom (user-created) theme rather than a built-in. */
export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function loadCustomThemes(): CustomTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    // Current key first, then fall back to the legacy key (read-old-write-new)
    // so themes saved under the previous brand survive the rebrand.
    const serialized = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const raw = JSON.parse(serialized ?? '[]');
    if (!Array.isArray(raw)) return [];
    // Migrate any custom theme whose base was the renamed legacy theme id, then
    // validate (validation requires base to be a current THEMES key).
    return raw.map(migrateCustomThemeBase).filter(isValidCustomTheme);
  } catch {
    return [];
  }
}

/** Rewrite a legacy `base: 'ruri'` reference to the current theme id. */
function migrateCustomThemeBase(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const v = value as Record<string, unknown>;
  if (v.base === LEGACY_BASE_ID) {
    return { ...v, base: MIGRATED_BASE_ID };
  }
  return value;
}

function persist(list: CustomTheme[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — keep going with the in-memory list
  }
}

function isValidCustomTheme(value: unknown): value is CustomTheme {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    isCustomThemeId(v.id) &&
    typeof v.name === 'string' &&
    typeof v.base === 'string' &&
    (v.base as string) in THEMES &&
    typeof v.overrides === 'object' &&
    v.overrides !== null
  );
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
}

/**
 * Create and persist a new custom theme, returning it. The id is derived from
 * the name but kept unique against the existing set.
 */
export function addCustomTheme(name: string, base: ThemeId, overrides: TokenMap): CustomTheme {
  const list = loadCustomThemes();
  const slug = slugify(name);
  let id = `${CUSTOM_PREFIX}${slug}`;
  let n = 2;
  while (list.some((t) => t.id === id)) {
    id = `${CUSTOM_PREFIX}${slug}-${n}`;
    n += 1;
  }
  const theme: CustomTheme = { id, name: name.trim() || 'Custom', base, overrides: { ...overrides } };
  persist([...list, theme]);
  return theme;
}

export function removeCustomTheme(id: string): void {
  persist(loadCustomThemes().filter((t) => t.id !== id));
}

export function getCustomTheme(id: string): CustomTheme | undefined {
  return loadCustomThemes().find((t) => t.id === id);
}

/** Effective token set for a custom theme: base tokens overlaid with overrides. */
export function customThemeTokens(theme: CustomTheme): TokenMap {
  return { ...(THEMES[theme.base]?.tokens ?? {}), ...theme.overrides };
}

/** Light/dark scheme inherited from the custom theme's base. */
export function customThemeScheme(theme: CustomTheme): 'light' | 'dark' {
  return THEMES[theme.base]?.scheme ?? 'dark';
}
