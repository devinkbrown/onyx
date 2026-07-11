// SPDX-License-Identifier: AGPL-3.0-or-later
// RelativeTime component: prop-driven label, ISO exposure, self-update + teardown.

import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from './RelativeTime';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FIXED_NOW = Date.parse('2026-07-08T12:00:00.000Z');
const MINUTE_MS = 60_000;

describe('RelativeTime', () => {
  it('renders the compact relative label inside a <time> element', () => {
    render(() => <RelativeTime timestamp={FIXED_NOW - 3 * MINUTE_MS} now={() => FIXED_NOW} />);

    const el = screen.getByText('3m');

    expect(el.tagName).toBe('TIME');
  });

  it('exposes the exact instant via datetime and title', () => {
    const ts = FIXED_NOW - 3 * MINUTE_MS;
    render(() => <RelativeTime timestamp={ts} now={() => FIXED_NOW} />);

    const el = screen.getByText('3m');
    const iso = new Date(ts).toISOString();

    expect(el.getAttribute('datetime')).toBe(iso);
    expect(el.getAttribute('title')).toBe(iso);
  });

  it('self-updates the label as the clock advances', () => {
    vi.useFakeTimers();
    let clock = FIXED_NOW;
    render(() => (
      <RelativeTime timestamp={FIXED_NOW - 59 * MINUTE_MS} intervalMs={1_000} now={() => clock} />
    ));

    expect(screen.getByText('59m')).toBeTruthy();

    clock = FIXED_NOW + 2 * MINUTE_MS; // timestamp is now 61m in the past
    vi.advanceTimersByTime(1_000);

    expect(screen.getByText('1h')).toBeTruthy();
    expect(screen.queryByText('59m')).toBeNull();
  });

  it('tears down its interval on cleanup, leaking no timer', () => {
    vi.useFakeTimers();
    render(() => <RelativeTime timestamp={FIXED_NOW} intervalMs={1_000} now={() => FIXED_NOW} />);

    expect(vi.getTimerCount()).toBe(1);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
  });
});
