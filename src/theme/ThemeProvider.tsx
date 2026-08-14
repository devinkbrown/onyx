// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ThemeProvider — Solid context that manages the active theme.
 *
 * Responsibilities:
 *   - Applies a theme by writing CSS custom-property overrides onto
 *     `document.documentElement` and toggling `data-theme` / `color-scheme`.
 *   - Persists the user's choice through the shared theme storage helper.
 *   - Exposes `useTheme()` + `setTheme()` to all descendants.
 *
 * Account-sync hook (future wave):
 *   When server-side account preferences are ready, call `setTheme()` with the
 *   account value after the IRC ACCOUNTINFO response is parsed. The provider
 *   accepts an external `value` prop for controlled usage.
 */

import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type ParentProps,
} from 'solid-js';
import { DEFAULT_THEME_ID, THEMES, type ThemeId, type TokenMap } from './themes';
import {
  addCustomTheme,
  CUSTOM_THEME_STORAGE_KEY,
  customThemeScheme,
  customThemeTokens,
  getCustomTheme,
  isCustomThemeId,
  loadCustomThemes,
  removeCustomTheme,
  type CustomTheme,
} from './customThemes';
import { parseThemeParam } from '@/lib/theme/themeShare';
import {
  normalizeThemeId,
  persistThemeId,
  readThemeId,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from './themeStorage';
import { highContrastOverrides } from './highContrastTheme';
import { prefersMoreContrast } from '@/lib/a11y/mediaPrefs';
import { preferences } from '@/lib/prefs/preferences';
import { semanticThemeTokens } from './semanticTokens';

type ThemeContextValue = {
  /** The currently active theme ID (a built-in ThemeId or a `custom:` id). */
  themeId: () => string;
  /** Switch to a different theme (built-in or custom). */
  setTheme: (id: string) => void;
  /** Reactive list of the user's saved custom themes. */
  customThemes: () => CustomTheme[];
  /** Persist the current base + overrides as a named custom theme; returns its id. */
  saveCustom: (name: string, base: ThemeId, overrides: TokenMap) => string;
  /** Delete a custom theme; falls back to its base if it was active. */
  deleteCustom: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue>();

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be called inside <ThemeProvider>.');
  }
  return ctx;
}

/**
 * Non-throwing variant for always-mounted UI (e.g. the in-shell Appearance
 * panel) that may render in environments without a ThemeProvider — tests,
 * Storybook, isolated component mounts. Returns the real context when present,
 * otherwise a functional standalone theme controller backed by localStorage.
 */
let _fallbackTheme: ThemeContextValue | undefined;
function fallbackThemeController(): ThemeContextValue {
  if (_fallbackTheme) return _fallbackTheme;
  _fallbackTheme = createRoot(() => {
    const [id, setId] = createSignal<string>(readThemeId());
    const [custom, setCustom] = createSignal<CustomTheme[]>(loadCustomThemes());
    const setTheme = (next: string): void => {
      const valid = normalizeThemeId(next) ?? DEFAULT_THEME_ID;
      setId(valid);
      persistThemeId(valid);
      if (typeof document !== 'undefined') applyThemeToDom(valid);
    };
    const saveCustom = (name: string, base: ThemeId, overrides: TokenMap): string => {
      const created = addCustomTheme(name, base, overrides);
      setCustom(loadCustomThemes());
      return created.id;
    };
    const deleteCustom = (delId: string): void => {
      const fallback = getCustomTheme(delId)?.base ?? DEFAULT_THEME_ID;
      removeCustomTheme(delId);
      setCustom(loadCustomThemes());
      if (id() === delId) setTheme(fallback);
    };
    return { themeId: id, setTheme, customThemes: custom, saveCustom, deleteCustom };
  });
  return _fallbackTheme;
}

export function useThemeOptional(): ThemeContextValue {
  return useContext(ThemeContext) ?? fallbackThemeController();
}

/** URL query key carrying a shared custom theme (see lib/theme/themeShare.ts). */
const SHARE_PARAM = 'theme';

/**
 * Remove the `?theme=` param from the address bar after a one-time import so a
 * page refresh does not re-import the same theme. Best-effort and guarded — a
 * missing `history.replaceState` (older/non-browser env) is simply a no-op.
 */
