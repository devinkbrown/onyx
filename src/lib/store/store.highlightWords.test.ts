// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import { HIGHLIGHT_WORDS_STORAGE_KEY } from '@/lib/notifications/highlightMemory';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://highlight.test', identity: 'alice' } as const;
const server: Server = {
  id: 'highlight-test',
  name: 'Highlight',
  network: 'Highlight',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

describe('custom highlight term actions', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({ ...initialState, server, ourNick: owner.identity, highlightWords: [] }, true);
  });

  it('normalizes, deduplicates, persists, and removes only the active owner terms', () => {
    store.getState().addHighlightWord('  Incident Term ');
    store.getState().addHighlightWord('incident term');

    expect(store.getState().highlightWords).toEqual(['incident term']);
    const key = deviceMemoryStorageKey(HIGHLIGHT_WORDS_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '[]')).toEqual(['incident term']);

    store.getState().removeHighlightWord('INCIDENT TERM');
    expect(store.getState().highlightWords).toEqual([]);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('fails closed without a server identity', () => {
    store.setState({ server: null, highlightWords: [] });
    store.getState().addHighlightWord('must not persist');

    expect(store.getState().highlightWords).toEqual([]);
    expect(localStorage.length).toBe(0);
  });
});
