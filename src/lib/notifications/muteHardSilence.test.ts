// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Mute = Discord-style hard silence.
 *
 * Mentions-only is a separate All / @ / Mute level and still badges @.
 * Mute never mixes Slack-style "mentions still tap" into that label.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { store, type Server } from '@/lib/store/store';

import { buildAwayDigest } from './awayDigest';
import { buildCatchUp } from './catchUp';
import { shouldNotify, type NotifyLevel } from './channelNotifyMode';
import { shouldNotify as shouldNotifyOs } from './decision';

const ROOM = '#quiet';
const PINGS = '#pings';
const initialState = store.getInitialState();
const OWNER = { serverUrl: 'wss://mute-silence.test', identity: 'me' } as const;
const server: Server = {
  id: 'mute-hard-silence',
  name: 'Mute',
  network: 'Mute',
  url: OWNER.serverUrl,
  icon: '',
  nick: OWNER.identity,
  account: OWNER.identity,
  connected: true,
};

function emptyChannel(name: string): Channel {
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

function seed(notify: NotifyLevel): void {
  const client = {
    sendRaw: vi.fn(),
    send: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set(['echo-message']),
  };
  store.setState({
    ...initialState,
    server,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: OWNER.identity,
    channels: new Map([
      [ROOM, emptyChannel(ROOM)],
      [PINGS, emptyChannel(PINGS)],
    ]),
    activeView: { kind: 'home' },
    channelNotify: new Map<string, NotifyLevel>([
      [ROOM, notify],
      [PINGS, 'mentions'],
    ]),
    notifications: [],
  }, true);
}

function feed(channel: string, id: string, text: string): void {
  store.getState()._handleMessage(parseIRCMessage(
    `@msgid=${id};time=2026-08-22T12:00:00.000Z :alice!a@host PRIVMSG ${channel} :${text}`,
  ));
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

describe('Mute is hard silence', () => {
  it('never fires OS notify for a muted room, even on @', () => {
    const levels = new Map<string, NotifyLevel>([[ROOM, 'none']]);
    expect(shouldNotify(levels, ROOM, true)).toBe(false);
    expect(shouldNotifyOs({
      kind: 'mention',
      isSelf: false,
      muted: true,
      pushEnabled: true,
      soundEnabled: true,
      dnd: false,
      permission: 'granted',
      pageVisible: false,
      appFocused: false,
      nowMs: 20_000,
    })).toMatchObject({ desktop: false, sound: false, desktopReason: 'muted' });
  });

  it('stores a muted-room @ without a badge or inbox row', () => {
    seed('none');
    feed(ROOM, 'muted-mention', 'hello me look');

    const channel = store.getState().channels.get(ROOM);
    expect(channel).toMatchObject({ unread: 0, highlights: 0 });
    expect(store.getState().channelUnread[ROOM] ?? 0).toBe(0);
    expect(store.getState().channelMentions[ROOM] ?? 0).toBe(0);
    expect(store.getState().totalUnreadMentions).toBe(0);
    expect(store.getState().notifications).toHaveLength(0);
    expect(store.getState().shouldNotify(ROOM, true)).toBe(false);
  });

  it('omits a muted room from digest and catch-up even with leftover highlights', () => {
    const leftover = {
      key: 'c:#quiet',
      kind: 'channel' as const,
      name: ROOM,
      target: ROOM,
      unread: 4,
      highlights: 2,
      followed: true,
      lastActivity: 1,
    };
    const digest = buildAwayDigest([leftover], {
      notifyLevels: new Map([[ROOM, 'none']]),
      preset: 'regular',
    });
    expect(digest.attention).toHaveLength(0);
    expect(digest.followed).toHaveLength(0);
    expect(digest.quiet).toHaveLength(0);
    expect(digest.empty).toBe(true);

    const catchUp = buildCatchUp(
      [{ name: ROOM, unread: 4, highlights: 2 }],
      [],
      new Map(),
      { notifyLevels: new Map([[ROOM, 'none']]) },
    );
    expect(catchUp).toHaveLength(0);
  });

  it('clears leftover room badges when Mute is chosen', () => {
    seed('all');
    store.setState({
      channels: new Map([[ROOM, { ...emptyChannel(ROOM), unread: 3, highlights: 2 }]]),
      channelUnread: { [ROOM]: 3 },
      channelMentions: { [ROOM]: 2 },
      totalUnreadMentions: 2,
    });

    store.getState().setChannelNotifyMode(ROOM, 'mute');

    expect(store.getState().channels.get(ROOM)).toMatchObject({ unread: 0, highlights: 0 });
    expect(store.getState().channelMentions[ROOM] ?? 0).toBe(0);
    expect(store.getState().totalUnreadMentions).toBe(0);
  });

  it('refuses incrementUnread on a muted room', () => {
    seed('none');
    store.getState().incrementUnread(ROOM, true);
    expect(store.getState().channelUnread[ROOM] ?? 0).toBe(0);
    expect(store.getState().channelMentions[ROOM] ?? 0).toBe(0);
    expect(store.getState().totalUnreadMentions).toBe(0);
  });
});

describe('Mentions-only is the middle level', () => {
  it('still badges @ and still notifies', () => {
    seed('none');
    feed(PINGS, 'ping-mention', 'hello me look');

    const channel = store.getState().channels.get(PINGS);
    expect(channel).toMatchObject({ unread: 1, highlights: 1 });
    expect(store.getState().channelMentions[PINGS]).toBe(1);
    expect(store.getState().totalUnreadMentions).toBe(1);
    expect(store.getState().notifications).toHaveLength(1);
    expect(store.getState().notifications[0]).toMatchObject({
      type: 'mention',
      channel: PINGS,
      from: 'alice',
    });
    expect(store.getState().shouldNotify(PINGS, true)).toBe(true);
    expect(store.getState().shouldNotify(PINGS, false)).toBe(false);
  });

  it('does not badge ambient chatter in a mentions-only room', () => {
    seed('none');
    feed(PINGS, 'ambient', 'just chatter');

    expect(store.getState().channels.get(PINGS)).toMatchObject({ unread: 0, highlights: 0 });
    expect(store.getState().notifications).toHaveLength(0);
  });
});
