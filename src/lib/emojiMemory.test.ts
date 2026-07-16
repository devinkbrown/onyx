// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CUSTOM_EMOJI_STORAGE_KEY,
  DEFAULT_FAVORITE_EMOJIS,
  EMOJI_SKIN_TONE_STORAGE_KEY,
  EMOJI_USAGE_STORAGE_KEY,
  FAVORITE_EMOJI_STORAGE_KEY,
  loadEmojiMemory,
  MAX_CUSTOM_EMOJI,
  MAX_EMOJI_USAGE_COUNT,
  MAX_EMOJI_USAGE_ENTRIES,
  MAX_FAVORITE_EMOJIS,
  MAX_RECENT_EMOJIS,
  normalizeCustomEmojis,
  normalizeEmojiSkinTone,
  normalizeEmojiToken,
  normalizeEmojiTokens,
  normalizeEmojiUsageCounts,
  RECENT_EMOJI_STORAGE_KEY,
  saveCustomEmojis,
  saveEmojiSkinTone,
  saveEmojiUsageCounts,
  saveFavoriteEmojis,
  saveRecentEmojis,
} from './emojiMemory';

const endpoint = 'wss://emoji-memory.example/ws';
const alice = { serverUrl: endpoint, identity: 'alice' } as const;
const bob = { serverUrl: endpoint, identity: 'bob' } as const;
const aliceElsewhere = { serverUrl: 'wss://other.example/ws', identity: 'alice' } as const;

function storageKey(baseKey: string, owner = alice): string {
  return deviceMemoryStorageKey(baseKey, owner)!;
}

