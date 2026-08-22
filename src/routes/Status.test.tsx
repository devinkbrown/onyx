// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';

import StatusRoute from './Status';

const NOW = Math.floor(Date.now() / 1000);

function statusResponse(status: Record<string, unknown>): (input: RequestInfo | URL) => Promise<Response> {
  return async (input) => new Response(
    JSON.stringify(String(input).includes('status.json')
      ? status
      : { generated_at: NOW, files: [] }),
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
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Ledger.*Status/);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .queryByRole('link', { name: 'Status' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status/');
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('heading', { name: /network health/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /vault backups/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open stats/i })).toHaveAttribute('href', '/stats/');
    expect(screen.getByRole('link', { name: /open roadmap/i })).toHaveAttribute('href', '/roadmap/');
    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-feed-state', 'unavailable'));
    expect(screen.getByRole('status')).toHaveTextContent('status unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('No health claim is being made');
    expect(container.querySelector('.status-title-accent')).toHaveTextContent('in public');
  });

  it('keeps the frame visible and makes no health claim while public feeds are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(() => (
      <Suspense fallback={<p data-testid="status-suspended">Loading status</p>}>
        <StatusRoute />
      </Suspense>
    ));

    expect(screen.getByRole('heading', { name: /network health/i })).toBeInTheDocument();
    expect(screen.queryByTestId('status-suspended')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-feed-state', 'loading');
    expect(screen.getByRole('status')).toHaveTextContent('checking network');
    expect(screen.getByRole('status')).toHaveTextContent('No health claim yet');
  });

  it('renders only current complete topology as operational', async () => {
    vi.stubGlobal('fetch', vi.fn(statusResponse(meshStatus())));
    const { container } = render(() => <StatusRoute />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-feed-state', 'current'));
    expect(screen.getByRole('status')).toHaveTextContent('network online');
    expect(container.querySelector('.status-summary .status-pill')).toHaveAttribute('data-state', 'up');
    expect(container.querySelector('.status-summary .status-pill')).toHaveTextContent('operational');
    expect(screen.getByText('7')).toBeInTheDocument();
    const peerTable = screen.getByRole('table', { name: /peer link observations/i });
    expect(within(peerTable).getByRole('rowheader', { name: 'shore-a' })).toHaveAttribute('data-label', 'Peer');
    expect(within(peerTable).getByText('12ms')).toHaveAttribute('data-label', 'RTT');
  });

  it('does not relabel degraded or stale observations as operational', async () => {
    const cases = [
      {
        source: meshStatus({ mesh: { quorum: false, partitioned: true, components: 2 } }),
        state: 'degraded',
        label: 'network degraded',
      },
      {
        source: meshStatus({ generated_at: NOW - 10 * 60 }),
        state: 'stale',
        label: 'status stale',
      },
    ] as const;

    for (const entry of cases) {
      vi.stubGlobal('fetch', vi.fn(statusResponse(entry.source)));
      const view = render(() => <StatusRoute />);
      await waitFor(() => expect(view.getByRole('status')).toHaveAttribute('data-feed-state', entry.state));
      expect(view.getByRole('status')).toHaveTextContent(entry.label);
      expect(view.container.querySelector('.status-summary .status-pill')).not.toHaveTextContent('operational');
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
