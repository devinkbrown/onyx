// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Onyx client v0.1.3 — unsigned Windows x86_64 zip release (Native SDK package).
 *
 * Pipeline (fail-closed):
 *  1. Align versions: package.json + app.zon + build.zig.zon
 *  2. Run `zig build package` for x86_64-windows via tools/desktop-zig.mjs
 *     (Native SDK `native package` — directory artifact, not an installer)
 *  3. Validate package layout (onyx.exe PE + GUI subsystem, WebView2Loader.dll, SPA)
 *  4. Verify + bundle the pinned full offline WebView2 x64 runtime installer
 *  5. Zip the package directory (reproducible file order) + SHA-256 sums
 *
 * Honesty (printed and written into the zip):
 *  - Windows runtime is NOT verified on a real Windows machine in this lane.
 *  - macOS and Linux desktop are NOT released by this tool.
 *  - Artifact is UNSIGNED (no Authenticode, no Onyx installer, no updater).
 *  - The included Microsoft runtime installer is verified but the app is not
 *    launched on real Windows in this Linux cross-release lane.
 *
 * Does not download toolchains, commit, push, tag, deploy, or publish.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
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

/** Windows release arch claim (cross-build target). */
export const RELEASE_ARCH = 'x86_64';

/** Package optimize name Native SDK / build.zig use in artifact paths. */
export const RELEASE_OPTIMIZE = 'ReleaseFast';

/** Package target name in Native SDK / zig-out/package path. */
export const RELEASE_TARGET = 'windows';

