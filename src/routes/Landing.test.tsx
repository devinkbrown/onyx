// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import Landing from './Landing';

const NOW = Math.floor(Date.now() / 1000);

function statusResponse(status: Record<string, unknown>): (input: RequestInfo | URL) => Promise<Response> {
  return async (input) => new Response(
    JSON.stringify(String(input).includes('status.json') ? status : {}),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function meshStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generated_at: NOW,
    network: 'Onyx',
    node: 'example.test',
    uptime_seconds: 60,
    users_online: 2,
    mesh: { quorum: true, partitioned: false, components: 1 },
    peers: [],
    ...overrides,
  };
}

describe('Landing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses PublicFrame as the only document frame and exposes its skip target', () => {
    const { container, getByRole, getByText } = render(() => <Landing />);
    expect(getByRole('banner')).toBeInTheDocument();
    expect(getByRole('main', { name: 'Onyx home' })).toHaveAttribute('id', 'public-main');
    expect(getByRole('contentinfo')).toBeInTheDocument();
    expect(getByText('Skip to content')).toHaveAttribute('href', '#public-main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.home')).toBeTruthy();
  });

  it('keeps exactly one primary Open Onyx CTA in the shared public frame', () => {
    const { getAllByRole, container } = render(() => <Landing />);
    const openOnyx = getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(openOnyx[0]).toHaveClass('public-frame__open');
    expect(container.querySelectorAll('a.r-btn.primary, a.home-cta-primary')).toHaveLength(0);
  });

  it('derives every public destination link from manifest hrefs', () => {
    const { container } = render(() => <Landing />);
    expect(container.querySelector('.home-secondary-link')).toHaveAttribute('href', '/download/');
    expect(container.querySelector('.home-telemetry-link')).toHaveAttribute('href', '/status/');
  });

  it('keeps the operator shelf in manifest destination order and appends invite state locally', () => {
    const { getByRole } = render(() => <Landing />);
    const shelf = getByRole('navigation', { name: 'Operators and power users' });
    expect([...shelf.querySelectorAll('a')].map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
    }))).toEqual([
      { label: 'Status', href: '/status/' },
      { label: 'Stats', href: '/stats/' },
      { label: 'Roadmap', href: '/roadmap/' },
      { label: 'About', href: '/about/' },
      { label: 'Download', href: '/download/' },
      { label: 'Invite', href: '/invite/?join=%23root' },
    ]);
  });

  it('preserves the explicit Preview and not-live aperture wording', () => {
    const { getAllByText, getByText, container } = render(() => <Landing />);
    expect(getAllByText('Preview').length).toBeGreaterThan(0);
    expect(getByText(/Not live content/i)).toBeInTheDocument();
    expect(container.querySelector('[data-home-aperture]')).toBeTruthy();
    expect(container.querySelector('[data-home-aperture] [role="img"]')).toHaveAccessibleName(/not live content/i);
  });

  it('maps a complete current public mesh observation to a text and glyph verified receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(statusResponse(meshStatus())));
    const { getByRole, container } = render(() => <Landing />);
    await waitFor(() => expect(container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', 'verified'));
    const status = getByRole('status');
    expect(status).toHaveTextContent('Verified');
    expect(status).toHaveTextContent('✓');
    expect(container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', 'verified');
    expect(container.textContent).toMatch(/complete, non-partitioned quorum observation/i);
  });

  it('does not overclaim degraded, stale, future, or undated public mesh reports', async () => {
    const cases = [
      { source: meshStatus({ mesh: { quorum: false, partitioned: true, components: 2 } }), truth: 'partial', copy: 'Partial' },
      { source: meshStatus({ generated_at: NOW - 10 * 60 }), truth: 'reconnecting', copy: 'Reconnecting' },
      { source: meshStatus({ generated_at: NOW + 10 * 60 }), truth: 'unknown', copy: 'Unknown' },
      { source: meshStatus({ generated_at: 0 }), truth: 'unknown', copy: 'Unknown' },
    ] as const;

    for (const entry of cases) {
      vi.stubGlobal('fetch', vi.fn(statusResponse(entry.source)));
      const view = render(() => <Landing />);
      await waitFor(() => expect(view.container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', entry.truth));
      const status = view.getByRole('status');
      expect(status).toHaveTextContent(entry.copy);
      expect(view.container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', entry.truth);
      expect(status).not.toHaveTextContent('Verified');
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('shows reconnecting while a report is loading and unavailable when no report arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const loading = render(() => (
      <Suspense fallback={<p data-testid="landing-suspended">Loading landing</p>}>
        <Landing />
      </Suspense>
    ));
    expect(loading.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(loading.container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', 'reconnecting');
    expect(loading.queryByTestId('landing-suspended')).not.toBeInTheDocument();
    loading.unmount();
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const unavailable = render(() => <Landing />);
    await waitFor(() => expect(unavailable.container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', 'unavailable'));
    const status = unavailable.getByRole('status');
    expect(status).toHaveTextContent('Unavailable');
    expect(unavailable.container.querySelector('[data-ui="proof-receipt"]')).toHaveAttribute('data-ui-truth', 'unavailable');
  });

  it('keeps mobile navigation as a semantic, keyboard-operable disclosure', () => {
    const { getByRole } = render(() => <Landing />);
    const toggle = getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    toggle.click();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});
