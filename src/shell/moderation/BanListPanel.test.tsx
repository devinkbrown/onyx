// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import { BanListPanel } from './BanListPanel';

const initial = store.getInitialState();

function seed(opts?: { op?: boolean; connected?: boolean; sendRaw?: (...args: string[]) => boolean }) {
  const sendRaw = vi.fn(opts?.sendRaw ?? ((..._args: string[]) => true));
  const channel: Channel = {
    name: '#garden',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '+t',
    users: new Map([['me', { nick: 'me', modes: new Set(opts?.op === false ? [] : ['o']) }]]),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
  store.setState({
    ...initial,
    client: { sendRaw } as never,
    channels: new Map([['#garden', channel]]),
    ourNick: 'me',
    connectionStatus: opts?.connected === false ? 'disconnected' : 'connected',
    server: {
      id: 'ban-ui',
      name: 'Ban UI',
      network: 'Ban UI',
      url: 'wss://ban.ui',
      icon: '',
      nick: 'me',
      account: 'me',
      connected: opts?.connected !== false,
    },
  }, true);
  return sendRaw;
}

beforeEach(() => store.setState(initial, true));
afterEach(cleanup);

describe('BanListPanel', () => {
  it('requests the authoritative list and shows loading, empty, populated, and error states', () => {
    const sendRaw = seed();
    const { unmount } = render(() => <BanListPanel channel="#garden" />);
    expect(sendRaw).toHaveBeenCalledWith('MODE', '#garden', '+b');
    expect(screen.getByTestId('ban-list-status')).toHaveTextContent(/Loading/);

    store.setState({
      banList: new Map([['#garden', []]]),
      banListMeta: new Map([['#garden', {
        status: 'ready',
        updatedAt: Date.now(),
        error: null,
        generation: 1,
        epoch: 0,
      }]]),
    });
    expect(screen.getByTestId('ban-list-status')).toHaveTextContent(/No active blocks/);
    unmount();

    seed();
    store.setState({
      banList: new Map([['#garden', [{ mask: 'bad!*@*', setBy: 'oper' }]]]),
      banListMeta: new Map([['#garden', {
        status: 'ready',
        updatedAt: Date.now(),
        error: null,
        generation: 1,
        epoch: 0,
      }]]),
    });
    render(() => <BanListPanel channel="#garden" />);
    expect(screen.getByText('bad!*@*')).toBeInTheDocument();

    store.setState({
      banListMeta: new Map([['#garden', {
        status: 'error',
        updatedAt: Date.now(),
        error: 'You need moderator permission to view this list.',
        generation: 2,
        epoch: 0,
      }]]),
    });
    expect(screen.getByTestId('ban-list-status')).toHaveTextContent(/moderator permission/);
  });

  it('shows unavailable after a disconnect while a request is in flight', () => {
    seed();
    store.setState({
      banListMeta: new Map([['#garden', {
        status: 'loading',
        updatedAt: null,
        error: null,
        generation: 1,
        epoch: 0,
      }]]),
    });
    render(() => <BanListPanel channel="#garden" />);
    store.setState({
      connectionStatus: 'disconnected',
      server: store.getState().server ? { ...store.getState().server!, connected: false } : null,
      banListMeta: new Map([['#garden', {
        status: 'unavailable',
        updatedAt: null,
        error: 'Reconnect to refresh the block list.',
        generation: 1,
        epoch: 1,
      }]]),
    });
    expect(screen.getByTestId('ban-list-status')).toHaveTextContent(/Reconnect/);
  });

  it('reviews an unban and does not send before confirmation', () => {
    const sendRaw = seed();
    sendRaw.mockClear();
    store.setState({
      banList: new Map([['#garden', [{ mask: 'bad!*@*' }]]]),
      banListMeta: new Map([['#garden', {
        status: 'ready',
        updatedAt: Date.now(),
        error: null,
        generation: 1,
        epoch: 0,
      }]]),
    });
    render(() => <BanListPanel channel="#garden" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review lifting the block on bad!*@*' }));
    expect(sendRaw).not.toHaveBeenCalledWith('MODE', '#garden', '-b', 'bad!*@*');
    fireEvent.click(screen.getByTestId('moderation-review-confirm'));
    expect(sendRaw).toHaveBeenCalledWith('MODE', '#garden', '-b', 'bad!*@*');
  });
});
