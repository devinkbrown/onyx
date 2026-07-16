// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import { formatTypingLabel, latestTypingExpiry, TypingIndicator } from './TypingIndicator';

const initialState = store.getInitialState();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  store.setState(initialState, true);
});

describe('formatTypingLabel', () => {
  it('returns empty string for no typers', () => {
    expect(formatTypingLabel([])).toBe('');
  });

  it('formats a single typer', () => {
    expect(formatTypingLabel(['aurora'])).toBe('aurora is typing');
  });

  it('formats two typers with "and"', () => {
    expect(formatTypingLabel(['aurora', 'vesper'])).toBe('aurora and vesper are typing');
  });

  it('formats three typers as a list', () => {
    expect(formatTypingLabel(['aurora', 'vesper', 'moss'])).toBe('aurora, vesper and moss are typing');
  });

  it('collapses four or more into "Several people"', () => {
    expect(formatTypingLabel(['a', 'b', 'c', 'd'])).toBe('Several people are typing');
    expect(formatTypingLabel(['a', 'b', 'c', 'd', 'e'])).toBe('Several people are typing');
  });
});

describe('latestTypingExpiry', () => {
  it('returns 0 for an empty map (no re-tick clock is scheduled)', () => {
    expect(latestTypingExpiry(new Map())).toBe(0);
  });

  it('returns the furthest-future expiry among entries', () => {
    const map = new Map([
      ['aurora', 1000],
      ['vesper', 5000],
      ['moss', 3000],
    ]);
    expect(latestTypingExpiry(map)).toBe(5000);
  });

  it('still reports the max even when all entries are already stale', () => {
    // Lingering entries (pruned only on the next TAGMSG) must not read as 0 —
    // callers compare the result against Date.now() to decide whether to tick.
    const map = new Map([['aurora', 10], ['vesper', 20]]);
    expect(latestTypingExpiry(map)).toBe(20);
  });
});

describe('<TypingIndicator>', () => {
  it('does not revive an inactive room typing entry that expired before navigation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      ourNick: 'kain',
    }, true);
    render(() => <TypingIndicator />);

    store.getState().setTyping('#other', 'alice', true);
    expect(screen.queryByRole('status')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(7_000);
    store.setState({ activeView: { kind: 'channel', channel: '#other' } });

    expect(screen.queryByRole('status')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
