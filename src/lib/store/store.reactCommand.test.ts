// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.reactCommand.test.ts — the custom `REACT` verb fold-back in
 * _handleMessage (store.ts ~6463), distinct from the draft/react TAGMSG path.
 *
 * Wire form: `:nick!u@h REACT <target> :<msgid> <emoji>`.
 *
 * The subtle case is an inbound DM: the peer reacts to a message they sent us,
 * so the wire `<target>` is OUR OWN nick, but the DM is keyed by the PEER's
 * nick. Without the remap dms.get(ourNick) is undefined and the reaction
 * silently vanishes — the same wrong-peer-key class fixed for the reaction
 * TAGMSG fold-back (7427c47) and REDACT/EDIT (884c250).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

import { store, type DMConversation } from './store';

const initialState = store.getInitialState();

function mockClient(sendRaw = vi.fn()) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    tagmsg: vi.fn(),
    send: vi.fn(),
  } as never;
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

const seedChannel = (name: string, messages: ChatMessage[]) => {
  store.setState({
    channels: new Map([
      [name, { name, topic: '', topicSetBy: '', topicSetAt: null, users: [], messages } as never],
    ]),
  });
};

beforeEach(() => {
  store.setState(
    { ...initialState, ourNick: 'me', connectionStatus: 'connected', client: mockClient() },
    true,
  );
});

describe('REACT command fold-back — DM keying', () => {
  it('applies an inbound DM reaction to the peer-keyed conversation (the bug)', () => {
    // DM with alice keyed under "alice"; alice reacts to our message m1. The
    // wire target is OUR nick "me", not "alice".
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'me', 'alice')])]]) });
    const beforeDms = store.getState().dms;

    feed(':alice!u@h REACT me :m1 👍');

    const dm = store.getState().dms.get('alice')!;
    expect(dm.messages[0]!.reactions).toEqual([{ emoji: '👍', users: ['alice'] }]);
    // Immutability: a fresh Map, not the seeded one.
    expect(store.getState().dms).not.toBe(beforeDms);
    // Nothing leaked onto a bogus "me"-keyed DM.
    expect(store.getState().dms.has('me')).toBe(false);
  });

  it('toggles an inbound DM reaction back off when the peer re-reacts', () => {
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'me', 'alice')])]]) });

    feed(':alice!u@h REACT me :m1 👍');
    feed(':alice!u@h REACT me :m1 👍');

    expect(store.getState().dms.get('alice')!.messages[0]!.reactions).toEqual([]);
  });

  it('self-echo (target = peer) still lands on the peer-keyed DM', () => {
    // Our own REACT echoed back: source is us, target is the peer bob.
    store.setState({ dms: new Map([['bob', dmWith('bob', [chatMsg('m2', 'bob', 'bob')])]]) });

    feed(':me!u@h REACT bob :m2 🎉');

    expect(store.getState().dms.get('bob')!.messages[0]!.reactions)
      .toEqual([{ emoji: '🎉', users: ['me'] }]);
  });

  it('a channel reaction is unaffected by the remap', () => {
    seedChannel('#room', [chatMsg('m3', 'me', '#room')]);

    feed(':bob!u@h REACT #room :m3 🔥');

    expect(store.getState().channels.get('#room')!.messages[0]!.reactions)
      .toEqual([{ emoji: '🔥', users: ['bob'] }]);
  });
});
