// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCKED_PLACEHOLDER } from '@/lib/e2ee/dmCipher';
import type { ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { store, type DMConversation } from './store';

const initialState = store.getInitialState();

function mockClient(sendRaw = vi.fn(() => true)) {
  return {
    negotiatedCaps: new Set(['draft/message-editing']),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send: vi.fn(() => true),
    tagmsg: vi.fn(),
  } as never;
}

function encryptedMessage(
  id: string,
  from = 'me',
  plaintext: string | undefined = 'private parent',
): ChatMessage {
  return {
    id,
    from,
    text: `TSUMUGI1 envelope-${id}`,
    ...(plaintext === undefined ? {} : { plaintext }),
    encrypted: true,
    time: new Date('2026-07-16T10:00:00Z'),
    type: 'msg',
    target: 'alice',
  };
}

function dm(messages: ChatMessage[]): DMConversation {
  return {
    nick: 'alice',
    account: null,
    unread: 0,
    highlights: 0,
    messages,
  };
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

beforeEach(() => {
  store.setState({
    ...initialState,
    ourNick: 'me',
    connectionStatus: 'connected',
    client: mockClient(),
    activeView: { kind: 'dm', nick: 'alice' },
  }, true);
});

describe('E2EE reply and edit boundary', () => {
  it('rejects encrypted edit setup and action against the authoritative row', () => {
    const encrypted = encryptedMessage('encrypted-edit');
    store.setState({ dms: new Map([['alice', dm([encrypted])]]) });
    const spoofedPlain = { ...encrypted, text: 'spoofed plain', encrypted: false };

    store.getState().setComposerEditingMessage(spoofedPlain);
    store.getState().editMessage('alice', encrypted.id, 'replacement plaintext');

    expect(store.getState().editingMessage).toBeNull();
    expect(store.getState().client!.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().dms.get('alice')!.messages[0]).toEqual(encrypted);
  });

  it('ignores inbound command and tagged edits of encrypted rows', () => {
    const mine = encryptedMessage('mine');
    const theirs = encryptedMessage('theirs', 'alice');
    store.setState({ dms: new Map([['alice', dm([mine, theirs])]]) });

    feed(':me!u@h EDIT alice mine :replacement plaintext');
    feed('@+draft/edit=theirs :alice!u@h PRIVMSG me :replacement plaintext');

    expect(store.getState().dms.get('alice')!.messages).toEqual([mine, theirs]);
  });

  it('keeps active plaintext transient and snapshots an encrypted reply as a placeholder', () => {
    const parent = encryptedMessage('parent', 'alice', 'private parent');
    store.setState({ dms: new Map([['alice', dm([parent])]]) });
    store.getState().setReplyingTo(parent);

    store.getState().sendMessage('alice', 'public child');

    const child = store.getState().dms.get('alice')!.messages.at(-1)!;
    expect(child.replyTo).toEqual({
      id: parent.id,
      from: parent.from,
      text: LOCKED_PLACEHOLDER,
    });
    expect(JSON.stringify(child.replyTo)).not.toContain('private parent');
    expect(JSON.stringify(child.replyTo)).not.toContain(parent.text);
  });

  it('sanitizes referenced encrypted parents and legacy envelope previews on receive', () => {
    const parent = encryptedMessage('parent', 'alice');
    store.setState({ dms: new Map([['alice', dm([parent])]]) });

    feed('@+draft/reply=parent :alice!u@h PRIVMSG me :tagged child');
    feed(':alice!u@h PRIVMSG me :\u0001REPLY old alice|TSUMUGI1 legacy-envelope\u0001 legacy child');

    const messages = store.getState().dms.get('alice')!.messages;
    expect(messages.at(-2)!.replyTo?.text).toBe(LOCKED_PLACEHOLDER);
    expect(messages.at(-1)!.replyTo?.text).toBe(LOCKED_PLACEHOLDER);
  });
});
