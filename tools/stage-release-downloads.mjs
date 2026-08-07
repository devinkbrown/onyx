// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stage Onyx v0.1.3 public release artifacts into the static site tree under
 * dist/downloads/v0.1.3/ without committing binaries into git.
 *
 * Public lanes (unsigned only) — six total:
 *   windows       — zip  (tools/release-windows.mjs)
 *   linux         — tar.gz (tools/release-unix.mjs linux)
 *   macos-x86_64  — dmg  (tools/release-unix.mjs macos on Intel Darwin)
 *   macos-arm64   — dmg  (tools/release-unix.mjs macos on Apple Silicon Darwin)
 *   freebsd       — tar.gz (tools/release-unix.mjs freebsd)
 *   openbsd       — tar.gz (tools/release-unix.mjs openbsd)
 *
 * Staging only copies pre-built zig-out/release artifacts. It never fabricates
 * a macOS DMG on Linux. Produce macOS with pnpm desktop:release:macos on a
 * real matching-arch Darwin host (or the macos-release GitHub Actions matrix),
 * then stage.
 *
 * Normal deploy does NOT call this. deploy.sh hooks only when an explicit env
 * flag is set (ONYX_STAGE_RELEASE_DOWNLOADS=1 or legacy ONYX_STAGE_BSD_DOWNLOADS=1).
 * Publishing mode (ONYX_PUBLISH_RELEASE_DOWNLOADS=1, legacy ONYX_PUBLISH_BSD_DOWNLOADS=1,
 * or --require) fails closed if any of the six public lanes is missing.
 *
 * Does not commit, push, tag, build, or deploy.
 */
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
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_PRODUCT_VERSION,
  releaseAssetBaseName,
  resolveReleasePaths as resolveUnixReleasePaths,
  loadAlignedVersion,
  sha256Hex,
} from './release-unix.mjs';
import {
  releaseZipBaseName,
  resolveReleasePaths as resolveWindowsReleasePaths,
} from './release-windows.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Public download path segment under the static site (no leading slash). */
export const DOWNLOADS_PUBLIC_PREFIX = `downloads/v${RELEASE_PRODUCT_VERSION}`;

/** @deprecated Prefer DOWNLOADS_PUBLIC_PREFIX — kept for stage-bsd-downloads callers. */
export const BSD_DOWNLOADS_PUBLIC_PREFIX = DOWNLOADS_PUBLIC_PREFIX;

/**
 * Lanes staged to the public download surface for v0.1.3.
 * Order is presentation order on /download/.
 * @type {readonly ['windows', 'linux', 'macos-x86_64', 'macos-arm64', 'freebsd', 'openbsd']}
 */
export const PUBLIC_DOWNLOAD_LANES = /** @type {const} */ ([
  'windows',
  'linux',
  'macos-x86_64',
  'macos-arm64',
  'freebsd',
  'openbsd',
]);

/** BSD-only subset (compat + catalog filters). */
export const BSD_DOWNLOAD_LANES = /** @type {const} */ (['freebsd', 'openbsd']);

/** macOS public lanes (Intel + Apple Silicon). */
export const MACOS_DOWNLOAD_LANES = /** @type {const} */ (['macos-x86_64', 'macos-arm64']);

/**
 * Historically held macOS while Linux could not stage it. Now empty — macOS is
 * a real public lane (artifacts still must be Darwin-built, never fabricated).
 * @type {readonly string[]}
 */
export const UNAVAILABLE_DOWNLOAD_LANES = /** @type {const} */ ([]);

/**
 * @typedef {'windows' | 'linux' | 'macos-x86_64' | 'macos-arm64' | 'freebsd' | 'openbsd'} PublicDownloadLane
 */

/**
 * @param {string} lane
 * @returns {'x86_64' | 'arm64' | null}
 */
export function macosArchFromPublicLane(lane) {
  if (lane === 'macos-x86_64') return 'x86_64';
  if (lane === 'macos-arm64') return 'arm64';
  return null;
}

