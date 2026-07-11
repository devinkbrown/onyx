// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function importMigrationModule(): Promise<typeof import('./migrateStorage')> {
  vi.resetModules();
  return await import('./migrateStorage');
}

describe('migrateLegacyStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('copies ocean-prefixed keys to onyx-prefixed keys on import', async () => {
    localStorage.setItem('ocean-token', 'sst_live');
    localStorage.setItem('ocean-preferences', '{"density":"compact"}');
    localStorage.setItem('other-key', 'untouched');

    await importMigrationModule();

    expect(localStorage.getItem('onyx:token')).toBe('sst_live');
    expect(localStorage.getItem('onyx:preferences')).toBe('{"density":"compact"}');
    expect(localStorage.getItem('other-key')).toBe('untouched');
  });

  it('does not delete legacy keys after copying them', async () => {
    localStorage.setItem('ocean-saved-nick', 'Alice');

    await importMigrationModule();

    expect(localStorage.getItem('ocean-saved-nick')).toBe('Alice');
    expect(localStorage.getItem('onyx:saved-nick')).toBe('Alice');
  });

  it('does not clobber existing onyx data', async () => {
    localStorage.setItem('ocean-preferences', 'legacy');
    localStorage.setItem('onyx:preferences', 'current');

    await importMigrationModule();

    expect(localStorage.getItem('onyx:preferences')).toBe('current');
  });

  it('snapshots keys before writing so multiple legacy keys migrate in one pass', async () => {
    localStorage.setItem('ocean-a', '1');
    localStorage.setItem('ocean-b', '2');

    await importMigrationModule();

    expect(localStorage.getItem('onyx:a')).toBe('1');
    expect(localStorage.getItem('onyx:b')).toBe('2');
  });

  it('runs at most once per module instance', async () => {
    const { migrateLegacyStorage } = await importMigrationModule();
    localStorage.setItem('ocean-late', 'late');

    migrateLegacyStorage();

    expect(localStorage.getItem('onyx:late')).toBeNull();
  });

  it('returns without throwing when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);

    await expect(importMigrationModule()).resolves.toHaveProperty('migrateLegacyStorage');
  });
});
