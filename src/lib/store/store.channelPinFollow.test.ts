// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.channelPinFollow.test.ts
 *
 * Pinned + followed channels as first-class persisted store state. A pinned
 * channel sticks to the top of its server group; a followed channel surfaces in
 * Home digests. Both are client-only preference Sets — no server round-trip.
 *
 * These tests pin the load-bearing invariants:
 *  - the toggle REPLACES the Set (fresh reference, previous untouched) so
 *    `useStore` subscribers actually fire;
 *  - keys are normalized case-insensitively;
 *  - state persists under `onyx:pinned-channels` / `onyx:followed-channels`;
 *  - the load-on-init path reconstructs the Set from localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  store,
  _loadPinnedChannels,
  _loadFollowedChannels,
  selectIsChannelPinned,
  selectIsChannelFollowed,
} from './store';

const initialState = store.getInitialState();
const PINNED_KEY = 'onyx:pinned-channels';
const FOLLOWED_KEY = 'onyx:followed-channels';

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

describe('togglePinChannel', () => {
  it('adds a channel by REPLACING the Set (fresh reference, previous untouched)', () => {
    const before = store.getState().pinnedChannels;
    store.getState().togglePinChannel('#Room');
    const after = store.getState().pinnedChannels;

    expect(after).not.toBe(before); // fresh Set — subscribers fire
    expect(before.size).toBe(0); // previous Set never mutated
    expect(after.has('#room')).toBe(true); // key lower-cased
  });

  it('removes a channel on the second toggle, again replacing the Set', () => {
    store.getState().togglePinChannel('#room');
    const pinned = store.getState().pinnedChannels;

    store.getState().togglePinChannel('#ROOM'); // case-insensitive un-pin
    const after = store.getState().pinnedChannels;

    expect(after).not.toBe(pinned);
    expect(pinned.has('#room')).toBe(true); // prior Set untouched
    expect(after.has('#room')).toBe(false);
  });

  it('keeps independent channels when toggling one', () => {
    store.getState().togglePinChannel('#a');
    store.getState().togglePinChannel('#b');
    store.getState().togglePinChannel('#a'); // un-pin a only

    const after = store.getState().pinnedChannels;
    expect(after.has('#a')).toBe(false);
    expect(after.has('#b')).toBe(true);
  });
});

describe('toggleFollowChannel', () => {
  it('adds and removes a channel immutably, independent of pins', () => {
    const before = store.getState().followedChannels;
    store.getState().toggleFollowChannel('#News');
    const after = store.getState().followedChannels;

    expect(after).not.toBe(before);
    expect(before.size).toBe(0);
    expect(after.has('#news')).toBe(true);
    expect(store.getState().pinnedChannels.has('#news')).toBe(false); // pins unaffected

    store.getState().toggleFollowChannel('#NEWS');
    expect(store.getState().followedChannels.has('#news')).toBe(false);
  });
});

describe('selectors', () => {
  it('selectIsChannelPinned / selectIsChannelFollowed report membership case-insensitively', () => {
    store.getState().togglePinChannel('#room');
    store.getState().toggleFollowChannel('#news');

    expect(selectIsChannelPinned('#ROOM')(store.getState())).toBe(true);
    expect(selectIsChannelPinned('#other')(store.getState())).toBe(false);
    expect(selectIsChannelFollowed('#NEWS')(store.getState())).toBe(true);
    expect(selectIsChannelFollowed('#room')(store.getState())).toBe(false);
  });
});

describe('persistence round-trip', () => {
  it('persists pinned + followed sets under their onyx keys', () => {
    store.getState().togglePinChannel('#Pin1');
    store.getState().togglePinChannel('#Pin2');
    store.getState().toggleFollowChannel('#Fol1');

    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual(['#pin1', '#pin2']);
    expect(JSON.parse(localStorage.getItem(FOLLOWED_KEY)!)).toEqual(['#fol1']);
  });

  it('un-pinning rewrites the persisted list', () => {
    store.getState().togglePinChannel('#a');
    store.getState().togglePinChannel('#b');
    store.getState().togglePinChannel('#a');

    expect(JSON.parse(localStorage.getItem(PINNED_KEY)!)).toEqual(['#b']);
  });

  it('reloads the Set from localStorage on init (load-on-init path)', () => {
    localStorage.setItem(PINNED_KEY, JSON.stringify(['#alpha', '#beta']));
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify(['#gamma']));

    const pinned = _loadPinnedChannels();
    const followed = _loadFollowedChannels();

    expect(pinned).toBeInstanceOf(Set);
    expect([...pinned]).toEqual(['#alpha', '#beta']);
    expect([...followed]).toEqual(['#gamma']);
  });

  it('load returns an empty Set for missing or malformed storage', () => {
    expect(_loadPinnedChannels().size).toBe(0); // missing
    localStorage.setItem(PINNED_KEY, '{not json');
    expect(_loadPinnedChannels().size).toBe(0); // malformed
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify({ not: 'an array' }));
    expect(_loadFollowedChannels().size).toBe(0); // wrong shape
  });
});
