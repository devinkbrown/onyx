/**
 * store.events.test.ts — scheduled channel events (ocean.event prop).
 *
 * `/event <when> <title>` writes the event prop; `/event clear` removes it;
 * selectChannelEvent parses it and treats malformed/empty as none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store, selectChannelEphemeralSeconds, selectChannelEvent } from './store';

const initialState = store.getInitialState();

function mockClient(sendRaw = vi.fn()) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send: vi.fn(),
  } as never;
}

const evt = () => selectChannelEvent('#room')(store.getState());

// A fixed offset in the future keeps the tests from rotting as time passes.
const soonIso = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const soon = new Date(soonIso);

beforeEach(() => {
  store.setState({ ...initialState, ourNick: 'me', connectionStatus: 'connected', client: mockClient() }, true);
});

describe('scheduled events', () => {
  it('selectChannelEvent parses <unix>|<title>', () => {
    store.setState({ channelProps: new Map([['#room', { 'ocean.event': '1780000000|Community call' }]]) });
    expect(evt()).toEqual({ at: 1780000000, title: 'Community call' });
  });

  it('treats malformed or empty event props as none', () => {
    for (const raw of ['', 'notime|', '|title', 'abc|title', '123']) {
      store.setState({ channelProps: new Map([['#room', { 'ocean.event': raw }]]) });
      expect(evt()).toBeNull();
    }
  });

  it('scheduleEvent writes the prop and updates locally', () => {
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });
    store.getState().scheduleEvent('#room', soon, 'Launch party');
    const at = soon;
    const unix = Math.floor(at.getTime() / 1000);
    expect(sendRaw).toHaveBeenCalledWith('PROP', '#room', 'ocean.event', `${unix}|Launch party`);
    expect(evt()).toEqual({ at: unix, title: 'Launch party' });
  });

  it('/event command schedules; /event clear removes', () => {
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });
    store.getState().sendMessage('#room', `/event ${soonIso} Launch party`);
    expect(evt()?.title).toBe('Launch party');

    store.getState().sendMessage('#room', '/event clear');
    expect(sendRaw).toHaveBeenLastCalledWith('PROP', '#room', 'ocean.event', '');
    expect(evt()).toBeNull();
  });

  it('/event with a bad time toasts instead of scheduling', () => {
    store.getState().sendMessage('#room', '/event later today drinks');
    expect(evt()).toBeNull();
    expect(store.getState().toasts.some(t => t.title === 'Event not set')).toBe(true);
  });

  it('strips newlines and caps the title length', () => {
    const long = 'x'.repeat(300);
    store.getState().scheduleEvent('#room', soon, `a\nb ${long}`);
    const title = evt()!.title;
    expect(title.length).toBeLessThanOrEqual(180);
    expect(title).not.toContain('\n');
  });
});

describe('ephemeral room prop', () => {
  it('selectChannelEphemeralSeconds parses valid retention and treats 0 as off', () => {
    store.setState({ channelProps: new Map([['#room', { EPHEMERAL: '3600' }]]) });
    expect(selectChannelEphemeralSeconds('#room')(store.getState())).toBe(3600);

    store.setState({ channelProps: new Map([['#room', { EPHEMERAL: '0' }]]) });
    expect(selectChannelEphemeralSeconds('#room')(store.getState())).toBeNull();
  });

  it('rejects malformed or out-of-range retention values', () => {
    for (const raw of ['', 'nope', '5', '9999999999']) {
      store.setState({ channelProps: new Map([['#room', { EPHEMERAL: raw }]]) });
      expect(selectChannelEphemeralSeconds('#room')(store.getState())).toBeNull();
    }
  });

  it('setChannelEphemeral writes the EPHEMERAL prop and updates locally', () => {
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });

    store.getState().setChannelEphemeral('#room', 86_400);
    expect(sendRaw).toHaveBeenCalledWith('PROP', '#room', 'EPHEMERAL', '86400');
    expect(selectChannelEphemeralSeconds('#room')(store.getState())).toBe(86_400);

    store.getState().setChannelEphemeral('#room', 0);
    expect(sendRaw).toHaveBeenLastCalledWith('PROP', '#room', 'EPHEMERAL', '0');
    expect(selectChannelEphemeralSeconds('#room')(store.getState())).toBeNull();
  });
});
