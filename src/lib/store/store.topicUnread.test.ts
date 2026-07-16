// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Named-conversation delivery semantics.
 *
 * A selected topic narrows the active/read surface inside its parent channel:
 * messages from other topics (and untagged messages) remain visible in the
 * room history, but must still become unread.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { follow, followed, unfollow } from '@/lib/notifications/followed';
import { TOPIC_TAG } from '@/lib/topics/topics';

import { store, type Server } from './store';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://topics.test', identity: 'me' } as const;
const memoryServer: Server = {
  id: 'topic-unread',
  name: 'Topics',
  network: 'Topics',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: MEMORY_OWNER.identity,
  account: MEMORY_OWNER.identity,
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

function seedActiveChannel(selectedTopic?: string): void {
  const client = {
    sendRaw: vi.fn(),
    send: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
  };
  store.setState({
    ...initialState,
    server: memoryServer,
    client: client as never,
    channels: new Map([['#general', channel('#general')]]),
    ourNick: 'me',
    activeView: { kind: 'channel', channel: '#general' },
    activeChannelTopics: selectedTopic
      ? new Map([['#general', selectedTopic]])
      : new Map(),
  }, true);
}

function feedMessage(id: string, text: string, topic?: string): void {
  const tags = topic === undefined
    ? `msgid=${id}`
    : `${TOPIC_TAG}=${topic};msgid=${id}`;
  store.getState()._handleMessage(
    parseIRCMessage(`@${tags} :alice!a@host PRIVMSG #general :${text}`),
  );
}

beforeEach(() => {
  store.setState(initialState, true);
  for (const key of followed()) unfollow(key);
  localStorage.clear();
});

describe('named-conversation unread visibility', () => {
  it('keeps the selected topic read while counting other and untagged messages', () => {
    seedActiveChannel('roadmap');

    feedMessage('topic-a', 'visible in the selected conversation', 'roadmap');
    expect(store.getState().channels.get('#general')?.unread).toBe(0);
    expect(store.getState().channelUnread['#general']).toBe(0);
    expect(store.getState().firstUnreadId.has('#general')).toBe(false);

    feedMessage('topic-b', 'hidden in another conversation', 'release');
    expect(store.getState().channels.get('#general')?.unread).toBe(1);
    expect(store.getState().channelUnread['#general']).toBe(1);
    expect(store.getState().firstUnreadId.get('#general')).toBe('topic-b');

    feedMessage('untagged', 'hidden in the whole-room conversation');
    expect(store.getState().channels.get('#general')?.unread).toBe(2);
    expect(store.getState().channelUnread['#general']).toBe(2);
    expect(store.getState().firstUnreadId.get('#general')).toBe('topic-b');
    expect(store.getState().channels.get('#general')?.messages).toHaveLength(3);
  });

  it('matches topic labels case-insensitively and only follows hidden topics', () => {
    seedActiveChannel('RoadMap');
    follow('#general', 'roadmap', MEMORY_OWNER);
    follow('#general', 'release', MEMORY_OWNER);

    feedMessage('same-topic', 'same conversation, different case', 'ROADMAP');
    expect(store.getState().channels.get('#general')?.unread).toBe(0);
    expect(store.getState().notifications).toHaveLength(0);

    feedMessage('followed-hidden', 'followed conversation outside the selection', 'Release');
    expect(store.getState().channels.get('#general')?.unread).toBe(1);
    expect(store.getState().firstUnreadId.get('#general')).toBe('followed-hidden');
    expect(store.getState().notifications).toHaveLength(1);
    expect(store.getState().notifications[0]).toMatchObject({
      type: 'follow',
      from: 'alice',
      channel: '#general',
      topic: 'Release',
      text: 'followed conversation outside the selection',
    });
  });

  it('preserves whole-room active and inactive unread behavior without a selection', () => {
    seedActiveChannel();

    feedMessage('active-topic', 'topic message in active whole room', 'roadmap');
    feedMessage('active-untagged', 'untagged message in active whole room');
    expect(store.getState().channels.get('#general')?.unread).toBe(0);
    expect(store.getState().firstUnreadId.has('#general')).toBe(false);

    store.setState({ activeView: { kind: 'home' } });
    feedMessage('inactive-topic', 'topic message while parent is inactive', 'roadmap');
    expect(store.getState().channels.get('#general')?.unread).toBe(1);
    expect(store.getState().channelUnread['#general']).toBe(1);
    expect(store.getState().firstUnreadId.get('#general')).toBe('inactive-topic');
  });

  it('keeps the channel notify-level suppression for hidden conversations', () => {
    seedActiveChannel('roadmap');
    follow('#general', 'release', MEMORY_OWNER);
    store.setState({ channelNotify: new Map([['#general', 'none']]) });

    feedMessage('suppressed-hidden', 'stored without unread or notification', 'release');

    expect(store.getState().channels.get('#general')?.messages.at(-1)?.id).toBe('suppressed-hidden');
    expect(store.getState().channels.get('#general')?.unread).toBe(0);
    expect(store.getState().channelUnread['#general']).toBeUndefined();
    expect(store.getState().firstUnreadId.has('#general')).toBe(false);
    expect(store.getState().notifications).toHaveLength(0);
  });
});
