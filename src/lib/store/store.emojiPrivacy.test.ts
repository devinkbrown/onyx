// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CUSTOM_EMOJI_STORAGE_KEY,
  DEFAULT_FAVORITE_EMOJIS,
  EMOJI_SKIN_TONE_STORAGE_KEY,
  EMOJI_USAGE_STORAGE_KEY,
  FAVORITE_EMOJI_STORAGE_KEY,
  RECENT_EMOJI_STORAGE_KEY,
  saveCustomEmojis,
  saveEmojiSkinTone,
  saveEmojiUsageCounts,
  saveFavoriteEmojis,
  saveRecentEmojis,
} from '@/lib/emojiMemory';
import {
  _resetAccountReplyStateForTests,
  _resetSessionRestoreForTests,
  store,
  type Server,
} from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://emoji-switch.example/ws';

class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | null = null;

  readyState = FakeWebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = '';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor() {
    FakeWebSocket.latest = this;
  }
}

function server(account: string | null, nick = account ?? 'guest42'): Server {
  return {
    id: 'emoji-switch',
    name: 'Emoji Switch',
    network: 'Emoji Switch',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function owner(identity: string) {
  return { serverUrl, identity } as const;
}

function receive(line: string): void {
  FakeWebSocket.latest?.onmessage?.(new MessageEvent('message', { data: line }));
}

function expectMemory(
  name: string,
  token: string,
  favorite: string,
  count: number,
  skinTone: '' | '🏻' | '🏼' | '🏽' | '🏾' | '🏿',
): void {
  expect(store.getState().customEmoji).toEqual([
    { name, url: `https://cdn.example/${name}.png` },
  ]);
  expect(store.getState().recentEmojis).toEqual([token]);
  expect(store.getState().favoriteEmojis).toEqual([favorite]);
  expect(store.getState().emojiUsageCounts).toEqual({ [token]: count });
  expect(store.getState().emojiSkinTone).toBe(skinTone);
}

function seedMemory(
  identity: string,
  name: string,
  token: string,
  favorite: string,
  count: number,
  skinTone: '' | '🏻' | '🏼' | '🏽' | '🏾' | '🏿',
): void {
  expect(saveCustomEmojis([
    { name, url: `https://cdn.example/${name}.png` },
  ], owner(identity))).not.toBeNull();
  expect(saveRecentEmojis([token], owner(identity))).not.toBeNull();
  expect(saveFavoriteEmojis([favorite], owner(identity))).not.toBeNull();
  expect(saveEmojiUsageCounts({ [token]: count }, owner(identity))).not.toBeNull();
  expect(saveEmojiSkinTone(skinTone, owner(identity))).toBe(skinTone);
}

describe('private emoji-memory ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    _resetAccountReplyStateForTests();
    _resetSessionRestoreForTests();
    FakeWebSocket.latest = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    store.getState().disconnect();
    _resetSessionRestoreForTests();
    vi.unstubAllGlobals();
  });

  it('fails closed without an owner and admits only sanitized owner writes', () => {
    store.setState({
      server: null,
      ourNick: '',
      customEmoji: [],
      recentEmojis: [],
      favoriteEmojis: [...DEFAULT_FAVORITE_EMOJIS],
      emojiUsageCounts: {},
      emojiSkinTone: '',
    });
    store.getState().addCustomEmoji('ownerless', 'https://cdn.example/ownerless.png');
    store.getState().addRecentEmoji('😀');
    store.getState().incrementEmojiUsage('😀');
    store.getState().setFavoriteEmojis(['😀']);
    store.getState().setEmojiSkinTone('🏿');
    expect(store.getState().customEmoji).toEqual([]);
    expect(store.getState().recentEmojis).toEqual([]);
    expect(store.getState().favoriteEmojis).toEqual([...DEFAULT_FAVORITE_EMOJIS]);
    expect(store.getState().emojiUsageCounts).toEqual({});
    expect(store.getState().emojiSkinTone).toBe('');
    expect(localStorage.length).toBe(0);

    const alice = owner('alice');
    store.setState({ server: server('alice'), ourNick: 'alice' });
    store.getState().addCustomEmoji(' Party_Parrot ', 'https://cdn.example/party.png');
    store.getState().addCustomEmoji('script', 'javascript:alert(1)');
    store.getState().addCustomEmoji('creds', 'https://user:pass@cdn.example/private.png');
    store.getState().addCustomEmoji('localhost', 'http://localhost:8080/emoji.png');
    store.getState().addCustomEmoji('private_v4', 'http://192.168.1.20/emoji.png');
    store.getState().addCustomEmoji('private_v6', 'http://[::1]/emoji.png');
    store.getState().addRecentEmoji(' :WAVE: ');
    store.getState().addRecentEmoji('<script>');
    store.getState().incrementEmojiUsage(':WAVE:');
    store.getState().incrementEmojiUsage(':wave:');
    store.getState().incrementEmojiUsage('plain');
    store.getState().setFavoriteEmojis(['❤️', '<img>', '❤️']);
    store.getState().setEmojiSkinTone('<script>');
    store.getState().setEmojiSkinTone('🏽');

    expect(store.getState().customEmoji).toEqual([
      { name: 'party_parrot', url: 'https://cdn.example/party.png' },
    ]);
    expect(store.getState().recentEmojis).toEqual([':wave:']);
    expect(store.getState().favoriteEmojis).toEqual(['❤️']);
    expect(store.getState().emojiUsageCounts).toEqual({ ':wave:': 2 });
    expect(store.getState().emojiSkinTone).toBe('🏽');
    expect(localStorage.getItem(deviceMemoryStorageKey(CUSTOM_EMOJI_STORAGE_KEY, alice)!))
      .toBe('[{"name":"party_parrot","url":"https://cdn.example/party.png"}]');
    expect(localStorage.getItem(deviceMemoryStorageKey(RECENT_EMOJI_STORAGE_KEY, alice)!))
      .toBe('[":wave:"]');
    expect(localStorage.getItem(deviceMemoryStorageKey(FAVORITE_EMOJI_STORAGE_KEY, alice)!))
      .toBe('["❤️"]');
    expect(localStorage.getItem(deviceMemoryStorageKey(EMOJI_USAGE_STORAGE_KEY, alice)!))
      .toBe('{":wave:":2}');
    expect(localStorage.getItem(deviceMemoryStorageKey(EMOJI_SKIN_TONE_STORAGE_KEY, alice)!))
      .toBe('"🏽"');

    store.getState().removeCustomEmoji(' PARTY_PARROT ');
    expect(store.getState().customEmoji).toEqual([]);
    expect(localStorage.getItem(deviceMemoryStorageKey(CUSTOM_EMOJI_STORAGE_KEY, alice)!))
      .toBeNull();
  });

  it('replaces all four fields on every identity lifecycle transition', () => {
    seedMemory('alice', 'alice_only', '😀', '❤️', 1, '🏻');
    seedMemory('bob', 'bob_only', '😎', '🙏', 2, '🏼');
    seedMemory('mika', 'mika_only', '😮', '😂', 3, '🏾');
    seedMemory('carol', 'carol_only', '😢', '👍', 4, '🏿');

    const bobCustomKey = deviceMemoryStorageKey(CUSTOM_EMOJI_STORAGE_KEY, owner('bob'))!;
    localStorage.setItem(bobCustomKey, JSON.stringify([
      { name: 'bob_only', url: 'https://cdn.example/bob_only.png' },
      { name: 'hostile', url: 'javascript:alert(1)' },
      { name: 'credentials', url: 'https://bob:secret@cdn.example/private.png' },
      { name: 'localhost', url: 'http://localhost:8080/emoji.png' },
      { name: 'private_v4', url: 'http://10.0.0.5/emoji.png' },
      { name: 'private_v6', url: 'http://[fd12:3456::1]/emoji.png' },
    ]));
    const bobUsageKey = deviceMemoryStorageKey(EMOJI_USAGE_STORAGE_KEY, owner('bob'))!;
    localStorage.setItem(bobUsageKey, JSON.stringify({ '😎': 2, plain: 99, '😈': -1 }));

    store.getState().connect({ url: serverUrl, nick: 'alice' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':emoji-switch.example 001 alice :Welcome');
    expectMemory('alice_only', '😀', '❤️', 1, '🏻');

    receive(':emoji-switch.example 900 alice alice!u@h bob :You are now logged in as bob');
    expectMemory('bob_only', '😎', '🙏', 2, '🏼');
    expect(store.getState().customEmoji.some(emoji => emoji.name === 'hostile')).toBe(false);
    expect(store.getState().customEmoji.some(emoji => emoji.name === 'credentials')).toBe(false);
    expect(store.getState().emojiUsageCounts).not.toHaveProperty('plain');
    expect(JSON.stringify({
      customEmoji: store.getState().customEmoji,
      recentEmojis: store.getState().recentEmojis,
      favoriteEmojis: store.getState().favoriteEmojis,
      emojiUsageCounts: store.getState().emojiUsageCounts,
      emojiSkinTone: store.getState().emojiSkinTone,
    })).not.toContain('alice_only');

    // The guest namespace after logout is the current nick, not the old account.
    seedMemory('alice', 'alice_guest', '🤩', '🎉', 5, '🏽');
    receive(':emoji-switch.example 901 alice alice!u@h :You are now logged out');
    expectMemory('alice_guest', '🤩', '🎉', 5, '🏽');

    receive(':alice!webchat@example NICK mika');
    expectMemory('mika_only', '😮', '😂', 3, '🏾');

    receive(':mika!webchat@example ACCOUNT carol');
    expectMemory('carol_only', '😢', '👍', 4, '🏿');

    store.getState().logout();
    receive(':emoji-switch.example NOTICE mika :You are now logged out.');
    expectMemory('mika_only', '😮', '😂', 3, '🏾');

    store.getState().disconnect();
    expect(store.getState().customEmoji).toEqual([]);
    expect(store.getState().recentEmojis).toEqual([]);
    expect(store.getState().favoriteEmojis).toEqual([...DEFAULT_FAVORITE_EMOJIS]);
    expect(store.getState().emojiUsageCounts).toEqual({});
    expect(store.getState().emojiSkinTone).toBe('');
  });
});