/**
 * @param {string} lane
 * @returns {boolean}
 */
export function isMacosPublicLane(lane) {
  return macosArchFromPublicLane(lane) !== null;
}

/**
 * Human labels / install surface metadata for the catalog.
 * @type {Record<PublicDownloadLane, {
 *   osLabel: string,
 *   arch: 'x86_64' | 'arm64',
 *   archiveExt: 'zip' | 'tar.gz' | 'dmg',
 *   install: string | null,
 *   primaryRuntimePackages: readonly string[],
 * }>}
 */
export const LANE_META = {
  windows: {
    osLabel: 'Windows',
    arch: 'x86_64',
    archiveExt: 'zip',
    install: null,
    primaryRuntimePackages: ['WebView2 Evergreen Runtime'],
  },
  linux: {
    osLabel: 'Linux',
    arch: 'x86_64',
    archiveExt: 'tar.gz',
    install: null,
    primaryRuntimePackages: ['gtk4', 'webkitgtk-6.0'],
  },
  'macos-x86_64': {
    osLabel: 'macOS Intel',
    arch: 'x86_64',
    archiveExt: 'dmg',
    install: null,
    primaryRuntimePackages: ['system WKWebView'],
  },
  'macos-arm64': {
    osLabel: 'macOS Apple Silicon',
    arch: 'arm64',
    archiveExt: 'dmg',
    install: null,
    primaryRuntimePackages: ['system WKWebView'],
  },
  freebsd: {
    osLabel: 'FreeBSD',
    arch: 'x86_64',
    archiveExt: 'tar.gz',
    install: 'install.sh',
    primaryRuntimePackages: ['gtk4', 'webkit2-gtk_60'],
  },
  openbsd: {
    osLabel: 'OpenBSD',
    arch: 'x86_64',
    archiveExt: 'tar.gz',
    install: 'install.sh',
    primaryRuntimePackages: ['gtk+4', 'webkitgtk60'],
  },
};

/**
 * Public asset basenames + URLs for one lane.
 * Basenames must match release-windows.mjs / release-unix.mjs exactly
 * (macOS includes arch token: macos-x86_64 | macos-arm64).
 * @param {PublicDownloadLane} lane
 * @param {string} [version]
 */
export function publicAssetNames(lane, version = RELEASE_PRODUCT_VERSION) {
  const meta = LANE_META[lane];
  if (!meta) {
    throw new Error(`unknown public download lane: ${lane}`);
  }
  const macArch = macosArchFromPublicLane(lane);
  const base =
    lane === 'windows'
      ? releaseZipBaseName(version)
      : macArch
        ? releaseAssetBaseName('macos', version, undefined, macArch)
        : releaseAssetBaseName(/** @type {'linux' | 'freebsd' | 'openbsd'} */ (lane), version);
  const archive = `${base}.${meta.archiveExt}`;
  return {
    base,
    archive,
    sha256: `${base}.sha256`,
    notice: `${base}.NOTICE.txt`,
    publicDir: `/downloads/v${version}`,
    archiveUrl: `/downloads/v${version}/${archive}`,
    sha256Url: `/downloads/v${version}/${base}.sha256`,
    noticeUrl: `/downloads/v${version}/${base}.NOTICE.txt`,
    archiveExt: meta.archiveExt,
  };
}

/**
 * @deprecated Prefer publicAssetNames — BSD-only name kept for callers.
 * @param {'freebsd' | 'openbsd'} lane
 * @param {string} [version]
 */
export function bsdPublicAssetNames(lane, version = RELEASE_PRODUCT_VERSION) {
  return publicAssetNames(lane, version);
}

/**
 * Resolve on-disk release artifact paths for a public lane.
 * @param {PublicDownloadLane} lane
 * @param {string} [repoRoot]
 * @param {string} [version]
 */
