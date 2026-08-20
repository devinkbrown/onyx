// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCKED_PLACEHOLDER,
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  deviceKeys,
  toB64url,
} from '@/lib/e2ee/dmCipher';
import { _resetVaultForTests } from '@/lib/vault/historyVault';
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
    text: `ONYXDM1 envelope-${id}`,
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

async function peerPublicKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return toB64url(raw);
}

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok() && Date.now() <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
  _resetVaultForTests();
  localStorage.clear();
  store.setState({
    ...initialState,
    ourNick: 'me',
    connectionStatus: 'connected',
    client: mockClient(),
    activeView: { kind: 'dm', nick: 'alice' },
    server: {
      id: 'reply-edit',
      name: 'Reply edit test',
      network: 'reply-edit',
      url: 'wss://reply-edit.example/ws',
      icon: 'R',
      nick: 'me',
      account: 'me',
      connected: true,
    },
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

  it('keeps active plaintext transient and snapshots an encrypted reply as a placeholder', async () => {
    await deviceKeys();
    const peerKey = await peerPublicKey();
    const parent = encryptedMessage('parent', 'alice', 'private parent');
    store.setState({
      dms: new Map([['alice', dm([parent])]]),
      peerDmKeys: new Map([['alice', peerKey]]),
    });
    store.getState().setReplyingTo(parent);

    store.getState().sendMessage('alice', 'private child');
    await until(() => (store.getState().dms.get('alice')?.messages.length ?? 0) === 2);

    const child = store.getState().dms.get('alice')!.messages.at(-1)!;
    expect(child.encrypted).toBe(true);
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
    feed(':alice!u@h PRIVMSG me :\u0001REPLY old alice|ONYXDM1 legacy-envelope\u0001 legacy child');

    const messages = store.getState().dms.get('alice')!.messages;
    expect(messages.at(-2)!.replyTo?.text).toBe(LOCKED_PLACEHOLDER);
    expect(messages.at(-1)!.replyTo?.text).toBe(LOCKED_PLACEHOLDER);
  });
});
