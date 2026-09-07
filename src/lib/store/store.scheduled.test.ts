// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.scheduled.test.ts
 *
 * Scheduled-message ("send later") dispatch. scheduleMessage queues; the
 * dispatcher sends past-due entries via the normal sendMessage path (which
 * calls client.sendRaw) and drops them. We mock the client to capture the raw
 * line and drive connectionStatus to exercise the offline hold + idempotency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { store, _resetScheduledDispatchForTests, _setScheduledDispatchTestHooksForTests, _setScheduledClaimValidationTestHookForTests } from './store';
import { _resetVaultForTests, cancelScheduledRow, claimScheduledRow, loadScheduledRows, settleScheduledClaim } from '@/lib/vault/historyVault';
import { parseIRCMessage } from '@/lib/irc/parser';
import {
  MAX_SCHEDULED_CHANNEL_LENGTH,
  MAX_SCHEDULED_MESSAGES,
  MAX_SCHEDULED_TEXT_LENGTH,
} from '@/lib/schedule/dispatch';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn<(command: string, ...params: string[]) => boolean>(() => true),
    send: vi.fn<(line: string) => boolean>(() => true),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    modeToPrefix: {} as Record<string, string>,
    prefixToMode: {} as Record<string, string>,
  };
}

function server(account: string | null) {
  return {
    id: `scheduled-${account ?? 'guest'}`,
    name: 'Onyx',
    network: 'Onyx',
    url: 'wss://example.test',
    icon: '',
    nick: account ?? 'guest',
    account,
    connected: true,
  };
}

/** Seed a connected session with a mock client. */
function connect(account: string | null = 'alice') {
  const client = makeClient();
  store.setState({
    client: client as never,
    connectionStatus: 'connected',
    ourNick: account ?? 'guest',
    server: server(account),
  });
  return client;
}

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  window.indexedDB = globalThis.indexedDB;
  _resetVaultForTests();
  _resetScheduledDispatchForTests();
  store.setState(initialState, true);
  store.setState({ server: server('alice'), ourNick: 'alice' });
});

afterEach(() => {
  _setScheduledDispatchTestHooksForTests(null);
  _setScheduledClaimValidationTestHookForTests(null);
  vi.restoreAllMocks();
});

