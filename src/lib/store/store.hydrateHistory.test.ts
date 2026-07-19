// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { store } from './store';

const initialState = store.getInitialState();

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'vault-1',
    time: new Date(1_000),
    from: 'alice',
    text: 'remembered locally',
    type: 'msg',
    target: '#room',
    ...overrides,
  };
}

describe('hydrateHistory cold-start activation', () => {
  beforeEach(() => store.setState(initialState, true));

  it('materializes and activates a missing channel buffer before JOIN replay', () => {
    store.getState().hydrateHistory('#Room', [message()], { activate: 'channel' });

    const state = store.getState();
    expect(state.activeView).toEqual({ kind: 'channel', channel: '#room' });
    expect(state.channels.get('#room')?.messages.map((row) => row.id)).toEqual(['vault-1']);
    expect(state.dms.has('#room')).toBe(false);
  });

  it('materializes an encrypted DM from ciphertext without inventing persisted plaintext', () => {
    store.getState().hydrateHistory('Trev', [message({
      id: 'cipher-1',
      target: 'Trev',
      text: 'TSUMUGI1 opaque-ciphertext',
      encrypted: true,
      plaintext: undefined,
    })], { activate: 'dm' });

    const state = store.getState();
    const hydrated = state.dms.get('trev')?.messages[0];
    expect(state.activeView).toEqual({ kind: 'dm', nick: 'trev' });
    expect(hydrated?.text).toBe('TSUMUGI1 opaque-ciphertext');
    expect(hydrated?.plaintext).toBeUndefined();
    expect(state.channels.has('trev')).toBe(false);
  });

  it('is a no-op for a missing target without activate (JOIN must create the shell)', () => {
    store.getState().hydrateHistory('#ghost', [message({ id: 'g1', target: '#ghost' })]);
    expect(store.getState().channels.has('#ghost')).toBe(false);
    expect(store.getState().activeView).toEqual(initialState.activeView);
  });

  it('merges a time-travel window into live rows chronologically', () => {
    store.getState().hydrateHistory('#room', [message({
      id: 'live',
      time: new Date(3_000),
      text: 'live row',
    })], { activate: 'channel' });

    store.getState().hydrateHistory('#room', [
      message({ id: 'older', time: new Date(1_000), text: 'older vault' }),
      message({ id: 'between', time: new Date(2_000), text: 'between vault' }),
      message({ id: 'newer', time: new Date(4_000), text: 'newer vault' }),
    ]);

    expect(store.getState().channels.get('#room')?.messages.map((row) => row.id))
      .toEqual(['older', 'between', 'live', 'newer']);
  });
});