/** Official Microsoft WebView2 Evergreen Standalone Installer (x64) release input. */
export const WEBVIEW2_RUNTIME = Object.freeze({
  filename: 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe',
  downloadUrl: 'https://go.microsoft.com/fwlink/?linkid=2124701',
  sha256: '04b9f08d839c8c06f34a85acea0d9f1568d3d8aa309a77619aaa46bb29ade0f8',
  minimumBytes: 100 * 1024 * 1024,
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
 * Directory name produced by build.zig package step / Native SDK artifactName.
 * @param {string} [version]
 * @param {string} [optimize]
 * @returns {string}
 */
export function packageDirName(version = RELEASE_PRODUCT_VERSION, optimize = RELEASE_OPTIMIZE) {
  return `onyx-${version}-${RELEASE_TARGET}-${optimize}`;
}

/**
 * Zip basename (adds arch + unsigned; Native package dir has no arch token).
 * @param {string} [version]
 * @param {string} [optimize]
 * @returns {string}
 */
export function releaseZipBaseName(version = RELEASE_PRODUCT_VERSION, optimize = RELEASE_OPTIMIZE) {
  return `onyx-${version}-${RELEASE_TARGET}-${RELEASE_ARCH}-${optimize}-unsigned`;
}

/**
 * @param {string} [repoRoot]
 * @param {string} [version]
 * @returns {{ packageDir: string, releaseDir: string, zipPath: string, sumsPath: string, noticePath: string }}
 */
export function resolveReleasePaths(repoRoot = REPO_ROOT, version = RELEASE_PRODUCT_VERSION) {
  const dirName = packageDirName(version);
  const zipBase = releaseZipBaseName(version);
  const packageDir = join(repoRoot, 'zig-out', 'package', dirName);
  const releaseDir = join(repoRoot, 'zig-out', 'release', 'windows-x86_64');
  return {
    packageDir,
    releaseDir,
    zipPath: join(releaseDir, `${zipBase}.zip`),
    sumsPath: join(releaseDir, `${zipBase}.sha256`),
    noticePath: join(releaseDir, `${zipBase}.NOTICE.txt`),
  };
}

/**
 * Honesty notice embedded beside the zip and inside the zip as UNSIGNED-WINDOWS.txt.
 * @param {{ version?: string, host?: string }} [opts]
 * @returns {string}
 */
export function honestyNotice(opts = {}) {
  const version = opts.version ?? RELEASE_PRODUCT_VERSION;
  const host = opts.host ?? `${process.platform}/${process.arch}`;
  return [
    `Onyx desktop ${version} — Windows ${RELEASE_ARCH} UNSIGNED package`,
    '',
    'What this is:',
    '  - Native SDK directory package (bin/onyx.exe + WebView2Loader.dll + SPA resources)',
    '  - Full offline Microsoft WebView2 Evergreen Standalone Installer (x64) included',
    '    under runtime/; Install-and-Run-Onyx.cmd installs it silently, then starts Onyx.',
    '  - Zip archive only — NOT an MSI/EXE installer, NOT signed (no Authenticode),',
    '    NOT notarized, NO auto-updater, NO public download channel claim.',
    '',
    'What this is NOT / not claimed:',
    '  - Windows runtime was NOT verified on a real Windows machine in this release lane.',
    '  - macOS and Linux desktop builds are NOT released by this pipeline.',
    '  - Cross-build host was: ' + host,
    '',
    'Requirements on a Windows machine (unverified here):',
    '  - x86_64 Windows; extract the full tree and run Install-and-Run-Onyx.cmd',
    '  - The included Microsoft runtime installer may require elevation.',
    '  - No network download is required for the bundled runtime installer.',
    '',
    'Reproduce:',
    '  pnpm install',
    '  pnpm desktop:release:windows',
    '  # requires Zig pin from .zigversion (ONYX_ZIG or PATH); see docs/desktop-host.md',
    '',
  ].join('\n');
}

/**
 * Validate the pinned Microsoft offline runtime before it can enter a release.
 * @param {string} installerPath
 * @param {{ expectedSha256?: string, minimumBytes?: number }} [opts]
 * @returns {{ ok: true, hash: string, bytes: number } | { ok: false, errors: string[] }}
 */
export function validateWebView2RuntimeInstaller(installerPath, opts = {}) {
  const expected = opts.expectedSha256 ?? WEBVIEW2_RUNTIME.sha256;
  const minimumBytes = opts.minimumBytes ?? WEBVIEW2_RUNTIME.minimumBytes;
  const errors = [];
  if (!existsSync(installerPath)) {
    return { ok: false, errors: [`WebView2 offline runtime installer missing: ${installerPath}`] };
  }
  let buf;
  try {
    buf = readFileSync(installerPath);
  } catch (e) {
    return {
      ok: false,
      errors: [`cannot read WebView2 runtime installer: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  if (buf.length < minimumBytes) {
    errors.push(`WebView2 runtime installer too small: ${buf.length} bytes (minimum ${minimumBytes})`);
  }
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
    errors.push('WebView2 runtime installer is not a Windows executable (MZ magic missing)');
  }
  const hash = sha256Hex(buf);
  if (hash !== expected) {
    errors.push(`WebView2 runtime installer SHA-256 mismatch: got ${hash}, expected ${expected}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, hash, bytes: buf.length };
}

export function installAndRunCmd() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    `start "" /wait "runtime\\${WEBVIEW2_RUNTIME.filename}" /silent /install`,
    'if errorlevel 1 (',
    '  echo WebView2 Runtime installation failed with exit code %ERRORLEVEL%.',
    '  echo You can retry by running the installer under the runtime folder as Administrator.',
    '  pause',
    '  exit /b %ERRORLEVEL%',
    ')',
    'start "" "bin\\onyx.exe"',
    'exit /b 0',
    '',
  ].join('\r\n');
}

export function webView2RuntimeNotice(hash = WEBVIEW2_RUNTIME.sha256) {
  return [
    'Third-party runtime included with this Onyx package',
    '',
    'Component: Microsoft Edge WebView2 Evergreen Standalone Installer (x64)',
    `File: runtime/${WEBVIEW2_RUNTIME.filename}`,
    `Official source: ${WEBVIEW2_RUNTIME.downloadUrl}`,
    `SHA-256: ${hash}`,
    '',
    'This Microsoft installer is not Onyx code. Microsoft license terms apply.',
    'The Onyx package invokes it only through Install-and-Run-Onyx.cmd.',
    '',
  ].join('\r\n');
}

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function bufferLooksLikePe(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 0x40) return false;
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) return false; // MZ
  const e_lfanew = buf.readUInt32LE(0x3c);
  if (e_lfanew + 4 > buf.length) return false;
  return buf[e_lfanew] === 0x50 && buf[e_lfanew + 1] === 0x45; // PE\0\0
}

