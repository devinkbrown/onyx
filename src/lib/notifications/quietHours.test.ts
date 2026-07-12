// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MINUTES_PER_DAY,
  isMinuteWithinWindow,
  isQuietHoursActive,
  isWithinQuietWindow,
  localMinuteOfDay,
  type QuietHoursSchedule,
} from './quietHours';

// Every assertion below uses either a plain minute-of-day integer or the LOCAL
// Date constructor `new Date(y, m, d, h, min)`. The latter round-trips its
// wall-clock hour/minute in ANY runner timezone, so these tests are
// TZ-independent — the same property that makes the predicate DST-safe.

describe('localMinuteOfDay', () => {
  it('derives wall-clock minute-of-day from local hour/minute components', () => {
    expect(localMinuteOfDay(new Date(2026, 6, 8, 0, 0))).toBe(0);
    expect(localMinuteOfDay(new Date(2026, 6, 8, 22, 0))).toBe(22 * 60);
    expect(localMinuteOfDay(new Date(2026, 6, 8, 23, 59))).toBe(MINUTES_PER_DAY - 1);
    expect(localMinuteOfDay(new Date(2026, 6, 8, 8, 30))).toBe(8 * 60 + 30);
  });
});

describe('isMinuteWithinWindow — same-day span', () => {
  // Window 09:00 (540) -> 17:00 (1020), half-open [start, end).
  const start = 9 * 60;
  const end = 17 * 60;

  it('includes the start minute (inclusive lower bound)', () => {
    expect(isMinuteWithinWindow(start, start, end)).toBe(true);
  });

  it('excludes the end minute (exclusive upper bound)', () => {
    expect(isMinuteWithinWindow(end, start, end)).toBe(false);
  });

  it('includes an interior minute', () => {
    expect(isMinuteWithinWindow(12 * 60, start, end)).toBe(true);
  });

  it('excludes minutes before the start and after the end', () => {
    expect(isMinuteWithinWindow(start - 1, start, end)).toBe(false);
    expect(isMinuteWithinWindow(end + 1, start, end)).toBe(false);
  });
});

describe('isMinuteWithinWindow — overnight wrap (start > end)', () => {
  // Window 22:00 (1320) -> 06:00 (360): active late night AND early morning.
  const start = 22 * 60;
  const end = 6 * 60;

  it('includes the start minute at night', () => {
    expect(isMinuteWithinWindow(start, start, end)).toBe(true);
  });

  it('includes a late-night minute after the start', () => {
    expect(isMinuteWithinWindow(23 * 60 + 30, start, end)).toBe(true);
  });

  it('includes an after-midnight minute before the end', () => {
    expect(isMinuteWithinWindow(2 * 60, start, end)).toBe(true);
  });

  it('excludes the end minute (exclusive upper bound)', () => {
    expect(isMinuteWithinWindow(end, start, end)).toBe(false);
  });

  it('excludes a daytime minute outside the wrap', () => {
    expect(isMinuteWithinWindow(12 * 60, start, end)).toBe(false);
  });
});

describe('isMinuteWithinWindow — degenerate & hostile spans (fail open)', () => {
  it('treats a zero-width span (start === end) as empty — never all-day silence', () => {
    expect(isMinuteWithinWindow(0, 8 * 60, 8 * 60)).toBe(false);
    expect(isMinuteWithinWindow(8 * 60, 8 * 60, 8 * 60)).toBe(false);
    expect(isMinuteWithinWindow(20 * 60, 8 * 60, 8 * 60)).toBe(false);
  });

  it('normalizes an out-of-range stored minute into the day span', () => {
    // 1500 wraps to 60 (01:00); still inside the 22:00->06:00 overnight window.
    expect(isMinuteWithinWindow(1500, 22 * 60, 6 * 60)).toBe(true);
    // A negative "now" wraps too: -60 -> 1380 (23:00), inside the same window.
    expect(isMinuteWithinWindow(-60, 22 * 60, 6 * 60)).toBe(true);
  });

  it('returns false for a non-finite minute rather than silencing', () => {
    expect(isMinuteWithinWindow(Number.NaN, 9 * 60, 17 * 60)).toBe(false);
    expect(isMinuteWithinWindow(9 * 60, Number.NaN, 17 * 60)).toBe(false);
    expect(isMinuteWithinWindow(9 * 60, 9 * 60, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('isWithinQuietWindow — Date-driven, overnight window', () => {
  const start = 22 * 60; // 22:00
  const end = 6 * 60; // 06:00

  it('is active late at night', () => {
    expect(isWithinQuietWindow(new Date(2026, 6, 8, 23, 15), start, end)).toBe(true);
  });

  it('is active in the small hours before the end', () => {
    expect(isWithinQuietWindow(new Date(2026, 6, 8, 5, 59), start, end)).toBe(true);
  });

  it('is inactive at the end boundary and during the day', () => {
    expect(isWithinQuietWindow(new Date(2026, 6, 8, 6, 0), start, end)).toBe(false);
    expect(isWithinQuietWindow(new Date(2026, 6, 8, 13, 0), start, end)).toBe(false);
  });
});

describe('isWithinQuietWindow — DST boundary (wall-clock, not elapsed UTC)', () => {
  // 2026-03-08 is the US spring-forward date (02:00 -> 03:00 local). The predicate
  // reads wall-clock hour/minute, so membership follows the clock face the user
  // sees, regardless of the gained hour. An epoch-modulo minute-of-day would drift
  // by the lost hour and mis-classify these instants; wall-clock does not. Because
  // both the constructed Date and the predicate use LOCAL components, this holds in
  // every runner timezone.
  const start = 22 * 60; // 22:00
  const end = 6 * 60; // 06:00

  it('keeps a pre-transition late-night instant inside the overnight window', () => {
    expect(isWithinQuietWindow(new Date(2026, 2, 8, 1, 30), start, end)).toBe(true);
  });

  it('keeps a post-transition morning instant inside the window before 06:00', () => {
    // 03:30 exists only because the clock jumped from 02:00 to 03:00.
    expect(isWithinQuietWindow(new Date(2026, 2, 8, 3, 30), start, end)).toBe(true);
  });

  it('classifies a daytime instant on the transition day as outside the window', () => {
    expect(isWithinQuietWindow(new Date(2026, 2, 8, 9, 0), start, end)).toBe(false);
  });

  it('handles a fall-back (repeated hour) day by wall clock too', () => {
    // 2026-11-01 is the US fall-back date (02:00 repeats). 01:30 occurs twice in
    // elapsed time but is a single wall-clock minute-of-day, inside the window.
    expect(isWithinQuietWindow(new Date(2026, 10, 1, 1, 30), start, end)).toBe(true);
    expect(isWithinQuietWindow(new Date(2026, 10, 1, 8, 0), start, end)).toBe(false);
  });
});

describe('isQuietHoursActive', () => {
  const schedule = (overrides: Partial<QuietHoursSchedule> = {}): QuietHoursSchedule => ({
    enabled: true,
    startMinute: 22 * 60,
    endMinute: 6 * 60,
    ...overrides,
  });

  it('is never active when the schedule is disabled', () => {
    expect(isQuietHoursActive(schedule({ enabled: false }), new Date(2026, 6, 8, 23, 0))).toBe(false);
  });

  it('is active inside the window when enabled', () => {
    expect(isQuietHoursActive(schedule(), new Date(2026, 6, 8, 23, 0))).toBe(true);
  });

  it('is inactive outside the window when enabled', () => {
    expect(isQuietHoursActive(schedule(), new Date(2026, 6, 8, 12, 0))).toBe(false);
  });
});
