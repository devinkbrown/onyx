// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import type { ChatMessage } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { store, type Server } from '@/lib/store/store';
import type { VaultExportSnapshot } from '@/lib/vault/historyVault';
import { HomeView } from './HomeView';

const exportVaultMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/vault/historyVault', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/vault/historyVault')>(),
  exportVault: exportVaultMock,
}));

const initialState = store.getInitialState();
const OWNER = { serverUrl: 'wss://cold-return.test', identity: 'alice' } as const;
const SERVER: Server = {
  id: 'cold-return',
  name: 'Onyx',
  network: 'Onyx',
  url: OWNER.serverUrl,
  icon: '',
  nick: OWNER.identity,
  account: OWNER.identity,
  connected: true,
};

function message(id: string, text: string, time: number, from: string): ChatMessage {
  return {
    id,
    time: new Date(time),
    from,
    text,
    type: 'msg',
    target: '#general',
  };
}

function snapshot(targets: VaultExportSnapshot['targets']): VaultExportSnapshot {
  return {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: new Date(0).toISOString(),
    targets,
  };
}

describe('HomeView cold-return recap', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
    setPreference('localHistory', true);
    exportVaultMock.mockReset();
    exportVaultMock.mockResolvedValue(snapshot([]));
    store.setState({
      ...initialState,
      server: SERVER,
      ourNick: OWNER.identity,
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      channels: new Map(),
      dms: new Map(),
    }, true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('paints literal owner-scoped vault rows before the network is connected', async () => {
    exportVaultMock.mockResolvedValue(snapshot([
      {
        target: '#offline',
        messages: [
          message('offline-1', 'First retained line', 1_000, 'mira'),
          message('offline-2', 'Latest retained line', 2_000, 'kai'),
        ],
      },
      {
        target: 'mira',
        messages: [{
          ...message('encrypted-1', 'TSUMUGI1 opaque-ciphertext', 3_000, 'mira'),
          target: 'mira',
        }],
      },
    ]));
    store.setState({
      connectionStatus: 'connecting',
      channels: new Map(),
      dms: new Map(),
      server: { ...SERVER, connected: false },
    });

    render(() => <HomeView />);

    const offline = await screen.findByRole('region', { name: 'Device-local catch-up' });
    expect(exportVaultMock).toHaveBeenCalledWith(OWNER);
    expect(within(offline).getByText('3 remembered messages')).toBeInTheDocument();
    expect(within(offline).getByRole('button', {
      name: 'Open #offline from device memory, 2 remembered messages',
    })).toHaveTextContent('Latest retained line');
    expect(within(offline).getByRole('button', {
      name: 'Open mira from device memory, 1 remembered message',
    })).toHaveTextContent('Encrypted message');
    expect(within(offline).queryByText(/TSUMUGI1/)).not.toBeInTheDocument();
    expect(within(offline).queryByText(/unread/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark all caught up/i })).not.toBeInTheDocument();
  }, 10_000);

  it('rejects a stale cold-return snapshot after the account owner changes', async () => {
    let resolveAlice: (value: VaultExportSnapshot) => void = () => undefined;
    const aliceRead = new Promise<VaultExportSnapshot>((resolve) => {
      resolveAlice = resolve;
    });
    exportVaultMock.mockImplementation((owner: DeviceMemoryOwner | undefined) =>
      owner?.identity === 'alice'
        ? aliceRead
        : Promise.resolve(snapshot([{
          target: '#bob',
          messages: [message('bob-1', 'Bob retained handoff', 3_000, 'ren')],
        }])),
    );
    store.setState({
      connectionStatus: 'connecting',
      server: { ...SERVER, connected: false },
    });

    render(() => <HomeView />);
    await waitFor(() => {
      expect(exportVaultMock).toHaveBeenCalledWith(OWNER);
    });

    const bobOwner = { serverUrl: OWNER.serverUrl, identity: 'bob' } as const;
    store.setState({
      server: { ...SERVER, connected: false, nick: 'bob', account: bobOwner.identity },
      ourNick: bobOwner.identity,
    });

    const bobCard = await screen.findByRole('button', {
      name: 'Open #bob from device memory, 1 remembered message',
    });
    expect(bobCard).toHaveTextContent('Bob retained handoff');
    expect(exportVaultMock).toHaveBeenCalledWith(bobOwner);

    resolveAlice(snapshot([{
      target: '#alice',
      messages: [message('alice-1', 'Alice must stay hidden', 4_000, 'mira')],
    }]));
    await waitFor(() => {
      expect(screen.queryByText('Alice must stay hidden')).not.toBeInTheDocument();
      expect(bobCard).toHaveTextContent('Bob retained handoff');
    });
  });

  it('opens the exact retained row and retires device catch-up after connection', async () => {
    exportVaultMock.mockResolvedValue(snapshot([{
      target: '#offline',
      messages: [message('offline-last', 'Available offline', 4_000, 'mira')],
    }]));
    store.setState({
      connectionStatus: 'connecting',
      channels: new Map(),
      server: { ...SERVER, connected: false },
    });
    const openVaultResult = vi
      .spyOn(store.getState(), 'openVaultResult')
      .mockImplementation(() => undefined);

    render(() => <HomeView />);
    fireEvent.click(await screen.findByRole('button', {
      name: 'Open #offline from device memory, 1 remembered message',
    }));

    expect(openVaultResult).toHaveBeenCalledWith('#offline', 'offline-last');

    store.setState({ connectionStatus: 'connected' });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Device-local catch-up' })).not.toBeInTheDocument();
    });
  });
});
