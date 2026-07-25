// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * searchVaultHybrid.test.ts — hybrid lexical+semantic ranking over a real
 * (fake-indexeddb) vault, fused with Reciprocal Rank Fusion. Pins that an
 * exact-substring hit surfaces at the top, that a doc ranked highly by BOTH
 * legs wins, and that fusion stays deterministic and bounded. The pure RRF
 * math is pinned separately in searchVaultHybrid.rrf.test.ts.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { boostedScore } from '@/lib/search/rankingBoost';
import type { EmbeddingProvider } from './embeddingIndex';
import { _resetVaultForTests, saveMessages, type VaultSearchHit } from './historyVault';
import { searchVaultHybrid, vaultHitAgeMs } from './searchVaultHybrid';

function msg(id: string, text: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    time: new Date(1_700_000_000_000 + Number(id.replace(/\D/g, '') || 0) * 1000),
    from: 'kain',
    text,
    type: 'msg',
    target: '#room',
    ...over,
  } as ChatMessage;
}

function hit(id: string, text: string, over: Partial<ChatMessage> = {}): VaultSearchHit {
  return { target: '#room', message: msg(id, text, over) };
}

describe('searchVaultHybrid', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
  });

  it('returns [] for an empty or whitespace query', async () => {
    await saveMessages('#room', [msg('m1', 'deploy the production server tonight')]);
    expect(await searchVaultHybrid('')).toEqual([]);
    expect(await searchVaultHybrid('   ')).toEqual([]);
  });

  it('returns [] when the vault is empty', async () => {
    expect(await searchVaultHybrid('anything')).toEqual([]);
  });

  it('ranks an exact substring hit ahead of a token-sharing semantic neighbor', async () => {
    // The phrase 'schema change' appears verbatim only in m2. m1 shares the
    // 'schema' token (a semantic neighbor) but not the contiguous phrase; m3 is
    // unrelated. The lexical hit must lead, the neighbor must still surface.
    await saveMessages('#ops', [
      msg('m1', 'the schema was reviewed by the whole database team today'),
      msg('m2', 'a schema change broke the nightly build'),
      msg('m3', 'lunch plans for saturday afternoon'),
    ]);

    const hits = await searchVaultHybrid('schema change');
    expect(hits[0]!.message.id).toBe('m2');
    // The token-sharing neighbor still surfaces, just after the lexical hit.
    const ids = hits.map((h) => h.message.id);
    expect(ids).toContain('m1');
    expect(ids).not.toContain('m3');
  });

  it('returns every lexical match when several share the query token', async () => {
    // All three contain 'deploy', so all are lexical hits and every one must
    // surface. Their internal order is set by RRF (lexical rank fused with
    // semantic rank), not a bare newest-first sort — see the RRF unit tests.
    await saveMessages('#ops', [
      msg('m1', 'deploy step one'),
      msg('m2', 'deploy step two'),
      msg('m3', 'deploy step three'),
    ]);
    const hits = await searchVaultHybrid('deploy');
    expect(new Set(hits.map((h) => h.message.id))).toEqual(new Set(['m1', 'm2', 'm3']));
  });

  it('matches on the sender field as well as the body', async () => {
    await saveMessages('#ops', [
      msg('m1', 'unrelated body text here', { from: 'alice' }),
      msg('m2', 'more unrelated chatter', { from: 'bob' }),
    ]);
    const hits = await searchVaultHybrid('alice');
    expect(hits[0]!.message.id).toBe('m1');
  });

  it('is deterministic across repeated calls', async () => {
    await saveMessages('#ops', [
      msg('m1', 'incident postmortem scheduled for the outage'),
      msg('m2', 'the outage timeline needs a review'),
      msg('m3', 'lunch plans for saturday'),
    ]);
    const a = (await searchVaultHybrid('outage postmortem')).map((h) => h.message.id);
    const b = (await searchVaultHybrid('outage postmortem')).map((h) => h.message.id);
    expect(a).toEqual(b);
  });

  it('excludes deleted and redacted rows', async () => {
    await saveMessages('#ops', [
      msg('keep', 'server restart completed cleanly'),
      msg('gone', 'server restart completed cleanly', { deleted: true }),
      msg('hidden', 'server restart completed cleanly', { redacted: true }),
    ]);
    const hits = await searchVaultHybrid('server restart');
    const ids = hits.map((h) => h.message.id);
    expect(ids).toContain('keep');
    expect(ids).not.toContain('gone');
    expect(ids).not.toContain('hidden');
  });

  it('honors the limit option across the merged result', async () => {
    await saveMessages('#big', [
      msg('m1', 'error one here'),
      msg('m2', 'error two here'),
      msg('m3', 'error three here'),
      msg('m4', 'error four here'),
    ]);
    const hits = await searchVaultHybrid('error here', { limit: 2 });
    expect(hits).toHaveLength(2);
  });

  it('ranks accented / non-latin substring hits correctly', async () => {
    await saveMessages('#i18n', [
      msg('m1', 'réunion prévue pour demain matin'),
      msg('m2', 'totally unrelated english chatter'),
    ]);
    const hits = await searchVaultHybrid('réunion');
    expect(hits[0]!.message.id).toBe('m1');
  });

  // A controlled provider maps recognizable keywords to fixed vectors so the
  // semantic ranking is fully deterministic — isolating RRF's fusion wiring
  // from the hashing vectorizer's specifics. cosineSimilarity self-normalizes,
  // so raw (non-unit) vectors are fine, and a zero vector scores 0 (dropped).
  const keywordProvider: EmbeddingProvider = {
    dim: 2,
    embed(text: string): Float32Array {
      const lower = text.toLocaleLowerCase();
      if (lower.includes('apple')) return new Float32Array([1, 0]); // aligned w/ query
      if (lower.includes('banana')) return new Float32Array([0.8, 0.2]); // near query
      return new Float32Array([0, 1]); // orthogonal to query → cosine 0 → dropped
    },
  };

  it('lets a doc ranked by BOTH legs beat a semantic-only neighbor', async () => {
    // Query 'apple': m1 is the sole lexical hit AND the top semantic hit
    // (aligned vector); m2 is semantic-only (near); m3 is orthogonal (dropped).
    // RRF: m1 = 1/61 + 1/61 (both legs) beats m2 = 1/62 (semantic only).
    await saveMessages('#fruit', [
      msg('m1', 'apple crumble recipe'),
      msg('m2', 'banana bread rising'),
      msg('m3', 'sour cherry compote'),
    ]);
    const hits = await searchVaultHybrid('apple', { provider: keywordProvider });
    expect(hits.map((h) => h.message.id)).toEqual(['m1', 'm2']);
  });

  it('surfaces a semantic neighbor that shares no substring with the query', async () => {
    // 'banana' has no lexical overlap with query 'apple', but its near-aligned
    // vector clears minScore, so the semantic leg still surfaces it.
    await saveMessages('#fruit', [
      msg('m1', 'banana bread rising'),
      msg('m2', 'sour cherry compote'),
    ]);
    const hits = await searchVaultHybrid('apple', { provider: keywordProvider });
    const ids = hits.map((h) => h.message.id);
    expect(ids).toContain('m1');
    expect(ids).not.toContain('m2'); // orthogonal → cosine 0 → below minScore
  });

  it('boosts same-room hits when activeTarget is set (rankingBoost affinity)', async () => {
    // Two lexical hits with the same body across rooms; active room affinity
    // must lift the in-room hit after RRF via rankingBoost.sameRoom.
    await saveMessages('#here', [msg('local', 'deploy window tonight')]);
    await saveMessages('#elsewhere', [
      msg('remote', 'deploy window tonight', { target: '#elsewhere' }),
    ]);
    const hits = await searchVaultHybrid('deploy window', { activeTarget: '#here' });
    expect(hits[0]!.target).toBe('#here');
    expect(hits[0]!.message.id).toBe('local');
  });

  it('applies selfNick penalty so peer authors can outrank self on ties', async () => {
    await saveMessages('#ops', [
      msg('self', 'outage timeline update', { from: 'me' }),
      msg('peer', 'outage timeline update', { from: 'alice' }),
    ]);
    const hits = await searchVaultHybrid('outage timeline', { selfNick: 'me' });
    expect(hits[0]!.message.from).toBe('alice');
  });

  it('recency-boosts a newer lexical twin above an older one via message.time', async () => {
    // Identical bodies so RRF lexical+semantic contributions match; only
    // VaultSearchHit.message.time differs. Post-RRF rankingBoost recency must
    // prefer the recent hit (and must not look for a phantom top-level hit.time).
    const now = Date.now();
    await saveMessages('#ops', [
      msg('old', 'identical twin deploy phrase', {
        time: new Date(now - 1000 * 60 * 60 * 24 * 40),
      }),
      msg('new', 'identical twin deploy phrase', {
        time: new Date(now - 1000),
      }),
    ]);
    const hits = await searchVaultHybrid('identical twin deploy', {
      // Keep exact equal for both; recency is the only post-RRF differentiator.
      boosts: {
        exact: 0,
        sameRoom: 0,
        recencyHalfLifeMs: 1000 * 60 * 60 * 24 * 14,
        selfPenalty: 0,
      },
    });
    expect(hits.map((h) => h.message.id).slice(0, 2)).toEqual(['new', 'old']);
    expect(hits[0]!.message.time.getTime()).toBeGreaterThan(hits[1]!.message.time.getTime());
  });
});

