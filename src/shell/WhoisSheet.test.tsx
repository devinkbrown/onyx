// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import { parseIRCMessage } from '@/lib/irc/parser';
import { WhoisSheet } from './WhoisSheet';

const initialState = store.getInitialState();

beforeEach(() => {
  store.setState(initialState, true);
});

afterEach(cleanup);

describe('WhoisSheet', () => {
  it('renders incremental WHOIS details and closes through the store action', async () => {
    store.setState({
      showWhois: true,
      whoisNick: 'alice',
      whoisData: new Map([['alice', { nick: 'alice', loading: true }]]),
    });

    render(() => <WhoisSheet />);

    const dialog = screen.getByRole('dialog', { name: 'Profile: alice' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Asking the network');

    store.setState({
      whoisData: new Map([['alice', {
        nick: 'alice',
        loading: false,
        account: 'alice-account',
        username: 'alice-user',
        host: 'cloak.example',
        realname: 'Alice Example',
        server: 'irc.example',
        serverInfo: 'Example edge',
        isOper: true,
        idleSecs: 125,
        signOnTs: 1_700_000_000,
        channels: ['#root', '#very-long-shared-channel-name'],
        special: 'Uses a secure connection',
      }]]),
    });

    await waitFor(() => {
      expect(within(dialog).queryByRole('status')).toBeNull();
      expect(within(dialog).getByText('alice-account')).toBeInTheDocument();
      expect(within(dialog).getByText('alice-user@cloak.example')).toBeInTheDocument();
      expect(within(dialog).getByText('Alice Example')).toBeInTheDocument();
      expect(within(dialog).getByText('Network operator')).toBeInTheDocument();
      expect(within(dialog).getByText('2 minutes')).toBeInTheDocument();
      expect(within(dialog).getByRole('list', { name: 'Rooms shared with alice' })).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: 'Room ledger for #root' })).toHaveAttribute(
        'href',
        '/stats/?room=%23root',
      );
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close member profile' }));
    expect(store.getState().showWhois).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Profile: alice' })).toBeNull();
  });

  it('shows a settled empty state when the network returns no optional fields', () => {
    store.setState({
      showWhois: true,
      whoisNick: 'quiet-user',
      whoisData: new Map([['quiet-user', { nick: 'quiet-user', loading: false }]]),
    });

    render(() => <WhoisSheet />);

    expect(screen.getByText('The network returned no additional profile details.')).toBeInTheDocument();
  });

  it('announces an immediate reconnect error instead of spinning without a client', () => {
    store.getState().whois('offline-user');

    render(() => <WhoisSheet />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Reconnect to request profile details.');
    expect(screen.queryByText('The network returned no additional profile details.')).toBeNull();
  });

  it('replaces loading with an accessible error after ERR_NOSUCHNICK', async () => {
    store.setState({
      client: {
        sendRaw: vi.fn(),
        isupport: { CHANTYPES: '#&' },
      } as never,
      connectionStatus: 'connected',
      ourNick: 'me',
    });
    store.getState().whois('departed-user');
    render(() => <WhoisSheet />);
    expect(screen.getByRole('status')).toHaveTextContent('Asking the network');

    store.getState()._handleMessage(parseIRCMessage(':server 401 me departed-user :No such nick'));

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No profile was found for departed-user. They may have left the network.',
      );
    });
  });
});