describe('scheduleMessage', () => {
  it('queues an entry sorted by sendAt and persists it', async () => {
    await store.getState().scheduleMessage('#root', 'later', 5000);
    await store.getState().scheduleMessage('#root', 'sooner', 1000);
    const q = store.getState().scheduledMessages;
    expect(q.map((m) => m.text)).toEqual(['sooner', 'later']);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(2);
  });

  it('refuses required-room plaintext without persisting it', async () => {
    store.setState({
      channelProps: new Map([['#root', { 'encryption-policy': 'required' }]]),
    });

    expect(await store.getState().scheduleMessage('#root', 'never at rest', 5_000)).toBe(false);
    expect(store.getState().scheduledMessages).toEqual([]);
    expect(localStorage.getItem('onyx:scheduled')).toBeNull();
  });

  it('keeps the in-memory queue usable when localStorage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });

    await expect(store.getState().scheduleMessage('#root', 'still queued', 5_000)).resolves.toBe(true);
    expect(store.getState().scheduledMessages).toHaveLength(1);
    expect(store.getState().scheduledMessages[0]?.text).toBe('still queued');
  });

  it('rejects malformed rows at the live state boundary', async () => {
    await store.getState().scheduleMessage('room with spaces', 'body', 5_000);
    await store.getState().scheduleMessage(`#${'x'.repeat(MAX_SCHEDULED_CHANNEL_LENGTH)}`, 'body', 5_000);
    await store.getState().scheduleMessage('#one,#two', 'body', 5_000);
    await store.getState().scheduleMessage('#root', ' ', 5_000);
    await store.getState().scheduleMessage('#root', 'x'.repeat(MAX_SCHEDULED_TEXT_LENGTH + 1), 5_000);
    await store.getState().scheduleMessage('#root', 'body', Number.NaN);
    await store.getState().scheduleMessage('#root', 'body', 1.5);
    await store.getState().scheduleMessage('#root', 'body', -1);

    expect(store.getState().scheduledMessages).toEqual([]);
    expect(localStorage.getItem('onyx:scheduled')).toBeNull();
  });

  it('refuses a designated-E2EE DM without persisting its plaintext', async () => {
    // selectChannelEncryptionPolicy only reads channelProps, which a DM peer
    // never has an entry in, so the required-room guard above never catches
    // this. A DM must be checked against isDmE2eeDesignated the same way the
    // offline outbox already refuses it (sendMessage's isDm + isDmE2eeDesignated
    // gate) — never write ciphertext-only content to localStorage in the clear.
    store.setState({ peerDmKeys: new Map([['bob', 'device-key-a']]) });

    expect(await store.getState().scheduleMessage('bob', 'never at rest', 5_000)).toBe(false);
    expect(store.getState().scheduledMessages).toEqual([]);
    expect(localStorage.getItem('onyx:scheduled')).toBeNull();
  });

  it('still queues an ordinary (non-designated) DM', async () => {
    expect(await store.getState().scheduleMessage('bob', 'plain dm', 5_000)).toBe(true);
    expect(store.getState().scheduledMessages).toHaveLength(1);
    expect(store.getState().scheduledMessages[0]?.channel).toBe('bob');
  });

  it('purges only the outgoing account identity scheduled rows on an account switch', async () => {
    // _resetAccountPrivateMessageState fires on every account-owner change
    // (ACCOUNT, self NICK across owners, 900 RPL_LOGGEDIN). A scheduled row's
    // plaintext body sits in localStorage; the identity that is actually
    // logging out here must not leave it there indefinitely. A different,
    // currently-inactive owner's row is intentionally NOT touched —
    // selectOwnedScheduledMessages / _dispatchScheduledMessages already scope
    // visibility and dispatch by owner, so multiple accounts may legitimately
    // hold their own scheduled sends on one device at once.
    store.setState({ server: server('alice'), ourNick: 'alice' });
    await store.getState().scheduleMessage('#root', 'alice pending', 60_000);

    store.setState({ server: server('carol'), ourNick: 'carol' });
    await store.getState().scheduleMessage('#root', 'carol pending', 60_000);

    store.setState({ server: server('alice'), ourNick: 'alice' });
    expect(store.getState().scheduledMessages.map((m) => m.text).sort())
      .toEqual(['alice pending', 'carol pending']);

    // 900 RPL_LOGGEDIN establishing a different account on this connection is
    // the account-switch path that fires _resetAccountPrivateMessageState.
    store.getState()._handleMessage(
      parseIRCMessage(':example.test 900 bob bob!webchat@example bob :You are now logged in as bob'),
    );

    expect(store.getState().scheduledMessages.map((m) => m.text)).toEqual(['carol pending']);
    const persisted = JSON.parse(localStorage.getItem('onyx:scheduled') || '[]') as Array<{ text: string }>;
    expect(persisted.map((m) => m.text)).toEqual(['carol pending']);
  });

  it('caps the live queue before persisting another row', async () => {
    for (let index = 0; index < MAX_SCHEDULED_MESSAGES + 1; index += 1) {
      await store.getState().scheduleMessage('#root', `message ${index}`, index + 1);
    }

    expect(store.getState().scheduledMessages).toHaveLength(MAX_SCHEDULED_MESSAGES);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(
      MAX_SCHEDULED_MESSAGES,
    );
    expect(store.getState().scheduledMessages.at(-1)?.text).toBe(
      `message ${MAX_SCHEDULED_MESSAGES - 1}`,
    );
    expect(await loadScheduledRows()).toHaveLength(MAX_SCHEDULED_MESSAGES);
    expect(await store.getState().scheduleMessage('#root', 'hidden overflow', MAX_SCHEDULED_MESSAGES + 2_000)).toBe(false);
    expect(await loadScheduledRows()).toHaveLength(MAX_SCHEDULED_MESSAGES);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]').some((row: { text: string }) => row.text === 'hidden overflow')).toBe(false);
  });
});

