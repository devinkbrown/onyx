// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.reactions.test.ts — emoji reactions (IRCv3 draft/react over TAGMSG).
 *
 * Covers the optimistic local toggle (addLocalReaction), and the fold-back in
 * _handleMessage that applies an inbound peer reaction. The DM case is the
 * subtle one: an inbound DM reaction TAGMSG carries our OWN nick as the target
 * param, but the conversation is keyed by the reacting peer's nick — the same
 * remap the typing-indicator and PRIVMSG handlers already do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

import { store, type DMConversation } from './store';

const initialState = store.getInitialState();

function mockClient(
  sendRaw = vi.fn(),
  caps: string[] = [],
  overrides: { tagmsg?: ReturnType<typeof vi.fn>; send?: ReturnType<typeof vi.fn> } = {},
) {
  return {
    negotiatedCaps: new Set<string>(caps),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    tagmsg: overrides.tagmsg ?? vi.fn(),
    send: overrides.send ?? vi.fn(() => true),
  } as never;
}

function mockClientWithCaps(
  caps: string[],
  overrides: { tagmsg?: ReturnType<typeof vi.fn>; send?: ReturnType<typeof vi.fn> } = {},
) {
  return mockClient(vi.fn(), caps, overrides);
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

const chatMsg = (id: string, from: string, target: string): ChatMessage => ({
  id,
  time: new Date(0),
  from,
  text: 'hello',
  type: 'msg',
  target,
});

const dmWith = (peer: string, messages: ChatMessage[]): DMConversation => ({
  nick: peer,
  account: null,
  unread: 0,
  highlights: 0,
  messages,
});

beforeEach(() => {
  store.setState(
    { ...initialState, ourNick: 'me', connectionStatus: 'connected', client: mockClient() },
    true,
  );
});

describe('addLocalReaction — optimistic toggle (immutable)', () => {
  it('adds our reaction to a channel message without mutating prior state', () => {
    const before = chatMsg('m1', 'bob', '#room');
    store.setState({
      channels: new Map([
        ['#room', { name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [], messages: [before] } as never],
      ]),
    });
    const beforeChannels = store.getState().channels;

    store.getState().addLocalReaction('#room', 'm1', '👍');

    const after = store.getState().channels.get('#room')!.messages[0]!;
    expect(after.reactions).toEqual([{ emoji: '👍', users: ['me'] }]);
    // Immutability: new Map, new message object, prior object untouched.
    expect(store.getState().channels).not.toBe(beforeChannels);
    expect(after).not.toBe(before);
    expect(before.reactions).toBeUndefined();
  });

  it('toggles our reaction back off (removes the emoji entry when empty)', () => {
    const msg = chatMsg('m1', 'bob', '#room');
    store.setState({
      channels: new Map([
        ['#room', { name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [], messages: [msg] } as never],
      ]),
    });
    store.getState().addLocalReaction('#room', 'm1', '👍');
    store.getState().addLocalReaction('#room', 'm1', '👍');
    expect(store.getState().channels.get('#room')!.messages[0]!.reactions).toEqual([]);
  });
});

describe('TAGMSG reaction fold-back — DM keying', () => {
  it('applies an inbound DM reaction to the peer-keyed conversation', () => {
    // DM with alice is keyed under "alice"; alice reacts to our message m1.
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'me', 'alice')])]]) });
    const beforeDms = store.getState().dms;

    // Inbound TAGMSG: target param is OUR nick, source is alice.
    feed('@+draft/react=👍;+draft/reply=m1 :alice!u@h TAGMSG me');

    const dm = store.getState().dms.get('alice')!;
    expect(dm.messages[0]!.reactions).toEqual([{ emoji: '👍', users: ['alice'] }]);
    // Immutability: a fresh Map, not the seeded one.
    expect(store.getState().dms).not.toBe(beforeDms);
  });

  it('applies an inbound reaction to a channel message', () => {
    store.setState({
      channels: new Map([
        ['#room', { name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [], messages: [chatMsg('m1', 'me', '#room')] } as never],
      ]),
    });
    feed('@+draft/react=🎉;+draft/reply=m1 :bob!u@h TAGMSG #room');
    expect(store.getState().channels.get('#room')!.messages[0]!.reactions)
      .toEqual([{ emoji: '🎉', users: ['bob'] }]);
  });

  it('does not double-count a repeated inbound reaction from the same peer', () => {
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'me', 'alice')])]]) });
    feed('@+draft/react=👍;+draft/reply=m1 :alice!u@h TAGMSG me');
    // A second identical TAGMSG is a toggle-off (alice already reacted).
    feed('@+draft/react=👍;+draft/reply=m1 :alice!u@h TAGMSG me');
    expect(store.getState().dms.get('alice')!.messages[0]!.reactions).toEqual([]);
  });

  it('appends a second peer onto an existing emoji without dropping the first', () => {
    store.setState({
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [],
          messages: [{
            ...chatMsg('m1', 'me', '#room'),
            reactions: [{ emoji: '👍', users: ['alice'] }],
          }],
        } as never],
      ]),
    });

    feed('@+draft/react=👍;+draft/reply=m1 :bob!u@h TAGMSG #room');

    expect(store.getState().channels.get('#room')!.messages[0]!.reactions)
      .toEqual([{ emoji: '👍', users: ['alice', 'bob'] }]);
  });
});

