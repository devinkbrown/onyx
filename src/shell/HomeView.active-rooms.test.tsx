// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Home no longer hosts the active-room directory (Discord Explore / occupancy).
 * Browse rooms still opens the existing channel browser.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

function makeChannel(name: string): Channel {
  const users = new Map<string, ChannelUser>();
  users.set('me', { nick: 'me', modes: new Set() });
  return {
    name,
    topic: '',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function statsPayload(channels: Array<{
  channel: string;
  messages?: number;
  activeUsers?: number;
  present?: number;
}>) {
  const now = Math.floor(Date.now() / 1000);
  return {
    generated_at: now,
    network: 'Onyx',
    node: 'eshmaki.me',
    users_online: 3,
    network_days: [],
    channels: channels.map((c) => ({
      channel: c.channel,
      messages: c.messages ?? 10,
      active_users: c.activeUsers ?? 1,
      present: c.present ?? 1,
      last_active: now - 30,
      topic: 'test topic',
      spark: [1, 2, 1],
    })),
  };
}

beforeEach(() => {
  store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HomeView — no Explore directory theater', () => {
  it('does not paint occupancy or Room ledger on Home', async () => {
    store.setState({
      channels: new Map(),
      activeView: { kind: 'home' },
      connectionStatus: 'connected',
      ourNick: 'me',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(statsPayload([{
          channel: '#root',
          messages: 908,
          activeUsers: 16,
          present: 7,
        }])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(() => <HomeView />);
    await Promise.resolve();

    expect(screen.queryByRole('list', { name: 'Active room directory' })).not.toBeInTheDocument();
    expect(screen.queryByText(/people here now|people online|messages tracked/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Room ledger/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The room is quiet.' })).toBeInTheDocument();
  });

  it('still opens Browse rooms from the quiet empty state', () => {
    const channels = new Map<string, Channel>();
    channels.set('#root', makeChannel('#root'));
    store.setState({
      channels,
      activeView: { kind: 'home' },
      connectionStatus: 'connected',
      ourNick: 'me',
    });

    render(() => <HomeView />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse rooms' }));
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(store.getState().activeView).toEqual({ kind: 'home' });
  });
});
