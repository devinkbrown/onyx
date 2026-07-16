// SPDX-License-Identifier: AGPL-3.0-or-later
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

export const CLOCKS = ['24h', '12h'] as const;
export type Clock = (typeof CLOCKS)[number];

export const PREFERENCE_CATEGORY_IDS = [
  'display',
  'conversation',
  'history',
  'transfer',
  'tools',
  'accessibility',
] as const;
export type PreferenceCategory = (typeof PREFERENCE_CATEGORY_IDS)[number];

export interface Preferences {
  /** Vertical rhythm of the message feed. */
  density: Density;
  /** Base UI font size. */
  fontScale: FontScale;
  /** Hide join/part/quit + other system event lines. */
  hideEvents: boolean;
  /** Reading measure: capped (measured) or edge-to-edge (full). */
  width: Width;
  /** Reader mode: a calm, typographic single-column transcript — the reading
   * persona treated as primary (larger measure, quiet chrome, grouped prose). */
  readerMode: boolean;
  /** Force-disable animations regardless of OS preference. */
  reduceMotion: boolean;
  /** Flatten translucent surfaces regardless of OS preference. */
  reduceTransparency: boolean;
  /** Raise interface contrast regardless of OS preference. */
  highContrast: boolean;
  /** Unfurl the first web link in a message into an OG preview card. */
  linkPreviews: boolean;
  /** Timestamp clock format for messages and sidebar activity. */
  clock: Clock;
  /** Local-first scrollback: persist conversations to this device (vault). */
  localHistory: boolean;
  /** Encrypt DMs end-to-end (Tsumugi) when the other party has a device key. */
  e2eeDms: boolean;
  /** Show the channel activity time scrubber. */
  timeScrubber: boolean;
  /** Show the channel voice/video join affordance. */
  voiceEntry: boolean;
  /** Show channel topic creation/follow/forum tools above the feed. */
  topicTools: boolean;
  /** Show shared watch-together activity above the feed. */
  watchTogether: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  density: 'cozy',
  fontScale: 'md',
  hideEvents: false,
  width: 'measured',
  readerMode: false,
  reduceMotion: false,
  reduceTransparency: false,
  highContrast: false,
  linkPreviews: true,
  clock: '24h',
  localHistory: true,
  e2eeDms: true,
  timeScrubber: true,
  voiceEntry: true,
  topicTools: false,
  watchTogether: true,
};

// ── persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'onyx:preferences';
/** Legacy key from the previous brand name; read-only for one-time migration. */
const LEGACY_STORAGE_KEY = 'ruri:preferences';
/** Older store-level high-contrast toggle; read-only for migration. */
const LEGACY_HIGH_CONTRAST_KEY = 'onyx:high-contrast';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function preferencesFromRecord(raw: Record<string, unknown>): Preferences {
  return {
    density: isOneOf(raw.density, DENSITIES) ? raw.density : DEFAULT_PREFERENCES.density,
    fontScale: isOneOf(raw.fontScale, FONT_SCALES) ? raw.fontScale : DEFAULT_PREFERENCES.fontScale,
    hideEvents: typeof raw.hideEvents === 'boolean' ? raw.hideEvents : DEFAULT_PREFERENCES.hideEvents,
    width: isOneOf(raw.width, WIDTHS) ? raw.width : DEFAULT_PREFERENCES.width,
    readerMode:
      typeof raw.readerMode === 'boolean' ? raw.readerMode : DEFAULT_PREFERENCES.readerMode,
    reduceMotion: typeof raw.reduceMotion === 'boolean' ? raw.reduceMotion : DEFAULT_PREFERENCES.reduceMotion,
    reduceTransparency: typeof raw.reduceTransparency === 'boolean'
      ? raw.reduceTransparency
      : DEFAULT_PREFERENCES.reduceTransparency,
    highContrast: typeof raw.highContrast === 'boolean'
      ? raw.highContrast
      : DEFAULT_PREFERENCES.highContrast,
    linkPreviews: typeof raw.linkPreviews === 'boolean' ? raw.linkPreviews : DEFAULT_PREFERENCES.linkPreviews,
    clock: isOneOf(raw.clock, CLOCKS) ? raw.clock : DEFAULT_PREFERENCES.clock,
    localHistory: typeof raw.localHistory === 'boolean' ? raw.localHistory : DEFAULT_PREFERENCES.localHistory,
    e2eeDms: typeof raw.e2eeDms === 'boolean' ? raw.e2eeDms : DEFAULT_PREFERENCES.e2eeDms,
    timeScrubber: typeof raw.timeScrubber === 'boolean' ? raw.timeScrubber : DEFAULT_PREFERENCES.timeScrubber,
    voiceEntry: typeof raw.voiceEntry === 'boolean' ? raw.voiceEntry : DEFAULT_PREFERENCES.voiceEntry,
    topicTools: typeof raw.topicTools === 'boolean' ? raw.topicTools : DEFAULT_PREFERENCES.topicTools,
    watchTogether: typeof raw.watchTogether === 'boolean' ? raw.watchTogether : DEFAULT_PREFERENCES.watchTogether,
  };
}

export function parsePreferencesSnapshot(value: unknown): Preferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return preferencesFromRecord(value as Record<string, unknown>);
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

  const parsedPrefs = preferencesFromRecord(raw);
  return {
    ...parsedPrefs,
    highContrast: typeof raw.highContrast === 'boolean'
      ? parsedPrefs.highContrast
      : localStorage.getItem(LEGACY_HIGH_CONTRAST_KEY) === '1',
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
  root.dataset.reader = String(prefs.readerMode);
  root.dataset.reduceMotion = String(prefs.reduceMotion);
  root.dataset.reduceTransparency = String(prefs.reduceTransparency);
  root.dataset.highContrast = String(prefs.highContrast);
}

// ── reactive store ──────────────────────────────────────────────────────────

const [preferences, setPreferencesSignal] = createSignal<Preferences>(loadPreferences());
const [open, setOpen] = createSignal(false);
const [requestedCategory, setRequestedCategory] = createSignal<PreferenceCategory | null>(null);

/** Accessor for the whole preferences object. */
export { preferences };

/** Panel open-state accessor (gates `<PreferencesPanel/>`). */
export const isPreferencesOpen: Accessor<boolean> = open;

/** Optional category requested by a category-specific Preferences entry point. */
export const requestedPreferenceCategory: Accessor<PreferenceCategory | null> = requestedCategory;

export function openPreferences(category?: PreferenceCategory): void {
  // Clear an earlier deep-link request on ordinary opens so a normal reopen
  // retains the category already selected in the mounted panel.
  setRequestedCategory(category ?? null);
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

export function applyPreferencesSnapshot(snapshot: Preferences): void {
  const next: Preferences = { ...snapshot };
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
