// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.reply.test.ts — IRCv3 draft/reply coverage gaps.
 *
 * Covers:
 *   - outbound single-line PRIVMSG tagged with +draft/reply
 *   - replyingTo cleared after a successful send
 *   - inbound channel/DM reply tag resolution against a known parent
 *   - missing parent still preserves the reply id with empty preview fields
 *   - legacy CTCP REPLY fallback on plain channels
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

import { store, type DMConversation } from './store';

const initialState = store.getInitialState();

function mockClient(send = vi.fn(() => true), caps: string[] = []) {
  return {
    negotiatedCaps: new Set<string>(caps),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw: vi.fn(() => true),
    tagmsg: vi.fn(),
    send,
  } as never;
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

const chatMsg = (
  id: string,
  from: string,
  target: string,
  text = 'parent body',
): ChatMessage => ({
  id,
  time: new Date('2026-07-01T12:00:00.000Z'),
  from,
  text,
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
    {
      ...initialState,
      ourNick: 'me',
      connectionStatus: 'connected',
      client: mockClient(),
    },
    true,
  );
});

describe('outbound draft/reply', () => {
  it('tags a single-line channel send with +draft/reply and clears replyingTo', () => {
    const send = vi.fn(() => true);
    store.setState({
      client: mockClient(send),
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: new Map(),
          messages: [chatMsg('parent-1', 'alice', '#room', 'earlier')],
          unread: 0, highlights: 0, createdAt: null, modes: '',
        }],
      ]),
      activeView: { kind: 'channel', channel: '#room' },
    });
    store.getState().setReplyingTo(chatMsg('parent-1', 'alice', '#room', 'earlier'));

    store.getState().sendMessage('#room', 'got it');

    expect(send).toHaveBeenCalledWith('@+draft/reply=parent-1 PRIVMSG #room :got it\r\n');
    expect(store.getState().replyingTo).toBeNull();
    // Without echo-message the optimistic local row carries the reply snapshot.
    expect(store.getState().channels.get('#room')!.messages.at(-1)).toMatchObject({
      text: 'got it',
      replyTo: { id: 'parent-1', from: 'alice', text: 'earlier' },
    });
  });

  it('tags an outbound DM reply against the peer conversation', () => {
    const send = vi.fn(() => true);
    store.setState({
      client: mockClient(send),
      dms: new Map([['alice', dmWith('alice', [chatMsg('dm-parent', 'alice', 'alice', 'hey')])]]),
      activeView: { kind: 'dm', nick: 'alice' },
    });
    store.getState().setReplyingTo(chatMsg('dm-parent', 'alice', 'alice', 'hey'));

    store.getState().sendMessage('alice', 'replying in private');

    expect(send).toHaveBeenCalledWith('@+draft/reply=dm-parent PRIVMSG alice :replying in private\r\n');
    expect(store.getState().replyingTo).toBeNull();
    expect(store.getState().dms.get('alice')!.messages.at(-1)).toMatchObject({
      text: 'replying in private',
      replyTo: { id: 'dm-parent', from: 'alice', text: 'hey' },
    });
  });
});

describe('inbound draft/reply resolution', () => {
  it('resolves a channel reply parent from the live transcript', () => {
    store.setState({
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: new Map(),
          messages: [chatMsg('p1', 'alice', '#room', 'the parent')],
          unread: 0, highlights: 0, createdAt: null, modes: '',
        }],
      ]),
    });

    feed('@+draft/reply=p1;msgid=child-1 :bob!u@h PRIVMSG #room :the child');

    const child = store.getState().channels.get('#room')!.messages.find(m => m.id === 'child-1');
    expect(child).toMatchObject({
      text: 'the child',
      replyTo: { id: 'p1', from: 'alice', text: 'the parent' },
    });
  });

  it('keeps the reply id with empty preview when the parent is not in the buffer', () => {
    store.setState({
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: new Map(),
          messages: [],
          unread: 0, highlights: 0, createdAt: null, modes: '',
        }],
      ]),
    });

    feed('@+draft/reply=missing;msgid=orphan :bob!u@h PRIVMSG #room :dangling reply');

    const child = store.getState().channels.get('#room')!.messages.find(m => m.id === 'orphan');
    expect(child?.replyTo).toEqual({ id: 'missing', from: '', text: '' });
  });

  it('remaps an inbound DM reply onto the peer-keyed conversation', () => {
    store.setState({
      dms: new Map([['alice', dmWith('alice', [chatMsg('p-dm', 'me', 'alice', 'sent earlier')])]]),
    });

    // Wire target is OUR nick; conversation is keyed by peer "alice".
    feed('@+draft/reply=p-dm;msgid=c-dm :alice!u@h PRIVMSG me :and I answer');

    const child = store.getState().dms.get('alice')!.messages.find(m => m.id === 'c-dm');
    expect(child).toMatchObject({
      text: 'and I answer',
      replyTo: { id: 'p-dm', from: 'me', text: 'sent earlier' },
    });
    expect(store.getState().dms.has('me')).toBe(false);
  });

  it('parses the legacy CTCP REPLY fallback into replyTo + body text', () => {
    store.setState({
      channels: new Map([
        ['#room', {
          name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: new Map(),
          messages: [],
          unread: 0, highlights: 0, createdAt: null, modes: '',
        }],
      ]),
    });

    feed(':bob!u@h PRIVMSG #room :\u0001REPLY old-id alice|preview text\u0001 actual answer');

    const child = store.getState().channels.get('#room')!.messages.at(-1);
    expect(child?.text).toBe('actual answer');
    expect(child?.replyTo).toEqual({
      id: 'old-id',
      from: 'alice',
      text: 'preview text',
    });
  });
});
