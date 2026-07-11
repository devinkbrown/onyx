// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { buildMomentLink, buildTimeScrubberBars } from './TimeScrubber';
import { TimeScrubber } from './TimeScrubber';

const initialState = store.getInitialState();

beforeEach(() => {
  store.setState({
    ...initialState,
    activeView: { kind: 'channel', channel: '#root' },
  }, true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  store.setState(initialState, true);
});

describe('buildTimeScrubberBars', () => {
  it('returns 24 quiet bars when stats are absent or malformed', () => {
    const bars = buildTimeScrubberBars([1, 2, 3], 5);

    expect(bars).toHaveLength(24);
    expect(bars.every((bar) => bar.count === 0 && bar.heat === 0 && !bar.active)).toBe(true);
    expect(bars[5]!.isNow).toBe(true);
  });

  it('scales each bar against the busiest hour', () => {
    const hours = Array.from({ length: 24 }, () => 0);
    hours[3] = 4.8;
    hours[5] = 16;
    hours[7] = -8;
    hours[8] = Number.NaN;

    const bars = buildTimeScrubberBars(hours, 5);

    expect(bars[3]).toMatchObject({ count: 4, heat: 0.25, active: true, isNow: false });
    expect(bars[5]).toMatchObject({ count: 16, heat: 1, active: true, isNow: true });
    expect(bars[7]).toMatchObject({ count: 0, heat: 0, active: false });
    expect(bars[8]).toMatchObject({ count: 0, heat: 0, active: false });
  });

  it('does not mark a current hour when the input hour is invalid', () => {
    const bars = buildTimeScrubberBars(Array.from({ length: 24 }, () => 1), 24);

    expect(bars.some((bar) => bar.isNow)).toBe(false);
  });
});

describe('buildMomentLink', () => {
  it('builds a canonical app deep link for a room moment', () => {
    const link = buildMomentLink(
      '#general',
      new Date('2026-06-30T12:00:00.000Z'),
      'https://chat.example/about?old=1#section',
    );

    expect(link).toBe('https://chat.example/app?join=%23general&at=2026-06-30T12%3A00%3A00.000Z');
  });
});

describe('TimeScrubber accessibility', () => {
  it('labels the channel scrubber, hourly buttons, date jump, and copy action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, (_, hour) => (hour === 5 ? 9 : 0)),
      totals: { messages: 9 },
    }), { status: 200 })));
    const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <TimeScrubber />);

    expect(screen.getByRole('region', { name: 'Time scrubber for #root' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Activity by UTC hour for #root' })).toBeInTheDocument();
    const hour = await screen.findByRole('button', { name: /05:00 UTC, 9 messages/i });
    expect(screen.getByLabelText('Jump to date at 12:00 UTC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy moment link for #root' })).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText('Jump to date at 12:00 UTC'), {
      target: { value: '2026-07-09' },
    });
    fireEvent.click(hour);

    await waitFor(() => {
      expect(travelToSpy).toHaveBeenLastCalledWith('#root', new Date('2026-07-09T05:00:00.000Z'));
    });
  });

  it('announces copy success through a polite status region, not visual text alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(() => <TimeScrubber />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button', { name: 'Copy moment link for #root' }));

    await waitFor(() => {
      expect(status).toHaveTextContent(/copied/i);
    });
  });
});
