// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.editRedact.test.ts — Era2 B3 polish: outbound EDIT / REDACT wire +
 * optimistic local fold.
 *
 * Complements store.dmEditRedact.test.ts (inbound DM keying) and
 * store.e2eeReplyEdit.test.ts (encrypted fail-closed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { store } from './store';

const initialState = store.getInitialState();

function mockClient(caps: string[] = ['draft/message-editing', 'draft/message-redaction']) {
  return {
    negotiatedCaps: new Set(caps),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw: vi.fn(() => true),
    send: vi.fn(() => true),
    tagmsg: vi.fn(),
  } as never;
}

function textMsg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'from' | 'target'>): ChatMessage {
  return {
    text: 'original',
    time: new Date('2026-07-19T12:00:00Z'),
    type: 'msg',
    ...partial,
  };
}

function channel(name: string, messages: ChatMessage[]): [string, Channel] {
  return [name.toLowerCase(), {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    users: new Map(),
    modes: '',
    messages,
    unread: 0,
    highlights: 0,
    createdAt: null,
  }];
}

beforeEach(() => {
  store.setState({
    ...initialState,
    ourNick: 'me',
    connectionStatus: 'connected',
    client: mockClient(),
    activeView: { kind: 'channel', channel: '#room' },
  }, true);
});

describe('outbound EDIT', () => {
  it('sends EDIT and optimistically marks the local row edited', () => {
    const mine = textMsg({ id: 'm1', from: 'me', target: '#room', text: 'old body' });
    store.setState({
      channels: new Map([channel('#room', [mine])]),
    });

    store.getState().editMessage('#room', 'm1', 'new body');

    expect(store.getState().client!.sendRaw).toHaveBeenCalledWith(
      'EDIT',
      '#room',
      'm1',
      'new body',
    );
    expect(store.getState().channels.get('#room')!.messages[0]).toMatchObject({
      id: 'm1',
      text: 'new body',
      edited: true,
    });
  });

  it('refuses to edit someone else’s message', () => {
    const theirs = textMsg({ id: 'm1', from: 'alice', target: '#room' });
    store.setState({
      channels: new Map([channel('#room', [theirs])]),
    });

    store.getState().editMessage('#room', 'm1', 'hijack');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]!.text).toBe('original');
  });

  it('is a no-op without draft/message-editing', () => {
    store.setState({
      client: mockClient([]),
      channels: new Map([channel('#room', [textMsg({ id: 'm1', from: 'me', target: '#room' })])]),
    });

    store.getState().editMessage('#room', 'm1', 'nope');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]!.edited).toBeUndefined();
  });
});

describe('outbound REDACT', () => {
  it('sends REDACT and optimistically redacts our own row', () => {
    const mine = textMsg({ id: 'm1', from: 'me', target: '#room', text: 'delete me' });
    store.setState({
      channels: new Map([channel('#room', [mine])]),
    });

    store.getState().deleteMessage('#room', 'm1');

    expect(store.getState().client!.sendRaw).toHaveBeenCalledWith(
      'REDACT',
      '#room',
      'm1',
      'Deleted',
    );
    expect(store.getState().channels.get('#room')!.messages[0]).toMatchObject({
      id: 'm1',
      redacted: true,
      text: '[Message deleted]',
    });
  });

  it('still optimistically redacts locally when the cap is missing (local UX)', () => {
    // Wire is gated on the cap; local redaction of our own row still applies so
    // the menu Delete action is never a silent no-op on a plain server.
    store.setState({
      client: mockClient([]),
      channels: new Map([channel('#room', [textMsg({ id: 'm1', from: 'me', target: '#room', text: 'x' })])]),
    });

    store.getState().deleteMessage('#room', 'm1');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]!.redacted).toBe(true);
  });

  it('does not redact someone else’s message locally', () => {
    store.setState({
      channels: new Map([channel('#room', [textMsg({ id: 'm1', from: 'alice', target: '#room', text: 'theirs' })])]),
    });

    store.getState().deleteMessage('#room', 'm1');

    // Wire may still fire (server decides authority), but local fold only owns our rows.
    const row = store.getState().channels.get('#room')!.messages[0]!;
    expect(row.text).toBe('theirs');
    expect(row.redacted).toBeFalsy();
  });
});

