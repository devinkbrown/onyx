// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.dmEditRedact.test.ts — inbound REDACT / EDIT fold-back into DM state.
 *
 * The subtle case (same class as the reaction fold-back fix, different code
 * path): an inbound DM REDACT/EDIT command carries our OWN nick as the
 * `<target>` param (the peer redacts/edits a message THEY sent US, so the wire
 * target is the recipient — us), but the DM conversation is keyed by the PEER's
 * nick. Keying the fold-back on the raw target silently no-ops, so a peer's
 * delete/edit of a DM message never lands in our client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

import { store, type DMConversation } from './store';

const initialState = store.getInitialState();

function mockClient(sendRaw = vi.fn(), caps: string[] = []) {
  return {
    negotiatedCaps: new Set<string>(caps),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    tagmsg: vi.fn(),
    send: vi.fn(),
  } as never;
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

const chatMsg = (id: string, from: string, target: string, text = 'hello'): ChatMessage => ({
  id,
  time: new Date(0),
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
    { ...initialState, ourNick: 'me', connectionStatus: 'connected', client: mockClient() },
    true,
  );
});

describe('inbound REDACT fold-back — DM keying', () => {
  it('applies a peer REDACT to the peer-keyed DM (target param is our nick)', () => {
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'alice', 'me')])]]) });
    const beforeDms = store.getState().dms;

    // Wire: peer redacts their own DM msg → target is OUR nick, source is alice.
    feed(':alice!u@h REDACT me m1 :Deleted');

    const dm = store.getState().dms.get('alice')!;
    expect(dm.messages[0]!.redacted).toBe(true);
    expect(dm.messages[0]!.text).toBe('[Message deleted]');
    // Immutability: a fresh Map, not the seeded one.
    expect(store.getState().dms).not.toBe(beforeDms);
  });

  it('self-echo of our own REDACT still lands (target is the peer)', () => {
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'me', 'alice')])]]) });
    feed(':me!u@h REDACT alice m1 :Deleted');
    expect(store.getState().dms.get('alice')!.messages[0]!.redacted).toBe(true);
  });

  it('channel REDACT is unaffected by the DM remap', () => {
    store.setState({
      channels: new Map([
        ['#room', { name: '#room', topic: '', topicSetBy: '', topicSetAt: null, users: [], messages: [chatMsg('m1', 'bob', '#room')] } as never],
      ]),
    });
    feed(':bob!u@h REDACT #room m1 :Deleted');
    expect(store.getState().channels.get('#room')!.messages[0]!.redacted).toBe(true);
  });
});

describe('outbound REDACT authority', () => {
  it('does not hide an owned message locally when REDACT was not negotiated', () => {
    const sendRaw = vi.fn();
    const original = chatMsg('m1', 'me', 'alice');
    store.setState({
      client: mockClient(sendRaw),
      dms: new Map([['alice', dmWith('alice', [original])]]),
    });

    store.getState().deleteMessage('alice', 'm1');

    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().dms.get('alice')!.messages[0]).toBe(original);
    expect(original.redacted).toBeUndefined();
  });

  it('sends one REDACT and immutably marks our live message after negotiation', () => {
    const sendRaw = vi.fn(() => true);
    const original = chatMsg('m1', 'me', 'alice');
    store.setState({
      client: mockClient(sendRaw, ['draft/message-redaction']),
      dms: new Map([['alice', dmWith('alice', [original])]]),
    });
    const beforeDms = store.getState().dms;

    store.getState().deleteMessage('alice', 'm1');

    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(sendRaw).toHaveBeenCalledWith('REDACT', 'alice', 'm1', 'Deleted');
    const redacted = store.getState().dms.get('alice')!.messages[0]!;
    expect(redacted).not.toBe(original);
    expect(redacted).toMatchObject({ redacted: true, text: '[Message deleted]' });
    expect(store.getState().dms).not.toBe(beforeDms);
  });

  it('keeps the message visible when a stale-capability REDACT cannot reach the socket', () => {
    const sendRaw = vi.fn(() => false);
    const original = chatMsg('m1', 'me', 'alice');
    store.setState({
      client: mockClient(sendRaw, ['draft/message-redaction']),
      dms: new Map([['alice', dmWith('alice', [original])]]),
    });

    store.getState().deleteMessage('alice', 'm1');

    expect(sendRaw).toHaveBeenCalledWith('REDACT', 'alice', 'm1', 'Deleted');
    expect(store.getState().dms.get('alice')!.messages[0]).toBe(original);
    expect(original.redacted).toBeUndefined();
  });

  it('refuses to REDACT another author or a message still queued locally', () => {
    const sendRaw = vi.fn();
    const peerMessage = chatMsg('peer', 'alice', 'alice');
    const pendingMessage = { ...chatMsg('pending', 'me', 'alice'), pending: true };
    store.setState({
      client: mockClient(sendRaw, ['draft/message-redaction']),
      dms: new Map([['alice', dmWith('alice', [peerMessage, pendingMessage])]]),
    });

    store.getState().deleteMessage('alice', 'peer');
    store.getState().deleteMessage('alice', 'pending');

    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().dms.get('alice')!.messages).toEqual([peerMessage, pendingMessage]);
  });
});

describe('inbound EDIT fold-back — DM keying', () => {
  it('applies a peer EDIT to the peer-keyed DM (target param is our nick)', () => {
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'alice', 'me', 'typo')])]]) });

    feed(':alice!u@h EDIT me m1 :fixed');

    const dm = store.getState().dms.get('alice')!;
    expect(dm.messages[0]!.text).toBe('fixed');
    expect(dm.messages[0]!.edited).toBe(true);
  });

  it('self-echo of our own EDIT still lands (target is the peer)', () => {
    store.setState({ dms: new Map([['alice', dmWith('alice', [chatMsg('m1', 'me', 'alice', 'typo')])]]) });
    feed(':me!u@h EDIT alice m1 :fixed');
    expect(store.getState().dms.get('alice')!.messages[0]!.text).toBe('fixed');
  });
});