/**
 * COFF Machine: 0x8664 = IMAGE_FILE_MACHINE_AMD64.
 * @param {Buffer} buf
 * @returns {'x86_64' | 'other' | 'unknown'}
 */
export function peMachineVerdict(buf) {
  if (!bufferLooksLikePe(buf)) return 'unknown';
  const e_lfanew = buf.readUInt32LE(0x3c);
  if (e_lfanew + 6 > buf.length) return 'unknown';
  return buf.readUInt16LE(e_lfanew + 4) === 0x8664 ? 'x86_64' : 'other';
}

/**
 * PE optional-header Subsystem: 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI, 3 = CONSOLE.
 * @param {Buffer} buf
 * @returns {'gui' | 'console' | 'unknown'}
 */
export function peSubsystemVerdict(buf) {
  if (!bufferLooksLikePe(buf)) return 'unknown';
  const e_lfanew = buf.readUInt32LE(0x3c);
  const optOff = e_lfanew + 24;
  if (optOff + 70 > buf.length) return 'unknown';
  const magic = buf.readUInt16LE(optOff);
  // PE32 = 0x10b (subsystem at +68), PE32+ = 0x20b (subsystem at +68)
  if (magic !== 0x10b && magic !== 0x20b) return 'unknown';
  const subsystem = buf.readUInt16LE(optOff + 68);
  if (subsystem === 2) return 'gui';
  if (subsystem === 3) return 'console';
  return 'unknown';
}

