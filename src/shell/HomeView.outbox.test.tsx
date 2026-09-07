// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import {
  OUTBOX_MAX_AGE_MS,
  _resetVaultForTests,
  loadOutbox,
  queueOutbox,
} from '@/lib/vault/historyVault';
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
    expect(screen.queryByRole('heading', { name: 'Saved on this device' })).not.toBeInTheDocument();

    await queueOutbox('#private-room', 'sensitive body stays in the conversation', OWNER);

    expect(await screen.findByRole('heading', { name: 'Saved on this device' })).toBeInTheDocument();
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
      expect(screen.queryByRole('heading', { name: 'Saved on this device' })).not.toBeInTheDocument();
    });
  });

  it('offers an explicit retry only while connected', async () => {
    await queueOutbox('#room', 'retry me', OWNER);
    const flushSpy = vi.spyOn(store.getState(), 'flushOutbox').mockImplementation(() => {});
    render(() => <HomeView />);

    expect(await screen.findByRole('heading', { name: 'Saved on this device' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try sending now' })).not.toBeInTheDocument();
    expect(screen.getByText(/will send when you reconnect/i)).toBeInTheDocument();

    store.setState({ connectionStatus: 'connected' });
    fireEvent.click(await screen.findByRole('button', { name: 'Try sending now' }));
    expect(flushSpy).toHaveBeenCalledOnce();
    expect(screen.getByText(/still waiting/i)).toBeInTheDocument();
  });

  it('surfaces failed delivery honestly when auto-retries are exhausted', async () => {
    await queueOutbox('#room', 'stuck body never shown', OWNER);
    store.setState({ connectionStatus: 'connected', outboxDeliveryFailed: true });
    render(() => <HomeView />);

    expect(await screen.findByRole('heading', { name: 'Retryable messages' })).toBeInTheDocument();
    expect(screen.getByText(/could not be sent yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try sending now' })).toBeInTheDocument();
    expect(screen.queryByText('stuck body never shown')).not.toBeInTheDocument();
  });

  it('paints entry status labels from age (queued / expires soon / expired) without body text', async () => {
    const fresh = await queueOutbox('#fresh', 'fresh body never on Home', OWNER);
    const expiring = await queueOutbox('#expiring', 'expiring body never on Home', OWNER);
    const expired = await queueOutbox('#expired', 'expired body never on Home', OWNER);
    expect(fresh && expiring && expired).toBeTruthy();

    // Backdate via durable store so status labels reflect TTL honestly.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('onyx-vault');
      request.onsuccess = () => resolve(request.result);
    });
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const storeObj = tx.objectStore('outbox');
      storeObj.put({ ...expiring!, queued_at: now - OUTBOX_MAX_AGE_MS * 0.95 });
      storeObj.put({ ...expired!, queued_at: now - OUTBOX_MAX_AGE_MS - 1_000 });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('outbox backdate aborted'));
    });

    // Force a re-read of the durable queue after the direct put.
    store.setState({ connectionStatus: 'disconnected' });
    render(() => <HomeView />);

    expect(await screen.findByRole('heading', { name: 'Saved on this device' })).toBeInTheDocument();

    // Status copy lives in <time class="home-outbox__age"> as
    // `${statusLabel} · ${relativeAge}` — assert each TTL band without body text.
    const ages = screen.getAllByText((_, el) => el?.classList.contains('home-outbox__age') === true)
      .map((el) => el.textContent ?? '');
    expect(ages.some((text) => text.startsWith('queued ·') && !text.includes('expires soon'))).toBe(true);
    expect(ages.some((text) => text.includes('queued · expires soon'))).toBe(true);
    expect(ages.some((text) => text.includes('expired — will be dropped'))).toBe(true);

    expect(screen.queryByText('fresh body never on Home')).not.toBeInTheDocument();
    expect(screen.queryByText('expiring body never on Home')).not.toBeInTheDocument();
    expect(screen.queryByText('expired body never on Home')).not.toBeInTheDocument();
  });
});
