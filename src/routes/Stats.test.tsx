// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';

import StatsRoute, { revealStatsInspector, roomDeepLink, STATS_INSPECTOR_ID } from './Stats';

function channelDetailPayload(channel: string, now: number, extras: Record<string, unknown> = {}) {
  return {
    channel,
    generated_at: now,
    first_seen: now - 86_400,
    last_active: now - 60,
    present: 3,
    last_speaker: 'alice',
    totals: { messages: 12, words: 72, active_users: 4, joins: 9, parts: 2, quits: 1, kicks: 0, topic_changes: 2 },
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    days: [{ date: '2026-07-21', messages: 12 }],
    heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 1)),
    records: { busiest_day: { date: '2026-07-21', messages: 12 }, peak_hour: 23 },
    top_users: [{ nick: 'private-ranking', messages: 12 }],
    top_words: [{ word: 'private-profile', count: 12 }],
    ...extras,
  };
}

describe('StatsRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(screen.getByRole('button', { name: /refresh data/i })).toBeInTheDocument();
    expect(screen.getByText(/activity ledger/i)).toBeInTheDocument();
    expect(screen.getByText('14-day pulse')).toBeInTheDocument();
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

  it('labels a fresh feed incomplete when duplicate public rows are omitted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      generated_at: Math.floor(Date.now() / 1000),
      network_days: [
        { date: '2026-07-08', messages: 24 },
        { date: '2026-07-08', messages: 99 },
      ],
      channels: [
        { channel: '#Root', messages: 42 },
        { channel: '#root', messages: 900 },
      ],
    }), { status: 200 })));

    render(() => <StatsRoute />);

    expect(await screen.findByText('stats incomplete')).toHaveAttribute('data-feed-state', 'partial');
    expect(screen.getAllByText(/partial public room index/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/duplicate day rows were omitted/i)).toBeInTheDocument();
  });

  it('filters to rooms with people present, searches topics, and changes ranking without refetching', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      generated_at: Math.floor(Date.now() / 1000),
      network_days: [],
      channels: [
        { channel: '#quiet', messages: 90, last_active: 100, spark: [1] },
        { channel: '#root', messages: 42, present: 2, last_active: 200, spark: [8, 8] },
      ],
    }), { status: 200 })));

    render(() => <StatsRoute />);

    await screen.findAllByText('#quiet');
    expect(screen.getByText(/showing 2 of 2 rooms/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'People here now' }));
    const rooms = document.querySelector<HTMLElement>('.data-list');
    expect(rooms).not.toBeNull();
    expect(within(rooms!).getByText('#root')).toBeInTheDocument();
    expect(within(rooms!).queryByText('#quiet')).not.toBeInTheDocument();
    expect(screen.getByText(/showing 1 of 2 rooms/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All rooms' }));
    fireEvent.input(screen.getByRole('searchbox', { name: 'Find a room or topic' }), { target: { value: 'root' } });
    expect(within(rooms!).getByText('#root')).toBeInTheDocument();
    expect(within(rooms!).queryByText('#quiet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pulse' }));
    expect(screen.getByRole('button', { name: 'Pulse' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('drills into bounded aggregate room insights without participant rankings', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/root.json')) {
        return new Response(JSON.stringify({
          channel: '#root', generated_at: now, first_seen: now - 86_400, last_active: now - 60,
          present: 3, last_speaker: 'alice',
          totals: { messages: 12, words: 72, active_users: 4, joins: 9, parts: 2, quits: 1, kicks: 0, topic_changes: 2 },
          hours: Array.from({ length: 24 }, (_, hour) => hour),
          days: [{ date: '2026-07-21', messages: 12 }],
          heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 1)),
          records: { busiest_day: { date: '2026-07-21', messages: 12 }, peak_hour: 23 },
          top_users: [{ nick: 'private-ranking', messages: 12 }],
          top_words: [{ word: 'private-profile', count: 12 }],
        }));
      }
      return new Response(JSON.stringify({
        generated_at: now,
        users_online: 4,
        network_days: [{ date: '2026-07-21', messages: 12 }],
        channels: [{ channel: '#root', messages: 12, present: 3, last_active: now - 60, spark: [12] }],
      }));
    }));

    render(() => <StatsRoute />);

    expect(await screen.findByRole('heading', { name: 'When the room talks' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '#root weekly activity table' })).toBeInTheDocument();
    expect(screen.getByText('23:00 UTC')).toBeInTheDocument();
    expect(screen.getByText(/does not publish message text/i)).toBeInTheDocument();
    expect(screen.queryByText('private-ranking')).not.toBeInTheDocument();
    expect(screen.queryByText('private-profile')).not.toBeInTheDocument();
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

  it('does not steal focus or scroll on initial load when the default room auto-inspects', async () => {
    const now = Math.floor(Date.now() / 1000);
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/root.json')) {
        return new Response(JSON.stringify(channelDetailPayload('#root', now)));
      }
      return new Response(JSON.stringify({
        generated_at: now,
        users_online: 4,
        network_days: [{ date: '2026-07-21', messages: 12 }],
        channels: [{ channel: '#root', messages: 12, present: 3, last_active: now - 60, spark: [12] }],
      }));
    }));

    render(() => <StatsRoute />);

    expect(await screen.findByRole('heading', { name: 'When the room talks' })).toBeInTheDocument();
    const inspector = document.getElementById(STATS_INSPECTOR_ID);
    expect(inspector).not.toBeNull();
    expect(document.activeElement).not.toBe(inspector);
    expect(scrollIntoView).not.toHaveBeenCalled();
    // Native focus may run for other controls; inspector must not be the target.
    expect(focus.mock.instances.some((el) => el === inspector)).toBe(false);
  });

  it('same-room Inspect activation scrolls, focuses, and keeps the selected state', async () => {
    const now = Math.floor(Date.now() / 1000);
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/root.json')) {
        return new Response(JSON.stringify(channelDetailPayload('#root', now)));
      }
      return new Response(JSON.stringify({
        generated_at: now,
        users_online: 4,
        network_days: [{ date: '2026-07-21', messages: 12 }],
        channels: [{ channel: '#root', messages: 12, present: 3, last_active: now - 60, spark: [12] }],
      }));
    }));

    render(() => <StatsRoute />);
    await screen.findByRole('heading', { name: 'When the room talks' });

    const inspect = screen.getByRole('button', { name: 'Inspect' });
    expect(inspect).toHaveAttribute('aria-pressed', 'true');
    expect(inspect).toHaveAttribute('aria-controls', STATS_INSPECTOR_ID);

    fireEvent.click(inspect);

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    const inspector = document.getElementById(STATS_INSPECTOR_ID)!;
    expect(scrollIntoView.mock.calls.some((call) => {
      const opts = call[0] as ScrollIntoViewOptions | undefined;
      return opts?.behavior === 'smooth' && opts?.block === 'start';
    })).toBe(true);
    expect(document.activeElement).toBe(inspector);
    expect(inspect).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: /inside #root/i })).toBeInTheDocument();
  });

  it('switching rooms never paints the previous room detail while the new feed is pending', async () => {
    const now = Math.floor(Date.now() / 1000);
    let resolveQuiet: ((value: Response) => void) | null = null;

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/root.json')) {
        return new Response(JSON.stringify(channelDetailPayload('#root', now, {
          totals: { messages: 999, words: 72, active_users: 4, joins: 9, parts: 2, quits: 1, kicks: 0, topic_changes: 2 },
        })));
      }
      if (url.endsWith('/quiet.json')) {
        return new Promise<Response>((resolve) => {
          resolveQuiet = resolve;
        });
      }
      return new Response(JSON.stringify({
        generated_at: now,
        users_online: 4,
        network_days: [{ date: '2026-07-21', messages: 12 }],
        channels: [
          { channel: '#root', messages: 90, present: 3, last_active: now - 60, spark: [12] },
          { channel: '#quiet', messages: 10, present: 0, last_active: now - 120, spark: [1] },
        ],
      }));
    }));

    render(() => <StatsRoute />);
    expect(await screen.findByRole('heading', { name: 'When the room talks' })).toBeInTheDocument();
    expect(screen.getByLabelText('#root summary')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();

    const rows = document.querySelectorAll('.data-room-row');
    const quietRow = Array.from(rows).find((row) => row.textContent?.includes('#quiet'));
    expect(quietRow).toBeTruthy();
    fireEvent.click(within(quietRow as HTMLElement).getByRole('button', { name: 'Inspect' }));

    await waitFor(() => {
      expect(screen.getByText(/loading #quiet insights/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('#root summary')).not.toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    expect(within(quietRow as HTMLElement).getByRole('button', { name: 'Inspect' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: /inside #quiet/i })).toBeInTheDocument();

    resolveQuiet!(new Response(JSON.stringify(channelDetailPayload('#quiet', now, {
      totals: { messages: 10, words: 20, active_users: 1, joins: 1, parts: 0, quits: 0, kicks: 0, topic_changes: 0 },
      records: { busiest_day: { date: '2026-07-21', messages: 10 }, peak_hour: 11 },
    }))));

    expect(await screen.findByLabelText('#quiet summary')).toBeInTheDocument();
    expect(screen.queryByLabelText('#root summary')).not.toBeInTheDocument();
  });

  it('uses non-smooth scroll when prefers-reduced-motion is reduce', () => {
    const target = document.createElement('section');
    target.id = STATS_INSPECTOR_ID;
    target.tabIndex = -1;
    document.body.appendChild(target);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const focus = vi.fn();
    target.focus = focus;

    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    revealStatsInspector(target);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    target.remove();
  });
});
