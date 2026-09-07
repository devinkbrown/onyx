// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { closePreferences, openPreferences, resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { _resetVaultForTests } from '@/lib/vault/historyVault';
import { _resetSavedSearchesForTests } from '@/lib/vault/savedSearches';
import { closeMessageSearch } from './search/useMessageSearch';
import { AppShell } from './AppShell';

const initialState = store.getInitialState();

function seedRoom(channelName = '#general'): void {
  const message: ChatMessage = {
    id: 'needle-1',
    from: 'alice',
    text: 'Hello search needle',
    target: channelName,
    type: 'msg',
    time: new Date(Date.UTC(2026, 0, 1, 12, 0)),
  };
  const users = new Map<string, ChannelUser>([
    ['alice', { nick: 'alice', modes: new Set() }],
  ]);
  const channel: Channel = {
    name: channelName,
    topic: 'place strip topic',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [message],
  };
  store.setState({
    ...initialState,
    connectionStatus: 'connected',
    ourNick: 'testuser',
    activeView: { kind: 'channel', channel: channelName },
    channels: new Map([[channelName, channel]]),
  }, true);
}

describe('Home Search Center integration', () => {
  beforeEach(() => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    closeMessageSearch();
    closePreferences();
    localStorage.clear();
    resetPreferences();
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    cleanup();
    closeMessageSearch();
    closePreferences();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens all-device search from Home, refocuses on repeated Cmd/Ctrl-F, and restores focus', async () => {
    render(() => <AppShell />);

    const homeTrigger = screen.getByTestId('ribbon-search');
    homeTrigger.focus();
    fireEvent.click(homeTrigger);
    const input = await screen.findByRole('searchbox', { name: 'Search messages' });
    expect(input).toHaveAttribute(
      'placeholder',
      'Search messages saved on this device',
    );
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByTestId('server-search')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('searchbox', { name: 'Search messages' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(homeTrigger);

    const browse = within(screen.getByRole('main', { name: 'Home' }))
      .getByRole('button', { name: 'Browse rooms' });
    browse.focus();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const reopenedInput = await screen.findByRole('searchbox', { name: 'Search messages' });
    await waitFor(() => expect(document.activeElement).toBe(reopenedInput));

    screen.getByRole('button', { name: 'Close search' }).focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(reopenedInput));

    fireEvent.keyDown(reopenedInput, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(browse));
  });

  it('does not move focus behind an open modal when Cmd/Ctrl-F is pressed', async () => {
    render(() => <AppShell />);
    openPreferences();
    expect(await screen.findByRole('dialog', { name: /Preferences/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    expect(screen.queryByRole('searchbox', { name: 'Search messages' })).not.toBeInTheDocument();
  });

  it('leaves composed, claimed, and extra-modifier find chords to their owner', () => {
    render(() => <AppShell />);

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'f', metaKey: true, altKey: true });
    expect(screen.queryByRole('searchbox', { name: 'Search messages' })).not.toBeInTheDocument();

    const claimed = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    claimed.preventDefault();
    window.dispatchEvent(claimed);
    expect(screen.queryByRole('searchbox', { name: 'Search messages' })).not.toBeInTheDocument();
  });
});

describe('Room header message search', () => {
  beforeEach(() => {
    seedRoom();
    closeMessageSearch();
    closePreferences();
    localStorage.clear();
    resetPreferences();
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    cleanup();
    closeMessageSearch();
    closePreferences();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens current-room search from the header without Home or Cmd-K', async () => {
    render(() => <AppShell />);

    expect(screen.queryByRole('main', { name: 'Home' })).not.toBeInTheDocument();
    const headerSearch = screen.getByTestId('ribbon-search');
    expect(headerSearch).toHaveAttribute('aria-label', 'Search messages');
    expect(headerSearch).toHaveAttribute('aria-pressed', 'false');

    headerSearch.focus();
    fireEvent.click(headerSearch);

    const input = await screen.findByRole('searchbox', { name: 'Search messages' });
    expect(input).toHaveAttribute('placeholder', 'Find messages in #general');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(headerSearch).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Advanced' })).not.toBeInTheDocument();

    fireEvent.input(input, { target: { value: 'needle' } });
    expect(document.getElementById('onyx-message-search-status')).toHaveTextContent(
      '1 of 1 for “needle” in #general',
    );
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Text + related' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('searchbox', { name: 'Search messages' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(headerSearch);
    expect(headerSearch).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not put Search messages in More', () => {
    render(() => <AppShell />);
    const moreSurface = screen.getByTestId('ribbon-more');
    fireEvent.click(moreSurface.closest('button') ?? moreSurface);
    expect(screen.queryByRole('menuitem', { name: 'Search messages' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ribbon-search')).toBeInTheDocument();
  });
});
