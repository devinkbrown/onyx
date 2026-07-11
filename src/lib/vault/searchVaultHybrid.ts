// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * searchVaultHybrid.ts — lexical+semantic hybrid ranking for vault search.
 *
 * The plain {@link searchVault} is exact-substring only; {@link searchVaultSemantic}
 * is cosine-neighbor only. Users want both: a verbatim hit for "migration" must
 * lead, but topical neighbors ("schema rollout error") should still surface
 * underneath. This module merges the two over the SAME on-device IndexedDB scan:
 *
 *   1. Lexical bucket — rows whose sender or ciphertext body contain the query
 *      as a case-insensitive substring, ordered newest-first (stable).
 *   2. Semantic bucket — every remaining row, embedded locally with the
 *      deterministic hashing vectorizer and ranked by cosine similarity to the
 *      query, above `minScore`.
 *
 * Lexical always precedes semantic, so an exact hit can never be buried by a
 * higher-cosine neighbor. Nothing leaves the device; the vectorizer is pure and
 * deterministic, so results are stable across repeated calls. Bounded at vault
 * scale (≤ VAULT_KEEP rows per target), so the full embed pass stays cheap.
 */
import { readAllVaultHits, type VaultSearchHit } from './historyVault';
import {
  defaultEmbeddingProvider,
  rankBySimilarity,
  type EmbeddingProvider,
} from './embeddingIndex';

export interface HybridSearchOptions {
  /** Max hits to return across the merged (lexical + semantic) result. */
  limit?: number;
  /** Drop semantic-only hits at or below this cosine similarity. Default 0. */
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
 * Rank every remembered conversation on this device against `query`, exact
 * substring matches first (newest-first), then semantic neighbors (closest,
 * then freshest). Returns [] for an empty query or an empty/absent vault.
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

  // Locale-aware, case-insensitive substring — mirrors searchVault's matcher so
  // accented and non-Latin queries fold consistently.
  const needle = trimmed.toLocaleLowerCase();
  const lexical: VaultSearchHit[] = [];
  const rest: VaultSearchHit[] = [];
  for (const hit of hits) {
    if (candidateText(hit).toLocaleLowerCase().includes(needle)) lexical.push(hit);
    else rest.push(hit);
  }

  // Lexical bucket: newest-first, stable on ties (preserve scan order).
  const lexicalRanked = lexical
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => b.hit.message.time.getTime() - a.hit.message.time.getTime() || a.index - b.index)
    .map(({ hit }) => hit);

  if (lexicalRanked.length >= limit) return lexicalRanked.slice(0, limit);

  // Semantic bucket over the non-lexical remainder only.
  const remaining = limit - lexicalRanked.length;
  const qVec = await Promise.resolve(provider.embed(trimmed));
  const candidates = await Promise.all(
    rest.map(async (hit) => ({ hit, vector: await Promise.resolve(provider.embed(candidateText(hit))) })),
  );
  const semanticRanked = rankBySimilarity(qVec, candidates)
    .filter((entry) => entry.score > minScore)
    .sort((a, b) => b.score - a.score || b.hit.message.time.getTime() - a.hit.message.time.getTime())
    .slice(0, remaining)
    .map((entry) => entry.hit);

  return [...lexicalRanked, ...semanticRanked];
}