/**
 * Validate a Native SDK Windows desktop package directory.
 * Fail-closed: any missing required path or bad PE → errors.
 * @param {string} packageDir absolute or relative package root
 * @param {{ readFile?: (p: string) => Buffer, exists?: (p: string) => boolean, requireGui?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateWindowsPackageLayout(packageDir, opts = {}) {
  const read = opts.readFile ?? ((p) => readFileSync(p));
  const exists = opts.exists ?? ((p) => existsSync(p));
  const requireGui = opts.requireGui !== false;
  const errors = [];
  const root = resolve(packageDir);

  if (!exists(root)) {
    return { ok: false, errors: [`package directory missing: ${root}`] };
  }

  // Native SDK createDesktopArtifact layout: SPA lands under resources/dist/
  // when zig build package passes --assets dist (see build.zig package step).
  const required = [
    'bin/onyx.exe',
    'bin/WebView2Loader.dll',
    'README.txt',
    'package-manifest.zon',
    'resources/dist/index.html',
  ];
  for (const rel of required) {
    const p = join(root, rel);
    if (!exists(p)) errors.push(`missing required package path: ${rel}`);
  }

  if (exists(join(root, 'bin/onyx.exe'))) {
    let exeBuf;
    try {
      exeBuf = read(join(root, 'bin/onyx.exe'));
    } catch (e) {
      errors.push(`cannot read bin/onyx.exe: ${e instanceof Error ? e.message : String(e)}`);
      exeBuf = null;
    }
    if (exeBuf) {
      if (!bufferLooksLikePe(exeBuf)) {
        errors.push('bin/onyx.exe is not a PE image (MZ/PE signature check failed)');
      } else {
        const machine = peMachineVerdict(exeBuf);
        if (machine !== RELEASE_ARCH) {
          errors.push(`bin/onyx.exe machine is ${machine}, expected ${RELEASE_ARCH}`);
        }
        const sub = peSubsystemVerdict(exeBuf);
        if (requireGui && sub !== 'gui') {
          errors.push(
            `bin/onyx.exe subsystem is ${sub}, expected gui (ReleaseFast package must not ship console subsystem)`,
          );
        }
      }
    }
  }

  if (exists(join(root, 'bin/WebView2Loader.dll'))) {
    try {
      const dll = read(join(root, 'bin/WebView2Loader.dll'));
      if (!bufferLooksLikePe(dll)) {
        errors.push('bin/WebView2Loader.dll is not a PE image');
      } else if (peMachineVerdict(dll) !== RELEASE_ARCH) {
        errors.push(
          `bin/WebView2Loader.dll machine is ${peMachineVerdict(dll)}, expected ${RELEASE_ARCH}`,
        );
      }
    } catch (e) {
      errors.push(`cannot read bin/WebView2Loader.dll: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const manifestPath = join(root, 'package-manifest.zon');
  if (exists(manifestPath)) {
    try {
      const manifest = read(manifestPath).toString('utf8');
      const expectedFields = [
        ['target', RELEASE_TARGET],
        ['version', RELEASE_PRODUCT_VERSION],
        ['optimize', RELEASE_OPTIMIZE],
        ['signing', 'none'],
        ['subsystem', 'gui'],
      ];
      for (const [field, expected] of expectedFields) {
        const pattern = new RegExp(`\\.${field}\\s*=\\s*"${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
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
 * Create a zip of packageDir contents using python3 zipfile (no system `zip` required).
 * Paths inside the zip are rooted at the package directory basename (single top folder).
 * Fail-closed: non-zero throw / return.
 * @param {string} packageDir
 * @param {string} zipPath
 * @param {{ spawnSyncImpl?: typeof spawnSync, pythonBin?: string, injectFiles?: Record<string, string>, injectBinaryFiles?: Record<string, string> }} [opts]
 * @returns {{ ok: true, zipPath: string } | { ok: false, error: string }}
 */
