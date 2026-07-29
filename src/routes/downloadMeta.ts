// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Site-local FreeBSD/OpenBSD download surface metadata for Onyx v0.1.3.
 * Asset basenames must stay aligned with tools/release-unix.mjs.
 * Checksums are loaded from staged /downloads/v0.1.3/*.sha256 or catalog.json
 * when present — never invented in the SPA.
 */

export const DOWNLOAD_PRODUCT_VERSION = '0.1.3' as const;

export type BsdDownloadLane = 'freebsd' | 'openbsd';

export interface BsdDownloadCard {
  lane: BsdDownloadLane;
  osLabel: string;
  arch: 'x86_64';
  title: string;
  summary: string;
  primaryPackages: readonly string[];
  packageManager: string;
  archiveName: string;
  archiveUrl: string;
  sha256Url: string;
  noticeUrl: string;
  installHint: string;
}

const PUBLIC_DIR = `/downloads/v${DOWNLOAD_PRODUCT_VERSION}`;

function assetBase(lane: BsdDownloadLane): string {
  return `onyx-${DOWNLOAD_PRODUCT_VERSION}-${lane}-x86_64-ReleaseFast-unsigned`;
}

export const BSD_DOWNLOAD_CARDS: readonly BsdDownloadCard[] = [
  {
    lane: 'freebsd',
    osLabel: 'FreeBSD',
    arch: 'x86_64',
    title: 'FreeBSD x86_64',
    summary:
      'Zig-native GTK + WebKitGTK host with install.sh. One unsigned tar.gz; not a ports package.',
    primaryPackages: ['gtk4', 'webkit2-gtk_60'],
    packageManager: 'pkg',
    archiveName: `${assetBase('freebsd')}.tar.gz`,
    archiveUrl: `${PUBLIC_DIR}/${assetBase('freebsd')}.tar.gz`,
    sha256Url: `${PUBLIC_DIR}/${assetBase('freebsd')}.sha256`,
    noticeUrl: `${PUBLIC_DIR}/${assetBase('freebsd')}.NOTICE.txt`,
    installHint: `see installSteps('freebsd')`,
  },
  {
    lane: 'openbsd',
    osLabel: 'OpenBSD',
    arch: 'x86_64',
    title: 'OpenBSD x86_64',
    summary:
      'Zig-native GTK + WebKitGTK host with install.sh. One unsigned tar.gz; not an official port.',
    primaryPackages: ['gtk+4', 'webkitgtk60'],
    packageManager: 'pkg_add',
    archiveName: `${assetBase('openbsd')}.tar.gz`,
    archiveUrl: `${PUBLIC_DIR}/${assetBase('openbsd')}.tar.gz`,
    sha256Url: `${PUBLIC_DIR}/${assetBase('openbsd')}.sha256`,
    noticeUrl: `${PUBLIC_DIR}/${assetBase('openbsd')}.NOTICE.txt`,
    installHint: `see installSteps('openbsd')`,
  },
] as const;

/** Top-level directory name inside the release tar.gz (matches packageDirName). */
export function packageRootName(lane: BsdDownloadLane): string {
  return `onyx-${DOWNLOAD_PRODUCT_VERSION}-${lane}-x86_64-ReleaseFast`;
}

export function installSteps(lane: BsdDownloadLane): string[] {
  const card = BSD_DOWNLOAD_CARDS.find((c) => c.lane === lane);
  if (!card) return [];
  const root = packageRootName(lane);
  const pkgs = card.primaryPackages.join(' ');
  return [
    `tar xzf ${card.archiveName}`,
    `cd ${root}`,
    './install.sh --help',
    `./install.sh                  # PREFIX=/usr/local; may need root+network for ${card.packageManager} ${pkgs}`,
    './install.sh --prefix "$HOME/onyx-prefix" --no-deps',
    './install.sh --dry-run',
  ];
}

export const DOWNLOAD_CATALOG_URL = `${PUBLIC_DIR}/catalog.json`;

/**
 * Parse a coreutils-style sha256sum body (hash + two spaces + name).
 */
export function parseSha256SumText(text: string): { hash: string; name: string } | null {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const m = line.match(/^([0-9a-fA-F]{64}) {2}(.+)$/);
  if (!m) return null;
  return { hash: m[1]!.toLowerCase(), name: m[2]! };
}

export interface DownloadCatalogLane {
  lane: string;
  present?: boolean;
  sha256?: string | null;
  archiveUrl?: string;
  bytes?: number | null;
}

export interface DownloadCatalog {
  version?: string;
  unsigned?: boolean;
  lanes?: DownloadCatalogLane[];
  claim?: {
    codesign?: boolean;
    virusFree?: boolean;
    notarization?: boolean;
  };
}

export function checksumFromCatalog(
  catalog: DownloadCatalog | null | undefined,
  lane: BsdDownloadLane,
): string | null {
  const entry = catalog?.lanes?.find((l) => l.lane === lane);
  if (!entry?.present) return null;
  const hash = entry.sha256;
  return typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : null;
}
