// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CHANNEL_NAVIGATION_STORAGE_KEY,
  emptyChannelNavigationMemory,
  LEGACY_CHANNEL_NAVIGATION_KEYS,
  loadChannelNavigationMemory,
  MAX_CHANNEL_NAVIGATION_STORAGE_CHARS,
  MAX_NAVIGATION_CHANNELS,
  saveChannelNavigationMemory,
} from './channelNavigationMemory';

const alice = { serverUrl: 'wss://navigation.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://navigation.example/ws', identity: 'bob' } as const;

describe('account-scoped channel navigation memory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('isolates owners and purges every unsafe ownerless room cache', () => {
    localStorage.setItem(CHANNEL_NAVIGATION_STORAGE_KEY, '{}');
    for (const key of LEGACY_CHANNEL_NAVIGATION_KEYS) localStorage.setItem(key, '["#legacy"]');

    expect(saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set(['#alice']),
    }, alice)).toBe(true);
    expect(saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set(['#bob']),
    }, bob)).toBe(true);

    expect(loadChannelNavigationMemory(alice).pinnedChannels).toEqual(new Set(['#alice']));
    expect(loadChannelNavigationMemory(bob).pinnedChannels).toEqual(new Set(['#bob']));
    expect(localStorage.getItem(CHANNEL_NAVIGATION_STORAGE_KEY)).toBeNull();
    for (const key of LEGACY_CHANNEL_NAVIGATION_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('normalizes, deduplicates, and bounds every channel-bearing collection', () => {
    const many = Array.from({ length: MAX_NAVIGATION_CHANNELS + 20 }, (_, index) => `#Room-${index}`);
    expect(saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set([' #Private ', '#private', 'bad room', ...many]),
      followedChannels: new Set(['#Followed', 'bad\nroom']),
      starredChannels: new Set(['#Starred']),
      channelFolders: [{
        id: 'private',
        name: ' Private ',
        channels: ['#Folder', '#folder', 'bad room'],
        collapsed: true,
      }],
      channelOrder: ['#Second', '#FIRST', '#second'],
      nsfwChannels: new Set(['#Sensitive']),
      forumChannels: new Set(['#Forum']),
    }, alice)).toBe(true);

    const loaded = loadChannelNavigationMemory(alice);
    expect(loaded.pinnedChannels.size).toBe(MAX_NAVIGATION_CHANNELS);
    expect(loaded.pinnedChannels.has('#private')).toBe(true);
    expect(loaded.followedChannels).toEqual(new Set(['#followed']));
    expect(loaded.starredChannels).toEqual(new Set(['#starred']));
    expect(loaded.channelFolders).toEqual([{ id: 'private', name: 'Private', channels: ['#folder'], collapsed: true }]);
    expect(loaded.channelOrder).toEqual(['#second', '#first']);
    expect(loaded.nsfwChannels).toEqual(new Set(['#sensitive']));
    expect(loaded.forumChannels).toEqual(new Set(['#forum']));
  });

  it('uses one owner namespace for the complete canonical record', () => {
    expect(saveChannelNavigationMemory(emptyChannelNavigationMemory(), alice)).toBe(true);
    const key = deviceMemoryStorageKey(CHANNEL_NAVIGATION_STORAGE_KEY, alice)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({
      pinnedChannels: [],
      followedChannels: [],
      starredChannels: [],
      channelOrder: [],
      nsfwChannels: [],
      forumChannels: [],
    });
  });

  it('rejects oversized owner storage before parsing', () => {
    const key = deviceMemoryStorageKey(CHANNEL_NAVIGATION_STORAGE_KEY, alice)!;
    localStorage.setItem(key, `{${'x'.repeat(MAX_CHANNEL_NAVIGATION_STORAGE_CHARS)}}`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadChannelNavigationMemory(alice)).toEqual(emptyChannelNavigationMemory());
    expect(parse).not.toHaveBeenCalled();
  });
});
