// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  MAX_NICK_ALIASES,
  NICK_ALIASES_STORAGE_KEY,
  loadNickAliases,
  saveNickAliases,
} from './nickAliases';

const alice = { serverUrl: 'wss://aliases.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://aliases.example/ws', identity: 'bob' } as const;

describe('account-scoped nick aliases', () => {
  beforeEach(() => localStorage.clear());

  it('fails closed without an owner and purges unsafe ownerless aliases', () => {
    localStorage.setItem(NICK_ALIASES_STORAGE_KEY, JSON.stringify(['AliceSecretAlias']));

    expect(loadNickAliases()).toEqual([]);
    expect(saveNickAliases(['Ownerless'])).toBeNull();
    expect(localStorage.getItem(NICK_ALIASES_STORAGE_KEY)).toBeNull();
  });

  it('isolates Alice and Bob on the same server', () => {
    expect(saveNickAliases(['AliceAway'], alice)).toEqual(['AliceAway']);
    expect(saveNickAliases(['BobAway'], bob)).toEqual(['BobAway']);

    expect(loadNickAliases(alice)).toEqual(['AliceAway']);
    expect(loadNickAliases(bob)).toEqual(['BobAway']);
    expect(deviceMemoryStorageKey(NICK_ALIASES_STORAGE_KEY, alice))
      .not.toBe(deviceMemoryStorageKey(NICK_ALIASES_STORAGE_KEY, bob));
  });

  it('validates, bounds, deduplicates, and excludes the canonical identity', () => {
    const many: unknown[] = [
      ' Alice ',
      'AliceAway',
      'aliceaway',
      'bad nick',
      'bad\r\nNICK injected',
      '',
      ...Array.from({ length: MAX_NICK_ALIASES + 4 }, (_, index) => `Fallback${index}`),
    ];

    const saved = saveNickAliases(many, alice);
    expect(saved).toHaveLength(MAX_NICK_ALIASES);
    expect(saved?.slice(0, 3)).toEqual(['AliceAway', 'Fallback0', 'Fallback1']);
    expect(saved).not.toContain('Alice');
  });

  it('drops malformed and oversized journals on load', () => {
    const key = deviceMemoryStorageKey(NICK_ALIASES_STORAGE_KEY, alice)!;
    localStorage.setItem(key, JSON.stringify({ alias: 'not-an-array' }));
    expect(loadNickAliases(alice)).toEqual([]);

    localStorage.setItem(key, JSON.stringify(['x'.repeat(65), 'bad nick', 'GoodNick']));
    expect(loadNickAliases(alice)).toEqual(['GoodNick']);
  });
});
