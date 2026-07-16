// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  loadUserNotes,
  MAX_USER_NOTE_LENGTH,
  MAX_USER_NOTES,
  MAX_USER_NOTES_STORAGE_CHARS,
  saveUserNotes,
  USER_NOTES_STORAGE_KEY,
} from './userNotes';

const alice = { serverUrl: 'wss://notes.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://notes.example/ws', identity: 'bob' } as const;

describe('account-scoped private user notes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('isolates owners and purges unsafe ownerless legacy notes', () => {
    localStorage.setItem(USER_NOTES_STORAGE_KEY, JSON.stringify({ trev: 'legacy private note' }));

    expect(saveUserNotes(new Map([['Trev', ' Alice private note ']]), alice)).toBe(true);
    expect(saveUserNotes(new Map([['Trev', 'Bob private note']]), bob)).toBe(true);

    expect(loadUserNotes(alice)).toEqual(new Map([['trev', 'Alice private note']]));
    expect(loadUserNotes(bob)).toEqual(new Map([['trev', 'Bob private note']]));
    expect(localStorage.getItem(USER_NOTES_STORAGE_KEY)).toBeNull();
  });

  it('sanitizes keys and bounds note count and text at the storage boundary', () => {
    const entries: Array<[string, string]> = Array.from({ length: MAX_USER_NOTES + 20 }, (_, index) => [
      `User${String(index).padStart(3, '0')}`,
      `note ${index}`,
    ]);
    entries.unshift(['bad nick', 'must be rejected']);
    entries.unshift(['control\u0000nick', 'must be rejected']);
    entries.unshift(['oversized', 'x'.repeat(MAX_USER_NOTE_LENGTH + 1)]);

    expect(saveUserNotes(new Map(entries), alice)).toBe(true);

    const notes = loadUserNotes(alice);
    expect(notes.size).toBe(MAX_USER_NOTES);
    expect(notes.has('bad nick')).toBe(false);
    expect(notes.has('control\u0000nick')).toBe(false);
    expect(notes.has('oversized')).toBe(false);
    expect(notes.get('user000')).toBe('note 0');
  });

  it('removes the owner namespace when the canonical map becomes empty', () => {
    const key = deviceMemoryStorageKey(USER_NOTES_STORAGE_KEY, alice)!;
    expect(saveUserNotes(new Map([['trev', 'private']]), alice)).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();

    expect(saveUserNotes(new Map(), alice)).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('rejects oversized owner storage before parsing', () => {
    const key = deviceMemoryStorageKey(USER_NOTES_STORAGE_KEY, alice)!;
    localStorage.setItem(key, `{${'x'.repeat(MAX_USER_NOTES_STORAGE_CHARS)}}`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadUserNotes(alice)).toEqual(new Map());
    expect(parse).not.toHaveBeenCalled();
  });
});
