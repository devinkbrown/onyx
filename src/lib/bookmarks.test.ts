// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import type { ChatMessage } from '@/lib/irc/types';
import {
  BOOKMARKS_STORAGE_KEY,
  MAX_BOOKMARKS,
  clearDeviceBookmarks,
  loadBookmarks,
  saveBookmarks,
} from './bookmarks';

const alice = { serverUrl: 'wss://bookmarks.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://bookmarks.example/ws', identity: 'bob' } as const;

function bookmark(id: string, text = `${id} text`): ChatMessage {
  return {
    id,
    time: new Date('2026-07-16T12:00:00.000Z'),
    from: 'trev',
    text,
    type: 'msg',
    target: '#private',
  };
}

describe('account-scoped bookmarks', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('fails closed without an owner and purges unsafe ownerless plaintext', () => {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify([bookmark('legacy', 'legacy private text')]));

    expect(loadBookmarks()).toEqual([]);
    expect(saveBookmarks([bookmark('ownerless')])).toBeNull();
    expect(localStorage.getItem(BOOKMARKS_STORAGE_KEY)).toBeNull();
  });

  it('isolates owners and strips decrypted bodies and reply previews', () => {
    const encrypted = {
      ...bookmark('alice', 'TSUMUGI1 alice-ciphertext'),
      encrypted: true,
      plaintext: 'Alice decrypted plaintext',
      replyTo: { id: 'reply', from: 'trev', text: 'decrypted reply preview' },
    };
    expect(saveBookmarks([encrypted], alice)?.map((message) => message.id)).toEqual(['alice']);
    expect(saveBookmarks([bookmark('bob', 'Bob private text')], bob)?.map((message) => message.id)).toEqual(['bob']);

    const raw = localStorage.getItem(deviceMemoryStorageKey(BOOKMARKS_STORAGE_KEY, alice)!) ?? '';
    expect(raw).toContain('alice-ciphertext');
    expect(raw).not.toContain('Alice decrypted plaintext');
    expect(raw).not.toContain('decrypted reply preview');
    expect(loadBookmarks(alice)[0]).not.toHaveProperty('plaintext');
    expect(loadBookmarks(bob).map((message) => message.id)).toEqual(['bob']);
  });

  it('fails closed for a legacy envelope whose encrypted flag was omitted', () => {
    const legacy = {
      ...bookmark('legacy-envelope', 'TSUMUGI1 legacy-ciphertext'),
      replyTo: { id: 'reply', from: 'trev', text: 'legacy decrypted preview' },
    };

    expect(saveBookmarks([legacy], alice)).not.toBeNull();
    const raw = localStorage.getItem(deviceMemoryStorageKey(BOOKMARKS_STORAGE_KEY, alice)!) ?? '';
    expect(raw).not.toContain('legacy decrypted preview');
  });

  it('bounds the journal and keeps the newest unique valid messages', () => {
    const many = Array.from({ length: MAX_BOOKMARKS + 5 }, (_, index) => bookmark(`m${index}`));
    many.push(bookmark(`m${MAX_BOOKMARKS + 4}`, 'newest duplicate'));
    many.push({ ...bookmark('invalid'), time: new Date(Number.NaN) });

    const saved = saveBookmarks(many, alice);
    expect(saved).toHaveLength(MAX_BOOKMARKS - 2);
    expect(saved?.[0]?.id).toBe('m7');
    expect(saved?.at(-1)).toMatchObject({ id: `m${MAX_BOOKMARKS + 4}`, text: 'newest duplicate' });
  });

  it('clears every owner scope without touching adjacent keys', () => {
    saveBookmarks([bookmark('alice')], alice);
    saveBookmarks([bookmark('bob')], bob);
    localStorage.setItem(`${BOOKMARKS_STORAGE_KEY}:adjacent`, 'keep');

    expect(clearDeviceBookmarks()).toBe(true);
    expect(loadBookmarks(alice)).toEqual([]);
    expect(loadBookmarks(bob)).toEqual([]);
    expect(localStorage.getItem(`${BOOKMARKS_STORAGE_KEY}:adjacent`)).toBe('keep');
  });

  it('does not claim a clear when one owner journal is retained', () => {
    saveBookmarks([bookmark('alice')], alice);
    const aliceKey = deviceMemoryStorageKey(BOOKMARKS_STORAGE_KEY, alice)!;
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === aliceKey) throw new DOMException('blocked');
      removeItem(key);
    });

    expect(clearDeviceBookmarks()).toBe(false);
    expect(loadBookmarks(alice).map((message) => message.id)).toEqual(['alice']);
  });
});
