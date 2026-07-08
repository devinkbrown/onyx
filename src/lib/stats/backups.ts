/**
 * backups.ts — public backup manifest feed.
 *
 * Orochi's `[backup]` worker writes `latest.json` with a list of timestamped
 * account and chanstats snapshots. Operators choose where to serve it, so the
 * website probes a few conventional static paths and degrades quietly.
 */

export type BackupFile = {
  kind: string;
  name: string;
  source: string;
};

export type BackupManifest = {
  generated_at: number;
  files: BackupFile[];
};

export function normalizeBackupManifest(raw: unknown): BackupManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const files: BackupFile[] = [];
  if (Array.isArray(r['files'])) {
    for (const entry of r['files']) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e['kind'] !== 'string' || !e['kind']) continue;
      if (typeof e['name'] !== 'string' || !e['name']) continue;
      files.push({
        kind: e['kind'],
        name: e['name'],
        source: typeof e['source'] === 'string' ? e['source'] : '',
      });
    }
  }
  return {
    generated_at: typeof r['generated_at'] === 'number' ? r['generated_at'] : 0,
    files,
  };
}

export async function fetchBackupManifest(): Promise<BackupManifest | null> {
  for (const path of ['/backups/latest.json', '/backup/latest.json', '/stats/backups/latest.json']) {
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const manifest = normalizeBackupManifest(await res.json());
      if (manifest) return manifest;
    } catch {
      // Try the next conventional static path.
    }
  }
  return null;
}
