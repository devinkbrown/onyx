// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { parseIRCMessage } from '@/lib/irc/parser';
import { saveTopicHistory, TOPIC_HISTORY_STORAGE_KEY } from '@/lib/topics/topicHistory';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://topics.example/ws';

function server(account: string | null, nick = account ?? 'guest'): Server {
  return {
    id: 'topic-history-test',
    name: 'Topics',
    network: 'Topics',
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

describe('private channel topic history', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('fails closed without a server owner', () => {
    store.setState({ server: null, ourNick: '', topicHistory: {} });

    store.getState().addTopicHistory('#private', 'Confidential launch topic');

    expect(store.getState().topicHistory).toEqual({});
    expect(localStorage.length).toBe(0);
  });

  it('persists normalized topic history only for the active owner', () => {
    const owner = { serverUrl, identity: 'alice' } as const;
    store.setState({ server: server('alice'), ourNick: 'alice', topicHistory: {} });

    store.getState().addTopicHistory(' #Private ', ' Confidential launch topic ');
    store.getState().addTopicHistory('#private', 'Earlier topic');
    store.getState().addTopicHistory('#private', 'Confidential launch topic');

    expect(store.getState().topicHistory).toEqual({
      '#private': ['Confidential launch topic', 'Earlier topic'],
    });
    const key = deviceMemoryStorageKey(TOPIC_HISTORY_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual(store.getState().topicHistory);
  });

  it('hydrates Bob and guest topic history on 900/901 without carrying Alice text', () => {
    const bob = { serverUrl, identity: 'bob' } as const;
    const guest = { serverUrl, identity: 'guest42' } as const;
    saveTopicHistory({ '#bob-private': ['Bob topic'] }, bob);
    saveTopicHistory({ '#guest-private': ['Guest topic'] }, guest);
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      topicHistory: { '#alice-private': ['Alice topic'] },
    });

    feed(':topics.example 900 alice alice!u@h bob :You are now logged in as bob');
    expect(store.getState().topicHistory).toEqual({ '#bob-private': ['Bob topic'] });

    store.setState({ server: server('bob', 'guest42'), ourNick: 'guest42' });
    feed(':topics.example 901 guest42 guest42!u@h :You are now logged out');
    expect(store.getState().topicHistory).toEqual({ '#guest-private': ['Guest topic'] });
  });

  it('replaces guest topic history when an ordinary NICK changes the owner', () => {
    const mika = { serverUrl, identity: 'mika' } as const;
    saveTopicHistory({ '#mika-private': ['Mika topic'] }, mika);
    store.setState({
      server: server(null, 'kain'),
      ourNick: 'kain',
      topicHistory: { '#kain-private': ['Kain topic'] },
    });

    feed(':kain!webchat@example NICK mika');

    expect(store.getState().ourNick).toBe('mika');
    expect(store.getState().topicHistory).toEqual({ '#mika-private': ['Mika topic'] });
  });
});
