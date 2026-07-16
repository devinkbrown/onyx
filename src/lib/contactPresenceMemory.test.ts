// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  FRIENDS_STORAGE_KEY,
  loadFriends,
  loadWatchList,
  parseFriends,
  parseWatchList,
  saveFriends,
  saveWatchList,
  WATCH_LIST_STORAGE_KEY,
} from './contactPresenceMemory';

const alice = { serverUrl: 'wss://contacts.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://contacts.example/ws', identity: 'bob' } as const;

describe('account-scoped MONITOR contacts', () => {
  beforeEach(() => localStorage.clear());

  it('isolates friends and watches while purging ownerless contact metadata', () => {
    localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify([{ nick: 'legacy-friend' }]));
    localStorage.setItem(WATCH_LIST_STORAGE_KEY, JSON.stringify([{ nick: 'legacy-watch' }]));
    expect(saveFriends(new Map([['alice', { nick: 'Alice', online: true, note: 'private' }]]), alice)).toBe(true);
    expect(saveWatchList([{ nick: 'AliceWatch', online: true }], alice)).toBe(true);
    expect(saveFriends(new Map([['bob', { nick: 'Bob', online: true }]]), bob)).toBe(true);
    expect(saveWatchList([{ nick: 'BobWatch', online: true }], bob)).toBe(true);

    expect([...loadFriends(alice).values()]).toEqual([{ nick: 'Alice', online: false, note: 'private' }]);
    expect(loadWatchList(alice)).toEqual([{ nick: 'AliceWatch', online: false }]);
    expect([...loadFriends(bob).keys()]).toEqual(['bob']);
    expect(loadWatchList(bob)).toEqual([{ nick: 'BobWatch', online: false }]);
    expect(localStorage.getItem(FRIENDS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WATCH_LIST_STORAGE_KEY)).toBeNull();
  });

  it('bounds and sanitizes MONITOR nicks and private notes', () => {
    const friends = parseFriends([
      { nick: ' Alice ', online: true, note: 'met in #ops' },
      { nick: 'alice', note: 'duplicate' },
      { nick: 'bad,nick' },
      { nick: 'bad\r\nnick' },
      { nick: 'Bob', note: 'x'.repeat(513) },
    ]);
    const watches = parseWatchList([
      { nick: ' WatchMe ', online: true, lastSeen: new Date() },
      { nick: 'watchme' },
      { nick: 'two nicks' },
    ]);

    expect([...friends.values()]).toEqual([
      { nick: 'Alice', online: false, note: 'met in #ops' },
      { nick: 'Bob', online: false },
    ]);
    expect(watches).toEqual([{ nick: 'WatchMe', online: false }]);
    expect(parseFriends(Array.from({ length: 300 }, (_, index) => ({
      nick: `friend-${index}`,
    }))).size).toBe(256);
    expect(parseWatchList(Array.from({ length: 300 }, (_, index) => ({
      nick: `watch-${index}`,
    })))).toHaveLength(256);
    expect(parseWatchList([{
      nick: 'SeenContact',
      lastSeen: '2026-07-16T12:00:00.000Z',
    }])).toEqual([{
      nick: 'SeenContact',
      online: false,
      lastSeen: new Date('2026-07-16T12:00:00.000Z'),
    }]);
  });

  it('removes empty owner journals and verifies stored canonical shapes', () => {
    expect(saveFriends(new Map([['alice', { nick: 'Alice', online: true }]]), alice)).toBe(true);
    expect(saveWatchList([{ nick: 'Alice', online: true }], alice)).toBe(true);
    const friendsKey = deviceMemoryStorageKey(FRIENDS_STORAGE_KEY, alice)!;
    const watchKey = deviceMemoryStorageKey(WATCH_LIST_STORAGE_KEY, alice)!;
    expect(JSON.parse(localStorage.getItem(friendsKey) ?? '[]')).toEqual([{ nick: 'Alice' }]);
    expect(JSON.parse(localStorage.getItem(watchKey) ?? '[]')).toEqual([{ nick: 'Alice', online: false }]);

    expect(saveFriends(new Map(), alice)).toBe(true);
    expect(saveWatchList([], alice)).toBe(true);
    expect(localStorage.getItem(friendsKey)).toBeNull();
    expect(localStorage.getItem(watchKey)).toBeNull();
  });
});
