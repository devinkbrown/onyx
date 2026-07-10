/**
 * searchVaultSemantic.ts — vault-RAG semantic search (Roadmap v3.0 headline).
 *
 * The E2EE-safe search no cloud can offer: it scans the SAME on-device
 * IndexedDB rows the lexical {@link searchVault} reads, embeds the query and
 * every candidate locally with a deterministic model-free provider, ranks by
 * cosine similarity, and returns the EXISTING {@link VaultSearchHit} shape.
 *
 * Nothing leaves the device. Bounded at vault scale (≤ VAULT_KEEP rows per
 * target), so a full embed-and-rank pass is cheap.
 */
import { readAllVaultHits, type VaultSearchHit } from './historyVault';
import {
  defaultEmbeddingProvider,
  rankBySimilarity,
  type EmbeddingProvider,
} from './embeddingIndex';

export interface SemanticSearchOptions {
  /** Max hits to return, best-first. */
  limit?: number;
  /** Drop hits whose cosine similarity is at or below this. Default 0. */
  minScore?: number;
  /** Override the on-device embedding provider (defaults to the hashing one). */
  provider?: EmbeddingProvider;
}

const DEFAULT_LIMIT = 40;

/** The text a message contributes to its embedding: sender + body. */
function candidateText(hit: VaultSearchHit): string {
  return `${hit.message.from} ${hit.message.text}`;
}

/**
 * Semantically rank every remembered conversation on this device against
 * `query`, newest-similarity first. Ties break toward newer messages so the
 * result feels like "closest, then freshest".
 *
 * Returns [] for an empty query, an empty/absent vault, or when embeddings
 * degenerate (e.g. a query of only stopword-length noise).
 */
export async function searchVaultSemantic(
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<VaultSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const provider = opts.provider ?? defaultEmbeddingProvider;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minScore = opts.minScore ?? 0;

  const hits = await readAllVaultHits();
  if (hits.length === 0) return [];

  const qVec = await Promise.resolve(provider.embed(trimmed));

  // Embed every candidate (await handles sync or async providers uniformly).
  const candidates = await Promise.all(
    hits.map(async (hit) => ({
      hit,
      vector: await Promise.resolve(provider.embed(candidateText(hit))),
    })),
  );

  const ranked = rankBySimilarity(qVec, candidates);
  return ranked
    .filter((entry) => entry.score > minScore)
    // Best score first; equal scores → newer message first.
    .sort((a, b) => b.score - a.score || b.hit.message.time.getTime() - a.hit.message.time.getTime())
    .slice(0, limit)
    .map((entry) => entry.hit);
}
