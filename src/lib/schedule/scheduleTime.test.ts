// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MIN_LEAD_MS,
  SCHEDULE_PRESETS,
  isSchedulable,
  parseDateTimeLocal,
  toDateTimeLocalValue,
} from './scheduleTime';

// A fixed local instant: 2026-07-12T10:00 local time.
const NOW = new Date(2026, 6, 12, 10, 0, 0, 0).getTime();

describe('isSchedulable', () => {
  it('rejects the past and the too-soon', () => {
    expect(isSchedulable(NOW - 1, NOW)).toBe(false);
    expect(isSchedulable(NOW, NOW)).toBe(false);
    expect(isSchedulable(NOW + MIN_LEAD_MS - 1, NOW)).toBe(false);
  });

  it('accepts an instant past the minimum lead', () => {
    expect(isSchedulable(NOW + MIN_LEAD_MS, NOW)).toBe(true);
  });

  it('rejects absurdly-far and non-finite instants', () => {
    expect(isSchedulable(NOW + 400 * 24 * 60 * 60_000, NOW)).toBe(false);
    expect(isSchedulable(Number.NaN, NOW)).toBe(false);
  });
});

describe('parseDateTimeLocal', () => {
  it('parses a future local datetime', () => {
    const at = parseDateTimeLocal('2026-07-12T11:30', NOW);
    expect(at).toBe(new Date(2026, 6, 12, 11, 30).getTime());
  });

  it('accepts the first minute-resolution datetime-local value beyond the minimum lead', () => {
    const boundary = NOW + 60_000;
    const value = toDateTimeLocalValue(boundary);

    expect(parseDateTimeLocal(value, NOW)).toBe(boundary);
  });

  it('trims datetime-local values before parsing', () => {
    const at = parseDateTimeLocal('  2026-07-12T11:30  ', NOW);

    expect(at).toBe(new Date(2026, 6, 12, 11, 30).getTime());
  });

  it('returns null for empty, malformed, or past values', () => {
    expect(parseDateTimeLocal('', NOW)).toBeNull();
    expect(parseDateTimeLocal('not-a-date', NOW)).toBeNull();
    expect(parseDateTimeLocal('2026-07-12T09:00', NOW)).toBeNull(); // an hour ago
  });

  it('rejects a datetime-local value one minute before the minimum lead', () => {
    const tooSoon = toDateTimeLocalValue(NOW + MIN_LEAD_MS - 1);

    expect(parseDateTimeLocal(tooSoon, NOW)).toBeNull();
  });
});

describe('SCHEDULE_PRESETS', () => {
  it('all presets produce a schedulable future instant', () => {
    for (const p of SCHEDULE_PRESETS) {
      expect(isSchedulable(p.at(NOW), NOW)).toBe(true);
    }
  });

  it('"tomorrow, 9:00" lands on the next 09:00 local, in the future', () => {
    const tomorrow9 = SCHEDULE_PRESETS.find((p) => p.id === 'tomorrow-9')!.at(NOW);
    const d = new Date(tomorrow9);
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(13); // NOW is the 12th at 10:00, so 09:00 is tomorrow
  });
});

describe('toDateTimeLocalValue', () => {
  it('round-trips through parseDateTimeLocal', () => {
    const future = NOW + 3 * 60 * 60_000;
    const value = toDateTimeLocalValue(future);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // datetime-local has minute resolution; compare at that granularity.
    expect(parseDateTimeLocal(value, NOW)).toBe(Math.floor(future / 60_000) * 60_000);
  });
});
