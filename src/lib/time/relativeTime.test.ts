// Relative time formatter behavior.

import { describe, expect, it } from 'vitest';
import { calendarDay, relativeTime, shortDuration } from '@/lib/time/relativeTime';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const NOW = new Date('2026-07-08T12:00:00Z');

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function ahead(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

describe('relativeTime', () => {
  it('treats moments inside the just-now boundary as current', () => {
    const then = ago(44 * SECOND_MS);

    const label = relativeTime(then, NOW);

    expect(label).toBe('just now');
  });

  it('formats past bucket boundaries with the largest fitting unit', () => {
    const cases: ReadonlyArray<[Date, string]> = [
      [ago(45 * SECOND_MS), '1m ago'],
      [ago(3 * MINUTE_MS), '3m ago'],
      [ago(HOUR_MS), '1h ago'],
      [ago(2 * HOUR_MS), '2h ago'],
      [ago(DAY_MS), 'yesterday'],
      [ago(2 * DAY_MS), '2d ago'],
      [ago(4 * DAY_MS), '4d ago'],
      [ago(WEEK_MS), '1w ago'],
      [ago(3 * WEEK_MS), '3w ago'],
      [ago(MONTH_MS), '1mo ago'],
      [ago(5 * MONTH_MS), '5mo ago'],
      [ago(YEAR_MS), '1y ago'],
      [ago(2 * YEAR_MS), '2y ago'],
    ];

    const labels = cases.map(([then]) => relativeTime(then, NOW));

    expect(labels).toEqual(cases.map(([, expected]) => expected));
  });

  it('formats future moments symmetrically', () => {
    const cases: ReadonlyArray<[Date, string]> = [
      [ahead(44 * SECOND_MS), 'just now'],
      [ahead(3 * MINUTE_MS), 'in 3m'],
      [ahead(2 * HOUR_MS), 'in 2h'],
      [ahead(DAY_MS), 'tomorrow'],
      [ahead(4 * DAY_MS), 'in 4d'],
    ];

    const labels = cases.map(([then]) => relativeTime(then, NOW));

    expect(labels).toEqual(cases.map(([, expected]) => expected));
  });
});

describe('shortDuration', () => {
  it('formats zero duration as seconds', () => {
    const label = shortDuration(0);

    expect(label).toBe('0s');
  });

  it('clamps negative durations to zero', () => {
    const label = shortDuration(-1);

    expect(label).toBe('0s');
  });

  it('formats sub-minute durations as seconds', () => {
    const label = shortDuration(45 * SECOND_MS);

    expect(label).toBe('45s');
  });

  it('formats exact single-unit durations without trailing zeroes', () => {
    const label = shortDuration(3 * MINUTE_MS);

    expect(label).toBe('3m');
  });

  it('formats the two largest nonzero duration units', () => {
    const labels = [shortDuration(HOUR_MS + 20 * MINUTE_MS), shortDuration(2 * DAY_MS + 4 * HOUR_MS)];

    expect(labels).toEqual(['1h 20m', '2d 4h']);
  });
});

describe('calendarDay', () => {
  it('labels the same local calendar day as today', () => {
    const label = calendarDay(new Date('2026-07-08T12:00:00Z'), NOW);

    expect(label).toBe('Today');
  });

  it('labels the previous local calendar day as yesterday', () => {
    const label = calendarDay(new Date('2026-07-07T12:00:00Z'), NOW);

    expect(label).toBe('Yesterday');
  });

  it('formats same-year dates without the year', () => {
    const then = new Date('2026-04-15T12:00:00Z');
    const label = calendarDay(then, NOW);

    expect(label).toBe(then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  });

  it('formats cross-year dates with the year', () => {
    const then = new Date('2025-11-15T12:00:00Z');
    const label = calendarDay(then, NOW);

    expect(label).toBe(
      then.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    );
  });
});
