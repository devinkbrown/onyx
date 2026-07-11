// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { relTime } from './networkIndex';

describe('relTime', () => {
  it('keeps the empty timestamp fallback', () => {
    expect(relTime(0, Date.parse('2026-07-08T12:00:00Z'))).toBe('a while ago');
  });

  it('uses the shared compact relative formatter for valid timestamps', () => {
    const now = Date.parse('2026-07-08T12:00:00Z');

    expect(relTime(Date.parse('2026-07-08T11:57:00Z') / 1000, now)).toBe('3m ago');
    expect(relTime(Date.parse('2026-07-08T14:00:00Z') / 1000, now)).toBe('in 2h');
  });
});
