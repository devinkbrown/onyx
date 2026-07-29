// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BSD_PT_INTERP,
  RELEASE_BSD_ARCH,
  RELEASE_LINUX_ARCH,
  RELEASE_PRODUCT_VERSION,
  assertLinuxHost,
  assertMacosHost,
  assertVersionAlignment,
  bsdHonestyNotice,
  bsdLaunchContractText,
  bsdPackageManifest,
  bufferLooksLikeElf,
  createPackageTarGz,
  elfClassVerdict,
  elfMachineVerdict,
  elfOsAbiVerdict,
  elfPtInterp,
  formatSha256SumFile,
  linuxHonestyNotice,
  loadAlignedVersion,
  macosHonestyNotice,
  packageDirName,
  parseAppZonVersion,
  parsePackageJsonVersion,
  releaseAssetBaseName,
  resolveReleasePaths,
  runBsdRelease,
  runLinuxRelease,
  runMacosRelease,
  runUnixReleaseCli,
  sha256Hex,
  stageBsdPackage,
  validateBsdPackageLayout,
  validateLinuxPackageLayout,
  validateMacosPackageLayout,
} from './release-unix.mjs';

/**
 * Minimal ELF64 LE x86_64 with optional PT_INTERP for OS identity tests.
 * @param {{ machine?: number, interp?: string }} [opts]
 */
function syntheticElf64X86_64(opts = {}) {
  const machine = opts.machine ?? 62;
  const interp = opts.interp ?? null;
  const interpBytes = interp ? Buffer.from(interp + '\0', 'utf8') : null;

  // Layout: ehdr (64) + optional phdr (56) + optional interp
  const ehdrSize = 64;
  const phdrSize = 56;
  const phoff = interp ? ehdrSize : 0;
  const interpOff = interp ? ehdrSize + phdrSize : 0;
  const total = interp ? interpOff + interpBytes.length : ehdrSize;
  const buf = Buffer.alloc(Math.max(total, 64), 0);

  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB
  buf[6] = 1; // EV_CURRENT
  buf.writeUInt16LE(2, 16); // ET_EXEC
  buf.writeUInt16LE(machine, 18); // e_machine
  buf.writeUInt32LE(1, 20); // e_version
  buf.writeUInt16LE(64, 52); // e_ehsize
  if (interp) {
    buf.writeBigUInt64LE(BigInt(phoff), 32); // e_phoff
    buf.writeUInt16LE(phdrSize, 54); // e_phentsize
    buf.writeUInt16LE(1, 56); // e_phnum
    // Phdr PT_INTERP
    buf.writeUInt32LE(3, phoff); // p_type = PT_INTERP
    buf.writeUInt32LE(4, phoff + 4); // p_flags = R
    buf.writeBigUInt64LE(BigInt(interpOff), phoff + 8); // p_offset
    buf.writeBigUInt64LE(BigInt(interpBytes.length), phoff + 32); // p_filesz
    buf.writeBigUInt64LE(BigInt(interpBytes.length), phoff + 40); // p_memsz
    interpBytes.copy(buf, interpOff);
  }
  return buf;
}

function syntheticElf64Aarch64() {
  return syntheticElf64X86_64({ machine: 183 });
}

function writeAlignedRepo(dir) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.1.3' }));
  writeFileSync(join(dir, 'app.zon'), '.{ .version = "0.1.3" }\n');
  writeFileSync(join(dir, 'build.zig.zon'), '.{ .version = "0.1.3" }\n');
}

