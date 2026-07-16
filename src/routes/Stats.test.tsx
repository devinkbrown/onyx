// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';

import StatsRoute, { roomDeepLink } from './Stats';

describe('StatsRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the public stats page shell without a live feed', async () => {
    render(() => <StatsRoute />);

    expect(screen.getByRole('heading', { name: /the rooms in motion/i })).toBeInTheDocument();
    expect(await screen.findByText(/stats are waiting/i)).toBeInTheDocument();
    expect(screen.getByText('stats unavailable')).toHaveAttribute('data-feed-state', 'unavailable');
  });

  it('includes the recent activity graph surface for room rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      generated_at: Math.floor(Date.now() / 1000),
      network: 'Onyx',
      node: 'eshmaki.me',
      users_online: 8,
      network_days: [{ date: '2026-07-08', messages: 24 }],
      channels: [
        {
          channel: '#root',
          messages: 42,
          active_users: 3,
          present: 2,
          last_active: 1783500000,
          topic: 'build channel',
          spark: [1, 3, 2, 7],
        },
      ],
    }), { status: 200 })));

    render(() => <StatsRoute />);

    const totals = await screen.findByRole('list', { name: /daily message totals/i });
    expect(totals).toHaveTextContent('2026-07-08: 24 messages');
    const chart = screen.getByRole('figure', { name: /daily message totals, oldest to newest/i });
    expect(chart.querySelector('.data-bars')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('stats current')).toHaveAttribute('data-feed-state', 'current');
    expect(screen.getByLabelText(/#root recent activity/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /open/i }).some((a) =>
      a.getAttribute('href')?.startsWith('/app/?join=%23root&at='),
    )).toBe(true);
  });

  it('builds channel deep links with optional time-travel moments', () => {
    expect(roomDeepLink('#root')).toBe('/app/?join=%23root');
    expect(roomDeepLink('#root', Date.parse('2026-07-08T12:00:00.000Z') / 1000)).toBe(
      '/app/?join=%23root&at=2026-07-08T12%3A00%3A00.000Z',
    );
  });

  it('omits the moment (never throws) when last_active is an out-of-range outlier', () => {
    // A garbage/mis-scaled feed value (e.g. ms or ns mistaken for seconds) pushes
    // the Date past JS's ±8.64e15 ms bound; toISOString() would throw RangeError
    // and crash the whole Stats render. The link must degrade to a plain join.
    expect(() => roomDeepLink('#root', 1e17)).not.toThrow();
    expect(roomDeepLink('#root', 1e17)).toBe('/app/?join=%23root');
    expect(roomDeepLink('#root', Number.POSITIVE_INFINITY)).toBe('/app/?join=%23root');
  });

  it('keeps the stats page shell visible while the feed is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(() => (
      <Suspense fallback={<p data-testid="stats-suspended">Loading stats</p>}>
        <StatsRoute />
      </Suspense>
    ));

    expect(screen.getByRole('heading', { name: /the rooms in motion/i })).toBeInTheDocument();
    expect(screen.queryByTestId('stats-suspended')).not.toBeInTheDocument();
  });
});
