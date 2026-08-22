// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  HIDDEN_ROOMS_STORAGE_KEY,
  loadHiddenRooms,
  MAX_HIDDEN_ROOMS_STORAGE_CHARS,
  saveHiddenRooms,
} from './hiddenRooms';

const alice = { serverUrl: 'wss://hide.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://hide.example/ws', identity: 'bob' } as const;

describe('account-scoped hidden rooms', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('isolates Alice and Bob while purging ownerless list-state', () => {
    localStorage.setItem(HIDDEN_ROOMS_STORAGE_KEY, JSON.stringify(['#legacy']));
    expect(saveHiddenRooms(new Set(['#Harbor']), alice)).toBe(true);
    expect(saveHiddenRooms(new Set(['#Forge']), bob)).toBe(true);

    expect(loadHiddenRooms(alice)).toEqual(new Set(['#harbor']));
    expect(loadHiddenRooms(bob)).toEqual(new Set(['#forge']));
    expect(localStorage.getItem(HIDDEN_ROOMS_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and rejects malformed room names', () => {
    expect(saveHiddenRooms(new Set(['  #Quiet ', '#quiet', '', 'nohash', 'bad\u0000']), alice)).toBe(true);
    const key = deviceMemoryStorageKey(HIDDEN_ROOMS_STORAGE_KEY, alice)!;

    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['#quiet']);
    expect(loadHiddenRooms(alice)).toEqual(new Set(['#quiet']));
  });

  it('rejects oversized owner storage before parsing', () => {
    const key = deviceMemoryStorageKey(HIDDEN_ROOMS_STORAGE_KEY, alice)!;
    localStorage.setItem(key, `[${'x'.repeat(MAX_HIDDEN_ROOMS_STORAGE_CHARS)}]`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadHiddenRooms(alice)).toEqual(new Set());
    expect(parse).not.toHaveBeenCalled();
  });
});