describe('release-unix version + naming', () => {
  it('parses versions and names one native asset per platform lane', () => {
    expect(parsePackageJsonVersion('{"version":"0.1.3"}')).toBe('0.1.3');
    expect(parseAppZonVersion('.version = "0.1.3"')).toBe('0.1.3');
    expect(RELEASE_PRODUCT_VERSION).toBe('0.1.3');
    expect(RELEASE_LINUX_ARCH).toBe('x86_64');
    expect(RELEASE_BSD_ARCH).toBe('x86_64');

    expect(packageDirName('linux')).toBe('onyx-0.1.3-linux-ReleaseFast');
    expect(packageDirName('macos')).toBe('onyx-0.1.3-macos-ReleaseFast.app');
    expect(packageDirName('freebsd')).toBe('onyx-0.1.3-freebsd-x86_64-ReleaseFast');
    expect(packageDirName('openbsd')).toBe('onyx-0.1.3-openbsd-x86_64-ReleaseFast');
    expect(releaseAssetBaseName('linux')).toBe(
      'onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned',
    );
    expect(releaseAssetBaseName('freebsd')).toBe(
      'onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned',
    );
    expect(releaseAssetBaseName('openbsd')).toBe(
      'onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned',
    );
    expect(releaseAssetBaseName('macos')).toBe('onyx-0.1.3-macos-ReleaseFast-unsigned');
    // No portable-web asset names.
    expect(releaseAssetBaseName('freebsd')).not.toMatch(/portable-web/);
    expect(releaseAssetBaseName('openbsd')).not.toMatch(/portable/);

    const linux = resolveReleasePaths('linux', '/repo', '0.1.3');
    expect(linux.packageDir).toBe('/repo/zig-out/package/onyx-0.1.3-linux-ReleaseFast');
    expect(linux.archivePath).toMatch(/linux-x86_64\/onyx-0\.1\.3-linux-x86_64-ReleaseFast-unsigned\.tar\.gz$/);

    const fbsd = resolveReleasePaths('freebsd', '/repo', '0.1.3');
    expect(fbsd.packageDir).toBe('/repo/zig-out/package/onyx-0.1.3-freebsd-x86_64-ReleaseFast');
    expect(fbsd.archivePath).toMatch(
      /freebsd-x86_64\/onyx-0\.1\.3-freebsd-x86_64-ReleaseFast-unsigned\.tar\.gz$/,
    );
    expect(fbsd.hostBinPath).toBe('/repo/zig-out/bsd/freebsd-x86_64/onyx');
    expect(fbsd.archivePath).not.toMatch(/portable-web/);

    const mac = resolveReleasePaths('macos', '/repo', '0.1.3');
    expect(mac.archivePath).toMatch(/macos\/onyx-0\.1\.3-macos-ReleaseFast-unsigned\.dmg$/);
  });

  it('rejects version drift', () => {
    const bad = assertVersionAlignment({
      packageJson: '{"version":"0.1.0"}',
      appZon: '.version = "0.1.3"',
      buildZigZon: '.version = "0.1.3"',
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

  it('classifies FreeBSD/OpenBSD via PT_INTERP', () => {
    const fbsd = syntheticElf64X86_64({ interp: BSD_PT_INTERP.freebsd });
    const obsd = syntheticElf64X86_64({ interp: BSD_PT_INTERP.openbsd });
    const linux = syntheticElf64X86_64({ interp: '/lib64/ld-linux-x86-64.so.2' });

    expect(elfPtInterp(fbsd)).toBe(BSD_PT_INTERP.freebsd);
    expect(elfPtInterp(obsd)).toBe(BSD_PT_INTERP.openbsd);
    expect(elfOsAbiVerdict(fbsd)).toBe('freebsd');
    expect(elfOsAbiVerdict(obsd)).toBe('openbsd');
    expect(elfOsAbiVerdict(linux)).toBe('linux');
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
          '  .version = "0.1.3",',
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

describe('release-unix native BSD layout', () => {
  it('accepts FreeBSD ELF + resources/dist launch contract; rejects wrong OS and portable-web markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-bsd-'));
    try {
      mkdirSync(join(dir, 'bin'), { recursive: true });
      mkdirSync(join(dir, 'resources/dist'), { recursive: true });
      writeFileSync(
        join(dir, 'bin/onyx'),
        syntheticElf64X86_64({ interp: BSD_PT_INTERP.freebsd }),
      );
      writeFileSync(join(dir, 'resources/dist/index.html'), '<!doctype html><title>o</title>\n');
      writeFileSync(join(dir, 'package-manifest.zon'), bsdPackageManifest('freebsd'));
      writeFileSync(join(dir, 'README.txt'), bsdHonestyNotice('freebsd', { host: 'linux/x64' }));
      writeFileSync(join(dir, 'LAUNCH.txt'), bsdLaunchContractText('freebsd'));

      expect(validateBsdPackageLayout(dir, 'freebsd')).toEqual({ ok: true });

      // Wrong OS identity (OpenBSD interp claimed as FreeBSD).
      writeFileSync(
        join(dir, 'bin/onyx'),
        syntheticElf64X86_64({ interp: BSD_PT_INTERP.openbsd }),
      );
      const wrongOs = validateBsdPackageLayout(dir, 'freebsd');
      expect(wrongOs.ok).toBe(false);
      if (!wrongOs.ok) expect(wrongOs.errors.join(' ')).toMatch(/openbsd|PT_INTERP|OS ABI/i);

      // Restore FreeBSD binary then smuggle portable-web marker.
      writeFileSync(
        join(dir, 'bin/onyx'),
        syntheticElf64X86_64({ interp: BSD_PT_INTERP.freebsd }),
      );
      writeFileSync(join(dir, 'PORTABLE-WEB-NOT-NATIVE.txt'), 'nope\n');
      const portable = validateBsdPackageLayout(dir, 'freebsd');
      expect(portable.ok).toBe(false);
      if (!portable.ok) expect(portable.errors.join(' ')).toMatch(/portable-web/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing webkit dependency messaging gaps and wrong machine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-bsd2-'));
    try {
      mkdirSync(join(dir, 'bin'), { recursive: true });
      mkdirSync(join(dir, 'resources/dist'), { recursive: true });
      writeFileSync(join(dir, 'bin/onyx'), syntheticElf64Aarch64());
      writeFileSync(join(dir, 'resources/dist/index.html'), '<html></html>\n');
      writeFileSync(join(dir, 'package-manifest.zon'), bsdPackageManifest('openbsd'));
      writeFileSync(join(dir, 'README.txt'), 'OpenBSD host without dep notes\n');
      const bad = validateBsdPackageLayout(dir, 'openbsd');
      expect(bad.ok).toBe(false);
      if (!bad.ok) {
        const joined = bad.errors.join(' ');
        expect(joined).toMatch(/machine/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stages package from host binary + dist with fail-closed contract files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-stage-'));
    try {
      const bin = join(dir, 'host-onyx');
      const dist = join(dir, 'dist');
      const pkg = join(dir, 'package');
      mkdirSync(dist, { recursive: true });
      writeFileSync(bin, syntheticElf64X86_64({ interp: BSD_PT_INTERP.openbsd }));
      writeFileSync(join(dist, 'index.html'), '<html>spa</html>\n');
      const staged = stageBsdPackage('openbsd', pkg, bin, dist, {
        version: '0.1.3',
        host: 'linux/x64',
      });
      expect(staged).toEqual({ ok: true });
      expect(validateBsdPackageLayout(pkg, 'openbsd')).toEqual({ ok: true });
      const launch = readFileSync(join(pkg, 'LAUNCH.txt'), 'utf8');
      expect(launch).toMatch(/resources\/dist/);
      expect(launch).toMatch(/No portable-web/);
      expect(launch).toMatch(/127\.0\.0\.1:42691/);
      expect(launch).toMatch(/never ephemeral/);
      expect(launch).toMatch(/No alternate port/);
      expect(readFileSync(join(pkg, 'README.txt'), 'utf8')).not.toMatch(/portable-web\/PWA bundle/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release-unix honesty + checksum helpers', () => {
  it('keeps linux/macos/bsd honesty claims fail-closed and formats sums', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(formatSha256SumFile([{ path: 'a.tar.gz', hash: 'dead' }])).toBe('dead  a.tar.gz\n');
    const l = linuxHonestyNotice({ version: '0.1.3', host: 'linux/x64' });
    expect(l).toMatch(/WebKitGTK 6/i);
    expect(l).toMatch(/NOT an AppImage/i);
    const m = macosHonestyNotice({ host: 'darwin/arm64' });
    expect(m).toMatch(/NOT notarized/i);
    expect(m).toMatch(/NOT fabricated on Linux/i);
    const b = bsdHonestyNotice('freebsd', { host: 'linux/x64' });
    expect(b).toMatch(/Zig-native/i);
    expect(b).toMatch(/does NOT claim GUI launch/i);
    expect(b).not.toMatch(/portable web\/pwa/i);
    expect(b).toMatch(/WebKitGTK/i);
    expect(b).toMatch(/webkit2-gtk_60/);
    expect(b).toMatch(/webkit2-gtk_41/);
    const o = bsdHonestyNotice('openbsd', { host: 'linux/x64' });
    expect(o).toMatch(/webkitgtk60/);
    expect(o).toMatch(/webkitgtk4/);
    expect(o).toMatch(/gtk\+4/);
    expect(bsdLaunchContractText('freebsd')).toMatch(/127\.0\.0\.1:42691\/app/);
    expect(bsdPackageManifest('freebsd')).toMatch(/host = "bsd_host"/);
  });
});

describe('release-unix tar.gz + pipelines (fixture)', () => {
  it('creates gzip tar and native freebsd release from fixture binary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-tar-'));
    try {
      writeAlignedRepo(dir);
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><title>t</title>\n');
      writeFileSync(join(dir, 'dist/app.js'), 'console.log(1)\n');

      const hostDir = join(dir, 'zig-out/bsd/freebsd-x86_64');
      mkdirSync(hostDir, { recursive: true });
      writeFileSync(
        join(hostDir, 'onyx'),
        syntheticElf64X86_64({ interp: BSD_PT_INTERP.freebsd }),
      );

      const zigCalls = [];
      const result = await runBsdRelease('freebsd', {
        repoRoot: dir,
        distDir: join(dir, 'dist'),
        skipHostBuild: true,
        hostBinPath: join(hostDir, 'onyx'),
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
        expect(result.paths.archivePath).toMatch(/freebsd-x86_64-ReleaseFast-unsigned\.tar\.gz$/);
        expect(result.paths.archivePath).not.toMatch(/portable-web/);
        expect(readFileSync(result.paths.noticePath, 'utf8')).toMatch(/Zig-native/i);
        expect(readFileSync(result.paths.noticePath, 'utf8')).toMatch(/does NOT claim GUI launch/i);
        const magic = readFileSync(result.paths.archivePath).subarray(0, 2);
        expect(magic[0]).toBe(0x1f);
        expect(magic[1]).toBe(0x8b);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runBsdRelease fails closed when zig bsd-host exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-bfail-'));
    try {
      writeAlignedRepo(dir);
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<html></html>\n');
      const chunks = [];
      const result = await runBsdRelease('openbsd', {
        repoRoot: dir,
        skipHostBuild: false,
        platform: 'linux',
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

  it('runLinuxRelease validates fixture without zig when skipPackageBuild', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-linux-'));
    try {
      writeAlignedRepo(dir);
      const pkg = join(dir, 'zig-out/package/onyx-0.1.3-linux-ReleaseFast');
      mkdirSync(join(pkg, 'bin'), { recursive: true });
      mkdirSync(join(pkg, 'resources/dist'), { recursive: true });
      writeFileSync(join(pkg, 'bin/onyx'), syntheticElf64X86_64());
      writeFileSync(join(pkg, 'README.txt'), 'Linux native-sdk artifact directory.\n');
      writeFileSync(
        join(pkg, 'package-manifest.zon'),
        '.{ .target = "linux", .version = "0.1.3", .optimize = "ReleaseFast", .signing = "none" }\n',
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
      const pkg = join(dir, 'zig-out/package/onyx-0.1.3-macos-ReleaseFast.app');
      mkdirSync(join(pkg, 'Contents/MacOS'), { recursive: true });
      mkdirSync(join(pkg, 'Contents/Resources/dist'), { recursive: true });
      writeFileSync(join(pkg, 'Contents/MacOS/onyx'), 'fake-macho\n');
      writeFileSync(join(pkg, 'Contents/Info.plist'), '<plist></plist>\n');
      writeFileSync(
        join(pkg, 'Contents/Resources/package-manifest.zon'),
        '.{ .target = "macos", .version = "0.1.3", .optimize = "ReleaseFast", .signing = "none" }\n',
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

  it('CLI dispatches BSD native lanes and rejects unknown lane', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onyx-ux-cli-'));
    try {
      writeAlignedRepo(dir);
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist/index.html'), '<html></html>\n');
      const hostDir = join(dir, 'zig-out/bsd/openbsd-x86_64');
      mkdirSync(hostDir, { recursive: true });
      writeFileSync(
        join(hostDir, 'onyx'),
        syntheticElf64X86_64({ interp: BSD_PT_INTERP.openbsd }),
      );

      const bsd = await runUnixReleaseCli(['openbsd', '--skip-host-build'], {
        repoRoot: dir,
        platform: 'linux',
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      expect(bsd.ok).toBe(true);
      if (bsd.ok) {
        expect(bsd.paths.archivePath).not.toMatch(/portable-web/);
      }

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