export function resolveLaneArtifactPaths(lane, repoRoot = REPO_ROOT, version = RELEASE_PRODUCT_VERSION) {
  const names = publicAssetNames(lane, version);
  if (lane === 'windows') {
    const paths = resolveWindowsReleasePaths(repoRoot, version);
    return {
      lane,
      archivePath: paths.zipPath,
      sumsPath: paths.sumsPath,
      noticePath: paths.noticePath,
      releaseDir: paths.releaseDir,
      names,
    };
  }
  const macArch = macosArchFromPublicLane(lane);
  if (macArch) {
    const paths = resolveUnixReleasePaths('macos', repoRoot, version, macArch);
    return {
      lane,
      archivePath: paths.archivePath,
      sumsPath: paths.sumsPath,
      noticePath: paths.noticePath,
      releaseDir: paths.releaseDir,
      names,
    };
  }
  const paths = resolveUnixReleasePaths(
    /** @type {'linux' | 'freebsd' | 'openbsd'} */ (lane),
    repoRoot,
    version,
  );
  return {
    lane,
    archivePath: paths.archivePath,
    sumsPath: paths.sumsPath,
    noticePath: paths.noticePath,
    releaseDir: paths.releaseDir,
    names,
  };
}

/**
 * Parse a single coreutils-style sha256sum line.
 * @param {string} text
 * @returns {{ hash: string, name: string } | null}
 */
export function parseSha256SumLine(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const m = line.match(/^([0-9a-fA-F]{64})  (.+)$/);
  if (!m) return null;
  return { hash: m[1].toLowerCase(), name: m[2] };
}

/**
 * Catalog entry shape written next to staged artifacts for the SPA download page.
 * @param {{
 *   version?: string,
 *   lanes?: ReadonlyArray<PublicDownloadLane>,
 *   artifacts: Array<{
 *     lane: PublicDownloadLane,
 *     archive: string,
 *     sha256: string,
 *     notice: string,
 *     hash: string,
 *     bytes: number,
 *   }>,
 * }} input
 */
export function buildDownloadCatalog(input) {
  const version = input.version ?? RELEASE_PRODUCT_VERSION;
  const generatedAt = 'release-stage'; // deterministic; not a wall-clock claim
  const laneList = input.lanes ?? PUBLIC_DOWNLOAD_LANES;
  const macosPresent = input.artifacts.some((a) => isMacosPublicLane(a.lane));
  return {
    version,
    product: 'onyx',
    signing: 'none',
    unsigned: true,
    claim: {
      codesign: false,
      notarization: false,
      virusFree: false,
      autoUpdater: false,
      guiVerifiedOnReleaseHost: false,
      windowsRuntimeVerified: false,
      // true when any real macOS DMG was staged (Intel and/or Apple Silicon)
      macosAvailable: macosPresent,
    },
    unavailable: UNAVAILABLE_DOWNLOAD_LANES.map((lane) => ({
      lane,
      reason: 'unavailable',
    })),
    publicPrefix: `/downloads/v${version}`,
    lanes: laneList.map((lane) => {
      const names = publicAssetNames(lane, version);
      const meta = LANE_META[lane];
      const art = input.artifacts.find((a) => a.lane === lane);
      return {
        lane,
        osLabel: meta.osLabel,
        arch: meta.arch,
        archiveExt: meta.archiveExt,
        install: meta.install,
        primaryRuntimePackages: [...meta.primaryRuntimePackages],
        archive: names.archive,
        archiveUrl: names.archiveUrl,
        sha256Url: names.sha256Url,
        noticeUrl: names.noticeUrl,
        sha256: art?.hash ?? null,
        bytes: art?.bytes ?? null,
        present: Boolean(art),
      };
    }),
    generatedAt,
  };
}

