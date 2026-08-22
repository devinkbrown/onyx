// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * People-card Block reuses ignoreUser. These tests lock the message/DM
 * contract without rewriting the store kernel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://person-block.test/ws', identity: 'alice' } as const;
const server: Server = {
  id: 'person-block',
  name: 'Block',
  network: 'Block',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

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

describe('people-card block via existing ignore', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({
      ...initialState,
      server,
      ourNick: owner.identity,
      connectionStatus: 'connected',
      client: { sendRaw: vi.fn(() => true), isupport: { CHANTYPES: '#&' }, negotiatedCaps: new Set() } as never,
      channels: new Map([['#quiet', channel('#quiet')]]),
      dms: new Map(),
      ignoredUsers: new Set(),
    }, true);
  });

  it('hides room messages from a blocked nick and restores after unblock', () => {
    store.getState().ignoreUser('bob');
    feed(':bob!u@h PRIVMSG #quiet :you should not see this');
    expect(store.getState().channels.get('#quiet')?.messages ?? []).toEqual([]);

    store.getState().unignoreUser('bob');
    feed(':bob!u@h PRIVMSG #quiet :hello again');
    expect(store.getState().channels.get('#quiet')?.messages.at(-1)?.text).toBe('hello again');
  });

  it('does not show a blocked person\'s DM body', () => {
    store.getState().ignoreUser('bob');
    feed(':bob!u@h PRIVMSG alice :secret pitch');

    const conversation = store.getState().dms.get('bob');
    expect(conversation?.messages.at(-1)?.text).toBe('Message from ignored user');
    expect(conversation?.messages.at(-1)?.text).not.toBe('secret pitch');
    expect(conversation?.unread).toBe(0);
  });

  it('does not implement room Mute or Leave', () => {
    store.getState().ignoreUser('bob');
    expect(store.getState().channels.has('#quiet')).toBe(true);
    expect(store.getState().channelNotify.get('#quiet')).toBeUndefined();
  });
});
