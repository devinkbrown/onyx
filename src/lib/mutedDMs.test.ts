// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  loadMutedDMs,
  MUTED_DMS_STORAGE_KEY,
  saveMutedDMs,
} from './mutedDMs';

const alice = { serverUrl: 'wss://mute.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://mute.example/ws', identity: 'bob' } as const;

describe('account-scoped muted DM contacts', () => {
  beforeEach(() => localStorage.clear());

  it('isolates Alice and Bob while purging ownerless contact metadata', () => {
    localStorage.setItem(MUTED_DMS_STORAGE_KEY, JSON.stringify(['legacy-contact']));
    expect(saveMutedDMs(new Set(['Alice Contact']), alice)).toBe(true);
    expect(saveMutedDMs(new Set(['Bob Contact']), bob)).toBe(true);

    expect(loadMutedDMs(alice)).toEqual(new Set(['alice contact']));
    expect(loadMutedDMs(bob)).toEqual(new Set(['bob contact']));
    expect(localStorage.getItem(MUTED_DMS_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and rejects malformed nicknames at storage', () => {
    expect(saveMutedDMs(new Set(['  Trouble ', 'trouble', '', 'bad\u0000nick']), alice)).toBe(true);
    const key = deviceMemoryStorageKey(MUTED_DMS_STORAGE_KEY, alice)!;

    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['trouble']);
    expect(loadMutedDMs(alice)).toEqual(new Set(['trouble']));
  });
});
