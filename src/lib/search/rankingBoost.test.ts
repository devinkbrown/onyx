// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { boostedScore, rankHits } from './rankingBoost';

describe('rankingBoost', () => {
  it('prefers exact same-room recent hits', () => {
    const ranked = rankHits([
      { id: 'a', score: 0.5, ageMs: 1000 * 60 * 60 * 24 * 40 },
      { id: 'b', score: 0.5, exact: true, sameRoom: true, ageMs: 1000 },
    ]);
    expect(ranked[0]?.id).toBe('b');
    expect(boostedScore({ id: 'x', score: 1, fromSelf: true })).toBeLessThan(1);
  });
});
