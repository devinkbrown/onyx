// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import type { DMConversation } from '@/lib/store';
import { setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { SEARCH_RESULT_TEXT_MAX } from '@/lib/vault/searchBounds';
import {
  closeMessageSearch,
  hasMessageSearchableConversation,
  MESSAGE_SEARCH_QUERY_MAX,
  openMessageSearch,
  openMessageSearchWithQuery,
  useMessageSearch,
} from './useMessageSearch';

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

function dm(nick: string, messages: ChatMessage[]): DMConversation {
  return {
    nick,
    account: null,
    unread: 0,
    highlights: 0,
    messages,
  };
}

describe('useMessageSearch', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetPreferences();
    closeMessageSearch();
  });

  it('opens as an all-device Search Center without an active channel or DM', () => {
    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();

      expect(hasMessageSearchableConversation()).toBe(false);
      openMessageSearch();

      expect(search.isOpen()).toBe(true);
      expect(search.hasConversation()).toBe(false);
      expect(search.targetLabel()).toBe('all remembered conversations');
      expect(search.canServerSearch()).toBe(false);
    });
    dispose();
  });

  it('filters the active channel by message text and author case-insensitively', () => {
    const messages = [
      message('late', 'Kai', 'Lapis current', 3),
      message('early', 'Alice', 'quiet line', 1),
      message('middle', 'Beryl', 'lapis bloom', 2),
    ];
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', messages)]]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();

      search.setQuery('LAPIS');
      expect(search.results().map((result) => result.id)).toEqual(['middle', 'late']);
      expect(search.activePosition()).toBe(1);
      expect(search.resultCount()).toBe(2);

      search.setQuery('ali');
      expect(search.results().map((result) => result.id)).toEqual(['early']);
    });
    dispose();
  });

  it('opens search with a prefilled query for moment handoffs', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([[
        '#root',
        channel('#root', [
          message('a', 'Kai', 'needle one', 1),
          message('b', 'Kai', 'other line', 2),
        ]),
      ]]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();

      openMessageSearchWithQuery('  needle  ');

      expect(search.isOpen()).toBe(true);
      expect(search.query()).toBe('needle');
      expect(search.results().map((result) => result.id)).toEqual(['a']);
      expect(search.activePosition()).toBe(1);
    });
    dispose();
  });

  it('bounds typed and prefilled queries before local or server search work', () => {
    const searchServerHistory = vi.fn();
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
      searchServerHistory,
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      const oversized = 'x'.repeat(MESSAGE_SEARCH_QUERY_MAX + 200);

      openMessageSearchWithQuery(`  ${oversized}  `);
      expect(search.query()).toHaveLength(MESSAGE_SEARCH_QUERY_MAX);

      search.setQuery(`${oversized}tail`);
      expect(search.query()).toHaveLength(MESSAGE_SEARCH_QUERY_MAX);
      expect(search.query()).not.toContain('tail');

      search.runServerSearch();
      expect(searchServerHistory).toHaveBeenCalledWith('#root', 'x'.repeat(MESSAGE_SEARCH_QUERY_MAX));
    });
    dispose();
  });

  it('bounds matched body text before placing it in reactive result state', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message(
        'oversized-result',
        'Kai',
        `needle ${'x'.repeat(SEARCH_RESULT_TEXT_MAX + 1000)}`,
        1,
      )])]]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('needle');
      expect(search.results()[0]?.text).toHaveLength(SEARCH_RESULT_TEXT_MAX);
    });
    dispose();
  });

  it('searches DMs from the active DM conversation', () => {
    setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      dms: new Map([
        ['mika', dm('Mika', [
          message('dm-1', 'Mika', 'send the amber note', 1, 'Mika'),
          message('dm-2', 'Kai', 'other thread', 2, 'Mika'),
        ])],
      ]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();

      search.setQuery('amber');

      expect(search.targetLabel()).toBe('@Mika');
      expect(search.results().map((result) => result.id)).toEqual(['dm-1']);
    });
    dispose();
  });

  it('derives device-only recall pivots from accented and non-Latin text', () => {
    setState({
      activeView: { kind: 'channel', channel: '#i18n' },
      channels: new Map([['#i18n', channel('#i18n', [
        message('i18n-1', 'Noa', 'réunion déploiement mañana 東京計画', 1, '#i18n'),
      ])]]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('réunion');

      expect(search.recallSuggestions()).toHaveLength(3);
      expect(search.recallSuggestions()).toEqual(expect.arrayContaining([
        'déploiement', 'mañana', '東京計画',
      ]));
    });
    dispose();
  });

  it('keeps an E2EE DM query device-only and searches transient plaintext, never ciphertext', () => {
    const searchServerHistory = vi.fn();
    const encrypted = {
      ...message('dm-secret', 'Mika', 'e2ee:v1:cipher-envelope', 1, 'Mika'),
      encrypted: true,
      plaintext: 'the launch decision is private',
    } satisfies ChatMessage;
    const locked = {
      ...message('dm-locked', 'Mika', 'e2ee:v1:locked-envelope', 2, 'Mika'),
      encrypted: true,
    } satisfies ChatMessage;
    setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      dms: new Map([['mika', dm('Mika', [encrypted, locked])]]),
      // Even before fresh peer-key discovery, the encrypted rows themselves
      // keep the query off server search.
      peerDmKeys: new Map(),
      canSearchHistory: true,
      connectionStatus: 'connected',
      searchServerHistory,
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();

      search.setQuery('launch decision');
      expect(search.serverSearchBlockedByE2ee()).toBe(true);
      expect(search.canServerSearch()).toBe(false);
      expect(search.results()).toMatchObject([{ id: 'dm-secret', text: 'the launch decision is private' }]);
      search.runServerSearch();
      expect(searchServerHistory).not.toHaveBeenCalled();

      search.setQuery('cipher-envelope');
      expect(search.results()).toEqual([]);
      search.setQuery('locked-envelope');
      expect(search.results()).toEqual([]);
    });
    dispose();
  });

  it('keeps existing encrypted DM history device-only after E2EE is disabled', () => {
    const searchServerHistory = vi.fn();
    setPreference('e2eeDms', false);
    setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      dms: new Map([['mika', dm('Mika', [{
        ...message('dm-secret', 'Mika', 'e2ee:v1:cipher-envelope', 1, 'Mika'),
        encrypted: true,
        plaintext: 'historical private decision',
      }])]]),
      peerDmKeys: new Map(),
      canSearchHistory: true,
      connectionStatus: 'connected',
      searchServerHistory,
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('private');

      expect(search.serverSearchBlockedByE2ee()).toBe(true);
      expect(search.canServerSearch()).toBe(false);
      expect(search.results()).toMatchObject([{
        id: 'dm-secret',
        text: 'historical private decision',
      }]);
      search.runServerSearch();
      expect(searchServerHistory).not.toHaveBeenCalled();
    });
    dispose();
  });

  it('recognizes a legacy DM ciphertext envelope even when its encrypted flag is missing', () => {
    const searchServerHistory = vi.fn();
    setPreference('e2eeDms', false);
    setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      dms: new Map([['mika', dm('Mika', [
        message('plain', 'Mika', 'ordinary remembered line', 1, 'Mika'),
        message('legacy-envelope', 'Mika', 'TSUMUGI1 opaque-ciphertext-token', 2, 'Mika'),
      ])]]),
      peerDmKeys: new Map(),
      canSearchHistory: true,
      connectionStatus: 'connected',
      searchServerHistory,
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('ciphertext-token');

      expect(search.serverSearchBlockedByE2ee()).toBe(true);
      expect(search.results()).toEqual([]);
      search.runServerSearch();
      expect(searchServerHistory).not.toHaveBeenCalled();
    });
    dispose();
  });

  it('does not surface archived E2EE ciphertext as a server result', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      serverSearch: {
        target: '#root',
        query: 'cipher',
        status: 'done',
        results: [{
          ...message('encrypted-hit', 'Mika', 'cipher envelope', 1),
          encrypted: true,
        }],
        error: null,
      },
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('cipher');

      expect(search.serverStatus()).toBe('done');
      expect(search.serverResults()).toEqual([]);
    });
    dispose();
  });

  it('drops an archived DM envelope whose legacy row omitted the encrypted flag', () => {
    setState({
      activeView: { kind: 'dm', nick: 'Mika' },
      dms: new Map([['mika', dm('Mika', [])]]),
      serverSearch: {
        target: 'Mika',
        query: 'cipher',
        status: 'done',
        results: [message(
          'legacy-encrypted-hit',
          'Mika',
          'TSUMUGI1 cipher-envelope',
          1,
          'Mika',
        )],
        error: null,
      },
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('cipher');
      expect(search.serverResults()).toEqual([]);
    });
    dispose();
  });

  it('keeps full-history server search unavailable while disconnected', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('a', 'Kai', 'needle', 1)])]]),
      canSearchHistory: true,
      connectionStatus: 'disconnected',
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('needle');

      expect(search.results().map((result) => result.id)).toEqual(['a']);
      expect(search.canServerSearch()).toBe(false);
    });
    dispose();
  });

  it('enables full-history server search when connected and capable', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('a', 'Kai', 'needle', 1)])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('needle');

      expect(search.canServerSearch()).toBe(true);
    });
    dispose();
  });

  it('does not present settled server results under a different query', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      serverSearch: {
        target: '#root',
        query: 'old query',
        status: 'done',
        results: [message('old-hit', 'Mira', 'old query result', 1)],
        error: null,
      },
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();
      search.setQuery('new query');

      expect(search.serverStatus()).toBe('idle');
      expect(search.serverResults()).toEqual([]);
      expect(search.serverError()).toBeNull();
    });
    dispose();
  });

  it('does not render or open a cross-target archived row and exposes matching notices only', () => {
    const navigate = vi.fn();
    const travelTo = vi.fn();
    const focusMessage = vi.fn();
    const valid = message('valid', 'Mira', 'needle in root', 1, '#root');
    const crossTarget = message('cross', 'Noa', 'needle elsewhere', 2, '#other');
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      navigate,
      travelTo,
      focusMessage,
      serverSearch: {
        target: '#root',
        query: 'needle',
        status: 'done',
        results: [crossTarget, valid],
        error: null,
        notice: 'Invalid search rows were omitted.',
      },
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('needle');

      expect(search.serverResults().map((result) => result.id)).toEqual(['valid']);
      expect(search.serverNotice()).toBe('Invalid search rows were omitted.');
      search.openServerResult({ ...crossTarget, ordinal: 0 });
      expect(navigate).not.toHaveBeenCalled();
      expect(travelTo).not.toHaveBeenCalled();
      expect(focusMessage).not.toHaveBeenCalled();

      search.setQuery('different');
      expect(search.serverNotice()).toBeNull();
    });
    dispose();
  });

  it('refuses an overlapping server search while the prior request is pending', () => {
    let calls = 0;
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
      serverSearch: {
        target: '#root',
        query: 'old query',
        status: 'pending',
        results: [],
        error: null,
      },
      searchServerHistory: () => {
        calls += 1;
      },
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();
      search.setQuery('new query');
      search.runServerSearch();

      expect(search.serverStatus()).toBe('pending');
      expect(calls).toBe(0);
    });
    dispose();
  });

  it('preserves the pending server-search lock across close and reopen', () => {
    let calls = 0;
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      canSearchHistory: true,
      connectionStatus: 'connected',
      serverSearch: {
        target: '#root',
        query: 'first query',
        status: 'pending',
        results: [],
        error: null,
      },
      searchServerHistory: () => {
        calls += 1;
      },
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      closeMessageSearch();
      openMessageSearchWithQuery('second query');
      search.runServerSearch();

      expect(store.getState().serverSearch.status).toBe('pending');
      expect(store.getState().serverSearch.query).toBe('first query');
      expect(calls).toBe(0);
    });
    dispose();
  });

  it('hydrates and focuses an archived server result instead of relying on a mounted DOM row', () => {
    const archived = message('archived-1', 'Mira', 'old deployment note', 4);
    const navigate = vi.fn();
    const travelTo = vi.fn();
    const focusMessage = vi.fn();
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [])]]),
      navigate,
      travelTo,
      focusMessage,
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearchWithQuery('deployment');

      search.openServerResult({ ...archived, ordinal: 0 });

      expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#root' });
      expect(travelTo).toHaveBeenCalledWith('#root', archived.time, 'archived-1');
      expect(focusMessage).toHaveBeenCalledWith('archived-1');
      expect(search.isOpen()).toBe(false);
    });
    dispose();
  });

  it('wraps previous and next through matches', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([[
        '#root',
        channel('#root', [
          message('a', 'Kai', 'needle one', 1),
          message('b', 'Kai', 'needle two', 2),
        ]),
      ]]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();
      search.setQuery('needle');

      expect(search.activeResultId()).toBe('a');
      search.next();
      expect(search.activeResultId()).toBe('b');
      search.next();
      expect(search.activeResultId()).toBe('a');
      search.previous();
      expect(search.activeResultId()).toBe('b');
    });
    dispose();
  });

  it('closes and clears transient search state', () => {
    setState({
      activeView: { kind: 'channel', channel: '#root' },
      channels: new Map([['#root', channel('#root', [message('a', 'Kai', 'needle', 1)])]]),
    });

    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      openMessageSearch();
      search.setQuery('needle');
      search.next();

      closeMessageSearch();

      expect(search.isOpen()).toBe(false);
      expect(search.query()).toBe('');
      expect(search.activePosition()).toBe(0);
      expect(search.activeResultId()).toBeNull();
    });
    dispose();
  });
});
