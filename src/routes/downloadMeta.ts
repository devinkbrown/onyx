// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Site-local public download surface metadata for Onyx v0.1.3.
 *
 * Active native package cards (4): Windows zip, Linux/FreeBSD/OpenBSD tar.gz.
 * macOS Intel + Apple Silicon are a combined coming-soon surface until genuine
 * Darwin builds ship (user builds on Mac; never fabricate DMGs on Linux).
 *
 * Asset basenames for active lanes stay aligned with tools/release-windows.mjs +
 * tools/release-unix.mjs + tools/stage-release-downloads.mjs.
 * Checksums load from staged /downloads/v0.1.3/*.sha256 or catalog.json when
 * present — never invented in the SPA.
 */

export const DOWNLOAD_PRODUCT_VERSION = '0.1.3' as const;

/** Public package identity tokens (active + planned). */
export type DownloadLane =
  | 'windows'
  | 'linux'
  | 'macos-x86_64'
  | 'macos-arm64'
  | 'freebsd'
  | 'openbsd';

/** Lanes that currently offer a real archive download on this site. */
export type ActiveDownloadLane = 'windows' | 'linux' | 'freebsd' | 'openbsd';

/** @deprecated Prefer DownloadLane — kept for callers that only mean BSD. */
export type BsdDownloadLane = 'freebsd' | 'openbsd';

export type DownloadArchiveExt = 'zip' | 'tar.gz' | 'dmg';

export type DownloadArch = 'x86_64' | 'arm64';

export interface DownloadCard {
  lane: ActiveDownloadLane;
  osLabel: string;
  arch: DownloadArch;
  title: string;
  summary: string;
  primaryPackages: readonly string[];
  packageManager: string | null;
  archiveExt: Exclude<DownloadArchiveExt, 'dmg'>;
  archiveName: string;
  archiveUrl: string;
  sha256Url: string;
  noticeUrl: string;
  /** Package manager used by install.sh; null when the runtime installer is bundled. */
  hasInstallScript: boolean;
  /** True only when the archive carries the runtime installer itself. */
  runtimeIncluded: boolean;
}

/** Combined macOS coming-soon card (no archive URLs — no dead download controls). */
export interface MacosComingSoonCard {
  id: 'macos';
  osLabel: string;
  title: string;
  summary: string;
  statusLabel: string;
  arches: readonly {
    id: 'macos-x86_64' | 'macos-arm64';
    label: string;
    arch: DownloadArch;
    note: string;
  }[];
  runtime: string;
  plannedPackage: string;
  honesty: string;
}

/** @deprecated Prefer DownloadCard. */
export type BsdDownloadCard = DownloadCard;

const PUBLIC_DIR = `/downloads/v${DOWNLOAD_PRODUCT_VERSION}`;

export function isMacosDownloadLane(lane: DownloadLane): boolean {
  return lane === 'macos-x86_64' || lane === 'macos-arm64';
}

export function isActiveDownloadLane(lane: DownloadLane): lane is ActiveDownloadLane {
  return lane === 'windows' || lane === 'linux' || lane === 'freebsd' || lane === 'openbsd';
}

/**
 * Basename without extension — must match release-*.mjs exactly for active lanes.
 * macOS basenames stay documented for future Darwin staging (not linked in UI).
 */
function assetBase(lane: DownloadLane): string {
  if (lane === 'macos-x86_64') {
    return `onyx-${DOWNLOAD_PRODUCT_VERSION}-macos-x86_64-ReleaseFast-unsigned`;
  }
  if (lane === 'macos-arm64') {
    return `onyx-${DOWNLOAD_PRODUCT_VERSION}-macos-arm64-ReleaseFast-unsigned`;
  }
  return `onyx-${DOWNLOAD_PRODUCT_VERSION}-${lane}-x86_64-ReleaseFast-unsigned`;
}

/** Documented future macOS asset names (not served until Darwin builds ship). */
export function plannedMacosAssetBase(arch: DownloadArch): string {
  return arch === 'arm64'
    ? assetBase('macos-arm64')
    : assetBase('macos-x86_64');
}

function card(
  partial: Omit<DownloadCard, 'archiveName' | 'archiveUrl' | 'sha256Url' | 'noticeUrl'> & {
    archiveExt: Exclude<DownloadArchiveExt, 'dmg'>;
  },
): DownloadCard {
  const base = assetBase(partial.lane);
  const archiveName = `${base}.${partial.archiveExt}`;
  return {
    ...partial,
    archiveName,
    archiveUrl: `${PUBLIC_DIR}/${archiveName}`,
    sha256Url: `${PUBLIC_DIR}/${base}.sha256`,
    noticeUrl: `${PUBLIC_DIR}/${base}.NOTICE.txt`,
  };
}

/**
 * Active public download cards in presentation order.
 * macOS is intentionally omitted — see MACOS_COMING_SOON.
 */
