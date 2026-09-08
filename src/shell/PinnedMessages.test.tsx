// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import { store } from '@/lib/store/store';
import {
  derivePinIds,
  pinnedMessageDisplayText,
  pinnedMessageDisplayState,
  pinnedMessageStateLabel,
  PinnedMessages,
  sameStringArray,
} from './PinnedMessages';

const initialState = store.getInitialState();

function message(id: string, from: string, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    from,
    text,
    target: '#room',
    time: new Date('2026-07-09T03:00:00Z'),
    type: 'msg',
    ...overrides,
  };
}

function channel(messages: ChatMessage[]): Channel {
  return {
    name: '#room',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map([
      ['me', { nick: 'me', modes: new Set(['o']) }],
    ]),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages,
  };
}

function seedPins(): void {
  const messages = [
    message('m1', 'alice', 'Keep this near the top.'),
    message('m2', 'bob', 'Ops should read this before changing the topic.'),
  ];
  store.setState({
    ...initialState,
    showPinnedMessages: true,
    activeView: { kind: 'channel', channel: '#room' },
    ourNick: 'me',
    channels: new Map([['#room', channel(messages)]]),
    channelProps: new Map([['#room', { PINS: 'm1,m2' }]]),
  }, true);
}

describe('PinnedMessages accessibility', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a named pins dialog with a channel-specific list', () => {
    seedPins();
    render(() => <PinnedMessages />);

    expect(screen.getByRole('dialog', { name: 'Pinned messages' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pinned messages in #room' })).toBeInTheDocument();
    expect(screen.getByTestId('pins-context')).toHaveTextContent('Shared in #room');
    expect(screen.getByLabelText(/Pinned messages provenance: This server/i)).toBeInTheDocument();
    expect(screen.getByTestId('pins-channel-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23room',
    );
    expect(screen.getByRole('link', { name: 'Room ledger for #room' })).toHaveTextContent(
      'Room ledger',
    );
    expect(screen.getByRole('button', {
      name: 'Jump to pinned message from alice: Keep this near the top.',
    })).toBeInTheDocument();
  });

  it('omits the room ledger link outside hash/ampersand channels', () => {
    store.setState({
      ...initialState,
      showPinnedMessages: true,
      activeView: { kind: 'channel', channel: 'general' },
      channels: new Map([['general', channel([])]]),
    }, true);

    render(() => <PinnedMessages />);

    expect(screen.queryByTestId('pins-channel-ledger')).toBeNull();
  });

  it('exposes a real target-specific unpin action for ops', () => {
    seedPins();
    const unpin = vi.spyOn(store.getState(), 'unpinMessage');
    render(() => <PinnedMessages />);

    fireEvent.click(screen.getByRole('button', { name: 'Unpin message m1' }));

    expect(unpin).toHaveBeenCalledWith('#room', 'm1');
  });

  it('requests an unloaded pin by its exact msgid and keeps the drawer open when admission fails', () => {
    seedPins();
    store.setState({
      channels: new Map([['#room', channel([message('m1', 'alice', 'Keep this near the top.')])]]),
      channelProps: new Map([['#room', { PINS: 'm1,missing-1' }]]),
    });
    const request = vi.spyOn(store.getState(), 'requestPinnedMessage').mockReturnValue(false);
    render(() => <PinnedMessages />);

    fireEvent.click(screen.getByRole('button', { name: 'Load pinned message missing-1' }));

    expect(request).toHaveBeenCalledWith('#room', 'missing-1');
    expect(store.getState().showPinnedMessages).toBe(true);
    expect(screen.getByTestId('pins-load-feedback')).toHaveTextContent(
      'Pinned message could not be loaded from history. Try again.',
    );
  });

  it('uses safe deleted, redacted, locked, decrypted, and action previews everywhere', () => {
    const deletedText = 'withdrawn secret should never render';
    const redactedText = 'redacted secret should never render';
    const ciphertext = 'ONYXDM1 ciphertext must never render';
    const messages = [
      message('deleted', 'alice', deletedText, { deleted: true }),
      message('redacted', 'bob', redactedText, { redacted: true }),
      message('locked', 'carol', ciphertext, { encrypted: true }),
      message('decrypted', 'dana', ciphertext, { encrypted: true, plaintext: 'Readable plaintext' }),
      message('action', 'erin', ciphertext, { type: 'action', encrypted: true, plaintext: 'waves' }),
    ];
    store.setState({
      ...initialState,
      showPinnedMessages: true,
      activeView: { kind: 'channel', channel: '#room' },
      ourNick: 'me',
      channels: new Map([['#room', channel(messages)]]),
      channelProps: new Map([['#room', { PINS: messages.map((item) => item.id).join(',') }]]),
    }, true);

    render(() => <PinnedMessages />);

    expect(screen.getAllByText('[message deleted]')).toHaveLength(2);
    expect(screen.getByText('🔒 Encrypted message (sent to another device)')).toBeInTheDocument();
    expect(screen.getByText('Readable plaintext')).toBeInTheDocument();
    expect(screen.getByText('* erin waves')).toBeInTheDocument();
    expect(screen.getAllByText('Deleted')).toHaveLength(2);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getAllByText('Loaded locally')).toHaveLength(2);
    expect(screen.queryByText(deletedText)).toBeNull();
    expect(screen.queryByText(redactedText)).toBeNull();
    expect(screen.queryByText(ciphertext)).toBeNull();
    expect(screen.getByRole('button', { name: /alice.*\[message deleted\]/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bob.*\[message deleted\]/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /carol.*Encrypted message/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dana.*Readable plaintext/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /erin.*\* erin waves/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ciphertext) })).toBeNull();
  });

  it('distinguishes an unloaded pin from a withdrawn message', () => {
    const withdrawn = message('deleted', 'alice', 'withdrawn', { deleted: true });
    store.setState({
      ...initialState,
      showPinnedMessages: true,
      activeView: { kind: 'channel', channel: '#room' },
      channels: new Map([['#room', channel([withdrawn])]]),
      channelProps: new Map([['#room', { PINS: 'deleted,missing' }]]),
    }, true);

    render(() => <PinnedMessages />);

    expect(screen.getByText('[message deleted]')).toBeInTheDocument();
    expect(screen.getByText('Pinned message — load it from history to jump there.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load pinned message missing' })).toBeInTheDocument();
    expect(screen.queryByText(/missing.*deleted/i)).toBeNull();
  });
});

