// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import { store } from '@/lib/store/store';
import { HomeView } from './HomeView';
import ChannelBrowser from './ChannelBrowser';

const initialState = store.getInitialState();

describe('HomeView channel directory', () => {
  beforeEach(() => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens the directory with one LIST request and waits for LISTEND', () => {
    const sendRaw = vi.fn().mockReturnValue(true);
    store.setState({ client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never, connectionStatus: 'connected' });
    render(() => <HomeView />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse rooms' }));

    expect(sendRaw).toHaveBeenCalledOnce();
    expect(sendRaw).toHaveBeenCalledWith('LIST');
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(store.getState().channelListLoading).toBe(true);

    store.getState()._handleMessage(parseIRCMessage(':server.test 323 me :End of LIST'));

    expect(store.getState().channelListLoading).toBe(false);
  });

  it('opens Start a room from Home without a LIST request', () => {
    const sendRaw = vi.fn();
    store.setState({ client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never });
    render(() => <HomeView />);

    fireEvent.click(screen.getByRole('button', { name: 'Start a room' }));

    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(store.getState().channelBrowserMode).toBe('create');
  });

  it('opens with the cached directory intact while disconnected', () => {
    const sendRaw = vi.fn();
    store.setState({
      client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never,
      connectionStatus: 'reconnecting',
      channelList: [{ name: '#saved', count: 3, topic: 'Saved room' }],
      channelListLoading: true,
    });
    render(() => <HomeView />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse rooms' }));
    render(() => <ChannelBrowser />);

    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channelList).toEqual([{ name: '#saved', count: 3, topic: 'Saved room' }]);
    expect(store.getState().channelListLoading).toBe(false);
    expect(screen.getByText(/saved directory/i)).toBeInTheDocument();
    expect(screen.getByText(/Reconnect to join/i)).toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: 'Reconnect to refresh' });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channelList).toEqual([{ name: '#saved', count: 3, topic: 'Saved room' }]);
  });

  it('opens an empty disconnected directory without entering a loading state', () => {
    vi.useFakeTimers();
    try {
    const sendRaw = vi.fn();
    store.setState({
      client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never,
      connectionStatus: 'disconnected',
      channelList: [],
      channelListLoading: true,
    });
    render(() => <HomeView />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse rooms' }));
    render(() => <ChannelBrowser />);

    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channelListLoading).toBe(false);
    expect(screen.getByText(/You’re offline/i)).toBeInTheDocument();
    vi.advanceTimersByTime(250);
    const liveStatus = screen.getByRole('status');
    expect(liveStatus).toHaveTextContent(/discovery is unavailable offline/i);
    expect(liveStatus).not.toHaveTextContent('No rooms yet.');
    expect(screen.queryByText('Loading rooms…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect to refresh' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
