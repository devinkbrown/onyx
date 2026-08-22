// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isFirstHourSeen,
  recordFirstHourHandoff,
  resetFirstHourForTests,
} from '@/lib/firstHour/firstHour';
import { resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { registerStartRoomHandler, resetStartRoomHandlerForTests } from './startRoom';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
  resetFirstHourForTests();
  resetStartRoomHandlerForTests();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPreferences();
  resetFirstHourForTests();
  resetStartRoomHandlerForTests();
});

describe('HomeView first-hour empty welcome', () => {
  it('offers Browse rooms, Start a room, and Invite friends on a real empty Home', () => {
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'river',
      activeView: { kind: 'home' },
      server: {
        id: 'first-hour',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://example.test',
        icon: '',
        nick: 'river',
        account: null,
        connected: true,
      },
    }, true);

    render(() => <HomeView />);

    expect(screen.getByRole('heading', { name: 'Welcome, river.' })).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Current ledger')).not.toBeInTheDocument();
    expect(screen.queryByText('Power tip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search messages' })).not.toBeInTheDocument();
    expect(screen.getByTestId('first-hour-coach')).toHaveTextContent('Browse a room');

    fireEvent.click(screen.getByRole('button', { name: 'Browse rooms' }));
    expect(store.getState().showChannelBrowser).toBe(true);
    expect(isFirstHourSeen()).toBe(true);
  });

  it('starts a room through the existing join-field handler', () => {
    const startRoom = vi.fn();
    registerStartRoomHandler(startRoom);
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'river',
      activeView: { kind: 'home' },
    }, true);

    render(() => <HomeView />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a room' }));
    expect(startRoom).toHaveBeenCalledOnce();
    expect(isFirstHourSeen()).toBe(true);
  });

  it('invites friends through the existing /invite/ route', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'river',
      activeView: { kind: 'home' },
    }, true);

    render(() => <HomeView />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite friends' }));
    expect(assign).toHaveBeenCalledWith('/invite/');
    expect(isFirstHourSeen()).toBe(true);
  });
});
