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
import { releaseZipBaseName } from './release-windows.mjs';
import {
  BSD_DOWNLOAD_LANES,
  DOWNLOADS_PUBLIC_PREFIX,
  MACOS_DOWNLOAD_LANES,
  PUBLIC_DOWNLOAD_LANES,
  UNAVAILABLE_DOWNLOAD_LANES,
  buildDownloadCatalog,
  parseSha256SumLine,
  publicAssetNames,
  resolveDownloadStagePaths,
  runStageReleaseDownloadsCli,
  stageReleaseDownloads,
} from './stage-release-downloads.mjs';

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
  // Fake magic + payload so size checks pass.
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
  return { archivePath, hash, base, ext };
}

describe('stage-release-downloads pure helpers', () => {
  it('pins public prefix and six-lane asset URLs under /downloads/v0.1.3/', () => {
    expect(DOWNLOADS_PUBLIC_PREFIX).toBe('downloads/v0.1.3');
    expect(PUBLIC_DOWNLOAD_LANES).toEqual([
      'windows',
      'linux',
      'macos-x86_64',
      'macos-arm64',
      'freebsd',
      'openbsd',
    ]);
    expect(MACOS_DOWNLOAD_LANES).toEqual(['macos-x86_64', 'macos-arm64']);
    expect(BSD_DOWNLOAD_LANES).toEqual(['freebsd', 'openbsd']);
    expect(UNAVAILABLE_DOWNLOAD_LANES).toEqual([]);
    expect(publicAssetNames('windows').archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.zip',
    );
    expect(publicAssetNames('linux').archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(publicAssetNames('macos-x86_64').archive).toBe(
      'onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg',
    );
    expect(publicAssetNames('macos-x86_64').archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg',
    );
    expect(publicAssetNames('macos-arm64').archive).toBe(
      'onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg',
    );
    expect(publicAssetNames('macos-arm64').archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg',
    );
    expect(publicAssetNames('freebsd').archiveUrl).toContain('freebsd-x86_64');
    expect(publicAssetNames('openbsd').archiveUrl).toContain('openbsd-x86_64');
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

  it('builds catalog without virus-free/signing claims; macosAvailable only when staged', () => {
    const catalog = buildDownloadCatalog({
      version: '0.1.3',
      artifacts: [
        {
          lane: 'windows',
          archive: 'a.zip',
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
    expect(catalog.claim.macosAvailable).toBe(false);
    expect(catalog.claim.windowsRuntimeVerified).toBe(false);
    expect(catalog.unavailable).toEqual([]);
    expect(catalog.lanes.find((l) => l.lane === 'windows')?.present).toBe(true);
    expect(catalog.lanes.find((l) => l.lane === 'macos-x86_64')?.present).toBe(false);
    expect(catalog.lanes).toHaveLength(6);
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(/virus-free/i);
    expect(json).not.toMatch(/"signed":\s*true/);

    const withMac = buildDownloadCatalog({
      version: '0.1.3',
      artifacts: [
        {
          lane: 'macos-x86_64',
          archive: 'onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg',
          sha256: 'm.sha256',
          notice: 'm.NOTICE.txt',
          hash: 'bb'.repeat(32),
          bytes: 200,
        },
      ],
    });
    expect(withMac.claim.macosAvailable).toBe(true);
    expect(withMac.claim.notarization).toBe(false);
    expect(withMac.lanes.find((l) => l.lane === 'macos-x86_64')?.archiveExt).toBe('dmg');
    expect(withMac.lanes.find((l) => l.lane === 'macos-arm64')?.present).toBe(false);
  });
});

describe('stageReleaseDownloads', () => {
  it('stages all six public lanes + catalog into dist/downloads/v0.1.3', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-rel-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>t</title>\n');
      const win = writeReleaseArtifacts(root, 'windows', 'windows-bytes');
      const lin = writeReleaseArtifacts(root, 'linux', 'linux-bytes');
      const macIntel = writeReleaseArtifacts(root, 'macos-x86_64', 'macos-intel-bytes');
      const macArm = writeReleaseArtifacts(root, 'macos-arm64', 'macos-arm-bytes');
      const fb = writeReleaseArtifacts(root, 'freebsd', 'freebsd-bytes');
      const ob = writeReleaseArtifacts(root, 'openbsd', 'openbsd-bytes');

      const result = stageReleaseDownloads({
        repoRoot: root,
        require: true,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { stageDir } = resolveDownloadStagePaths(root, RELEASE_PRODUCT_VERSION);
      expect(result.stageDir).toBe(stageDir);
      expect(readFileSync(join(stageDir, win.base + '.sha256'), 'utf8')).toMatch(win.hash);
      expect(readFileSync(join(stageDir, lin.base + '.sha256'), 'utf8')).toMatch(lin.hash);
      expect(readFileSync(join(stageDir, macIntel.base + '.sha256'), 'utf8')).toMatch(macIntel.hash);
      expect(readFileSync(join(stageDir, macArm.base + '.sha256'), 'utf8')).toMatch(macArm.hash);
      expect(readFileSync(join(stageDir, fb.base + '.sha256'), 'utf8')).toMatch(fb.hash);
      expect(readFileSync(join(stageDir, ob.base + '.sha256'), 'utf8')).toMatch(ob.hash);
      expect(macIntel.base).toBe('onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned');
      expect(macArm.base).toBe('onyx-0.1.3-macos-arm64-ReleaseFast-unsigned');
      const catalog = JSON.parse(readFileSync(join(stageDir, 'catalog.json'), 'utf8'));
      expect(catalog.version).toBe('0.1.3');
      expect(catalog.lanes).toHaveLength(6);
      expect(catalog.lanes.every((l) => l.present)).toBe(true);
      expect(catalog.lanes.find((l) => l.lane === 'windows')?.archiveExt).toBe('zip');
      expect(catalog.lanes.find((l) => l.lane === 'macos-x86_64')?.archiveExt).toBe('dmg');
      expect(catalog.lanes.find((l) => l.lane === 'macos-arm64')?.archive).toBe(
        'onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg',
      );
      expect(catalog.claim.macosAvailable).toBe(true);
      expect(catalog.claim.notarization).toBe(false);
      expect(catalog.publicPrefix).toBe('/downloads/v0.1.3');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed in publish/require mode when a macOS arch lane is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-rel-req-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      writeReleaseArtifacts(root, 'windows');
      writeReleaseArtifacts(root, 'linux');
      writeReleaseArtifacts(root, 'macos-x86_64');
      // macos-arm64 intentionally missing
      writeReleaseArtifacts(root, 'freebsd');
      writeReleaseArtifacts(root, 'openbsd');
      const chunks = [];
      const result = stageReleaseDownloads({
        repoRoot: root,
        require: true,
        stdout: { write: () => {} },
        stderr: { write: (s) => chunks.push(String(s)) },
      });
      expect(result.ok).toBe(false);
      expect(chunks.join('')).toMatch(/macos-arm64|missing/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when an archive does not match its checksum sidecar', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-rel-hash-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const win = writeReleaseArtifacts(root, 'windows');
      writeReleaseArtifacts(root, 'linux');
      writeReleaseArtifacts(root, 'macos-x86_64');
      writeReleaseArtifacts(root, 'macos-arm64');
      writeReleaseArtifacts(root, 'freebsd');
      writeReleaseArtifacts(root, 'openbsd');
      writeFileSync(
        win.archivePath,
        Buffer.concat([Buffer.from([0x50, 0x4b]), Buffer.from('tampered-after-sidecar'.padEnd(80, 'x'))]),
      );
      const chunks = [];
      const result = stageReleaseDownloads({
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
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-rel-opt-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const result = stageReleaseDownloads({
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

  it('accepts each macOS arch lane when Darwin-built artifacts are present', () => {
    for (const lane of /** @type {const} */ (['macos-x86_64', 'macos-arm64'])) {
      const root = mkdtempSync(join(tmpdir(), `onyx-stage-rel-${lane}-`));
      try {
        writeAlignedManifests(root);
        mkdirSync(join(root, 'dist'), { recursive: true });
        writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
        writeReleaseArtifacts(root, lane, 'real-dmg-body');
        const result = stageReleaseDownloads({
          repoRoot: root,
          lanes: [lane],
          require: true,
          stdout: { write: () => {} },
          stderr: { write: () => {} },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.catalog.claim.macosAvailable).toBe(true);
        expect(result.catalog.lanes[0].archive).toBe(
          `onyx-0.1.3-${lane}-ReleaseFast-unsigned.dmg`.replace('macos-x86_64', 'macos-x86_64'),
        );
        // Exact public names
        expect(result.catalog.lanes[0].archive).toBe(
          lane === 'macos-x86_64'
            ? 'onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg'
            : 'onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg',
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('refuses unknown lanes', () => {
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-rel-bad-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const chunks = [];
      const result = stageReleaseDownloads({
        repoRoot: root,
        // @ts-expect-error intentional invalid lane
        lanes: ['solaris'],
        require: false,
        stdout: { write: () => {} },
        stderr: { write: (s) => chunks.push(String(s)) },
      });
      expect(result.ok).toBe(false);
      expect(chunks.join('')).toMatch(/solaris|refusing lane/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CLI --require fails closed; --help exits 0; legacy BSD env enables publish', () => {
    expect(runStageReleaseDownloadsCli(['--help'], { stdout: { write: () => {} } })).toBe(0);
    const root = mkdtempSync(join(tmpdir(), 'onyx-stage-rel-cli-'));
    try {
      writeAlignedManifests(root);
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/index.html'), '<html></html>\n');
      const code = runStageReleaseDownloadsCli(['--require'], {
        repoRoot: root,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(code).toBe(1);
      const codeEnv = runStageReleaseDownloadsCli([], {
        repoRoot: root,
        env: { ONYX_PUBLISH_BSD_DOWNLOADS: '1' },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(codeEnv).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