describe('_dispatchScheduledMessages', () => {
  it('durably claims async admission and restores the row on rejection', async () => {
    connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let resolveAdmission!: (value: boolean) => void;
    const admission = new Promise<boolean>((resolve) => { resolveAdmission = resolve; });
    store.setState({
      sendMessage: vi.fn((_: string, __: string): Promise<boolean> => admission),
    });
    await store.getState().scheduleMessage('#root', 'async', 5_000);

    await store.getState()._dispatchScheduledMessages();
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')[0].claim).toBeDefined();
    expect(store.getState().scheduledMessages).toHaveLength(1);

    resolveAdmission(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().scheduledMessages[0]?.claim).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')[0].text).toBe('async');
  });

  it('does not let a stale admission completion remove a replacement claim', async () => {
    connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let resolveAdmission!: (value: boolean) => void;
    const admission = new Promise<boolean>((resolve) => { resolveAdmission = resolve; });
    store.setState({
      sendMessage: vi.fn((_: string, __: string): Promise<boolean> => admission),
    });
    await store.getState().scheduleMessage('#root', 'reload-safe', 5_000);
    await store.getState()._dispatchScheduledMessages();
    const claimed = store.getState().scheduledMessages[0]!;
    store.setState({ scheduledMessages: [{ ...claimed, claim: { token: 'replacement', claimedAt: 10_000 } }] });
    resolveAdmission(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().scheduledMessages[0]?.claim?.token).toBe('replacement');
  });

  it('does not resurrect a row canceled while admission is pending', async () => {
    connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let rejectAdmission!: (reason?: unknown) => void;
    const admission = new Promise<boolean>((_, reject) => { rejectAdmission = reject; });
    store.setState({ sendMessage: vi.fn(() => admission) });
    await store.getState().scheduleMessage('#root', 'cancel me', 5_000);
    await store.getState()._dispatchScheduledMessages();
    const id = store.getState().scheduledMessages[0]!.id;
    await store.getState().cancelScheduledMessage(id);
    rejectAdmission(new Error('closed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().scheduledMessages).toEqual([]);
  });

  it('does not replay an expired uncertain claim automatically', async () => {
    const client = connect();
    client.negotiatedCaps.add('labeled-response');
    vi.spyOn(Date, 'now').mockReturnValue(200_000);
    const row = { id: 'uncertain', channel: '#root', text: 'maybe sent', sendAt: 5_000, owner: { serverUrl: 'wss://example.test', identity: 'alice' }, claim: { token: 'old', claimedAt: 1_000 } };
    store.setState({ scheduledMessages: [row] });
    await store.getState()._dispatchScheduledMessages();
    expect(client.sendRaw).not.toHaveBeenCalledWith('PRIVMSG', '#root', 'maybe sent');
    expect(store.getState().scheduledMessages[0]?.claim?.token).toBe('old');
  });

  it('does not admit an Alice claim after the active owner switches to Bob', async () => {
    const client = connect('alice');
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'alice only', 5_000);
    const dispatch = store.getState()._dispatchScheduledMessages();
    store.setState({ server: server('bob'), ourNick: 'bob', client: null, connectionStatus: 'disconnected' });
    await dispatch;
    expect(client.sendRaw.mock.calls.filter((call) => call[0] === 'PRIVMSG')).toHaveLength(0);
  });

  it('does not deliver two Alice rows through Bob across abandoned settlement', async () => {
    const alice = connect('alice');
    const bob = makeClient();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'alice one', 5_000);
    await store.getState().scheduleMessage('#root', 'alice two', 5_000);
    const abandonedId = store.getState().scheduledMessages.find((row) => row.text === 'alice one')!.id;
    const survivingId = store.getState().scheduledMessages.find((row) => row.text === 'alice two')!.id;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    _setScheduledClaimValidationTestHookForTests(async () => {
      const rows = store.getState().scheduledMessages;
      const remaining = rows.filter((row) => row.text !== 'alice one');
      store.setState({ scheduledMessages: remaining });
      localStorage.setItem('onyx:scheduled', JSON.stringify(remaining));
      await Promise.resolve();
    });
    _setScheduledDispatchTestHooksForTests(async () => {
      store.setState({
        client: bob as never,
        server: server('bob'),
        ourNick: 'bob',
      });
      await paused;
    });
    const dispatch = store.getState()._dispatchScheduledMessages();
    await Promise.resolve();
    release();
    await dispatch;
    expect(alice.sendRaw.mock.calls.filter((call) => call[0] === 'PRIVMSG')).toHaveLength(0);
    expect(bob.sendRaw.mock.calls.filter((call) => call[0] === 'PRIVMSG')).toHaveLength(0);
    expect(store.getState().scheduledMessages.map((row) => row.text)).toEqual(['alice two']);
    expect(store.getState().scheduledMessages[0]?.claim).toBeUndefined();
    const durableSurvivor = (await loadScheduledRows()).find((row) => row.id === survivingId);
    expect(durableSurvivor?.claim).toBeUndefined();
    const reclaimed = await claimScheduledRow(
      survivingId,
      { serverUrl: 'wss://example.test', identity: 'alice' },
      'reclaimed-after-bob',
      10_001,
    );
    expect(reclaimed?.claim?.token).toBe('reclaimed-after-bob');
    await expect(settleScheduledClaim(
      survivingId,
      { serverUrl: 'wss://example.test', identity: 'alice' },
      'reclaimed-after-bob',
      false,
    )).resolves.toBe(true);
    await cancelScheduledRow(abandonedId, { serverUrl: 'wss://example.test', identity: 'alice' });

  });

  it('keeps a thrown admission uncertain and never replays it', async () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'maybe sent', 5_000);
    client.sendRaw.mockImplementation((command: string) => {
      if (command === 'PRIVMSG') throw new Error('socket closed after write');
      return true;
    });

    await store.getState()._dispatchScheduledMessages();
    expect(store.getState().scheduledMessages[0]?.claim).toBeDefined();
    expect(store.getState().toasts.some((toast) => toast.title === 'Scheduled admission uncertain')).toBe(true);
    await store.getState()._dispatchScheduledMessages();
    expect(client.sendRaw.mock.calls.filter((call) => call[0] === 'PRIVMSG')).toHaveLength(1);
  });

  it('keeps a durably scheduled row visible when localStorage projection fails', async () => {
    connect();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(store.getState().scheduleMessage('#root', 'not saved', 5_000)).resolves.toBe(true);
    expect(store.getState().scheduledMessages).toHaveLength(1);
    expect(store.getState().scheduledMessages[0]?.text).toBe('not saved');
    expect(store.getState().scheduledProjectionDegraded).toBe(true);
  });

  it('sends a past-due entry via sendRaw and removes it', async () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'hello', 5_000); // due
    await store.getState().scheduleMessage('#root', 'wait', 50_000); // future

    await store.getState()._dispatchScheduledMessages();

    // Only the due entry hit the wire.
    const privmsgs = client.sendRaw.mock.calls.filter((c) => c[0] === 'PRIVMSG');
    expect(privmsgs).toHaveLength(1);
    expect(privmsgs[0]![1]).toEqual(expect.objectContaining({ onUncertain: expect.any(Function) }));
    expect(privmsgs[0]![2]).toBe('#root');
    // Future entry survives; due entry is gone.
    const q = store.getState().scheduledMessages;
    expect(q.map((m) => m.text)).toEqual(['wait']);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(1);
  });

  it('holds a past-due entry while offline (does not drop it)', async () => {
    store.setState({ client: null, connectionStatus: 'disconnected' });
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'hello', 5_000);

    await store.getState()._dispatchScheduledMessages();

    expect(store.getState().scheduledMessages).toHaveLength(1);
  });

  it('holds legacy channel plaintext until current IRCX PROP sync proves policy', async () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'legacy pending', 5_000);
    store.setState({ isIRCX: true, channelPropsSynced: new Set() });

    await store.getState()._dispatchScheduledMessages();
    expect(client.sendRaw).not.toHaveBeenCalledWith('PRIVMSG', '#root', 'legacy pending');
    expect(store.getState().scheduledMessages).toHaveLength(1);

    store.setState({
      channelProps: new Map([['#root', { 'encryption-policy': 'required' }]]),
      channelPropsSynced: new Set(['#root']),
    });
    await store.getState()._dispatchScheduledMessages();
    expect(client.sendRaw).not.toHaveBeenCalledWith('PRIVMSG', '#root', 'legacy pending');
    expect(store.getState().scheduledMessages).toHaveLength(1);
  });

  it('dispatches a scheduled DM on an IRCX node even though channelPropsSynced never tracks DM peers', async () => {
    // channelPropsSynced is written only by the 819 RPL_PROPEND handler,
    // itself gated on isChan(propTarget) — a DM nick can never appear in it.
    // isIRCX is true on every Onyx node, so the prop-sync wait must be scoped
    // to CHANNEL targets only, or a scheduled DM sits "protected" forever.
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('bob', 'dm due', 5_000);
    store.setState({ isIRCX: true, channelPropsSynced: new Set() });

    await store.getState()._dispatchScheduledMessages();

    expect(client.sendRaw).toHaveBeenCalledWith('PRIVMSG', expect.objectContaining({ onUncertain: expect.any(Function) }), 'bob', 'dm due');
    expect(store.getState().scheduledMessages).toEqual([]);
  });

  it('is idempotent — a second tick never re-sends', async () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'hello', 5_000);

    await store.getState()._dispatchScheduledMessages();
    await store.getState()._dispatchScheduledMessages();

    const privmsgs = client.sendRaw.mock.calls.filter((c) => c[0] === 'PRIVMSG');
    expect(privmsgs).toHaveLength(1);
    expect(store.getState().scheduledMessages).toHaveLength(0);
  });

  it('re-queues a due entry whose send throws, without losing its siblings', async () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    // First send throws (racing failure), second must still go out.
    let throwNext = true;
    client.sendRaw.mockImplementation((cmd: string) => {
      if (cmd === 'PRIVMSG') {
        if (throwNext) { throwNext = false; throw new Error('socket closed'); }
      }
      return true;
    });
    await store.getState().scheduleMessage('#bad', 'boom', 4_000);
    await store.getState().scheduleMessage('#ok', 'lands', 5_000);

    await store.getState()._dispatchScheduledMessages();

    // The failed entry survives for a later retry; the good one is gone.
    const q = store.getState().scheduledMessages;
    // The sibling is admitted and removed; the throwing row remains as the
    // sole uncertain claimed recovery row rather than a clean retry duplicate.
    expect(q).toHaveLength(1);
    expect(q.find((row) => row.channel === '#bad')?.claim).toBeDefined();
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(1);
  });

  it('leaves the queue untouched when nothing is due', async () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await store.getState().scheduleMessage('#root', 'future', 60_000);

    await store.getState()._dispatchScheduledMessages();

    expect(client.sendRaw.mock.calls.filter((c) => c[0] === 'PRIVMSG')).toHaveLength(0);
    expect(store.getState().scheduledMessages).toHaveLength(1);
  });

  it('holds Alice messages while Bob is connected, then sends them as Alice', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await store.getState().scheduleMessage('#root', 'Alice only', 5_000);

    const bobClient = connect('bob');
    await store.getState()._dispatchScheduledMessages();

    expect(bobClient.sendRaw.mock.calls.filter((call) => call[0] === 'PRIVMSG')).toEqual([]);
    expect(store.getState().scheduledMessages.map((message) => message.text)).toEqual(['Alice only']);

    const aliceClient = connect('alice');
    await store.getState()._dispatchScheduledMessages();

    expect(aliceClient.sendRaw).toHaveBeenCalledWith('PRIVMSG', expect.objectContaining({ onUncertain: expect.any(Function) }), '#root', 'Alice only');
    expect(store.getState().scheduledMessages).toEqual([]);
  });
});

