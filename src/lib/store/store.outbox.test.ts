// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.outbox.test.ts — the offline outbox (Roadmap Phase 2).
 *
 * Composing while disconnected queues to the vault + shows a dimmed pending
 * placeholder; flushOutbox() (fired on reconnect) sends via the normal
 * sendMessage path, removes the placeholder, and prunes the queue. Channel
 * sends wait for the join; day-old entries expire instead of firing.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';
import { setPreference } from '@/lib/prefs/preferences';
import type { Channel } from '@/lib/irc/types';
import {
  OUTBOX_MAX_AGE_MS,
  _resetVaultForTests,
  loadOutbox,
  queueOutbox,
} from '@/lib/vault/historyVault';

const initialState = store.getInitialState();
const ALICE_OWNER = { serverUrl: 'wss://example.test', identity: 'alice' } as const;

const server = (account: string | null) => ({
  id: `outbox-${account ?? 'guest'}`,
  name: 'Onyx',
  network: 'Onyx',
  url: 'wss://example.test',
  icon: '',
  nick: account ?? 'guest',
  account,
  connected: true,
});

const channel = (name: string): Channel => ({
  name,
  topic: '',
  topicSetBy: '',
  topicSetAt: null,
  modes: '',
  users: new Map(),
  unread: 0,
  highlights: 0,
  createdAt: null,
  messages: [],
});

function mockClient(
  sendRaw: (...args: unknown[]) => boolean = vi.fn(() => true),
  send: (line: string) => boolean = vi.fn(() => true),
) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send,
  } as never;
}

function messagesFor(target: string) {
  const key = target.toLowerCase();
  return target.startsWith('#')
    ? store.getState().channels.get(key)?.messages ?? []
    : store.getState().dms.get(key)?.messages ?? [];
}

async function until(ok: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetVaultForTests();
  store.setState(
    {
      ...initialState,
      ourNick: 'me',
      server: server('alice'),
      connectionStatus: 'disconnected',
      client: null,
      channels: new Map([['#room', channel('#room')]]),
    },
    true,
  );
});

