/**
 * store.channelNotifyMode.test.ts
 *
 * Per-channel notification-preference mode layer. The store keeps a SINGLE
 * source of truth (`channelNotify`, persisted at `onyx:channel-notify`); the
 * public mode API spells the stored `'none'` level as `'mute'`. These tests
 * assert the immutable `set` (Map is replaced, never mutated), the persistence
 * round-trip, the `'all'` default when unset, and the `shouldNotify` helper for
 * each mode.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { store } from './store';

const initialState = store.getInitialState();
const NOTIFY_KEY = 'onyx:channel-notify';

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

describe('setChannelNotifyMode', () => {
  it('replaces the Map immutably (never mutates the previous reference)', () => {
    const before = store.getState().channelNotify;
    store.getState().setChannelNotifyMode('#Room', 'mentions');
    const after = store.getState().channelNotify;

    expect(after).not.toBe(before); // fresh Map reference — subscribers fire
    expect(before.size).toBe(0); // previous Map untouched
    expect(after.get('#room')).toBe('mentions'); // key lower-cased
  });

  it('stores mute as the legacy "none" level and reads it back as "mute"', () => {
    store.getState().setChannelNotifyMode('#Muted', 'mute');
    expect(store.getState().channelNotify.get('#muted')).toBe('none');
    expect(store.getState().channelNotifyMode('#MUTED')).toBe('mute');
  });

  it('clears the entry when set back to the default "all"', () => {
    store.getState().setChannelNotifyMode('#room', 'mute');
    expect(store.getState().channelNotify.has('#room')).toBe(true);

    store.getState().setChannelNotifyMode('#room', 'all');
    expect(store.getState().channelNotify.has('#room')).toBe(false);
    expect(store.getState().channelNotifyMode('#room')).toBe('all');
  });
});

describe('persistence round-trip', () => {
  it('persists non-default modes under onyx:channel-notify and omits "all"', () => {
    store.getState().setChannelNotifyMode('#pings', 'mentions');
    store.getState().setChannelNotifyMode('#quiet', 'mute');
    store.getState().setChannelNotifyMode('#loud', 'all'); // default — not persisted

    const raw = localStorage.getItem(NOTIFY_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ '#pings': 'mentions', '#quiet': 'none' });
  });
});

describe('channelNotifyMode accessor', () => {
  it('defaults to "all" when the channel is unset', () => {
    expect(store.getState().channelNotifyMode('#never-set')).toBe('all');
  });
});

describe('shouldNotify derived helper', () => {
  beforeEach(() => {
    store.getState().setChannelNotifyMode('#muted', 'mute');
    store.getState().setChannelNotifyMode('#mentions', 'mentions');
  });

  it('mute never notifies', () => {
    expect(store.getState().shouldNotify('#muted', true)).toBe(false);
    expect(store.getState().shouldNotify('#muted', false)).toBe(false);
  });

  it('mentions notifies only on a mention', () => {
    expect(store.getState().shouldNotify('#mentions', true)).toBe(true);
    expect(store.getState().shouldNotify('#mentions', false)).toBe(false);
  });

  it('all (the default when unset) always notifies', () => {
    expect(store.getState().shouldNotify('#anything', true)).toBe(true);
    expect(store.getState().shouldNotify('#anything', false)).toBe(true);
  });
});
