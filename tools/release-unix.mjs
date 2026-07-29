// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Onyx client v0.1.3 — Unix release packaging (Linux + native BSD + macOS).
 *
 * Lanes (one downloadable asset per platform / arch):
 *  1. linux   — Native SDK system-WebView directory package → tar.gz (x86_64 ELF)
 *  2. freebsd — Zig-native desktop host (desktop/bsd_host.zig) x86_64-freebsd → tar.gz
 *  3. openbsd — Zig-native desktop host (desktop/bsd_host.zig) x86_64-openbsd → tar.gz
 *  4. macos   — Native SDK .app + DMG; runs ONLY on Darwin (fail-closed elsewhere).
 *               Architecture is host-derived from process.arch (x64→x86_64, arm64→arm64);
 *               produces arch-distinct filenames under zig-out/release/macos-{x86_64,arm64}/.
 *
 * Honesty:
 *  - FreeBSD/OpenBSD are real Zig-native GTK/WebKitGTK hosts (dlopen at runtime).
 *  - Cross-build on Linux produces correct ELF + package layout; it does NOT
 *    claim GUI launch was verified on FreeBSD/OpenBSD from this host.
 *  - macOS is never fabricated on Linux; requires a real Mac + Apple tooling.
 *  - macOS arch cannot be overridden to lie about the host in production CLI.
 *  - Artifacts are UNSIGNED (no codesign/notarize/AppImage/Flatpak store claims).
 *  - No portable-web / PWA lane names for BSD.
 *
 * Does not download toolchains, commit, push, tag, deploy, or publish.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runDesktopZig } from './desktop-zig.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Product version for this release lane (must match manifests). */
export const RELEASE_PRODUCT_VERSION = '0.1.3';

/** Package optimize name Native SDK / build.zig use in artifact paths. */
export const RELEASE_OPTIMIZE = 'ReleaseFast';

/** Linux release arch claim (host native package). */
export const RELEASE_LINUX_ARCH = 'x86_64';

/** BSD native host arch (cross-compiled x86_64). */
export const RELEASE_BSD_ARCH = 'x86_64';

/**
 * Supported macOS public release arches (genuine host builds only).
 * @type {readonly ['x86_64', 'arm64']}
 */
export const RELEASE_MACOS_ARCHS = /** @type {const} */ (['x86_64', 'arm64']);

/** ELF e_machine for EM_X86_64. */
export const ELF_EM_X86_64 = 62;

/** PT_INTERP program header type. */
export const ELF_PT_INTERP = 3;

/** Native BSD lanes (Zig host, not Native SDK). */
export const BSD_OS = /** @type {const} */ (['freebsd', 'openbsd']);

