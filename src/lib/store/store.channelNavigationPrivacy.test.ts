// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import {
  emptyChannelNavigationMemory,
  loadChannelNavigationMemory,
  saveChannelNavigationMemory,
} from '@/lib/channelNavigationMemory';
import { parseIRCMessage } from '@/lib/irc/parser';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://navigation.example/ws';

function server(account: string | null, nick = account ?? 'guest'): Server {
  return {
    id: 'navigation-test',
    name: 'Navigation',
    network: 'Navigation',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('private channel navigation memory', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('fails closed without a server owner', () => {
    store.setState({
      server: null,
      ourNick: '',
      pinnedChannels: new Set(),
      followedChannels: new Set(),
      starredChannels: new Set(),
      channelFolders: [],
      channelOrder: [],
      nsfwChannels: new Set(),
      forumChannels: new Set(),
    });

    store.getState().togglePinChannel('#private');
    store.getState().toggleFollowChannel('#private');
    store.getState().starChannel('#private');
    store.getState().setChannelFolders([{ id: 'private', name: 'Private', channels: ['#private'], collapsed: false }]);
    store.getState().setChannelOrder(['#private']);
    store.getState().markChannelNsfw('#private');
    store.getState().toggleForumChannel('#private');

    expect(store.getState()).toMatchObject({
      pinnedChannels: new Set(),
      followedChannels: new Set(),
      starredChannels: new Set(),
      channelFolders: [],
      channelOrder: [],
      nsfwChannels: new Set(),
      forumChannels: new Set(),
    });
    expect(localStorage.length).toBe(0);
  });

  it('persists every room-navigation action through one active-owner record', () => {
    const owner = { serverUrl, identity: 'alice' } as const;
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      ...emptyChannelNavigationMemory(),
    });

    store.getState().togglePinChannel('#Pinned');
    store.getState().toggleFollowChannel('#Followed');
    store.getState().starChannel('#Starred');
    store.getState().setChannelFolders([{ id: 'private', name: 'Private', channels: ['#Folder'], collapsed: false }]);
    store.getState().setChannelOrder(['#Second', '#First']);
    store.getState().markChannelNsfw('#Sensitive');
    store.getState().toggleForumChannel('#Forum');

    const navigation = loadChannelNavigationMemory(owner);
    expect(navigation.pinnedChannels).toEqual(new Set(['#pinned']));
    expect(navigation.followedChannels).toEqual(new Set(['#followed']));
    expect(navigation.starredChannels).toEqual(new Set(['#starred']));
    expect(navigation.channelFolders[0]?.channels).toEqual(['#folder']);
    expect(navigation.channelOrder).toEqual(['#second', '#first']);
    expect(navigation.nsfwChannels).toEqual(new Set(['#sensitive']));
    expect(navigation.forumChannels).toEqual(new Set(['#forum']));
  });

  it('hydrates Bob and guest navigation on 900/901 and resets session NSFW acknowledgement', () => {
    const bob = { serverUrl, identity: 'bob' } as const;
    const guest = { serverUrl, identity: 'guest42' } as const;
    saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set(['#bob-private']),
    }, bob);
    saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set(['#guest-private']),
    }, guest);
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      pinnedChannels: new Set(['#alice-private']),
      nsfwAcknowledged: new Set(['#alice-private']),
    });

    feed(':navigation.example 900 alice alice!u@h bob :You are now logged in as bob');
    expect(store.getState().pinnedChannels).toEqual(new Set(['#bob-private']));
    expect(store.getState().nsfwAcknowledged).toEqual(new Set());

    store.setState({ server: server('bob', 'guest42'), ourNick: 'guest42' });
    feed(':navigation.example 901 guest42 guest42!u@h :You are now logged out');
    expect(store.getState().pinnedChannels).toEqual(new Set(['#guest-private']));
  });

  it('replaces guest navigation and acknowledgement on an ordinary NICK owner change', () => {
    const mika = { serverUrl, identity: 'mika' } as const;
    saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      followedChannels: new Set(['#mika-private']),
    }, mika);
    store.setState({
      server: server(null, 'kain'),
      ourNick: 'kain',
      followedChannels: new Set(['#kain-private']),
      nsfwAcknowledged: new Set(['#kain-private']),
    });

    feed(':kain!webchat@example NICK mika');

    expect(store.getState().followedChannels).toEqual(new Set(['#mika-private']));
    expect(store.getState().nsfwAcknowledged).toEqual(new Set());
  });
});