describe('vaultHitAgeMs', () => {
  const now = 1_700_000_100_000;

  it('reads age from hit.message.time (VaultSearchHit shape), not a top-level time', () => {
    const base = hit('m1', 'hello', { time: new Date(now - 5_000) });
    // A mistaken top-level `time` must never drive recency — only message.time.
    const poisoned = {
      ...base,
      time: new Date(now - 999_999_999),
    } as VaultSearchHit & { time: Date };
    expect(vaultHitAgeMs(poisoned, now)).toBe(5_000);
  });

  it('accepts epoch-ms and ISO strings on message.time for rehydrate edges', () => {
    const asNumber = hit('n', 'x', { time: (now - 2_000) as unknown as Date });
    // Force a raw number through the ChatMessage.time slot (vault edge).
    (asNumber.message as unknown as { time: number }).time = now - 2_000;
    expect(vaultHitAgeMs(asNumber, now)).toBe(2_000);

    const asIso = hit('i', 'x');
    (asIso.message as unknown as { time: string }).time = new Date(now - 3_000).toISOString();
    expect(vaultHitAgeMs(asIso, now)).toBe(3_000);
  });

  it('returns undefined for missing/invalid message.time so recency is skipped', () => {
    const broken = hit('b', 'x');
    (broken.message as { time: unknown }).time = undefined;
    expect(vaultHitAgeMs(broken, now)).toBeUndefined();

    const invalid = hit('z', 'x');
    (invalid.message as { time: Date }).time = new Date(Number.NaN);
    expect(vaultHitAgeMs(invalid, now)).toBeUndefined();
  });

  it('feeds rankingBoost so recent hits outscore older ones at equal base score', () => {
    const recentAge = vaultHitAgeMs(hit('a', 'x', { time: new Date(now - 1_000) }), now);
    const oldAge = vaultHitAgeMs(
      hit('b', 'x', { time: new Date(now - 1000 * 60 * 60 * 24 * 40) }),
      now,
    );
    expect(recentAge).toBe(1_000);
    expect(oldAge).toBe(1000 * 60 * 60 * 24 * 40);
    expect(boostedScore({ id: 'a', score: 0.5, ageMs: recentAge })).toBeGreaterThan(
      boostedScore({ id: 'b', score: 0.5, ageMs: oldAge }),
    );
  });
});
