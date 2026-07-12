// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { store } from './store';

const initialState = store.getInitialState();

beforeEach(() => {
  localStorage.clear();
  store.setState(initialState, true);
});

describe('store unread target normalization boundaries', () => {
  it('folds mixed-case unread increments into one normalized target key', () => {
    store.getState().incrementUnread('#Root', true);
    store.getState().incrementUnread('#ROOT', true);
    store.getState().incrementUnread('#root', false);

    const state = store.getState();
    expect(Object.keys(state.channelUnread)).toEqual(['#root']);
    expect(state.channelUnread['#root']).toBe(3);
    expect(state.channelMentions['#root']).toBe(2);
    expect(state.totalUnreadMentions).toBe(2);
  });

  it('marks a mixed-case target read without mutating previous counter objects', () => {
    const unreadBefore = { '#root': 4, '#side': 2 };
    const mentionsBefore = { '#root': 3, '#side': 1 };
    store.setState({
      ...initialState,
      channelUnread: unreadBefore,
      channelMentions: mentionsBefore,
      totalUnreadMentions: 4,
    } as never, true);

    store.getState().markChannelRead('#ROOT');

    const state = store.getState();
    expect(state.channelUnread).not.toBe(unreadBefore);
    expect(state.channelMentions).not.toBe(mentionsBefore);
    expect(unreadBefore).toEqual({ '#root': 4, '#side': 2 });
    expect(mentionsBefore).toEqual({ '#root': 3, '#side': 1 });
    expect(state.channelUnread).toEqual({ '#root': 0, '#side': 2 });
    expect(state.channelMentions).toEqual({ '#root': 0, '#side': 1 });
    expect(state.totalUnreadMentions).toBe(1);
  });
});