export function createPackageZip(packageDir, zipPath, opts = {}) {
  const run = opts.spawnSyncImpl ?? spawnSync;
  const python = opts.pythonBin ?? 'python3';
  const rootName = packageDirName();
  // Prefer actual basename of packageDir when it matches expected pattern.
  const base = packageDir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || rootName;
  const inject = opts.injectFiles ?? {};
  const injectBinary = opts.injectBinaryFiles ?? {};

  mkdirSync(dirname(zipPath), { recursive: true });

  const script = `
import json, os, sys, zipfile
package_dir = sys.argv[1]
zip_path = sys.argv[2]
root_name = sys.argv[3]
inject = json.loads(sys.argv[4])
inject_binary = json.loads(sys.argv[5])
files = []
for dirpath, dirnames, filenames in os.walk(package_dir):
    dirnames.sort()
    filenames.sort()
    for name in filenames:
        full = os.path.join(dirpath, name)
        if not os.path.isfile(full):
            continue
        rel = os.path.relpath(full, package_dir).replace(os.sep, '/')
        files.append((full, root_name + '/' + rel))
files.sort(key=lambda t: t[1])
# deterministic timestamps (1980-01-01) for bit-stable-ish zip metadata
fixed = (1980, 1, 1, 0, 0, 0)
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for full, arc in files:
        info = zipfile.ZipInfo(arc, date_time=fixed)
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(full, 'rb') as fh:
            zf.writestr(info, fh.read())
    for arc_name, text in sorted(inject.items()):
        info = zipfile.ZipInfo(root_name + '/' + arc_name, date_time=fixed)
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, text.encode('utf-8'))
    for arc_name, source_path in sorted(inject_binary.items()):
        if not os.path.isfile(source_path):
            raise FileNotFoundError(source_path)
        info = zipfile.ZipInfo(root_name + '/' + arc_name, date_time=fixed)
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(source_path, 'rb') as fh:
            zf.writestr(info, fh.read())
if not os.path.isfile(zip_path) or os.path.getsize(zip_path) < 64:
    sys.stderr.write('zip missing or too small\\n')
    sys.exit(2)
`;

  const result = run(python, [
    '-c',
    script,
    packageDir,
    zipPath,
    base,
    JSON.stringify(inject),
    JSON.stringify(injectBinary),
  ], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    return { ok: false, error: `python zip failed: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: `python zip exit ${result.status}: ${(result.stderr || result.stdout || '').trim()}`,
    };
  }
  if (!existsSync(zipPath) || statSync(zipPath).size < 64) {
    return { ok: false, error: `zip not written or too small: ${zipPath}` };
  }
  return { ok: true, zipPath };
}

/**
 * @param {string} zipPath
 * @param {string} sumsPath
 * @param {string} [displayName] name used in the sums file (basename default)
 * @returns {{ ok: true, hash: string } | { ok: false, error: string }}
 */
export function writeZipChecksum(zipPath, sumsPath, displayName) {
  if (!existsSync(zipPath)) return { ok: false, error: `zip missing for checksum: ${zipPath}` };
  const hash = sha256Hex(readFileSync(zipPath));
  const name = displayName ?? zipPath.split(/[/\\]/).pop() ?? 'artifact.zip';
  mkdirSync(dirname(sumsPath), { recursive: true });
  writeFileSync(sumsPath, formatSha256SumFile([{ path: name, hash }]), 'utf8');
  return { ok: true, hash };
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
 * @param {{
 *   repoRoot?: string,
 *   skipPackageBuild?: boolean,
 *   packageDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   runZig?: typeof runDesktopZig,
 *   createZip?: typeof createPackageZip,
 *   validate?: typeof validateWindowsPackageLayout,
 *   runtimeInstallerPath?: string,
 *   runtimeInstallerSha256?: string,
 *   runtimeInstallerMinimumBytes?: number,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 * @returns {Promise<{ ok: true, paths: ReturnType<typeof resolveReleasePaths>, hash: string } | { ok: false, code: number, errors: string[] }>}
 */
export async function runWindowsRelease(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;

  const aligned = loadAlignedVersion(repoRoot);
  if (!aligned.ok) {
    for (const e of aligned.errors) err.write(`release-windows: ${e}\n`);
    return { ok: false, code: 1, errors: aligned.errors };
  }
  const version = aligned.version;
  const paths = resolveReleasePaths(repoRoot, version);

  if (!opts.skipPackageBuild) {
    // Ensure local patched `native` is visible to zig build package.
    const env = { ...(opts.env ?? process.env) };
    const bin = join(repoRoot, 'node_modules', '.bin');
    env.PATH = `${bin}${env.PATH ? `:${env.PATH}` : ''}`;
    // Keep NATIVE_SDK_PATH stable for the CLI (build.zig also sets it).
    env.NATIVE_SDK_PATH = env.NATIVE_SDK_PATH || join(repoRoot, 'node_modules', '@native-sdk', 'cli');

    log.write(
      'release-windows: zig build package -Dplatform=windows -Dtarget=x86_64-windows (Native SDK package)\n',
    );
    const runZig = opts.runZig ?? runDesktopZig;
    const code = await runZig(
      ['build', 'package', '-Dplatform=windows', '-Dtarget=x86_64-windows'],
      { env },
    );
    if (code !== 0) {
      const msg = `zig build package failed with exit ${code}`;
      err.write(`release-windows: ${msg}\n`);
      return { ok: false, code: code === 0 ? 1 : code, errors: [msg] };
    }
  }

  const packageDir = opts.packageDir ?? paths.packageDir;
  const validate = opts.validate ?? validateWindowsPackageLayout;
  const layout = validate(packageDir);
  if (!layout.ok) {
    for (const e of layout.errors) err.write(`release-windows: ${e}\n`);
    return { ok: false, code: 1, errors: layout.errors };
  }

  const runtimeInstallerPath =
    opts.runtimeInstallerPath ??
    opts.env?.ONYX_WEBVIEW2_RUNTIME_X64 ??
    process.env.ONYX_WEBVIEW2_RUNTIME_X64 ??
    join(repoRoot, 'zig-out', 'runtime-cache', WEBVIEW2_RUNTIME.filename);
  const runtime = validateWebView2RuntimeInstaller(runtimeInstallerPath, {
    expectedSha256: opts.runtimeInstallerSha256,
    minimumBytes: opts.runtimeInstallerMinimumBytes,
  });
  if (!runtime.ok) {
    for (const e of runtime.errors) err.write(`release-windows: ${e}\n`);
    return { ok: false, code: 1, errors: runtime.errors };
  }

  mkdirSync(paths.releaseDir, { recursive: true });
  const notice = honestyNotice({ version, host: `${process.platform}/${process.arch}` });
  writeFileSync(paths.noticePath, notice, 'utf8');

  const createZip = opts.createZip ?? createPackageZip;
  const zipResult = createZip(packageDir, paths.zipPath, {
    injectFiles: {
      'UNSIGNED-WINDOWS.txt': notice,
      'Install-and-Run-Onyx.cmd': installAndRunCmd(),
      'runtime/THIRD-PARTY-RUNTIME.txt': webView2RuntimeNotice(runtime.hash),
      'runtime/WEBVIEW2-RUNTIME-SHA256.txt':
        `${runtime.hash}  ${WEBVIEW2_RUNTIME.filename}\r\n`,
    },
    injectBinaryFiles: {
      [`runtime/${WEBVIEW2_RUNTIME.filename}`]: runtimeInstallerPath,
    },
  });
  if (!zipResult.ok) {
    err.write(`release-windows: ${zipResult.error}\n`);
    return { ok: false, code: 1, errors: [zipResult.error] };
  }

  // Re-validate zip exists and is a zip (PK header)
  const zipBuf = readFileSync(paths.zipPath);
  if (zipBuf[0] !== 0x50 || zipBuf[1] !== 0x4b) {
    const msg = 'zip magic missing (not a PK zip)';
    err.write(`release-windows: ${msg}\n`);
    return { ok: false, code: 1, errors: [msg] };
  }

  const sum = writeZipChecksum(paths.zipPath, paths.sumsPath);
  if (!sum.ok) {
    err.write(`release-windows: ${sum.error}\n`);
    return { ok: false, code: 1, errors: [sum.error] };
  }

  log.write(`release-windows: package ${packageDir}\n`);
  log.write(`release-windows: zip     ${paths.zipPath}\n`);
  log.write(`release-windows: sha256  ${sum.hash}  ${paths.zipPath.split(/[/\\]/).pop()}\n`);
  log.write(`release-windows: notice  ${paths.noticePath}\n`);
  log.write(
    `release-windows: runtime ${runtime.bytes} bytes ${runtime.hash} ${WEBVIEW2_RUNTIME.filename}\n`,
  );
  log.write(
    'release-windows: UNSIGNED; offline WebView2 x64 installer INCLUDED; Windows GUI launch NOT verified on real Windows.\n',
  );

  return { ok: true, paths, hash: sum.hash };
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
  const args = process.argv.slice(2);
  const skipPackageBuild = args.includes('--skip-package-build');
  const packageDirArg = args.find((a) => a.startsWith('--package-dir='));
  const packageDir = packageDirArg ? packageDirArg.slice('--package-dir='.length) : undefined;

  const result = await runWindowsRelease({ skipPackageBuild, packageDir });
  if (!result.ok) process.exit(result.code ?? 1);
  process.exit(0);
}
