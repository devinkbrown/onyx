// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Onyx client v0.1.2 — Unix release packaging (Linux native + BSD portable + macOS).
 *
 * Lanes (one downloadable asset per platform):
 *  1. linux   — Native SDK system-WebView directory package → tar.gz (x86_64 ELF)
 *  2. freebsd — architecture-neutral portable web/PWA tar.gz (NOT a native host)
 *  3. openbsd — architecture-neutral portable web/PWA tar.gz (NOT a native host)
 *  4. macos   — Native SDK .app + DMG; runs ONLY on Darwin (fail-closed elsewhere)
 *
 * Honesty:
 *  - Native SDK has no FreeBSD/OpenBSD backend — BSD assets are SPA+localhost only.
 *  - macOS is never fabricated on Linux; requires a real Mac + Apple tooling.
 *  - Artifacts are UNSIGNED (no codesign/notarize/AppImage/Flatpak store claims).
 *
 * Does not download toolchains, commit, push, tag, deploy, or publish.
 */
import { createHash } from 'node:crypto';
import {
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
export const RELEASE_PRODUCT_VERSION = '0.1.2';

/** Package optimize name Native SDK / build.zig use in artifact paths. */
export const RELEASE_OPTIMIZE = 'ReleaseFast';

/** Linux release arch claim (host native package). */
export const RELEASE_LINUX_ARCH = 'x86_64';

/** ELF e_machine for EM_X86_64. */
export const ELF_EM_X86_64 = 62;

/** Portable OS labels (web/PWA only — not native desktop hosts). */
export const PORTABLE_OS = /** @type {const} */ (['freebsd', 'openbsd']);

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
 * Directory name produced by build.zig package step / Native SDK artifactName.
 * @param {'linux' | 'macos'} target
 * @param {string} [version]
 * @param {string} [optimize]
 * @returns {string}
 */
export function packageDirName(target, version = RELEASE_PRODUCT_VERSION, optimize = RELEASE_OPTIMIZE) {
  if (target === 'macos') return `onyx-${version}-macos-${optimize}.app`;
  return `onyx-${version}-${target}-${optimize}`;
}

/**
 * Single downloadable asset basename (no extension) per platform lane.
 * @param {'linux' | 'macos' | 'freebsd' | 'openbsd'} lane
 * @param {string} [version]
 * @param {string} [optimize]
 * @returns {string}
 */
export function releaseAssetBaseName(lane, version = RELEASE_PRODUCT_VERSION, optimize = RELEASE_OPTIMIZE) {
  if (lane === 'linux') {
    return `onyx-${version}-linux-${RELEASE_LINUX_ARCH}-${optimize}-unsigned`;
  }
  if (lane === 'macos') {
    return `onyx-${version}-macos-${optimize}-unsigned`;
  }
  // Architecture-neutral portable web/PWA (not native desktop).
  return `onyx-${version}-${lane}-portable-web-unsigned`;
}

/**
 * @param {'linux' | 'macos' | 'freebsd' | 'openbsd'} lane
 * @param {string} [repoRoot]
 * @param {string} [version]
 */
export function resolveReleasePaths(lane, repoRoot = REPO_ROOT, version = RELEASE_PRODUCT_VERSION) {
  const assetBase = releaseAssetBaseName(lane, version);
  if (lane === 'linux') {
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
    const dirName = packageDirName('macos', version);
    const packageDir = join(repoRoot, 'zig-out', 'package', dirName);
    const releaseDir = join(repoRoot, 'zig-out', 'release', 'macos');
    return {
      packageDir,
      releaseDir,
      archivePath: join(releaseDir, `${assetBase}.dmg`),
      sumsPath: join(releaseDir, `${assetBase}.sha256`),
      noticePath: join(releaseDir, `${assetBase}.NOTICE.txt`),
      assetBase,
    };
  }
  // freebsd / openbsd portable
  const releaseDir = join(repoRoot, 'zig-out', 'release', `${lane}-portable-web`);
  const stagingDir = join(releaseDir, 'staging', assetBase);
  return {
    packageDir: stagingDir,
    releaseDir,
    archivePath: join(releaseDir, `${assetBase}.tar.gz`),
    sumsPath: join(releaseDir, `${assetBase}.sha256`),
    noticePath: join(releaseDir, `${assetBase}.NOTICE.txt`),
    assetBase,
    stagingDir,
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
    '  - FreeBSD/OpenBSD are NOT native desktop hosts (Native SDK has no BSD backend).',
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
 * Honesty notice for architecture-neutral portable web/PWA (BSD lanes).
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ version?: string, host?: string }} [opts]
 * @returns {string}
 */
export function portableWebHonestyNotice(os, opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  const osLabel = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';
  return [
    `Onyx ${version} — ${osLabel} PORTABLE WEB / PWA bundle (architecture-neutral)`,
    '',
    'What this is:',
    '  - The same SolidJS/Vite SPA (`dist/`) plus a safe 127.0.0.1-only launcher.',
    '  - Architecture-neutral: no ELF/PE/Mach-O desktop binary for ' + osLabel + '.',
    '  - Intended for browser/PWA use on ' + osLabel + ' (or any OS that can run the SPA).',
    '',
    'What this is NOT:',
    '  - NOT a native desktop host. Native SDK has NO FreeBSD/OpenBSD backend.',
    '  - NOT Zig-linked WebKitGTK/WKWebView packaging for BSD.',
    '  - NOT signed, NOT an installer, NO auto-updater.',
    '',
    'How to use:',
    '  1. Extract the tar.gz',
    '  2. Run ./launch-localhost.sh  (binds 127.0.0.1 only; opens no 0.0.0.0 socket)',
    '  3. Open the printed URL in a modern browser',
    '',
    'Packaged on host: ' + host,
    '',
    'Reproduce:',
    '  pnpm install && pnpm build',
    `  pnpm desktop:release:${os}`,
    '',
  ].join('\n');
}

/**
 * Honesty notice for macOS (only produced on Darwin).
 * @param {{ version?: string, host?: string }} [opts]
 * @returns {string}
 */
export function macosHonestyNotice(opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  return [
    `Onyx desktop ${version} — macOS UNSIGNED Native SDK package (DMG)`,
    '',
    'What this is:',
    '  - Native SDK system-WebView .app (WKWebView) packaged as an unsigned DMG',
    '  - Built only on a real Darwin host with Apple SDK tools (xcrun/hdiutil)',
    '',
    'What this is NOT:',
    '  - NOT notarized, NOT codesigned for Gatekeeper distribution',
    '  - NOT fabricated on Linux/CI without a Mac — that path is fail-closed',
    '  - NO auto-updater, NO public download channel claim',
    '',
    'Built on host: ' + host,
    '',
    'Reproduce (on macOS only):',
    '  pnpm install && pnpm build',
    '  pnpm desktop:release:macos',
    '  # requires Zig pin from .zigversion; see docs/desktop-host.md',
    '',
  ].join('\n');
}

/**
 * Safe localhost launcher for portable web bundles (127.0.0.1 only).
 * @param {{ osLabel?: string }} [opts]
 * @returns {string}
 */
export function portableLocalhostLauncherScript(opts = {}) {
  const osLabel = opts.osLabel ?? 'portable';
  return `#!/usr/bin/env sh
# Onyx portable web/PWA launcher — ${osLabel}
# Binds 127.0.0.1 ONLY (never 0.0.0.0). Not a native desktop host.
# Native SDK has no FreeBSD/OpenBSD backend; this serves the SPA for a browser.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DIST="$ROOT/dist"
PORT=\${ONYX_PORTABLE_PORT:-8765}
if [ ! -f "$DIST/index.html" ]; then
  echo "error: missing dist/index.html under $ROOT" >&2
  exit 1
fi
# Prefer python3 (common on FreeBSD/OpenBSD ports); fall back to python.
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "error: python3 (or python) required to serve the portable SPA on 127.0.0.1" >&2
  exit 1
fi
echo "Onyx portable web (${osLabel}): http://127.0.0.1:\${PORT}/"
echo "Serving $DIST on 127.0.0.1 only (Ctrl-C to stop)."
cd "$DIST"
exec "$PY" -c "
import sys
try:
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
except ImportError:
    from http.server import HTTPServer as ThreadingHTTPServer, SimpleHTTPRequestHandler
host, port = '127.0.0.1', int(sys.argv[1])
httpd = ThreadingHTTPServer((host, port), SimpleHTTPRequestHandler)
print('listening on http://%s:%d/' % (host, port), flush=True)
httpd.serve_forever()
" "$PORT"
`;
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
 * Validate portable web staging layout.
 * @param {string} stagingDir
 * @param {'freebsd' | 'openbsd'} os
 * @param {{ exists?: (p: string) => boolean, readFile?: (p: string) => Buffer | string }} [opts]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validatePortableWebLayout(stagingDir, os, opts = {}) {
  const exists = opts.exists ?? ((p) => existsSync(p));
  const read = opts.readFile ?? ((p) => readFileSync(p));
  const errors = [];
  const root = resolve(stagingDir);
  if (!exists(root)) return { ok: false, errors: [`staging directory missing: ${root}`] };

  const required = [
    'dist/index.html',
    'launch-localhost.sh',
    'README.txt',
    'PORTABLE-WEB-NOT-NATIVE.txt',
  ];
  for (const rel of required) {
    if (!exists(join(root, rel))) errors.push(`missing required portable path: ${rel}`);
  }

  // Fail closed: must not ship a native desktop binary pretending to be BSD-native.
  for (const banned of ['bin/onyx', 'bin/onyx.exe', 'Contents/MacOS/onyx']) {
    if (exists(join(root, banned))) {
      errors.push(`portable web bundle must not include native binary path: ${banned}`);
    }
  }

  if (exists(join(root, 'PORTABLE-WEB-NOT-NATIVE.txt'))) {
    try {
      const text = String(read(join(root, 'PORTABLE-WEB-NOT-NATIVE.txt')));
      if (!/NOT a native desktop host/i.test(text)) {
        errors.push('PORTABLE-WEB-NOT-NATIVE.txt must state this is not a native desktop host');
      }
      if (!new RegExp(os, 'i').test(text) && !/FreeBSD|OpenBSD|portable/i.test(text)) {
        errors.push('PORTABLE-WEB-NOT-NATIVE.txt should identify the portable OS lane');
      }
      if (!/no FreeBSD\/OpenBSD backend|no BSD backend/i.test(text)) {
        errors.push('PORTABLE-WEB-NOT-NATIVE.txt must mention Native SDK has no BSD backend');
      }
    } catch (e) {
      errors.push(`cannot read PORTABLE-WEB-NOT-NATIVE.txt: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (exists(join(root, 'launch-localhost.sh'))) {
    try {
      const script = String(read(join(root, 'launch-localhost.sh')));
      if (!/127\.0\.0\.1/.test(script)) {
        errors.push('launch-localhost.sh must bind 127.0.0.1 only');
      }
      if (/0\.0\.0\.0/.test(script) && !/never 0\.0\.0\.0/.test(script)) {
        errors.push('launch-localhost.sh must not listen on 0.0.0.0');
      }
    } catch (e) {
      errors.push(`cannot read launch-localhost.sh: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
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
      error: `missing ${index}; run \`pnpm build\` before packaging portable/native SPA assets`,
    };
  }
  return { ok: true, distDir };
}

/**
 * Stage portable web tree for FreeBSD or OpenBSD.
 * @param {'freebsd' | 'openbsd'} os
 * @param {string} stagingDir
 * @param {string} distDir
 * @param {{ version?: string, host?: string }} [opts]
 */
export function stagePortableWebBundle(os, stagingDir, distDir, opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  const osLabel = os === 'freebsd' ? 'FreeBSD' : 'OpenBSD';

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, 'dist'), { recursive: true });
  cpSync(distDir, join(stagingDir, 'dist'), { recursive: true });

  const notice = portableWebHonestyNotice(os, { version, host });
  writeFileSync(join(stagingDir, 'README.txt'), notice, 'utf8');
  writeFileSync(join(stagingDir, 'PORTABLE-WEB-NOT-NATIVE.txt'), notice, 'utf8');
  writeFileSync(
    join(stagingDir, 'launch-localhost.sh'),
    portableLocalhostLauncherScript({ osLabel }),
    { mode: 0o755, encoding: 'utf8' },
  );
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
    'release-unix linux: UNSIGNED Native SDK system-WebView; needs WebKitGTK 6 + GTK 4; BSD not native.\n',
  );

  return { ok: true, paths, hash: sum.hash, lane: 'linux' };
}