function stripShareParam(params: URLSearchParams): void {
  if (typeof history === 'undefined' || typeof history.replaceState !== 'function') return;
  try {
    params.delete(SHARE_PARAM);
    const query = params.toString();
    const next = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    history.replaceState(history.state, '', next);
  } catch {
    // Address-bar rewrite is a nicety, never fatal.
  }
}

/**
 * CSS custom properties written to `documentElement` by the last successful
 * `applyThemeToDom` call. Kept at module scope (there is one documentElement)
 * so a subsequent theme switch can CLEAR overrides the incoming theme does not
 * define. Themes carry different key sets — e.g. `ocean` sets the `--font-*`
 * stack while `pearl` omits it — and an uncleared inline var bleeds through,
 * silently beating the stylesheet default. Custom overrides bleed the same way.
 */
let appliedTokenProps: readonly string[] = [];

/**
 * Commit `tokens` onto `root`, first removing any previously-applied property
 * the new map omits, then writing the new values. Returns nothing; updates the
 * module-level record of applied properties.
 */
function commitTokens(root: HTMLElement, tokens: TokenMap): void {
  for (const prop of appliedTokenProps) {
    if (!(prop in tokens)) root.style.removeProperty(prop);
  }
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value);
  }
  appliedTokenProps = Object.keys(tokens);
}

type ResolvedTheme = {
  /** The theme's base token map (built-in tokens, or custom base + overrides). */
  tokens: TokenMap;
  /** Value written to `data-theme` (a built-in id — custom themes use their base). */
  dataTheme: string;
  /** Colour scheme written to the `color-scheme` property. */
  scheme: 'light' | 'dark';
};

/**
 * Resolve the base token map + metadata for a theme id, or null when the id is
 * unknown / a missing custom theme. Custom themes resolve to their base tokens
 * overlaid with the saved overrides, inheriting the base's colour scheme.
 */
function resolveTheme(id: string): ResolvedTheme | null {
  if (isCustomThemeId(id)) {
    const custom = getCustomTheme(id);
    if (!custom) return null;
    return {
      tokens: customThemeTokens(custom),
      dataTheme: custom.base,
      scheme: customThemeScheme(custom),
    };
  }
  const theme = THEMES[id as ThemeId];
  if (!theme) return null;
  return { tokens: theme.tokens, dataTheme: id, scheme: theme.scheme };
}

/**
 * Writes all token overrides for `id` onto `document.documentElement` and
 * updates `data-theme` + `color-scheme`.  This is intentionally side-effectful
 * and kept outside of reactive primitives so it can also be called from tests.
 * Accepts both built-in ThemeIds and `custom:` ids (base tokens + overrides).
 *
 * When `highContrast` is set (default: the live `prefers-contrast: more`
 * signal) the theme's OWN foreground tokens are boosted through the OKLCH
 * contrast solver and merged over the base — a per-theme, mechanically-derived
 * high-contrast variant rather than one shared static override. Boosted keys
 * reuse the base keys, so toggling the preference off simply restores the base
 * values on the next apply. Inline vars win over any [data-theme] CSS.
 */
