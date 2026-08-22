// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';

import StatsRoute, { revealStatsInspector, roomDeepLink, STATS_INSPECTOR_ID } from './Stats';

const src = readFileSync(resolve(__dirname, 'Stats.tsx'), 'utf8');

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
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses PublicFrame as the only document frame and keeps Stats out of primary navigation', () => {
    const { container } = render(() => <StatsRoute />);

    expect(src).toContain("import { PublicFrame } from '@/ui/public'");
    expect(src).toContain('currentPath="/stats/"');
    expect(src).toContain('mainLabel="Onyx network stats"');
    expect(src).not.toContain('<PageChrome');
    expect(src).not.toContain('<PublicFooter');
    expect(src).not.toContain('<header');
    expect(src).not.toContain('<main');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Onyx network stats' })).toHaveAttribute('id', 'public-main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#public-main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();
    expect(container.querySelector('.ui-root.stats-page')).toBeTruthy();
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Signal.*Stats/);
    expect(container.querySelector('.r-ground')).toBeTruthy();
    expect(container.querySelector('.r-flecks')).toBeTruthy();
    expect(container.querySelector('.r-grain')).toBeTruthy();
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primary).queryByRole('link', { name: 'Stats' })).toBeNull();
    expect(within(primary).queryByRole('link', { name: 'Home' })).toBeNull();
    expect(within(primary).queryByRole('link', { name: 'Status' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Footer navigation' }))
      .getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status/');
    expect(screen.getByRole('navigation', { name: 'Stats sections' })).toBeInTheDocument();
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' })
      .filter((link) => link.classList.contains('public-frame__open'));
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]).toHaveAttribute('href', '/app/');
    expect(container.querySelector('.stats-title-accent')).toHaveTextContent('in motion');
  });

  it('relocates the seven-state live pill into exactly one hero observation', () => {
    expect(src).toContain("case 'loading': return 'stats checking'");
    expect(src).toContain("case 'current': return 'stats current'");
    expect(src).toContain("case 'stale': return 'stats stale'");
    expect(src).toContain("case 'future': return 'stats time mismatch'");
    expect(src).toContain("case 'unknown': return 'stats undated'");
    expect(src).toContain("case 'partial': return 'stats incomplete'");
    expect(src).toContain("default: return 'stats unavailable'");
    expect(src).toContain('class="stats-observation"');
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('aria-atomic="true"');
    expect(src.match(/class="stats-observation"/g)).toHaveLength(1);
  });

  it('keeps the canonical mobile disclosure keyboard operable', () => {
    render(() => <StatsRoute />);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'public-primary-navigation');
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('renders the public stats page shell without a live feed', async () => {
    render(() => <StatsRoute />);

    expect(screen.getByRole('heading', { name: /the rooms in motion/i })).toBeInTheDocument();
    expect(await screen.findByText(/no public stats export is available/i)).toBeInTheDocument();
    const observation = document.querySelector('.stats-observation');
    expect(observation).toHaveAttribute('data-feed-state', 'unavailable');
    expect(observation).toHaveAttribute('role', 'status');
    expect(observation).toHaveAttribute('aria-live', 'polite');
    expect(observation).toHaveAttribute('aria-atomic', 'true');
    expect(observation).toHaveTextContent('stats unavailable');
    expect(screen.getByText('stats unavailable')).toHaveAttribute('data-feed-state', 'unavailable');
    expect(screen.queryByText(/stats are waiting/i)).not.toBeInTheDocument();
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
    expect(document.querySelector('.stats-observation')).toHaveAttribute('data-feed-state', 'current');
    expect(document.querySelectorAll('.stats-observation')).toHaveLength(1);
    expect(screen.getByLabelText(/#root recent activity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh data/i })).toBeInTheDocument();
    expect(screen.getByText(/activity ledger/i)).toBeInTheDocument();
    expect(screen.getByText(/export current/i)).toBeInTheDocument();
    expect(screen.getByText('14-day pulse')).toBeInTheDocument();
    expect(document.querySelector('.ui-root.stats-page')).not.toBeNull();
    expect(document.querySelector('main.stats-page')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Stats sections' })).toHaveTextContent('Network pulse');
    expect(document.querySelector('.stats-summary [data-tone="presence"]')).not.toBeNull();
    expect(document.querySelector('.stats-summary [data-tone="messages"]')).not.toBeNull();
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
    expect(document.querySelector('.stats-observation')).toHaveAttribute('data-feed-state', 'partial');
    expect(screen.getAllByText(/partial public room index/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/duplicate day rows were omitted/i)).toBeInTheDocument();
  });

  it('keeps stale, future, and undated observation labels byte-identical', async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      { generated_at: now - 10 * 60, state: 'stale', label: 'stats stale' },
      { generated_at: now + 20 * 60, state: 'future', label: 'stats time mismatch' },
      { generated_at: 0, state: 'unknown', label: 'stats undated' },
    ] as const;

    for (const entry of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        generated_at: entry.generated_at,
        network_days: [{ date: '2026-07-08', messages: 24 }],
        channels: [{ channel: '#root', messages: 12 }],
      }), { status: 200 })));
      const view = render(() => <StatsRoute />);
      expect(await view.findByText(entry.label)).toHaveAttribute('data-feed-state', entry.state);
      expect(view.container.querySelector('.stats-observation')).toHaveAttribute('data-feed-state', entry.state);
      expect(view.container.textContent).toMatch(/export stale|export time mismatch|export undated/);
      expect(view.container.textContent).not.toMatch(/export current/);
      view.unmount();
      vi.unstubAllGlobals();
    }
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
    const observation = document.querySelector('.stats-observation');
    expect(observation).toHaveAttribute('data-feed-state', 'loading');
    expect(observation).toHaveTextContent('stats checking');
    expect(screen.getByText(/stats are waiting for the next exported feed/i)).toBeInTheDocument();
    expect(screen.queryByText(/stats unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no public stats export is available/i)).not.toBeInTheDocument();
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

  it('inspects a room from the public ?room= query and exposes its daily series', async () => {
    const now = Math.floor(Date.now() / 1000);
    const previous = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, '', '/stats/?room=%23quiet');

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/quiet.json')) {
        return new Response(JSON.stringify(channelDetailPayload('#quiet', now, {
          totals: { messages: 10, words: 20, active_users: 1, joins: 1, parts: 0, quits: 0, kicks: 0, topic_changes: 0 },
          days: [{ date: '2026-07-20', messages: 4 }, { date: '2026-07-21', messages: 6 }],
          records: { busiest_day: { date: '2026-07-21', messages: 6 }, peak_hour: 11 },
        })));
      }
      if (url.endsWith('/root.json')) {
        return new Response(JSON.stringify(channelDetailPayload('#root', now)));
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

    try {
      render(() => <StatsRoute />);
      expect(await screen.findByLabelText('#quiet summary')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /inside #quiet/i })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: '#quiet messages by day' })).toHaveTextContent('2026-07-20: 4 messages');
      expect(screen.getByText(/network share/i)).toBeInTheDocument();
      expect(screen.getByText(/net joins/i)).toBeInTheDocument();
      expect(screen.queryByText('private-ranking')).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, '', previous || '/');
    }
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