describe('cancelScheduledMessage', () => {
  it('removes the entry and re-persists', async () => {
    await store.getState().scheduleMessage('#root', 'a', 1000);
    await store.getState().scheduleMessage('#root', 'b', 2000);
    const id = store.getState().scheduledMessages[0]!.id;
    await store.getState().cancelScheduledMessage(id);
    const q = store.getState().scheduledMessages;
    expect(q).toHaveLength(1);
    expect(q[0]!.text).toBe('b');
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(1);
  });

  it('does not let Bob cancel Alice or ownerless legacy entries', async () => {
    await store.getState().scheduleMessage('#root', 'Alice only', 1000);
    const alice = store.getState().scheduledMessages[0]!;
    const legacy = { ...alice, id: 'legacy-ownerless', text: 'Legacy held', owner: null };
    store.setState({ scheduledMessages: [alice, legacy] });
    localStorage.setItem('onyx:scheduled', JSON.stringify([alice, legacy]));

    store.setState({ server: server('bob'), ourNick: 'bob' });
    await store.getState().cancelScheduledMessage(alice.id);
    await store.getState().cancelScheduledMessage(legacy.id);

    expect(store.getState().scheduledMessages).toEqual([alice, legacy]);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toEqual([alice, legacy]);

    store.setState({ server: server('alice'), ourNick: 'alice' });
    await store.getState().cancelScheduledMessage(alice.id);
    expect(store.getState().scheduledMessages).toEqual([legacy]);
  });
});
