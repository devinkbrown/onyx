// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.active-rooms.test.tsx — Active rooms directory open-or-join.
 *
 * Regression: cards label "Open →" when already joined, but must navigate
 * into that room (not emit a no-op JOIN that leaves activeView on home).
 * Unjoined cards still only join without inventing a local conversation.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
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

describe('HomeView — Active rooms open-or-join', () => {
  it('opens an already-joined mixed-case room via navigate without JOIN', async () => {
    const channels = new Map<string, Channel>();
    // Canonical store key is lowercase; directory may show different casing.
    channels.set('#root', makeChannel('#root'));
    store.setState({
      channels,
      activeView: { kind: 'home' },
      connectionStatus: 'connected',
      ourNick: 'me',
    });

    const joinSpy = vi.spyOn(store.getState(), 'joinChannel');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(statsPayload([{ channel: '#Root', messages: 42 }])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(() => <HomeView />);

    const openBtn = await screen.findByRole('button', { name: 'Open #Root' });
    expect(openBtn).toHaveTextContent('Open →');
    expect(store.getState().activeView).toEqual({ kind: 'home' });

    fireEvent.click(openBtn);

    expect(joinSpy).not.toHaveBeenCalled();
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
  });

  it('labels current room presence instead of rolling active users', async () => {
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

    const directory = await screen.findByRole('list', { name: 'Active room directory' });
    expect(directory).toHaveTextContent('7 people here now');
    expect(directory).toHaveTextContent('908 messages tracked');
    expect(directory).not.toHaveTextContent('16 chatting');
    expect(screen.getByRole('link', { name: 'Room ledger for #root' })).toHaveAttribute(
      'href',
      '/stats/?room=%23root',
    );
    expect(screen.getByRole('link', { name: 'Room ledger' })).toHaveAttribute('href', '/stats/');
  });

  it('joins an unjoined room without navigating away from Home', async () => {
    store.setState({
      channels: new Map(),
      activeView: { kind: 'home' },
      connectionStatus: 'connected',
      ourNick: 'me',
      client: { join: vi.fn(), sendRaw: vi.fn(), isupport: { CHANTYPES: '#&' } } as never,
    });

    const joinSpy = vi.spyOn(store.getState(), 'joinChannel');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(statsPayload([{ channel: '#lobby', messages: 7 }])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(() => <HomeView />);

    const joinBtn = await screen.findByRole('button', { name: 'Join #lobby' });
    expect(joinBtn).toHaveTextContent('Join →');

    fireEvent.click(joinBtn);

    await waitFor(() => {
      expect(joinSpy).toHaveBeenCalledWith('#lobby');
    });
    expect(store.getState().activeView).toEqual({ kind: 'home' });
    expect(store.getState().channels.has('#lobby')).toBe(false);
  });
});
