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
import { store } from './store';

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
});
