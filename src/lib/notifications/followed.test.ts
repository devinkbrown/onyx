// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * followed.test.ts - coverage for followed conversation key normalization and persistence.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
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

const STORAGE_KEY = 'onyx:followed';

describe('followed conversations', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of followed()) {
      unfollow(key);
    }
    localStorage.clear();
  });

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

      expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['#alpha/topic', '#zulu']));
      expect(loadFollowed()).toEqual(new Set(['#alpha/topic', '#zulu']));
    });

    it('returns an empty set for malformed stored JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json');

      expect(loadFollowed()).toEqual(new Set<string>());
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
  });
});
