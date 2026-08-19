// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PresenceHeatline } from './PresenceHeatline';

/** All-active histogram so every bar renders and hasActivity() is true. */
const ACTIVE_HOURS = Array.from({ length: 24 }, () => 5);

function stubPulseFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ hours: ACTIVE_HOURS, totals: { messages: 120 }, present: 7 }),
          { status: 200 },
        ),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PresenceHeatline current-hour marker', () => {
  it('advances the --now marker across an hour boundary without a remount', async () => {
    vi.useFakeTimers();
    // 10:15 UTC → the marker should land on hour index 10.
    vi.setSystemTime(new Date('2026-07-10T10:15:00.000Z'));
    stubPulseFetch();

    const { container } = render(() => (
      <PresenceHeatline channel={() => '#root'} />
    ));

    // Let the createResource fetch resolve so the 24 bars mount.
    await vi.advanceTimersByTimeAsync(0);
    const bars = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>('.shell-heat-bar'));
    expect(bars()).toHaveLength(24);
    expect(bars()[10]!.classList.contains('shell-heat-bar--now')).toBe(true);

    // Cross into the next hour and let one poll tick fire.
    vi.setSystemTime(new Date('2026-07-10T11:00:30.000Z'));
    await vi.advanceTimersByTimeAsync(60_000);

    // The marker must follow the clock (this was frozen when nowHour was a
    // dependency-free createMemo that only ran once).
    expect(bars()[11]!.classList.contains('shell-heat-bar--now')).toBe(true);
    expect(bars()[10]!.classList.contains('shell-heat-bar--now')).toBe(false);
    const ledger = container.querySelector('a.shell-ribbon-stats');
    expect(ledger).toHaveAttribute('href', '/stats/?room=%23root');
    expect(ledger).toHaveTextContent('Channel ledger');
    expect(container.querySelector('.shell-ribbon-present')).toHaveTextContent('7 present');
  });
});
