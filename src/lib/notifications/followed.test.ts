// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * followed.test.ts - coverage for followed conversation key normalization and persistence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_FOLLOWED_KEYS,
  MAX_FOLLOWED_KEY_LENGTH,
  FOLLOWED_STORAGE_KEY,
  clearFollowed,
  follow,
  followed,
  followKey,
  exportFollowedKeys,
  isFollowed,
  loadFollowed,
  mergeFollowedKeys,
  parseFollowedKeys,
  toggleFollow,
  unfollow,
} from '@/lib/notifications/followed';

describe('followed conversations', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of followed()) {
      unfollow(key);
    }
    localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('followKey', () => {
    it('trims and lowercases targets', () => {
      expect(followKey('  #General  ')).toBe('#general');
      expect(followKey('  @Nick  ')).toBe('@nick');
    });

    it('appends a normalized topic suffix', () => {
      expect(followKey('  #General  ', '  Topic-Label  ')).toBe('#general/topic-label');
    });

    it('ignores empty topic values', () => {
      expect(followKey('#General', '')).toBe('#general');
      expect(followKey('#General', '   ')).toBe('#general');
      expect(followKey('#General', null)).toBe('#general');
    });
  });

  describe('follow and unfollow', () => {
    it('marks followed conversations as followed', () => {
      follow('  #General  ');

      expect(isFollowed('#general')).toBe(true);
      expect(followed().has('#general')).toBe(true);
    });

    it('removes followed conversations', () => {
      follow('@Nick');
      unfollow('  @nick  ');

      expect(isFollowed('@Nick')).toBe(false);
    });

    it('caps and validates direct state mutations', () => {
      for (let i = 0; i < MAX_FOLLOWED_KEYS + 5; i += 1) follow(`#room-${i}`);
      follow(`#${'x'.repeat(MAX_FOLLOWED_KEY_LENGTH + 1)}`);

      expect(followed().size).toBe(MAX_FOLLOWED_KEYS);
      expect(JSON.parse(localStorage.getItem(FOLLOWED_STORAGE_KEY) ?? '[]')).toHaveLength(MAX_FOLLOWED_KEYS);
      expect(toggleFollow('#room-over-cap')).toBe(false);
      expect(isFollowed('#room-over-cap')).toBe(false);
    });
  });

  describe('toggleFollow', () => {
    it('returns the new state while flipping followed membership', () => {
      expect(toggleFollow('#General')).toBe(true);
      expect(isFollowed('#general')).toBe(true);

      expect(toggleFollow('  #general  ')).toBe(false);
      expect(isFollowed('#general')).toBe(false);
    });
  });

  describe('loadFollowed', () => {
    it('roundtrips followed keys through localStorage', () => {
      follow('#Zulu');
      follow('#Alpha', 'Topic');

      expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).toBe(JSON.stringify(['#alpha/topic', '#zulu']));
      expect(loadFollowed()).toEqual(new Set(['#alpha/topic', '#zulu']));
    });

    it('returns an empty set for malformed stored JSON', () => {
      localStorage.setItem(FOLLOWED_STORAGE_KEY, '{not json');

      expect(loadFollowed()).toEqual(new Set<string>());
    });

    it('sanitizes and caps persisted keys while loading', () => {
      localStorage.setItem(FOLLOWED_STORAGE_KEY, JSON.stringify([
        42,
        `#${'x'.repeat(MAX_FOLLOWED_KEY_LENGTH + 1)}`,
        ...Array.from({ length: MAX_FOLLOWED_KEYS + 10 }, (_, i) => ` #Room-${i} `),
      ]));

      const loaded = loadFollowed();
      expect(loaded.size).toBe(MAX_FOLLOWED_KEYS);
      expect([...loaded].every((key) => key === key.toLowerCase() && key.length <= MAX_FOLLOWED_KEY_LENGTH)).toBe(true);
    });
  });

  describe('portable followed keys', () => {
    it('exports sorted followed keys', () => {
      follow('#Zulu');
      follow('#Alpha', 'Topic');

      expect(exportFollowedKeys()).toEqual(['#alpha/topic', '#zulu']);
    });

    it('parses and merges sanitized followed keys', () => {
      expect(parseFollowedKeys(['  #Root/Roadmap  ', '', 7, '#root/roadmap'])).toEqual(['#root/roadmap']);

      const result = mergeFollowedKeys(['#Root/Roadmap', '#Ops']);

      expect(result).toEqual({ imported: 2, total: 2 });
      expect(isFollowed('#root', 'roadmap')).toBe(true);
      expect(isFollowed('#ops')).toBe(true);
    });

    it('caps portable merges at the state boundary', () => {
      for (let i = 0; i < MAX_FOLLOWED_KEYS - 2; i += 1) follow(`#existing-${i}`);

      const result = mergeFollowedKeys(Array.from({ length: 10 }, (_, i) => `#import-${i}`));

      expect(result.total).toBe(MAX_FOLLOWED_KEYS);
      expect(followed().size).toBe(MAX_FOLLOWED_KEYS);
      expect(JSON.parse(localStorage.getItem(FOLLOWED_STORAGE_KEY) ?? '[]')).toHaveLength(MAX_FOLLOWED_KEYS);
    });
  });

  describe('verified clear', () => {
    it('removes the physical key and updates same-tab followed state', () => {
      follow('#Root', 'Roadmap');
      follow('#Ops');

      expect(clearFollowed()).toEqual({ success: true, cleared: 2, remaining: 0 });
      expect(followed().size).toBe(0);
      expect(loadFollowed()).toEqual(new Set());
      expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).toBeNull();
    });

    it('verifies an already-empty physical key', () => {
      expect(clearFollowed()).toEqual({ success: true, cleared: 0, remaining: 0 });
      expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).toBeNull();
    });

    it('retains same-tab state and reports failure when storage removal throws', () => {
      follow('#Retained', 'Private topic');
      const removeItem = localStorage.removeItem.bind(localStorage);
      vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
        if (key === FOLLOWED_STORAGE_KEY) throw new DOMException('blocked');
        removeItem(key);
      });

      expect(clearFollowed()).toEqual({ success: false, cleared: 0, remaining: 1 });
      expect(isFollowed('#retained', 'private topic')).toBe(true);
      expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).not.toBeNull();
    });

    it('does not report success when storage silently retains the key', () => {
      follow('#Retained');
      vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {});

      expect(clearFollowed()).toEqual({ success: false, cleared: 0, remaining: 1 });
      expect(isFollowed('#retained')).toBe(true);
      expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).not.toBeNull();
    });
  });
});