export function applyThemeToDom(id: string, highContrast: boolean = prefersMoreContrast()): void {
  const resolved = resolveTheme(normalizeThemeId(id) ?? DEFAULT_THEME_ID);
  // DEFAULT_THEME_ID is a compile-time member of THEMES, so this is only a
  // defensive guard against a broken theme registry.
  if (!resolved) return;

  const palette = highContrast
    ? { ...resolved.tokens, ...highContrastOverrides(resolved.tokens) }
    : resolved.tokens;

  const root = document.documentElement;
  // Custom tokens may safely reference another palette token via var() or
  // color-mix(). Commit the incoming palette first so browser colour
  // resolution observes *this* theme, never stale values from the previous
  // theme, then add the derived semantic inks in the same synchronous turn.
  commitTokens(root, palette);
  const tokens = { ...palette, ...semanticThemeTokens(palette) };
  commitTokens(root, tokens);
  root.setAttribute('data-theme', resolved.dataTheme);
  root.dataset.themeScheme = resolved.scheme;
  root.style.setProperty('color-scheme', resolved.scheme);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type ThemeProviderProps = ParentProps<{
  /**
   * Controlled value.  If provided the provider will follow this value instead
   * of its internal signal. Useful for account-synced preferences.
   */
  value?: string;
}>;

export function ThemeProvider(props: ThemeProviderProps) {
  const [innerThemeId, setInnerThemeId] = createSignal<string>(readThemeId());
  const [customThemes, setCustomThemes] = createSignal<CustomTheme[]>(loadCustomThemes());

  const themeId = (): string => normalizeThemeId(props.value ?? innerThemeId()) ?? DEFAULT_THEME_ID;

  const setTheme = (id: string): void => {
    const valid = normalizeThemeId(id) ?? DEFAULT_THEME_ID;
    setInnerThemeId(valid);
    persistThemeId(valid);
  };

  const saveCustom = (name: string, base: ThemeId, overrides: TokenMap): string => {
    const created = addCustomTheme(name, base, overrides);
    setCustomThemes(loadCustomThemes());
    return created.id;
  };

  const deleteCustom = (id: string): void => {
    const fallback = getCustomTheme(id)?.base ?? DEFAULT_THEME_ID;
    removeCustomTheme(id);
    setCustomThemes(loadCustomThemes());
    if (themeId() === id) setTheme(fallback);
  };

  /**
   * One-time import of a shared theme from `?theme=<code>` on boot. Untrusted
   * input fails closed to null in parseThemeParam, so this never throws; a valid
   * theme is persisted through the existing customThemes helper (saveCustom →
   * addCustomTheme) and made active. The param is stripped afterwards so a
   * refresh does not re-import.
   */
  const importSharedThemeFromUrl = (): void => {
    if (typeof window === 'undefined' || typeof location === 'undefined') return;
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has(SHARE_PARAM)) return;
      const parsed = parseThemeParam(params.get(SHARE_PARAM));
      if (parsed) {
        const importedId = saveCustom(parsed.name, parsed.base, parsed.overrides);
        setTheme(importedId);
      }
      stripShareParam(params);
    } catch {
      // Never let a malformed share link break app boot.
    }
  };

  importSharedThemeFromUrl();

  // Keep multiple Onyx tabs coherent. A custom-theme deletion can invalidate
  // the active id even when the theme preference itself did not change, so
  // both storage keys refresh the controller and force a palette re-apply.
  onMount(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        setInnerThemeId(readThemeId());
      }
      if (event.key === CUSTOM_THEME_STORAGE_KEY || event.key === null) {
        setCustomThemes(loadCustomThemes());
        // Storage tasks run after the origin tab's synchronous delete + base
        // selection. Read that final persisted value so receivers never flash
        // through the default palette between the two ordered events.
        setInnerThemeId(readThemeId());
      }
    };
    const handleThemeChange = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'object' || detail === null || !('id' in detail)) return;
      const { id } = detail as { id?: unknown };
      if (typeof id !== 'string') return;
      // Spotlight and other non-component entry points have no access to the
      // context setter. They persist through the store, then notify the one
      // palette owner so its reactive signal and DOM tokens stay aligned.
      setInnerThemeId(normalizeThemeId(id) ?? DEFAULT_THEME_ID);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    onCleanup(() => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    });
  });

  // Apply CSS variables whenever the active theme (or its custom overrides)
  // change, the OS `prefers-contrast: more` signal flips, or the explicit
  // Preferences accessibility toggle changes. Both accessibility paths drive
  // the same per-theme OKLCH solver; the manual toggle must not degrade to a
  // handful of static CSS overrides while the OS path gets the real palette.
  createEffect(() => {
    customThemes(); // re-apply if the active custom theme was edited
    applyThemeToDom(themeId(), prefersMoreContrast() || preferences().highContrast);
  });

  // Remove every DOM mutation owned by the provider. Leaving inline tokens or
  // color-scheme behind makes a later mount with damaged storage inherit a
  // visually unrelated palette.
  onCleanup(() => {
    const root = document.documentElement;
    for (const prop of appliedTokenProps) root.style.removeProperty(prop);
    root.style.removeProperty('color-scheme');
    root.removeAttribute('data-theme');
    delete root.dataset.themeScheme;
    appliedTokenProps = [];
  });

  const context: ThemeContextValue = { themeId, setTheme, customThemes, saveCustom, deleteCustom };

  return (
    <ThemeContext.Provider value={context}>
      {props.children}
    </ThemeContext.Provider>
  );
}
