/**
 * searchVaultSemantic.test.ts — the vault-RAG search path over a real
 * (fake-indexeddb) vault, plus its degenerate cases.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { _resetVaultForTests, saveMessages } from './historyVault';
import { searchVaultSemantic } from './searchVaultSemantic';
import { embed, type EmbeddingProvider } from './embeddingIndex';

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

describe('searchVaultSemantic', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
  });

  it('returns [] for an empty or whitespace query', async () => {
    await saveMessages('#room', [msg('m1', 'deploy the production server tonight')]);
    expect(await searchVaultSemantic('')).toEqual([]);
    expect(await searchVaultSemantic('   ')).toEqual([]);
  });

  it('returns [] when the vault is empty', async () => {
    expect(await searchVaultSemantic('anything')).toEqual([]);
  });

  it('ranks the most semantically similar remembered message first', async () => {
    await saveMessages('#ops', [
      msg('m1', 'the database migration failed with a fatal error'),
      msg('m2', 'lunch plans for saturday afternoon'),
      msg('m3', 'reminder about the standup meeting'),
    ]);

    const hits = await searchVaultSemantic('database migration error');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.message.id).toBe('m1');
    expect(hits[0]!.target).toBe('#ops');
  });

  it('spans multiple conversations on the device', async () => {
    await saveMessages('#ops', [msg('a1', 'kubernetes deployment rollout stuck')]);
    await saveMessages('alice', [msg('b1', 'the deployment pipeline is green now')]);
    await saveMessages('#random', [msg('c1', 'cat pictures thread continues')]);

    const hits = await searchVaultSemantic('deployment');
    const targets = hits.map((h) => h.target);
    expect(targets).toContain('#ops');
    expect(targets).toContain('alice');
    // The unrelated room should not out-rank the deployment matches.
    expect(hits[0]!.target).not.toBe('#random');
  });

  it('honors the limit option', async () => {
    await saveMessages('#big', [
      msg('m1', 'error one happened here'),
      msg('m2', 'error two happened here'),
      msg('m3', 'error three happened here'),
      msg('m4', 'error four happened here'),
    ]);
    const hits = await searchVaultSemantic('error happened', { limit: 2 });
    expect(hits).toHaveLength(2);
  });

  it('excludes deleted and redacted rows', async () => {
    await saveMessages('#ops', [
      msg('keep', 'server restart completed cleanly'),
      msg('gone', 'server restart completed cleanly', { deleted: true }),
      msg('hidden', 'server restart completed cleanly', { redacted: true }),
    ]);
    const hits = await searchVaultSemantic('server restart');
    const ids = hits.map((h) => h.message.id);
    expect(ids).toContain('keep');
    expect(ids).not.toContain('gone');
    expect(ids).not.toContain('hidden');
  });

  it('filters out zero-similarity hits by default', async () => {
    await saveMessages('#ops', [
      msg('match', 'incident postmortem scheduled'),
      msg('nomatch', 'zzzz qqqq wwww vvvv'),
    ]);
    const hits = await searchVaultSemantic('incident postmortem');
    expect(hits.map((h) => h.message.id)).toEqual(['match']);
  });

  it('uses an injected provider instead of the default', async () => {
    await saveMessages('#ops', [
      msg('first', 'alpha content'),
      msg('second', 'beta content'),
    ]);

    let calls = 0;
    // A provider that scores 'beta' text highest via a hand-crafted vector.
    const provider: EmbeddingProvider = {
      dim: 3,
      embed(text: string): Float32Array {
        calls += 1;
        if (text.includes('beta')) return new Float32Array([0, 1, 0]);
        if (text.includes('alpha')) return new Float32Array([1, 0, 0]);
        return new Float32Array([0, 1, 0]); // query aligns with 'beta'
      },
    };

    const hits = await searchVaultSemantic('find the beta one', { provider });
    expect(calls).toBeGreaterThan(0);
    expect(hits[0]!.message.id).toBe('second');
  });

  it('supports an async provider (Promise-returning embed)', async () => {
    await saveMessages('#ops', [msg('m1', 'async embedding path')]);
    const provider: EmbeddingProvider = {
      dim: embed('x').length,
      embed: (text: string) => Promise.resolve(embed(text)),
    };
    const hits = await searchVaultSemantic('async embedding', { provider });
    expect(hits[0]!.message.id).toBe('m1');
  });
});
