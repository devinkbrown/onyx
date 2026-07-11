// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { normalizeBackupManifest } from './backups';

describe('normalizeBackupManifest', () => {
  it('returns null for non-object manifests', () => {
    expect(normalizeBackupManifest(null)).toBeNull();
    expect(normalizeBackupManifest('not-json')).toBeNull();
  });

  it('accepts Orochi latest.json backup manifests', () => {
    const manifest = normalizeBackupManifest({
      generated_at: 1783500000,
      files: [
        { kind: 'accounts', name: 'accounts-1783500000.db.snap', source: '/var/lib/orochi/accounts.db' },
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
});
