// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * searchVaultSemantic.ts — vault-RAG semantic search (Roadmap v3.0 headline).
 *
 * The E2EE-safe search no cloud can offer: it scans the SAME on-device
 * IndexedDB rows the lexical {@link searchVault} reads, embeds the query and
 * a globally bounded newest-first candidate slice locally with a deterministic
 * model-free provider, ranks by
 * cosine similarity, and returns the EXISTING {@link VaultSearchHit} shape.
 *
 * Nothing leaves the device. The history-vault reader applies both per-target
 * retention and a global row cap before this module schedules embedding work.
 */
import { readAllVaultHits, type DeviceMemoryOwner, type VaultSearchHit } from './historyVault';
import {
  defaultEmbeddingProvider,
  embedItemsBounded,
  rankBySimilarity,
  type EmbeddingProvider,
} from './embeddingIndex';
import { boundedSearchQuery, buildBoundedSearchText } from './searchBounds';

export interface SemanticSearchOptions {
  /** Max hits to return, best-first. */
  limit?: number;
  /** Drop hits whose cosine similarity is at or below this. Default 0. */
  minScore?: number;
  /** Override the on-device embedding provider (defaults to the hashing one). */
  provider?: EmbeddingProvider;
  /** Stop scheduling candidate work when a newer UI query supersedes this one. */
  signal?: AbortSignal;
  /** Exact server/account namespace whose remembered rows may be searched. */
  owner?: DeviceMemoryOwner;
}

const DEFAULT_LIMIT = 40;

/** The text a message contributes to its embedding: sender + body. */
function candidateText(hit: VaultSearchHit): string {
  return buildBoundedSearchText(hit.message.from, hit.message.text);
}

/**
 * Semantically rank the bounded newest slice of remembered conversations on
 * this device against `query`. Ties break toward newer messages so the result
 * feels like "closest, then freshest".
 *
 * Returns [] for an empty query, an empty/absent vault, or when embeddings
 * degenerate (e.g. a query of only stopword-length noise).
 */
export async function searchVaultSemantic(
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<VaultSearchHit[]> {
  const trimmed = boundedSearchQuery(query);
  if (!trimmed) return [];

  const provider = opts.provider ?? defaultEmbeddingProvider;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minScore = opts.minScore ?? 0;

  const hits = await readAllVaultHits(undefined, opts.owner);
  if (hits.length === 0 || opts.signal?.aborted) return [];

  const qVec = await Promise.resolve(provider.embed(trimmed));
  if (opts.signal?.aborted) return [];

  const embedded = await embedItemsBounded(hits, candidateText, provider, opts.signal);
  if (opts.signal?.aborted) return [];
  const candidates = embedded.map(({ item: hit, vector }) => ({ hit, vector }));

  const ranked = rankBySimilarity(qVec, candidates);
  return ranked
    .filter((entry) => entry.score > minScore)
    // Best score first; equal scores → newer message first.
    .sort((a, b) => b.score - a.score || b.hit.message.time.getTime() - a.hit.message.time.getTime())
    .slice(0, limit)
    .map((entry) => entry.hit);
}
