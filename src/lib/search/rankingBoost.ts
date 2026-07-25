// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * rankingBoost.ts — hybrid search ranking boosts (recency + exact + room affinity).
 */

export type RankableHit = {
  id: string;
  score: number;
  exact?: boolean;
  ageMs?: number;
  sameRoom?: boolean;
  fromSelf?: boolean;
};

export type BoostWeights = {
  exact: number;
  sameRoom: number;
  recencyHalfLifeMs: number;
  selfPenalty: number;
};

export const DEFAULT_BOOSTS: BoostWeights = {
  exact: 0.35,
  sameRoom: 0.15,
  recencyHalfLifeMs: 1000 * 60 * 60 * 24 * 14, // 14d
  selfPenalty: 0.05,
};

export function boostedScore(hit: RankableHit, weights: BoostWeights = DEFAULT_BOOSTS): number {
  let score = hit.score;
  if (hit.exact) score += weights.exact;
  if (hit.sameRoom) score += weights.sameRoom;
  if (hit.fromSelf) score -= weights.selfPenalty;
  if (typeof hit.ageMs === 'number' && hit.ageMs >= 0 && weights.recencyHalfLifeMs > 0) {
    // Exponential decay in [0, 0.25]
    const recency = 0.25 * Math.exp(-hit.ageMs / weights.recencyHalfLifeMs);
    score += recency;
  }
  return score;
}

export function rankHits<T extends RankableHit>(
  hits: readonly T[],
  weights: BoostWeights = DEFAULT_BOOSTS,
): T[] {
  return [...hits]
    .map((hit) => ({ hit, score: boostedScore(hit, weights) }))
    .sort((a, b) => b.score - a.score || a.hit.id.localeCompare(b.hit.id))
    .map((row) => row.hit);
}
