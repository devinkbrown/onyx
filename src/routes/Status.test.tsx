// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';

import StatusRoute from './Status';

const src = readFileSync(resolve(__dirname, 'Status.tsx'), 'utf8');
const css = readFileSync(resolve(__dirname, 'status.css'), 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

const NOW = Math.floor(Date.now() / 1000);

function statusResponse(status: Record<string, unknown>): (input: RequestInfo | URL) => Promise<Response> {
  return async () => new Response(
    JSON.stringify(status),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function meshStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generated_at: NOW,
    network: 'Onyx',
    node: 'status.example',
    uptime_seconds: 3660,
    users_online: 7,
    mesh: { quorum: true, partitioned: false, components: 1 },
    peers: [{ name: 'shore-a', state: 'linked', up: true, rtt_ms: 12.4, since_seconds: 120 }],
    ...overrides,
  };
}

function footerLinks() {
  return [...screen.getByRole('navigation', { name: 'Footer navigation' }).querySelectorAll('a')]
    .map((link) => ({ label: link.textContent, href: link.getAttribute('href') }));
}

describe('StatusRoute — community copy', () => {
  it('asks whether rooms are up and refuses operator theater', () => {
    expect(src).toContain('Are the rooms up tonight?');
    expect(src).toContain('One honest sentence');
    expect(src).toContain('The rooms are reachable tonight.');
    expect(src).toContain('The rooms are having trouble');
    expect(src).toContain('There is no public report, so we cannot claim health.');
    expect(src).not.toMatch(/users online/i);
    expect(src).not.toMatch(/observed state/i);
    expect(src).not.toMatch(/quorum observation/i);
    expect(src).not.toMatch(/vault backups/i);
    expect(src).not.toMatch(/peer-table|peer observations|RTT/i);
    expect(src).not.toMatch(/fetchBackupManifest/);
    expect(src).not.toMatch(/href="\/stats\/"/);
    expect(src).not.toMatch(/onyxos/i);
    expect(src).not.toMatch(/fully encrypted|group E2EE|passkeys?/i);
    expect(src).not.toMatch(/href="\/terms\/"/);
    expect(src).toContain('href="/roadmap/"');
  });

  it('keeps quiet-harbor type: Instrument Sans, Fraunces once, no Anton or glass', () => {
    expect(css).toContain('var(--font-sans)');
    expect((css.match(/var\(--font-serif\)/g) ?? []).length).toBe(1);
    expect(cssNoComments).not.toMatch(/Anton|Inter|purple|blurple|#5865[Ff]2/i);
    expect(cssNoComments).not.toContain('backdrop-filter');
    expect(cssNoComments).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).toContain('var(--target-min, 44px)');
  });
});

describe('StatusRoute', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses PublicFrame as the only document frame and exposes canonical navigation', async () => {
    const { container } = render(() => <StatusRoute />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Onyx network status' })).toHaveAttribute('id', 'public-main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#public-main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.status-route')).toBeTruthy();
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Tonight.*Status/);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'Status' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'Stats' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'OnyxOS' })).toBeNull();
    expect(footerLinks()).toEqual([
      { label: 'House rules', href: '/guidelines/' },
      { label: 'Privacy', href: '/privacy/' },
      { label: 'Contact', href: '/contact/' },
      { label: 'Status', href: '/status/' },
      { label: 'Guides', href: '/guides/' },
    ]);
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .queryByRole('link', { name: 'Stats' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .queryByRole('link', { name: 'OnyxOS' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .queryByRole('link', { name: 'Roadmap' })).toBeNull();
    expect(container.querySelector('a[href="/stats/"], a[href="/stats"]')).toBeNull();
    expect(container.querySelector('a[href="/onyxos/"], a[href="/onyxos"]')).toBeNull();
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('heading', { name: /are the rooms up tonight/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the roadmap/i })).toHaveAttribute('href', '/roadmap/');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/users online/i)).toBeNull();
    expect(screen.queryByText(/vault backups/i)).toBeNull();
    expect(screen.queryByText(/quorum/i)).toBeNull();
    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-feed-state', 'unavailable'));
    expect(screen.getByRole('status')).toHaveTextContent('We cannot say');
    expect(screen.getByRole('status')).toHaveTextContent('There is no public report, so we cannot claim health.');
    expect(document.title).toBe('Onyx status — are the rooms up?');
  });

  it('keeps the frame visible and makes no health claim while public feeds are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(() => (
      <Suspense fallback={<p data-testid="status-suspended">Loading status</p>}>
        <StatusRoute />
      </Suspense>
    ));

    expect(screen.getByRole('heading', { name: /are the rooms up tonight/i })).toBeInTheDocument();
    expect(screen.queryByTestId('status-suspended')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-feed-state', 'loading');
    expect(screen.getByRole('status')).toHaveTextContent('Checking');
    expect(screen.getByRole('status')).toHaveTextContent('No health claim yet');
  });

  it('renders only current complete topology as reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(statusResponse(meshStatus())));
    render(() => <StatusRoute />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-feed-state', 'current'));
    expect(screen.getByRole('status')).toHaveTextContent('Reachable');
    expect(screen.getByRole('status')).toHaveTextContent('The rooms are reachable tonight.');
    expect(screen.queryByText('7')).toBeNull();
    expect(screen.queryByText('12ms')).toBeNull();
    expect(screen.queryByRole('rowheader', { name: 'shore-a' })).toBeNull();
    expect(screen.queryByText(/users online/i)).toBeNull();
  });

  it('does not relabel degraded or stale observations as reachable', async () => {
    const cases = [
      {
        source: meshStatus({ mesh: { quorum: false, partitioned: true, components: 2 } }),
        state: 'degraded',
        label: 'Having trouble',
      },
      {
        source: meshStatus({ generated_at: NOW - 10 * 60 }),
        state: 'stale',
        label: 'We cannot say',
      },
    ] as const;

    for (const entry of cases) {
      vi.stubGlobal('fetch', vi.fn(statusResponse(entry.source)));
      const view = render(() => <StatusRoute />);
      await waitFor(() => expect(view.getByRole('status')).toHaveAttribute('data-feed-state', entry.state));
      expect(view.getByRole('status')).toHaveTextContent(entry.label);
      expect(view.getByRole('status')).not.toHaveTextContent('Reachable');
      expect(view.getByRole('status')).not.toHaveTextContent('The rooms are reachable tonight.');
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    render(() => <StatusRoute />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});
