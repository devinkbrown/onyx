/**
 * preferences.ts — display & behaviour preferences (separate from theme/account/voice).
 *
 * A small vanilla store (module-level Solid signals + localStorage), mirroring the
 * localStorage helper pattern in `src/lib/store/store.ts` but kept entirely apart so
 * it never tangles with the connection store. The *only* way these settings reach the
 * UI is by writing `data-*` attributes onto `document.documentElement` — the actual
 * styling lives in `preferences.css`, so the message components stay untouched.
 *
 * SOLID IDIOMS: module-level createSignal; never mutate; setters return void.
 */

import { createSignal, type Accessor } from 'solid-js';

// ── option vocabularies ─────────────────────────────────────────────────────

export const DENSITIES = ['compact', 'cozy', 'roomy'] as const;
export type Density = (typeof DENSITIES)[number];

export const FONT_SCALES = ['sm', 'md', 'lg'] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export const WIDTHS = ['measured', 'full'] as const;
export type Width = (typeof WIDTHS)[number];

export interface Preferences {
  /** Vertical rhythm of the message feed. */
  density: Density;
  /** Base UI font size. */
  fontScale: FontScale;
  /** Hide join/part/quit + other system event lines. */
  hideEvents: boolean;
  /** Reading measure: capped (measured) or edge-to-edge (full). */
  width: Width;
  /** Force-disable animations regardless of OS preference. */
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  density: 'cozy',
  fontScale: 'md',
  hideEvents: false,
  width: 'measured',
  reduceMotion: false,
};

// ── persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'onyx:preferences';
/** Legacy key from the previous brand name; read-only for one-time migration. */
const LEGACY_STORAGE_KEY = 'ruri:preferences';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Read + validate persisted prefs, falling back to defaults for any bad field. */
export function loadPreferences(): Preferences {
  if (!hasStorage()) return { ...DEFAULT_PREFERENCES };

  let parsed: unknown;
  try {
    // Current key first, then fall back to the legacy key (read-old-write-new)
    // so prefs saved under the previous brand survive one load after the rebrand.
    const serialized = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    parsed = JSON.parse(serialized ?? '{}');
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }

  const raw = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;

  return {
    density: isOneOf(raw.density, DENSITIES) ? raw.density : DEFAULT_PREFERENCES.density,
    fontScale: isOneOf(raw.fontScale, FONT_SCALES) ? raw.fontScale : DEFAULT_PREFERENCES.fontScale,
    hideEvents: typeof raw.hideEvents === 'boolean' ? raw.hideEvents : DEFAULT_PREFERENCES.hideEvents,
    width: isOneOf(raw.width, WIDTHS) ? raw.width : DEFAULT_PREFERENCES.width,
    reduceMotion: typeof raw.reduceMotion === 'boolean' ? raw.reduceMotion : DEFAULT_PREFERENCES.reduceMotion,
  };
}

function persist(prefs: Preferences): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

// ── DOM application (CSS-driven) ────────────────────────────────────────────

/**
 * Reflect the current preferences onto `document.documentElement` so the rules in
 * `preferences.css` (which target the existing shell classes via these attributes)
 * take effect. No component markup is touched.
 */
export function applyPreferences(prefs: Preferences = preferences()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.density = prefs.density;
  root.dataset.fontScale = prefs.fontScale;
  root.dataset.hideEvents = String(prefs.hideEvents);
  root.dataset.width = prefs.width;
  root.dataset.reduceMotion = String(prefs.reduceMotion);
}

// ── reactive store ──────────────────────────────────────────────────────────

const [preferences, setPreferencesSignal] = createSignal<Preferences>(loadPreferences());
const [open, setOpen] = createSignal(false);

/** Accessor for the whole preferences object. */
export { preferences };

/** Panel open-state accessor (gates `<PreferencesPanel/>`). */
export const isPreferencesOpen: Accessor<boolean> = open;

export function openPreferences(): void {
  setOpen(true);
}

export function closePreferences(): void {
  setOpen(false);
}

/** Immutable field update: persists + re-applies to the DOM. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  const next: Preferences = { ...preferences(), [key]: value };
  setPreferencesSignal(next);
  persist(next);
  applyPreferences(next);
}

/** Restore every setting to its default. */
export function resetPreferences(): void {
  const next: Preferences = { ...DEFAULT_PREFERENCES };
  setPreferencesSignal(next);
  persist(next);
  applyPreferences(next);
}
