// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.formation.test.tsx — 3-in-48h founder strip through the live store.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetFormationMemoryForTests } from '@/lib/formation/formationMemory';
import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { closeRoomInviteShare, roomInviteShareTarget } from './roomInviteShareState';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();
const NOW = Date.parse('2026-08-22T18:00:00.000Z');

const OWNER = {
  serverUrl: 'wss://example.test',
  identity: 'me',
} as const;

const server = {
  id: 'home-formation',
  name: 'Onyx',
  network: 'Onyx',
  url: OWNER.serverUrl,
  icon: '',
  nick: 'me',
  account: 'me',
  connected: true,
};

function user(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function makeChannel(name: string, users: ChannelUser[], createdAt: Date | null): Channel {
  const map = new Map<string, ChannelUser>();
  for (const member of users) map.set(member.nick.toLowerCase(), member);
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: map,
    unread: 0,
    highlights: 0,
    createdAt,
    messages: [] as ChatMessage[],
  };
}

function seed(channel: Channel, ourNick = 'me'): void {
  store.setState({
    ...initialState,
    channels: new Map([[channel.name.toLowerCase(), channel]]),
    ourNick,
    connectionStatus: 'connected',
    activeView: { kind: 'home' },
    server: { ...server, nick: ourNick, account: ourNick },
  }, true);
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
  resetFormationMemoryForTests();
  closeRoomInviteShare();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPreferences();
  resetFormationMemoryForTests();
  closeRoomInviteShare();
  store.setState(initialState, true);
});

describe('HomeView 3-in-48h founder strip', () => {
  it('nags a founder who created a room and is still alone', () => {
    seed(makeChannel('#lounge', [user('me', ['Q'])], new Date(NOW - 3_600_000)));
    render(() => <HomeView />);

    const strip = screen.getByRole('region', { name: 'Room formation' });
    expect(strip).toHaveTextContent("2 of 3 haven't opened this");
    expect(strip).toHaveTextContent('Just you in #lounge so far.');
    expect(strip).not.toHaveTextContent(/DAU|Discord|tour|people online|workspace/i);

    fireEvent.click(screen.getByRole('button', { name: 'Reshare' }));
    expect(roomInviteShareTarget()).toEqual({ channel: '#lounge' });
  });

  it('names the first person who actually shows up', () => {
    seed(makeChannel('#lounge', [user('me', ['Q']), user('Alex')], new Date(NOW - 3_600_000)));
    render(() => <HomeView />);

    expect(screen.getByRole('region', { name: 'Room formation' })).toHaveTextContent(
      'Alex is here — say the thing you invited them for.',
    );
  });

  it('asks a joiner to say hi when they arrived with invite context', () => {
    seed(
      makeChannel('#lounge', [user('Mira', ['Q']), user('alex')], new Date(NOW - 3_600_000)),
      'alex',
    );
    store.setState({ pendingDeepLinkJoin: '#lounge' });
    render(() => <HomeView />);

    expect(screen.getByRole('region', { name: 'Room formation' })).toHaveTextContent('Say hi to Mira');
    expect(screen.queryByRole('button', { name: 'Reshare' })).not.toBeInTheDocument();
  });

  it('stops nagging once three people have shown up', () => {
    seed(makeChannel('#lounge', [
      user('me', ['Q']),
      user('Alex'),
      user('Sam'),
    ], new Date(NOW - 3_600_000)));
    render(() => <HomeView />);

    expect(screen.queryByRole('region', { name: 'Room formation' })).not.toBeInTheDocument();
  });

  it('does not invent a formation story for an old crowded room', () => {
    seed(makeChannel('#root', [
      user('me'),
      user('op', ['o']),
      user('voice', ['v']),
    ], new Date(NOW - 4 * 24 * 60 * 60 * 1000)));
    render(() => <HomeView />);

    expect(screen.queryByRole('region', { name: 'Room formation' })).not.toBeInTheDocument();
  });
});
