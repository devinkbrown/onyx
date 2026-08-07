// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.pins.test.ts — shared pinned messages via the IRCX PINS channel prop.
 *
 * Pin/unpin rewrite the channel's PINS prop (a comma-separated msgid list) via
 * PROP SET and optimistically update local props; the selector parses it back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { selectChannelPins, store, _resetBatchCollectorsForTests } from './store';

const initialState = store.getInitialState();

function emptyChannel(name: string): Channel {
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
    messages: [],
  };
}

function mockClient(caps: readonly string[] = ['draft/chathistory'], sendRaw = vi.fn(() => true)) {
  return {
    sendRaw,
    client: {
      negotiatedCaps: new Set(caps),
      capValues: new Map<string, string>(),
      isupport: { CHANTYPES: '#&' },
      sendRaw,
      send: vi.fn(() => true),
      destroy: vi.fn(),
    } as never,
  };
}

const pins = () => selectChannelPins('#room')(store.getState());

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  _resetBatchCollectorsForTests();
  store.setState({
    ...initialState,
    ourNick: 'me',
    connectionStatus: 'connected',
    client: mockClient([], vi.fn()).client,
    channels: new Map([['#room', emptyChannel('#room')]]),
    activeView: { kind: 'channel', channel: '#room' },
  }, true);
});

afterEach(() => {
  _resetBatchCollectorsForTests();
  vi.restoreAllMocks();
});

describe('pinned messages (PINS prop)', () => {
  it('selectChannelPins parses the comma-separated msgid list', () => {
    store.setState({ channelProps: new Map([['#room', { PINS: 'a1,b2, c3 ' }]]) });
    expect(pins()).toEqual(['a1', 'b2', 'c3']);
  });

  it('pinMessage appends a msgid and writes PROP SET', () => {
    const sendRaw = vi.fn();
    store.setState({ client: mockClient([], sendRaw).client });
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
    store.setState({ client: mockClient([], sendRaw).client });
    store.getState().pinMessage('#room', 'msg1');
    expect(sendRaw).not.toHaveBeenCalled();
    expect(pins()).toEqual(['msg1']);
  });

  it('unpinMessage removes a msgid; clearing the last one deletes the prop', () => {
    store.setState({ channelProps: new Map([['#room', { PINS: 'a,b' }]]) });
    const sendRaw = vi.fn();
    store.setState({ client: mockClient([], sendRaw).client });

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

describe('requestPinnedMessage', () => {
  beforeEach(() => {
    store.setState({ client: mockClient().client });
  });

  it('requests AROUND by msgid and focuses the exact row only after batch close', () => {
    const transport = mockClient();
    store.setState({ client: transport.client });

    expect(store.getState().requestPinnedMessage('#room', 'pin-1')).toBe(true);
    expect(transport.sendRaw).toHaveBeenCalledWith(
      'CHATHISTORY', 'AROUND', '#room', 'msgid=pin-1', '50',
    );
    expect(store.getState().timeTravelLandingId).toBeNull();

    feed('BATCH +pin chathistory #room');
    feed('@time=2026-08-01T12:00:00.000Z;msgid=pin-1 :alice!u@host PRIVMSG #room :the pinned row');
    expect(store.getState().timeTravelLandingId).toBeNull();

    feed('BATCH -pin');

    expect(store.getState().channels.get('#room')?.messages.map((m) => m.id)).toEqual(['pin-1']);
    expect(store.getState().timeTravelLandingId).toBe('pin-1');
    expect(store.getState().historyLoading.get('#room')).toBe(false);
    expect(store.getState().historyExhausted.get('#room')).not.toBe(true);
  });

  it('fails closed without the cap or when the transport rejects the send', () => {
    const unsupported = mockClient([]);
    store.setState({ client: unsupported.client });
    expect(store.getState().requestPinnedMessage('#room', 'pin-1')).toBe(false);
    expect(unsupported.sendRaw).not.toHaveBeenCalled();

    const rejected = mockClient();
    rejected.sendRaw.mockReturnValue(false);
    store.setState({ client: rejected.client });
    expect(store.getState().requestPinnedMessage('#room', 'pin-2')).toBe(false);
    expect(store.getState().historyLoading.get('#room')).toBe(false);
    expect(store.getState().timeTravelLandingId).toBeNull();
  });

  it('clears a failed pin lookup without marking the channel history exhausted', () => {
    const { client } = mockClient();
    store.setState({ client });
    expect(store.getState().requestPinnedMessage('#room', 'missing-1')).toBe(true);

    feed(':server FAIL CHATHISTORY NO_SUCH_HISTORY #room :pin not retained');

    expect(store.getState().historyLoading.get('#room')).toBe(false);
    expect(store.getState().historyExhausted.get('#room')).not.toBe(true);
    expect(store.getState().timeTravelLandingId).toBeNull();
  });
});
