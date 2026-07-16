// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  IGNORED_USERS_STORAGE_KEY,
  loadIgnoredUsers,
  saveIgnoredUsers,
} from './ignoredUsers';

const alice = { serverUrl: 'wss://ignore.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://ignore.example/ws', identity: 'bob' } as const;

describe('account-scoped ignored users', () => {
  beforeEach(() => localStorage.clear());

  it('isolates Alice and Bob while purging ownerless contact metadata', () => {
    localStorage.setItem(IGNORED_USERS_STORAGE_KEY, JSON.stringify(['legacy-contact']));
    expect(saveIgnoredUsers(new Set(['Alice Contact']), alice)).toBe(true);
    expect(saveIgnoredUsers(new Set(['Bob Contact']), bob)).toBe(true);

    expect(loadIgnoredUsers(alice)).toEqual(new Set(['alice contact']));
    expect(loadIgnoredUsers(bob)).toEqual(new Set(['bob contact']));
    expect(localStorage.getItem(IGNORED_USERS_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and rejects malformed nicknames at storage', () => {
    expect(saveIgnoredUsers(new Set(['  Trouble ', 'trouble', '', 'bad\u0000nick']), alice)).toBe(true);
    const key = deviceMemoryStorageKey(IGNORED_USERS_STORAGE_KEY, alice)!;

    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['trouble']);
    expect(loadIgnoredUsers(alice)).toEqual(new Set(['trouble']));
  });
});
