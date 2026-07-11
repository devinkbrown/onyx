// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * vaultSearchMode.ts — the persisted DEFAULT device-memory (vault) search mode.
 *
 * A tiny vanilla store (module-level Solid signal + localStorage), mirroring
 * `sceneMotion.ts`. This owns the user's chosen DEFAULT only: the live in-search
 * toggle (`vaultSearchMode`/`setVaultMode`/`toggleVaultMode` in useMessageSearch)
 * stays a transient session value and is seeded from this default at load, so the
 * Preferences "Search & History" selector picks the mode a fresh search starts in.
 */

import { createSignal, type Accessor } from 'solid-js';
import type { VaultSearchMode } from '@/shell/search/useMessageSearch';

/** Selectable defaults, ordered to match the in-search toggle cycle. */
export const VAULT_SEARCH_MODES: readonly VaultSearchMode[] = ['hybrid', 'exact', 'semantic'];

export const DEFAULT_VAULT_SEARCH_MODE: VaultSearchMode = 'hybrid';

const STORAGE_KEY = 'onyx:vault-search-mode';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isVaultSearchMode(value: unknown): value is VaultSearchMode {
  return typeof value === 'string' && (VAULT_SEARCH_MODES as readonly string[]).includes(value);
}

export function parseVaultSearchMode(value: unknown): VaultSearchMode | null {
  return isVaultSearchMode(value) ? value : null;
}

export function loadDefaultVaultSearchMode(): VaultSearchMode {
  if (!hasStorage()) return DEFAULT_VAULT_SEARCH_MODE;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isVaultSearchMode(stored) ? stored : DEFAULT_VAULT_SEARCH_MODE;
  } catch {
    return DEFAULT_VAULT_SEARCH_MODE;
  }
}

function persistDefaultVaultSearchMode(value: VaultSearchMode): void {
  if (!hasStorage()) return;

  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

const [defaultVaultSearchModeAccessor, setDefaultVaultSearchModeSignal] =
  createSignal<VaultSearchMode>(loadDefaultVaultSearchMode());

export const defaultVaultSearchMode: Accessor<VaultSearchMode> = defaultVaultSearchModeAccessor;

export function setDefaultVaultSearchMode(value: VaultSearchMode): void {
  setDefaultVaultSearchModeSignal(value);
  persistDefaultVaultSearchMode(value);
}

export function resetDefaultVaultSearchMode(): void {
  setDefaultVaultSearchMode(DEFAULT_VAULT_SEARCH_MODE);
}
