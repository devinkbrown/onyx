// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import Download from './Download';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));
import {
  BSD_DOWNLOAD_CARDS,
  DOWNLOAD_CARDS,
  DOWNLOAD_PRODUCT_VERSION,
  MACOS_COMING_SOON,
  checksumFromCatalog,
  downloadAvailability,
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
    expect(win.runtimeIncluded).toBe(true);
    expect(lin.hasInstallScript).toBe(true);
    expect(installSteps('windows').some((s) => s.includes('Install-and-Run-Onyx.cmd'))).toBe(true);
    expect(installSteps('linux').some((s) => s.includes('install.sh'))).toBe(true);

    // macOS: combined coming-soon, planned asset names documented, no install steps
    expect(MACOS_COMING_SOON.id).toBe('macos');
    expect(MACOS_COMING_SOON.statusLabel).toMatch(/coming soon/i);
    expect(MACOS_COMING_SOON.arches.map((a) => a.arch)).toEqual(['x86_64', 'arm64']);
    expect(MACOS_COMING_SOON.summary).toMatch(/no DMG|not.*yet|coming/i);
    expect(MACOS_COMING_SOON.honesty).toMatch(/browser|Home Screen/i);
    expect(MACOS_COMING_SOON.honesty).toMatch(/No store/);
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

    expect(downloadAvailability(undefined, 'loading', 'freebsd')).toBe('loading');
    expect(downloadAvailability(undefined, 'errored', 'freebsd')).toBe('unknown');
    expect(downloadAvailability({ lanes: [{ lane: 'freebsd', present: false }] }, 'ready', 'freebsd'))
      .toBe('unavailable');
    expect(downloadAvailability({ lanes: [{ lane: 'freebsd', present: true }] }, 'ready', 'freebsd'))
      .toBe('available');
    expect(downloadAvailability({ lanes: [] }, 'ready', 'freebsd')).toBe('unknown');
  });
});