describe('offline outbox', () => {
  it('queues a message composed while disconnected and shows a pending placeholder', async () => {
    store.getState().sendMessage('#room', 'written in the dark');

    await until(async () => (await loadOutbox()).length === 1);
    const [entry] = await loadOutbox();
    expect(entry!.target).toBe('#room');
    expect(entry!.text).toBe('written in the dark');

    await until(() => (store.getState().channels.get('#room')?.messages.length ?? 0) === 1);
    const placeholder = store.getState().channels.get('#room')!.messages[0]!;
    expect(placeholder.pending).toBe(true);
    expect(placeholder.id).toBe(`outbox:${entry!.id}`);
    expect(placeholder.text).toBe('written in the dark');
  });

  it('never queues slash commands', async () => {
    store.getState().sendMessage('#room', '/topic something');
    await new Promise((r) => setTimeout(r, 50));
    expect(await loadOutbox()).toEqual([]);
  });

  it('flushOutbox sends queued messages, removes placeholders and prunes the queue', async () => {
    store.getState().sendMessage('#room', 'delayed hello');
    await until(async () => (await loadOutbox()).length === 1);
    await until(() => (store.getState().channels.get('#room')?.messages.length ?? 0) === 1);

    const sendRaw = vi.fn(() => true);
    store.setState({ connectionStatus: 'connected', client: mockClient(sendRaw) });
    store.getState().flushOutbox();

    await until(async () => (await loadOutbox()).length === 0);
    expect(sendRaw).toHaveBeenCalledWith('PRIVMSG', '#room', 'delayed hello');
    // Placeholder gone; the no-echo local append replaced it.
    const msgs = store.getState().channels.get('#room')!.messages;
    expect(msgs.some((m) => m.pending)).toBe(false);
    expect(store.getState().toasts.some((t) => t.title.includes('sent'))).toBe(true);
  });

  it.each([
    ['channel', '#room', 'channel message held'],
    ['DM', 'bob', 'direct message held'],
    ['action', '#room', '\x01ACTION waits patiently\x01'],
  ])('keeps a queued %s and its exact placeholder when socket admission fails', async (_kind, target, text) => {
    store.getState().sendMessage(target, text);
    await until(async () => (await loadOutbox()).length === 1);
    await until(() => messagesFor(target).some((message) => message.pending));

    const [entryBefore] = await loadOutbox();
    const placeholderBefore = messagesFor(target).find((message) => message.pending);
    const sendRaw = vi.fn(() => false);
    store.setState({ connectionStatus: 'connected', client: mockClient(sendRaw) });

    store.getState().flushOutbox();
    await until(() => sendRaw.mock.calls.length > 0);

    expect(sendRaw).toHaveBeenCalledWith('PRIVMSG', target, text);
    expect(await loadOutbox()).toEqual([entryBefore]);
    expect(messagesFor(target)).toHaveLength(1);
    expect(messagesFor(target)[0]).toBe(placeholderBefore);
    expect(messagesFor(target)[0]?.pending).toBe(true);
    expect(store.getState().toasts.some((toast) => toast.title.includes('sent'))).toBe(false);
    // Still within auto-retry budget — not a terminal failure yet.
    expect(store.getState().outboxDeliveryFailed).toBe(false);
  });

  it('marks outboxDeliveryFailed and toasts when auto-retries are exhausted', async () => {
    store.getState().sendMessage('#room', 'stuck in outbox');
    await until(async () => (await loadOutbox()).length === 1);

    const sendRaw = vi.fn(() => false);
    store.setState({ connectionStatus: 'connected', client: mockClient(sendRaw) });

    // Exhaust the 5 auto-retries (plus the initial attempt = 6 flushes).
    for (let i = 0; i < 6; i += 1) {
      store.getState().flushOutbox();
      await until(() => sendRaw.mock.calls.length >= i + 1);
      // Allow the async flush body to settle before the next attempt.
      await new Promise((r) => setTimeout(r, 20));
    }

    await until(() => store.getState().outboxDeliveryFailed);
    expect(store.getState().outboxDeliveryFailed).toBe(true);
    expect(await loadOutbox()).toHaveLength(1);
    expect(store.getState().toasts.some((t) => t.title.includes('still waiting'))).toBe(true);
  });

  it('reopens a persisted queued send and restores its placeholder after reload', async () => {
    const entry = await queueOutbox('#reloaded', 'survived the reload', ALICE_OWNER);
    expect(entry).not.toBeNull();
    expect(store.getState().channels.has('#reloaded')).toBe(false);

    store.getState().openQueuedSend(entry!.id);

    await until(() => store.getState().channels.get('#reloaded')?.messages.length === 1);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#reloaded' });
    expect(store.getState().timeTravelLandingId).toBe(`outbox:${entry!.id}`);
    expect(store.getState().channels.get('#reloaded')?.messages[0]).toMatchObject({
      id: `outbox:${entry!.id}`,
      text: 'survived the reload',
      pending: true,
    });
  });

  it('explicitly discards a queued send and removes its pending placeholder', async () => {
    store.getState().sendMessage('#room', 'do not send this');
    await until(async () => (await loadOutbox()).length === 1);
    const [entry] = await loadOutbox();
    await until(() => store.getState().channels.get('#room')?.messages.some((message) => message.pending) ?? false);

    store.getState().discardQueuedSend(entry!.id);

    await until(async () => (await loadOutbox()).length === 0);
    await until(() => !(store.getState().channels.get('#room')?.messages.some((message) => message.pending) ?? false));
    expect(store.getState().channels.get('#room')?.messages).toEqual([]);
    expect(store.getState().toasts.some((toast) => toast.title === 'Queued message removed')).toBe(true);
  });

  it('holds channel messages until the channel is joined', async () => {
    store.getState().sendMessage('#elsewhere', 'waits for the join');
    await until(async () => (await loadOutbox()).length === 1);

    const sendRaw = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient(sendRaw) });
    store.getState().flushOutbox();

    await new Promise((r) => setTimeout(r, 100));
    expect(sendRaw).not.toHaveBeenCalled();
    expect((await loadOutbox()).length).toBe(1); // still queued for the retry
  });

  it('holds Alice rows while Bob is connected, then sends them as Alice', async () => {
    store.getState().sendMessage('#room', 'Alice only');
    await until(async () => (await loadOutbox()).length === 1);

    const bobSendRaw = vi.fn(() => true);
    store.setState({
      connectionStatus: 'connected',
      client: mockClient(bobSendRaw),
      ourNick: 'bob',
      server: server('bob'),
    });
    store.getState().flushOutbox();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bobSendRaw).not.toHaveBeenCalledWith('PRIVMSG', '#room', 'Alice only');
    expect(await loadOutbox()).toHaveLength(1);

    const aliceSendRaw = vi.fn(() => true);
    store.setState({
      client: mockClient(aliceSendRaw),
      ourNick: 'alice',
      server: server('alice'),
    });
    store.getState().flushOutbox();
    await until(async () => (await loadOutbox()).length === 0);

    expect(aliceSendRaw).toHaveBeenCalledWith('PRIVMSG', '#room', 'Alice only');
  });

  it('expires entries older than a day instead of sending them', async () => {
    const entry = await queueOutbox('#room', 'stale message', ALICE_OWNER);
    // Backdate it via a direct re-put of the same id.
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open('onyx-vault');
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').put({ ...entry, queued_at: Date.now() - OUTBOX_MAX_AGE_MS - 1000 });
      tx.oncomplete = res;
    });

    const sendRaw = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient(sendRaw) });
    store.getState().flushOutbox();

    await until(async () => (await loadOutbox()).length === 0);
    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().toasts.some((t) => t.title.includes('expired'))).toBe(true);
  });
});

