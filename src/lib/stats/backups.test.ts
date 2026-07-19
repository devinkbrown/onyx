// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchBackupManifest,
  MAX_BACKUP_FILES,
  MAX_BACKUP_KIND_LENGTH,
  MAX_BACKUP_NAME_LENGTH,
  normalizeBackupManifest,
} from './backups';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeBackupManifest', () => {
  it('returns null for non-object manifests', () => {
    expect(normalizeBackupManifest(null)).toBeNull();
    expect(normalizeBackupManifest('not-json')).toBeNull();
  });

  it('accepts Onyx Server latest.json backup manifests', () => {
    const manifest = normalizeBackupManifest({
      generated_at: 1783500000,
      files: [
        { kind: 'accounts', name: 'accounts-1783500000.db.snap', source: '/var/lib/onyx/accounts.db' },
        { kind: 'chanstats', name: 'chanstats-1783500000.snapshot', source: '/srv/stats/.chanstats.snapshot' },
      ],
    });

    expect(manifest?.files.map((f) => f.kind)).toEqual(['accounts', 'chanstats']);
    expect(manifest?.generated_at).toBe(1783500000);
  });

  it('drops malformed file entries without rejecting the manifest', () => {
    const manifest = normalizeBackupManifest({
      generated_at: 1,
      files: [{ kind: 'accounts' }, { kind: 'chanstats', name: 'ok.snapshot' }],
    });

    expect(manifest?.files).toHaveLength(1);
    expect(manifest?.files[0]?.name).toBe('ok.snapshot');
  });

  it('defaults generated_at and source when optional manifest fields are malformed', () => {
    const manifest = normalizeBackupManifest({
      generated_at: 'yesterday',
      files: [{ kind: 'accounts', name: 'accounts.snap', source: 42 }],
    });

    expect(manifest).toEqual({
      generated_at: 0,
      files: [{ kind: 'accounts', name: 'accounts.snap', source: '' }],
    });
  });

  it('treats missing files as an empty manifest rather than rejecting the feed', () => {
    expect(normalizeBackupManifest({ generated_at: 3 })?.files).toEqual([]);
  });

  it('bounds file work and every rendered metadata field', () => {
    const files = Array.from({ length: MAX_BACKUP_FILES + 3 }, (_, index) => ({
      kind: 'k'.repeat(index === 0 ? MAX_BACKUP_KIND_LENGTH + 1 : MAX_BACKUP_KIND_LENGTH),
      name: `${index}-`.padEnd(MAX_BACKUP_NAME_LENGTH, 'n').slice(0, MAX_BACKUP_NAME_LENGTH),
      source: `/${'s'.repeat(600)}-${index}`,
    }));

    const manifest = normalizeBackupManifest({
      generated_at: Number.POSITIVE_INFINITY,
      files,
    })!;

    expect(manifest.files).toHaveLength(MAX_BACKUP_FILES - 1);
    expect(manifest.files[0]!.kind).toHaveLength(MAX_BACKUP_KIND_LENGTH);
    expect(manifest.files[0]!.name).toHaveLength(MAX_BACKUP_NAME_LENGTH);
    expect(manifest.files[0]!.source).toHaveLength(512);
    expect(manifest.generated_at).toBe(0);
  });

  it('drops control-bearing and case-insensitive duplicate file rows', () => {
    const manifest = normalizeBackupManifest({
      files: [
        { kind: 'accounts', name: 'accounts.snap', source: '/first' },
        { kind: 'ACCOUNTS', name: 'ACCOUNTS.SNAP', source: '/duplicate' },
        { kind: 'chanstats\nforged', name: 'stats.snap' },
        { kind: 'chanstats', name: 'stats\tforged.snap' },
      ],
    })!;

    expect(manifest.files).toEqual([
      { kind: 'accounts', name: 'accounts.snap', source: '/first' },
    ]);
  });
});

describe('fetchBackupManifest', () => {
  it('requests only the deployed canonical public manifest', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      generated_at: 1783500000,
      files: [{ kind: 'accounts', name: 'accounts.snap' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBackupManifest()).resolves.toEqual({
      generated_at: 1783500000,
      files: [{ kind: 'accounts', name: 'accounts.snap', source: '' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/stats/backups/latest.json', expect.objectContaining({
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }));
  });
});