describe('Download page', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses PublicFrame as the only document frame and exposes canonical navigation', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { container } = render(() => <Download />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Get Onyx' })).toHaveAttribute('id', 'public-main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#public-main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.dl-page')).toBeTruthy();
    expect(container.querySelector('.dl-browser-grid')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Native download artifacts' })).toBeInTheDocument();
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/This device.*Browser first/);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .getByRole('link', { name: 'Download' })).toHaveAttribute('aria-current', 'page');
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' })
      .filter((link) => link.classList.contains('public-frame__open'));
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('heading', { level: 1, name: /Get Onyx on this device/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Keep Onyx on this device' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What this is — and is not' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Desktop packages' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verify a download' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Planned macOS architectures' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'OnyxOS' })).toBeNull();
    expect(container.querySelector('a[href="/onyxos/"], a[href="/onyxos"]')).toBeNull();
    expect(container.textContent).not.toMatch(/onyxos/i);
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    render(() => <Download />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('turns the legacy install URL into the current package and runtime guide', () => {
    window.history.replaceState(null, '', '/install/');
    const { getByRole } = render(() => <Download />);

    expect(document.title).toBe('Get Onyx on this device — browser first');
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/download/',
    );
    expect(getByRole('heading', { name: 'Get Onyx on this device' })).toBeInTheDocument();
    expect(getByRole('heading', { name: /install on linux/i })).toBeInTheDocument();
    expect(getByRole('main', { name: 'Get Onyx' })).toHaveAttribute('id', 'public-main');
    expect(within(getByRole('navigation', { name: 'Primary navigation' }))
      .getByRole('link', { name: 'Download' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders four active lanes and distinguishes an unavailable catalog from missing artifacts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId, getByRole, queryByTestId, queryByText } = render(() => <Download />);
    expect(getByTestId('download-page')).toBeInTheDocument();
    expect(
      getByRole('heading', { level: 1, name: /Get Onyx on this device/i }),
    ).toBeInTheDocument();

    // Active native packages
    expect(getByTestId('dl-card-windows')).toBeInTheDocument();
    expect(getByTestId('dl-card-linux')).toBeInTheDocument();
    expect(getByTestId('dl-card-freebsd')).toBeInTheDocument();
    expect(getByTestId('dl-card-openbsd')).toBeInTheDocument();
    await waitFor(() => {
      expect(getByTestId('dl-status-windows')).toHaveAttribute('data-state', 'unknown');
    });
    expect(getByRole('status', { name: 'Download catalog status' })).toHaveAttribute('data-catalog-state', 'errored');
    expect(getByRole('status', { name: 'Download catalog status' })).toHaveTextContent(/controls are withheld/i);
    expect(queryByTestId('dl-download-windows')).not.toBeInTheDocument();
    expect(queryByTestId('dl-notice-windows')).not.toBeInTheDocument();
    expect(queryByTestId('dl-sha256-windows')).not.toBeInTheDocument();
    expect(getByTestId('dl-card-windows').textContent).toMatch(/could not be confirmed/i);
    expect(getByTestId('dl-card-freebsd').textContent).toMatch(/gtk4/);
    expect(getByTestId('dl-card-openbsd').textContent).toMatch(/webkitgtk60/);
    expect(getByTestId('dl-card-windows').textContent).toMatch(/WebView2/i);
    expect(getByTestId('dl-card-windows').textContent).toMatch(/Runtime included/i);
    expect(getByTestId('dl-card-linux').textContent).toMatch(/auto via install\.sh/i);

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
    expect(getByTestId('dl-macos-open-app')).toHaveClass('r-btn', 'ghost');
    expect(getByTestId('dl-macos-open-app')).not.toHaveClass('primary');
    expect(queryByTestId('dl-macos-pwa-hint')).not.toBeInTheDocument();
    expect(getByTestId('dl-macos-honesty').textContent).toMatch(/Home Screen|browser/i);
    expect(getByTestId('download-page').textContent).toMatch(/No store/);
    expect(getByTestId('download-page').textContent).not.toMatch(/beforeinstallprompt|iOS push|App Store|Play Store/i);
    expect(getByTestId('download-page').textContent).toMatch(/coming soon/i);
    expect(getByTestId('download-page').textContent).toMatch(/never fabricated/i);
    expect(getByTestId('download-page').textContent).toMatch(/does not claim third-party virus-free/i);

    expect(queryByText(/is virus-free/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
    expect(queryByText(/codesigned and ready/i)).not.toBeInTheDocument();
    expect(document.title).toMatch(/Get Onyx on this device/i);
    expect(getByTestId('dl-open-browser').getAttribute('href')).toBe('/app/');
    expect(getByRole('heading', { name: 'Keep Onyx on this device' })).toBeInTheDocument();
  });

  it('withholds every artifact control when the catalog authoritatively marks a lane missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('catalog.json')) {
          return {
            ok: true,
            json: async () => ({ lanes: [{ lane: 'freebsd', present: false }] }),
          };
        }
        return { ok: false, status: 404, text: async () => '' };
      }),
    );

    const { findByTestId, queryByTestId } = render(() => <Download />);
    const status = await findByTestId('dl-status-freebsd');
    await waitFor(() => expect(status).toHaveAttribute('data-state', 'unavailable'));
    expect(queryByTestId('dl-download-freebsd')).not.toBeInTheDocument();
    expect(queryByTestId('dl-notice-freebsd')).not.toBeInTheDocument();
    expect(queryByTestId('dl-sha256-freebsd')).not.toBeInTheDocument();
    expect(status.parentElement?.parentElement?.textContent).toMatch(/not published/i);
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
    expect(screen.getByRole('status', { name: 'Download catalog status' })).toHaveAttribute('data-catalog-state', 'ready');
    expect(screen.getByRole('status', { name: 'Download catalog status' })).toHaveTextContent(/each lane still has to report/i);
    expect(hashEl.textContent).toBe(hash);
    expect(getByTestId('dl-download-freebsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
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

  it('documents the Windows offline runtime install-and-run path', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId } = render(() => <Download />);
    const steps = getByTestId('dl-install-windows').textContent ?? '';
    expect(steps).toMatch(/Expand-Archive/i);
    expect(steps).toMatch(/Install-and-Run-Onyx\.cmd/i);
    expect(steps).toMatch(/offline WebView2/i);
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

describe('Download page — source structure', () => {
  const src = readFileSync(resolve(__dirname, 'Download.tsx'), 'utf8');
  const css = readFileSync(resolve(__dirname, 'download.css'), 'utf8');

  it('uses PublicFrame without duplicating document chrome', () => {
    expect(src).toContain('import { PublicFrame }');
    expect(src).toContain('currentPath="/download/"');
    expect(src).toContain('mainLabel="Get Onyx"');
    expect(src).not.toContain('<main');
    expect(src).not.toContain('<header');
    expect(src).not.toContain('<PublicFooter');
  });

  it('keeps route-scoped 44px targets, reduced-motion, and forced-colors', () => {
    expect(css).toContain('min-height: var(--target-min, 44px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('forced-colors');
    expect(css).toContain('@media (max-width: 42rem) and (max-height: 30rem)');
    expect(css).not.toContain('backdrop-filter');
  });

  it('keeps browser guidance before the artifact-led availability list', () => {
    expect(src).toContain('class="dl-browser-grid"');
    expect(src).toContain('class="dl-grid dl-artifact-list" role="list"');
    expect(src.indexOf('id="keep-here"')).toBeLessThan(src.indexOf('dl-artifact-list'));
    expect(src).toContain('Desktop packages are optional and unsigned.');
    expect(src).not.toContain('They stay further down this page, unsigned and honest.');
    expect(css).toContain('.dl-artifact-details');
    expect(css).toContain('.dl-catalog-receipt');
  });
});
