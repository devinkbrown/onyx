// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import Landing from './Landing';

describe('Landing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the public product promise', () => {
    const { getByRole, getByText } = render(() => <Landing />);
    expect(getByRole('heading', { name: /a place foryour people/i })).toBeInTheDocument();
    expect(getByText(/Fast enough to feel alive/i)).toBeInTheDocument();
  });

  it('leads with people and place, not jargon', () => {
    const { getByText, getByRole } = render(() => <Landing />);
    expect(getByRole('heading', { name: /a place foryour people/i })).toBeInTheDocument();
    expect(getByText(/People, not\s*a product/i)).toBeInTheDocument();
    expect(getByText(/Rooms to\s*wander into/i)).toBeInTheDocument();
    expect(getByRole('heading', { name: /a place foryour people/i })).not.toHaveTextContent(/IRC|mesh/i);
  });

  it('shows the signature proof rail without overstating encryption', () => {
    const { getByLabelText } = render(() => <Landing />);
    const rail = getByLabelText('What Onyx makes visible');

    expect(rail).toHaveTextContent(/History on this device/i);
    expect(rail).toHaveTextContent(/Protection shown honestly/i);
    expect(rail).not.toHaveTextContent(/fully encrypted|end-to-end encrypted rooms/i);
  });

  it('invites the visitor to join in seconds', () => {
    const { getByText, getAllByText } = render(() => <Landing />);
    expect(getByText(/You're three\s*steps from hello/i)).toBeInTheDocument();
    expect(getAllByText(/Open Onyx/i).length).toBeGreaterThan(0);
  });

  it('states the culture: open, yours, no ads', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/Open to the bone/i)).toBeInTheDocument();
    expect(getByText(/No ads, no mining/i)).toBeInTheDocument();
  });

  it('offers to run your own node', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/raise\s*your own shore/i)).toBeInTheDocument();
  });

  it('carries no devil / gate lore', () => {
    const { queryByText } = render(() => <Landing />);
    expect(queryByText(/devil/i)).not.toBeInTheDocument();
    expect(queryByText(/the gate/i)).not.toBeInTheDocument();
    expect(queryByText(/wrath/i)).not.toBeInTheDocument();
  });

  it('renders the brand mascot accessibly', () => {
    const { getAllByRole } = render(() => <Landing />);
    const dragons = getAllByRole('img').filter((el) =>
      (el.getAttribute('aria-label') ?? '').toLowerCase().includes('water-dragon'),
    );
    expect(dragons.length).toBeGreaterThan(0);
  });

  it('exposes a primary entry point into the app', () => {
    const { getAllByRole } = render(() => <Landing />);
    const enter = getAllByRole('link').filter((a) => a.getAttribute('href') === '/app/');
    expect(enter.length).toBeGreaterThan(0);
  });

  it('links the main website telemetry pages from the root page', () => {
    const { getAllByRole } = render(() => <Landing />);
    const hrefs = getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/stats/');
    expect(hrefs).toContain('/status/');
    expect(hrefs).toContain('/roadmap/');
  });

  it('surfaces live public telemetry on the root website', () => {
    const { getByText } = render(() => <Landing />);

    expect(getByText(/The network\s*is visible/i)).toBeInTheDocument();
    expect(getByText(/Public telemetry is part of the front door/i)).toBeInTheDocument();
  });

  it('sets root website metadata', () => {
    render(() => <Landing />);

    expect(document.title).toMatch(/place for your people/i);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/rooms, calls/i);
  });

  it('keeps the landing shell visible while public feeds are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    const { getByRole, getByText, queryByTestId, queryByText } = render(() => (
      <Suspense fallback={<p data-testid="landing-suspended">Loading landing</p>}>
        <Landing />
      </Suspense>
    ));

    expect(getByRole('heading', { name: /a place foryour people/i })).toBeInTheDocument();
    expect(getByText('checking mesh')).toHaveAttribute('data-feed-state', 'loading');
    expect(queryByText('network online')).not.toBeInTheDocument();
    expect(queryByTestId('landing-suspended')).not.toBeInTheDocument();
  });

  it('does not call a future-skewed public status sample online', async () => {
    const futureStatus = {
      generated_at: Math.floor((Date.now() + 10 * 60_000) / 1000),
      network: 'Onyx',
      node: 'eshmaki.me',
      uptime_seconds: 60,
      users_online: 2,
      mesh: { quorum: true, partitioned: false, components: 1 },
      peers: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input).includes('status.json') ? futureStatus : {}),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const { findByText, queryByText } = render(() => <Landing />);

    expect(await findByText('status time mismatch')).toHaveAttribute('data-feed-state', 'future');
    expect(queryByText('network online')).not.toBeInTheDocument();
  });
});
