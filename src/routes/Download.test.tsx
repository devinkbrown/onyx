// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import Download from './Download';
import {
  BSD_DOWNLOAD_CARDS,
  DOWNLOAD_PRODUCT_VERSION,
  checksumFromCatalog,
  installSteps,
  parseSha256SumText,
} from './downloadMeta';

describe('downloadMeta', () => {
  it('pins site-local v0.1.3 FreeBSD/OpenBSD asset URLs', () => {
    expect(DOWNLOAD_PRODUCT_VERSION).toBe('0.1.3');
    expect(BSD_DOWNLOAD_CARDS).toHaveLength(2);
    const fb = BSD_DOWNLOAD_CARDS.find((c) => c.lane === 'freebsd')!;
    const ob = BSD_DOWNLOAD_CARDS.find((c) => c.lane === 'openbsd')!;
    expect(fb.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(ob.archiveUrl).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(fb.primaryPackages).toEqual(['gtk4', 'webkit2-gtk_60']);
    expect(ob.primaryPackages).toEqual(['gtk+4', 'webkitgtk60']);
    expect(installSteps('freebsd').some((s) => s.includes('install.sh'))).toBe(true);
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
  });
});

describe('Download page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders FreeBSD and OpenBSD cards with site-local download links', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => null })),
    );
    const { getByTestId, getByRole, getAllByText, queryByText } = render(() => <Download />);
    expect(getByTestId('download-page')).toBeInTheDocument();
    expect(getByRole('heading', { level: 1, name: /FreeBSD & OpenBSD hosts/i })).toBeInTheDocument();
    expect(getByTestId('dl-card-freebsd')).toBeInTheDocument();
    expect(getByTestId('dl-card-openbsd')).toBeInTheDocument();
    expect(getByTestId('dl-download-freebsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-download-openbsd').getAttribute('href')).toBe(
      '/downloads/v0.1.3/onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned.tar.gz',
    );
    expect(getByTestId('dl-card-freebsd').textContent).toMatch(/gtk4/);
    expect(getByTestId('dl-card-openbsd').textContent).toMatch(/webkitgtk60/);
    expect(getAllByText(/unsigned tarball/i).length).toBeGreaterThan(0);
    // Honesty may mention virus-free/signing only to deny them.
    expect(queryByText(/is virus-free/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
    expect(queryByText(/codesigned and ready/i)).not.toBeInTheDocument();
    expect(getByTestId('download-page').textContent).toMatch(/does not claim third-party virus-free/i);
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
              lanes: [
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

  it('documents install.sh options and non-root --prefix path', () => {
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
});
