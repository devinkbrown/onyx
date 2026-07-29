// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RELEASE_PRODUCT_VERSION,
  assertVersionAlignment,
  bufferLooksLikePe,
  createPackageZip,
  formatSha256SumFile,
  honestyNotice,
  packageDirName,
  parseAppZonVersion,
  parseBuildZigZonVersion,
  parsePackageJsonVersion,
  peMachineVerdict,
  peSubsystemVerdict,
  releaseZipBaseName,
  resolveReleasePaths,
  runWindowsRelease,
  sha256Hex,
  validateWindowsPackageLayout,
  writeZipChecksum,
} from './release-windows.mjs';

/** Minimal PE32+ with optional header subsystem at known offset. */
function syntheticPe({ subsystem }) {
  // MZ + e_lfanew@0x3c → 0x80, PE signature, COFF, optional PE32+ magic 0x20b, subsystem @ opt+68
  const buf = Buffer.alloc(0x80 + 24 + 112, 0);
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  buf.writeUInt32LE(0x80, 0x3c);
  buf[0x80] = 0x50;
  buf[0x81] = 0x45;
  buf.writeUInt16LE(0x8664, 0x84); // IMAGE_FILE_MACHINE_AMD64
  // COFF: Machine etc. — optional header starts at 0x80+24 = 0x98
  const opt = 0x80 + 24;
  buf.writeUInt16LE(0x20b, opt); // PE32+
  buf.writeUInt16LE(subsystem, opt + 68);
  return buf;
}

describe('release-windows version alignment', () => {
  it('parses versions from package.json / app.zon / build.zig.zon forms', () => {
    expect(parsePackageJsonVersion('{"version":"0.1.2"}')).toBe('0.1.2');
    expect(parseAppZonVersion('.version = "0.1.2",\n')).toBe('0.1.2');
    expect(parseBuildZigZonVersion('.version = "0.1.2",')).toBe('0.1.2');
    expect(parsePackageJsonVersion('not-json')).toBeNull();
    expect(parseAppZonVersion('nope')).toBeNull();
  });

  it('accepts aligned 0.1.2 and rejects drift', () => {
    const good = assertVersionAlignment({
      packageJson: '{"version":"0.1.2"}',
      appZon: '.version = "0.1.2"',
      buildZigZon: '.version = "0.1.2"',
    });
    expect(good).toEqual({ ok: true, version: '0.1.2' });
    expect(RELEASE_PRODUCT_VERSION).toBe('0.1.2');

    const bad = assertVersionAlignment({
      packageJson: '{"version":"0.1.0"}',
      appZon: '.version = "0.1.2"',
      buildZigZon: '.version = "0.1.2"',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/package\.json/);
  });
});

describe('release-windows naming', () => {
  it('matches build.zig package dir and release zip basenames', () => {
    expect(packageDirName()).toBe('onyx-0.1.2-windows-ReleaseFast');
    expect(releaseZipBaseName()).toBe('onyx-0.1.2-windows-x86_64-ReleaseFast-unsigned');
    const paths = resolveReleasePaths('/repo', '0.1.2');
    expect(paths.packageDir).toBe('/repo/zig-out/package/onyx-0.1.2-windows-ReleaseFast');
    expect(paths.zipPath).toMatch(/onyx-0\.1\.2-windows-x86_64-ReleaseFast-unsigned\.zip$/);
  });
});

describe('release-windows PE probes', () => {
  it('detects PE and GUI vs console subsystem', () => {
    const gui = syntheticPe({ subsystem: 2 });
    const con = syntheticPe({ subsystem: 3 });
    expect(bufferLooksLikePe(gui)).toBe(true);
    expect(peMachineVerdict(gui)).toBe('x86_64');
    expect(peSubsystemVerdict(gui)).toBe('gui');
    expect(peSubsystemVerdict(con)).toBe('console');
    expect(bufferLooksLikePe(Buffer.from('not pe'))).toBe(false);
    expect(peSubsystemVerdict(Buffer.from('not pe'))).toBe('unknown');
  });
});

describe('release-windows layout validation', () => {
  it('fails closed on missing paths and console subsystem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-rel-'));
    try {
      const missing = validateWindowsPackageLayout(join(dir, 'nope'));
      expect(missing.ok).toBe(false);

      mkdirSync(join(dir, 'bin'), { recursive: true });
      mkdirSync(join(dir, 'resources'), { recursive: true });
      writeFileSync(join(dir, 'bin/onyx.exe'), syntheticPe({ subsystem: 3 }));
      writeFileSync(join(dir, 'bin/WebView2Loader.dll'), syntheticPe({ subsystem: 2 }));
      writeFileSync(join(dir, 'README.txt'), 'x\n');
      writeFileSync(join(dir, 'package-manifest.zon'), '.{}\n');
      mkdirSync(join(dir, 'resources/dist'), { recursive: true });
      writeFileSync(join(dir, 'resources/dist/index.html'), '<html></html>\n');

      const consolePkg = validateWindowsPackageLayout(dir);
      expect(consolePkg.ok).toBe(false);
      if (!consolePkg.ok) expect(consolePkg.errors.join(' ')).toMatch(/subsystem/);

      writeFileSync(join(dir, 'bin/onyx.exe'), syntheticPe({ subsystem: 2 }));
      writeFileSync(
        join(dir, 'package-manifest.zon'),
        [
          '.{',
          '  .target = "windows",',
          '  .version = "0.1.2",',
          '  .optimize = "ReleaseFast",',
          '  .signing = "none",',
          '  .subsystem = "gui",',
          '}',
        ].join('\n'),
      );
      const ok = validateWindowsPackageLayout(dir);
      expect(ok).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release-windows checksum + honesty', () => {
  it('formats sha256sum lines and honesty claims', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(formatSha256SumFile([{ path: 'a.zip', hash: 'dead' }])).toBe('dead  a.zip\n');
    const n = honestyNotice({ version: '0.1.2', host: 'linux/x64' });
    expect(n).toMatch(/NOT verified on a real Windows/i);
    expect(n).toMatch(/macOS and Linux desktop builds are NOT released/i);
    expect(n).toMatch(/UNSIGNED/i);
    expect(n).not.toMatch(/signed installer ready/i);
  });
});

