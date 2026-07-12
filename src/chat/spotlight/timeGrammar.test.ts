// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseTimeExpr } from './timeGrammar';

const NOW = new Date(2026, 6, 8, 12, 34, 56, 789).getTime();

function expectParsed(input: string, expected: Date): void {
  const parsed = parseTimeExpr(input, NOW);
  expect(parsed?.getTime()).toBe(expected.getTime());
}

describe('parseTimeExpr', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    expectParsed('2026-07-01', new Date(2026, 6, 1, 0, 0, 0, 0));
  });

  it('parses ISO datetime forms', () => {
    expectParsed('2026-07-01T09:45', new Date(2026, 6, 1, 9, 45, 0, 0));
    expectParsed('2026-07-01 09:45:30', new Date(2026, 6, 1, 9, 45, 30, 0));
    expectParsed('2026-07-01T09:45:30.123Z', new Date(Date.UTC(2026, 6, 1, 9, 45, 30, 123)));
    expectParsed('2026-07-01T09:45:00+02:30', new Date(Date.UTC(2026, 6, 1, 7, 15, 0, 0)));
  });

  it('parses HH:MM as today', () => {
    expectParsed('08:15', new Date(2026, 6, 8, 8, 15, 0, 0));
    expectParsed('9:05', new Date(2026, 6, 8, 9, 5, 0, 0));
  });

  it('parses relative expressions', () => {
    expectParsed('3h ago', new Date(NOW - 3 * 60 * 60 * 1000));
    expectParsed('2d ago', new Date(NOW - 2 * 24 * 60 * 60 * 1000));
    expectParsed('30m ago', new Date(NOW - 30 * 60 * 1000));
    expectParsed('4 hours ago', new Date(NOW - 4 * 60 * 60 * 1000));
  });

  it('parses relative week expressions as durations', () => {
    expectParsed('1w ago', new Date(NOW - 7 * 24 * 60 * 60 * 1000));
    expectParsed('2 weeks ago', new Date(NOW - 14 * 24 * 60 * 60 * 1000));
    expectParsed('3 week ago', new Date(NOW - 21 * 24 * 60 * 60 * 1000));
  });

  it('parses "N days ago" including the spelled-out unit', () => {
    expectParsed('5 days ago', new Date(NOW - 5 * 24 * 60 * 60 * 1000));
    expectParsed('1 day ago', new Date(NOW - 24 * 60 * 60 * 1000));
  });

  it('parses "last week" and "past week" as seven days ago at midnight', () => {
    // NOW is 2026-07-08; seven calendar days back at local midnight is 2026-07-01.
    expectParsed('last week', new Date(2026, 6, 1, 0, 0, 0, 0));
    expectParsed('past week', new Date(2026, 6, 1, 0, 0, 0, 0));
  });

  it('rejects unsupported week phrasings', () => {
    expect(parseTimeExpr('next week', NOW)).toBeNull();
    expect(parseTimeExpr('this week', NOW)).toBeNull();
    expect(parseTimeExpr('last weekend', NOW)).toBeNull();
  });

  it('parses noon and midnight as named clocks', () => {
    expectParsed('noon', new Date(2026, 6, 8, 12, 0, 0, 0));
    expectParsed('midnight', new Date(2026, 6, 8, 0, 0, 0, 0));
    expectParsed('today noon', new Date(2026, 6, 8, 12, 0, 0, 0));
    expectParsed('yesterday noon', new Date(2026, 6, 7, 12, 0, 0, 0));
  });

  it('parses dayparts relative to today', () => {
    // NOW is 2026-07-08 (Wednesday).
    expectParsed('this morning', new Date(2026, 6, 8, 9, 0, 0, 0));
    expectParsed('this afternoon', new Date(2026, 6, 8, 15, 0, 0, 0));
    expectParsed('this evening', new Date(2026, 6, 8, 20, 0, 0, 0));
    expectParsed('tonight', new Date(2026, 6, 8, 20, 0, 0, 0));
    expectParsed('last night', new Date(2026, 6, 7, 20, 0, 0, 0));
  });

  it('parses weekday names to the most recent matching date', () => {
    // 2026-07-08 is a Wednesday.
    expectParsed('wednesday', new Date(2026, 6, 8, 0, 0, 0, 0)); // today
    expectParsed('tuesday', new Date(2026, 6, 7, 0, 0, 0, 0)); // yesterday
    expectParsed('monday 21:00', new Date(2026, 6, 6, 21, 0, 0, 0));
    expectParsed('last wednesday', new Date(2026, 6, 1, 0, 0, 0, 0)); // strictly before today
    expectParsed('last friday', new Date(2026, 6, 3, 0, 0, 0, 0));
    expectParsed('last tuesday noon', new Date(2026, 6, 7, 12, 0, 0, 0));
    expectParsed('last friday 18:00', new Date(2026, 6, 3, 18, 0, 0, 0)); // palette chip phrasing
    expectParsed('fri 08:30', new Date(2026, 6, 3, 8, 30, 0, 0));
  });

  it('resolves weekday jumps by calendar math, not millisecond subtraction (DST-safe)', () => {
    // A NOW in mid-March where jumping back across a possible DST boundary must
    // preserve the requested wall-clock time. Both sides use the local
    // constructor, so the assertion holds in any runner timezone precisely
    // because makeLocalDate round-trips the requested hour.
    // 2026-03-08 is the US spring-forward date; both targets land on it. Naive
    // `now - 4*DAY_MS` would drift by the lost hour, so 09:00/14:00 would come
    // out wrong. Calendar math keeps the requested wall clock exactly.
    const springNow = new Date(2026, 2, 12, 10, 0, 0, 0).getTime(); // 2026-03-12 Thursday
    expect(parseTimeExpr('last sunday 09:00', springNow)?.getTime()).toBe(
      new Date(2026, 2, 8, 9, 0, 0, 0).getTime(),
    );
    expect(parseTimeExpr('sunday 14:00', springNow)?.getTime()).toBe(
      new Date(2026, 2, 8, 14, 0, 0, 0).getTime(),
    );
  });

  it('parses keywords', () => {
    expectParsed('now', new Date(NOW));
    expectParsed('yesterday', new Date(2026, 6, 7, 0, 0, 0, 0));
    expectParsed('yesterday 21:00', new Date(2026, 6, 7, 21, 0, 0, 0));
    expectParsed('today 06:30', new Date(2026, 6, 8, 6, 30, 0, 0));
  });

  it('accepts moments up to one day ahead', () => {
    expectParsed(new Date(NOW + 24 * 60 * 60 * 1000).toISOString(), new Date(NOW + 24 * 60 * 60 * 1000));
  });

  it('rejects unparseable input', () => {
    expect(parseTimeExpr('', NOW)).toBeNull();
    expect(parseTimeExpr('someday', NOW)).toBeNull();
    expect(parseTimeExpr('tomorrow 09:00', NOW)).toBeNull();
    expect(parseTimeExpr('today', NOW)).toBeNull();
  });

  it('rejects invalid calendar and clock values', () => {
    expect(parseTimeExpr('2026-02-30', NOW)).toBeNull();
    expect(parseTimeExpr('2026-07-01T24:00', NOW)).toBeNull();
    expect(parseTimeExpr('24:00', NOW)).toBeNull();
    expect(parseTimeExpr('12:60', NOW)).toBeNull();
    expect(parseTimeExpr('2026-07-01T09:45+99:99', NOW)).toBeNull();
  });

  it('rejects unsupported relative expressions', () => {
    expect(parseTimeExpr('0h ago', NOW)).toBeNull();
    expect(parseTimeExpr('-3h ago', NOW)).toBeNull();
    expect(parseTimeExpr('0w ago', NOW)).toBeNull();
    expect(parseTimeExpr('3 months ago', NOW)).toBeNull();
    expect(parseTimeExpr('3y ago', NOW)).toBeNull();
  });

  it('rejects malformed weekday and daypart forms', () => {
    expect(parseTimeExpr('someday', NOW)).toBeNull();
    expect(parseTimeExpr('funday', NOW)).toBeNull();
    expect(parseTimeExpr('last someday', NOW)).toBeNull();
    expect(parseTimeExpr('tuesday 25:00', NOW)).toBeNull();
    expect(parseTimeExpr('tuesday lunchtime', NOW)).toBeNull();
    expect(parseTimeExpr('this dawn', NOW)).toBeNull();
    expect(parseTimeExpr('last night 21:00', NOW)).toBeNull();
    expect(parseTimeExpr('monday9:00', NOW)).toBeNull();
  });

  it('rejects moments outside the allowed bounds', () => {
    expect(parseTimeExpr('2019-12-31T23:59:59Z', NOW)).toBeNull();
    expect(parseTimeExpr(new Date(NOW + 24 * 60 * 60 * 1000 + 1).toISOString(), NOW)).toBeNull();
  });
});
