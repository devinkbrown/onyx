// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * embeddingIndex.ts — model-free, deterministic text embeddings for the
 * local vault-RAG semantic search (Roadmap v3.0).
 *
 * The whole point of vault-RAG is an E2EE-safe search NO cloud can offer: the
 * embeddings are computed here, on-device, over the same IndexedDB rows the
 * lexical search already scans. So the default provider is a pure hashing
 * vectorizer — no network, no model download, no corpus, fully deterministic
 * and covered by unit tests. An OllamaEmbeddingProvider stub is offered for
 * users who opt into a richer local model, but it is gated and never invoked
 * by the default search path.
 *
 * The hashing vectorizer is the classic "hashing trick" + sublinear term
 * frequency + signed buckets (to unbias collisions) + L2 normalization. That
 * makes cosine similarity a plain dot product and keeps ranking stable.
 */

/** Fixed embedding dimensionality. A power of two keeps bucket math cheap. */
export const EMBEDDING_DIM = 256;

/** A provider turns text into a fixed-length vector (sync or async). */
export interface EmbeddingProvider {
  /** Vector dimensionality this provider emits. */
  readonly dim: number;
  embed(text: string): Float32Array | Promise<Float32Array>;
}

/**
 * Split text into lowercased alphanumeric tokens.
 *
 * Deterministic and locale-independent: Unicode letters/numbers are kept,
 * everything else is a boundary. Single-character tokens are dropped as noise.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const out: string[] = [];
  // \p{L}\p{N} keeps accented letters and non-Latin scripts as real tokens.
  for (const match of lowered.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length >= 2) out.push(token);
  }
  return out;
}

/** Default FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;
/** Independent basis for the sign hash so it decorrelates from the bucket. */
const FNV_SIGN_OFFSET = 0x9e3779b1;

/** FNV-1a 32-bit hash — small, fast, deterministic, no dependencies. */
function fnv1a(input: string, seed: number = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619, kept in 32-bit unsigned range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Hash a token into a bucket index in [0, dim) plus a stable ±1 sign.
 * A second hash drives the sign so colliding tokens can cancel instead of
 * always reinforcing — the standard signed hashing-trick debias.
 */
function bucketAndSign(token: string, dim: number): { bucket: number; sign: number } {
  const bucket = fnv1a(token) % dim;
  // Two independence hazards must both be avoided or the debias silently no-ops:
  //   1. FNV-1a's lowest bit is linear (bit 0 of the output is the parity of the
  //      seed XOR the low bits of every input byte), so a salted re-hash still
  //      leaves bit 0 perfectly correlated with the original. Read a high,
  //      well-mixed bit (bit 16) for the sign, never bit 0.
  //   2. `bucket = h % dim` consumes the low log2(dim) bits of the SAME hash, so
  //      the sign must come from an independent hash (distinct offset basis).
  const signHash = fnv1a(token, FNV_SIGN_OFFSET);
  const sign = ((signHash >>> 16) & 1) === 0 ? 1 : -1;
  return { bucket, sign };
}

/**
 * Embed text into an L2-normalized Float32Array using the hashing trick with
 * sublinear (1 + log tf) term weighting. Empty / token-free text yields a
 * zero vector (cosine with anything is 0).
 */
export function embed(text: string, dim: number = EMBEDDING_DIM): Float32Array {
  const vec = new Float32Array(dim);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  // Raw term frequencies.
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);

  // Accumulate signed, sublinear-weighted contributions per bucket.
  for (const [token, count] of tf) {
    const weight = 1 + Math.log(count);
    const { bucket, sign } = bucketAndSign(token, dim);
    vec[bucket]! += sign * weight;
  }

  // L2 normalize so cosine similarity is a bare dot product.
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i += 1) vec[i]! /= norm;
  }
  return vec;
}

/**
 * Cosine similarity of two vectors, in [-1, 1]. Returns 0 when either vector
 * is empty/zero-length or a zero vector, and when lengths differ.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** A candidate carrying its precomputed vector plus arbitrary payload. */
export type ScoredCandidate<T> = T & { vector: Float32Array };

/**
 * Rank candidates by cosine similarity to a query vector, highest first.
 * Ordering is stable: equal scores preserve input order. Each result keeps
 * its original payload and gains a numeric `score`.
 */
export function rankBySimilarity<T>(
  qVec: Float32Array,
  candidates: ReadonlyArray<ScoredCandidate<T>>,
): Array<ScoredCandidate<T> & { score: number }> {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: cosineSimilarity(qVec, candidate.vector) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate, score }) => ({ ...candidate, score }));
}

/**
 * Default, pure, deterministic provider. No network, no model, testable.
 * This is what the vault-RAG search path uses unless a user opts into another.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;

  constructor(dim: number = EMBEDDING_DIM) {
    this.dim = dim;
  }

  embed(text: string): Float32Array {
    return embed(text, this.dim);
  }
}

/** Config for the opt-in local Ollama embedding provider. */
export interface OllamaEmbeddingConfig {
  /** e.g. 'http://127.0.0.1:11434'. */
  endpoint: string;
  /** e.g. 'nomic-embed-text'. */
  model: string;
  /** Vector size the model emits (used for zero-vector fallbacks). */
  dim: number;
  /** Must be explicitly true; otherwise the provider stays inert. */
  enabled: boolean;
}

/**
 * GATED stub for a local Ollama embedding model. Kept model- and
 * network-agnostic and NEVER exercised by unit tests or the default search —
 * it only fires when a user has an Ollama daemon and flips `enabled`. When
 * disabled or when `fetch` is unavailable it degrades to a zero vector so the
 * caller (rankBySimilarity) simply scores it 0 rather than throwing.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  private readonly config: OllamaEmbeddingConfig;

  constructor(config: OllamaEmbeddingConfig) {
    this.config = config;
    this.dim = config.dim;
  }

  /** True only when opted in and a fetch implementation exists. */
  isAvailable(): boolean {
    return this.config.enabled && typeof fetch === 'function';
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.isAvailable()) return new Float32Array(this.dim);
    try {
      const res = await fetch(`${this.config.endpoint.replace(/\/+$/, '')}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt: text }),
      });
      if (!res.ok) return new Float32Array(this.dim);
      const data: unknown = await res.json();
      const embedding =
        typeof data === 'object' && data !== null && Array.isArray((data as { embedding?: unknown }).embedding)
          ? (data as { embedding: unknown[] }).embedding
          : null;
      if (!embedding) return new Float32Array(this.dim);
      const vec = new Float32Array(embedding.length);
      for (let i = 0; i < embedding.length; i += 1) {
        const value = embedding[i];
        vec[i] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }
      return vec;
    } catch {
      // Network / daemon unavailable — fail soft to a zero vector.
      return new Float32Array(this.dim);
    }
  }
}

/** The provider the vault-RAG search uses by default. */
export const defaultEmbeddingProvider: EmbeddingProvider = new HashingEmbeddingProvider();