/** Expected dynamic linker path in PT_INTERP for each BSD OS. */
export const BSD_PT_INTERP = /** @type {const} */ ({
  freebsd: '/libexec/ld-elf.so.1',
  openbsd: '/usr/libexec/ld.so',
});

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parseAppZonVersion(text) {
  const m = String(text ?? '').match(/\.version\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * @param {string} text package.json contents
 * @returns {string | null}
 */
export function parsePackageJsonVersion(text) {
  try {
    const j = JSON.parse(String(text ?? ''));
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

/**
 * build.zig.zon uses the same `.version = "…"` form as app.zon.
 * @param {string} text
 * @returns {string | null}
 */
export function parseBuildZigZonVersion(text) {
  return parseAppZonVersion(text);
}

/**
 * Fail-closed version alignment across release-owned manifests.
 * @param {{ packageJson: string, appZon: string, buildZigZon: string, expected?: string }} input
 * @returns {{ ok: true, version: string } | { ok: false, errors: string[] }}
 */
export function assertVersionAlignment(input) {
  const expected = input.expected ?? RELEASE_PRODUCT_VERSION;
  const errors = [];
  const pkg = parsePackageJsonVersion(input.packageJson);
  const app = parseAppZonVersion(input.appZon);
  const zig = parseBuildZigZonVersion(input.buildZigZon);
  if (pkg !== expected) errors.push(`package.json version ${JSON.stringify(pkg)} != ${expected}`);
  if (app !== expected) errors.push(`app.zon version ${JSON.stringify(app)} != ${expected}`);
  if (zig !== expected) errors.push(`build.zig.zon version ${JSON.stringify(zig)} != ${expected}`);
  if (pkg && app && zig && (pkg !== app || app !== zig)) {
    errors.push(`version mismatch across manifests: package.json=${pkg} app.zon=${app} build.zig.zon=${zig}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, version: expected };
}

/**
 * Load and align versions from the repo.
 * @param {string} [repoRoot]
 */
export function loadAlignedVersion(repoRoot = REPO_ROOT) {
  return assertVersionAlignment({
    packageJson: readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    appZon: readFileSync(join(repoRoot, 'app.zon'), 'utf8'),
    buildZigZon: readFileSync(join(repoRoot, 'build.zig.zon'), 'utf8'),
  });
}

/**
 * Map Node process.arch → macOS public release arch token.
 * @param {string} [nodeArch] process.arch (x64 | arm64 | …)
 * @returns {'x86_64' | 'arm64' | null}
 */
export function mapNodeArchToMacosArch(nodeArch = process.arch) {
  if (nodeArch === 'x64') return 'x86_64';
  if (nodeArch === 'arm64') return 'arm64';
  return null;
}

/**
 * Normalize a macOS arch token (public lane or Node arch).
 * @param {string | undefined | null} arch
 * @returns {'x86_64' | 'arm64' | null}
 */
export function normalizeMacosArch(arch) {
  if (arch === 'x86_64' || arch === 'arm64') return arch;
  if (arch === 'x64') return 'x86_64';
  if (arch === 'aarch64') return 'arm64';
  return null;
}

/**
 * Directory name produced by build.zig package step / Native SDK artifactName / BSD stage.
 * @param {'linux' | 'macos' | 'freebsd' | 'openbsd'} target
 * @param {string} [version]
 * @param {string} [optimize]
 * @returns {string}
 */
export function packageDirName(target, version = RELEASE_PRODUCT_VERSION, optimize = RELEASE_OPTIMIZE) {
  if (target === 'macos') return `onyx-${version}-macos-${optimize}.app`;
  if (target === 'freebsd' || target === 'openbsd') {
    return `onyx-${version}-${target}-${RELEASE_BSD_ARCH}-${optimize}`;
  }
  return `onyx-${version}-${target}-${optimize}`;
}

/**
 * Single downloadable asset basename (no extension) per platform lane.
 * macOS requires an arch token (x86_64 | arm64) — never omits arch in public names.
 * @param {'linux' | 'macos' | 'freebsd' | 'openbsd'} lane
 * @param {string} [version]
 * @param {string} [optimize]
 * @param {'x86_64' | 'arm64' | string} [arch] required for macos
 * @returns {string}
 */
export function releaseAssetBaseName(
  lane,
  version = RELEASE_PRODUCT_VERSION,
  optimize = RELEASE_OPTIMIZE,
  arch,
) {
  if (lane === 'linux') {
    return `onyx-${version}-linux-${RELEASE_LINUX_ARCH}-${optimize}-unsigned`;
  }
  if (lane === 'macos') {
    const macArch = normalizeMacosArch(arch);
    if (!macArch) {
      throw new Error(
        `releaseAssetBaseName(macos): arch must be x86_64|arm64 (got ${JSON.stringify(arch)})`,
      );
    }
    return `onyx-${version}-macos-${macArch}-${optimize}-unsigned`;
  }
  // Native BSD Zig host (x86_64 FreeBSD / OpenBSD).
  return `onyx-${version}-${lane}-${RELEASE_BSD_ARCH}-${optimize}-unsigned`;
}

/**
 * @param {'linux' | 'macos' | 'freebsd' | 'openbsd'} lane
 * @param {string} [repoRoot]
 * @param {string} [version]
 * @param {'x86_64' | 'arm64' | string} [arch] required for macos (public dir + filename)
 */
export function resolveReleasePaths(
  lane,
  repoRoot = REPO_ROOT,
  version = RELEASE_PRODUCT_VERSION,
  arch,
) {
  if (lane === 'linux') {
    const assetBase = releaseAssetBaseName(lane, version);
    const dirName = packageDirName('linux', version);
    const packageDir = join(repoRoot, 'zig-out', 'package', dirName);
    const releaseDir = join(repoRoot, 'zig-out', 'release', 'linux-x86_64');
    return {
      packageDir,
      releaseDir,
      archivePath: join(releaseDir, `${assetBase}.tar.gz`),
      sumsPath: join(releaseDir, `${assetBase}.sha256`),
      noticePath: join(releaseDir, `${assetBase}.NOTICE.txt`),
      assetBase,
    };
  }
  if (lane === 'macos') {
    const macArch = normalizeMacosArch(arch) ?? mapNodeArchToMacosArch(process.arch);
    if (!macArch) {
      throw new Error(
        `resolveReleasePaths(macos): arch must be x86_64|arm64 (got ${JSON.stringify(arch)}; process.arch=${process.arch})`,
      );
    }
    const assetBase = releaseAssetBaseName('macos', version, RELEASE_OPTIMIZE, macArch);
    const dirName = packageDirName('macos', version);
    const packageDir = join(repoRoot, 'zig-out', 'package', dirName);
    const releaseDir = join(repoRoot, 'zig-out', 'release', `macos-${macArch}`);
    return {
      packageDir,
      releaseDir,
      archivePath: join(releaseDir, `${assetBase}.dmg`),
      sumsPath: join(releaseDir, `${assetBase}.sha256`),
      noticePath: join(releaseDir, `${assetBase}.NOTICE.txt`),
      assetBase,
      arch: macArch,
    };
  }
  // freebsd / openbsd native host package
  const assetBase = releaseAssetBaseName(lane, version);
  const dirName = packageDirName(lane, version);
  const packageDir = join(repoRoot, 'zig-out', 'package', dirName);
  const releaseDir = join(repoRoot, 'zig-out', 'release', `${lane}-${RELEASE_BSD_ARCH}`);
  const hostBinDir = join(repoRoot, 'zig-out', 'bsd', `${lane}-x86_64`);
  return {
    packageDir,
    releaseDir,
    archivePath: join(releaseDir, `${assetBase}.tar.gz`),
    sumsPath: join(releaseDir, `${assetBase}.sha256`),
    noticePath: join(releaseDir, `${assetBase}.NOTICE.txt`),
    assetBase,
    hostBinDir,
    hostBinPath: join(hostBinDir, 'onyx'),
  };
}

/**
 * @param {Buffer | string} data
 * @returns {string} lowercase hex sha256
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * GNU coreutils-style `sha256sum` lines (hash + two spaces + path).
 * @param {{ path: string, hash: string }[]} entries
 * @returns {string}
 */
export function formatSha256SumFile(entries) {
  return entries.map((e) => `${e.hash}  ${e.path}`).join('\n') + (entries.length ? '\n' : '');
}

/**
 * @param {string} archivePath
 * @param {string} sumsPath
 * @param {string} [displayName]
 * @returns {{ ok: true, hash: string } | { ok: false, error: string }}
 */
export function writeArchiveChecksum(archivePath, sumsPath, displayName) {
  if (!existsSync(archivePath)) return { ok: false, error: `archive missing for checksum: ${archivePath}` };
  const hash = sha256Hex(readFileSync(archivePath));
  const name = displayName ?? archivePath.split(/[/\\]/).pop() ?? 'artifact';
  mkdirSync(dirname(sumsPath), { recursive: true });
  writeFileSync(sumsPath, formatSha256SumFile([{ path: name, hash }]), 'utf8');
  return { ok: true, hash };
}

/**
 * ELF magic EI_MAG0..3 = 0x7f 'E' 'L' 'F'.
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function bufferLooksLikeElf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20) return false;
  return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
}

/**
 * ELF class: 1 = 32-bit, 2 = 64-bit (EI_CLASS at offset 4).
 * @param {Buffer} buf
 * @returns {32 | 64 | 'unknown'}
 */
export function elfClassVerdict(buf) {
  if (!bufferLooksLikeElf(buf)) return 'unknown';
  const c = buf[4];
  if (c === 1) return 32;
  if (c === 2) return 64;
  return 'unknown';
}

/**
 * e_machine at offset 18 (little-endian hosts). EM_X86_64 = 62.
 * @param {Buffer} buf
 * @returns {'x86_64' | 'other' | 'unknown'}
 */
export function elfMachineVerdict(buf) {
  if (!bufferLooksLikeElf(buf) || buf.length < 20) return 'unknown';
  // EI_DATA: 1 = little, 2 = big
  const data = buf[5];
  if (data !== 1 && data !== 2) return 'unknown';
  const machine = data === 1 ? buf.readUInt16LE(18) : buf.readUInt16BE(18);
  return machine === ELF_EM_X86_64 ? 'x86_64' : 'other';
}

/**
 * Read PT_INTERP dynamic linker path from an ELF64 image.
 * Zig sets EI_OSABI=SYSV for FreeBSD/OpenBSD; PT_INTERP distinguishes them.
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function elfPtInterp(buf) {
  if (!bufferLooksLikeElf(buf) || buf.length < 64) return null;
  const ei_class = buf[4];
  const ei_data = buf[5];
  if (ei_class !== 2) return null; // ELF64 only
  const le = ei_data === 1;
  const readU16 = (off) => (le ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
  const readU32 = (off) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
  const readU64 = (off) => {
    // Node Buffer may lack readBigUInt64 on very old runtimes; use two u32 LE/BE.
    if (typeof buf.readBigUInt64LE === 'function') {
      return Number(le ? buf.readBigUInt64LE(off) : buf.readBigUInt64BE(off));
    }
    const lo = le ? buf.readUInt32LE(off) : buf.readUInt32BE(off + 4);
    const hi = le ? buf.readUInt32LE(off + 4) : buf.readUInt32BE(off);
    return hi * 0x100000000 + lo;
  };
  const e_phoff = readU64(32);
  const e_phentsize = readU16(54);
  const e_phnum = readU16(56);
  if (!e_phoff || !e_phentsize || !e_phnum) return null;
  for (let i = 0; i < e_phnum; i += 1) {
    const off = e_phoff + i * e_phentsize;
    if (off + e_phentsize > buf.length) break;
    const p_type = readU32(off);
    if (p_type !== ELF_PT_INTERP) continue;
    // ELF64 Phdr: p_offset at +8, p_filesz at +32
    const p_offset = readU64(off + 8);
    const p_filesz = readU64(off + 32);
    if (p_offset + p_filesz > buf.length || p_filesz === 0) return null;
    const slice = buf.subarray(p_offset, p_offset + p_filesz);
    const z = slice.indexOf(0);
    return slice.subarray(0, z === -1 ? slice.length : z).toString('utf8');
  }
  return null;
}

/**
 * Classify ELF OS using PT_INTERP (and optional FreeBSD/OpenBSD note strings).
 * @param {Buffer} buf
 * @returns {'freebsd' | 'openbsd' | 'linux' | 'other' | 'unknown'}
 */
export function elfOsAbiVerdict(buf) {
  if (!bufferLooksLikeElf(buf)) return 'unknown';
  const interp = elfPtInterp(buf);
  if (interp === BSD_PT_INTERP.freebsd) return 'freebsd';
  if (interp === BSD_PT_INTERP.openbsd) return 'openbsd';
  if (interp && /ld-linux|ld-musl|\/lib64\/ld-/.test(interp)) return 'linux';
  // Secondary string markers from Zig's OS notes
  const text = buf.subarray(0, Math.min(buf.length, 512 * 1024)).toString('binary');
  if (text.includes('FreeBSD') && !text.includes('OpenBSD')) return 'freebsd';
  if (text.includes('OpenBSD') && !text.includes('FreeBSD')) return 'openbsd';
  if (interp) return 'other';
  return 'unknown';
}

/**
 * Honesty notice for Linux native package.
 * @param {{ version?: string, host?: string }} [opts]
 * @returns {string}
 */
export function linuxHonestyNotice(opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  return [
    `Onyx desktop ${version} — Linux ${RELEASE_LINUX_ARCH} UNSIGNED Native SDK package`,
    '',
    'What this is:',
    '  - Native SDK system-WebView directory package (bin/onyx + SPA resources)',
    '  - Linked against system WebKitGTK 6 / GTK 4 (not Chromium/CEF)',
    '  - Single tar.gz asset — NOT an AppImage/Flatpak/deb/rpm, NOT signed,',
    '    NO auto-updater, NO public download channel claim.',
    '',
    'What this is NOT / not claimed:',
    '  - Not a portable static binary; needs WebKitGTK 6.0 + GTK 4 on the target.',
    '  - FreeBSD/OpenBSD use a separate Zig-native host lane (not this Linux artifact).',
    '  - macOS is released only on a real Mac (separate lane); not this artifact.',
    '  - Cross-build host was: ' + host,
    '',
    'Requirements on a Linux x86_64 machine:',
    '  - webkitgtk-6.0 and gtk4 (pkg-config names)',
    '  - extract and run bin/onyx from the package tree',
    '',
    'Reproduce:',
    '  pnpm install',
    '  pnpm build',
    '  pnpm desktop:release:linux',
    '  # requires Zig pin from .zigversion (ONYX_ZIG or PATH); see docs/desktop-host.md',
    '',
  ].join('\n');
}

/**
 * Primary runtime packages install.sh installs automatically (GTK4 + WebKitGTK 6).
 * Secondary GTK3 pairs remain runtime-compatible in the host but are not auto-installed.
 * @type {Readonly<{ freebsd: readonly string[], openbsd: readonly string[] }>}
 */
export const BSD_PRIMARY_RUNTIME_PACKAGES = Object.freeze({
  freebsd: Object.freeze(['gtk4', 'webkit2-gtk_60']),
  openbsd: Object.freeze(['gtk+4', 'webkitgtk60']),
});

/**
 * Generate a fail-closed, idempotent install.sh for a native BSD package root.
 * Never curl-pipes or downloads code; only native package managers for deps.
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ version?: string }} [opts]
 * @returns {string}
 */
export function generateBsdInstallSh(os, opts = {}) {
  if (os !== 'freebsd' && os !== 'openbsd') {
    throw new Error(`generateBsdInstallSh: os must be freebsd|openbsd, got ${os}`);
  }
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const osLabel = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';
  const uname = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';
  const pkgs = BSD_PRIMARY_RUNTIME_PACKAGES[os];
  const pkgList = pkgs.join(' ');
  const depInstall =
    os === 'freebsd'
      ? [
          '  if command -v pkg >/dev/null 2>&1; then',
          `    run_cmd pkg install -y ${pkgList}`,
          '  else',
          '    die "pkg(8) not found; install FreeBSD pkg and retry, or install deps manually"',
          '  fi',
        ].join('\n')
      : [
          '  if command -v pkg_add >/dev/null 2>&1; then',
          `    run_cmd pkg_add ${pkgList}`,
          '  else',
          '    die "pkg_add not found; install OpenBSD packages tools and retry, or install deps manually"',
          '  fi',
        ].join('\n');

  return [
    '#!/bin/sh',
    `# Onyx ${version} — ${osLabel} ${RELEASE_BSD_ARCH} native host installer`,
    '# Fail-closed. Idempotent. No remote-shell pipe install, no remote code download.',
    '# Root/network is required ONLY when automatic system dependency install runs.',
    'set -eu',
    '',
    `EXPECTED_OS="${uname}"`,
    `PRODUCT_VERSION="${version}"`,
    `DEFAULT_PREFIX="/usr/local"`,
    `RUNTIME_PACKAGES="${pkgList}"`,
    'PREFIX="$DEFAULT_PREFIX"',
    'DRY_RUN=0',
    'INSTALL_DEPS=1',
    '',
    'usage() {',
    '  cat <<EOF',
    `Usage: ./install.sh [options]`,
    '',
    `Install Onyx ${version} native ${osLabel} host (bin/ + resources/) into PREFIX.`,
    '',
    'Options:',
    '  --prefix DIR   Install root (default: /usr/local). Safe for non-root test trees.',
    '  --no-deps      Skip automatic system package install of GTK4+WebKitGTK runtime.',
    '  --dry-run      Print actions without changing the system or PREFIX.',
    '  -h, --help     Show this help and exit.',
    '',
    'Behavior:',
    `  - Detects exact OS via uname -s (must be ${uname}).`,
    `  - Optionally installs primary runtime packages: ${pkgList}`,
    '  - Copies bin/onyx and resources/ under PREFIX (layout: PREFIX/bin, PREFIX/resources).',
    '  - Idempotent: re-running overwrites the same paths safely.',
    '',
    'Privilege / network:',
    '  - Root (or sufficient privileges) and network are needed ONLY for automatic',
    '    system dependency install via the native package manager.',
    '  - With --prefix under a user-writable directory and --no-deps, no root is required.',
    '',
    'This script never downloads Onyx code from the network and never pipes a remote shell.',
    'Artifact is UNSIGNED (no codesign/notarize claim).',
    'EOF',
    '}',
    '',
    'die() {',
    '  printf \'error: %s\\n\' "$*" >&2',
    '  exit 1',
    '}',
    '',
    'log() {',
    '  printf \'%s\\n\' "$*"',
    '}',
    '',
    'run_cmd() {',
    '  if [ "$DRY_RUN" -eq 1 ]; then',
    '    printf \'[dry-run]\'',
    '    printf \' %s\' "$@"',
    '    printf \'\\n\'',
    '    return 0',
    '  fi',
    '  "$@"',
    '}',
    '',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --prefix)',
    '      [ "$#" -ge 2 ] || die "--prefix requires a directory argument"',
    '      PREFIX="$2"',
    '      shift 2',
    '      ;;',
    '    --prefix=*)',
    '      PREFIX="${1#--prefix=}"',
    '      shift',
    '      ;;',
    '    --no-deps)',
    '      INSTALL_DEPS=0',
    '      shift',
    '      ;;',
    '    --dry-run)',
    '      DRY_RUN=1',
    '      shift',
    '      ;;',
    '    -h|--help)',
    '      usage',
    '      exit 0',
    '      ;;',
    '    --)',
    '      shift',
    '      break',
    '      ;;',
    '    -*)',
    '      die "unknown option: $1 (try --help)"',
    '      ;;',
    '    *)',
    '      die "unexpected argument: $1 (try --help)"',
    '      ;;',
    '  esac',
    'done',
    '',
    '[ "$#" -eq 0 ] || die "unexpected arguments: $* (try --help)"',
    '',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'SRC_BIN="$SCRIPT_DIR/bin/onyx"',
    'SRC_RES="$SCRIPT_DIR/resources"',
    '',
    'case "$PREFIX" in',
    '  "" ) die "--prefix must not be empty" ;;',
    '  "/" ) die "--prefix must not be the filesystem root" ;;',
    '  /* ) ;;',
    '  * ) die "--prefix must be an absolute path (got: $PREFIX)" ;;',
    'esac',
    'case "/$PREFIX/" in',
    '  */../*|*/./* ) die "--prefix must not contain dot path segments (got: $PREFIX)" ;;',
    'esac',
    '',
    'OS_NAME=$(uname -s 2>/dev/null || true)',
    '[ "$OS_NAME" = "$EXPECTED_OS" ] || die "this installer is for $EXPECTED_OS only (uname -s reported: ${OS_NAME:-unknown})"',
    '',
    'ARCH_NAME=$(uname -m 2>/dev/null || true)',
    'case "$ARCH_NAME" in',
    '  amd64|x86_64) ;;',
    '  *) die "this package is for x86_64/amd64 only (uname -m reported: ${ARCH_NAME:-unknown})" ;;',
    'esac',
    '',
    '[ -f "$SRC_BIN" ] || die "missing package binary: $SRC_BIN (extract the full tarball first)"',
    '[ -f "$SRC_RES/dist/index.html" ] || die "missing SPA resources: $SRC_RES/dist/index.html"',
    '',
    'if [ "$INSTALL_DEPS" -eq 1 ]; then',
    '  log "installing primary runtime packages (may need root + network): $RUNTIME_PACKAGES"',
    depInstall,
    'else',
    '  log "skipping system dependency install (--no-deps); ensure $RUNTIME_PACKAGES are present"',
    'fi',
    '',
    'DEST_BIN_DIR="$PREFIX/bin"',
    'DEST_RES_DIR="$PREFIX/resources"',
    '',
    'log "installing Onyx $PRODUCT_VERSION -> $PREFIX"',
    'run_cmd mkdir -p "$DEST_BIN_DIR"',
    'run_cmd mkdir -p "$DEST_RES_DIR"',
    'run_cmd cp -f "$SRC_BIN" "$DEST_BIN_DIR/onyx"',
    'if [ "$DRY_RUN" -eq 0 ]; then',
    '  chmod 755 "$DEST_BIN_DIR/onyx" || die "chmod failed on $DEST_BIN_DIR/onyx"',
    'else',
    '  log "[dry-run] chmod 755 $DEST_BIN_DIR/onyx"',
    'fi',
    '',
    '# Idempotent resources tree: remove previous tree then copy fresh.',
    'if [ "$DRY_RUN" -eq 1 ]; then',
    '  log "[dry-run] rm -rf $DEST_RES_DIR/dist"',
    '  log "[dry-run] cp -R $SRC_RES/dist $DEST_RES_DIR/dist"',
    'else',
    '  rm -rf "$DEST_RES_DIR/dist"',
    '  cp -R "$SRC_RES/dist" "$DEST_RES_DIR/dist" || die "failed to copy resources/dist"',
    'fi',
    '',
    'log "installed: $DEST_BIN_DIR/onyx"',
    'log "installed: $DEST_RES_DIR/dist (SPA assets)"',
    'log "launch (graphical session): $DEST_BIN_DIR/onyx"',
    'log "note: package is UNSIGNED; install.sh never claims codesign, notarization, or virus-free status"',
    '',
  ].join('\n');
}

/**
 * Honesty notice for native FreeBSD/OpenBSD Zig desktop host packages.
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ version?: string, host?: string }} [opts]
 * @returns {string}
 */
export function bsdHonestyNotice(os, opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  const osLabel = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';
  const triple = os === 'freebsd' ? 'x86_64-freebsd' : 'x86_64-openbsd';
  const primary = BSD_PRIMARY_RUNTIME_PACKAGES[os].join(' ');
  const pkgHint =
    os === 'freebsd'
      ? `install.sh → pkg install ${primary}  (host also accepts gtk3+webkit2-gtk_41 pair at runtime)`
      : `install.sh → pkg_add ${primary}  (host also accepts gtk+3+webkitgtk4 pair at runtime)`;
  return [
    `Onyx desktop ${version} — ${osLabel} ${RELEASE_BSD_ARCH} UNSIGNED native host package`,
    '',
    'What this is:',
    `  - Zig-native desktop host (desktop/bsd_host.zig) for ${triple}`,
    '  - Dynamically loads GTK + WebKitGTK at runtime (clear error if missing)',
    '  - Embeds the SolidJS SPA under resources/dist (same pnpm build dist/)',
    '  - One-install surface: ./install.sh (idempotent, fail-closed, no curl|sh)',
    '  - Single tar.gz — NOT signed, NO auto-updater, NO store installer claim',
    '',
    'What this is NOT / not claimed:',
    '  - NOT a portable-web / PWA / localhost-only bundle',
    '  - NOT the Native SDK linux/macos/windows backend',
    '  - NOT codesigned / notarized / virus-scanned / store-ready',
    '  - Cross-packaging on Linux validates ELF OS/machine + package layout only;',
    `    it does NOT claim GUI launch was executed on real ${osLabel} from this host`,
    '  - Built/packaged on host: ' + host,
    '',
    `Requirements on ${osLabel} ${RELEASE_BSD_ARCH}:`,
    `  - ${pkgHint}`,
    '  - root/network only when install.sh auto-installs system packages',
    '  - graphical session to launch bin/onyx (or PREFIX/bin/onyx after install)',
    '',
    'Install (on the target OS):',
    '  tar xzf onyx-…-unsigned.tar.gz',
    '  cd onyx-…',
    '  ./install.sh                  # default PREFIX=/usr/local',
    '  ./install.sh --prefix "$HOME/onyx-prefix" --no-deps   # non-root test tree',
    '  ./install.sh --dry-run',
    '',
    'Reproduce packaging:',
    '  pnpm install',
    '  pnpm build',
    `  pnpm desktop:release:${os}`,
    '  # requires Zig pin from .zigversion (ONYX_ZIG or PATH); see docs/desktop-host.md',
    '',
  ].join('\n');
}

/**
 * Honesty notice for macOS (only produced on Darwin).
 * @param {{ version?: string, host?: string, arch?: 'x86_64' | 'arm64' | string }} [opts]
 * @returns {string}
 */
export function macosHonestyNotice(opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  const arch =
    normalizeMacosArch(opts.arch) ?? mapNodeArchToMacosArch(process.arch) ?? 'unknown';
  const archLabel =
    arch === 'arm64' ? 'Apple Silicon arm64' : arch === 'x86_64' ? 'Intel x86_64' : arch;
  return [
    `Onyx desktop ${version} — macOS ${arch} UNSIGNED Native SDK package (DMG)`,
    '',
    'What this is:',
    `  - Native SDK system-WebView .app (WKWebView) packaged as an unsigned DMG (${archLabel})`,
    '  - Built only on a real Darwin host with matching CPU arch + Apple SDK tools (xcrun/hdiutil)',
    '  - Architecture is host-derived (process.arch); not a cross-arch fabricatable claim',
    '',
    'What this is NOT:',
    '  - NOT notarized, NOT codesigned for Gatekeeper distribution',
    '  - NOT fabricated on Linux/CI without a Mac — that path is fail-closed',
    '  - NOT a universal binary; use the matching x86_64 or arm64 download for this CPU',
    '  - NO auto-updater, NO public download channel claim',
    '',
    'Built on host: ' + host,
    'Release arch:  ' + arch,
    '',
    'Reproduce (on matching macOS only):',
    '  pnpm install && pnpm build',
    '  pnpm desktop:release:macos',
    '  # requires Zig pin from .zigversion; see docs/desktop-host.md',
    '  # Intel: GHA macos-15-intel → macos-x86_64; Apple Silicon: GHA macos-15 → macos-arm64',
    '',
  ].join('\n');
}

/**
 * Validate a Native SDK Linux desktop package directory (fail-closed).
 * @param {string} packageDir
 * @param {{ readFile?: (p: string) => Buffer, exists?: (p: string) => boolean, version?: string, optimize?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateLinuxPackageLayout(packageDir, opts = {}) {
  const read = opts.readFile ?? ((p) => readFileSync(p));
  const exists = opts.exists ?? ((p) => existsSync(p));
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const optimize = opts.optimize ?? RELEASE_OPTIMIZE;
  const errors = [];
  const root = resolve(packageDir);

  if (!exists(root)) {
    return { ok: false, errors: [`package directory missing: ${root}`] };
  }

  const required = [
    'bin/onyx',
    'README.txt',
    'package-manifest.zon',
    'resources/dist/index.html',
  ];
  for (const rel of required) {
    if (!exists(join(root, rel))) errors.push(`missing required package path: ${rel}`);
  }

  if (exists(join(root, 'bin/onyx'))) {
    let exeBuf;
    try {
      exeBuf = read(join(root, 'bin/onyx'));
    } catch (e) {
      errors.push(`cannot read bin/onyx: ${e instanceof Error ? e.message : String(e)}`);
      exeBuf = null;
    }
    if (exeBuf) {
      if (!bufferLooksLikeElf(exeBuf)) {
        errors.push('bin/onyx is not an ELF image (magic check failed)');
      } else {
        const klass = elfClassVerdict(exeBuf);
        if (klass !== 64) {
          errors.push(`bin/onyx ELF class is ${klass}, expected 64`);
        }
        const machine = elfMachineVerdict(exeBuf);
        if (machine !== RELEASE_LINUX_ARCH) {
          errors.push(`bin/onyx machine is ${machine}, expected ${RELEASE_LINUX_ARCH}`);
        }
      }
    }
  }

  const manifestPath = join(root, 'package-manifest.zon');
  if (exists(manifestPath)) {
    try {
      const manifest = read(manifestPath).toString('utf8');
      const expectedFields = [
        ['target', 'linux'],
        ['version', version],
        ['optimize', optimize],
      ];
      for (const [field, expected] of expectedFields) {
        const pattern = new RegExp(
          `\\.${field}\\s*=\\s*"${String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
        );
        if (!pattern.test(manifest)) {
          errors.push(`package-manifest.zon does not declare ${field}=${expected}`);
        }
      }
    } catch (e) {
      errors.push(
        `cannot read package-manifest.zon: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Validate native FreeBSD/OpenBSD desktop package layout (fail-closed).
 * Checks ELF machine, OS via PT_INTERP, SPA resources, and launch contract files.
 * @param {string} packageDir
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ readFile?: (p: string) => Buffer, exists?: (p: string) => boolean, version?: string, optimize?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateBsdPackageLayout(packageDir, os, opts = {}) {
  const read = opts.readFile ?? ((p) => readFileSync(p));
  const exists = opts.exists ?? ((p) => existsSync(p));
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const optimize = opts.optimize ?? RELEASE_OPTIMIZE;
  const errors = [];
  const root = resolve(packageDir);

  if (os !== 'freebsd' && os !== 'openbsd') {
    return { ok: false, errors: [`validateBsdPackageLayout: os must be freebsd|openbsd, got ${os}`] };
  }

  if (!exists(root)) {
    return { ok: false, errors: [`package directory missing: ${root}`] };
  }

  // Fail closed: portable-web layout markers must not appear in native packages.
  for (const banned of [
    'PORTABLE-WEB-NOT-NATIVE.txt',
    'launch-localhost.sh',
    'dist/index.html', // SPA must live under resources/dist for the native host contract
  ]) {
    if (exists(join(root, banned))) {
      errors.push(`native BSD package must not include portable-web path: ${banned}`);
    }
  }

  const required = [
    'bin/onyx',
    'install.sh',
    'README.txt',
    'package-manifest.zon',
    'resources/dist/index.html',
  ];
  for (const rel of required) {
    if (!exists(join(root, rel))) errors.push(`missing required package path: ${rel}`);
  }

  if (exists(join(root, 'bin/onyx'))) {
    let exeBuf;
    try {
      exeBuf = read(join(root, 'bin/onyx'));
    } catch (e) {
      errors.push(`cannot read bin/onyx: ${e instanceof Error ? e.message : String(e)}`);
      exeBuf = null;
    }
    if (exeBuf) {
      if (!bufferLooksLikeElf(exeBuf)) {
        errors.push('bin/onyx is not an ELF image (magic check failed)');
      } else {
        const klass = elfClassVerdict(exeBuf);
        if (klass !== 64) {
          errors.push(`bin/onyx ELF class is ${klass}, expected 64`);
        }
        const machine = elfMachineVerdict(exeBuf);
        if (machine !== RELEASE_BSD_ARCH) {
          errors.push(`bin/onyx machine is ${machine}, expected ${RELEASE_BSD_ARCH}`);
        }
        const elfOs = elfOsAbiVerdict(exeBuf);
        if (elfOs !== os) {
          errors.push(
            `bin/onyx ELF OS ABI/identity is ${elfOs}, expected ${os} (PT_INTERP ${BSD_PT_INTERP[os]})`,
          );
        }
        const interp = elfPtInterp(exeBuf);
        if (interp && interp !== BSD_PT_INTERP[os]) {
          errors.push(`bin/onyx PT_INTERP is ${interp}, expected ${BSD_PT_INTERP[os]}`);
        }
      }
    }
  }

  if (exists(join(root, 'install.sh'))) {
    try {
      const installer = String(read(join(root, 'install.sh')));
      const installCheck = validateBsdInstallShContent(installer, os, { version });
      if (!installCheck.ok) {
        for (const e of installCheck.errors) errors.push(`install.sh: ${e}`);
      }
    } catch (e) {
      errors.push(`cannot read install.sh: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const manifestPath = join(root, 'package-manifest.zon');
  if (exists(manifestPath)) {
    try {
      const manifest = read(manifestPath).toString('utf8');
      for (const [field, expected] of [
        ['target', os],
        ['version', version],
        ['optimize', optimize],
        ['arch', RELEASE_BSD_ARCH],
      ]) {
        const pattern = new RegExp(
          `\\.${field}\\s*=\\s*"${String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
        );
        if (!pattern.test(manifest)) {
          errors.push(`package-manifest.zon does not declare ${field}=${expected}`);
        }
      }
      if (!/\.host\s*=\s*"bsd_host"/.test(manifest) && !/\.host\s*=\s*"zig-bsd"/.test(manifest)) {
        errors.push('package-manifest.zon must declare host="bsd_host" (or zig-bsd)');
      }
    } catch (e) {
      errors.push(
        `cannot read package-manifest.zon: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (exists(join(root, 'README.txt'))) {
    try {
      const text = String(read(join(root, 'README.txt')));
      // Reject affirmative portable-web claims; allow explicit "NOT portable-web" honesty.
      if (
        /architecture-neutral portable/i.test(text) ||
        /\bPORTABLE WEB\b/i.test(text) ||
        (/portable-web|portable web\/pwa/i.test(text) &&
          !/NOT a portable-web|not a portable-web|NOT portable-web/i.test(text))
      ) {
        errors.push('README.txt must not claim portable-web packaging for native BSD host');
      }
      if (!new RegExp(os === 'freebsd' ? 'FreeBSD' : 'OpenBSD', 'i').test(text)) {
        errors.push('README.txt should identify the BSD OS lane');
      }
      if (!/WebKitGTK|webkit|GTK/i.test(text)) {
        errors.push('README.txt must mention GTK/WebKitGTK runtime dependencies');
      }
      if (!/does NOT claim GUI launch|does not claim GUI launch|not claim GUI/i.test(text)) {
        errors.push('README.txt must not fabricate GUI launch claims for cross-build hosts');
      }
      if (!/install\.sh/i.test(text)) {
        errors.push('README.txt must document install.sh one-install path');
      }
    } catch (e) {
      errors.push(`cannot read README.txt: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Fail-closed content checks for generated BSD install.sh (unit-testable).
 * @param {string} text
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ version?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateBsdInstallShContent(text, os, opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const errors = [];
  const body = String(text ?? '');
  if (!body.startsWith('#!/bin/sh')) errors.push('must start with #!/bin/sh');
  if (!/set -eu/.test(body)) errors.push('must enable set -eu');
  if (!/--help/.test(body) || !/--dry-run/.test(body) || !/--prefix/.test(body)) {
    errors.push('must support --help, --dry-run, and --prefix');
  }
  if (!/DEFAULT_PREFIX="\/usr\/local"/.test(body)) {
    errors.push('default prefix must be /usr/local');
  }
  if (!/--prefix must not be the filesystem root/.test(body)) {
    errors.push('must reject filesystem-root prefix');
  }
  if (!/--prefix must not contain dot path segments/.test(body)) {
    errors.push('must reject dot path segments in prefix');
  }
  const expectedOs = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';
  if (!body.includes(`EXPECTED_OS="${expectedOs}"`)) {
    errors.push(`must pin EXPECTED_OS to ${expectedOs}`);
  }
  if (!body.includes(`PRODUCT_VERSION="${version}"`)) {
    errors.push(`must pin PRODUCT_VERSION to ${version}`);
  }
  for (const pkg of BSD_PRIMARY_RUNTIME_PACKAGES[os]) {
    if (!body.includes(pkg)) errors.push(`must install primary package ${pkg}`);
  }
  // Fail closed: no secondary GTK3 auto-install as primary path confusion.
  if (os === 'freebsd' && /pkg install[^\n]*webkit2-gtk_41/.test(body)) {
    errors.push('must not auto-install secondary webkit2-gtk_41 as primary path');
  }
  if (os === 'openbsd' && /pkg_add[^\n]*webkitgtk4\b/.test(body) && !/webkitgtk60/.test(body)) {
    errors.push('must auto-install webkitgtk60 primary, not only webkitgtk4');
  }
  // Reject actual remote-fetch invocations (command position), not prose about avoiding them.
  if (
    /(^|[;&|`\n\r\t])\s*curl(\s|$)/m.test(body) ||
    /(^|[;&|`\n\r\t])\s*wget(\s|$)/m.test(body)
  ) {
    errors.push('must never download remote code (no curl/wget invocation)');
  }
  if (/(^|[;&|`\n\r\t])\s*curl\s+[^|\n]*\|/m.test(body) || /(^|[;&|`\n\r\t])\s*wget\s+[^|\n]*\|/m.test(body)) {
    errors.push('must never curl|pipe or wget|pipe');
  }
  if (!/Root \(or sufficient privileges\) and network are needed ONLY/i.test(body)) {
    errors.push('must state root/network only for automatic system dependency install');
  }
  if (!/UNSIGNED/i.test(body)) {
    errors.push('must state artifact is UNSIGNED');
  }
  if (os === 'freebsd' && !/pkg install -y/.test(body)) {
    errors.push('FreeBSD installer must use pkg install -y');
  }
  if (os === 'openbsd' && !/\bpkg_add\b/.test(body)) {
    errors.push('OpenBSD installer must use pkg_add');
  }
  if (!body.includes('DEST_BIN_DIR="$PREFIX/bin"') || !body.includes('DEST_RES_DIR="$PREFIX/resources"')) {
    errors.push('must install bin/ and resources/ under PREFIX');
  }
  if (!/cp -f "\$SRC_BIN" "\$DEST_BIN_DIR\/onyx"/.test(body)) {
    errors.push('must copy package bin/onyx into PREFIX/bin/onyx');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Package-manifest.zon body for native BSD hosts.
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ version?: string, optimize?: string }} [opts]
 */
export function bsdPackageManifest(os, opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const optimize = opts.optimize ?? RELEASE_OPTIMIZE;
  return [
    '.{',
    `  .target = "${os}",`,
    `  .arch = "${RELEASE_BSD_ARCH}",`,
    `  .version = "${version}",`,
    `  .optimize = "${optimize}",`,
    '  .host = "bsd_host",',
    '  .signing = "none",',
    '  .webview = "webkitgtk-dlopen",',
    '}',
    '',
  ].join('\n');
}

/**
 * Launch-contract helper text for operators (not a portable-web launcher).
 * @param {'freebsd' | 'openbsd'} os
 */
export function bsdLaunchContractText(os) {
  const osLabel = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';
  // Fixed product loopback port — must match desktop/bsd_host.zig product_loopback_port.
  const loopbackOrigin = 'http://127.0.0.1:42691';
  const loopbackEntry = `${loopbackOrigin}/app`;
  return [
    `Onyx native ${osLabel} launch contract`,
    '',
    'Executable: bin/onyx',
    'SPA root:   resources/dist/index.html',
    'Web engine: system WebKitGTK (dlopen) + GTK',
    `SPA origin: ${loopbackOrigin}  (fixed product port; never ephemeral)`,
    `Web entry:  ${loopbackEntry}`,
    '',
    'Fail-closed:',
    '  - Missing GTK/WebKit shared libraries → clear stderr + non-zero exit',
    '  - Missing resources/dist → clear stderr + non-zero exit',
    '  - Port 42691 already in use / second instance → clear stderr + non-zero exit',
    '  - No alternate port (localStorage/IndexedDB/session-resume origin must stay stable)',
    '  - No portable-web / localhost-PWA fallback',
    '',
    `Run on ${osLabel} ${RELEASE_BSD_ARCH} with a graphical session:`,
    '  ./bin/onyx',
    '',
  ].join('\n');
}

/**
 * Validate macOS .app package layout (only meaningful after a Darwin package build).
 * @param {string} packageDir
 * @param {{ exists?: (p: string) => boolean, readFile?: (p: string) => Buffer | string, version?: string, optimize?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateMacosPackageLayout(packageDir, opts = {}) {
  const exists = opts.exists ?? ((p) => existsSync(p));
  const read = opts.readFile ?? ((p) => readFileSync(p));
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const optimize = opts.optimize ?? RELEASE_OPTIMIZE;
  const errors = [];
  const root = resolve(packageDir);
  if (!exists(root)) return { ok: false, errors: [`package directory missing: ${root}`] };

  const required = [
    'Contents/MacOS/onyx',
    'Contents/Info.plist',
    'Contents/Resources/package-manifest.zon',
  ];
  for (const rel of required) {
    if (!exists(join(root, rel))) errors.push(`missing required macOS package path: ${rel}`);
  }

  // Prefer SPA under Contents/Resources (Native SDK macos asset path).
  const spaCandidates = [
    'Contents/Resources/dist/index.html',
    'Contents/Resources/index.html',
  ];
  if (!spaCandidates.some((rel) => exists(join(root, rel)))) {
    errors.push('missing SPA resources under Contents/Resources (dist/index.html or index.html)');
  }

  const manifestPath = join(root, 'Contents/Resources/package-manifest.zon');
  if (exists(manifestPath)) {
    try {
      const manifest = String(read(manifestPath));
      for (const [field, expected] of [
        ['target', 'macos'],
        ['version', version],
        ['optimize', optimize],
      ]) {
        const pattern = new RegExp(
          `\\.${field}\\s*=\\s*"${String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
        );
        if (!pattern.test(manifest)) {
          errors.push(`package-manifest.zon does not declare ${field}=${expected}`);
        }
      }
    } catch (e) {
      errors.push(
        `cannot read package-manifest.zon: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Create a tar.gz of directory contents with a single top-level folder name.
 * @param {string} sourceDir directory whose contents are archived
 * @param {string} tarGzPath
 * @param {string} rootName top-level folder inside the archive
 * @param {{ spawnSyncImpl?: typeof spawnSync, pythonBin?: string, injectFiles?: Record<string, string> }} [opts]
 * @returns {{ ok: true, tarGzPath: string } | { ok: false, error: string }}
 */
export function createPackageTarGz(sourceDir, tarGzPath, rootName, opts = {}) {
  const run = opts.spawnSyncImpl ?? spawnSync;
  const python = opts.pythonBin ?? 'python3';
  const inject = opts.injectFiles ?? {};

  mkdirSync(dirname(tarGzPath), { recursive: true });

  const script = `
import json, os, sys, tarfile, time
source_dir = sys.argv[1]
tar_path = sys.argv[2]
root_name = sys.argv[3]
inject = json.loads(sys.argv[4])
# deterministic-ish mtime
fixed = time.mktime((1980, 1, 1, 0, 0, 0, 0, 1, -1))
files = []
for dirpath, dirnames, filenames in os.walk(source_dir):
    dirnames.sort()
    filenames.sort()
    for name in filenames:
        full = os.path.join(dirpath, name)
        if not os.path.isfile(full):
            continue
        rel = os.path.relpath(full, source_dir).replace(os.sep, '/')
        files.append((full, root_name + '/' + rel))
files.sort(key=lambda t: t[1])
with tarfile.open(tar_path, 'w:gz') as tf:
    for full, arc in files:
        info = tf.gettarinfo(full, arcname=arc)
        info.mtime = fixed
        info.uid = 0
        info.gid = 0
        info.uname = ''
        info.gname = ''
        with open(full, 'rb') as fh:
            tf.addfile(info, fh)
    for arc_name, text in sorted(inject.items()):
        data = text.encode('utf-8')
        info = tarfile.TarInfo(name=root_name + '/' + arc_name)
        info.size = len(data)
        info.mtime = fixed
        info.mode = 0o644
        import io
        tf.addfile(info, io.BytesIO(data))
if not os.path.isfile(tar_path) or os.path.getsize(tar_path) < 32:
    sys.stderr.write('tar.gz missing or too small\\n')
    sys.exit(2)
`;

  const result = run(python, ['-c', script, sourceDir, tarGzPath, rootName, JSON.stringify(inject)], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    return { ok: false, error: `python tar.gz failed: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `python tar.gz exit ${result.status}: ${(result.stderr || result.stdout || '').trim()}`,
    };
  }
  if (!existsSync(tarGzPath) || statSync(tarGzPath).size < 32) {
    return { ok: false, error: `tar.gz not written or too small: ${tarGzPath}` };
  }
  // gzip magic 1f 8b
  const head = readFileSync(tarGzPath).subarray(0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    return { ok: false, error: `tar.gz gzip magic missing: ${tarGzPath}` };
  }
  return { ok: true, tarGzPath };
}

/**
 * Fail-closed macOS host gate: never fabricate a macOS package on non-Darwin.
 * @param {string} [platform] process.platform override
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertMacosHost(platform = process.platform) {
  if (platform === 'darwin') return { ok: true };
  return {
    ok: false,
    error:
      'release-unix macos: refuse to build or fabricate a macOS package/DMG on ' +
      platform +
      '. Run pnpm desktop:release:macos on a real Mac with Apple tools (xcrun, hdiutil). ' +
      'Native SDK macOS packaging is Darwin-only; Linux CI must not ship a fake .app/.dmg.',
  };
}

/**
 * Fail-closed Darwin + arch gate for macOS release.
 * Production derives arch from real process.arch; tests may inject platform/nodeArch.
 * @param {string} [platform]
 * @param {string} [nodeArch] process.arch (x64 | arm64)
 * @returns {{ ok: true, arch: 'x86_64' | 'arm64' } | { ok: false, error: string }}
 */
export function assertMacosHostAndArch(platform = process.platform, nodeArch = process.arch) {
  const host = assertMacosHost(platform);
  if (!host.ok) return host;
  const arch = mapNodeArchToMacosArch(nodeArch);
  if (!arch) {
    return {
      ok: false,
      error:
        'release-unix macos: unsupported process.arch ' +
        JSON.stringify(nodeArch) +
        ' (need x64→x86_64 or arm64→arm64). Refusing to invent or cross-label arch.',
    };
  }
  return { ok: true, arch };
}

/**
 * Fail-closed Linux host gate for native package (build.zig requires linux target).
 * @param {string} [platform]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertLinuxHost(platform = process.platform) {
  if (platform === 'linux') return { ok: true };
  return {
    ok: false,
    error:
      'release-unix linux: native Linux package requires a Linux host (got ' +
      platform +
      '). build.zig -Dplatform=linux panics on non-Linux targets.',
  };
}

/**
 * @param {string} [repoRoot]
 * @returns {{ ok: true, distDir: string } | { ok: false, error: string }}
 */
export function requireBuiltDist(repoRoot = REPO_ROOT) {
  const distDir = join(repoRoot, 'dist');
  const index = join(distDir, 'index.html');
  if (!existsSync(index)) {
    return {
      ok: false,
      error: `missing ${index}; run \`pnpm build\` before packaging native SPA assets`,
    };
  }
  return { ok: true, distDir };
}

/**
 * Stage native FreeBSD/OpenBSD package: bin/onyx + resources/dist + manifest.
 * @param {'freebsd' | 'openbsd'} os
 * @param {string} packageDir
 * @param {string} hostBinPath path to cross-built onyx ELF
 * @param {string} distDir
 * @param {{ version?: string, host?: string, optimize?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function stageBsdPackage(os, packageDir, hostBinPath, distDir, opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  const optimize = opts.optimize ?? RELEASE_OPTIMIZE;

  if (os !== 'freebsd' && os !== 'openbsd') {
    return { ok: false, error: `stageBsdPackage: os must be freebsd|openbsd, got ${os}` };
  }
  if (!existsSync(hostBinPath)) {
    return { ok: false, error: `missing BSD host binary: ${hostBinPath} (run zig build bsd-host -Dbsd-os=${os})` };
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    return { ok: false, error: `missing ${join(distDir, 'index.html')}; run pnpm build first` };
  }

  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  mkdirSync(join(packageDir, 'resources', 'dist'), { recursive: true });

  cpSync(hostBinPath, join(packageDir, 'bin', 'onyx'));
  try {
    chmodSync(join(packageDir, 'bin', 'onyx'), 0o755);
  } catch {
    // non-fatal on exotic hosts
  }
  cpSync(distDir, join(packageDir, 'resources', 'dist'), { recursive: true });

  const notice = bsdHonestyNotice(os, { version, host });
  writeFileSync(join(packageDir, 'README.txt'), notice, 'utf8');
  writeFileSync(join(packageDir, 'LAUNCH.txt'), bsdLaunchContractText(os), 'utf8');
  writeFileSync(
    join(packageDir, 'package-manifest.zon'),
    bsdPackageManifest(os, { version, optimize }),
    'utf8',
  );
  writeFileSync(join(packageDir, `UNSIGNED-${os.toUpperCase()}.txt`), notice, 'utf8');
  const installSh = generateBsdInstallSh(os, { version });
  const installPath = join(packageDir, 'install.sh');
  writeFileSync(installPath, installSh, 'utf8');
  chmodSync(installPath, 0o755);
  return { ok: true };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   skipPackageBuild?: boolean,
 *   packageDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   runZig?: typeof runDesktopZig,
 *   createTar?: typeof createPackageTarGz,
 *   validate?: typeof validateLinuxPackageLayout,
 *   platform?: string,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 */
export async function runLinuxRelease(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const platform = opts.platform ?? process.platform;

  const hostGate = assertLinuxHost(platform);
  if (!hostGate.ok) {
    err.write(`release-unix: ${hostGate.error}\n`);
    return { ok: false, code: 1, errors: [hostGate.error] };
  }

  const aligned = loadAlignedVersion(repoRoot);
  if (!aligned.ok) {
    for (const e of aligned.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: aligned.errors };
  }
  const version = aligned.version;
  const paths = resolveReleasePaths('linux', repoRoot, version);

  if (!opts.skipPackageBuild) {
    const dist = requireBuiltDist(repoRoot);
    if (!dist.ok) {
      // zig package depends on frontend_build, but fail early with a clearer message
      // when the operator expects an existing dist (still allowed — zig will rebuild).
      log.write(`release-unix: note: ${dist.error} (zig package will run pnpm build)\n`);
    }
    const env = { ...(opts.env ?? process.env) };
    const bin = join(repoRoot, 'node_modules', '.bin');
    env.PATH = `${bin}${env.PATH ? `:${env.PATH}` : ''}`;
    env.NATIVE_SDK_PATH = env.NATIVE_SDK_PATH || join(repoRoot, 'node_modules', '@native-sdk', 'cli');

    log.write(
      'release-unix linux: zig build package -Dplatform=linux (Native SDK system WebView)\n',
    );
    const runZig = opts.runZig ?? runDesktopZig;
    const code = await runZig(['build', 'package', '-Dplatform=linux'], { env });
    if (code !== 0) {
      const msg = `zig build package (linux) failed with exit ${code}`;
      err.write(`release-unix: ${msg}\n`);
      return { ok: false, code: code === 0 ? 1 : code, errors: [msg] };
    }
  }

  const packageDir = opts.packageDir ?? paths.packageDir;
  const validate = opts.validate ?? validateLinuxPackageLayout;
  const layout = validate(packageDir, { version });
  if (!layout.ok) {
    for (const e of layout.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: layout.errors };
  }

  mkdirSync(paths.releaseDir, { recursive: true });
  const notice = linuxHonestyNotice({ version, host: `${platform}/${process.arch}` });
  writeFileSync(paths.noticePath, notice, 'utf8');

  const rootName = packageDirName('linux', version);
  const createTar = opts.createTar ?? createPackageTarGz;
  const tarResult = createTar(packageDir, paths.archivePath, rootName, {
    injectFiles: { 'UNSIGNED-LINUX.txt': notice },
  });
  if (!tarResult.ok) {
    err.write(`release-unix: ${tarResult.error}\n`);
    return { ok: false, code: 1, errors: [tarResult.error] };
  }

  const sum = writeArchiveChecksum(paths.archivePath, paths.sumsPath);
  if (!sum.ok) {
    err.write(`release-unix: ${sum.error}\n`);
    return { ok: false, code: 1, errors: [sum.error] };
  }

  log.write(`release-unix linux: package ${packageDir}\n`);
  log.write(`release-unix linux: tar.gz  ${paths.archivePath}\n`);
  log.write(`release-unix linux: sha256  ${sum.hash}  ${paths.archivePath.split(/[/\\]/).pop()}\n`);
  log.write(`release-unix linux: notice  ${paths.noticePath}\n`);
  log.write(
    'release-unix linux: UNSIGNED Native SDK system-WebView; needs WebKitGTK 6 + GTK 4. FreeBSD/OpenBSD use a separate Zig-native host lane (desktop:release:freebsd|openbsd), not this Linux artifact.\n',
  );

  return { ok: true, paths, hash: sum.hash, lane: 'linux' };
}

/**
 * Cross-build + package native FreeBSD/OpenBSD desktop host.
 * May run on Linux: produces correct ELF + layout; does not claim GUI launch.
 * @param {'freebsd' | 'openbsd'} os
 * @param {{
 *   repoRoot?: string,
 *   distDir?: string,
 *   skipHostBuild?: boolean,
 *   packageDir?: string,
 *   hostBinPath?: string,
 *   createTar?: typeof createPackageTarGz,
 *   validate?: typeof validateBsdPackageLayout,
 *   runZig?: typeof runDesktopZig,
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 */
export async function runBsdRelease(os, opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const platform = opts.platform ?? process.platform;

  if (os !== 'freebsd' && os !== 'openbsd') {
    const msg = `BSD native lane must be freebsd|openbsd, got ${os}`;
    err.write(`release-unix: ${msg}\n`);
    return { ok: false, code: 1, errors: [msg] };
  }

  const aligned = loadAlignedVersion(repoRoot);
  if (!aligned.ok) {
    for (const e of aligned.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: aligned.errors };
  }
  const version = aligned.version;
  const paths = resolveReleasePaths(os, repoRoot, version);

  if (!opts.skipHostBuild) {
    const env = { ...(opts.env ?? process.env) };
    const bin = join(repoRoot, 'node_modules', '.bin');
    env.PATH = `${bin}${env.PATH ? `:${env.PATH}` : ''}`;
    log.write(
      `release-unix ${os}: zig build bsd-host -Dbsd-os=${os} (Zig-native GTK/WebKitGTK host, ${paths.hostBinDir ?? 'zig-out/bsd'})\n`,
    );
    const runZig = opts.runZig ?? runDesktopZig;
    const code = await runZig(['build', 'bsd-host', `-Dbsd-os=${os}`], { env });
    if (code !== 0) {
      const msg = `zig build bsd-host (-Dbsd-os=${os}) failed with exit ${code}`;
      err.write(`release-unix: ${msg}\n`);
      return { ok: false, code: code === 0 ? 1 : code, errors: [msg] };
    }
  }

  const dist = opts.distDir
    ? existsSync(join(opts.distDir, 'index.html'))
      ? { ok: true, distDir: opts.distDir }
      : { ok: false, error: `missing index.html in ${opts.distDir}` }
    : requireBuiltDist(repoRoot);
  if (!dist.ok) {
    err.write(`release-unix: ${dist.error}\n`);
    return { ok: false, code: 1, errors: [dist.error] };
  }

  const hostBinPath = opts.hostBinPath ?? paths.hostBinPath;
  const packageDir = opts.packageDir ?? paths.packageDir;
  const staged = stageBsdPackage(os, packageDir, hostBinPath, dist.distDir, {
    version,
    host: `${platform}/${process.arch}`,
  });
  if (!staged.ok) {
    err.write(`release-unix: ${staged.error}\n`);
    return { ok: false, code: 1, errors: [staged.error] };
  }

  const validate = opts.validate ?? validateBsdPackageLayout;
  const layout = validate(packageDir, os, { version });
  if (!layout.ok) {
    for (const e of layout.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: layout.errors };
  }

  mkdirSync(paths.releaseDir, { recursive: true });
  const notice = bsdHonestyNotice(os, {
    version,
    host: `${platform}/${process.arch}`,
  });
  writeFileSync(paths.noticePath, notice, 'utf8');

  const createTar = opts.createTar ?? createPackageTarGz;
  const rootName = packageDirName(os, version);
  const tarResult = createTar(packageDir, paths.archivePath, rootName, {
    injectFiles: { [`UNSIGNED-${os.toUpperCase()}.txt`]: notice },
  });
  if (!tarResult.ok) {
    err.write(`release-unix: ${tarResult.error}\n`);
    return { ok: false, code: 1, errors: [tarResult.error] };
  }

  const sum = writeArchiveChecksum(paths.archivePath, paths.sumsPath);
  if (!sum.ok) {
    err.write(`release-unix: ${sum.error}\n`);
    return { ok: false, code: 1, errors: [sum.error] };
  }

  log.write(`release-unix ${os}: package ${packageDir}\n`);
  log.write(`release-unix ${os}: tar.gz  ${paths.archivePath}\n`);
  log.write(`release-unix ${os}: sha256  ${sum.hash}  ${paths.archivePath.split(/[/\\]/).pop()}\n`);
  log.write(`release-unix ${os}: notice  ${paths.noticePath}\n`);
  log.write(
    `release-unix ${os}: UNSIGNED Zig-native host; needs GTK+WebKitGTK on ${os}; ELF validated — GUI not claimed on ${platform}.\n`,
  );

  return { ok: true, paths, hash: sum.hash, lane: os };
}

/** @deprecated Use runBsdRelease — portable-web BSD lane removed. */
export async function runPortableWebRelease(os, opts = {}) {
  return runBsdRelease(os, opts);
}

/**
 * Create an unsigned DMG from a .app bundle using hdiutil (Darwin only).
 * @param {string} appDir path to .app
 * @param {string} dmgPath
 * @param {string} volumeName
 * @param {{ spawnSyncImpl?: typeof spawnSync }} [opts]
 * @returns {{ ok: true, dmgPath: string } | { ok: false, error: string }}
 */
export function createMacosDmg(appDir, dmgPath, volumeName, opts = {}) {
  const run = opts.spawnSyncImpl ?? spawnSync;
  if (!existsSync(appDir)) {
    return { ok: false, error: `macOS .app missing: ${appDir}` };
  }
  mkdirSync(dirname(dmgPath), { recursive: true });
  if (existsSync(dmgPath)) {
    try {
      rmSync(dmgPath);
    } catch {
      // overwrite via hdiutil may still fail; leave explicit error path
    }
  }
  // UDZO compressed read-only image; srcfolder is the .app parent content.
  const result = run(
    'hdiutil',
    [
      'create',
      '-volname',
      volumeName,
      '-srcfolder',
      appDir,
      '-ov',
      '-format',
      'UDZO',
      dmgPath,
    ],
    { encoding: 'utf8', shell: false },
  );
  if (result.error) {
    return { ok: false, error: `hdiutil failed: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `hdiutil exit ${result.status}: ${(result.stderr || result.stdout || '').trim()}`,
    };
  }
  if (!existsSync(dmgPath) || statSync(dmgPath).size < 64) {
    return { ok: false, error: `DMG not written or too small: ${dmgPath}` };
  }
  return { ok: true, dmgPath };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   skipPackageBuild?: boolean,
 *   packageDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   runZig?: typeof runDesktopZig,
 *   createDmg?: typeof createMacosDmg,
 *   validate?: typeof validateMacosPackageLayout,
 *   platform?: string,
 *   nodeArch?: string,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 *
 * Production CLI must not pass nodeArch — host arch is always process.arch.
 * Tests may inject platform + nodeArch (x64|arm64) without inventing a false arch.
 */
export async function runMacosRelease(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const platform = opts.platform ?? process.platform;
  const nodeArch = opts.nodeArch ?? process.arch;

  const hostGate = assertMacosHostAndArch(platform, nodeArch);
  if (!hostGate.ok) {
    err.write(`release-unix: ${hostGate.error}\n`);
    return { ok: false, code: 1, errors: [hostGate.error] };
  }
  const macosArch = hostGate.arch;

  const aligned = loadAlignedVersion(repoRoot);
  if (!aligned.ok) {
    for (const e of aligned.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: aligned.errors };
  }
  const version = aligned.version;
  const paths = resolveReleasePaths('macos', repoRoot, version, macosArch);

  if (!opts.skipPackageBuild) {
    const env = { ...(opts.env ?? process.env) };
    const bin = join(repoRoot, 'node_modules', '.bin');
    env.PATH = `${bin}${env.PATH ? `:${env.PATH}` : ''}`;
    env.NATIVE_SDK_PATH = env.NATIVE_SDK_PATH || join(repoRoot, 'node_modules', '@native-sdk', 'cli');

    log.write(
      `release-unix macos: zig build package -Dplatform=macos (Native SDK WKWebView .app, host ${macosArch})\n`,
    );
    const runZig = opts.runZig ?? runDesktopZig;
    const code = await runZig(['build', 'package', '-Dplatform=macos'], { env });
    if (code !== 0) {
      const msg = `zig build package (macos) failed with exit ${code}`;
      err.write(`release-unix: ${msg}\n`);
      return { ok: false, code: code === 0 ? 1 : code, errors: [msg] };
    }
  }

  const packageDir = opts.packageDir ?? paths.packageDir;
  const validate = opts.validate ?? validateMacosPackageLayout;
  const layout = validate(packageDir, { version });
  if (!layout.ok) {
    for (const e of layout.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: layout.errors };
  }

  mkdirSync(paths.releaseDir, { recursive: true });
  const notice = macosHonestyNotice({
    version,
    host: `${platform}/${nodeArch}`,
    arch: macosArch,
  });
  writeFileSync(paths.noticePath, notice, 'utf8');
  // Embed notice beside the .app for operators who skip the DMG.
  try {
    writeFileSync(join(packageDir, 'UNSIGNED-MACOS.txt'), notice, 'utf8');
  } catch {
    // package dir may be immutable in some tests; notice still at releaseDir
  }

  const createDmg = opts.createDmg ?? createMacosDmg;
  const dmg = createDmg(packageDir, paths.archivePath, `Onyx ${version} ${macosArch}`);
  if (!dmg.ok) {
    err.write(`release-unix: ${dmg.error}\n`);
    return { ok: false, code: 1, errors: [dmg.error] };
  }

  const sum = writeArchiveChecksum(paths.archivePath, paths.sumsPath);
  if (!sum.ok) {
    err.write(`release-unix: ${sum.error}\n`);
    return { ok: false, code: 1, errors: [sum.error] };
  }

  log.write(`release-unix macos (${macosArch}): package ${packageDir}\n`);
  log.write(`release-unix macos (${macosArch}): dmg     ${paths.archivePath}\n`);
  log.write(
    `release-unix macos (${macosArch}): sha256  ${sum.hash}  ${paths.archivePath.split(/[/\\]/).pop()}\n`,
  );
  log.write(
    `release-unix macos (${macosArch}): UNSIGNED; not notarized; built only on matching Darwin host.\n`,
  );

  return { ok: true, paths, hash: sum.hash, lane: 'macos', arch: macosArch };
}

/**
 * CLI dispatcher.
 * Production always derives macOS arch from real process.arch (no --arch override).
 * Tests may inject platform/nodeArch via opts only.
 * @param {string[]} argv
 * @param {{
 *   repoRoot?: string,
 *   platform?: string,
 *   nodeArch?: string,
 *   runLinux?: typeof runLinuxRelease,
 *   runBsd?: typeof runBsdRelease,
 *   runPortable?: typeof runBsdRelease,
 *   runMacos?: typeof runMacosRelease,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 */
export async function runUnixReleaseCli(argv, opts = {}) {
  const err = opts.stderr ?? process.stderr;
  const args = argv.filter((a) => a !== '--');
  const lane = (args.find((a) => !a.startsWith('--')) ?? '').toLowerCase();
  const skipPackageBuild = args.includes('--skip-package-build');
  const skipHostBuild = args.includes('--skip-host-build') || skipPackageBuild;
  const packageDirArg = args.find((a) => a.startsWith('--package-dir='));
  const packageDir = packageDirArg ? packageDirArg.slice('--package-dir='.length) : undefined;
  // Reject production-style arch overrides that could lie about the host.
  const archOverride = args.find(
    (a) => a.startsWith('--arch=') || a === '--arch' || a.startsWith('--macos-arch='),
  );
  if (archOverride) {
    const msg =
      'release-unix: refuse --arch / --macos-arch override; macOS arch is derived from real process.arch (x64→x86_64, arm64→arm64)';
    err.write(`${msg}\n`);
    return { ok: false, code: 2, errors: [msg] };
  }
  const common = {
    repoRoot: opts.repoRoot,
    platform: opts.platform,
    skipPackageBuild,
    packageDir,
    stdout: opts.stdout,
    stderr: opts.stderr,
  };

  if (lane === 'linux') {
    const run = opts.runLinux ?? runLinuxRelease;
    return run(common);
  }
  if (lane === 'freebsd' || lane === 'openbsd') {
    const run = opts.runBsd ?? opts.runPortable ?? runBsdRelease;
    return run(lane, {
      ...common,
      skipHostBuild,
    });
  }
  if (lane === 'macos') {
    const run = opts.runMacos ?? runMacosRelease;
    // Do not invent arch from CLI; only optional test inject via opts.nodeArch.
    return run({
      ...common,
      nodeArch: opts.nodeArch,
    });
  }

  const msg =
    'usage: node tools/release-unix.mjs <linux|freebsd|openbsd|macos> [--skip-package-build] [--skip-host-build] [--package-dir=PATH]\n' +
    '  linux   — Native SDK system-WebView x86_64 tar.gz (Linux host)\n' +
    '  freebsd — Zig-native x86_64-freebsd host tar.gz (GTK/WebKitGTK dlopen)\n' +
    '  openbsd — Zig-native x86_64-openbsd host tar.gz (GTK/WebKitGTK dlopen)\n' +
    '  macos   — Native SDK .app + DMG (Darwin only; arch from process.arch → x86_64|arm64)';
  err.write(`release-unix: ${msg}\n`);
  return { ok: false, code: 2, errors: [msg] };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const result = await runUnixReleaseCli(process.argv.slice(2));
  if (!result.ok) process.exit(result.code ?? 1);
  process.exit(0);
}
