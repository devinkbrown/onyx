// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stage Onyx v0.1.3 FreeBSD/OpenBSD release artifacts into the static site tree
 * under dist/downloads/v0.1.3/ without committing binaries into git.
 *
 * Normal deploy does NOT call this. deploy.sh hooks only when an explicit env
 * flag is set (ONYX_STAGE_BSD_DOWNLOADS=1). Publishing mode
 * (ONYX_PUBLISH_BSD_DOWNLOADS=1 or --require) fails closed if artifacts are
 * missing.
 *
 * Does not commit, push, tag, or deploy.
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
  resolveReleasePaths,
  loadAlignedVersion,
  sha256Hex,
} from './release-unix.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Public download path segment under the static site (no leading slash). */
export const BSD_DOWNLOADS_PUBLIC_PREFIX = `downloads/v${RELEASE_PRODUCT_VERSION}`;

/** Lanes staged to the public download surface for v0.1.3. */
export const BSD_DOWNLOAD_LANES = /** @type {const} */ (['freebsd', 'openbsd']);

/**
 * @param {'freebsd' | 'openbsd'} lane
 * @param {string} [version]
 */
export function bsdPublicAssetNames(lane, version = RELEASE_PRODUCT_VERSION) {
  const base = releaseAssetBaseName(lane, version);
  return {
    base,
    archive: `${base}.tar.gz`,
    sha256: `${base}.sha256`,
    notice: `${base}.NOTICE.txt`,
    publicDir: `/downloads/v${version}`,
    archiveUrl: `/downloads/v${version}/${base}.tar.gz`,
    sha256Url: `/downloads/v${version}/${base}.sha256`,
    noticeUrl: `/downloads/v${version}/${base}.NOTICE.txt`,
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
  const version = input.version ?? RELEASE_PRODUCT_VERSION;
  const generatedAt = 'release-stage'; // deterministic; not a wall-clock claim
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
    },
    publicPrefix: `/downloads/v${version}`,
    lanes: (input.lanes ?? BSD_DOWNLOAD_LANES).map((lane) => {
      const names = bsdPublicAssetNames(lane, version);
      const art = input.artifacts.find((a) => a.lane === lane);
      return {
        lane,
        osLabel: lane === 'freebsd' ? 'FreeBSD' : 'OpenBSD',
        arch: 'x86_64',
        install: 'install.sh',
        primaryRuntimePackages:
          lane === 'freebsd' ? ['gtk4', 'webkit2-gtk_60'] : ['gtk+4', 'webkitgtk60'],
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
 * @param {string} [repoRoot]
 * @param {string} [version]
 */
export function resolveBsdStagePaths(repoRoot = REPO_ROOT, version = RELEASE_PRODUCT_VERSION) {
  const distRoot = join(repoRoot, 'dist');
  const stageDir = join(distRoot, 'downloads', `v${version}`);
  return { distRoot, stageDir, publicPrefix: `/downloads/v${version}` };
}

/**
 * Stage FreeBSD + OpenBSD release artifacts into dist/downloads/vX.Y.Z/.
 * @param {{
 *   repoRoot?: string,
 *   version?: string,
 *   require?: boolean,
 *   dryRun?: boolean,
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
export function stageBsdDownloads(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const log = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const requireAll = Boolean(opts.require);
  const dryRun = Boolean(opts.dryRun);

  const aligned = loadAlignedVersion(repoRoot);
  if (!aligned.ok) {
    for (const e of aligned.errors) err.write(`stage-bsd-downloads: ${e}\n`);
    return { ok: false, code: 1, errors: aligned.errors };
  }
  const version = opts.version ?? aligned.version;
  if (version !== RELEASE_PRODUCT_VERSION) {
    const msg = `refusing to stage version ${version}; tool pins ${RELEASE_PRODUCT_VERSION}`;
    err.write(`stage-bsd-downloads: ${msg}\n`);
    return { ok: false, code: 1, errors: [msg] };
  }

  const { distRoot, stageDir } = resolveBsdStagePaths(repoRoot, version);
  if (!existsSync(join(distRoot, 'index.html'))) {
    const msg = `missing ${join(distRoot, 'index.html')}; run pnpm build before staging downloads`;
    err.write(`stage-bsd-downloads: ${msg}\n`);
    return { ok: false, code: 1, errors: [msg] };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {Array<{ lane: 'freebsd' | 'openbsd', archive: string, sha256: string, notice: string, hash: string, bytes: number }>} */
  const artifacts = [];
  /** @type {string[]} */
  const staged = [];

  for (const lane of BSD_DOWNLOAD_LANES) {
    const paths = resolveReleasePaths(lane, repoRoot, version);
    const names = bsdPublicAssetNames(lane, version);
    const missing = [];
    if (!existsSync(paths.archivePath)) missing.push(paths.archivePath);
    if (!existsSync(paths.sumsPath)) missing.push(paths.sumsPath);
    if (!existsSync(paths.noticePath)) missing.push(paths.noticePath);
    if (missing.length) {
      const msg = `${lane}: missing release artifacts:\n  - ${missing.join('\n  - ')}`;
      if (requireAll) {
        errors.push(msg);
      } else {
        log.write(`stage-bsd-downloads: skip ${lane} (artifacts not present)\n`);
      }
      continue;
    }

    let sum;
    try {
      sum = parseSha256SumLine(readFileSync(paths.sumsPath, 'utf8'));
    } catch (e) {
      errors.push(`${lane}: cannot read sha256 file: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!sum || !/^[0-9a-f]{64}$/.test(sum.hash)) {
      errors.push(`${lane}: invalid sha256 file ${paths.sumsPath}`);
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
      bytes = statSync(paths.archivePath).size;
    } catch (e) {
      errors.push(`${lane}: cannot stat archive: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (bytes < 64) {
      errors.push(`${lane}: archive too small (${bytes} bytes): ${paths.archivePath}`);
      continue;
    }
    let actualHash;
    try {
      actualHash = sha256Hex(readFileSync(paths.archivePath));
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
      cpSync(paths.archivePath, destArchive);
      cpSync(paths.sumsPath, destSum);
      cpSync(paths.noticePath, destNotice);
      staged.push(destArchive, destSum, destNotice);
    } else {
      staged.push(
        join(stageDir, names.archive),
        join(stageDir, names.sha256),
        join(stageDir, names.notice),
      );
      log.write(`stage-bsd-downloads: [dry-run] would copy ${lane} artifacts -> ${stageDir}\n`);
    }
  }

  if (requireAll && artifacts.length !== BSD_DOWNLOAD_LANES.length) {
    if (!errors.length) {
      errors.push(
        `publishing mode requires both freebsd and openbsd artifacts under zig-out/release/; found ${artifacts.length}`,
      );
    }
  }

  if (errors.length) {
    for (const e of errors) err.write(`stage-bsd-downloads: ${e}\n`);
    return { ok: false, code: 1, errors };
  }

  if (!artifacts.length) {
    const msg =
      'no BSD release artifacts staged (run pnpm desktop:release:freebsd|openbsd first, or set ONYX_PUBLISH_BSD_DOWNLOADS=1 only when both exist)';
    if (requireAll) {
      err.write(`stage-bsd-downloads: ${msg}\n`);
      return { ok: false, code: 1, errors: [msg] };
    }
    log.write(`stage-bsd-downloads: ${msg}\n`);
    return {
      ok: true,
      stageDir,
      catalog: buildBsdDownloadCatalog({ version, artifacts: [] }),
      staged: [],
    };
  }

  const catalog = buildBsdDownloadCatalog({ version, artifacts });
  if (!dryRun) {
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(stageDir, 'README.txt'),
      [
        `Onyx ${version} BSD native download artifacts`,
        '',
        'UNSIGNED FreeBSD/OpenBSD host tarballs + sha256 + honesty notices.',
        'No codesign, notarization, virus-free, or auto-updater claim.',
        'Staged by tools/stage-bsd-downloads.mjs — do not commit binary tarballs.',
        '',
        ...artifacts.map(
          (a) =>
            `${a.lane}: ${a.archive}  sha256=${a.hash}  bytes=${a.bytes}`,
        ),
        '',
      ].join('\n'),
      'utf8',
    );
    staged.push(join(stageDir, 'catalog.json'), join(stageDir, 'README.txt'));
  }

  log.write(
    `stage-bsd-downloads: staged ${artifacts.length} lane(s) -> ${stageDir}${dryRun ? ' (dry-run)' : ''}\n`,
  );
  return { ok: true, stageDir, catalog, staged };
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
export function runStageBsdDownloadsCli(argv, opts = {}) {
  const args = argv.slice();
  let require = false;
  let dryRun = false;
  let clean = false;
  while (args.length) {
    const a = args.shift();
    if (a === '--require' || a === '--publish') require = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--clean') clean = true;
    else if (a === '--help' || a === '-h') {
      (opts.stdout ?? process.stdout).write(
        [
          'Usage: node tools/stage-bsd-downloads.mjs [--require|--publish] [--dry-run] [--clean]',
          '',
          'Copy zig-out/release/{freebsd,openbsd}-x86_64 unsigned artifacts into',
          `dist/${BSD_DOWNLOADS_PUBLIC_PREFIX}/ for site-local download URLs.`,
          '',
          '  --require / --publish  Fail closed if either BSD lane is missing',
          '  --dry-run              Plan only',
          '  --clean                Remove staged downloads dir before copy',
          '',
        ].join('\n'),
      );
      return 0;
    } else {
      (opts.stderr ?? process.stderr).write(`stage-bsd-downloads: unknown arg ${a}\n`);
      return 2;
    }
  }

  const env = opts.env ?? process.env;
  if (env.ONYX_PUBLISH_BSD_DOWNLOADS === '1') require = true;

  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const version = RELEASE_PRODUCT_VERSION;
  const { stageDir } = resolveBsdStagePaths(repoRoot, version);
  if (clean && !dryRun && existsSync(stageDir)) {
    rmSync(stageDir, { recursive: true, force: true });
  }

  const result = stageBsdDownloads({
    repoRoot,
    version,
    require,
    dryRun,
    stdout: opts.stdout,
    stderr: opts.stderr,
  });
  return result.ok ? 0 : result.code ?? 1;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exit(runStageBsdDownloadsCli(process.argv.slice(2)));
}