/**
 * @deprecated Prefer buildDownloadCatalog.
 * @param {{
 *   version?: string,
 *   lanes?: ReadonlyArray<'freebsd' | 'openbsd'>,
 *   artifacts: Array<{
 *     lane: 'freebsd' | 'openbsd',
 *     archive: string,
 *     sha256: string,
 *     notice: string,
 *     hash: string,
 *     bytes: number,
 *   }>,
 * }} input
 */
export function buildBsdDownloadCatalog(input) {
  return buildDownloadCatalog({
    version: input.version,
    lanes: input.lanes ?? BSD_DOWNLOAD_LANES,
    artifacts: input.artifacts,
  });
}

/**
 * @param {string} [repoRoot]
 * @param {string} [version]
 */
export function resolveDownloadStagePaths(repoRoot = REPO_ROOT, version = RELEASE_PRODUCT_VERSION) {
  const distRoot = join(repoRoot, 'dist');
  const stageDir = join(distRoot, 'downloads', `v${version}`);
  return { distRoot, stageDir, publicPrefix: `/downloads/v${version}` };
}

/** @deprecated Prefer resolveDownloadStagePaths. */
export function resolveBsdStagePaths(repoRoot = REPO_ROOT, version = RELEASE_PRODUCT_VERSION) {
  return resolveDownloadStagePaths(repoRoot, version);
}

/**
 * Stage public release artifacts into dist/downloads/vX.Y.Z/.
 * @param {{
 *   repoRoot?: string,
 *   version?: string,
 *   require?: boolean,
 *   dryRun?: boolean,
 *   lanes?: ReadonlyArray<PublicDownloadLane>,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 * @returns {{
 *   ok: true,
 *   stageDir: string,
 *   catalog: object,
 *   staged: string[],
 * } | {
 *   ok: false,
 *   code: number,
 *   errors: string[],
 * }}
 */