/**
 * @param {'freebsd' | 'openbsd'} os
 * @param {{
 *   repoRoot?: string,
 *   distDir?: string,
 *   createTar?: typeof createPackageTarGz,
 *   platform?: string,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 */
export async function runPortableWebRelease(os, opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const platform = opts.platform ?? process.platform;

  if (os !== 'freebsd' && os !== 'openbsd') {
    const msg = `portable web lane must be freebsd|openbsd, got ${os}`;
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

  const dist = opts.distDir
    ? existsSync(join(opts.distDir, 'index.html'))
      ? { ok: true, distDir: opts.distDir }
      : { ok: false, error: `missing index.html in ${opts.distDir}` }
    : requireBuiltDist(repoRoot);
  if (!dist.ok) {
    err.write(`release-unix: ${dist.error}\n`);
    return { ok: false, code: 1, errors: [dist.error] };
  }

  mkdirSync(paths.releaseDir, { recursive: true });
  stagePortableWebBundle(os, paths.stagingDir ?? paths.packageDir, dist.distDir, {
    version,
    host: `${platform}/${process.arch}`,
  });

  const layout = validatePortableWebLayout(paths.stagingDir ?? paths.packageDir, os);
  if (!layout.ok) {
    for (const e of layout.errors) err.write(`release-unix: ${e}\n`);
    return { ok: false, code: 1, errors: layout.errors };
  }

  const notice = portableWebHonestyNotice(os, {
    version,
    host: `${platform}/${process.arch}`,
  });
  writeFileSync(paths.noticePath, notice, 'utf8');

  const createTar = opts.createTar ?? createPackageTarGz;
  const rootName = paths.assetBase;
  const tarResult = createTar(paths.stagingDir ?? paths.packageDir, paths.archivePath, rootName);
  if (!tarResult.ok) {
    err.write(`release-unix: ${tarResult.error}\n`);
    return { ok: false, code: 1, errors: [tarResult.error] };
  }

  const sum = writeArchiveChecksum(paths.archivePath, paths.sumsPath);
  if (!sum.ok) {
    err.write(`release-unix: ${sum.error}\n`);
    return { ok: false, code: 1, errors: [sum.error] };
  }

  log.write(`release-unix ${os}: portable staging ${paths.stagingDir ?? paths.packageDir}\n`);
  log.write(`release-unix ${os}: tar.gz  ${paths.archivePath}\n`);
  log.write(`release-unix ${os}: sha256  ${sum.hash}  ${paths.archivePath.split(/[/\\]/).pop()}\n`);
  log.write(
    `release-unix ${os}: architecture-neutral portable WEB/PWA — NOT a native ${os} desktop host (Native SDK has no BSD backend).\n`,
  );

  return { ok: true, paths, hash: sum.hash, lane: os };
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
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 */
export async function runMacosRelease(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const platform = opts.platform ?? process.platform;

  const hostGate = assertMacosHost(platform);
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
  const paths = resolveReleasePaths('macos', repoRoot, version);

  if (!opts.skipPackageBuild) {
    const env = { ...(opts.env ?? process.env) };
    const bin = join(repoRoot, 'node_modules', '.bin');
    env.PATH = `${bin}${env.PATH ? `:${env.PATH}` : ''}`;
    env.NATIVE_SDK_PATH = env.NATIVE_SDK_PATH || join(repoRoot, 'node_modules', '@native-sdk', 'cli');

    log.write(
      'release-unix macos: zig build package -Dplatform=macos (Native SDK WKWebView .app)\n',
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
  const notice = macosHonestyNotice({ version, host: `${platform}/${process.arch}` });
  writeFileSync(paths.noticePath, notice, 'utf8');
  // Embed notice beside the .app for operators who skip the DMG.
  try {
    writeFileSync(join(packageDir, 'UNSIGNED-MACOS.txt'), notice, 'utf8');
  } catch {
    // package dir may be immutable in some tests; notice still at releaseDir
  }

  const createDmg = opts.createDmg ?? createMacosDmg;
  const dmg = createDmg(packageDir, paths.archivePath, `Onyx ${version}`);
  if (!dmg.ok) {
    err.write(`release-unix: ${dmg.error}\n`);
    return { ok: false, code: 1, errors: [dmg.error] };
  }

  const sum = writeArchiveChecksum(paths.archivePath, paths.sumsPath);
  if (!sum.ok) {
    err.write(`release-unix: ${sum.error}\n`);
    return { ok: false, code: 1, errors: [sum.error] };
  }

  log.write(`release-unix macos: package ${packageDir}\n`);
  log.write(`release-unix macos: dmg     ${paths.archivePath}\n`);
  log.write(`release-unix macos: sha256  ${sum.hash}  ${paths.archivePath.split(/[/\\]/).pop()}\n`);
  log.write(
    'release-unix macos: UNSIGNED; not notarized; built only on Darwin with Apple tools.\n',
  );

  return { ok: true, paths, hash: sum.hash, lane: 'macos' };
}

/**
 * CLI dispatcher.
 * @param {string[]} argv
 * @param {{
 *   repoRoot?: string,
 *   platform?: string,
 *   runLinux?: typeof runLinuxRelease,
 *   runPortable?: typeof runPortableWebRelease,
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
  const packageDirArg = args.find((a) => a.startsWith('--package-dir='));
  const packageDir = packageDirArg ? packageDirArg.slice('--package-dir='.length) : undefined;
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
    const run = opts.runPortable ?? runPortableWebRelease;
    return run(lane, common);
  }
  if (lane === 'macos') {
    const run = opts.runMacos ?? runMacosRelease;
    return run(common);
  }

  const msg =
    'usage: node tools/release-unix.mjs <linux|freebsd|openbsd|macos> [--skip-package-build] [--package-dir=PATH]\n' +
    '  linux   — Native SDK system-WebView x86_64 tar.gz (Linux host)\n' +
    '  freebsd — portable web/PWA tar.gz (NOT native; Native SDK has no BSD backend)\n' +
    '  openbsd — portable web/PWA tar.gz (NOT native; Native SDK has no BSD backend)\n' +
    '  macos   — Native SDK .app + DMG (Darwin only; fail-closed elsewhere)';
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
