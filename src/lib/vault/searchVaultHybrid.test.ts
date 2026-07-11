// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * searchVaultHybrid.test.ts — hybrid lexical+semantic ranking over a real
 * (fake-indexeddb) vault. Pins the invariant that exact-substring matches
 * always rank ahead of purely-semantic neighbors, with stable ordering.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { _resetVaultForTests, saveMessages } from './historyVault';
import { searchVaultHybrid } from './searchVaultHybrid';

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

  it('orders multiple lexical hits newest-first', async () => {
    await saveMessages('#ops', [
      msg('m1', 'deploy step one'),
      msg('m2', 'deploy step two'),
      msg('m3', 'deploy step three'),
    ]);
    const hits = await searchVaultHybrid('deploy');
    // m3 has the largest time (id digits drive the timestamp offset).
    expect(hits.map((h) => h.message.id)).toEqual(['m3', 'm2', 'm1']);
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
});
