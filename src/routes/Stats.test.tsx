import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import StatsRoute, { roomDeepLink } from './Stats';

describe('StatsRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the public stats page shell without a live feed', async () => {
    render(() => <StatsRoute />);

    expect(screen.getByRole('heading', { name: /the rooms in motion/i })).toBeInTheDocument();
    expect(await screen.findByText(/stats are waiting/i)).toBeInTheDocument();
  });

  it('includes the recent activity graph surface for room rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      generated_at: 1783500000,
      network: 'IRCXNet',
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

    expect(await screen.findByLabelText(/daily message totals/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/#root recent activity/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /open/i }).some((a) =>
      a.getAttribute('href')?.startsWith('/app?join=%23root&at='),
    )).toBe(true);
  });

  it('builds channel deep links with optional time-travel moments', () => {
    expect(roomDeepLink('#root')).toBe('/app?join=%23root');
    expect(roomDeepLink('#root', Date.parse('2026-07-08T12:00:00.000Z') / 1000)).toBe(
      '/app?join=%23root&at=2026-07-08T12%3A00%3A00.000Z',
    );
  });
});
