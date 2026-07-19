// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * JumpToDateSheet.test.tsx — Era 1 A3 discoverable time-travel Sheet.
 *
 * Asserts:
 *   1. Pure helpers build valid UTC moments and reject bad calendar days.
 *   2. Jump calls store.travelTo with the chosen UTC instant and closes.
 *   3. Presets fill the date field.
 *   4. Empty state when no room/DM is active.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import {
  dateTimeAtUtc,
  formatUtcDate,
  formatUtcTime,
  JumpToDateSheet,
  utcDateDaysAgo,
} from './JumpToDateSheet';

const initialState = store.getInitialState();

function seedChannel(channel = '#root'): void {
  store.setState({
    ...initialState,
    activeView: { kind: 'channel', channel },
    connectionStatus: 'connected',
    ourNick: 'me',
    showJumpToDate: true,
    server: {
      id: 'jump-date-test',
      name: 'Onyx',
      network: 'Onyx',
      url: 'wss://example.test',
      icon: '',
      nick: 'me',
      account: 'me',
      connected: true,
    },
  }, true);
}

describe('JumpToDate helpers', () => {
  it('formats and resolves UTC date/time strings', () => {
    const at = new Date('2026-07-09T15:30:00.000Z');
    expect(formatUtcDate(at)).toBe('2026-07-09');
    expect(formatUtcTime(at)).toBe('15:30');
    expect(dateTimeAtUtc('2026-07-09', '15:30')).toEqual(at);
    expect(dateTimeAtUtc('2026-07-09', '12:00')).toEqual(new Date('2026-07-09T12:00:00.000Z'));
  });

  it('rejects invalid calendar days and bad times', () => {
    expect(dateTimeAtUtc('2026-02-31', '12:00')).toBeNull();
    expect(dateTimeAtUtc('not-a-date', '12:00')).toBeNull();
    expect(dateTimeAtUtc('2026-07-09', '25:00')).toBeNull();
    expect(dateTimeAtUtc('2026-07-09', 'nope')).toBeNull();
  });

  it('computes UTC preset days from a fixed now', () => {
    const now = Date.parse('2026-07-19T18:00:00.000Z');
    expect(utcDateDaysAgo(0, now)).toBe('2026-07-19');
    expect(utcDateDaysAgo(1, now)).toBe('2026-07-18');
    expect(utcDateDaysAgo(7, now)).toBe('2026-07-12');
  });
});

describe('JumpToDateSheet', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('labels the sheet and jumps via travelTo for the active room', () => {
    seedChannel('#general');
    const travelToSpy = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <JumpToDateSheet />);

    expect(screen.getByRole('heading', { name: 'Jump to date' })).toBeInTheDocument();
    expect(screen.getByText(/Same path as \?at= links/i)).toBeInTheDocument();
    expect(screen.getByTestId('jump-to-date-sheet')).toBeInTheDocument();

    const dateInput = screen.getByLabelText('Date (UTC)');
    const timeInput = screen.getByLabelText('Time (UTC)');
    fireEvent.input(dateInput, { target: { value: '2026-06-30' } });
    fireEvent.input(timeInput, { target: { value: '09:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }));

    expect(travelToSpy).toHaveBeenCalledWith('#general', new Date('2026-06-30T09:15:00.000Z'));
    expect(store.getState().showJumpToDate).toBe(false);
  });

  it('applies Today / Yesterday / 7 days ago presets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T18:00:00.000Z'));
    seedChannel();

    render(() => <JumpToDateSheet />);
    const dateInput = screen.getByLabelText('Date (UTC)') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(dateInput.value).toBe('2026-07-18');

    fireEvent.click(screen.getByRole('button', { name: '7 days ago' }));
    expect(dateInput.value).toBe('2026-07-12');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(dateInput.value).toBe('2026-07-19');

    vi.useRealTimers();
  });

  it('shows an empty state when no conversation is active', () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'home' },
      showJumpToDate: true,
    }, true);

    render(() => <JumpToDateSheet />);

    expect(screen.getByRole('status')).toHaveTextContent(/Open a room or DM/i);
    expect(screen.queryByLabelText('Date (UTC)')).not.toBeInTheDocument();
  });

  it('closes through the sheet close control', () => {
    seedChannel();
    render(() => <JumpToDateSheet />);

    fireEvent.click(screen.getByRole('button', { name: 'Close jump to date' }));
    expect(store.getState().showJumpToDate).toBe(false);
  });
});
