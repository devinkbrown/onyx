// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import Download from './Download';
import {
  BSD_DOWNLOAD_CARDS,
  DOWNLOAD_CARDS,
  DOWNLOAD_PRODUCT_VERSION,
  MACOS_COMING_SOON,
  checksumFromCatalog,
  installSteps,
  isActiveDownloadLane,
  isMacosDownloadLane,
  parseSha256SumText,
  plannedMacosAssetBase,
} from './downloadMeta';

describe('downloadMeta', () => {
  it('pins four active site-local packages; macOS is coming-soon metadata only', () => {
    expect(DOWNLOAD_PRODUCT_VERSION).toBe('0.1.3');
    expect(DOWNLOAD_CARDS).toHaveLength(4);
    expect(DOWNLOAD_CARDS.map((c) => c.lane)).toEqual([
      'windows',
      'linux',
      'freebsd',
      'openbsd',
    ]);
    expect(BSD_DOWNLOAD_CARDS).toHaveLength(2);
    expect(DOWNLOAD_CARDS.every((c) => isActiveDownloadLane(c.lane))).toBe(true);
    expect(DOWNLOAD_CARDS.some((c) => isMacosDownloadLane(c.lane))).toBe(false);

    const win = DOWNLOAD_CARDS.find((c) => c.lane === 'windows')!;
    const lin = DOWNLOAD_CARDS.find((c) => c.lane === 'linux')!;
    const fb = DOWNLOAD_CARDS.find((c) => c.lane === 'freebsd')!;
    const ob = DOWNLOAD_CARDS.find((c) => c.lane === 'openbsd')!;

    expect(win.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.zip',
    );
    expect(lin.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(fb.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(ob.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(win.archiveExt).toBe('zip');
    expect(fb.primaryPackages).toEqual(['gtk4', 'webkit2-gtk_60']);
    expect(ob.primaryPackages).toEqual(['gtk+4', 'webkitgtk60']);
    expect(installSteps('freebsd').some((s) => s.includes('install.sh'))).toBe(true);
    expect(installSteps('windows').some((s) => s.includes('onyx.exe'))).toBe(true);
    expect(installSteps('linux').some((s) => s.includes('bin/onyx'))).toBe(true);

    // macOS: combined coming-soon, planned asset names documented, no install steps
    expect(MACOS_COMING_SOON.id).toBe('macos');
    expect(MACOS_COMING_SOON.statusLabel).toMatch(/coming soon/i);
    expect(MACOS_COMING_SOON.arches.map((a) => a.arch)).toEqual(['x86_64', 'arm64']);
    expect(MACOS_COMING_SOON.summary).toMatch(/no DMG|not.*yet|coming/i);
    expect(MACOS_COMING_SOON.honesty).toMatch(/browser|PWA/i);
    expect(plannedMacosAssetBase('x86_64')).toBe(
      'onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned',
    );
    expect(plannedMacosAssetBase('arm64')).toBe(
      'onyx-0.1.3-macos-arm64-ReleaseFast-unsigned',
    );
    expect(isMacosDownloadLane('macos-x86_64')).toBe(true);
    expect(isMacosDownloadLane('macos-arm64')).toBe(true);
    expect(isMacosDownloadLane('linux')).toBe(false);
    expect(installSteps('macos-x86_64')).toEqual([]);
    expect(installSteps('macos-arm64')).toEqual([]);
  });

  it('parses checksums and catalog hashes fail-closed (active lanes only)', () => {
    expect(parseSha256SumText('not-a-hash')).toBeNull();
    const h = 'ab'.repeat(32);
    expect(parseSha256SumText(`${h}  file.tar.gz\n`)?.hash).toBe(h);
    expect(
      checksumFromCatalog(
        { lanes: [{ lane: 'freebsd', present: true, sha256: h }] },
        'freebsd',
      ),
    ).toBe(h);
    expect(
      checksumFromCatalog({ lanes: [{ lane: 'freebsd', present: false, sha256: h }] }, 'freebsd'),
    ).toBeNull();
    expect(
      checksumFromCatalog(
        { lanes: [{ lane: 'windows', present: true, sha256: h }] },
        'windows',
      ),
    ).toBe(h);
    // macOS catalog entries must not surface as active checksums
    expect(
      checksumFromCatalog(
        { lanes: [{ lane: 'macos-x86_64', present: true, sha256: h }] },
        'macos-x86_64',
      ),
    ).toBeNull();
    expect(
      checksumFromCatalog(
        { lanes: [{ lane: 'macos-arm64', present: true, sha256: h }] },
        'macos-arm64',
      ),
    ).toBeNull();
  });
});

describe('Download page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders four active lanes plus combined macOS coming-soon (no fake DMG controls)', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId, getByRole, queryByTestId, queryByText } = render(() => <Download />);
    expect(getByTestId('download-page')).toBeInTheDocument();
    expect(
      getByRole('heading', { level: 1, name: /Windows, Linux, FreeBSD & OpenBSD/i }),
    ).toBeInTheDocument();

    // Active native packages
    expect(getByTestId('dl-card-windows')).toBeInTheDocument();
    expect(getByTestId('dl-card-linux')).toBeInTheDocument();
    expect(getByTestId('dl-card-freebsd')).toBeInTheDocument();
    expect(getByTestId('dl-card-openbsd')).toBeInTheDocument();
    expect(getByTestId('dl-download-windows').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.zip',
    );
    expect(getByTestId('dl-download-linux').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-download-freebsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-download-openbsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-card-freebsd').textContent).toMatch(/gtk4/);
    expect(getByTestId('dl-card-openbsd').textContent).toMatch(/webkitgtk60/);
    expect(getByTestId('dl-card-windows').textContent).toMatch(/WebView2/i);

    // No per-arch macOS download cards or dead DMG links
    expect(queryByTestId('dl-card-macos-x86_64')).not.toBeInTheDocument();
    expect(queryByTestId('dl-card-macos-arm64')).not.toBeInTheDocument();
    expect(queryByTestId('dl-download-macos-x86_64')).not.toBeInTheDocument();
    expect(queryByTestId('dl-download-macos-arm64')).not.toBeInTheDocument();
    expect(queryByText(/Download DMG/i)).not.toBeInTheDocument();

    // Combined polished coming-soon with browser/PWA action
    const macCard = getByTestId('dl-card-macos');
    expect(macCard.getAttribute('data-state')).toBe('coming-soon');
    expect(getByTestId('dl-macos-status').textContent).toMatch(/coming soon/i);
    expect(macCard.textContent).toMatch(/Intel/i);
    expect(macCard.textContent).toMatch(/Apple Silicon/i);
    expect(macCard.textContent).toMatch(/WKWebView/i);
    expect(getByTestId('dl-macos-arch-x86_64')).toBeInTheDocument();
    expect(getByTestId('dl-macos-arch-arm64')).toBeInTheDocument();
    expect(getByTestId('dl-macos-open-app').getAttribute('href')).toBe('/app/');
    expect(queryByTestId('dl-macos-pwa-hint')).not.toBeInTheDocument();
    expect(getByTestId('dl-macos-honesty').textContent).toMatch(/PWA|browser/i);
    expect(getByTestId('download-page').textContent).toMatch(/coming soon/i);
    expect(getByTestId('download-page').textContent).toMatch(/never fabricated/i);
    expect(getByTestId('download-page').textContent).toMatch(/does not claim third-party virus-free/i);

    expect(queryByText(/is virus-free/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
    expect(queryByText(/codesigned and ready/i)).not.toBeInTheDocument();
    expect(document.title).toMatch(/Download Onyx/i);
  });

  it('shows checksum when sha256 sidecar fetch succeeds and supports copy', async () => {
    const hash = 'cd'.repeat(32);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('catalog.json')) {
          return {
            ok: true,
            json: async () => ({
              version: '0.1.3',
              unsigned: true,
              claim: { macosAvailable: false, windowsRuntimeVerified: false, notarization: false },
              lanes: [
                { lane: 'windows', present: true, sha256: hash },
                { lane: 'linux', present: true, sha256: hash },
                { lane: 'freebsd', present: true, sha256: hash },
                { lane: 'openbsd', present: true, sha256: hash },
              ],
            }),
          };
        }
        if (url.endsWith('.sha256')) {
          return {
            ok: true,
            text: async () => `${hash}  onyx.tgz\n`,
          };
        }
        return { ok: false, status: 404, text: async () => '', json: async () => null };
      }),
    );
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const { findByTestId, getByTestId } = render(() => <Download />);
    const hashEl = await findByTestId('dl-hash-freebsd');
    expect(hashEl.textContent).toBe(hash);
    getByTestId('dl-copy-hash-freebsd').click();
    expect(writeText).toHaveBeenCalledWith(hash);
  });

  it('documents install.sh options and non-root --prefix path for BSD', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId } = render(() => <Download />);
    const install = getByTestId('dl-install-freebsd').textContent ?? '';
    expect(install).toMatch(/install\.sh --help/);
    expect(install).toMatch(/--prefix/);
    expect(install).toMatch(/--no-deps/);
    expect(install).toMatch(/--dry-run/);
  });

  it('documents Windows zip extract path without install.sh', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId } = render(() => <Download />);
    const steps = getByTestId('dl-install-windows').textContent ?? '';
    expect(steps).toMatch(/Expand-Archive|onyx\.exe/i);
    expect(steps).not.toMatch(/install\.sh/);
  });

  it('does not render macOS install steps or DMG open paths while coming soon', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId, queryByTestId } = render(() => <Download />);
    expect(queryByTestId('dl-install-macos-x86_64')).not.toBeInTheDocument();
    expect(queryByTestId('dl-install-macos-arm64')).not.toBeInTheDocument();
    const page = getByTestId('download-page').textContent ?? '';
    expect(page).not.toMatch(/open onyx-0\.1\.3-macos-/i);
    expect(page).toMatch(/not published yet/i);
  });
});
