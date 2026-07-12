// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { _resetVaultForTests, saveMessages } from '@/lib/vault/historyVault';
import { closeMessageSearch, openMessageSearch, openMessageSearchWithQuery } from './useMessageSearch';
import { MessageSearch } from './MessageSearch';

const initialState = store.getInitialState();

function message(id: string, from: string, text: string, minute: number, target = '#root'): ChatMessage {
  return {
    id,
    from,
    text,
    target,
    type: 'msg',
    time: new Date(Date.UTC(2026, 0, 1, 12, minute)),
  };
}

function channel(name: string, messages: ChatMessage[]): Channel {
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
    messages,
  };
}

describe('MessageSearch', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    closeMessageSearch();
    localStorage.clear();
    resetPreferences();
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
  });

  afterEach(() => {
    cleanup();
    closeMessageSearch();
    localStorage.clear();
  });

  it('labels archived and device-memory result lists in the dense search overlay', async () => {
    const live = message('live-needle', 'Kai', 'needle in the live buffer', 1);
    const archived = message('archived-needle', 'Mira', 'needle from archived history', 2);
    const vaulted = message('vault-needle', 'Noa', 'needle on another device-memory target', 3, '#other');
    const sameRoomVaultOnly = message('vault-root-needle', 'Ira', 'needle saved only on this device', 4, '#root');
    await saveMessages('#other', [vaulted]);
    await saveMessages('#root', [live, sameRoomVaultOnly]);
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [live])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
      serverSearch: {
        target: '#root',
        query: 'needle',
        status: 'done',
        results: [archived],
        error: null,
      },
    }, true);
    openMessageSearchWithQuery('needle');

    render(() => <MessageSearch />);

    expect(screen.getByRole('search', { name: 'Message search' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('needle');
    expect(screen.getByRole('group', { name: 'Search result navigation' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Visible message search provenance: This device/i)).toBeInTheDocument();

    const archivedList = screen.getByRole('list', { name: 'Archived message results' });
    expect(screen.getByLabelText(/Archived message search provenance: This server/i)).toBeInTheDocument();
    expect(within(archivedList).getByText('needle from archived history')).toBeInTheDocument();

    const vaultList = await screen.findByRole('list', { name: 'Device-memory message results' });
    await waitFor(() => {
      expect(screen.getByLabelText(/Device-memory message search provenance: This device/i)).toBeInTheDocument();
      expect(within(vaultList).getByText('#other')).toBeInTheDocument();
      expect(within(vaultList).getByText('needle on another device-memory target')).toBeInTheDocument();
      expect(within(vaultList).getByText('#root')).toBeInTheDocument();
      expect(within(vaultList).getByText('needle saved only on this device')).toBeInTheDocument();
      expect(within(vaultList).queryByText('needle in the live buffer')).not.toBeInTheDocument();
    });
  });

  it('restores focus to the pre-open trigger when the search closes (SC 2.4.3)', async () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('m1', 'Kai', 'hello there', 1)])]]),
    }, true);

    render(() => <button type="button" data-testid="search-trigger">Find in conversation</button>);
    const trigger = screen.getByTestId('search-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Capture happens at open time, when the trigger still holds focus.
    openMessageSearch();
    render(() => <MessageSearch />);

    const input = await screen.findByRole('searchbox', { name: 'Search messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('offers device recall terms for local search pivots', async () => {
    const liveA = message('live-needle-a', 'Kai', 'needle mobile launch brief', 1);
    const liveB = message('live-needle-b', 'Mira', 'needle mobile release plan', 2);
    const vaulted = message('vault-needle', 'Noa', 'needle mobile archive handoff', 3, '#other');
    await saveMessages('#other', [vaulted]);
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [liveA, liveB])]]),
      connectionStatus: 'disconnected',
    }, true);
    openMessageSearchWithQuery('needle');

    render(() => <MessageSearch />);

    const recall = await screen.findByRole('group', { name: 'Device recall terms' });
    expect(screen.getByLabelText(/Search recall terms provenance: This device/i)).toBeInTheDocument();
    expect(within(recall).getByRole('button', { name: 'mobile' })).toBeInTheDocument();

    fireEvent.click(within(recall).getByRole('button', { name: 'mobile' }));

    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('mobile');
  });
});
