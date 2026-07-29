// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Compatibility entry for the public release download stager.
 *
 * Prefer tools/stage-release-downloads.mjs
 * (windows + linux + macos-x86_64 + macos-arm64 + freebsd + openbsd).
 * This module re-exports the multi-target stager so existing scripts
 * (desktop:stage-bsd-downloads, ONYX_STAGE_BSD_DOWNLOADS) keep working.
 *
 * Publish mode requires all six public lanes (not BSD-only).
 * macOS DMGs must be Darwin-built first; staging never fabricates them on Linux.
 */
export {
  DOWNLOADS_PUBLIC_PREFIX,
  BSD_DOWNLOADS_PUBLIC_PREFIX,
  PUBLIC_DOWNLOAD_LANES,
  BSD_DOWNLOAD_LANES,
  MACOS_DOWNLOAD_LANES,
  UNAVAILABLE_DOWNLOAD_LANES,
  LANE_META,
  macosArchFromPublicLane,
  isMacosPublicLane,
  publicAssetNames,
  bsdPublicAssetNames,
  resolveLaneArtifactPaths,
  parseSha256SumLine,
  buildDownloadCatalog,
  buildBsdDownloadCatalog,
  resolveDownloadStagePaths,
  resolveBsdStagePaths,
  stageReleaseDownloads,
  stageBsdDownloads,
  runStageReleaseDownloadsCli,
  runStageBsdDownloadsCli,
} from './stage-release-downloads.mjs';

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runStageReleaseDownloadsCli } from './stage-release-downloads.mjs';

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exit(runStageReleaseDownloadsCli(process.argv.slice(2)));
}
