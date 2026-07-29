// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.coldCatchUp.test.tsx — cold return paints catch-up from device
 * memory / vault snapshot before the network repopulates live rooms.
 */
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeCatchUpMemory } from '@/lib/catchup/catchUpMemory';
import { store } from '@/lib/store';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

const MEMORY_OWNER = {
  serverUrl: 'wss://example.test',
  identity: 'testuser',
};

beforeEach(() => {
  localStorage.clear();
  store.setState(initialState, true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  store.setState(initialState, true);
  vi.unstubAllGlobals();
});

function seedColdSnapshot(): void {
  writeCatchUpMemory([
    {
      key: 'c:#general',
      kind: 'channel',
      name: '#general',
      target: '#general',
      unread: 4,
      highlights: 2,
      followed: true,
      lastActivity: Date.now() - 60_000,
      firstUnreadId: 'msg-first-unread',
      preview: 'Cold vault preview line',
      messageCount: 4,
      mentionCount: 2,
      firstMessageId: 'msg-first-unread',
      firstAt: '2026-07-19T12:00:00.000Z',
      voices: ['kai', 'mira'],
    },
    {
      key: 'd:alice',
      kind: 'dm',
      name: 'alice',
      target: 'alice',
      unread: 1,
      highlights: 0,
      followed: false,
      lastActivity: Date.now() - 30_000,
      firstUnreadId: 'dm-1',
      preview: 'hey are you there',
      messageCount: 1,
      mentionCount: 0,
      firstMessageId: 'dm-1',
      firstAt: '2026-07-19T12:05:00.000Z',
      voices: ['alice'],
    },
  ], MEMORY_OWNER);
}

describe('HomeView — cold return catch-up from device memory', () => {
  it('paints ranked catch-up from the durable snapshot before live rooms exist', () => {
    seedColdSnapshot();
    store.setState({
      ...initialState,
      activeView: { kind: 'home' },
      connectionStatus: 'connecting',
      networkName: 'Onyx',
      ourNick: 'testuser',
      server: {
        id: 'home-cold',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://example.test',
        icon: '',
        nick: 'testuser',
        account: 'testuser',
        connected: false,
      },
      channels: new Map(),
      dms: new Map(),
    } as never, true);

    render(() => <HomeView />);

    const catchUp = screen.getByLabelText('Catch up on what you missed');
    expect(catchUp).toHaveAttribute('data-catchup-source', 'memory');
    expect(within(catchUp).getByText('saved on this device')).toBeInTheDocument();
    expect(within(catchUp).getByText(/5 unread/)).toBeInTheDocument();
    expect(within(catchUp).getByText((content, el) =>
      el?.classList.contains('home-catchup-summary') === true
      && /2 mentions/.test(el.textContent ?? ''),
    )).toBeInTheDocument();
    expect(within(catchUp).getByRole('button', { name: /Open #general/ })).toBeInTheDocument();
    expect(within(catchUp).getByRole('button', { name: /Open alice/ })).toBeInTheDocument();
    // Needs you tier surfaces the DM + mention channel.
    expect(within(catchUp).getByRole('group', { name: 'Mentions and direct messages' }))
      .toBeInTheDocument();
    // Recap seeds paint without live buffers.
    expect(within(catchUp).getByText('Cold vault preview line')).toBeInTheDocument();
    // Mark-all needs live markRead targets — hidden on pure cold snapshot.
    expect(within(catchUp).queryByRole('button', { name: /Mark all caught up/ })).toBeNull();
  });

  it('prefers live unreads once rooms repopulate and hides the memory source label', () => {
    seedColdSnapshot();
    const channel = {
      name: '#general',
      topic: '',
      topicSetBy: '',
      topicSetAt: null,
      modes: '',
      users: new Map(),
      unread: 1,
      highlights: 0,
      createdAt: null,
      messages: [
        {
          id: 'live-1',
          time: new Date(),
          from: 'kai',
          text: 'live buffer line',
          type: 'msg' as const,
          target: '#general',
        },
      ],
    };
    store.setState({
      ...initialState,
      activeView: { kind: 'home' },
      connectionStatus: 'connected',
      networkName: 'Onyx',
      ourNick: 'testuser',
      server: {
        id: 'home-cold',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://example.test',
        icon: '',
        nick: 'testuser',
        account: 'testuser',
        connected: true,
      },
      channels: new Map([['#general', channel]]),
      dms: new Map(),
      channelLastActivity: new Map([['#general', Date.now()]]),
    } as never, true);

    render(() => <HomeView />);

    const catchUp = screen.getByLabelText('Catch up on what you missed');
    expect(catchUp).toHaveAttribute('data-catchup-source', 'live');
    expect(within(catchUp).getByText('live')).toBeInTheDocument();
    expect(within(catchUp).getByText(/1 unread/)).toBeInTheDocument();
    // Cold DM snapshot must not remain once live unreads exist.
    expect(within(catchUp).queryByRole('button', { name: /Open alice/ })).toBeNull();
    expect(within(catchUp).getByRole('button', { name: /Open #general/ })).toBeInTheDocument();
  });

  it('keeps the cold snapshot while empty post-JOIN shells have no transcript yet', () => {
    seedColdSnapshot();
    const emptyShell = {
      name: '#general',
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
    store.setState({
      ...initialState,
      activeView: { kind: 'home' },
      connectionStatus: 'connected',
      networkName: 'Onyx',
      ourNick: 'testuser',
      server: {
        id: 'home-cold',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://example.test',
        icon: '',
        nick: 'testuser',
        account: 'testuser',
        connected: true,
      },
      channels: new Map([['#general', emptyShell]]),
      dms: new Map(),
    } as never, true);

    render(() => <HomeView />);

    const catchUp = screen.getByLabelText('Catch up on what you missed');
    expect(catchUp).toHaveAttribute('data-catchup-source', 'memory');
    expect(within(catchUp).getByText(/5 unread/)).toBeInTheDocument();
    expect(within(catchUp).getByText('Cold vault preview line')).toBeInTheDocument();
  });
});
