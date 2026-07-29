// SPDX-License-Identifier: AGPL-3.0-or-later
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
import {
  BSD_DOWNLOAD_LANES,
  BSD_DOWNLOADS_PUBLIC_PREFIX,
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
 * @param {'freebsd' | 'openbsd'} lane
 * @param {string} [body]
 */
function writeReleaseArtifacts(root, lane, body = 'artifact-body') {
  const base = releaseAssetBaseName(lane, '0.1.3');
  const dir = join(root, 'zig-out', 'release', `${lane}-x86_64`);
  mkdirSync(dir, { recursive: true });
  const archivePath = join(dir, `${base}.tar.gz`);
  // Fake gzip magic + payload so size checks pass.
  const buf = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from(body.padEnd(80, 'x'))]);
  writeFileSync(archivePath, buf);
  const hash = sha256Hex(buf);
  writeFileSync(
    join(dir, `${base}.sha256`),
    formatSha256SumFile([{ path: `${base}.tar.gz`, hash }]),
  );
  writeFileSync(join(dir, `${base}.NOTICE.txt`), `notice for ${lane}\n`);
  return { archivePath, hash, base };
}

describe('stage-bsd-downloads pure helpers', () => {
  it('pins public prefix and asset URLs under /downloads/v0.1.3/', () => {
    expect(BSD_DOWNLOADS_PUBLIC_PREFIX).toBe('downloads/v0.1.3');
    expect(BSD_DOWNLOAD_LANES).toEqual(['freebsd', 'openbsd']);
    const f = bsdPublicAssetNames('freebsd');
    expect(f.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(f.sha256Url).toMatch(/\.sha256$/);
    expect(f.publicDir).toBe('/downloads/v0.1.3');
    const o = bsdPublicAssetNames('openbsd');
    expect(o.archiveUrl).toContain('openbsd-x86_64');
  });

  it('parses coreutils sha256sum lines fail-closed', () => {
    expect(parseSha256SumLine('deadbeef  file.tar.gz')).toBeNull();
    const ok = parseSha256SumLine(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  onyx.tgz\n',
    );
    expect(ok).toEqual({
      hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      name: 'onyx.tgz',
    });
  });

  it('builds catalog without virus-free or signing claims', () => {
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
    expect(catalog.signing).toBe('none');
    expect(catalog.claim.codesign).toBe(false);
    expect(catalog.claim.virusFree).toBe(false);
    expect(catalog.claim.guiVerifiedOnReleaseHost).toBe(false);
    expect(catalog.lanes.find((l) => l.lane === 'freebsd')?.present).toBe(true);
    expect(catalog.lanes.find((l) => l.lane === 'openbsd')?.present).toBe(false);
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(/virus-free/i);
    expect(json).not.toMatch(/"signed":\s*true/);
  });
});

describe('stageBsdDownloads', () => {
  it('stages both lanes + catalog into dist/downloads/v0.1.3', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-bsd-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>t</title>\n');
      const fb = writeReleaseArtifacts(root, 'freebsd', 'freebsd-bytes');
      const ob = writeReleaseArtifacts(root, 'openbsd', 'openbsd-bytes');

      const result = stageBsdDownloads({
        repoRoot: root,
        require: true,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { stageDir } = resolveBsdStagePaths(root, RELEASE_PRODUCT_VERSION);
      expect(result.stageDir).toBe(stageDir);
      expect(readFileSync(join(stageDir, fb.base + '.sha256'), 'utf8')).toMatch(fb.hash);
      expect(readFileSync(join(stageDir, ob.base + '.sha256'), 'utf8')).toMatch(ob.hash);
      const catalog = JSON.parse(readFileSync(join(stageDir, 'catalog.json'), 'utf8'));
      expect(catalog.version).toBe('0.1.3');
      expect(catalog.lanes.every((l) => l.present)).toBe(true);
      expect(catalog.lanes.find((l) => l.lane === 'freebsd')?.sha256).toBe(fb.hash);
      expect(catalog.publicPrefix).toBe('/downloads/v0.1.3');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed in publish/require mode when a lane is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-bsd-req-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      writeReleaseArtifacts(root, 'freebsd');
      // openbsd intentionally missing
      const chunks = [];
      const result = stageBsdDownloads({
        repoRoot: root,
        require: true,
        stdout: { write: () => {} },
        stderr: { write: (s) => chunks.push(String(s)) },
      });
      expect(result.ok).toBe(false);
      expect(chunks.join('')).toMatch(/openbsd|missing/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when an archive does not match its checksum sidecar', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-bsd-hash-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const fb = writeReleaseArtifacts(root, 'freebsd');
      writeReleaseArtifacts(root, 'openbsd');
      writeFileSync(fb.archivePath, Buffer.concat([
        Buffer.from([0x1f, 0x8b]),
        Buffer.from('tampered-after-sidecar'.padEnd(80, 'x')),
      ]));
      const chunks = [];
      const result = stageBsdDownloads({
        repoRoot: root,
        require: true,
        stdout: { write: () => {} },
        stderr: { write: (s) => chunks.push(String(s)) },
      });
      expect(result.ok).toBe(false);
      expect(chunks.join('')).toMatch(/sha256 mismatch/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips missing lanes without --require (normal optional stage)', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-bsd-opt-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const result = stageBsdDownloads({
        repoRoot: root,
        require: false,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.staged).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CLI --require fails closed; --help exits 0', () => {
    expect(runStageBsdDownloadsCli(['--help'], { stdout: { write: () => {} } })).toBe(0);
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-cli-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const code = runStageBsdDownloadsCli(['--require'], {
        repoRoot: root,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
