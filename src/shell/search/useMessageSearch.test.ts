import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import type { DMConversation } from '@/lib/store';
import { setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import {
  closeMessageSearch,
  hasMessageSearchableConversation,
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
    closeMessageSearch();
  });

  it('does not open without an active channel or DM', () => {
    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();

      expect(hasMessageSearchableConversation()).toBe(false);
      openMessageSearch();

      expect(search.isOpen()).toBe(false);
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