describe('PinnedMessages display rules', () => {
  it('matches the transcript precedence and never falls back to ciphertext', () => {
    const locked = message('locked', 'alice', 'ONYXDM1 opaque', { encrypted: true });
    const deleted = message('deleted', 'alice', 'private text', { deleted: true, encrypted: true, plaintext: 'also private' });
    const action = message('action', 'alice', 'ONYXDM1 opaque', { type: 'action', encrypted: true, plaintext: 'waves' });

    expect(pinnedMessageDisplayText(locked)).toBe('🔒 Encrypted message (sent to another device)');
    expect(pinnedMessageDisplayState(locked)).toBe('locked');
    expect(pinnedMessageDisplayText(deleted)).toBe('[message deleted]');
    expect(pinnedMessageDisplayState(deleted)).toBe('deleted');
    expect(pinnedMessageDisplayText(action)).toBe('* alice waves');
    expect(pinnedMessageDisplayText(action)).not.toContain('ONYXDM1');
    expect(pinnedMessageStateLabel(locked)).toBe('Locked');
    expect(pinnedMessageStateLabel(deleted)).toBe('Deleted');
    expect(pinnedMessageStateLabel(action)).toBe('Loaded locally');
  });
});

describe('PinnedMessages selector stability (perf)', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('derivePinIds always reallocates, but sameStringArray treats an unchanged PINS prop as equal', () => {
    seedPins();
    const before = derivePinIds(store.getState());
    // No pin-affecting change happened — an unrelated slice churns instead.
    store.setState({ typingUsers: new Map([['#other', new Map([['someone', Date.now()]])]]) });
    const after = derivePinIds(store.getState());

    // The raw selector has no memoization of its own — it re-splits the PINS
    // prop string every call, so it always hands back a fresh array...
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
    // ...which is exactly why the useStore(derivePinIds, sameStringArray)
    // equality gate matters: it recognizes the content hasn't changed, so the
    // signal `pinIds` observes keeps referring to its PREVIOUS array and
    // never produces a new identity for this write.
    expect(sameStringArray(before, after)).toBe(true);
  });

  it('keeps every pinned row DOM-node-identical across a store write that changes nothing pinned', () => {
    seedPins();
    render(() => <PinnedMessages />);

    const before = screen.getAllByRole('listitem');
    expect(before).toHaveLength(2);

    // An unrelated store write (a typing indicator elsewhere) must not tear
    // down and rebuild the pinned rows — <For> is now keyed by the stable
    // pin id itself, not a freshly-allocated {id, msg} row object.
    store.setState({ typingUsers: new Map([['#other', new Map([['someone', Date.now()]])]]) });

    const after = screen.getAllByRole('listitem');
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });
});
