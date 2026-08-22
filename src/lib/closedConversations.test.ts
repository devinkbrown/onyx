// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CLOSED_CONVERSATIONS_STORAGE_KEY,
  loadClosedConversations,
  MAX_CLOSED_CONVERSATIONS_STORAGE_CHARS,
  saveClosedConversations,
} from './closedConversations';

const alice = { serverUrl: 'wss://close.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://close.example/ws', identity: 'bob' } as const;

describe('account-scoped closed conversations', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('isolates Alice and Bob while purging ownerless list-state', () => {
    localStorage.setItem(CLOSED_CONVERSATIONS_STORAGE_KEY, JSON.stringify(['legacy-contact']));
    expect(saveClosedConversations(new Set(['Mira']), alice)).toBe(true);
    expect(saveClosedConversations(new Set(['Nico']), bob)).toBe(true);

    expect(loadClosedConversations(alice)).toEqual(new Set(['mira']));
    expect(loadClosedConversations(bob)).toEqual(new Set(['nico']));
    expect(localStorage.getItem(CLOSED_CONVERSATIONS_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and rejects malformed nicknames', () => {
    expect(saveClosedConversations(new Set(['  Trouble ', 'trouble', '', 'bad\u0000nick']), alice)).toBe(true);
    const key = deviceMemoryStorageKey(CLOSED_CONVERSATIONS_STORAGE_KEY, alice)!;

    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['trouble']);
    expect(loadClosedConversations(alice)).toEqual(new Set(['trouble']));
  });

  it('rejects oversized owner storage before parsing', () => {
    const key = deviceMemoryStorageKey(CLOSED_CONVERSATIONS_STORAGE_KEY, alice)!;
    localStorage.setItem(key, `[${'x'.repeat(MAX_CLOSED_CONVERSATIONS_STORAGE_CHARS)}]`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadClosedConversations(alice)).toEqual(new Set());
    expect(parse).not.toHaveBeenCalled();
  });
});
