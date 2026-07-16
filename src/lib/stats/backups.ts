// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * backups.ts — public backup manifest feed.
 *
 * Orochi's `[backup]` worker writes `latest.json` with a list of timestamped
 * account and chanstats snapshots. The composite Onyx deployment exposes that
 * bounded manifest at one source-controlled canonical route.
 */
import { boundedFeedText, boundedUnixSeconds } from './feedBounds';
import { fetchPublicJson } from './fetchPublicJson';

export const MAX_BACKUP_FILES = 128;
export const MAX_BACKUP_KIND_LENGTH = 64;
export const MAX_BACKUP_NAME_LENGTH = 256;
const MAX_BACKUP_SOURCE_LENGTH = 512;

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
    for (const entry of r['files'].slice(0, MAX_BACKUP_FILES)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (
        typeof e['kind'] !== 'string'
        || e['kind'].length === 0
        || e['kind'].length > MAX_BACKUP_KIND_LENGTH
        || typeof e['name'] !== 'string'
        || e['name'].length === 0
        || e['name'].length > MAX_BACKUP_NAME_LENGTH
      ) continue;
      const kind = e['kind'];
      const name = e['name'];
      files.push({
        kind,
        name,
        source: boundedFeedText(e['source'], MAX_BACKUP_SOURCE_LENGTH),
      });
    }
  }
  return {
    generated_at: boundedUnixSeconds(r['generated_at']),
    files,
  };
}

export async function fetchBackupManifest(): Promise<BackupManifest | null> {
  return normalizeBackupManifest(await fetchPublicJson('/stats/backups/latest.json'));
}
