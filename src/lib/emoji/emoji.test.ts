// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { EMOJI_LIST, searchEmojis } from './emoji';

describe('EMOJI_LIST', () => {
  it('publishes entries with shortcode, unicode emoji, and keywords', () => {
    const entry = EMOJI_LIST.find((emoji) => emoji.shortcode === 'blue_heart');

    expect(entry).toEqual({ emoji: '💙', shortcode: 'blue_heart', keywords: ['love', 'ocean'] });
  });

  it('does not publish duplicate shortcode keys', () => {
    const shortcodes = EMOJI_LIST.map((entry) => entry.shortcode);

    const uniqueShortcodes = new Set(shortcodes);

    expect(uniqueShortcodes.size).toBe(shortcodes.length);
  });
});

describe('searchEmojis', () => {
  it('returns the leading emoji entries for an empty query', () => {
    const query = '';

    const results = searchEmojis(query, 3);

    expect(results.map((entry) => entry.shortcode)).toEqual(['grinning', 'joy', 'blush']);
  });

  it('trims whitespace and strips surrounding colons from shortcode queries', () => {
    const query = '  :rocket:  ';

    const results = searchEmojis(query);

    expect(results.map((entry) => entry.shortcode)).toEqual(['rocket']);
  });

  it('matches shortcode fragments case-insensitively', () => {
    const query = 'HEART';

    const results = searchEmojis(query);

    expect(results.map((entry) => entry.shortcode)).toEqual(['heart_eyes', 'heart', 'blue_heart']);
  });

  it('matches keyword fragments when the shortcode does not match', () => {
    const query = 'attach';

    const results = searchEmojis(query);

    expect(results.map((entry) => entry.shortcode)).toEqual(['paperclip']);
  });

  it('returns an empty array for an unknown shortcode or keyword', () => {
    const query = 'missing_key';

    const results = searchEmojis(query);

    expect(results).toEqual([]);
  });

  it('honors a zero result limit', () => {
    const query = 'smile';

    const results = searchEmojis(query, 0);

    expect(results).toEqual([]);
  });

  it('uses slice behavior for non-finite limits', () => {
    const query = '';

    const nanResults = searchEmojis(query, Number.NaN);
    const infiniteResults = searchEmojis(query, Number.POSITIVE_INFINITY);

    expect(nanResults).toEqual([]);
    expect(infiniteResults).toHaveLength(EMOJI_LIST.length);
  });
});
