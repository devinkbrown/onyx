// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * embeddingIndex.test.ts — the pure, model-free embedding math behind
 * vault-RAG. No DOM, no IndexedDB: all deterministic.
 */
import { describe, expect, it } from 'vitest';

import {
  EMBEDDING_DIM,
  HashingEmbeddingProvider,
  OllamaEmbeddingProvider,
  cosineSimilarity,
  embed,
  rankBySimilarity,
  tokenize,
} from './embeddingIndex';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('Hello, WORLD! foo_bar')).toEqual(['hello', 'world', 'foo', 'bar']);
  });

  it('drops single-character noise tokens', () => {
    expect(tokenize('a I go to X')).toEqual(['go', 'to']);
  });

  it('returns an empty array for empty or symbol-only text', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ??? ...')).toEqual([]);
  });

  it('keeps digits and accented / non-Latin letters', () => {
    expect(tokenize('café 2024 naïve')).toEqual(['café', '2024', 'naïve']);
    expect(tokenize('日本語 test')).toEqual(['日本語', 'test']);
  });

  it('case-folds unicode tokens and strips punctuation exactly', () => {
    expect(tokenize('CAFÉ, résumé! Version_2026; naïve coöperate -- 東京99 a I')).toEqual([
      'café',
      'résumé',
      'version',
      '2026',
      'naïve',
      'coöperate',
      '東京99',
    ]);
  });

  it('keeps accented and multilingual tokens while treating symbols as boundaries', () => {
    expect(tokenize('mañana🙂добро пожаловать; Ελληνικά/東京99 crème-brûlée')).toEqual([
      'mañana',
      'добро',
      'пожаловать',
      'ελληνικά',
      '東京99',
      'crème',
      'brûlée',
    ]);
  });

  it('is deterministic across calls', () => {
    expect(tokenize('repeat this repeat')).toEqual(tokenize('repeat this repeat'));
  });
});

