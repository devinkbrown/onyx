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
const CUSTOM_PREFIX = 'custom:';
const MAX_CUSTOM_THEME_STORAGE_BYTES = 256 * 1024;
const MAX_CUSTOM_THEMES = 32;
const MAX_CUSTOM_THEME_CANDIDATES = 128;
const MAX_CUSTOM_THEME_ID_LENGTH = 128;
const MAX_CUSTOM_THEME_NAME_LENGTH = 80;
const MAX_CUSTOM_THEME_TOKEN_ENTRIES = 64;
const MAX_CUSTOM_THEME_TOKEN_KEY_LENGTH = 80;
const MAX_CUSTOM_THEME_TOKEN_VALUE_LENGTH = 512;
const CUSTOM_THEME_ID_RE = /^custom:[a-z0-9](?:[a-z0-9-]{0,119})$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const FORBIDDEN_TOKEN_SYNTAX = /[;{}@\\]|\/\*|\*\/|(?:url|src|image(?:-set)?|cross-fade|element)\s*\(/i;
const CSS_NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';

const COLOR_TOKEN_KEYS: ReadonlySet<string> = new Set([
  '--ink',
  '--ink-2',
  '--stone',
  '--stone-2',
  '--stone-3',
  '--stone-line',
  '--lapis',
  '--lapis-bright',
  '--lapis-deep',
  '--gold',
  '--gold-bright',
  '--gold-deep',
  '--shu',
  '--shu-bright',
  '--paper',
  '--paper-dim',
  '--paper-mute',
  '--ok',
  '--warn',
  '--danger',
  '--seam',
  '--seam-faint',
  '--line',
  '--line-faint',
]);

const RADIUS_TOKEN_MAX: Readonly<Record<string, number>> = {
  '--r-0': 12,
  '--r-sm': 12,
  '--r-md': 16,
  '--r-pill': 9_999,
};

const FONT_TOKEN_KEYS: ReadonlySet<string> = new Set([
  '--font-mono',
  '--font-display',
  '--font-sans',
  '--font-serif',
]);

const SAFE_NAMED_COLORS: ReadonlySet<string> = new Set([
  'black',
  'transparent',
  'white',
]);

const HEX_COLOR_RE = /^#[0-9a-f]{3,4}(?:[0-9a-f]{3,4})?$/i;
const OKLCH_RE = new RegExp(
  `^oklch\\(\\s*(${CSS_NUMBER})(%)?\\s+(${CSS_NUMBER})\\s+(${CSS_NUMBER})(?:deg)?(?:\\s*\\/\\s*(${CSS_NUMBER})(%)?)?\\s*\\)$`,
  'i',
);
const FONT_NAME = '(?:"[A-Za-z0-9 ._-]{1,80}"|\'[A-Za-z0-9 ._-]{1,80}\'|[A-Za-z-][A-Za-z0-9 _-]{0,79})';
const FONT_STACK_RE = new RegExp(`^${FONT_NAME}(?:\\s*,\\s*${FONT_NAME}){0,15}$`);
const CUBIC_BEZIER_RE = new RegExp(
  `^cubic-bezier\\(\\s*(${CSS_NUMBER})\\s*,\\s*(${CSS_NUMBER})\\s*,\\s*(${CSS_NUMBER})\\s*,\\s*(${CSS_NUMBER})\\s*\\)$`,
  'i',
);
const STEPS_RE = /^(?:steps\(\s*([1-9]\d{0,2})(?:\s*,\s*(?:start|end|jump-start|jump-end|jump-none|jump-both))?\s*\)|step-start|step-end)$/i;
const EASING_KEYWORDS: ReadonlySet<string> = new Set([
  'ease',
  'ease-in',
  'ease-in-out',
  'ease-out',
  'linear',
]);

function boundedNumber(raw: string, min: number, max: number): boolean {
  if (!new RegExp(`^${CSS_NUMBER}$`).test(raw)) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

function safeOklch(value: string): boolean {
  const match = OKLCH_RE.exec(value);
  if (!match) return false;
  const lightness = Number(match[1]);
  const lightnessMax = match[2] ? 100 : 1;
  const chroma = Number(match[3]);
  const hue = Number(match[4]);
  const alpha = match[5] === undefined ? 1 : Number(match[5]);
  const alphaMax = match[6] ? 100 : 1;
  return Number.isFinite(lightness)
    && lightness >= 0
    && lightness <= lightnessMax
    && Number.isFinite(chroma)
    && chroma >= 0
    && chroma <= 0.5
    && Number.isFinite(hue)
    && Math.abs(hue) <= 3_600
    && Number.isFinite(alpha)
    && alpha >= 0
    && alpha <= alphaMax;
}

function safeColorAtom(value: string): boolean {
  const trimmed = value.trim();
  if (HEX_COLOR_RE.test(trimmed) || safeOklch(trimmed)) return true;
  if (SAFE_NAMED_COLORS.has(trimmed.toLowerCase())) return true;
  const variable = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/i.exec(trimmed);
  return variable?.[1] !== undefined && COLOR_TOKEN_KEYS.has(variable[1]);
}

function safeColorMixPart(value: string): boolean {
  const trimmed = value.trim();
  if (safeColorAtom(trimmed)) return true;
  const weighted = /^(.*\S)\s+(\d+(?:\.\d+)?)%$/.exec(trimmed);
  return weighted?.[1] !== undefined
    && weighted[2] !== undefined
    && safeColorAtom(weighted[1])
    && boundedNumber(weighted[2], 0, 100);
}

function safeColorValue(value: string): boolean {
  if (safeColorAtom(value)) return true;
  const mix = /^color-mix\(\s*in\s+oklab\s*,\s*([^,]+)\s*,\s*([^,]+)\s*\)$/i.exec(value);
  return mix?.[1] !== undefined
    && mix[2] !== undefined
    && safeColorMixPart(mix[1])
    && safeColorMixPart(mix[2]);
}

function safeRadiusValue(property: string, value: string): boolean {
  const max = RADIUS_TOKEN_MAX[property];
  if (max === undefined) return false;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
  return match?.[1] !== undefined && boundedNumber(match[1], 0, max);
}

function safeDurationValue(value: string): boolean {
  const match = /^(\d+(?:\.\d+)?)ms$/.exec(value);
  return match?.[1] !== undefined && boundedNumber(match[1], 0, 5_000);
}

function safeEasingValue(value: string): boolean {
  const normalized = value.toLowerCase();
  if (EASING_KEYWORDS.has(normalized) || STEPS_RE.test(value)) return true;
  const match = CUBIC_BEZIER_RE.exec(value);
  if (!match) return false;
  const values = match.slice(1).map(Number);
  const x1 = values[0];
  const x2 = values[2];
  return values.every(Number.isFinite)
    && x1 !== undefined
    && x2 !== undefined
    && x1 >= 0
    && x1 <= 1
    && x2 >= 0
    && x2 <= 1;
}

/** Accept only the value grammar consumed by Onyx's finite theme-token registry. */
export function isSafeCustomThemeToken(property: string, value: string): boolean {
  if (
    property.length === 0
    || property.length > MAX_CUSTOM_THEME_TOKEN_KEY_LENGTH
    || value.length === 0
    || value.length > MAX_CUSTOM_THEME_TOKEN_VALUE_LENGTH
    || value !== value.trim()
    || CONTROL_CHARACTERS.test(value)
    || FORBIDDEN_TOKEN_SYNTAX.test(value)
  ) return false;
  if (COLOR_TOKEN_KEYS.has(property)) return safeColorValue(value);
  if (Object.hasOwn(RADIUS_TOKEN_MAX, property)) return safeRadiusValue(property, value);
  if (property === '--dur') return safeDurationValue(value);
  if (property === '--ease') return safeEasingValue(value);
  if (FONT_TOKEN_KEYS.has(property)) return FONT_STACK_RE.test(value);
  return false;
}

/** True when `id` names a custom (user-created) theme rather than a built-in. */
export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function loadCustomThemes(): CustomTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized || serialized.length > MAX_CUSTOM_THEME_STORAGE_BYTES) return [];
    const raw: unknown = JSON.parse(serialized);
    if (!Array.isArray(raw)) return [];
    const themes: CustomTheme[] = [];
    const seen = new Set<string>();
    for (const candidate of raw.slice(0, MAX_CUSTOM_THEME_CANDIDATES)) {
      if (themes.length >= MAX_CUSTOM_THEMES) break;
      const theme = parseCustomThemeValue(candidate);
      if (!theme || seen.has(theme.id)) continue;
      seen.add(theme.id);
      themes.push(theme);
    }
    return themes;
  } catch {
    return [];
  }
}

function persist(list: CustomTheme[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — keep going with the in-memory list
  }
}

export function parseCustomThemeValue(value: unknown): CustomTheme | null {
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
  const overrides = parseCustomThemeTokenMap(v.overrides);
  if (!overrides) return null;
  return { id: v.id, name: v.name, base: v.base as ThemeId, overrides };
}

/**
 * A token map must be a plain object using the finite palette registry and each
 * token's narrow value grammar. This is the common boundary for storage, JSON
 * imports, and boot-time `?theme=` links, before any value reaches setProperty.
 */
export function parseCustomThemeTokenMap(value: unknown): TokenMap | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_THEME_TOKEN_ENTRIES) return null;
  const tokens: TokenMap = {};
  for (const [key, token] of entries) {
    if (typeof token !== 'string' || !isSafeCustomThemeToken(key, token)) return null;
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
  const safeOverrides = parseCustomThemeTokenMap(overrides) ?? {};
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
