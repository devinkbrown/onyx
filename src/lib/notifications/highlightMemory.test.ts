// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  HIGHLIGHT_WORDS_STORAGE_KEY,
  loadHighlightWords,
  MAX_HIGHLIGHT_WORDS_STORAGE_CHARS,
  saveHighlightWords,
} from './highlightMemory';

const alice = { serverUrl: 'wss://highlight.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://highlight.example/ws', identity: 'bob' } as const;

describe('account-scoped custom highlight terms', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('isolates Alice and Bob while purging ownerless private terms', () => {
    localStorage.setItem(HIGHLIGHT_WORDS_STORAGE_KEY, JSON.stringify(['legacy confidential']));
    expect(saveHighlightWords(['Alice Codename'], alice)).toBe(true);
    expect(saveHighlightWords(['Bob Incident'], bob)).toBe(true);

    expect(loadHighlightWords(alice)).toEqual(['alice codename']);
    expect(loadHighlightWords(bob)).toEqual(['bob incident']);
    expect(localStorage.getItem(HIGHLIGHT_WORDS_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, deduplicates, and rejects malformed terms at storage', () => {
    expect(saveHighlightWords(['  Urgent ', 'urgent', '', 'bad\u0000term'], alice)).toBe(true);
    const key = deviceMemoryStorageKey(HIGHLIGHT_WORDS_STORAGE_KEY, alice)!;

    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['urgent']);
    expect(loadHighlightWords(alice)).toEqual(['urgent']);
  });

  it('rejects oversized owner storage before parsing', () => {
    const key = deviceMemoryStorageKey(HIGHLIGHT_WORDS_STORAGE_KEY, alice)!;
    localStorage.setItem(key, `[${'x'.repeat(MAX_HIGHLIGHT_WORDS_STORAGE_CHARS)}]`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadHighlightWords(alice)).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
});