describe('embed', () => {
  it('produces a fixed-dimension vector', () => {
    expect(embed('anything at all').length).toBe(EMBEDDING_DIM);
  });

  it('is deterministic for identical input', () => {
    expect(Array.from(embed('deploy the server'))).toEqual(Array.from(embed('deploy the server')));
  });

  it('is deterministic for adversarial unicode input and custom dimensions', () => {
    const text = 'CAFÉ café Ελληνικά 東京99 dobro добро emoji🙂boundary';
    const first = embed(text, 64);
    const second = embed(text, 64);

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first).toHaveLength(64);
    expect(first.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('produces different vectors for different inputs', () => {
    expect(Array.from(embed('deploy the server'))).not.toEqual(Array.from(embed('quiet weekend plans')));
  });

  it('returns a zero vector for token-free text', () => {
    const vec = embed('!!! ---');
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it('returns a zero vector for an empty string', () => {
    const vec = embed('');
    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it('returns a custom-dimension zero vector for empty text', () => {
    const vec = embed('', 16);
    expect(vec).toHaveLength(16);
    expect(Array.from(vec)).toEqual(Array.from(new Float32Array(16)));
  });

  it('L2-normalizes non-empty vectors to unit length', () => {
    const vec = embed('the quick brown fox jumps');
    const norm = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('honors a custom dimensionality', () => {
    expect(embed('sized down', 32).length).toBe(32);
  });

  it('keeps very long input bounded to the configured dimensionality', () => {
    const longText = Array.from({ length: 5000 }, (_, i) => `vault${i % 64}`).join(' ');
    const vec = embed(longText);
    const norm = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0));

    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(vec.every((v) => Number.isFinite(v))).toBe(true);
    expect(norm).toBeCloseTo(1, 6);
  });

  it('embeds a single token as one signed unit bucket', () => {
    const vec = embed('vault');
    const nonZero = Array.from(vec).filter((v) => v !== 0);

    expect(nonZero).toHaveLength(1);
    expect(Math.abs(nonZero[0]!)).toBeCloseTo(1, 6);
  });

  it('derives the bucket sign independently of the bucket (signed-trick debias)', () => {
    // A single 2+ char token embeds to exactly one non-zero entry: its signed
    // unit weight (tf=1 → weight=1, then L2-normalized → ±1) at the token's
    // bucket. Recover (bucket, sign) per token and confirm at least one bucket
    // holds tokens of BOTH signs. If the sign were a function of the same hash
    // bits as the bucket, every token sharing a bucket would share one sign and
    // colliding tokens could only reinforce, never cancel — defeating the
    // documented debias. This fails when the sign bit is drawn from the bucket.
    const signsByBucket = new Map<number, Set<number>>();
    for (let i = 0; i < 4000; i += 1) {
      const vec = embed(`tok${i}`);
      let bucket = -1;
      let sign = 0;
      for (let j = 0; j < vec.length; j += 1) {
        if (vec[j] !== 0) {
          bucket = j;
          sign = Math.sign(vec[j]!);
          break;
        }
      }
      expect(bucket).toBeGreaterThanOrEqual(0);
      if (!signsByBucket.has(bucket)) signsByBucket.set(bucket, new Set());
      signsByBucket.get(bucket)!.add(sign);
    }
    const mixed = [...signsByBucket.values()].filter((s) => s.size === 2).length;
    expect(mixed).toBeGreaterThan(0);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical embeddings', () => {
    const v = embed('reindex the vault tonight');
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('is 1 for a non-zero vector compared with itself', () => {
    const v = new Float32Array([0.25, -0.5, 0.75, 1]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('is 0 for exactly orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);

    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('is ~0 for texts sharing no tokens (orthogonal buckets)', () => {
    const a = embed('alpha bravo charlie');
    const b = embed('xylophone yesterday zephyr');
    expect(Math.abs(cosineSimilarity(a, b))).toBeLessThan(0.2);
  });

  it('is higher for overlapping text than disjoint text', () => {
    const query = embed('database migration failed');
    const near = embed('the database migration failed again');
    const far = embed('lunch plans for saturday');
    expect(cosineSimilarity(query, near)).toBeGreaterThan(cosineSimilarity(query, far));
  });

  it('returns 0 when either vector is a zero vector', () => {
    expect(cosineSimilarity(embed('hello world'), embed('!!!'))).toBe(0);
  });

  it('returns 0 for two empty-text embeddings', () => {
    expect(cosineSimilarity(embed(''), embed(''))).toBe(0);
  });

  it('returns 0 for mismatched or empty lengths', () => {
    expect(cosineSimilarity(new Float32Array(0), new Float32Array(0))).toBe(0);
    expect(cosineSimilarity(new Float32Array(4), new Float32Array(8))).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  const build = (id: string, text: string) => ({ id, vector: embed(text) });

  it('orders candidates by descending similarity to the query', () => {
    const qVec = embed('server crashed with an error');
    const candidates = [
      build('far', 'happy birthday to you'),
      build('near', 'the server crashed with a fatal error'),
      build('mid', 'error logs are noisy today'),
    ];
    const ranked = rankBySimilarity(qVec, candidates);
    // 'near' shares the most terms → most similar. (The model-free hashing
    // embedder has no IDF and can hash-collide, so we don't over-constrain the
    // fuzzy mid/far tail — only that the clear winner leads and scores are sorted.)
    expect(ranked[0]!.id).toBe('near');
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    // Scores are monotonically non-increasing.
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it('handles the empty candidate list', () => {
    expect(rankBySimilarity(embed('anything'), [])).toEqual([]);
  });

  it('handles a single candidate', () => {
    const ranked = rankBySimilarity(embed('solo'), [build('only', 'solo run')]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.id).toBe('only');
  });

  it('is stable for tied (equal) scores, preserving input order', () => {
    // A zero query vector scores every candidate 0 → ties everywhere.
    const zero = embed('!!!');
    const candidates = [build('a', 'one'), build('b', 'two'), build('c', 'three')];
    const ranked = rankBySimilarity(zero, candidates);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('preserves the candidate payload alongside the score', () => {
    const ranked = rankBySimilarity(embed('tag'), [{ id: 'x', label: 'keep-me', vector: embed('tag') }]);
    expect(ranked[0]!.label).toBe('keep-me');
    expect(typeof ranked[0]!.score).toBe('number');
  });
});

describe('HashingEmbeddingProvider', () => {
  it('matches the pure embed() function', () => {
    const provider = new HashingEmbeddingProvider();
    expect(provider.dim).toBe(EMBEDDING_DIM);
    expect(Array.from(provider.embed('parity check'))).toEqual(Array.from(embed('parity check')));
  });

  it('emits deterministic vectors across provider instances', () => {
    const text = 'unicode café 東京99 deterministic hashing';
    const a = new HashingEmbeddingProvider(32).embed(text);
    const b = new HashingEmbeddingProvider(32).embed(text);

    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('respects a custom dimensionality', () => {
    const provider = new HashingEmbeddingProvider(64);
    expect(provider.dim).toBe(64);
    expect(provider.embed('sized').length).toBe(64);
  });

  it('does not use fetch or any network path', () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error('network should not be used by the hashing provider');
    }) as typeof fetch;

    try {
      const provider = new HashingEmbeddingProvider();
      expect(provider.embed('local deterministic embedding')).toHaveLength(EMBEDDING_DIM);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('OllamaEmbeddingProvider (gated stub)', () => {
  const config = { endpoint: 'http://127.0.0.1:11434', model: 'nomic-embed-text', dim: 8, enabled: false };

  it('is unavailable when not explicitly enabled', () => {
    const provider = new OllamaEmbeddingProvider(config);
    expect(provider.isAvailable()).toBe(false);
  });

  it('falls back to a zero vector of the configured dim when disabled', async () => {
    const provider = new OllamaEmbeddingProvider(config);
    const vec = await provider.embed('never leaves the device');
    expect(vec.length).toBe(8);
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it('exposes its declared dimensionality', () => {
    expect(new OllamaEmbeddingProvider(config).dim).toBe(8);
  });
});
