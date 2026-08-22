// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.commercial.test.tsx — Home is a quiet catch-up inbox.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

const server = {
  id: 'home-commercial',
  name: 'Onyx',
  network: 'Onyx',
  url: 'wss://example.test',
  icon: '',
  nick: 'me',
  account: 'me',
  connected: true,
};

function makeChannel(
  name: string,
  unread: number,
  highlights: number,
  messages: ChatMessage[] = [],
): Channel {
  const users = new Map<string, ChannelUser>();
  users.set('me', { nick: 'me', modes: new Set() });
  return {
    name,
    topic: '',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread,
    highlights,
    createdAt: null,
    messages,
  };
}

function makeMsg(
  id: string,
  from: string,
  text: string,
  opts: { highlight?: boolean; time?: Date } = {},
): ChatMessage {
  return {
    id,
    time: opts.time ?? new Date('2026-07-19T12:00:00.000Z'),
    from,
    text,
    type: 'msg',
    target: '#mentions',
    highlight: opts.highlight,
  };
}

function seedInbox(): void {
  const t0 = new Date('2026-07-19T10:00:00.000Z');
  const t1 = new Date('2026-07-19T11:00:00.000Z');
  const channels = new Map<string, Channel>();
  channels.set(
    '#mentions',
    makeChannel('#mentions', 3, 2, [
      makeMsg('m-1', 'alice', 'hey @me', { highlight: true, time: t0 }),
      makeMsg('m-2', 'bob', 'second', { time: t1 }),
    ]),
  );
  channels.set('#news', makeChannel('#news', 4, 0, [
    makeMsg('n-1', 'ed', 'followed chatter', { time: t1 }),
  ]));
  store.setState(
    {
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      firstUnreadId: new Map<string, string | null>([
        ['#mentions', 'm-1'],
        ['#news', 'n-1'],
      ]),
      channelLastActivity: new Map([
        ['#mentions', t1.getTime()],
        ['#news', t1.getTime() - 1_000],
      ]),
    },
    true,
  );
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPreferences();
});

describe('HomeView — catch-up inbox', () => {
  it('lists mentions before unreads and keeps the founder strip slot free of Explore', () => {
    seedInbox();
    render(() => <HomeView />);

    const inbox = screen.getByRole('region', { name: 'Catch up on what you missed' });
    const mentions = screen.getByRole('group', { name: 'Mentions' });
    const unread = screen.getByRole('group', { name: 'Unread rooms and messages' });

    expect(inbox).toHaveAttribute('data-home-band', 'inbox');
    expect(mentions.compareDocumentPosition(unread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Explore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live now' })).not.toBeInTheDocument();
    expect(screen.queryByText(/people online|Room ledger/i)).not.toBeInTheDocument();
  });

  it('does not offer a hardcoded Join #root CTA', () => {
    seedInbox();
    render(() => <HomeView />);
    expect(screen.queryByRole('button', { name: /Join #root/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Join #root/i)).not.toBeInTheDocument();
  });

  it('shows a truthful quiet empty state without inventing people or rooms', () => {
    const channels = new Map<string, Channel>();
    channels.set('#general', makeChannel('#general', 0, 0, [
      makeMsg('g-1', 'alice', 'already read', { time: new Date('2026-07-19T12:00:00.000Z') }),
    ]));
    store.setState(
      {
        ...initialState,
        channels,
        ourNick: 'me',
        connectionStatus: 'connected',
        activeView: { kind: 'home' },
        server,
        firstUnreadId: new Map(),
      },
      true,
    );

    render(() => <HomeView />);

    expect(screen.getByRole('heading', { name: 'The room is quiet.' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'The room is quiet' })).toHaveAttribute('data-home-band', 'caught-up');
    expect(screen.queryByText(/testimonial|enterprise|secure badge|people online/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live now' })).not.toBeInTheDocument();
  });

  it('marks the live backlog caught up through Home without joining media', () => {
    seedInbox();
    const markRead = vi.spyOn(store.getState(), 'markRead');
    const joinVoice = vi.spyOn(store.getState(), 'joinVoiceChannel');
    render(() => <HomeView />);

    fireEvent.click(screen.getByRole('button', { name: /Mark all caught up/ }));

    expect(markRead).toHaveBeenCalled();
    expect(joinVoice).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Mark all caught up/ })).not.toBeInTheDocument();
  });

  it('opens a mention at the first unread without Home calling markRead itself', () => {
    seedInbox();
    const markRead = vi.spyOn(store.getState(), 'markRead');
    const navigate = vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    const focusMessage = vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});
    render(() => <HomeView />);
    fireEvent.click(screen.getByRole('button', { name: /Open #mentions at your first unread message/ }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#mentions' });
    expect(focusMessage).toHaveBeenCalledWith('m-1');
    expect(markRead).not.toHaveBeenCalled();
  });
});
