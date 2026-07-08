import { describe, expect, it } from 'vitest';

import { buildTimeScrubberBars } from './TimeScrubber';

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
