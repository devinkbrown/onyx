// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountDataVerbs } from './AccountDataVerbs';
import { AccountPanel } from './Account';
import { getState, store, type Server } from '@/lib/store';
import * as accountDataVerbs from '@/lib/export/accountDataVerbs';
import { ACCOUNT_DATA_VERB_COPY } from '@/lib/export/accountDataVerbs';

const initialState = store.getInitialState();

function makeClient() {
  return { sendRaw: vi.fn() };
}

function seedServer(account: string | null): Server {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'Onyx',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account ?? 'guest',
    account,
    connected: true,
  };
}

function emptyHistoryCopy(): accountDataVerbs.DeviceHistoryCopy {
  return {
    kind: 'onyx.device-history-copy',
    version: 1,
    exportedAt: '2026-08-22T12:00:00.000Z',
    reimportable: false,
    keepPerRoom: 400,
    note: ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.hint,
    rooms: [],
  };
}

beforeEach(() => {
  store.setState(initialState, true);
  store.setState({
    client: makeClient() as never,
    server: seedServer('alice'),
    ourNick: 'alice',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Account data verbs', () => {
  it('shows three distinct labels and never a Your data ZIP', () => {
    render(() => <AccountDataVerbs account="alice" active={true} />);
    const verbs = screen.getByTestId('account-data-verbs');

    expect(screen.getByRole('region', { name: 'Download what we store' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "Save this device's history" })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Delete account' })).toBeInTheDocument();
    expect(verbs).toHaveTextContent('Nick, email, and rooms you own. Not the chat.');
    expect(verbs).toHaveTextContent('History lives on this device.');
    expect(verbs).toHaveTextContent('The last ~400 messages per room on this device. You cannot load this back in.');
    expect(verbs).toHaveTextContent('This removes your identity. Other people keep their own copies.');
    expect(verbs).not.toHaveTextContent('Your data');
    expect(verbs).not.toHaveTextContent('.zip');
    expect(screen.queryByRole('button', { name: /your data/i })).toBeNull();
  });

  it('downloads the account record without deleting or dumping history', () => {
    const drop = vi.spyOn(getState(), 'dropAccount');
    const collect = vi.spyOn(accountDataVerbs, 'collectDeviceHistoryCopy');
    const downloadStore = vi.spyOn(accountDataVerbs, 'downloadAccountStoreRecord').mockReturnValue(true);
    const downloadHistory = vi.spyOn(accountDataVerbs, 'downloadDeviceHistoryCopy');

    store.setState({
      accountInfo: {
        account: 'alice',
        email: 'alice@example.net',
        registered: '2024-02-01',
        fetchedAt: new Date(),
      },
      channels: new Map([
        ['#harbor', {
          name: '#harbor',
          topic: '',
          topicSetBy: '',
          topicSetAt: null,
          modes: '',
          users: new Map([['alice', { nick: 'alice', modes: new Set(['q']) }]]),
          unread: 0,
          highlights: 0,
          createdAt: null,
          messages: [],
        }],
      ]),
    });

    render(() => <AccountDataVerbs account="alice" active={true} />);
    fireEvent.click(screen.getByTestId('account-download-store'));

    expect(downloadStore).toHaveBeenCalledOnce();
    const record = downloadStore.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      kind: 'onyx.account-store-record',
      nick: 'alice',
      account: 'alice',
      email: 'alice@example.net',
      registeredAt: '2024-02-01',
      roomsOwned: ['#harbor'],
    });
    expect(JSON.stringify(record)).not.toMatch(/your data/i);
    expect(collect).not.toHaveBeenCalled();
    expect(downloadHistory).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
  });

  it('saves this device history without deleting the account', async () => {
    const drop = vi.spyOn(getState(), 'dropAccount');
    const collect = vi.spyOn(accountDataVerbs, 'collectDeviceHistoryCopy').mockResolvedValue(emptyHistoryCopy());
    const downloadStore = vi.spyOn(accountDataVerbs, 'downloadAccountStoreRecord');
    const downloadHistory = vi.spyOn(accountDataVerbs, 'downloadDeviceHistoryCopy').mockReturnValue(true);

    render(() => <AccountDataVerbs account="alice" active={true} />);
    fireEvent.click(screen.getByTestId('account-save-device-history'));

    await waitFor(() => expect(downloadHistory).toHaveBeenCalledOnce());
    expect(collect).toHaveBeenCalledOnce();
    expect(downloadHistory.mock.calls[0]?.[0]).toMatchObject({
      kind: 'onyx.device-history-copy',
      reimportable: false,
    });
    expect(downloadStore).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
  });

  it('deletes the identity through DROP and does not export', async () => {
    const drop = vi.spyOn(getState(), 'dropAccount');
    const collect = vi.spyOn(accountDataVerbs, 'collectDeviceHistoryCopy');
    const downloadStore = vi.spyOn(accountDataVerbs, 'downloadAccountStoreRecord');
    const downloadHistory = vi.spyOn(accountDataVerbs, 'downloadDeviceHistoryCopy');
    const onDeleted = vi.fn();

    render(() => <AccountDataVerbs account="alice" active={true} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByTestId('account-drop-arm'));

    const sheet = screen.getByTestId('account-delete-sheet');
    expect(sheet).toHaveTextContent('Delete account');
    expect(sheet).toHaveTextContent('This removes your identity. Other people keep their own copies.');

    const confirm = screen.getByTestId('account-drop-confirm') as HTMLButtonElement;
    expect(confirm).toBeDisabled();
    fireEvent.input(screen.getByLabelText(/type "alice" to confirm/i), {
      target: { value: 'alice' },
    });
    fireEvent.input(screen.getByTestId('account-drop-password'), {
      target: { value: 'hunter2' },
    });
    fireEvent.submit(screen.getByLabelText('Confirm account deletion'));

    expect(drop).toHaveBeenCalledWith('alice', 'hunter2');
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(collect).not.toHaveBeenCalled();
    expect(downloadStore).not.toHaveBeenCalled();
    expect(downloadHistory).not.toHaveBeenCalled();
  });

  it('closes the delete sheet when the same account moves to another server', async () => {
    render(() => <AccountDataVerbs account="alice" active={true} />);
    fireEvent.click(screen.getByTestId('account-drop-arm'));
    expect(screen.getByLabelText('Confirm account deletion')).toBeInTheDocument();

    store.setState({ server: { ...seedServer('alice'), url: 'wss://second.example/ws' } });

    await waitFor(() => {
      expect(screen.queryByLabelText('Confirm account deletion')).not.toBeInTheDocument();
    });
  });
});

describe('You / Account mounts the three verbs', () => {
  it('does not collapse them into one export for a signed-in account', () => {
    render(() => <AccountPanel open={true} onOpenChange={() => {}} />);
    expect(screen.getByTestId('account-data-verbs')).toBeInTheDocument();
    expect(screen.getByTestId('account-download-store')).toBeInTheDocument();
    expect(screen.getByTestId('account-save-device-history')).toBeInTheDocument();
    expect(screen.getByTestId('account-drop-arm')).toBeInTheDocument();
    expect(screen.queryByTestId('you-open-export')).toBeNull();
    expect(screen.queryByText('Your data')).toBeNull();
  });
});
