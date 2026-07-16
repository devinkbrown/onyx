// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * calmMode.ts — notification preset model and localStorage-backed calm mode state.
 *
 * Pure classification stays here; the tiny Solid store mirrors the preferences
 * data-* pattern so integration can opt into CSS or shell behaviour later.
 *
 * SOLID IDIOMS: module-level createSignal; never mutate; setters return void.
 */

import { createSignal, type Accessor } from 'solid-js';

export type CalmPreset = 'calm' | 'regular' | 'power';

export const CALM_PRESETS: readonly CalmPreset[] = ['calm', 'regular', 'power'];

export type NotifTier = 'silent' | 'badge' | 'notify';

export interface CalmContext {
  isMention: boolean;
  isFollowed: boolean;
  isDirect: boolean;
  isBoost: boolean;
}

const STORAGE_KEY = 'onyx:calm';
const DEFAULT_CALM_PRESET: CalmPreset = 'regular';
/** Plain and legacy JSON-quoted preset tokens are at most nine characters. */
export const MAX_CALM_PRESET_STORAGE_CHARS = 32;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isCalmPreset(value: unknown): value is CalmPreset {
  return typeof value === 'string' && (CALM_PRESETS as readonly string[]).includes(value);
}

/** Classify a message event into the quiet notification tier for a preset. */
export function classifyNotification(preset: CalmPreset, ctx: CalmContext): NotifTier {
  if (ctx.isBoost) return 'silent';

  switch (preset) {
    case 'calm':
      if (ctx.isMention || ctx.isDirect) return 'notify';
      if (ctx.isFollowed) return 'badge';
      return 'silent';
    case 'regular':
      return ctx.isMention || ctx.isDirect || ctx.isFollowed ? 'notify' : 'badge';
    case 'power':
      return 'notify';
  }
}

/** Read + validate the persisted calm preset, falling back to regular. */
export function loadCalmPreset(): CalmPreset {
  if (!hasStorage()) return DEFAULT_CALM_PRESET;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isCalmPreset(stored)) return stored;
    if (stored && stored.length > MAX_CALM_PRESET_STORAGE_CHARS) return DEFAULT_CALM_PRESET;
    const parsed: unknown = JSON.parse(stored ?? 'null');
    return isCalmPreset(parsed) ? parsed : DEFAULT_CALM_PRESET;
  } catch {
    return DEFAULT_CALM_PRESET;
  }
}

function persist(preset: CalmPreset): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, preset);
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

const [calmPresetAccessor, setCalmPresetSignal] = createSignal<CalmPreset>(loadCalmPreset());

/** Accessor for the active calm notification preset. */
export const calmPreset: Accessor<CalmPreset> = calmPresetAccessor;

/** Reflect the current calm preset onto <html> for CSS-driven integration. */
export function applyCalmPreset(preset: CalmPreset = calmPreset()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.calm = preset;
}

/** Set the active calm preset, persisting and reflecting it immediately. */
export function setCalmPreset(preset: CalmPreset): void {
  setCalmPresetSignal(preset);
  persist(preset);
  applyCalmPreset(preset);
}
