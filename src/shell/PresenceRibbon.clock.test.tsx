// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { PresenceRibbon } from './PresenceRibbon';

vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('./PresenceHeatline', () => ({ PresenceHeatline: () => null }));

const initialState = store.getInitialState();
const START_MS = 1_700_000_000_000;

function eventRaw(atMs: number, title: string): string {
  return `${Math.floor(atMs / 1000)}|${title}`;
}

describe('PresenceRibbon scheduled-event clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    store.setState(initialState, true);
  });

  it('does not own a clock outside a visible active-channel event', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(() => <PresenceRibbon />);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    store.setState({ activeView: { kind: 'status' } });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    store.setState({ activeView: { kind: 'dm', nick: 'alice' } });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    store.setState({ activeView: { kind: 'channel', channel: '#quiet' } });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    store.setState({
      channelProps: new Map([
        ['#quiet', { 'ocean.event': eventRaw(START_MS - 3_601_000, 'Expired') }],
      ]),
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Scheduled room event' })).not.toBeInTheDocument();
  });

  it('refreshes after timer-free idle and keeps one stable clock for a visible event', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const eventAt = START_MS + 6 * 60_000;
    const view = render(() => <PresenceRibbon />);

    vi.setSystemTime(START_MS + 5 * 60_000);
    store.setState({
      activeView: { kind: 'channel', channel: '#event' },
      channelProps: new Map([
        ['#event', { 'ocean.event': eventRaw(eventAt, 'Office hours') }],
      ]),
    });

    expect(screen.getByRole('button', { name: 'Scheduled room event' })).toHaveTextContent(
      'Event: Office hours · in 1 min',
    );
    const countdowns = document.querySelectorAll('.shell-ribbon-event-countdown');
    expect(countdowns).toHaveLength(2);
    expect(countdowns[0]).toHaveTextContent('· in 1 min');
    expect(countdowns[1]).toHaveTextContent('· in 1 min');
    expect(document.querySelector('.shell-ribbon-event-text--compact')).toHaveAttribute('aria-hidden', 'true');
    const eventTimer = setIntervalSpy.mock.results[0]?.value;
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(30_000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    store.setState({ activeView: { kind: 'home' } });
    expect(clearIntervalSpy).toHaveBeenCalledWith(eventTimer);
    expect(vi.getTimerCount()).toBe(0);

    view.unmount();
  });

  it('self-clears at grace expiry and clears a later clock on unmount', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    store.setState({
      activeView: { kind: 'channel', channel: '#event' },
      channelProps: new Map([
        ['#event', { 'ocean.event': eventRaw(START_MS - 3_590_000, 'Almost expired') }],
      ]),
    });

    const view = render(() => <PresenceRibbon />);
    const expiringTimer = setIntervalSpy.mock.results[0]?.value;
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(30_000);
    expect(clearIntervalSpy).toHaveBeenCalledWith(expiringTimer);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Scheduled room event' })).not.toBeInTheDocument();

    store.setState({
      channelProps: new Map([
        ['#event', { 'ocean.event': eventRaw(Date.now() + 60_000, 'Next event') }],
      ]),
    });
    const nextTimer = setIntervalSpy.mock.results[1]?.value;
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(nextTimer);
    expect(vi.getTimerCount()).toBe(0);
  });
});
