// SPDX-License-Identifier: AGPL-3.0-or-later
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
const MAX_CUSTOM_THEME_STORAGE_BYTES = 256 * 1024;
const MAX_CUSTOM_THEMES = 32;
const MAX_CUSTOM_THEME_CANDIDATES = 128;
const MAX_CUSTOM_THEME_ID_LENGTH = 128;
const MAX_CUSTOM_THEME_NAME_LENGTH = 80;
const MAX_CUSTOM_THEME_TOKEN_ENTRIES = 64;
const MAX_CUSTOM_THEME_TOKEN_KEY_LENGTH = 80;
const MAX_CUSTOM_THEME_TOKEN_VALUE_LENGTH = 512;
const CUSTOM_THEME_ID_RE = /^custom:[a-z0-9](?:[a-z0-9-]{0,119})$/;
const CUSTOM_PROPERTY_RE = /^--[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** True when `id` names a custom (user-created) theme rather than a built-in. */
export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function loadCustomThemes(): CustomTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy = current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const serialized = current ?? legacy;
    if (!serialized || serialized.length > MAX_CUSTOM_THEME_STORAGE_BYTES) return [];
    const raw: unknown = JSON.parse(serialized);
    if (!Array.isArray(raw)) return [];
    const themes: CustomTheme[] = [];
    const seen = new Set<string>();
    for (const candidate of raw.slice(0, MAX_CUSTOM_THEME_CANDIDATES)) {
      if (themes.length >= MAX_CUSTOM_THEMES) break;
      const theme = parseCustomTheme(migrateCustomThemeBase(candidate));
      if (!theme || seen.has(theme.id)) continue;
      seen.add(theme.id);
      themes.push(theme);
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (current === null && legacy !== null) persist(themes);
    return themes;
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

function parseCustomTheme(value: unknown): CustomTheme | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string'
    || v.id.length > MAX_CUSTOM_THEME_ID_LENGTH
    || !CUSTOM_THEME_ID_RE.test(v.id)
    || typeof v.name !== 'string'
    || v.name.length === 0
    || v.name.length > MAX_CUSTOM_THEME_NAME_LENGTH
    || v.name !== v.name.trim()
    || CONTROL_CHARACTERS.test(v.name)
    || typeof v.base !== 'string'
    || !Object.hasOwn(THEMES, v.base)
  ) return null;
  const overrides = parseTokenMap(v.overrides);
  if (!overrides) return null;
  return { id: v.id, name: v.name, base: v.base as ThemeId, overrides };
}

/**
 * A token map must be a plain (non-array) object whose every value is a string,
 * so overrides seat cleanly via `setProperty`. Arrays would produce numeric-key
 * props and non-string values (nested objects, numbers, NaN) would coerce to
 * garbage like `"[object Object]"`, silently corrupting `var(--token)` and
 * breaking the palette's contrast guarantee. Mirrors the `?theme=` import guard.
 */
function parseTokenMap(value: unknown): TokenMap | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_THEME_TOKEN_ENTRIES) return null;
  const tokens: TokenMap = {};
  for (const [key, token] of entries) {
    if (
      key.length > MAX_CUSTOM_THEME_TOKEN_KEY_LENGTH
      || !CUSTOM_PROPERTY_RE.test(key)
      || typeof token !== 'string'
      || token.length === 0
      || token.length > MAX_CUSTOM_THEME_TOKEN_VALUE_LENGTH
      || CONTROL_CHARACTERS.test(token)
    ) return null;
    tokens[key] = token;
  }
  return tokens;
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
  const safeName = typeof name === 'string'
    ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CUSTOM_THEME_NAME_LENGTH) || 'Custom'
    : 'Custom';
  const safeBase = Object.hasOwn(THEMES, base) ? base : 'onyx';
  const safeOverrides = parseTokenMap(overrides) ?? {};
  const slug = slugify(safeName);
  let id = `${CUSTOM_PREFIX}${slug}`;
  let n = 2;
  while (list.some((t) => t.id === id)) {
    id = `${CUSTOM_PREFIX}${slug}-${n}`;
    n += 1;
  }
  const theme: CustomTheme = { id, name: safeName, base: safeBase, overrides: safeOverrides };
  persist([...list.slice(-(MAX_CUSTOM_THEMES - 1)), theme]);
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
