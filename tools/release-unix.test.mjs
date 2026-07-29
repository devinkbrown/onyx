// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RELEASE_LINUX_ARCH,
  RELEASE_PRODUCT_VERSION,
  assertLinuxHost,
  assertMacosHost,
  assertVersionAlignment,
  bufferLooksLikeElf,
  createPackageTarGz,
  elfClassVerdict,
  elfMachineVerdict,
  formatSha256SumFile,
  linuxHonestyNotice,
  loadAlignedVersion,
  macosHonestyNotice,
  packageDirName,
  parseAppZonVersion,
  parsePackageJsonVersion,
  portableLocalhostLauncherScript,
  portableWebHonestyNotice,
  releaseAssetBaseName,
  resolveReleasePaths,
  runLinuxRelease,
  runMacosRelease,
  runPortableWebRelease,
  runUnixReleaseCli,
  sha256Hex,
  stagePortableWebBundle,
  validateLinuxPackageLayout,
  validateMacosPackageLayout,
  validatePortableWebLayout,
} from './release-unix.mjs';

/** Minimal ELF64 LE x86_64 header (enough for magic/class/machine probes). */
function syntheticElf64X86_64() {
  const buf = Buffer.alloc(64, 0);
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB
  buf[6] = 1; // EV_CURRENT
  buf.writeUInt16LE(62, 18); // EM_X86_64
  return buf;
}

function syntheticElf64Aarch64() {
  const buf = syntheticElf64X86_64();
  buf.writeUInt16LE(183, 18); // EM_AARCH64
  return buf;
}

function writeAlignedRepo(dir) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.1.2' }));
  writeFileSync(join(dir, 'app.zon'), '.{ .version = "0.1.2" }\n');
  writeFileSync(join(dir, 'build.zig.zon'), '.{ .version = "0.1.2" }\n');
}

describe('release-unix version + naming', () => {
  it('parses versions and names one asset per platform lane', () => {
    expect(parsePackageJsonVersion('{"version":"0.1.2"}')).toBe('0.1.2');
    expect(parseAppZonVersion('.version = "0.1.2"')).toBe('0.1.2');
    expect(RELEASE_PRODUCT_VERSION).toBe('0.1.2');
    expect(RELEASE_LINUX_ARCH).toBe('x86_64');

    expect(packageDirName('linux')).toBe('onyx-0.1.2-linux-ReleaseFast');
    expect(packageDirName('macos')).toBe('onyx-0.1.2-macos-ReleaseFast.app');
    expect(releaseAssetBaseName('linux')).toBe(
      'onyx-0.1.2-linux-x86_64-ReleaseFast-unsigned',
    );
    expect(releaseAssetBaseName('freebsd')).toBe('onyx-0.1.2-freebsd-portable-web-unsigned');
    expect(releaseAssetBaseName('openbsd')).toBe('onyx-0.1.2-openbsd-portable-web-unsigned');
    expect(releaseAssetBaseName('macos')).toBe('onyx-0.1.2-macos-ReleaseFast-unsigned');

    const linux = resolveReleasePaths('linux', '/repo', '0.1.2');
    expect(linux.packageDir).toBe('/repo/zig-out/package/onyx-0.1.2-linux-ReleaseFast');
    expect(linux.archivePath).toMatch(/linux-x86_64\/onyx-0\.1\.2-linux-x86_64-ReleaseFast-unsigned\.tar\.gz$/);

    const fbsd = resolveReleasePaths('freebsd', '/repo', '0.1.2');
    expect(fbsd.archivePath).toMatch(/freebsd-portable-web\/onyx-0\.1\.2-freebsd-portable-web-unsigned\.tar\.gz$/);

    const mac = resolveReleasePaths('macos', '/repo', '0.1.2');
    expect(mac.archivePath).toMatch(/macos\/onyx-0\.1\.2-macos-ReleaseFast-unsigned\.dmg$/);
  });

  it('rejects version drift', () => {
    const bad = assertVersionAlignment({
      packageJson: '{"version":"0.1.0"}',
      appZon: '.version = "0.1.2"',
      buildZigZon: '.version = "0.1.2"',
    });
    expect(bad.ok).toBe(false);
  });
});

describe('release-unix ELF probes', () => {
  it('accepts ELF64 x86_64 and rejects other machines', () => {
    const ok = syntheticElf64X86_64();
    expect(bufferLooksLikeElf(ok)).toBe(true);
    expect(elfClassVerdict(ok)).toBe(64);
    expect(elfMachineVerdict(ok)).toBe('x86_64');
    expect(elfMachineVerdict(syntheticElf64Aarch64())).toBe('other');
    expect(bufferLooksLikeElf(Buffer.from('MZ'))).toBe(false);
    expect(elfMachineVerdict(Buffer.from('not elf'))).toBe('unknown');
  });
});

