// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VAULT_SEARCH_MODE,
  VAULT_SEARCH_MODES,
  defaultVaultSearchMode,
  loadDefaultVaultSearchMode,
  parseVaultSearchMode,
  resetDefaultVaultSearchMode,
  setDefaultVaultSearchMode,
} from './vaultSearchMode';

const STORAGE_KEY = 'onyx:vault-search-mode';

describe('vaultSearchMode default preference', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultVaultSearchMode();
  });

  afterEach(() => {
    localStorage.clear();
    resetDefaultVaultSearchMode();
  });

  it('defaults to hybrid with no stored value', () => {
    expect(DEFAULT_VAULT_SEARCH_MODE).toBe('hybrid');
    expect(loadDefaultVaultSearchMode()).toBe('hybrid');
    expect(defaultVaultSearchMode()).toBe('hybrid');
  });

  it('offers exactly the three vault modes in cycle order', () => {
    expect(VAULT_SEARCH_MODES).toEqual(['hybrid', 'exact', 'semantic']);
  });

  it('persists a chosen default to localStorage under the onyx: key', () => {
    setDefaultVaultSearchMode('semantic');

    expect(defaultVaultSearchMode()).toBe('semantic');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('semantic');
    // A fresh load (e.g. next app start) honors the persisted value.
    expect(loadDefaultVaultSearchMode()).toBe('semantic');
  });

  it('reads a persisted default back on load', () => {
    localStorage.setItem(STORAGE_KEY, 'exact');
    expect(loadDefaultVaultSearchMode()).toBe('exact');
  });

  it('falls back to the default for an unknown stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'nonsense');
    expect(loadDefaultVaultSearchMode()).toBe('hybrid');
  });

  it('validates candidate modes', () => {
    expect(parseVaultSearchMode('hybrid')).toBe('hybrid');
    expect(parseVaultSearchMode('exact')).toBe('exact');
    expect(parseVaultSearchMode('semantic')).toBe('semantic');
    expect(parseVaultSearchMode('lexical')).toBeNull();
    expect(parseVaultSearchMode(42)).toBeNull();
    expect(parseVaultSearchMode(null)).toBeNull();
  });
});
