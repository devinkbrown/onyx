// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense } from 'solid-js';

import { store } from '@/lib/store/store';
import { buildMomentLink, buildTimeScrubberBars } from './TimeScrubber';
import { TimeScrubber } from './TimeScrubber';

const initialState = store.getInitialState();

beforeEach(() => {
  localStorage.clear();
  store.setState({
    ...initialState,
    activeView: { kind: 'channel', channel: '#root' },
  }, true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

    expect(link).toBe('https://chat.example/app/?join=%23general&at=2026-06-30T12%3A00%3A00.000Z');
  });
});

describe('TimeScrubber accessibility', () => {
  it('keeps the surrounding shell mounted while room pulse data is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(() => (
      <Suspense fallback={<p data-testid="shell-suspended">Loading shell</p>}>
        <div data-testid="stable-shell-chrome">Connected shell</div>
        <TimeScrubber />
      </Suspense>
    ));

    expect(screen.getByTestId('stable-shell-chrome')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-suspended')).not.toBeInTheDocument();
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('rolls the untouched UTC date forward and jumps the current-hour bar to the new day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T23:59:30.000Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <TimeScrubber />);
    const dateInput = screen.getByLabelText('Jump to date at 12:00 UTC');
    expect(dateInput).toHaveValue('2026-07-16');

    vi.advanceTimersByTime(60_000);

    expect(dateInput).toHaveValue('2026-07-17');
    const midnight = screen.getByRole('button', {
      name: 'Jump to 2026-07-17 00:00 UTC, 0 messages',
    });
    expect(midnight).toHaveClass('time-scrubber__bar--now');
    fireEvent.click(midnight);
    expect(travelToSpy).toHaveBeenLastCalledWith('#root', new Date('2026-07-17T00:00:00.000Z'));
  });

  it('preserves an explicit historical date across UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T23:59:30.000Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <TimeScrubber />);
    const dateInput = screen.getByLabelText('Jump to date at 12:00 UTC');
    fireEvent.input(dateInput, { target: { value: '2026-06-30' } });

    vi.advanceTimersByTime(60_000);

    expect(dateInput).toHaveValue('2026-06-30');
    expect(screen.getByRole('button', {
      name: 'Jump to 2026-06-30 00:00 UTC, 0 messages',
    })).toHaveClass('time-scrubber__bar--now');
  });

  it('labels the channel scrubber, hourly buttons, date jump, and copy action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, (_, hour) => (hour === 5 ? 9 : 0)),
      totals: { messages: 9 },
    }), { status: 200 })));
    const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <TimeScrubber />);

    expect(screen.getByRole('region', { name: 'Time scrubber for #root' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Activity by UTC hour for #root' })).toBeInTheDocument();
    const hour = await screen.findByRole('button', { name: /05:00 UTC, 9 messages/i });
    expect(screen.getByLabelText('Jump to date at 12:00 UTC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy moment link for #root' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Channel ledger for #root' })).toHaveAttribute(
      'href',
      '/stats/?room=%23root',
    );

    fireEvent.input(screen.getByLabelText('Jump to date at 12:00 UTC'), {
      target: { value: '2026-07-09' },
    });
    fireEvent.click(hour);

    await waitFor(() => {
      expect(travelToSpy).toHaveBeenLastCalledWith('#root', new Date('2026-07-09T05:00:00.000Z'));
    });
  });

  it('uses one roving tab stop and moves focus without travelling until activation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T05:30:00.000Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <TimeScrubber />);

    const toolbar = screen.getByRole('toolbar', { name: 'Activity by UTC hour for #root' });
    const hourButtons = within(toolbar).getAllByRole('button');
    const hour05 = within(toolbar).getByRole('button', { name: /05:00 UTC/i });
    const hour06 = within(toolbar).getByRole('button', { name: /06:00 UTC/i });
    const hour07 = within(toolbar).getByRole('button', { name: /07:00 UTC/i });
    const hour00 = within(toolbar).getByRole('button', { name: /00:00 UTC/i });
    const hour23 = within(toolbar).getByRole('button', { name: /23:00 UTC/i });

    expect(hourButtons.filter((button) => button.tabIndex === 0)).toEqual([hour05]);
    hour05.focus();

    fireEvent.keyDown(hour05, { key: 'ArrowRight' });
    expect(hour06).toHaveFocus();
    expect(hour05).toHaveAttribute('tabindex', '-1');
    expect(hour06).toHaveAttribute('tabindex', '0');
    expect(travelToSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(hour06, { key: 'ArrowDown' });
    expect(hour07).toHaveFocus();
    fireEvent.keyDown(hour07, { key: 'ArrowUp' });
    expect(hour06).toHaveFocus();
    fireEvent.keyDown(hour06, { key: 'End' });
    expect(hour23).toHaveFocus();
    fireEvent.keyDown(hour23, { key: 'ArrowRight' });
    expect(hour00).toHaveFocus();
    fireEvent.keyDown(hour00, { key: 'ArrowLeft' });
    expect(hour23).toHaveFocus();
    fireEvent.keyDown(hour23, { key: 'Home' });
    expect(hour00).toHaveFocus();
    expect(travelToSpy).not.toHaveBeenCalled();

    hour23.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    hour23.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    fireEvent.click(hour23);
    expect(travelToSpy).toHaveBeenCalledWith('#root', new Date('2026-07-16T23:00:00.000Z'));
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
      expect(screen.getByRole('button', { name: 'Copy moment link for #root' })).toHaveTextContent('Copied');
    });
  });

  it('ignores an old room copy completion after the active channel changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    let resolveCopy: (() => void) | undefined;
    const pendingCopy = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const writeText = vi.fn(() => pendingCopy);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(() => <TimeScrubber />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy moment link for #root' }));
    expect(writeText).toHaveBeenCalledOnce();

    store.setState({ activeView: { kind: 'channel', channel: '#secret' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy moment link for #secret' })).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('');
    resolveCopy?.();
    await pendingCopy;
    await Promise.resolve();
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Copy moment link for #secret' })).toHaveTextContent('Copy moment');
  });

  it('shows and announces clipboard rejection without persisting the moment link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(() => <TimeScrubber />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy moment link for #root' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy moment link for #root' })).toHaveTextContent('Copy failed');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Could not copy moment link for #root. Clipboard access is unavailable.',
      );
    });
    expect(localStorage.getItem('onyx:last-copied-moment')).toBeNull();
  });

  it('shows and announces an unavailable clipboard without false success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hours: Array.from({ length: 24 }, () => 0),
      totals: { messages: 0 },
    }), { status: 200 })));
    vi.stubGlobal('navigator', {});

    render(() => <TimeScrubber />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy moment link for #root' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy moment link for #root' })).toHaveTextContent('Copy failed');
      expect(screen.getByRole('status')).toHaveTextContent(/clipboard access is unavailable/i);
    });
    expect(localStorage.getItem('onyx:last-copied-moment')).toBeNull();
  });
});
