// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.composerContext.test.ts — Era2 B3 polish: reply/edit mutual exclusivity
 * and target-scoped reply tagging on send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { store } from './store';

const initialState = store.getInitialState();

function mockClient(overrides: {
  sendRaw?: ReturnType<typeof vi.fn<(...args: string[]) => boolean>>;
  send?: ReturnType<typeof vi.fn<(...args: string[]) => boolean>>;
  caps?: string[];
} = {}) {
  const caps = new Set(overrides.caps ?? ['echo-message']);
  return {
    negotiatedCaps: caps,
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw: overrides.sendRaw ?? vi.fn((..._args: string[]) => true),
    send: overrides.send ?? vi.fn((..._args: string[]) => true),
    tagmsg: vi.fn(),
  } as never;
}

function textMsg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'from' | 'target'>): ChatMessage {
  return {
    text: 'hello',
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
    activeView: { kind: 'channel', channel: '#ops' },
  }, true);
});

describe('composer reply/edit mutual exclusivity', () => {
  it('clears an in-progress edit when a reply is armed', () => {
    const parent = textMsg({ id: 'p1', from: 'alice', target: '#ops' });
    const mine = textMsg({ id: 'm1', from: 'me', target: '#ops', text: 'edit me' });
    store.setState({
      channels: new Map([channel('#ops', [parent, mine])]),
      editingMessage: mine,
    });

    store.getState().setReplyingTo(parent);

    expect(store.getState().replyingTo).toMatchObject({ id: 'p1' });
    expect(store.getState().editingMessage).toBeNull();
  });

  it('clears an armed reply when an edit is started', () => {
    const parent = textMsg({ id: 'p1', from: 'alice', target: '#ops' });
    const mine = textMsg({ id: 'm1', from: 'me', target: '#ops', text: 'edit me' });
    store.setState({
      channels: new Map([channel('#ops', [parent, mine])]),
      replyingTo: parent,
    });

    store.getState().setComposerEditingMessage(mine);

    expect(store.getState().editingMessage).toMatchObject({ id: 'm1' });
    expect(store.getState().replyingTo).toBeNull();
  });

  it('clearing one context does not force-clear the other', () => {
    const parent = textMsg({ id: 'p1', from: 'alice', target: '#ops' });
    store.setState({ replyingTo: parent });
    store.getState().setReplyingTo(null);
    expect(store.getState().replyingTo).toBeNull();
    expect(store.getState().editingMessage).toBeNull();
  });
});

describe('target-scoped reply on send', () => {
  it('tags +draft/reply only when the armed parent matches the send target', () => {
    // Explicit generic keeps mock.calls as string[][] (not empty-tuple `[]`).
    const send = vi.fn<(...args: string[]) => boolean>(() => true);
    const parent = textMsg({ id: 'parent-ops', from: 'alice', target: '#ops', text: 'ops parent' });
    store.setState({
      client: mockClient({ send, caps: [] }),
      channels: new Map([
        channel('#ops', [parent]),
        channel('#general', []),
      ]),
      replyingTo: parent,
      activeView: { kind: 'channel', channel: '#ops' },
    });

    store.getState().sendMessage('#ops', 'child in ops');

    expect(send).toHaveBeenCalled();
    // `as string[][]` — vitest Mock call tuples can collapse to `[]` under some
    // inference paths even with an explicit vi.fn generic.
    const wire = String((send.mock.calls as string[][])[0]?.[0] ?? '');
    expect(wire).toContain('+draft/reply=parent-ops');
    expect(store.getState().replyingTo).toBeNull();
  });

  it('does not leak a #ops reply tag onto a #general send, and keeps the reply armed', () => {
    // Untagged sends go through sendRaw(PRIVMSG, …); tagged ones use send().
    const send = vi.fn<(...args: string[]) => boolean>(() => true);
    const sendRaw = vi.fn<(...args: string[]) => boolean>(() => true);
    const parent = textMsg({ id: 'parent-ops', from: 'alice', target: '#ops', text: 'ops parent' });
    store.setState({
      client: mockClient({ send, sendRaw, caps: [] }),
      channels: new Map([
        channel('#ops', [parent]),
        channel('#general', []),
      ]),
      replyingTo: parent,
      activeView: { kind: 'channel', channel: '#general' },
    });

    store.getState().sendMessage('#general', 'unrelated');

    // Mismatched target → plain PRIVMSG, never a tagged reply line.
    expect(send).not.toHaveBeenCalled();
    expect(sendRaw).toHaveBeenCalledWith('PRIVMSG', '#general', 'unrelated');
    // Mismatched send must leave the original reply armed for when the user
    // returns to #ops.
    expect(store.getState().replyingTo).toMatchObject({ id: 'parent-ops', target: '#ops' });
  });
});
