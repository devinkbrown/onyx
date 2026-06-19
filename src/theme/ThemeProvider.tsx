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
  createSignal,
  onCleanup,
  useContext,
  type ParentProps,
} from 'solid-js';
import { DEFAULT_THEME_ID, THEMES, type ThemeId } from './themes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ruri:theme';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

type ThemeContextValue = {
  /** The currently active theme ID. */
  themeId: () => ThemeId;
  /** Switch to a different theme. */
  setTheme: (id: ThemeId) => void;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in THEMES) return stored as ThemeId;
  } catch {
    // localStorage may be unavailable in some environments.
  }
  return DEFAULT_THEME_ID;
}

function persistTheme(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore write failures.
  }
}

/**
 * Writes all token overrides for `id` onto `document.documentElement` and
 * updates `data-theme` + `color-scheme`.  This is intentionally side-effectful
 * and kept outside of reactive primitives so it can also be called from tests.
 */
export function applyThemeToDom(id: ThemeId): void {
  const theme = THEMES[id];
  if (!theme) return;

  const root = document.documentElement;

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
  const [innerThemeId, setInnerThemeId] = createSignal<ThemeId>(readStoredTheme());

  const themeId = (): ThemeId => props.value ?? innerThemeId();

  const setTheme = (id: ThemeId): void => {
    setInnerThemeId(id);
    persistTheme(id);
  };

  // Apply CSS variables whenever the active theme changes.
  createEffect(() => {
    applyThemeToDom(themeId());
  });

  // On unmount, remove the data-theme attribute so tests stay isolated.
  onCleanup(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  const context: ThemeContextValue = { themeId, setTheme };

  return (
    <ThemeContext.Provider value={context}>
      {props.children}
    </ThemeContext.Provider>
  );
}
