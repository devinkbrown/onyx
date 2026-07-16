// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import {
  MAX_VAULT_MESSAGE_ID_LENGTH,
  MAX_VAULT_MESSAGE_TEXT_LENGTH,
  MAX_VAULT_SENDER_LENGTH,
  MAX_VAULT_TARGET_LENGTH,
} from '@/lib/vault/historyVault';
import {
  MAX_LIVE_DM_CONVERSATIONS,
  MAX_TEGAMI_CONVERSATIONS,
  MAX_TEGAMI_COUNT,
  store,
} from './store';

const initialState = store.getInitialState();

function channel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  store.setState({
    ...initialState,
    client: {
      isupport: { CHANTYPES: '#&' },
      negotiatedCaps: new Set<string>(),
      capValues: new Map<string, string>(),
      prefixToMode: {},
      sendRaw: () => true,
      send: () => true,
    } as never,
    ourNick: 'me',
    connectionStatus: 'connected',
    channels: new Map([['#root', channel('#root')]]),
  }, true);
});

describe('live inbound message bounds', () => {
  it('stores at most one vault-sized message body without splitting a surrogate pair', () => {
    const text = `${'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH - 1)}😀tail`;
    feed(`:alice!u@host PRIVMSG #root :${text}`);

    const stored = store.getState().channels.get('#root')?.messages[0];
    expect(stored?.text).toBe('x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH - 1));
    expect(stored?.text).toHaveLength(MAX_VAULT_MESSAGE_TEXT_LENGTH - 1);
  });

  it('drops a sender or target that cannot be represented safely', () => {
    feed(`:${'a'.repeat(MAX_VAULT_SENDER_LENGTH + 1)}!u@host PRIVMSG me :oversized sender`);
    feed(`:me!u@host PRIVMSG ${'b'.repeat(MAX_VAULT_TARGET_LENGTH + 1)} :oversized target`);

    expect(store.getState().dms.size).toBe(0);
    expect(store.getState().channels.get('#root')?.messages).toEqual([]);
  });

  it('replaces an oversized server message id instead of retaining it', () => {
    feed(`@msgid=${'m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :alice!u@host PRIVMSG #root :safe`);

    const stored = store.getState().channels.get('#root')?.messages[0];
    expect(stored?.text).toBe('safe');
    expect(stored?.id).toBeTruthy();
    expect(stored?.id).not.toContain('m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1));
    expect(stored?.id.length).toBeLessThanOrEqual(MAX_VAULT_MESSAGE_ID_LENGTH);
  });

  it('ignores an oversized reply id instead of retaining it in message state', () => {
    feed(`@draft/reply=${'r'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :alice!u@host PRIVMSG #root :safe reply text`);

    const stored = store.getState().channels.get('#root')?.messages[0];
    expect(stored?.text).toBe('safe reply text');
    expect(stored?.replyTo).toBeUndefined();
  });

  it('applies vault field bounds to offline TEGAMI delivery', () => {
    feed(`@msgid=${'m'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1)} :eshmaki.me NOTE TEGAMI :from alice :${'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH + 8)}`);

    const stored = store.getState().dms.get('alice')?.messages[0];
    expect(stored?.text).toHaveLength(MAX_VAULT_MESSAGE_TEXT_LENGTH);
    expect(stored?.id).toBeTruthy();
    expect(stored?.id.length).toBeLessThanOrEqual(MAX_VAULT_MESSAGE_ID_LENGTH);
    expect(store.getState().tegami.get('alice')).toEqual({ count: 1, firstMsgId: stored?.id });

    feed(`:eshmaki.me NOTE TEGAMI :from ${'a'.repeat(MAX_VAULT_SENDER_LENGTH + 1)} :rejected`);
    expect(store.getState().dms.size).toBe(1);
    expect(store.getState().tegami.size).toBe(1);
  });

  it('caps offline aggregates and repairs an oversized legacy aggregate map', () => {
    feed(':eshmaki.me NOTE TEGAMI :from alice :first');
    store.setState({
      tegami: new Map([
        ...Array.from(
          { length: MAX_TEGAMI_CONVERSATIONS + 8 },
          (_, index) => [`legacy-${index}`, { count: 1, firstMsgId: `old-${index}` }] as const,
        ),
        ['alice', { count: MAX_TEGAMI_COUNT, firstMsgId: 'first' }],
      ]),
    });

    feed(':eshmaki.me NOTE TEGAMI :from alice :again');
    expect(store.getState().tegami.size).toBe(MAX_TEGAMI_CONVERSATIONS);
    expect(store.getState().tegami.get('alice')?.count).toBe(MAX_TEGAMI_COUNT);
  });

  it('bounds unsolicited DM conversations without evicting unread rows', () => {
    for (let index = 0; index < MAX_LIVE_DM_CONVERSATIONS + 1; index += 1) {
      feed(`:user-${index}!u@host PRIVMSG me :message ${index}`);
    }

    expect(store.getState().dms.size).toBe(MAX_LIVE_DM_CONVERSATIONS);
    expect(store.getState().dms.has(`user-${MAX_LIVE_DM_CONVERSATIONS}`)).toBe(false);

    const dms = new Map(store.getState().dms);
    const oldest = dms.get('user-0');
    expect(oldest).toBeDefined();
    dms.set('user-0', { ...oldest!, unread: 0, highlights: 0 });
    store.setState({ dms });

    feed(`:user-${MAX_LIVE_DM_CONVERSATIONS}!u@host PRIVMSG me :retry`);
    expect(store.getState().dms.size).toBe(MAX_LIVE_DM_CONVERSATIONS);
    expect(store.getState().dms.has('user-0')).toBe(false);
    expect(store.getState().dms.has(`user-${MAX_LIVE_DM_CONVERSATIONS}`)).toBe(true);
    expect(store.getState().firstUnreadId.has('user-0')).toBe(false);
  });
});