describe('account-scoped emoji memory', () => {
  beforeEach(() => localStorage.clear());

  it('isolates every key by exact endpoint and account-or-guest owner', () => {
    localStorage.setItem(CUSTOM_EMOJI_STORAGE_KEY, JSON.stringify([
      { name: 'legacy_private', url: 'https://legacy.example/private.png' },
    ]));
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(['😈']));
    localStorage.setItem(FAVORITE_EMOJI_STORAGE_KEY, JSON.stringify(['🤫']));
    localStorage.setItem(EMOJI_USAGE_STORAGE_KEY, JSON.stringify({ '😈': 99 }));
    localStorage.setItem(EMOJI_SKIN_TONE_STORAGE_KEY, '🏿');

    expect(saveCustomEmojis([
      { name: 'alice_only', url: 'https://cdn.example/alice.png' },
    ], alice)).toEqual([
      { name: 'alice_only', url: 'https://cdn.example/alice.png' },
    ]);
    expect(saveRecentEmojis(['😀'], alice)).toEqual(['😀']);
    expect(saveFavoriteEmojis(['❤️'], alice)).toEqual(['❤️']);
    expect(saveEmojiUsageCounts({ '😀': 7 }, alice)).toEqual({ '😀': 7 });
    expect(saveEmojiSkinTone('🏽', alice)).toBe('🏽');

    expect(saveCustomEmojis([
      { name: 'bob_only', url: 'https://cdn.example/bob.png' },
    ], bob)).not.toBeNull();
    expect(saveRecentEmojis(['😎'], bob)).toEqual(['😎']);
    expect(saveFavoriteEmojis(['🙏'], bob)).toEqual(['🙏']);
    expect(saveEmojiUsageCounts({ '😎': 3 }, bob)).toEqual({ '😎': 3 });
    expect(saveEmojiSkinTone('🏻', bob)).toBe('🏻');

    expect(loadEmojiMemory(alice)).toEqual({
      customEmoji: [{ name: 'alice_only', url: 'https://cdn.example/alice.png' }],
      recentEmojis: ['😀'],
      favoriteEmojis: ['❤️'],
      emojiUsageCounts: { '😀': 7 },
      emojiSkinTone: '🏽',
    });
    expect(loadEmojiMemory(bob)).toEqual({
      customEmoji: [{ name: 'bob_only', url: 'https://cdn.example/bob.png' }],
      recentEmojis: ['😎'],
      favoriteEmojis: ['🙏'],
      emojiUsageCounts: { '😎': 3 },
      emojiSkinTone: '🏻',
    });
    expect(loadEmojiMemory(aliceElsewhere)).toEqual({
      customEmoji: [],
      recentEmojis: [],
      favoriteEmojis: [...DEFAULT_FAVORITE_EMOJIS],
      emojiUsageCounts: {},
      emojiSkinTone: '',
    });

    for (const key of [
      CUSTOM_EMOJI_STORAGE_KEY,
      RECENT_EMOJI_STORAGE_KEY,
      FAVORITE_EMOJI_STORAGE_KEY,
      EMOJI_USAGE_STORAGE_KEY,
      EMOJI_SKIN_TONE_STORAGE_KEY,
    ]) expect(localStorage.getItem(key)).toBeNull();
  });

  it('admits only bounded safe names and credential-free HTTP(S) URLs', () => {
    const parsed = normalizeCustomEmojis([
      { name: ' Party_Parrot ', url: 'https://cdn.example/party.png', addedBy: 'Alice' },
      { name: 'party_parrot', url: 'https://cdn.example/duplicate.png' },
      { name: '<img>', url: 'https://cdn.example/name.png' },
      { name: 'script', url: 'javascript:alert(1)' },
      { name: 'inline', url: 'data:image/svg+xml,<svg onload=alert(1)>' },
      { name: 'creds', url: 'https://user:secret@cdn.example/private.png' },
      { name: 'relative', url: '/emoji.png' },
      { name: 'space', url: 'https://cdn.example/bad image.png' },
      { name: 'localhost', url: 'http://localhost:8080/emoji.png' },
      { name: 'private_v4', url: 'http://192.168.1.20/emoji.png' },
      { name: 'metadata', url: 'http://169.254.169.254/latest/meta-data/' },
      { name: 'loopback_v6', url: 'http://[::1]/emoji.png' },
      { name: 'private_v6', url: 'http://[fd12:3456::1]/emoji.png' },
      { name: 'internal_host', url: 'http://emoji.internal/image.png' },
      ...Array.from({ length: MAX_CUSTOM_EMOJI + 10 }, (_, index) => ({
        name: `safe_${index}`,
        url: `http://cdn.example/${index}.png`,
      })),
    ]);

    expect(parsed).toHaveLength(MAX_CUSTOM_EMOJI);
    expect(parsed[0]).toEqual({
      name: 'party_parrot',
      url: 'https://cdn.example/party.png',
      addedBy: 'Alice',
    });
    expect(parsed.some(emoji => emoji.name === 'script')).toBe(false);
    expect(parsed.some(emoji => emoji.name === 'creds')).toBe(false);
    expect(parsed.some(emoji => emoji.name === 'localhost')).toBe(false);
    expect(parsed.some(emoji => emoji.name === 'private_v4')).toBe(false);
    expect(parsed.some(emoji => emoji.name === 'loopback_v6')).toBe(false);
    expect(parsed.some(emoji => emoji.url.startsWith('data:'))).toBe(false);

    localStorage.setItem(storageKey(CUSTOM_EMOJI_STORAGE_KEY), JSON.stringify([
      { name: 'safe', url: 'https://cdn.example/safe.png' },
      { name: 'hostile', url: 'javascript:alert(document.domain)' },
      { name: 'lan_probe', url: 'http://10.0.0.5/emoji.png' },
      { name: 'ipv6_probe', url: 'http://[fe80::1]/emoji.png' },
    ]));
    expect(loadEmojiMemory(alice).customEmoji).toEqual([
      { name: 'safe', url: 'https://cdn.example/safe.png' },
    ]);
  });

  it('bounds emoji tokens and usage counters while dropping hostile record keys', () => {
    expect(normalizeEmojiSkinTone('🏾')).toBe('🏾');
    expect(normalizeEmojiSkinTone('😀')).toBe('');
    expect(normalizeEmojiSkinTone('<script>')).toBe('');
    expect(normalizeEmojiToken(' :Party_Parrot: ')).toBe(':party_parrot:');
    expect(normalizeEmojiToken('❤️')).toBe('❤️');
    expect(normalizeEmojiToken('1️⃣')).toBe('1️⃣');
    expect(normalizeEmojiToken('plain')).toBeNull();
    expect(normalizeEmojiToken('<script>')).toBeNull();
    expect(normalizeEmojiToken('__proto__')).toBeNull();
    expect(normalizeEmojiToken('😀 bad')).toBeNull();
    expect(normalizeEmojiToken(`😀\u0000bad`)).toBeNull();
    expect(normalizeEmojiToken(`:${'a'.repeat(63)}:`)).toBeNull();

    const tokens = normalizeEmojiTokens([
      '😀',
      '😀',
      ':SAFE:',
      '<img>',
      ...Array.from({ length: MAX_FAVORITE_EMOJIS + 10 }, (_, index) => `${index}️⃣`),
    ], MAX_FAVORITE_EMOJIS);
    expect(tokens).toHaveLength(MAX_FAVORITE_EMOJIS);
    expect(tokens.slice(0, 2)).toEqual(['😀', ':safe:']);

    const hostileRecord = JSON.parse(`{
      "😀": 4,
      ":party_parrot:": ${MAX_EMOJI_USAGE_COUNT},
      "plain": 3,
      "😎": 0,
      "😢": -1,
      "😮": 1.5,
      "🙏": ${MAX_EMOJI_USAGE_COUNT + 1},
      "__proto__": 8,
      "constructor": 9
    }`) as unknown;
    expect(normalizeEmojiUsageCounts(hostileRecord)).toEqual({
      '😀': 4,
      ':party_parrot:': MAX_EMOJI_USAGE_COUNT,
    });

    const manyCounts = Object.fromEntries(
      Array.from({ length: MAX_EMOJI_USAGE_ENTRIES + 20 }, (_, index) => [`😀${index}`, 1]),
    );
    expect(Object.keys(normalizeEmojiUsageCounts(manyCounts)))
      .toHaveLength(MAX_EMOJI_USAGE_ENTRIES);
  });

  it('fails closed for ownerless, malformed, oversized, or wrong-shape state', () => {
    expect(saveCustomEmojis([{ name: 'ownerless', url: 'https://cdn.example/a.png' }]))
      .toBeNull();
    expect(saveRecentEmojis(['😀'])).toBeNull();
    expect(saveFavoriteEmojis(['😀'])).toBeNull();
    expect(saveEmojiUsageCounts({ '😀': 1 })).toBeNull();
    expect(saveEmojiSkinTone('🏽')).toBeNull();
    expect(loadEmojiMemory()).toEqual({
      customEmoji: [],
      recentEmojis: [],
      favoriteEmojis: [...DEFAULT_FAVORITE_EMOJIS],
      emojiUsageCounts: {},
      emojiSkinTone: '',
    });
    expect(localStorage.length).toBe(0);

    localStorage.setItem(storageKey(CUSTOM_EMOJI_STORAGE_KEY), '{bad-json');
    localStorage.setItem(storageKey(RECENT_EMOJI_STORAGE_KEY), JSON.stringify({ emoji: '😀' }));
    localStorage.setItem(storageKey(FAVORITE_EMOJI_STORAGE_KEY), 'x'.repeat(256 * 1024 + 1));
    localStorage.setItem(storageKey(EMOJI_USAGE_STORAGE_KEY), JSON.stringify(['😀', 1]));
    localStorage.setItem(storageKey(EMOJI_SKIN_TONE_STORAGE_KEY), JSON.stringify('<script>'));
    expect(loadEmojiMemory(alice)).toEqual({
      customEmoji: [],
      recentEmojis: [],
      favoriteEmojis: [...DEFAULT_FAVORITE_EMOJIS],
      emojiUsageCounts: {},
      emojiSkinTone: '',
    });

    expect(saveFavoriteEmojis([], alice)).toEqual([]);
    expect(loadEmojiMemory(alice).favoriteEmojis).toEqual([]);
    expect(saveEmojiSkinTone('🏿', alice)).toBe('🏿');
    expect(loadEmojiMemory(alice).emojiSkinTone).toBe('🏿');
    expect(saveEmojiSkinTone('', alice)).toBe('');
    expect(localStorage.getItem(storageKey(EMOJI_SKIN_TONE_STORAGE_KEY))).toBeNull();
    expect(normalizeEmojiTokens(Array.from({ length: 30 }, () => '😀'), MAX_RECENT_EMOJIS))
      .toEqual(['😀']);
  });
});
