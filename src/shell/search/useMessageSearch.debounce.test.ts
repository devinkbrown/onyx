// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import { resetPreferences } from '@/lib/prefs/preferences';
import { closeMessageSearch, openMessageSearch, setVaultMode, useMessageSearch } from './useMessageSearch';

// The vault (device-memory) search fetch is exercised through a spy so we can
// assert *when* it runs against the fake timer, independent of IndexedDB.
const searchVaultMock = vi.fn<(query: string) => Promise<never[]>>(async () => []);
const searchVaultSemanticMock = vi.fn<(query: string) => Promise<never[]>>(async () => []);

vi.mock('@/lib/vault/historyVault', () => ({
  searchVault: (query: string) => searchVaultMock(query),
}));
vi.mock('@/lib/vault/searchVaultSemantic', () => ({
  searchVaultSemantic: (query: string) => searchVaultSemanticMock(query),
}));

const initialState = store.getInitialState();

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

describe('useMessageSearch — vault debounce isolation', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    closeMessageSearch();
    resetPreferences();
    // Pin the lexical (exact) matcher so this suite exercises searchVault's
    // debounce timing directly; hybrid is the default mode elsewhere.
    setVaultMode('exact');
    searchVaultMock.mockClear();
    searchVaultSemanticMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not restart the vault debounce when an unrelated conversation gets new messages', async () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([
        ['#root', channel('#root', [message('root-1', 'Kai', 'needle in the room', 1)])],
        ['#other', channel('#other', [message('other-1', 'Mira', 'unrelated chatter', 1, '#other')])],
      ]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();
      search.setQuery('needle');
    });

    // Let the scheduling effect run, then advance partway into the 200ms debounce.
    await vi.advanceTimersByTimeAsync(150);
    expect(searchVaultMock).toHaveBeenCalledTimes(0);

    // Unrelated traffic in a *different* conversation replaces the channels Map.
    // This must NOT reset the debounce timer for the active vault search.
    setState({
      channels: new Map([
        ['#root', channel('#root', [message('root-1', 'Kai', 'needle in the room', 1)])],
        ['#other', channel('#other', [
          message('other-1', 'Mira', 'unrelated chatter', 1, '#other'),
          message('other-2', 'Noa', 'more unrelated chatter', 2, '#other'),
        ])],
      ]),
    });

    // Cross the original 200ms boundary. If the debounce was reset by the
    // unrelated update the fetch will not have fired yet (regression).
    await vi.advanceTimersByTimeAsync(100);
    expect(searchVaultMock).toHaveBeenCalledTimes(1);
    expect(searchVaultMock).toHaveBeenCalledWith('needle');

    dispose();
  });
});
