// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { store, type Server } from '@/lib/store/store';
import { _resetVaultForTests, saveMessages } from '@/lib/vault/historyVault';
import {
  _resetSavedSearchesForTests,
  listSearches,
  saveSearch,
  type SavedSearch,
} from '@/lib/vault/savedSearches';
import {
  closeMessageSearch,
  MESSAGE_SEARCH_QUERY_MAX,
  openMessageSearch,
  openMessageSearchWithQuery,
} from './useMessageSearch';
import { MessageSearch, type SavedSearchPersistence } from './MessageSearch';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://example.test', identity: 'testuser' } as const;
const memoryServer: Server = {
  id: 'message-search',
  name: 'Example',
  network: 'Example',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: 'testuser',
  account: MEMORY_OWNER.identity,
  connected: true,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function saved(id: string, label: string, query = label.toLowerCase()): SavedSearch {
  return { id, label, query, mode: 'hybrid', createdAt: 1 };
}

function message(id: string, from: string, text: string, minute: number, target = '#root'): ChatMessage {
  return {
    id,
    from,
    text,
    target,
    type: 'msg',
    time: new Date(Date.UTC(2026, 0, 1, 12, minute)),
  };
}

function channel(name: string, messages: ChatMessage[]): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

describe('MessageSearch', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    closeMessageSearch();
    localStorage.clear();
    resetPreferences();
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
  });

  afterEach(() => {
    cleanup();
    closeMessageSearch();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('labels archived and device-memory result lists in the dense search overlay', async () => {
    const live = message('live-needle', 'Kai', 'needle in the live buffer', 1);
    const archived = message('archived-needle', 'Mira', 'needle from archived history', 2);
    const vaulted = message('vault-needle', 'Noa', 'needle on another device-memory target', 3, '#other');
    const sameRoomVaultOnly = message('vault-root-needle', 'Ira', 'needle saved only on this device', 4, '#root');
    await saveMessages('#other', [vaulted], MEMORY_OWNER);
    await saveMessages('#root', [live, sameRoomVaultOnly], MEMORY_OWNER);
    store.setState({
      ...initialState,
      server: memoryServer,
      ourNick: MEMORY_OWNER.identity,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [live])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
      serverSearch: {
        target: '#root',
        query: 'needle',
        status: 'done',
        results: [archived],
        error: null,
        notice: 'Invalid search rows were omitted.',
      },
    }, true);
    openMessageSearchWithQuery('needle');

    render(() => <MessageSearch />);

    expect(screen.getByRole('search', { name: 'Message search' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('needle');
    expect(screen.getByRole('group', { name: 'Search result navigation' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Visible message search provenance: This device/i)).toBeInTheDocument();

    const archivedList = screen.getByRole('list', { name: 'Archived message results' });
    expect(screen.getByLabelText(/Archived message search provenance: This server/i)).toBeInTheDocument();
    expect(within(archivedList).getByText('needle from archived history')).toBeInTheDocument();
    expect(screen.getByText('Invalid search rows were omitted.')).toBeInTheDocument();
    expect(screen.getByTestId('server-search-status')).toHaveTextContent(
      'Full-history search complete with 1 archived match. Invalid search rows were omitted.',
    );
    expect(screen.getByTestId('server-search-status')).toHaveAttribute('aria-atomic', 'true');

    const vaultList = await screen.findByRole('list', { name: 'Device-memory message results' });
    await waitFor(() => {
      expect(screen.getByLabelText(/Device-memory message search provenance: This device/i)).toBeInTheDocument();
      expect(within(vaultList).getByText('#other')).toBeInTheDocument();
      expect(within(vaultList).getByText('needle on another device-memory target')).toBeInTheDocument();
      expect(within(vaultList).getByText('#root')).toBeInTheDocument();
      expect(within(vaultList).getByText('needle saved only on this device')).toBeInTheDocument();
      expect(within(vaultList).queryByText('needle in the live buffer')).not.toBeInTheDocument();
    });
    expect(archivedList).toHaveAttribute('id', 'onyx-message-search-server-results');
    expect(vaultList).toHaveAttribute('id', 'onyx-message-search-vault-results');
    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveAttribute(
      'aria-controls',
      'onyx-message-search-server-results onyx-message-search-vault-results',
    );

    const navigate = vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    const travelTo = vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});
    const focusMessage = vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});
    fireEvent.click(within(archivedList).getByText('needle from archived history').closest('button')!);
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#root' });
    expect(travelTo).toHaveBeenCalledWith('#root', archived.time, 'archived-needle');
    expect(focusMessage).toHaveBeenCalledWith('archived-needle');
  });

  it('exposes next/previous keyboard semantics and announces the active visible position', async () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [
        message('first', 'Kai', 'needle one', 1),
        message('second', 'Mira', 'needle two', 2),
      ])]]),
    }, true);
    openMessageSearchWithQuery('needle');
    render(() => <MessageSearch />);

    const input = screen.getByRole('searchbox', { name: 'Search messages' });
    const localStatus = document.getElementById('onyx-message-search-status')!;
    expect(input).toHaveAttribute(
      'aria-keyshortcuts',
      'Enter Shift+Enter Control+Enter Meta+Enter Escape',
    );
    expect(localStatus).toHaveTextContent('1 of 2 for “needle” in #root');

    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(localStatus).toHaveTextContent('2 of 2 for “needle” in #root'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    await waitFor(() => expect(localStatus).toHaveTextContent('1 of 2 for “needle” in #root'));

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(localStatus).toHaveTextContent('2 of 2 for “needle” in #root'));
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(localStatus).toHaveTextContent('1 of 2 for “needle” in #root'));

    expect(screen.getByText('1 of 2', { selector: '.onyx-message-search__count' }))
      .toHaveAttribute('aria-hidden', 'true');
  });

  it('restores focus to the pre-open trigger when the search closes (SC 2.4.3)', async () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('m1', 'Kai', 'hello there', 1)])]]),
    }, true);

    render(() => <button type="button" data-testid="search-trigger">Find in conversation</button>);
    const trigger = screen.getByTestId('search-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Capture happens at open time, when the trigger still holds focus.
    openMessageSearch();
    render(() => <MessageSearch />);

    const input = await screen.findByRole('searchbox', { name: 'Search messages' });
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('refocuses and selects the query when open is requested again', async () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('m1', 'Kai', 'needle', 1)])]]),
    }, true);

    render(() => <button type="button" data-testid="search-trigger">Find in conversation</button>);
    const trigger = screen.getByTestId('search-trigger');
    trigger.focus();
    openMessageSearchWithQuery('needle');
    render(() => <MessageSearch />);

    const input = screen.getByRole('searchbox', { name: 'Search messages' }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    const savedName = screen.getByRole('textbox', { name: 'Saved search name' });
    savedName.focus();
    expect(document.activeElement).toBe(savedName);

    openMessageSearch();

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('needle'.length);

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('does not carry an unfinished saved-search label into a later search', async () => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('first query');
    render(() => <MessageSearch />);

    const label = screen.getByRole('textbox', { name: 'Saved search name' });
    fireEvent.input(label, { target: { value: 'Private working label' } });
    expect(label).toHaveValue('Private working label');

    closeMessageSearch();
    openMessageSearchWithQuery('second query');

    expect(screen.getByRole('textbox', { name: 'Saved search name' })).toHaveValue('');
  });

  it('offers device recall terms for local search pivots', async () => {
    const liveA = message('live-needle-a', 'Kai', 'needle mobile launch brief', 1);
    const liveB = message('live-needle-b', 'Mira', 'needle mobile release plan', 2);
    const vaulted = message('vault-needle', 'Noa', 'needle mobile archive handoff', 3, '#other');
    await saveMessages('#other', [vaulted], MEMORY_OWNER);
    store.setState({
      ...initialState,
      server: memoryServer,
      ourNick: MEMORY_OWNER.identity,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [liveA, liveB])]]),
      connectionStatus: 'disconnected',
    }, true);
    openMessageSearchWithQuery('needle');

    render(() => <MessageSearch />);

    const recall = await screen.findByRole('group', { name: 'Device recall terms' });
    expect(screen.getByLabelText(/Search recall terms provenance: This device/i)).toBeInTheDocument();
    expect(within(recall).getByRole('button', { name: 'mobile' })).toBeInTheDocument();

    fireEvent.click(within(recall).getByRole('button', { name: 'mobile' }));

    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('mobile');
  });

  it('searches all remembered conversations from Home without offering targetless server search', async () => {
    await saveMessages(
      '#archive',
      [message('vault-home', 'Noa', 'portable rollout checklist', 3, '#archive')],
      MEMORY_OWNER,
    );
    store.setState({
      ...initialState,
      server: memoryServer,
      ourNick: MEMORY_OWNER.identity,
      activeView: { kind: 'home' },
    }, true);
    openMessageSearchWithQuery('rollout');

    render(() => <MessageSearch />);

    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveAttribute(
      'placeholder',
      'Search all remembered messages',
    );
    expect(screen.queryByTestId('server-search')).not.toBeInTheDocument();
    const vaultList = await screen.findByRole('list', { name: 'Device-memory message results' });
    expect(within(vaultList).getByText('#archive')).toBeInTheDocument();
    expect(within(vaultList).getByText('portable rollout checklist')).toBeInTheDocument();
  });

  it('keeps a settled server-search error visible after disconnect', () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      canSearchHistory: true,
      connectionStatus: 'disconnected',
      serverSearch: {
        target: '#root',
        query: 'needle',
        status: 'error',
        results: [],
        error: 'Disconnected before the server search completed',
        notice: null,
      },
    }, true);
    openMessageSearchWithQuery('needle');

    render(() => <MessageSearch />);

    expect(screen.getByText('Disconnected before the server search completed')).toBeInTheDocument();
    expect(screen.getByTestId('server-search-status')).toHaveTextContent(
      'Full-history search failed. Disconnected before the server search completed',
    );
    expect(screen.getByRole('button', { name: 'Search full history ↵' })).toBeDisabled();
  });

  it('announces server loading and completion through one stable atomic live region', async () => {
    const archived = message('archived', 'Mira', 'needle in history', 2);
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
      serverSearch: {
        target: '#root',
        query: 'needle',
        status: 'pending',
        results: [],
        error: null,
        notice: null,
      },
    }, true);
    openMessageSearchWithQuery('needle');
    render(() => <MessageSearch />);

    const liveRegion = screen.getByTestId('server-search-status');
    expect(liveRegion).toHaveTextContent('Searching full server history for “needle” in #root');
    expect(liveRegion).toHaveAttribute('role', 'status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('server-search')).toHaveAttribute('aria-busy', 'true');

    store.setState({
      serverSearch: {
        target: '#root',
        query: 'needle',
        status: 'done',
        results: [archived],
        error: null,
        notice: 'Oversized message text was shortened.',
      },
    });

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent(
        'Full-history search complete with 1 archived match. Oversized message text was shortened.',
      );
    });
    expect(screen.getByTestId('server-search')).toHaveAttribute('aria-busy', 'false');
  });

  it('announces the async device-memory lifecycle, including empty completion', async () => {
    store.setState({
      ...initialState,
      server: memoryServer,
      ourNick: MEMORY_OWNER.identity,
      activeView: { kind: 'home' },
    }, true);
    openMessageSearchWithQuery('no-such-remembered-message');
    render(() => <MessageSearch />);

    const liveRegion = screen.getByTestId('device-search-status');
    expect(liveRegion).toHaveTextContent('Searching device memory');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent(
        'Device-memory search complete with no remembered matches.',
      );
    });
  });

  it('explains that E2EE DM search stays device-only', () => {
    const encrypted = {
      ...message('dm-secret', 'Mika', 'e2ee:v1:cipher-envelope', 1, 'Mika'),
      encrypted: true,
      plaintext: 'private launch decision',
    } satisfies ChatMessage;
    store.setState({
      ...initialState,
      activeView: { kind: 'dm', nick: 'Mika' },
      dms: new Map([['mika', {
        nick: 'Mika',
        account: null,
        unread: 0,
        highlights: 0,
        messages: [encrypted],
      }]]),
      peerDmKeys: new Map([['mika', 'peer-public-key']]),
      canSearchHistory: true,
      connectionStatus: 'connected',
    }, true);
    openMessageSearchWithQuery('launch');

    render(() => <MessageSearch />);

    expect(screen.getByText(/Encrypted DM search stays on this device/i)).toBeInTheDocument();
    expect(screen.queryByTestId('server-search')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(screen.queryByText('e2ee:v1:cipher-envelope')).not.toBeInTheDocument();
  });

  it('advertises and enforces the live query work bound on programmatic input', () => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearch();
    render(() => <MessageSearch />);

    const input = screen.getByRole('searchbox', { name: 'Search messages' });
    expect(input).toHaveAttribute('maxlength', String(MESSAGE_SEARCH_QUERY_MAX));

    fireEvent.input(input, {
      target: { value: 'q'.repeat(MESSAGE_SEARCH_QUERY_MAX + 100) },
    });
    expect(input).toHaveValue('q'.repeat(MESSAGE_SEARCH_QUERY_MAX));
  });

  it('saves, runs, and deletes hybrid Search Center queries', async () => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('release handoff');

    render(() => <MessageSearch />);

    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'Release trail' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));

    const run = await screen.findByRole('button', { name: 'Run saved search Release trail' });
    await waitFor(async () => {
      await expect(listSearches()).resolves.toEqual([
        expect.objectContaining({ label: 'Release trail', query: 'release handoff', mode: 'hybrid' }),
      ]);
    });
    expect(within(run).getByText('Text + related terms')).toBeInTheDocument();

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search messages' }), {
      target: { value: 'different' },
    });
    fireEvent.click(run);
    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('release handoff');
    expect(screen.getByRole('button', { name: 'Text + related' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Delete saved search Release trail' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Run saved search Release trail' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Deleted saved search Release trail.')).toHaveAttribute('role', 'status');
    await expect(listSearches()).resolves.toEqual([]);
  });

  it('refreshes an open Search Center after a same-tab storage invalidation', async () => {
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('current context');
    render(() => <MessageSearch />);
    await waitFor(() => {
      expect(screen.getByText('Saved searches refreshed.')).toBeInTheDocument();
    });

    await saveSearch({
      label: 'Added elsewhere',
      query: 'external private query',
      mode: 'exact',
    });

    expect(await screen.findByRole('button', { name: 'Run saved search Added elsewhere' }))
      .toBeInTheDocument();
    expect(screen.getByText('Saved searches updated on this device.')).toHaveAttribute('role', 'status');
  });

  it('keeps the newest refresh after a rapid close and reopen', async () => {
    const firstRefresh = deferred<SavedSearch[]>();
    const secondRefresh = deferred<SavedSearch[]>();
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn()
        .mockImplementationOnce(() => firstRefresh.promise)
        .mockImplementationOnce(() => secondRefresh.promise),
      saveSearch: vi.fn().mockResolvedValue(null),
      deleteSearch: vi.fn().mockResolvedValue(false),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('release');
    render(() => <MessageSearch savedSearchPersistence={persistence} />);
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(1));

    closeMessageSearch();
    await waitFor(() => {
      expect(screen.queryByRole('search', { name: 'Message search' })).toBeNull();
    });
    openMessageSearchWithQuery('release');
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(2));

    secondRefresh.resolve([saved('new', 'Newest row')]);
    expect(await screen.findByRole('button', { name: 'Run saved search Newest row' })).toBeInTheDocument();
    firstRefresh.resolve([saved('old', 'Stale row')]);
    await Promise.resolve();

    expect(screen.queryByRole('button', { name: 'Run saved search Stale row' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run saved search Newest row' })).toBeInTheDocument();
    expect(screen.getByText('Saved searches refreshed.')).toHaveAttribute('role', 'status');
  });

  it('does not let an older save overwrite a newer reopened save or status', async () => {
    const firstSave = deferred<SavedSearch | null>();
    const secondSave = deferred<SavedSearch | null>();
    const newest = saved('new-save', 'New save', 'new query');
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([newest]),
      saveSearch: vi.fn()
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementationOnce(() => secondSave.promise),
      deleteSearch: vi.fn().mockResolvedValue(false),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('old query');
    render(() => <MessageSearch savedSearchPersistence={persistence} />);
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(1));

    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'Old save' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    await waitFor(() => expect(persistence.saveSearch).toHaveBeenCalledTimes(1));

    closeMessageSearch();
    await waitFor(() => expect(screen.queryByRole('search', { name: 'Message search' })).toBeNull());
    openMessageSearchWithQuery('new query');
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(2));
    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'New save' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    await waitFor(() => expect(persistence.saveSearch).toHaveBeenCalledTimes(2));

    secondSave.resolve(newest);
    expect(await screen.findByRole('button', { name: 'Run saved search New save' })).toBeInTheDocument();
    expect(screen.getByText('Saved search New save.')).toHaveAttribute('role', 'status');
    firstSave.resolve(saved('old-save', 'Old save', 'old query'));
    await Promise.resolve();

    expect(screen.queryByRole('button', { name: 'Run saved search Old save' })).toBeNull();
    expect(screen.getByText('Saved search New save.')).toBeInTheDocument();
    expect(persistence.listSearches).toHaveBeenCalledTimes(3);
  });

  it('captures query text only through Save and leaves newer label/context input untouched', async () => {
    const pendingSave = deferred<SavedSearch | null>();
    const captured = saved('captured', 'Captured search', 'captured query');
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([captured]),
      saveSearch: vi.fn(() => pendingSave.promise),
      deleteSearch: vi.fn().mockResolvedValue(false),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('captured query');
    render(() => <MessageSearch savedSearchPersistence={persistence} />);
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(1));

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search messages' }), {
      target: { value: 'typed but not saved' },
    });
    expect(persistence.saveSearch).not.toHaveBeenCalled();
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search messages' }), {
      target: { value: 'captured query' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'Captured search' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    expect(persistence.saveSearch).toHaveBeenCalledWith({
      label: 'Captured search',
      query: 'captured query',
      mode: 'hybrid',
    });

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search messages' }), {
      target: { value: 'new context' },
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'Next label' },
    });
    pendingSave.resolve(captured);
    expect(await screen.findByRole('button', { name: 'Run saved search Captured search' })).toBeInTheDocument();

    expect(screen.getByRole('textbox', { name: 'Saved search name' })).toHaveValue('Next label');
    expect(screen.queryByText('Saved search Captured search.')).toBeNull();
    expect(persistence.saveSearch).toHaveBeenCalledTimes(1);
  });

  it('surfaces refresh rejection without replacing existing rows', async () => {
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn().mockRejectedValue(new DOMException('IndexedDB blocked')),
      saveSearch: vi.fn().mockResolvedValue(null),
      deleteSearch: vi.fn().mockResolvedValue(false),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('release');

    render(() => <MessageSearch savedSearchPersistence={persistence} />);

    const failure = await screen.findByText('This browser could not refresh saved searches.');
    expect(failure).toHaveAttribute('role', 'status');
    expect(failure).toHaveAttribute('aria-live', 'polite');
  });

  it('surfaces save rejection and does not refresh or clear the label', async () => {
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn().mockResolvedValue([]),
      saveSearch: vi.fn().mockRejectedValue(new DOMException('IndexedDB blocked')),
      deleteSearch: vi.fn().mockResolvedValue(false),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('release handoff');
    render(() => <MessageSearch savedSearchPersistence={persistence} />);
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(1));
    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'Release trail' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));

    expect(await screen.findByText('This browser could not save the search.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('textbox', { name: 'Saved search name' })).toHaveValue('Release trail');
    expect(persistence.listSearches).toHaveBeenCalledTimes(1);
  });

  it('preserves verified rows and reports delete rejection', async () => {
    const kept = saved('kept', 'Kept row');
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn().mockResolvedValue([kept]),
      saveSearch: vi.fn().mockResolvedValue(null),
      deleteSearch: vi.fn().mockRejectedValue(new DOMException('IndexedDB blocked')),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('release');
    render(() => <MessageSearch savedSearchPersistence={persistence} />);
    await screen.findByRole('button', { name: 'Run saved search Kept row' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete saved search Kept row' }));

    expect(await screen.findByText('This browser could not delete the saved search.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.getByRole('button', { name: 'Run saved search Kept row' })).toBeInTheDocument();
    expect(persistence.listSearches).toHaveBeenCalledTimes(1);
  });

  it('ignores a pending save completion after unmount', async () => {
    const pendingSave = deferred<SavedSearch | null>();
    const persistence: SavedSearchPersistence = {
      listSearches: vi.fn().mockResolvedValue([]),
      saveSearch: vi.fn(() => pendingSave.promise),
      deleteSearch: vi.fn().mockResolvedValue(false),
    };
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearchWithQuery('unmount query');
    const view = render(() => <MessageSearch savedSearchPersistence={persistence} />);
    await waitFor(() => expect(persistence.listSearches).toHaveBeenCalledTimes(1));
    fireEvent.input(screen.getByRole('textbox', { name: 'Saved search name' }), {
      target: { value: 'Unmount save' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    await waitFor(() => expect(persistence.saveSearch).toHaveBeenCalledTimes(1));

    view.unmount();
    pendingSave.resolve(saved('unmounted', 'Unmount save', 'unmount query'));
    await Promise.resolve();

    expect(screen.queryByText('Saved search Unmount save.')).toBeNull();
    expect(persistence.listSearches).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape from saved-search controls, not only the query input', async () => {
    await saveSearch({ label: 'Release trail', query: 'release handoff', mode: 'hybrid' });
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearch();
    render(() => <MessageSearch />);

    const run = await screen.findByRole('button', { name: 'Run saved search Release trail' });
    run.focus();
    fireEvent.keyDown(run, { key: 'Escape' });

    expect(screen.queryByRole('search', { name: 'Message search' })).not.toBeInTheDocument();
  });

  it('explains when global device-memory search is disabled and focuses a safe close control', async () => {
    setPreference('localHistory', false);
    store.setState({ ...initialState, activeView: { kind: 'home' } }, true);
    openMessageSearch();
    render(() => <MessageSearch />);

    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toBeDisabled();
    expect(screen.getByText(/Device history is off, so there are no remembered conversations/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open history preferences' })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close search' }));
    });
  });
});
