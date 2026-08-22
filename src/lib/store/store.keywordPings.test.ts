// SPDX-License-Identifier: AGPL-3.0-or-later
/** Keywords add pings on top of All/@/Mute; they never replace those modes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { TOPIC_TAG } from '@/lib/topics/topics';

import { store, type Server } from './store';

const ROOM = '#room';
const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://keywords.test', identity: 'me' } as const;
const memoryServer: Server = {
  id: 'keyword-pings',
  name: 'Keywords',
  network: 'Keywords',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: MEMORY_OWNER.identity,
  account: MEMORY_OWNER.identity,
  connected: true,
};

function channel(): Channel {
  return {
    name: ROOM,
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

function seed(options: {
  notify?: 'all' | 'mentions' | 'none';
  highlightWords?: string[];
} = {}): void {
  const client = {
    sendRaw: vi.fn(),
    send: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set(['echo-message']),
  };
  store.setState({
    ...initialState,
    server: memoryServer,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: 'me',
    channels: new Map([[ROOM, channel()]]),
    activeView: { kind: 'channel', channel: ROOM },
    activeChannelTopics: new Map([[ROOM, 'RoadMap']]),
    channelNotify: new Map([[ROOM, options.notify ?? 'all']]),
    highlightWords: options.highlightWords ?? [],
  }, true);
}

function feed(options: { id: string; text: string; topic?: string }): void {
  const topic = options.topic ?? 'Release';
  store.getState()._handleMessage(parseIRCMessage(
    `@msgid=${options.id};time=2026-08-22T12:00:00.000Z;${TOPIC_TAG}=${topic} :alice!u@host PRIVMSG ${ROOM} :${options.text}`,
  ));
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

describe('keyword pings', () => {
  it('treats an exact keyword token as an added ping in All mode', () => {
    seed({ notify: 'all', highlightWords: ['cat'] });
    feed({ id: 'exact-cat', text: 'the cat sat' });

    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 1 });
    expect(state.notifications.at(-1)).toMatchObject({
      type: 'mention',
      text: 'the cat sat',
      channel: ROOM,
    });
  });

  it('does not ping a substring that is not its own token', () => {
    seed({ notify: 'all', highlightWords: ['cat'] });
    feed({ id: 'category', text: 'category planning' });

    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 0 });
    expect(state.notifications.some((note) => note.type === 'mention')).toBe(false);
  });

  it('keeps a muted room silent even when a keyword is present', () => {
    seed({ notify: 'none', highlightWords: ['urgent'] });
    feed({ id: 'muted-urgent', text: 'URGENT deployment status' });

    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 0, highlights: 0 });
    expect(state.channelUnread[ROOM] ?? 0).toBe(0);
    expect(state.channelMentions[ROOM] ?? 0).toBe(0);
    expect(state.notifications).toEqual([]);
  });

  it('still counts All-mode traffic when the keyword list is empty', () => {
    seed({ notify: 'all', highlightWords: [] });
    feed({ id: 'plain-all', text: 'hallway chatter' });

    const state = store.getState();
    expect(state.channels.get(ROOM)).toMatchObject({ unread: 1, highlights: 0 });
    expect(state.channelUnread[ROOM]).toBe(1);
    expect(state.notifications.some((note) => note.type === 'mention')).toBe(false);
    expect(state.shouldNotify(ROOM, false)).toBe(true);
  });
});