export function stageReleaseDownloads(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const requireAll = Boolean(opts.require);
  const dryRun = Boolean(opts.dryRun);
  const lanes = opts.lanes ?? PUBLIC_DOWNLOAD_LANES;
  const logPrefix = 'stage-release-downloads';

  const aligned = loadAlignedVersion(repoRoot);
  if (!aligned.ok) {
    for (const e of aligned.errors) err.write(`${logPrefix}: ${e}\n`);
    return { ok: false, code: 1, errors: aligned.errors };
  }
  const version = opts.version ?? aligned.version;
  if (version !== RELEASE_PRODUCT_VERSION) {
    const msg = `refusing to stage version ${version}; tool pins ${RELEASE_PRODUCT_VERSION}`;
    err.write(`${logPrefix}: ${msg}\n`);
    return { ok: false, code: 1, errors: [msg] };
  }

  for (const lane of lanes) {
    if (!LANE_META[/** @type {PublicDownloadLane} */ (lane)]) {
      const msg = `refusing lane ${String(lane)}; public surface is windows|linux|macos-x86_64|macos-arm64|freebsd|openbsd only`;
      err.write(`${logPrefix}: ${msg}\n`);
      return { ok: false, code: 1, errors: [msg] };
    }
  }

  const { distRoot, stageDir } = resolveDownloadStagePaths(repoRoot, version);
  if (!existsSync(join(distRoot, 'index.html'))) {
    const msg = `missing ${join(distRoot, 'index.html')}; run pnpm build before staging downloads`;
    err.write(`${logPrefix}: ${msg}\n`);
    return { ok: false, code: 1, errors: [msg] };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {Array<{ lane: PublicDownloadLane, archive: string, sha256: string, notice: string, hash: string, bytes: number }>} */
  const artifacts = [];
  /** @type {string[]} */
  const staged = [];

  for (const lane of lanes) {
    const { archivePath, sumsPath, noticePath, names } = resolveLaneArtifactPaths(
      lane,
      repoRoot,
      version,
    );
    const missing = [];
    if (!existsSync(archivePath)) missing.push(archivePath);
    if (!existsSync(sumsPath)) missing.push(sumsPath);
    if (!existsSync(noticePath)) missing.push(noticePath);
    if (missing.length) {
      const msg = `${lane}: missing release artifacts:\n  - ${missing.join('\n  - ')}`;
      if (requireAll) {
        errors.push(msg);
      } else {
        log.write(`${logPrefix}: skip ${lane} (artifacts not present)\n`);
      }
      continue;
    }

    let sum;
    try {
      sum = parseSha256SumLine(readFileSync(sumsPath, 'utf8'));
    } catch (e) {
      errors.push(`${lane}: cannot read sha256 file: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!sum || !/^[0-9a-f]{64}$/.test(sum.hash)) {
      errors.push(`${lane}: invalid sha256 file ${sumsPath}`);
      continue;
    }
    if (sum.name !== names.archive) {
      errors.push(
        `${lane}: sha256 name ${JSON.stringify(sum.name)} does not match ${names.archive}`,
      );
      continue;
    }

    let bytes = 0;
    try {
      bytes = statSync(archivePath).size;
    } catch (e) {
      errors.push(`${lane}: cannot stat archive: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (bytes < 64) {
      errors.push(`${lane}: archive too small (${bytes} bytes): ${archivePath}`);
      continue;
    }
    let actualHash;
    try {
      actualHash = sha256Hex(readFileSync(archivePath));
    } catch (e) {
      errors.push(`${lane}: cannot hash archive: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (actualHash !== sum.hash) {
      errors.push(
        `${lane}: sha256 mismatch for ${names.archive}: sidecar=${sum.hash} actual=${actualHash}`,
      );
      continue;
    }

    artifacts.push({
      lane,
      archive: names.archive,
      sha256: names.sha256,
      notice: names.notice,
      hash: sum.hash,
      bytes,
    });

    if (!dryRun) {
      mkdirSync(stageDir, { recursive: true });
      const destArchive = join(stageDir, names.archive);
      const destSum = join(stageDir, names.sha256);
      const destNotice = join(stageDir, names.notice);
      cpSync(archivePath, destArchive);
      cpSync(sumsPath, destSum);
      cpSync(noticePath, destNotice);
      staged.push(destArchive, destSum, destNotice);
    } else {
      staged.push(
        join(stageDir, names.archive),
        join(stageDir, names.sha256),
        join(stageDir, names.notice),
      );
      log.write(`${logPrefix}: [dry-run] would copy ${lane} artifacts -> ${stageDir}\n`);
    }
  }

  if (requireAll && artifacts.length !== lanes.length) {
    if (!errors.length) {
      errors.push(
        `publishing mode requires all public lanes (${lanes.join(', ')}) under zig-out/release/; found ${artifacts.length}`,
      );
    }
  }

  if (errors.length) {
    for (const e of errors) err.write(`${logPrefix}: ${e}\n`);
    return { ok: false, code: 1, errors };
  }

  if (!artifacts.length) {
    const msg =
      'no release artifacts staged (run pnpm desktop:release:{windows,linux,macos,freebsd,openbsd} first — macOS Intel on GHA macos-15-intel / Apple Silicon on macos-15; set ONYX_PUBLISH_RELEASE_DOWNLOADS=1 only when all six public lanes exist)';
    if (requireAll) {
      err.write(`${logPrefix}: ${msg}\n`);
      return { ok: false, code: 1, errors: [msg] };
    }
    log.write(`${logPrefix}: ${msg}\n`);
    return {
      ok: true,
      stageDir,
      catalog: buildDownloadCatalog({ version, lanes, artifacts: [] }),
      staged: [],
    };
  }

  const catalog = buildDownloadCatalog({ version, lanes, artifacts });
  if (!dryRun) {
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(stageDir, 'README.txt'),
      [
        `Onyx ${version} public native download artifacts`,
        '',
        'UNSIGNED Windows zip + Linux/FreeBSD/OpenBSD tar.gz + macOS Intel/Apple Silicon DMGs + sha256 + honesty notices.',
        'No codesign, notarization, virus-free, auto-updater, or GUI-verified claim.',
        'macOS DMGs must be produced on genuine matching-arch Darwin (pnpm desktop:release:macos / macos-release matrix); never fabricated on Linux.',
        'Staged by tools/stage-release-downloads.mjs — do not commit binary archives.',
        '',
        ...artifacts.map(
          (a) => `${a.lane}: ${a.archive}  sha256=${a.hash}  bytes=${a.bytes}`,
        ),
        '',
      ].join('\n'),
      'utf8',
    );
    staged.push(join(stageDir, 'catalog.json'), join(stageDir, 'README.txt'));
  }

  log.write(
    `${logPrefix}: staged ${artifacts.length} lane(s) -> ${stageDir}${dryRun ? ' (dry-run)' : ''}\n`,
  );
  return { ok: true, stageDir, catalog, staged };
}

/**
 * @deprecated Prefer stageReleaseDownloads (now multi-target).
 * Stages the full public surface (windows+linux+macos Intel/ARM+bsd) — not BSD-only.
 */
export function stageBsdDownloads(opts = {}) {
  return stageReleaseDownloads(opts);
}

/**
 * CLI entry.
 * @param {string[]} argv
 * @param {{
 *   repoRoot?: string,
 *   env?: NodeJS.ProcessEnv,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 */
export function runStageReleaseDownloadsCli(argv, opts = {}) {
  const args = argv.slice();
  let require = false;
  let dryRun = false;
  let clean = false;
  const logPrefix = 'stage-release-downloads';
  while (args.length) {
    const a = args.shift();
    if (a === '--require' || a === '--publish') require = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--clean') clean = true;
    else if (a === '--help' || a === '-h') {
      (opts.stdout ?? process.stdout).write(
        [
          'Usage: node tools/stage-release-downloads.mjs [--require|--publish] [--dry-run] [--clean]',
          '',
          'Copy zig-out/release/{windows-x86_64,linux-x86_64,macos-x86_64,macos-arm64,freebsd-x86_64,openbsd-x86_64}',
          `unsigned artifacts into dist/${DOWNLOADS_PUBLIC_PREFIX}/ for site-local download URLs.`,
          'macOS artifacts are Darwin-built only (never fabricated here); stage copies if present.',
          '',
          '  --require / --publish  Fail closed if any of the six public lanes is missing',
          '  --dry-run              Plan only',
          '  --clean                Remove staged downloads dir before copy',
          '',
          'Env:',
          '  ONYX_PUBLISH_RELEASE_DOWNLOADS=1  (or legacy ONYX_PUBLISH_BSD_DOWNLOADS=1) → --require',
          '',
        ].join('\n'),
      );
      return 0;
    } else {
      (opts.stderr ?? process.stderr).write(`${logPrefix}: unknown arg ${a}\n`);
      return 2;
    }
  }

  const env = opts.env ?? process.env;
  if (
    env.ONYX_PUBLISH_RELEASE_DOWNLOADS === '1' ||
    env.ONYX_PUBLISH_BSD_DOWNLOADS === '1'
  ) {
    require = true;
  }

  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const version = RELEASE_PRODUCT_VERSION;
  const { stageDir } = resolveDownloadStagePaths(repoRoot, version);
  if (clean && !dryRun && existsSync(stageDir)) {
    rmSync(stageDir, { recursive: true, force: true });
  }

  const result = stageReleaseDownloads({
    repoRoot,
    version,
    require,
    dryRun,
    stdout: opts.stdout,
    stderr: opts.stderr,
  });
  return result.ok ? 0 : result.code ?? 1;
}

/** @deprecated Prefer runStageReleaseDownloadsCli. */
export function runStageBsdDownloadsCli(argv, opts = {}) {
  return runStageReleaseDownloadsCli(argv, opts);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exit(runStageReleaseDownloadsCli(process.argv.slice(2)));
}
