/**
 * ThemeProvider — Solid context that manages the active theme.
 *
 * Responsibilities:
 *   - Applies a theme by writing CSS custom-property overrides onto
 *     `document.documentElement` and toggling `data-theme` / `color-scheme`.
 *   - Persists the user's choice to localStorage under STORAGE_KEY.
 *   - Exposes `useTheme()` + `setTheme()` to all descendants.
 *
 * Account-sync hook (future wave):
 *   When server-side account preferences are ready, call `setTheme()` with the
 *   account value after the IRC ACCOUNTINFO response is parsed.  The provider
 *   already accepts an external `value` prop for controlled usage.
 *   // TODO(account-sync): accept ThemeId from account store and pass as `value`.
 */

import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
  useContext,
  type ParentProps,
} from 'solid-js';
import { DEFAULT_THEME_ID, THEMES, type ThemeId, type TokenMap } from './themes';
import {
  addCustomTheme,
  customThemeScheme,
  customThemeTokens,
  getCustomTheme,
  isCustomThemeId,
  loadCustomThemes,
  removeCustomTheme,
  type CustomTheme,
} from './customThemes';
import { parseThemeParam } from '@/lib/theme/themeShare';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'onyx:theme';
/** Legacy key from the previous brand name; read-only for one-time migration. */
const LEGACY_STORAGE_KEY = 'ruri:theme';
/** Legacy built-in theme id that was renamed to its current brand-consistent id. */
const LEGACY_THEME_ID = 'ruri';
const MIGRATED_THEME_ID = 'onyx';

/** Map a stored (possibly legacy) theme id to its current id. */
function migrateThemeId(id: string): string {
  return id === LEGACY_THEME_ID ? MIGRATED_THEME_ID : id;
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

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
    const [id, setId] = createSignal<string>(readStoredTheme());
    const [custom, setCustom] = createSignal<CustomTheme[]>(loadCustomThemes());
    const setTheme = (next: string): void => {
      setId(next);
      persistTheme(next);
      if (typeof document !== 'undefined') applyThemeToDom(next);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStoredTheme(): string {
  try {
    // Read the current key first; fall back to the legacy key (read-old-write-new)
    // so existing users keep their saved theme through one load after the rebrand.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const stored = raw ? migrateThemeId(raw) : null;
    if (stored && (stored in THEMES || (isCustomThemeId(stored) && getCustomTheme(stored)))) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable in some environments.
  }
  return DEFAULT_THEME_ID;
}

function persistTheme(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore write failures.
  }
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
 * Writes all token overrides for `id` onto `document.documentElement` and
 * updates `data-theme` + `color-scheme`.  This is intentionally side-effectful
 * and kept outside of reactive primitives so it can also be called from tests.
 * Accepts both built-in ThemeIds and `custom:` ids (base tokens + overrides).
 */
export function applyThemeToDom(id: string): void {
  const root = document.documentElement;

  // Custom theme: apply its base's tokens overlaid with the saved overrides,
  // inheriting the base's colour scheme. Inline vars win over any [data-theme] CSS.
  if (isCustomThemeId(id)) {
    const custom = getCustomTheme(id);
    if (!custom) return;
    for (const [prop, value] of Object.entries(customThemeTokens(custom))) {
      root.style.setProperty(prop, value);
    }
    root.setAttribute('data-theme', custom.base);
    root.style.setProperty('color-scheme', customThemeScheme(custom));
    return;
  }

  const theme = THEMES[id as ThemeId];
  if (!theme) return;

  // Write every token override.
  for (const [prop, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(prop, value);
  }

  root.setAttribute('data-theme', id);
  root.style.setProperty('color-scheme', theme.scheme);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type ThemeProviderProps = ParentProps<{
  /**
   * Controlled value.  If provided the provider will follow this value instead
   * of its internal signal.  Useful for account-sync (future wave).
   *
   * // TODO(account-sync): wire this to the account preferences store.
   */
  value?: ThemeId;
}>;

export function ThemeProvider(props: ThemeProviderProps) {
  const [innerThemeId, setInnerThemeId] = createSignal<string>(readStoredTheme());
  const [customThemes, setCustomThemes] = createSignal<CustomTheme[]>(loadCustomThemes());

  const themeId = (): string => props.value ?? innerThemeId();

  const setTheme = (id: string): void => {
    setInnerThemeId(id);
    persistTheme(id);
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

  // Apply CSS variables whenever the active theme (or its custom overrides) change.
  createEffect(() => {
    customThemes(); // re-apply if the active custom theme was edited
    applyThemeToDom(themeId());
  });

  // On unmount, remove the data-theme attribute so tests stay isolated.
  onCleanup(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  const context: ThemeContextValue = { themeId, setTheme, customThemes, saveCustom, deleteCustom };

  return (
    <ThemeContext.Provider value={context}>
      {props.children}
    </ThemeContext.Provider>
  );
}
