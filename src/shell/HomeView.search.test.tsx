// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closePreferences, openPreferences, resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { _resetVaultForTests } from '@/lib/vault/historyVault';
import { _resetSavedSearchesForTests } from '@/lib/vault/savedSearches';
import { closeMessageSearch } from './search/useMessageSearch';
import { AppShell } from './AppShell';

const initialState = store.getInitialState();

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

    const homeTrigger = screen.getByRole('button', { name: 'Search device memory' });
    homeTrigger.focus();
    fireEvent.click(homeTrigger);
    const input = screen.getByRole('searchbox', { name: 'Search messages' });
    expect(input).toHaveAttribute(
      'placeholder',
      'Search all remembered messages',
    );
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByTestId('server-search')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('searchbox', { name: 'Search messages' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(homeTrigger);

    const appearance = screen.getByRole('button', { name: 'Appearance' });
    appearance.focus();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const reopenedInput = screen.getByRole('searchbox', { name: 'Search messages' });
    await waitFor(() => expect(document.activeElement).toBe(reopenedInput));

    screen.getByRole('button', { name: 'Close search' }).focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(reopenedInput));

    fireEvent.keyDown(reopenedInput, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(appearance));
  });

  it('does not move focus behind an open modal when Cmd/Ctrl-F is pressed', async () => {
    render(() => <AppShell />);
    openPreferences();
    expect(await screen.findByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();

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