export const DOWNLOAD_CARDS: readonly DownloadCard[] = [
  card({
    lane: 'windows',
    osLabel: 'Windows',
    arch: 'x86_64',
    title: 'Windows x86_64',
    summary:
      'Native SDK directory package with the full offline Microsoft WebView2 x64 installer included. Extract once and use Install-and-Run-Onyx.cmd; Windows GUI launch is not claimed from this Linux release host.',
    primaryPackages: ['WebView2 Evergreen Runtime (offline x64 installer)'],
    packageManager: null,
    archiveExt: 'zip',
    hasInstallScript: false,
    runtimeIncluded: true,
  }),
  card({
    lane: 'linux',
    osLabel: 'Linux',
    arch: 'x86_64',
    title: 'Linux x86_64',
    summary:
      'Native SDK system-WebView package with install.sh. It resolves GTK 4 + WebKitGTK 6 through apt, dnf, or pacman, then installs the client under your chosen prefix.',
    primaryPackages: ['gtk4', 'webkitgtk-6.0'],
    packageManager: 'apt, dnf, or pacman',
    archiveExt: 'tar.gz',
    hasInstallScript: true,
    runtimeIncluded: false,
  }),
  card({
    lane: 'freebsd',
    osLabel: 'FreeBSD',
    arch: 'x86_64',
    title: 'FreeBSD x86_64',
    summary:
      'Zig-native GTK + WebKitGTK host with install.sh. One unsigned tar.gz; not a ports package. GUI launch not claimed from the Linux build host.',
    primaryPackages: ['gtk4', 'webkit2-gtk_60'],
    packageManager: 'pkg',
    archiveExt: 'tar.gz',
    hasInstallScript: true,
    runtimeIncluded: false,
  }),
  card({
    lane: 'openbsd',
    osLabel: 'OpenBSD',
    arch: 'x86_64',
    title: 'OpenBSD x86_64',
    summary:
      'Zig-native GTK + WebKitGTK host with install.sh. One unsigned tar.gz; not an official port. GUI launch not claimed from the Linux build host.',
    primaryPackages: ['gtk+4', 'webkitgtk60'],
    packageManager: 'pkg_add',
    archiveExt: 'tar.gz',
    hasInstallScript: true,
    runtimeIncluded: false,
  }),
] as const;

/**
 * Combined macOS surface: Intel + Apple Silicon planned, no fake download buttons.
 * Native DMGs ship only after genuine matching-arch Darwin builds (not fabricated here).
 */
export const MACOS_COMING_SOON: MacosComingSoonCard = {
  id: 'macos',
  osLabel: 'macOS',
  title: 'Mac — Intel & Apple Silicon',
  summary:
    'Native SDK system WKWebView packages for Intel (x86_64) and Apple Silicon (arm64) are being prepared on real Macs. No DMG is published on this site yet — we will not link a fake or incomplete download.',
  statusLabel: 'Coming soon',
  arches: [
    {
      id: 'macos-x86_64',
      label: 'Intel x86_64',
      arch: 'x86_64',
      note: 'DMG built only on a genuine Darwin Intel runner when ready.',
    },
    {
      id: 'macos-arm64',
      label: 'Apple Silicon arm64',
      arch: 'arm64',
      note: 'DMG built only on a genuine Darwin arm64 runner when ready.',
    },
  ],
  runtime: 'system WKWebView',
  plannedPackage: 'unsigned, unnotarized .app inside a DMG (separate arch lanes)',
  honesty:
    'Until macOS packages ship, use the browser or install the PWA — the full client, without waiting on a native shell.',
} as const;

/** BSD-only subset of DOWNLOAD_CARDS (compat). */
export const BSD_DOWNLOAD_CARDS: readonly DownloadCard[] = DOWNLOAD_CARDS.filter(
  (c) => c.lane === 'freebsd' || c.lane === 'openbsd',
);

/** Top-level directory name inside the release archive (matches packageDirName). */
export function packageRootName(lane: DownloadLane): string {
  if (lane === 'windows') {
    return `onyx-${DOWNLOAD_PRODUCT_VERSION}-windows-ReleaseFast`;
  }
  if (lane === 'linux') {
    return `onyx-${DOWNLOAD_PRODUCT_VERSION}-linux-ReleaseFast`;
  }
  if (isMacosDownloadLane(lane)) {
    return `onyx-${DOWNLOAD_PRODUCT_VERSION}-macos-ReleaseFast.app`;
  }
  // freebsd / openbsd include arch in package root
  return `onyx-${DOWNLOAD_PRODUCT_VERSION}-${lane}-x86_64-ReleaseFast`;
}

export function installSteps(lane: DownloadLane): string[] {
  if (isMacosDownloadLane(lane)) {
    // No public install steps while macOS is coming soon (no fake open/dmg flow).
    return [];
  }

  const c = DOWNLOAD_CARDS.find((x) => x.lane === lane);
  if (!c) return [];
  const root = packageRootName(lane);

  if (lane === 'windows') {
    return [
      `Expand-Archive ${c.archiveName} -DestinationPath .`,
      `cd ${root}`,
      '.\\Install-and-Run-Onyx.cmd',
      '# Full offline WebView2 x64 installer is included under runtime/',
      '# Runtime / GUI launch is NOT verified on the Linux release host',
    ];
  }

  if (lane === 'linux') {
    return [
      `tar xzf ${c.archiveName}`,
      `cd ${root}`,
      './install.sh --help',
      './install.sh                  # resolves runtime via apt/dnf/pacman',
      './install.sh --prefix "$HOME/.local" --no-deps',
      './install.sh --dry-run',
    ];
  }

  // BSD install.sh surface
  const pkgs = c.primaryPackages.join(' ');
  return [
    `tar xzf ${c.archiveName}`,
    `cd ${root}`,
    './install.sh --help',
    `./install.sh                  # PREFIX=/usr/local; may need root+network for ${c.packageManager} ${pkgs}`,
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
    macosAvailable?: boolean;
    windowsRuntimeVerified?: boolean;
    guiVerifiedOnReleaseHost?: boolean;
  };
  unavailable?: Array<{ lane: string; reason?: string }>;
}

export function checksumFromCatalog(
  catalog: DownloadCatalog | null | undefined,
  lane: DownloadLane,
): string | null {
  if (!isActiveDownloadLane(lane)) return null;
  const entry = catalog?.lanes?.find((l) => l.lane === lane);
  if (!entry?.present) return null;
  const hash = entry.sha256;
  return typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : null;
}