describe('release-windows zip + pipeline (fixture)', () => {
  it('zips a fixture package and writes checksums fail-closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-zip-'));
    try {
      mkdirSync(join(dir, 'pkg/bin'), { recursive: true });
      mkdirSync(join(dir, 'pkg/resources'), { recursive: true });
      writeFileSync(join(dir, 'pkg/bin/onyx.exe'), syntheticPe({ subsystem: 2 }));
      writeFileSync(join(dir, 'pkg/bin/WebView2Loader.dll'), syntheticPe({ subsystem: 2 }));
      writeFileSync(join(dir, 'pkg/README.txt'), 'Windows native-sdk artifact directory.\n');
      writeFileSync(
        join(dir, 'pkg/package-manifest.zon'),
        '.{ .target = "windows", .version = "0.1.2", .optimize = "ReleaseFast", .signing = "none", .subsystem = "gui" }\n',
      );
      mkdirSync(join(dir, 'pkg/resources/dist'), { recursive: true });
      writeFileSync(join(dir, 'pkg/resources/dist/index.html'), '<!doctype html><title>t</title>\n');

      const zipPath = join(dir, 'out.zip');
      const z = createPackageZip(join(dir, 'pkg'), zipPath, {
        injectFiles: { 'UNSIGNED-WINDOWS.txt': honestyNotice() },
      });
      expect(z.ok).toBe(true);
      const magic = readFileSync(zipPath).subarray(0, 2);
      expect(magic[0]).toBe(0x50);
      expect(magic[1]).toBe(0x4b);

      const sumsPath = join(dir, 'out.sha256');
      const sum = writeZipChecksum(zipPath, sumsPath, 'out.zip');
      expect(sum.ok).toBe(true);
      const sums = readFileSync(sumsPath, 'utf8');
      expect(sums).toMatch(/^[0-9a-f]{64}  out\.zip\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runWindowsRelease skips zig when --skip-package-build and validates fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-run-'));
    try {
      // Minimal repo-shaped tree for version + dist preflight
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.1.2' }));
      writeFileSync(join(dir, 'app.zon'), '.{ .version = "0.1.2" }\n');
      writeFileSync(join(dir, 'build.zig.zon'), '.{ .version = "0.1.2" }\n');
      mkdirSync(join(dir, 'dist'), { recursive: true });

      const pkg = join(dir, 'zig-out/package/onyx-0.1.2-windows-ReleaseFast');
      mkdirSync(join(pkg, 'bin'), { recursive: true });
      mkdirSync(join(pkg, 'resources'), { recursive: true });
      writeFileSync(join(pkg, 'bin/onyx.exe'), syntheticPe({ subsystem: 2 }));
      writeFileSync(join(pkg, 'bin/WebView2Loader.dll'), syntheticPe({ subsystem: 2 }));
      writeFileSync(join(pkg, 'README.txt'), 'x\n');
      writeFileSync(
        join(pkg, 'package-manifest.zon'),
        '.{ .target = "windows", .version = "0.1.2", .optimize = "ReleaseFast", .signing = "none", .subsystem = "gui" }\n',
      );
      mkdirSync(join(pkg, 'resources/dist'), { recursive: true });
      writeFileSync(join(pkg, 'resources/dist/index.html'), '<html></html>\n');

      const zigCalls = [];
      const result = await runWindowsRelease({
        repoRoot: dir,
        skipPackageBuild: true,
        packageDir: pkg,
        runZig: async (args) => {
          zigCalls.push(args);
          return 0;
        },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      expect(zigCalls).toEqual([]);
      if (result.ok) {
        expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(readFileSync(result.paths.sumsPath, 'utf8')).toMatch(result.hash);
        expect(readFileSync(result.paths.noticePath, 'utf8')).toMatch(/NOT verified/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runWindowsRelease fails closed when zig package exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-fail-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.1.2' }));
      writeFileSync(join(dir, 'app.zon'), '.{ .version = "0.1.2" }\n');
      writeFileSync(join(dir, 'build.zig.zon'), '.{ .version = "0.1.2" }\n');
      const chunks = [];
      const result = await runWindowsRelease({
        repoRoot: dir,
        skipPackageBuild: false,
        runZig: async () => 7,
        stdout: { write: () => {} },
        stderr: { write: (s) => chunks.push(String(s)) },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(7);
      expect(chunks.join('')).toMatch(/failed with exit 7/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
