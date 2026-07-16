// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  AUTO_JOIN_STORAGE_KEY,
  loadAutoJoinChannels,
  MAX_AUTO_JOIN_CHANNELS,
  parseAutoJoinChannels,
  saveAutoJoinChannels,
} from './autoJoinMemory';

const alice = { serverUrl: 'wss://autojoin.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://autojoin.example/ws', identity: 'bob' } as const;

describe('account-scoped auto-join memory', () => {
  beforeEach(() => localStorage.clear());

  it('isolates owners and purges the ambiguous ownerless room list', () => {
    localStorage.setItem(AUTO_JOIN_STORAGE_KEY, JSON.stringify(['#legacy-private']));

    expect(saveAutoJoinChannels(['#Alice-Private'], alice)).toEqual(['#alice-private']);
    expect(saveAutoJoinChannels(['#Bob-Private'], bob)).toEqual(['#bob-private']);

    expect(loadAutoJoinChannels(alice)).toEqual(['#alice-private']);
    expect(loadAutoJoinChannels(bob)).toEqual(['#bob-private']);
    expect(localStorage.getItem(AUTO_JOIN_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and bounds channel-shaped entries', () => {
    const parsed = parseAutoJoinChannels([
      ' #Private ',
      '#private',
      '&LOCAL',
      'not-a-channel',
      '#bad room',
      '#bad,room',
      '#bad\u0000room',
      ...Array.from({ length: MAX_AUTO_JOIN_CHANNELS + 20 }, (_, index) => `#room-${index}`),
    ]);

    expect(parsed).toHaveLength(MAX_AUTO_JOIN_CHANNELS);
    expect(parsed.slice(0, 2)).toEqual(['#private', '&local']);
    expect(parsed).not.toContain('not-a-channel');
    expect(parsed).not.toContain('#bad room');
  });

  it('fails closed without an owner and for malformed or oversized storage', () => {
    expect(saveAutoJoinChannels(['#ownerless'])).toBeNull();
    expect(loadAutoJoinChannels()).toEqual([]);
    expect(localStorage.length).toBe(0);

    const key = deviceMemoryStorageKey(AUTO_JOIN_STORAGE_KEY, alice)!;
    localStorage.setItem(key, '{bad-json');
    expect(loadAutoJoinChannels(alice)).toEqual([]);

    localStorage.setItem(key, 'x'.repeat(64 * 1024 + 1));
    expect(loadAutoJoinChannels(alice)).toEqual([]);

    localStorage.setItem(key, JSON.stringify({ '#private': true }));
    expect(loadAutoJoinChannels(alice)).toEqual([]);
  });
});
