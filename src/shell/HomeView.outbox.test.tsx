// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { _resetVaultForTests, loadOutbox, queueOutbox } from '@/lib/vault/historyVault';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();
const OWNER = { serverUrl: 'wss://example.test', identity: 'kain' } as const;
const server = {
  id: 'home-outbox',
  name: 'Onyx',
  network: 'Onyx',
  url: OWNER.serverUrl,
  icon: '',
  nick: 'kain',
  account: 'kain',
  connected: false,
};

describe('HomeView queued-send journal', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    localStorage.clear();
    resetPreferences();
    store.setState({
      ...initialState,
      activeView: { kind: 'home' },
      connectionStatus: 'disconnected',
      ourNick: 'kain',
      server,
    }, true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reacts to committed queue changes without exposing message bodies on Home', async () => {
    render(() => <HomeView />);
    expect(screen.queryByRole('heading', { name: 'Queued on this device' })).not.toBeInTheDocument();

    await queueOutbox('#private-room', 'sensitive body stays in the conversation', OWNER);

    expect(await screen.findByRole('heading', { name: 'Queued on this device' })).toBeInTheDocument();
    expect(screen.getByText('#private-room')).toBeInTheDocument();
    expect(screen.queryByText('sensitive body stays in the conversation')).not.toBeInTheDocument();
    expect(screen.getByText(/Message bodies stay inside their conversations/)).toBeInTheDocument();
  });

  it('reopens a persisted queue entry after reload and restores its pending row', async () => {
    const entry = await queueOutbox('#reloaded', 'remember this', OWNER);
    render(() => <HomeView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open queued message for #reloaded' }));

    await waitFor(() => expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#reloaded' }));
    await waitFor(() => {
      expect(store.getState().channels.get('#reloaded')?.messages).toContainEqual(
        expect.objectContaining({ id: `outbox:${entry!.id}`, text: 'remember this', pending: true }),
      );
    });
  });

  it('requires confirmation before removing one queued send', async () => {
    await queueOutbox('#keep', 'remove after confirmation', OWNER);
    render(() => <HomeView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove queued message for #keep' }));
    expect(await loadOutbox()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove queued message for #keep' }));

    await waitFor(async () => expect(await loadOutbox()).toHaveLength(0));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Queued on this device' })).not.toBeInTheDocument();
    });
  });

  it('offers an explicit retry only while connected', async () => {
    await queueOutbox('#room', 'retry me', OWNER);
    const flushSpy = vi.spyOn(store.getState(), 'flushOutbox').mockImplementation(() => {});
    render(() => <HomeView />);

    expect(await screen.findByRole('heading', { name: 'Queued on this device' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try sending now' })).not.toBeInTheDocument();

    store.setState({ connectionStatus: 'connected' });
    fireEvent.click(await screen.findByRole('button', { name: 'Try sending now' }));
    expect(flushSpy).toHaveBeenCalledOnce();
  });
});