describe('addReaction — outbound draft/react TAGMSG', () => {
  function seedChannelMessage() {
    store.setState({
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [],
          messages: [chatMsg('m1', 'bob', '#room')],
        } as never],
      ]),
    });
  }

  it('sends TAGMSG with draft/react + draft/reply when the cap is negotiated', () => {
    const tagmsg = vi.fn();
    store.setState({
      client: mockClientWithCaps(['draft/react'], { tagmsg }),
    });
    seedChannelMessage();

    store.getState().addReaction('#room', 'm1', '🔥');

    expect(tagmsg).toHaveBeenCalledWith('#room', {
      '+draft/react': '🔥',
      '+draft/reply': 'm1',
    });
  });

  it('optimistically toggles locally when draft/react is present without echo-message', () => {
    const tagmsg = vi.fn();
    store.setState({
      client: mockClientWithCaps(['draft/react'], { tagmsg }),
    });
    seedChannelMessage();

    store.getState().addReaction('#room', 'm1', '🔥');

    expect(store.getState().channels.get('#room')!.messages[0]!.reactions)
      .toEqual([{ emoji: '🔥', users: ['me'] }]);
    expect(tagmsg).toHaveBeenCalledOnce();
  });

  it('defers the local toggle when echo-message will fold the TAGMSG back', () => {
    const tagmsg = vi.fn();
    store.setState({
      client: mockClientWithCaps(['draft/react', 'echo-message'], { tagmsg }),
    });
    seedChannelMessage();

    store.getState().addReaction('#room', 'm1', '🔥');

    // Wire fired; store waits for the server echo so we do not double-count.
    expect(tagmsg).toHaveBeenCalledWith('#room', {
      '+draft/react': '🔥',
      '+draft/reply': 'm1',
    });
    expect(store.getState().channels.get('#room')!.messages[0]!.reactions).toBeUndefined();
  });

  it('falls back to a local-only toggle when draft/react is not negotiated', () => {
    const tagmsg = vi.fn();
    store.setState({
      client: mockClientWithCaps([], { tagmsg }),
    });
    seedChannelMessage();

    store.getState().addReaction('#room', 'm1', '🎉');

    expect(tagmsg).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]!.reactions)
      .toEqual([{ emoji: '🎉', users: ['me'] }]);
  });

  it('optimistically reacts on a DM conversation key', () => {
    store.setState({
      client: mockClientWithCaps([]),
      dms: new Map([['alice', dmWith('alice', [chatMsg('dm1', 'alice', 'alice')])]]),
    });

    store.getState().addReaction('alice', 'dm1', '❤️');

    expect(store.getState().dms.get('alice')!.messages[0]!.reactions)
      .toEqual([{ emoji: '❤️', users: ['me'] }]);
  });
});

describe('removeReaction — peer removal preserves co-reactors', () => {
  it('drops only the named nick and keeps the emoji entry when others remain', () => {
    store.setState({
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [],
          messages: [{
            ...chatMsg('m1', 'me', '#room'),
            reactions: [{ emoji: '👍', users: ['alice', 'bob', 'carol'] }],
          }],
        } as never],
      ]),
    });
    const before = store.getState().channels.get('#room')!.messages[0]!;

    store.getState().removeReaction('#room', 'm1', '👍', 'bob');

    const after = store.getState().channels.get('#room')!.messages[0]!;
    expect(after.reactions).toEqual([{ emoji: '👍', users: ['alice', 'carol'] }]);
    expect(after).not.toBe(before);
    expect(before.reactions).toEqual([{ emoji: '👍', users: ['alice', 'bob', 'carol'] }]);
  });

  it('removes the emoji bucket entirely when the last reactor leaves', () => {
    store.setState({
      dms: new Map([['alice', dmWith('alice', [{
        ...chatMsg('m1', 'me', 'alice'),
        reactions: [{ emoji: '🎉', users: ['alice'] }],
      }])]]),
    });

    store.getState().removeReaction('alice', 'm1', '🎉', 'alice');

    expect(store.getState().dms.get('alice')!.messages[0]!.reactions).toEqual([]);
  });
});

describe('addLocalReaction — case-insensitive toggle', () => {
  it('removes our own reaction when ourNick casing differs from the stored nick', () => {
    store.setState({
      ourNick: 'Me',
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [],
          messages: [{
            ...chatMsg('m1', 'bob', '#room'),
            reactions: [{ emoji: '👍', users: ['me', 'alice'] }],
          }],
        } as never],
      ]),
    });

    store.getState().addLocalReaction('#room', 'm1', '👍');

    expect(store.getState().channels.get('#room')!.messages[0]!.reactions)
      .toEqual([{ emoji: '👍', users: ['alice'] }]);
  });
});

