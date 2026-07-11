// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import type { VaultSearchHit } from '@/lib/vault/historyVault';
import { setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import { resetPreferences } from '@/lib/prefs/preferences';
import {
  closeMessageSearch,
  openMessageSearch,
  setVaultMode,
  useMessageSearch,
  vaultSearchMode,
} from './useMessageSearch';

// Each vault matcher is stubbed so we can assert WHICH one the active mode
// dispatches, without touching IndexedDB or the real embedding pass.
const searchVaultMock = vi.fn<(query: string) => Promise<VaultSearchHit[]>>(async () => []);
const searchVaultSemanticMock = vi.fn<(query: string) => Promise<VaultSearchHit[]>>(async () => []);
const searchVaultHybridMock = vi.fn<(query: string) => Promise<VaultSearchHit[]>>(async () => []);

vi.mock('@/lib/vault/historyVault', () => ({
  searchVault: (query: string) => searchVaultMock(query),
}));
vi.mock('@/lib/vault/searchVaultSemantic', () => ({
  searchVaultSemantic: (query: string) => searchVaultSemanticMock(query),
}));
vi.mock('@/lib/vault/searchVaultHybrid', () => ({
  searchVaultHybrid: (query: string) => searchVaultHybridMock(query),
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

function hit(id: string, from: string, text: string, minute: number, target: string): VaultSearchHit {
  return { target, message: message(id, from, text, minute, target) };
}

describe('useMessageSearch — hybrid vault mode', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    closeMessageSearch();
    resetPreferences();
    setVaultMode('hybrid');
    searchVaultMock.mockClear();
    searchVaultSemanticMock.mockClear();
    searchVaultHybridMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVaultMode('hybrid');
  });

  it('defaults to hybrid recall', () => {
    expect(vaultSearchMode()).toBe('hybrid');
  });

  it('dispatches searchVaultHybrid by default and merges the hits into vaultResults', async () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('root-1', 'Kai', 'the local line', 1)])]]),
    });

    // Lexical hit leads, semantic neighbour follows — as searchVaultHybrid returns them.
    searchVaultHybridMock.mockResolvedValueOnce([
      hit('arch-1', 'Mira', 'migration plan', 5, '#archive'),
      hit('arch-2', 'Noa', 'schema rollout error', 4, '#archive'),
    ]);

    let dispose!: () => void;
    let search!: ReturnType<typeof useMessageSearch>;
    createRoot((cleanup) => {
      dispose = cleanup;
      search = useMessageSearch();
      openMessageSearch();
      search.setQuery('migration');
    });

    await vi.advanceTimersByTimeAsync(250);

    expect(searchVaultHybridMock).toHaveBeenCalledTimes(1);
    expect(searchVaultHybridMock).toHaveBeenCalledWith('migration');
    expect(searchVaultMock).not.toHaveBeenCalled();
    expect(searchVaultSemanticMock).not.toHaveBeenCalled();

    expect(search.vaultResults().map((r) => r.id)).toEqual(['arch-1', 'arch-2']);
    expect(search.vaultResults()[0]).toMatchObject({
      id: 'arch-1',
      from: 'Mira',
      text: 'migration plan',
      target: '#archive',
    });

    dispose();
  });

  it('routes exact and semantic modes to their own matchers', async () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('root-1', 'Kai', 'the local line', 1)])]]),
    });

    let dispose!: () => void;
    let search!: ReturnType<typeof useMessageSearch>;
    createRoot((cleanup) => {
      dispose = cleanup;
      search = useMessageSearch();
      openMessageSearch();
      search.setQuery('needle');
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(searchVaultHybridMock).toHaveBeenCalledTimes(1);

    search.setVaultMode('exact');
    await vi.advanceTimersByTimeAsync(250);
    expect(searchVaultMock).toHaveBeenCalledWith('needle');

    search.setVaultMode('semantic');
    await vi.advanceTimersByTimeAsync(250);
    expect(searchVaultSemanticMock).toHaveBeenCalledWith('needle');

    dispose();
  });

  it('cycles hybrid → exact → semantic → hybrid via toggleVaultMode', () => {
    let dispose!: () => void;
    let search!: ReturnType<typeof useMessageSearch>;
    createRoot((cleanup) => {
      dispose = cleanup;
      search = useMessageSearch();
    });

    expect(search.vaultMode()).toBe('hybrid');
    search.toggleVaultMode();
    expect(search.vaultMode()).toBe('exact');
    search.toggleVaultMode();
    expect(search.vaultMode()).toBe('semantic');
    search.toggleVaultMode();
    expect(search.vaultMode()).toBe('hybrid');

    dispose();
  });
});
