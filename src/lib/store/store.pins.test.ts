/**
 * store.pins.test.ts — shared pinned messages via the IRCX PINS channel prop.
 *
 * Pin/unpin rewrite the channel's PINS prop (a comma-separated msgid list) via
 * PROP SET and optimistically update local props; the selector parses it back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store, selectChannelPins } from './store';

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

const pins = () => selectChannelPins('#room')(store.getState());

beforeEach(() => {
  store.setState({ ...initialState, ourNick: 'me', connectionStatus: 'connected', client: mockClient() }, true);
});

describe('pinned messages (PINS prop)', () => {
  it('selectChannelPins parses the comma-separated msgid list', () => {
    store.setState({ channelProps: new Map([['#room', { PINS: 'a1,b2, c3 ' }]]) });
    expect(pins()).toEqual(['a1', 'b2', 'c3']);
  });

  it('pinMessage appends a msgid and writes PROP SET', () => {
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });
    store.getState().pinMessage('#room', 'msg1');
    expect(sendRaw).toHaveBeenCalledWith('PROP', '#room', 'PINS', 'msg1');
    expect(pins()).toEqual(['msg1']); // optimistic local update

    store.getState().pinMessage('#room', 'msg2');
    expect(sendRaw).toHaveBeenLastCalledWith('PROP', '#room', 'PINS', 'msg1,msg2');
    expect(pins()).toEqual(['msg1', 'msg2']);
  });

  it('does not duplicate an already-pinned message', () => {
    store.setState({ channelProps: new Map([['#room', { PINS: 'msg1' }]]) });
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });
    store.getState().pinMessage('#room', 'msg1');
    expect(sendRaw).not.toHaveBeenCalled();
    expect(pins()).toEqual(['msg1']);
  });

  it('unpinMessage removes a msgid; clearing the last one deletes the prop', () => {
    store.setState({ channelProps: new Map([['#room', { PINS: 'a,b' }]]) });
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });

    store.getState().unpinMessage('#room', 'a');
    expect(sendRaw).toHaveBeenCalledWith('PROP', '#room', 'PINS', 'b');
    expect(pins()).toEqual(['b']);

    store.getState().unpinMessage('#room', 'b');
    // Empty value → PROP delete; the local prop is dropped so the drawer clears.
    expect(sendRaw).toHaveBeenLastCalledWith('PROP', '#room', 'PINS', '');
    expect(pins()).toEqual([]);
    expect(store.getState().channelProps.get('#room')?.PINS).toBeUndefined();
  });

  it('caps the pin list at 50 (drops the oldest)', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `m${i}`);
    store.setState({ channelProps: new Map([['#room', { PINS: ids.join(',') }]]) });
    store.getState().pinMessage('#room', 'newest');
    const result = pins();
    expect(result.length).toBe(50);
    expect(result[result.length - 1]).toBe('newest');
    expect(result).not.toContain('m0'); // oldest dropped
  });
});
