// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Compatibility re-export surface tests (BSD names still work).
 * Full multi-lane coverage lives in stage-release-downloads.test.mjs.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RELEASE_PRODUCT_VERSION,
  formatSha256SumFile,
  releaseAssetBaseName,
  sha256Hex,
} from './release-unix.mjs';
import { releaseZipBaseName } from './release-windows.mjs';
import {
  BSD_DOWNLOAD_LANES,
  BSD_DOWNLOADS_PUBLIC_PREFIX,
  PUBLIC_DOWNLOAD_LANES,
  bsdPublicAssetNames,
  buildBsdDownloadCatalog,
  parseSha256SumLine,
  resolveBsdStagePaths,
  runStageBsdDownloadsCli,
  stageBsdDownloads,
} from './stage-bsd-downloads.mjs';

function writeAlignedManifests(root) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.3' }, null, 2));
  writeFileSync(join(root, 'app.zon'), '.{ .version = "0.1.3" }\n');
  writeFileSync(join(root, 'build.zig.zon'), '.{ .version = "0.1.3" }\n');
}

/**
 * @param {string} root
 * @param {'windows' | 'linux' | 'macos-x86_64' | 'macos-arm64' | 'freebsd' | 'openbsd'} lane
 * @param {string} [body]
 */
function writeReleaseArtifacts(root, lane, body = 'artifact-body') {
  const isWin = lane === 'windows';
  const isMacIntel = lane === 'macos-x86_64';
  const isMacArm = lane === 'macos-arm64';
  const isMac = isMacIntel || isMacArm;
  const macArch = isMacIntel ? 'x86_64' : isMacArm ? 'arm64' : null;
  const base = isWin
    ? releaseZipBaseName('0.1.3')
    : isMac
      ? releaseAssetBaseName('macos', '0.1.3', 'ReleaseFast', macArch)
      : releaseAssetBaseName(lane, '0.1.3');
  const ext = isWin ? 'zip' : isMac ? 'dmg' : 'tar.gz';
  const dir = isMac
    ? join(root, 'zig-out', 'release', `macos-${macArch}`)
    : join(root, 'zig-out', 'release', `${lane}-x86_64`);
  mkdirSync(dir, { recursive: true });
  const archivePath = join(dir, `${base}.${ext}`);
  const magic = isWin
    ? Buffer.from([0x50, 0x4b])
    : isMac
      ? Buffer.from('koly')
      : Buffer.from([0x1f, 0x8b]);
  const buf = Buffer.concat([magic, Buffer.from(body.padEnd(80, 'x'))]);
  writeFileSync(archivePath, buf);
  const hash = sha256Hex(buf);
  writeFileSync(
    join(dir, `${base}.sha256`),
    formatSha256SumFile([{ path: `${base}.${ext}`, hash }]),
  );
  writeFileSync(join(dir, `${base}.NOTICE.txt`), `notice for ${lane}\n`);
  return { archivePath, hash, base };
}

describe('stage-bsd-downloads compat surface', () => {
  it('re-exports public multi-lane constants and BSD asset names', () => {
    expect(BSD_DOWNLOADS_PUBLIC_PREFIX).toBe('downloads/v0.1.3');
    expect(BSD_DOWNLOAD_LANES).toEqual(['freebsd', 'openbsd']);
    expect(PUBLIC_DOWNLOAD_LANES).toEqual([
      'windows',
      'linux',
      'macos-x86_64',
      'macos-arm64',
      'freebsd',
      'openbsd',
    ]);
    const f = bsdPublicAssetNames('freebsd');
    expect(f.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(parseSha256SumLine('deadbeef  x')).toBeNull();
  });

  it('buildBsdDownloadCatalog still works for BSD-only lane lists', () => {
    const catalog = buildBsdDownloadCatalog({
      version: '0.1.3',
      artifacts: [
        {
          lane: 'freebsd',
          archive: 'a.tar.gz',
          sha256: 'a.sha256',
          notice: 'a.NOTICE.txt',
          hash: 'aa'.repeat(32),
          bytes: 100,
        },
      ],
    });
    expect(catalog.unsigned).toBe(true);
    expect(catalog.lanes.map((l) => l.lane)).toEqual(['freebsd', 'openbsd']);
    expect(catalog.lanes.find((l) => l.lane === 'freebsd')?.present).toBe(true);
  });

  it('stageBsdDownloads stages full public surface (compat alias)', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-bsd-compat-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>t</title>\n');
      for (const lane of PUBLIC_DOWNLOAD_LANES) writeReleaseArtifacts(root, lane, lane);
      const result = stageBsdDownloads({
        repoRoot: root,
        require: true,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { stageDir } = resolveBsdStagePaths(root, RELEASE_PRODUCT_VERSION);
      const catalog = JSON.parse(readFileSync(join(stageDir, 'catalog.json'), 'utf8'));
      expect(catalog.lanes).toHaveLength(6);
      expect(catalog.lanes.every((l) => l.present)).toBe(true);
      expect(catalog.claim.macosAvailable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CLI --help and missing-artifacts --require via compat entry', () => {
    expect(runStageBsdDownloadsCli(['--help'], { stdout: { write: () => {} } })).toBe(0);
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-bsd-cli-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      expect(
        runStageBsdDownloadsCli(['--require'], {
          repoRoot: root,
          stdout: { write: () => {} },
          stderr: { write: () => {} },
        }),
      ).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
