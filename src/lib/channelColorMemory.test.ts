// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CHANNEL_COLORS_STORAGE_KEY,
  loadChannelColors,
  MAX_CHANNEL_COLOR_ENTRIES,
  parseChannelColors,
  saveChannelColors,
} from './channelColorMemory';

const alice = { serverUrl: 'wss://colors.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://colors.example/ws', identity: 'bob' } as const;

describe('account-scoped channel colors', () => {
  beforeEach(() => localStorage.clear());

  it('isolates owners and purges the ambiguous ownerless room map', () => {
    localStorage.setItem(CHANNEL_COLORS_STORAGE_KEY, JSON.stringify({ '#legacy-private': '#123456' }));

    expect(saveChannelColors(new Map([['#Alice-Private', '#AABBCC']]), alice))
      .toEqual(new Map([['#alice-private', '#aabbcc']]));
    expect(saveChannelColors(new Map([['#Bob-Private', '#1234']]), bob))
      .toEqual(new Map([['#bob-private', '#1234']]));

    expect(loadChannelColors(alice)).toEqual(new Map([['#alice-private', '#aabbcc']]));
    expect(loadChannelColors(bob)).toEqual(new Map([['#bob-private', '#1234']]));
    expect(localStorage.getItem(CHANNEL_COLORS_STORAGE_KEY)).toBeNull();
  });

  it('bounds canonical room keys and rejects unsupported CSS values', () => {
    const parsed = parseChannelColors({
      ' #Private ': '#AABBCC',
      '&LOCAL': '#1234',
      '#unsafe': 'red; background: url(https://example.test)',
      '#function': 'oklch(70% 0.2 30)',
      '#bad room': '#123456',
      '#bad\u0000room': '#123456',
      ...Object.fromEntries(
        Array.from({ length: MAX_CHANNEL_COLOR_ENTRIES + 20 }, (_, index) => [`#room-${index}`, '#112233']),
      ),
    });

    expect(parsed.size).toBe(MAX_CHANNEL_COLOR_ENTRIES);
    expect(parsed.get('#private')).toBe('#aabbcc');
    expect(parsed.get('&local')).toBe('#1234');
    expect(parsed.has('#unsafe')).toBe(false);
    expect(parsed.has('#function')).toBe(false);
    expect(parsed.has('#bad room')).toBe(false);
  });

  it('fails closed without an owner and for malformed or oversized storage', () => {
    expect(saveChannelColors(new Map([['#ownerless', '#123456']]))).toBeNull();
    expect(loadChannelColors()).toEqual(new Map());
    expect(localStorage.length).toBe(0);

    const key = deviceMemoryStorageKey(CHANNEL_COLORS_STORAGE_KEY, alice)!;
    localStorage.setItem(key, '{bad-json');
    expect(loadChannelColors(alice)).toEqual(new Map());

    localStorage.setItem(key, 'x'.repeat(128 * 1024 + 1));
    expect(loadChannelColors(alice)).toEqual(new Map());

    localStorage.setItem(key, JSON.stringify({ '#private': 'javascript:alert(1)' }));
    expect(loadChannelColors(alice)).toEqual(new Map());
  });
});
