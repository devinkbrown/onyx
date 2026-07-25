// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { boostedScore, DEFAULT_BOOSTS, rankHits } from './rankingBoost';

describe('rankingBoost', () => {
  it('prefers exact same-room recent hits', () => {
    const ranked = rankHits([
      { id: 'a', score: 0.5, ageMs: 1000 * 60 * 60 * 24 * 40 },
      { id: 'b', score: 0.5, exact: true, sameRoom: true, ageMs: 1000 },
    ]);
    expect(ranked[0]?.id).toBe('b');
    expect(boostedScore({ id: 'x', score: 1, fromSelf: true })).toBeLessThan(1);
  });

  it('adds exact and sameRoom weights on top of the base score', () => {
    const base = 0.1;
    expect(boostedScore({ id: 'e', score: base, exact: true }))
      .toBeCloseTo(base + DEFAULT_BOOSTS.exact, 12);
    expect(boostedScore({ id: 'r', score: base, sameRoom: true }))
      .toBeCloseTo(base + DEFAULT_BOOSTS.sameRoom, 12);
  });

  it('applies recency decay and never exceeds base + 0.25', () => {
    const base = 1;
    const fresh = boostedScore({ id: 'f', score: base, ageMs: 0 });
    const old = boostedScore({ id: 'o', score: base, ageMs: DEFAULT_BOOSTS.recencyHalfLifeMs });
    expect(fresh).toBeCloseTo(base + 0.25, 12);
    expect(old).toBeCloseTo(base + 0.25 * Math.exp(-1), 12);
    expect(fresh).toBeGreaterThan(old);
  });

  it('breaks equal boosted scores by id for determinism', () => {
    const ranked = rankHits([
      { id: 'z', score: 1 },
      { id: 'a', score: 1 },
    ]);
    expect(ranked.map((h) => h.id)).toEqual(['a', 'z']);
  });
});