describe('release-unix host gates', () => {
  it('allows linux package only on linux; macos only on darwin', () => {
    expect(assertLinuxHost('linux').ok).toBe(true);
    expect(assertLinuxHost('darwin').ok).toBe(false);
    expect(assertMacosHost('darwin').ok).toBe(true);
    const refused = assertMacosHost('linux');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatch(/refuse to build or fabricate/i);
      expect(refused.error).toMatch(/real Mac/i);
    }
  });
});

describe('release-unix linux layout validation', () => {
  it('fails closed on missing paths and wrong arch; accepts ELF64 x86_64 + manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-lin-'));
    try {
      expect(validateLinuxPackageLayout(join(dir, 'nope')).ok).toBe(false);

      mkdirSync(join(dir, 'bin'), { recursive: true });
      mkdirSync(join(dir, 'resources/dist'), { recursive: true });
      writeFileSync(join(dir, 'bin/onyx'), syntheticElf64Aarch64());
      writeFileSync(join(dir, 'README.txt'), 'Linux native-sdk artifact directory.\n');
      writeFileSync(join(dir, 'package-manifest.zon'), '.{}\n');
      writeFileSync(join(dir, 'resources/dist/index.html'), '<html></html>\n');

      const badArch = validateLinuxPackageLayout(dir);
      expect(badArch.ok).toBe(false);
      if (!badArch.ok) expect(badArch.errors.join(' ')).toMatch(/machine/);

      writeFileSync(join(dir, 'bin/onyx'), syntheticElf64X86_64());
      writeFileSync(
        join(dir, 'package-manifest.zon'),
        [
          '.{',
          '  .target = "linux",',
          '  .version = "0.1.2",',
          '  .optimize = "ReleaseFast",',
          '  .signing = "none",',
          '}',
        ].join('\n'),
      );
      expect(validateLinuxPackageLayout(dir)).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release-unix portable web layout', () => {
  it('labels FreeBSD/OpenBSD as non-native and binds 127.0.0.1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-port-'));
    try {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><title>o</title>\n');
      stagePortableWebBundle('freebsd', join(dir, 'stage'), join(dir, 'dist'), {
        version: '0.1.2',
        host: 'linux/x64',
      });
      const ok = validatePortableWebLayout(join(dir, 'stage'), 'freebsd');
      expect(ok).toEqual({ ok: true });

      const notice = portableWebHonestyNotice('openbsd');
      expect(notice).toMatch(/NOT a native desktop host/i);
      expect(notice).toMatch(/no FreeBSD\/OpenBSD backend/i);
      expect(notice).toMatch(/architecture-neutral/i);

      const launcher = portableLocalhostLauncherScript({ osLabel: 'FreeBSD' });
      expect(launcher).toMatch(/127\.0\.0\.1/);
      expect(launcher).toMatch(/never 0\.0\.0\.0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects native binaries smuggled into portable staging', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-smuggle-'));
    try {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      mkdirSync(join(dir, 'bin'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<html></html>\n');
      writeFileSync(join(dir, 'bin/onyx'), syntheticElf64X86_64());
      writeFileSync(join(dir, 'launch-localhost.sh'), '#!/bin/sh\n# never 0.0.0.0\nbind 127.0.0.1\n');
      writeFileSync(
        join(dir, 'PORTABLE-WEB-NOT-NATIVE.txt'),
        'NOT a native desktop host. Native SDK has no FreeBSD/OpenBSD backend.\n',
      );
      writeFileSync(join(dir, 'README.txt'), 'x\n');
      const bad = validatePortableWebLayout(dir, 'freebsd');
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/native binary/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release-unix honesty + checksum helpers', () => {
  it('keeps linux/macos honesty claims fail-closed and formats sums', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(formatSha256SumFile([{ path: 'a.tar.gz', hash: 'dead' }])).toBe('dead  a.tar.gz\n');
    const l = linuxHonestyNotice({ version: '0.1.2', host: 'linux/x64' });
    expect(l).toMatch(/WebKitGTK 6/i);
    expect(l).toMatch(/NOT an AppImage/i);
    expect(l).toMatch(/no BSD backend/i);
    const m = macosHonestyNotice({ host: 'darwin/arm64' });
    expect(m).toMatch(/NOT notarized/i);
    expect(m).toMatch(/NOT fabricated on Linux/i);
  });
});

describe('release-unix tar.gz + pipelines (fixture)', () => {
  it('creates gzip tar and portable freebsd release from dist fixture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-tar-'));
    try {
      writeAlignedRepo(dir);
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><title>t</title>\n');
      writeFileSync(join(dir, 'dist/app.js'), 'console.log(1)\n');

      const stage = join(dir, 'stage');
      stagePortableWebBundle('openbsd', stage, join(dir, 'dist'));
      const tarPath = join(dir, 'out.tar.gz');
      const z = createPackageTarGz(stage, tarPath, 'onyx-0.1.2-openbsd-portable-web-unsigned');
      expect(z.ok).toBe(true);
      const magic = readFileSync(tarPath).subarray(0, 2);
      expect(magic[0]).toBe(0x1f);
      expect(magic[1]).toBe(0x8b);

      const result = await runPortableWebRelease('freebsd', {
        repoRoot: dir,
        distDir: join(dir, 'dist'),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.paths.archivePath).toMatch(/freebsd-portable-web-unsigned\.tar\.gz$/);
        expect(readFileSync(result.paths.noticePath, 'utf8')).toMatch(/NOT a native desktop host/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runLinuxRelease validates fixture without zig when skipPackageBuild', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-linux-'));
    try {
      writeAlignedRepo(dir);
      const pkg = join(dir, 'zig-out/package/onyx-0.1.2-linux-ReleaseFast');
      mkdirSync(join(pkg, 'bin'), { recursive: true });
      mkdirSync(join(pkg, 'resources/dist'), { recursive: true });
      writeFileSync(join(pkg, 'bin/onyx'), syntheticElf64X86_64());
      writeFileSync(join(pkg, 'README.txt'), 'Linux native-sdk artifact directory.\n');
      writeFileSync(
        join(pkg, 'package-manifest.zon'),
        '.{ .target = "linux", .version = "0.1.2", .optimize = "ReleaseFast", .signing = "none" }\n',
      );
      writeFileSync(join(pkg, 'resources/dist/index.html'), '<html></html>\n');

      const zigCalls = [];
      const result = await runLinuxRelease({
        repoRoot: dir,
        skipPackageBuild: true,
        packageDir: pkg,
        platform: 'linux',
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
        expect(readFileSync(result.paths.archivePath).subarray(0, 2)).toEqual(
          Buffer.from([0x1f, 0x8b]),
        );
        expect(readFileSync(result.paths.noticePath, 'utf8')).toMatch(/WebKitGTK 6/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runLinuxRelease fails closed when zig package exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-lfail-'));
    try {
      writeAlignedRepo(dir);
      const chunks = [];
      const result = await runLinuxRelease({
        repoRoot: dir,
        skipPackageBuild: false,
        platform: 'linux',
        runZig: async () => 9,
        stdout: { write: () => {} },
        stderr: { write: (s) => chunks.push(String(s)) },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(9);
      expect(chunks.join('')).toMatch(/failed with exit 9/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runMacosRelease fails closed on linux without fabricating a DMG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-mac-'));
    try {
      writeAlignedRepo(dir);
      let zigCalls = 0;
      const result = await runMacosRelease({
        repoRoot: dir,
        platform: 'linux',
        runZig: async () => {
          zigCalls += 1;
          return 0;
        },
        createDmg: () => {
          throw new Error('must not fabricate DMG on linux');
        },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(false);
      expect(zigCalls).toBe(0);
      if (!result.ok) expect(result.errors.join(' ')).toMatch(/refuse to build or fabricate/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runMacosRelease packages fixture on darwin with injected createDmg', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-macok-'));
    try {
      writeAlignedRepo(dir);
      const pkg = join(dir, 'zig-out/package/onyx-0.1.2-macos-ReleaseFast.app');
      mkdirSync(join(pkg, 'Contents/MacOS'), { recursive: true });
      mkdirSync(join(pkg, 'Contents/Resources/dist'), { recursive: true });
      writeFileSync(join(pkg, 'Contents/MacOS/onyx'), 'fake-macho\n');
      writeFileSync(join(pkg, 'Contents/Info.plist'), '<plist></plist>\n');
      writeFileSync(
        join(pkg, 'Contents/Resources/package-manifest.zon'),
        '.{ .target = "macos", .version = "0.1.2", .optimize = "ReleaseFast", .signing = "none" }\n',
      );
      writeFileSync(join(pkg, 'Contents/Resources/dist/index.html'), '<html></html>\n');

      expect(validateMacosPackageLayout(pkg)).toEqual({ ok: true });

      const result = await runMacosRelease({
        repoRoot: dir,
        skipPackageBuild: true,
        packageDir: pkg,
        platform: 'darwin',
        createDmg: (appDir, dmgPath) => {
          writeFileSync(dmgPath, Buffer.alloc(128, 0));
          return { ok: true, dmgPath };
        },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.paths.archivePath).toMatch(/\.dmg$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI dispatches lanes and rejects unknown lane', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-cli-'));
    try {
      writeAlignedRepo(dir);
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<html></html>\n');

      const portable = await runUnixReleaseCli(['openbsd'], {
        repoRoot: dir,
        platform: 'linux',
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(portable.ok).toBe(true);

      const bad = await runUnixReleaseCli(['solaris'], {
        repoRoot: dir,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.code).toBe(2);

      const macOnLinux = await runUnixReleaseCli(['macos'], {
        repoRoot: dir,
        platform: 'linux',
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(macOnLinux.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
