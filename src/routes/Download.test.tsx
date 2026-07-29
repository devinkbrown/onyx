// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import Download from './Download';
import {
  BSD_DOWNLOAD_CARDS,
  DOWNLOAD_CARDS,
  DOWNLOAD_PRODUCT_VERSION,
  checksumFromCatalog,
  installSteps,
  isMacosDownloadLane,
  parseSha256SumText,
} from './downloadMeta';

describe('downloadMeta', () => {
  it('pins site-local v0.1.3 multi-platform asset URLs including dual macOS DMGs', () => {
    expect(DOWNLOAD_PRODUCT_VERSION).toBe('0.1.3');
    expect(DOWNLOAD_CARDS).toHaveLength(6);
    expect(DOWNLOAD_CARDS.map((c) => c.lane)).toEqual([
      'windows',
      'linux',
      'macos-x86_64',
      'macos-arm64',
      'freebsd',
      'openbsd',
    ]);
    expect(BSD_DOWNLOAD_CARDS).toHaveLength(2);

    const win = DOWNLOAD_CARDS.find((c) => c.lane === 'windows')!;
    const lin = DOWNLOAD_CARDS.find((c) => c.lane === 'linux')!;
    const macIntel = DOWNLOAD_CARDS.find((c) => c.lane === 'macos-x86_64')!;
    const macArm = DOWNLOAD_CARDS.find((c) => c.lane === 'macos-arm64')!;
    const fb = DOWNLOAD_CARDS.find((c) => c.lane === 'freebsd')!;
    const ob = DOWNLOAD_CARDS.find((c) => c.lane === 'openbsd')!;

    expect(win.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.zip',
    );
    expect(lin.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(macIntel.archiveName).toBe('onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg');
    expect(macIntel.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg',
    );
    expect(macArm.archiveName).toBe('onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg');
    expect(macArm.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg',
    );
    expect(macIntel.archiveExt).toBe('dmg');
    expect(macIntel.arch).toBe('x86_64');
    expect(macArm.arch).toBe('arm64');
    expect(macIntel.title).toMatch(/Intel x86_64/i);
    expect(macArm.title).toMatch(/Apple Silicon arm64/i);
    expect(macIntel.summary).toMatch(/WKWebView/i);
    expect(macArm.summary).toMatch(/WKWebView/i);
    expect(macIntel.summary).toMatch(/unsigned|unnotarized/i);
    expect(macArm.summary).toMatch(/Darwin|genuine/i);
    expect(isMacosDownloadLane('macos-x86_64')).toBe(true);
    expect(isMacosDownloadLane('macos-arm64')).toBe(true);
    expect(isMacosDownloadLane('linux')).toBe(false);
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
    expect(installSteps('macos-x86_64').some((s) => s.includes('open '))).toBe(true);
    expect(installSteps('macos-arm64').some((s) => s.includes('open '))).toBe(true);
    expect(installSteps('macos-x86_64').join('\n')).toMatch(/Gatekeeper|unsigned|unnotarized/i);
    expect(installSteps('macos-arm64').join('\n')).toMatch(/Apple Silicon|arm64/i);
  });

  it('parses checksums and catalog hashes fail-closed', () => {
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
    expect(
      checksumFromCatalog(
        { lanes: [{ lane: 'macos-x86_64', present: true, sha256: h }] },
        'macos-x86_64',
      ),
    ).toBe(h);
    expect(
      checksumFromCatalog(
        { lanes: [{ lane: 'macos-arm64', present: true, sha256: h }] },
        'macos-arm64',
      ),
    ).toBe(h);
  });
});

describe('Download page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders six public lanes with site-local download links and dual macOS honesty', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId, getByRole, getAllByText, queryByText } = render(() => <Download />);
    expect(getByTestId('download-page')).toBeInTheDocument();
    expect(
      getByRole('heading', { level: 1, name: /Windows, Linux, macOS, FreeBSD & OpenBSD/i }),
    ).toBeInTheDocument();
    expect(getByTestId('dl-card-windows')).toBeInTheDocument();
    expect(getByTestId('dl-card-linux')).toBeInTheDocument();
    expect(getByTestId('dl-card-macos-x86_64')).toBeInTheDocument();
    expect(getByTestId('dl-card-macos-arm64')).toBeInTheDocument();
    expect(getByTestId('dl-card-freebsd')).toBeInTheDocument();
    expect(getByTestId('dl-card-openbsd')).toBeInTheDocument();
    expect(getByTestId('dl-download-windows').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.zip',
    );
    expect(getByTestId('dl-download-linux').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-download-macos-x86_64').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-macos-x86_64-ReleaseFast-unsigned.dmg',
    );
    expect(getByTestId('dl-download-macos-arm64').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-macos-arm64-ReleaseFast-unsigned.dmg',
    );
    expect(getByTestId('dl-download-macos-x86_64').textContent).toMatch(/Download DMG/i);
    expect(getByTestId('dl-download-macos-arm64').textContent).toMatch(/Download DMG/i);
    expect(getByTestId('dl-download-freebsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-download-openbsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-card-macos-x86_64').textContent).toMatch(/Intel x86_64/i);
    expect(getByTestId('dl-card-macos-arm64').textContent).toMatch(/Apple Silicon arm64/i);
    expect(getByTestId('dl-card-macos-x86_64').textContent).toMatch(/WKWebView/i);
    expect(getByTestId('dl-card-macos-arm64').textContent).toMatch(/unsigned|unnotarized/i);
    expect(getByTestId('dl-card-macos-arm64').textContent).toMatch(/Darwin|genuine/i);
    expect(getByTestId('dl-card-freebsd').textContent).toMatch(/gtk4/);
    expect(getByTestId('dl-card-openbsd').textContent).toMatch(/webkitgtk60/);
    expect(getByTestId('dl-card-windows').textContent).toMatch(/WebView2/i);
    expect(getAllByText(/unsigned (tarball|zip|DMG)|unnotarized DMG/i).length).toBeGreaterThan(0);
    expect(queryByText(/is virus-free/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
    expect(queryByText(/codesigned and ready/i)).not.toBeInTheDocument();
    expect(getByTestId('download-page').textContent).toMatch(/never fabricated on Linux/i);
    expect(getByTestId('download-page').textContent).toMatch(/does not claim third-party virus-free/i);
    expect(getByTestId('download-page').textContent).toMatch(/Apple Silicon/i);
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
              claim: { macosAvailable: true, windowsRuntimeVerified: false, notarization: false },
              lanes: [
                { lane: 'windows', present: true, sha256: hash },
                { lane: 'linux', present: true, sha256: hash },
                { lane: 'macos-x86_64', present: true, sha256: hash },
                { lane: 'macos-arm64', present: true, sha256: hash },
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

  it('documents macOS Intel and Apple Silicon DMG open paths and Gatekeeper honesty', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId } = render(() => <Download />);
    const intel = getByTestId('dl-install-macos-x86_64').textContent ?? '';
    const arm = getByTestId('dl-install-macos-arm64').textContent ?? '';
    expect(intel).toMatch(/open onyx-0\.1\.3-macos-x86_64-ReleaseFast-unsigned\.dmg/);
    expect(arm).toMatch(/open onyx-0\.1\.3-macos-arm64-ReleaseFast-unsigned\.dmg/);
    expect(intel).toMatch(/Gatekeeper|unsigned|unnotarized/i);
    expect(arm).toMatch(/Apple Silicon|arm64/i);
    expect(intel).not.toMatch(/install\.sh/);
    expect(arm).not.toMatch(/install\.sh/);
  });
});
