// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CHANNEL_NOTIFY_STORAGE_KEY,
  loadChannelNotify,
  saveChannelNotify,
} from './channelNotifyMemory';

const alice = { serverUrl: 'wss://notify.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://notify.example/ws', identity: 'bob' } as const;

describe('account-scoped channel notification policy', () => {
  beforeEach(() => localStorage.clear());

  it('isolates private room names and purges the ownerless journal', () => {
    localStorage.setItem(CHANNEL_NOTIFY_STORAGE_KEY, JSON.stringify({ '#legacy-secret': 'none' }));
    expect(saveChannelNotify(new Map([['#alice-secret', 'none']]), alice)).toBe(true);
    expect(saveChannelNotify(new Map([['#bob-secret', 'mentions']]), bob)).toBe(true);

    expect(Object.fromEntries(loadChannelNotify(alice))).toEqual({ '#alice-secret': 'none' });
    expect(Object.fromEntries(loadChannelNotify(bob))).toEqual({ '#bob-secret': 'mentions' });
    expect(localStorage.getItem(CHANNEL_NOTIFY_STORAGE_KEY)).toBeNull();
  });

  it('normalizes and bounds storage while omitting the default level', () => {
    expect(saveChannelNotify(new Map([
      ['#Room', 'mentions'],
      ['#loud', 'all'],
      ['bad room', 'none'],
    ]), alice)).toBe(true);

    const key = deviceMemoryStorageKey(CHANNEL_NOTIFY_STORAGE_KEY, alice)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual({ '#room': 'mentions' });
    expect(Object.fromEntries(loadChannelNotify(alice))).toEqual({ '#room': 'mentions' });
  });
});