describe('offline outbox — E2EE DMs never persist plaintext', () => {
  it('refuses to queue an E2EE DM while offline (no plaintext at rest) and errors', async () => {
    setPreference('e2eeDms', true);
    // Peer published a device key → this DM would be sealed on the online path.
    store.setState({ peerDmKeys: new Map([['trev', 'peer-device-key-b64']]) });

    store.getState().sendMessage('trev', 'the vault password is hunter2');

    // Give any async queueOutbox a chance to (wrongly) fire before asserting.
    await new Promise((r) => setTimeout(r, 50));

    // Nothing persisted — the plaintext never reached IndexedDB.
    expect(await loadOutbox()).toEqual([]);
    // And no pending placeholder was shown.
    expect(store.getState().dms.get('trev')?.messages ?? []).toEqual([]);
    // The user is told why, honestly.
    expect(store.getState().toasts.some((t) => t.title.includes("Can't queue encrypted DM"))).toBe(true);
  });

  it('still queues a plaintext DM to a peer with no device key', async () => {
    setPreference('e2eeDms', true);
    store.setState({ peerDmKeys: new Map() }); // no key → not an E2EE DM

    store.getState().sendMessage('bob', 'plain hello');

    await until(async () => (await loadOutbox()).length === 1);
    const [entry] = await loadOutbox();
    expect(entry!.target).toBe('bob');
    expect(entry!.text).toBe('plain hello');
  });

  it('still queues a plaintext DM when e2eeDms is off, even with a peer key', async () => {
    setPreference('e2eeDms', false);
    store.setState({ peerDmKeys: new Map([['trev', 'peer-device-key-b64']]) });

    store.getState().sendMessage('trev', 'e2ee disabled, plain send');

    await until(async () => (await loadOutbox()).length === 1);
    const [entry] = await loadOutbox();
    expect(entry!.target).toBe('trev');
    expect(entry!.text).toBe('e2ee disabled, plain send');
    setPreference('e2eeDms', true); // restore default for other suites
  });

  it('keeps a queued DM when a newly discovered E2EE key cannot be sealed', async () => {
    setPreference('e2eeDms', true);
    store.getState().sendMessage('trev', 'keep this secret queued');
    await until(async () => (await loadOutbox()).length === 1);
    await until(() => messagesFor('trev').some((message) => message.pending));

    const [entryBefore] = await loadOutbox();
    const placeholderBefore = messagesFor('trev').find((message) => message.pending);
    const send = vi.fn(() => true);
    store.setState({
      connectionStatus: 'connected',
      client: mockClient(vi.fn(() => true), send),
      // Invalid P-256 point: sealing resolves asynchronously as unavailable.
      peerDmKeys: new Map([['trev', 'AAAA']]),
    });

    store.getState().flushOutbox();
    await until(() => store.getState().toasts.some((toast) => toast.title === 'Encryption unavailable'));

    expect(send).not.toHaveBeenCalled();
    expect(await loadOutbox()).toEqual([entryBefore]);
    expect(messagesFor('trev')).toHaveLength(1);
    expect(messagesFor('trev')[0]).toBe(placeholderBefore);
    expect(messagesFor('trev')[0]?.pending).toBe(true);
    expect(store.getState().toasts.some((toast) => toast.title.includes('Queued message sent'))).toBe(false);
  });
});
