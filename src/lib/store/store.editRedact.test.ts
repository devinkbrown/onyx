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
import { revisionsFor } from '@/lib/vault/editHistory';
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

function mockClientWithSend(sendRaw: ReturnType<typeof vi.fn>, caps: string[] = ['draft/message-redaction']) {
  return {
    negotiatedCaps: new Set(caps),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
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
      editHistory: {},
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
    expect(revisionsFor(store.getState().editHistory, 'm1').map((r) => r.body)).toEqual(['old body']);
  });

  it('stacks prior bodies across successive local edits', () => {
    const mine = textMsg({ id: 'm1', from: 'me', target: '#room', text: 'v1' });
    store.setState({
      channels: new Map([channel('#room', [mine])]),
      editHistory: {},
    });

    store.getState().editMessage('#room', 'm1', 'v2');
    store.getState().editMessage('#room', 'm1', 'v3');

    expect(store.getState().channels.get('#room')!.messages[0]!.text).toBe('v3');
    expect(revisionsFor(store.getState().editHistory, 'm1').map((r) => r.body)).toEqual(['v1', 'v2']);
  });

  it('refuses to edit someone else’s message', () => {
    const theirs = textMsg({ id: 'm1', from: 'alice', target: '#room' });
    store.setState({
      channels: new Map([channel('#room', [theirs])]),
      editHistory: {},
    });

    store.getState().editMessage('#room', 'm1', 'hijack');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]!.text).toBe('original');
    expect(store.getState().editHistory).toEqual({});
  });

  it('is a no-op without draft/message-editing', () => {
    store.setState({
      client: mockClient([]),
      channels: new Map([channel('#room', [textMsg({ id: 'm1', from: 'me', target: '#room' })])]),
      editHistory: {},
    });

    store.getState().editMessage('#room', 'm1', 'nope');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]!.edited).toBeUndefined();
    expect(store.getState().editHistory).toEqual({});
  });
});

describe('outbound REDACT', () => {
  it('sends REDACT and optimistically redacts our own row', () => {
    const mine = textMsg({ id: 'm1', from: 'me', target: '#room', text: 'delete me' });
    store.setState({
      channels: new Map([channel('#room', [mine])]),
    });
    const beforeChannels = store.getState().channels;

    store.getState().deleteMessage('#room', 'm1');

    expect(store.getState().client!.sendRaw).toHaveBeenCalledWith(
      'REDACT',
      '#room',
      'm1',
      'Deleted',
    );
    const redacted = store.getState().channels.get('#room')!.messages[0]!;
    expect(redacted).not.toBe(mine);
    expect(redacted).toMatchObject({
      id: 'm1',
      redacted: true,
      text: '[Message deleted]',
    });
    expect(store.getState().channels).not.toBe(beforeChannels);
  });

  it('does not hide a message locally when REDACT was not negotiated', () => {
    // Fail closed: a local-only hide would claim success while peers still see it.
    const mine = textMsg({ id: 'm1', from: 'me', target: '#room', text: 'x' });
    store.setState({
      client: mockClient([]),
      channels: new Map([channel('#room', [mine])]),
    });

    store.getState().deleteMessage('#room', 'm1');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages[0]).toBe(mine);
    expect(mine.redacted).toBeUndefined();
  });

  it('keeps the message visible when a stale-capability REDACT cannot reach the socket', () => {
    const sendRaw = vi.fn(() => false);
    const mine = textMsg({ id: 'm1', from: 'me', target: '#room', text: 'x' });
    store.setState({
      client: mockClientWithSend(sendRaw, ['draft/message-redaction']),
      channels: new Map([channel('#room', [mine])]),
    });

    store.getState().deleteMessage('#room', 'm1');

    expect(sendRaw).toHaveBeenCalledWith('REDACT', '#room', 'm1', 'Deleted');
    expect(store.getState().channels.get('#room')!.messages[0]).toBe(mine);
    expect(mine.redacted).toBeUndefined();
  });

  it('refuses to REDACT another author or a message still queued locally', () => {
    const peer = textMsg({ id: 'peer', from: 'alice', target: '#room', text: 'theirs' });
    const pending = textMsg({ id: 'pending', from: 'me', target: '#room', text: 'queued', pending: true });
    store.setState({
      channels: new Map([channel('#room', [peer, pending])]),
    });

    store.getState().deleteMessage('#room', 'peer');
    store.getState().deleteMessage('#room', 'pending');

    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().channels.get('#room')!.messages).toEqual([peer, pending]);
  });
});

