// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import { store, type DMConversation, type Server } from './store';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://verbs.test/ws', identity: 'alice' } as const;
const server: Server = {
  id: 'verbs-test',
  name: 'Verbs',
  network: 'Verbs',
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

function dm(nick: string): DMConversation {
  return { nick, account: null, unread: 0, highlights: 0, messages: [] };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('room list verbs', () => {
  const sendRaw = vi.fn(() => true);

  beforeEach(() => {
    localStorage.clear();
    sendRaw.mockClear();
    store.setState({
      ...initialState,
      server,
      ourNick: owner.identity,
      connectionStatus: 'connected',
      client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never,
      channels: new Map([['#quiet', channel('#quiet')]]),
      dms: new Map([['bob', dm('bob')]]),
      hiddenRooms: new Set(),
      closedConversations: new Set(),
      channelNotify: new Map(),
      highlightWords: [],
    }, true);
  });

  it('hides a room without PARTing or dropping the joined channel', () => {
    store.getState().hideRoom('#Quiet');

    expect(store.getState().hiddenRooms).toEqual(new Set(['#quiet']));
    expect(store.getState().channels.has('#quiet')).toBe(true);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('leaves a room by PARTing', () => {
    store.getState().partChannel('#quiet');
    expect(sendRaw).toHaveBeenCalledWith('PART', '#quiet', 'Goodbye');
  });

  it('mutes a room without hiding it', () => {
    store.getState().muteChannel('#quiet');

    expect(store.getState().channelNotify.get('#quiet')).toBe('none');
    expect(store.getState().hiddenRooms.size).toBe(0);
    expect(store.getState().channels.has('#quiet')).toBe(true);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('closes a DM without PARTing a channel', () => {
    store.getState().closeConversation('Bob');

    expect(store.getState().closedConversations).toEqual(new Set(['bob']));
    expect(store.getState().dms.has('bob')).toBe(true);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('returns a hidden room to the list on mention', () => {
    store.getState().hideRoom('#quiet');
    feed(':bob!u@h PRIVMSG #quiet :hey alice, look here');

    expect(store.getState().hiddenRooms.has('#quiet')).toBe(false);
    expect(store.getState().channels.has('#quiet')).toBe(true);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('keeps a hidden room hidden on ordinary chatter', () => {
    store.getState().hideRoom('#quiet');
    feed(':bob!u@h PRIVMSG #quiet :no one is named');

    expect(store.getState().hiddenRooms.has('#quiet')).toBe(true);
  });

  it('returns a hidden room to the list on an @everyone ping', () => {
    store.getState().hideRoom('#quiet');
    feed(':bob!u@h PRIVMSG #quiet :@everyone boats');

    expect(store.getState().hiddenRooms.has('#quiet')).toBe(false);
  });

  it('returns a closed conversation on inbound DM without PARTing', () => {
    store.getState().closeConversation('bob');
    feed(':bob!u@h PRIVMSG alice :still here');

    expect(store.getState().closedConversations.has('bob')).toBe(false);
    expect(store.getState().dms.has('bob')).toBe(true);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('fails closed without a server identity', () => {
    store.setState({ server: null, hiddenRooms: new Set(), closedConversations: new Set() });
    store.getState().hideRoom('#quiet');
    store.getState().closeConversation('bob');

    expect(store.getState().hiddenRooms.size).toBe(0);
    expect(store.getState().closedConversations.size).toBe(0);
  });
});
