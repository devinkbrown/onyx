// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * searchVaultHybrid.rrf.test.ts — pure Reciprocal Rank Fusion math.
 *
 * DOM-free and IndexedDB-free on purpose: {@link reciprocalRankFusion} is a
 * pure ordinal-rank fusion over already-ranked lists, so it needs no vault and
 * no fake-indexeddb. These tests pin the standard k=60 formula, the "agreed by
 * both rankings wins" property, disjoint-list interleaving, and determinism.
 */
import { describe, expect, it } from 'vitest';

import { RRF_K, reciprocalRankFusion } from './searchVaultHybrid';

const id = (s: string): string => s;

describe('reciprocalRankFusion', () => {
  it('uses the canonical k=60 constant', () => {
    expect(RRF_K).toBe(60);
  });

  it('scores a single rank-1 appearance as 1/(k+1)', () => {
    const [top] = reciprocalRankFusion([['a', 'b', 'c']], id);
    expect(top!.item).toBe('a');
    expect(top!.score).toBeCloseTo(1 / (RRF_K + 1), 12);
  });

  it('interleaves two fully disjoint rankings by rank, higher list first on ties', () => {
    // a,b,c and x,y,z share no keys. Each pair (a,x),(b,y),(c,z) ties on score;
    // the first-listed ranking wins equal-score ties (stable insertion order).
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
    ], id);
    expect(fused.map((r) => r.item)).toEqual(['a', 'x', 'b', 'y', 'c', 'z']);
    // Each item appears in exactly one list, so each score is a single 1/(k+rank).
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(fused[1]!.score).toBeCloseTo(1 / (RRF_K + 1), 12);
  });

  it('lets a doc ranked #1 by BOTH rankings win decisively', () => {
    // "a" is rank 1 in both lists; nothing else can match its 2/(k+1) score.
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
    ], id);
    expect(fused[0]!.item).toBe('a');
    expect(fused[0]!.score).toBeCloseTo(2 / (RRF_K + 1), 12);
    // No other item reaches the double-rank-1 score.
    expect(fused[1]!.score).toBeLessThan(fused[0]!.score);
  });

  it('rewards broad agreement over a single strong rank', () => {
    // "hi" is only ever rank 1 in list A. "mid" is rank 2 in BOTH lists.
    // Two rank-2 votes 2/(k+2)=0.03226 beat one rank-1 vote 1/(k+1)=0.01639.
    const fused = reciprocalRankFusion([
      ['hi', 'mid', 'x'],
      ['y', 'mid', 'z'],
    ], id);
    const scoreOf = (key: string): number =>
      fused.find((r) => r.item === key)!.score;
    expect(scoreOf('mid')).toBeCloseTo(2 / (RRF_K + 2), 12);
    expect(scoreOf('hi')).toBeCloseTo(1 / (RRF_K + 1), 12);
    // Two rank-2 votes (0.0323) outrank one rank-1 vote (0.0164).
    expect(scoreOf('mid')).toBeGreaterThan(scoreOf('hi'));
    expect(fused[0]!.item).toBe('mid');
  });

  it('accepts a custom k', () => {
    const [top] = reciprocalRankFusion([['a']], id, { k: 0 });
    expect(top!.score).toBeCloseTo(1 / 1, 12);
  });

  it('honors a custom tie-break on equal scores', () => {
    // a and b both appear only at rank 1 of separate lists → equal score.
    // Tie-break sorts descending by string, so 'b' precedes 'a'.
    const fused = reciprocalRankFusion(
      [['a'], ['b']],
      id,
      { tieBreak: (x, y) => (x < y ? 1 : x > y ? -1 : 0) },
    );
    expect(fused.map((r) => r.item)).toEqual(['b', 'a']);
  });

  it('dedupes by key across lists, summing contributions', () => {
    const fused = reciprocalRankFusion([
      ['dup', 'a'],
      ['dup'],
    ], id);
    expect(fused.filter((r) => r.item === 'dup')).toHaveLength(1);
    expect(fused[0]!.item).toBe('dup');
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 1), 12);
  });

  it('returns [] for no rankings and for empty rankings', () => {
    expect(reciprocalRankFusion([], id)).toEqual([]);
    expect(reciprocalRankFusion([[], []], id)).toEqual([]);
  });

  it('is deterministic across repeated fusions of the same input', () => {
    const input: readonly (readonly string[])[] = [
      ['a', 'b', 'c', 'd'],
      ['c', 'a', 'e', 'b'],
    ];
    const a = reciprocalRankFusion(input, id).map((r) => r.item);
    const b = reciprocalRankFusion(input, id).map((r) => r.item);
    expect(a).toEqual(b);
  });
});
