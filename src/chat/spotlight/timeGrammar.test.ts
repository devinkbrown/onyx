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
    expect(parseTimeExpr('3w ago', NOW)).toBeNull();
    expect(parseTimeExpr('3 months ago', NOW)).toBeNull();
  });

  it('rejects moments outside the allowed bounds', () => {
    expect(parseTimeExpr('2019-12-31T23:59:59Z', NOW)).toBeNull();
    expect(parseTimeExpr(new Date(NOW + 24 * 60 * 60 * 1000 + 1).toISOString(), NOW)).toBeNull();
  });
});
