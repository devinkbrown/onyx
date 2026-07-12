// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * searchVaultHybrid.ts — lexical+semantic hybrid ranking for vault search,
 * fused with Reciprocal Rank Fusion (RRF).
 *
 * The plain {@link searchVault} is exact-substring only; {@link searchVaultSemantic}
 * is cosine-neighbor only. Users want both: a verbatim hit for "migration" must
 * lead, but topical neighbors ("schema rollout error") should still surface
 * underneath. This module builds two independent rankings over the SAME
 * on-device IndexedDB scan and fuses them by rank, not by raw score:
 *
 *   1. Lexical ranking — rows whose sender or ciphertext body contain the query
 *      as a case-insensitive substring, ordered newest-first (stable).
 *   2. Semantic ranking — every row embedded locally with the deterministic
 *      hashing vectorizer and ranked by cosine similarity to the query, keeping
 *      only rows above `minScore`.
 *
 * Why RRF instead of blending the raw scores? A lexical substring match has no
 * numeric score at all, and cosine similarity lives on a scale that is
 * incomparable to any lexical relevance. Min/max- or z-normalizing two such
 * distributions is brittle and sensitive to outliers. RRF (Cormack, Clarke &
 * Buettcher, SIGIR 2009) sidesteps that entirely: it fuses on ORDINAL RANK,
 *
 *     score(d) = Σ over rankings  1 / (k + rank_d)      (rank is 1-based)
 *
 * with the empirically robust k = {@link RRF_K} (60). The constant damps the
 * pull of any single top-1 hit while still rewarding agreement, so a document
 * ranked highly by BOTH the lexical and semantic legs accumulates two
 * reciprocal contributions and wins — which is exactly the hybrid intent.
 *
 * Nothing leaves the device; the vectorizer is pure and deterministic, so
 * results are stable across repeated calls. Bounded at vault scale
 * (≤ VAULT_KEEP rows per target), so the full embed pass stays cheap.
 */
import { readAllVaultHits, type VaultSearchHit } from './historyVault';
import {
  defaultEmbeddingProvider,
  rankBySimilarity,
  type EmbeddingProvider,
} from './embeddingIndex';

/** Reciprocal Rank Fusion damping constant (Cormack et al. 2009 default). */
export const RRF_K = 60;

/** A fused item and its accumulated reciprocal-rank score. */
export interface RrfResult<T> {
  item: T;
  score: number;
}

interface RrfOptions<T> {
  /** Damping constant; larger flattens rank influence. Defaults to {@link RRF_K}. */
  k?: number;
  /** Total-order comparator applied only to equal-score items (stable otherwise). */
  tieBreak?: (a: T, b: T) => number;
}

/**
 * Fuse several already-ranked lists (best-first) into one ranking by
 * Reciprocal Rank Fusion: each item scores Σ 1/(k + rank) across the lists it
 * appears in, deduped by `keyOf`. Returns items sorted by descending fused
 * score; equal scores keep first-appearance order unless `tieBreak` is given.
 * Pure and deterministic — no DOM, no IndexedDB, no network.
 */
export function reciprocalRankFusion<T>(
  rankings: readonly (readonly T[])[],
  keyOf: (item: T) => string,
  opts: RrfOptions<T> = {},
): RrfResult<T>[] {
  const k = opts.k ?? RRF_K;
  const acc = new Map<string, RrfResult<T>>();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i += 1) {
      const item = ranking[i]!;
      const contribution = 1 / (k + i + 1); // rank is 1-based
      const key = keyOf(item);
      const prev = acc.get(key);
      if (prev) prev.score += contribution;
      else acc.set(key, { item, score: contribution });
    }
  }
  const results = [...acc.values()];
  const { tieBreak } = opts;
  // Array.sort is stable, so equal-score items keep Map insertion order (which
  // mirrors first-appearance across the input rankings) unless tieBreak orders them.
  results.sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    return tieBreak ? tieBreak(a.item, b.item) : 0;
  });
  return results;
}

export interface HybridSearchOptions {
  /** Max hits to return across the fused (lexical + semantic) result. */
  limit?: number;
  /** Drop semantic hits at or below this cosine similarity. Default 0. */
  minScore?: number;
  /** Override the on-device embedding provider (defaults to the hashing one). */
  provider?: EmbeddingProvider;
}

const DEFAULT_LIMIT = 40;

/** The text a message contributes to matching/embedding: sender + body. */
function candidateText(hit: VaultSearchHit): string {
  return `${hit.message.from} ${hit.message.text}`;
}

/**
 * Stable fusion key. `message.id` alone is NOT unique across the whole vault
 * (the store is keyed `[target_key, id]`), and this search spans every target,
 * so the key must include the conversation to avoid cross-target collisions.
 */
function hitKey(hit: VaultSearchHit): string {
  return `${hit.target} ${hit.message.id}`;
}

/** Newest-first, then key-stable — a total order for deterministic tie-breaks. */
function newestFirst(a: VaultSearchHit, b: VaultSearchHit): number {
  const byTime = b.message.time.getTime() - a.message.time.getTime();
  if (byTime !== 0) return byTime;
  const ka = hitKey(a);
  const kb = hitKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Rank every remembered conversation on this device against `query` by fusing
 * an exact-substring lexical ranking with an on-device semantic ranking via
 * Reciprocal Rank Fusion. Returns [] for an empty query or an empty/absent
 * vault. Deterministic and network-free.
 */
export async function searchVaultHybrid(
  query: string,
  opts: HybridSearchOptions = {},
): Promise<VaultSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const provider = opts.provider ?? defaultEmbeddingProvider;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minScore = opts.minScore ?? 0;

  const hits = await readAllVaultHits();
  if (hits.length === 0) return [];

  // Lexical ranking: locale-aware, case-insensitive substring over sender+body,
  // newest-first (stable). Mirrors searchVault's matcher so accented and
  // non-Latin queries fold consistently.
  const needle = trimmed.toLocaleLowerCase();
  const lexicalRanking = hits
    .filter((hit) => candidateText(hit).toLocaleLowerCase().includes(needle))
    .slice()
    .sort(newestFirst);

  // Semantic ranking: embed the query and EVERY row on-device, rank by cosine,
  // and keep only rows above minScore. Scoring every row (not just non-lexical
  // ones) is what lets RRF reward a doc that both legs rank highly.
  const qVec = await Promise.resolve(provider.embed(trimmed));
  const candidates = await Promise.all(
    hits.map(async (hit) => ({
      hit,
      vector: await Promise.resolve(provider.embed(candidateText(hit))),
    })),
  );
  const semanticRanking = rankBySimilarity(qVec, candidates)
    .filter((entry) => entry.score > minScore)
    .map((entry) => entry.hit);

  // Fuse the two rankings by reciprocal rank; break score ties newest-first.
  const fused = reciprocalRankFusion(
    [lexicalRanking, semanticRanking],
    hitKey,
    { tieBreak: newestFirst },
  );
  return fused.slice(0, limit).map((entry) => entry.item);
}
