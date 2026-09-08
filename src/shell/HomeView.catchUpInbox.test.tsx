// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Home is a quiet catch-up inbox: unread rooms, mentions, and existing invites.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();
const server = {
  id: 'home-inbox',
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

function makeMsg(id: string, from: string, text: string, highlight = false): ChatMessage {
  return {
    id,
    time: new Date('2026-08-22T17:00:00.000Z'),
    from,
    text,
    type: 'msg',
    target: '#lounge',
    highlight,
  };
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
  it('shows an unread room on Home', () => {
    const channels = new Map<string, Channel>();
    channels.set('#news', makeChannel('#news', 4, 0, [
      makeMsg('n-1', 'ed', 'later', false),
    ]));
    store.setState({
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      channelLastActivity: new Map([['#news', Date.parse('2026-08-22T17:30:00.000Z')]]),
    }, true);

    render(() => <HomeView />);

    expect(screen.getByRole('heading', { name: 'What did you miss?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open #news, 4 unread/ })).toBeInTheDocument();
    expect(screen.queryByText(/people online|Room ledger|JOIN #news/i)).not.toBeInTheDocument();
  });

  it('shows a mention of you on Home', () => {
    const channels = new Map<string, Channel>();
    channels.set('#lounge', makeChannel('#lounge', 2, 1, [
      makeMsg('m-1', 'alex', 'hey @me', true),
    ]));
    store.setState({
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      firstUnreadId: new Map([['#lounge', 'm-1']]),
      channelLastActivity: new Map([['#lounge', Date.parse('2026-08-22T17:40:00.000Z')]]),
    }, true);

    render(() => <HomeView />);

    expect(screen.getByRole('group', { name: 'Mentions' })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open #lounge at your first unread message, 2 unread, 1 mention/,
    })).toBeInTheDocument();
  });

  it('opens a row at the unread line when a boundary exists', () => {
    const channels = new Map<string, Channel>();
    channels.set('#lounge', makeChannel('#lounge', 2, 1, [
      makeMsg('m-1', 'alex', 'hey @me', true),
    ]));
    store.setState({
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      firstUnreadId: new Map([['#lounge', 'm-1']]),
    }, true);
    const navigate = vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    const focusMessage = vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(screen.getByRole('button', { name: /Open #lounge at your first unread message/ }));

    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#lounge' });
    expect(focusMessage).toHaveBeenCalledWith('m-1');
  });

  it('clears unread by navigating when there is no first-unread boundary', () => {
    const channels = new Map<string, Channel>();
    channels.set('#news', makeChannel('#news', 3, 0));
    store.setState({
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      firstUnreadId: new Map(),
    }, true);

    render(() => <HomeView />);
    fireEvent.click(screen.getByRole('button', { name: /Open #news, 3 unread/ }));

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#news' });
    expect(store.getState().channels.get('#news')?.unread).toBe(0);
  });

  it('uses quiet empty copy with no IRC or operator voice', () => {
    const channels = new Map<string, Channel>();
    channels.set('#general', makeChannel('#general', 0, 0, [
      makeMsg('g-1', 'alice', 'already read'),
    ]));
    store.setState({
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
    }, true);

    render(() => <HomeView />);

    expect(screen.getByRole('heading', { name: 'The room is quiet.' })).toBeInTheDocument();
    expect(screen.queryByText(/Welcome, me|Current ledger|Room ledger|\boper\b|\bJOIN\b|\bNICK\b/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a room' })).toBeInTheDocument();
  });

  it('does not invent a hide or close system on Home', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = [
      readFileSync(join(here, 'HomeView.tsx'), 'utf8'),
      readFileSync(join(here, 'home/HomeBriefingView.tsx'), 'utf8'),
      readFileSync(join(here, 'home/homeController.ts'), 'utf8'),
      readFileSync(join(here, 'home/homeBriefingModel.ts'), 'utf8'),
    ].join('\n');
    expect(sources).not.toMatch(/hidden-rooms|closed-conversations|onyx:hidden-rooms|onyx:closed-conversations/);
  });
});
