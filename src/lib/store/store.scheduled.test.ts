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
import { store } from './store';
import {
  MAX_SCHEDULED_CHANNEL_LENGTH,
  MAX_SCHEDULED_MESSAGES,
  MAX_SCHEDULED_TEXT_LENGTH,
} from '@/lib/schedule/dispatch';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn(),
    send: vi.fn(),
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
  store.setState(initialState, true);
  store.setState({ server: server('alice'), ourNick: 'alice' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduleMessage', () => {
  it('queues an entry sorted by sendAt and persists it', () => {
    store.getState().scheduleMessage('#root', 'later', 5000);
    store.getState().scheduleMessage('#root', 'sooner', 1000);
    const q = store.getState().scheduledMessages;
    expect(q.map((m) => m.text)).toEqual(['sooner', 'later']);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(2);
  });

  it('keeps the in-memory queue usable when localStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });

    expect(() => store.getState().scheduleMessage('#root', 'still queued', 5_000)).not.toThrow();
    expect(store.getState().scheduledMessages).toHaveLength(1);
    expect(store.getState().scheduledMessages[0]?.text).toBe('still queued');
  });

  it('rejects malformed rows at the live state boundary', () => {
    store.getState().scheduleMessage('room with spaces', 'body', 5_000);
    store.getState().scheduleMessage(`#${'x'.repeat(MAX_SCHEDULED_CHANNEL_LENGTH)}`, 'body', 5_000);
    store.getState().scheduleMessage('#one,#two', 'body', 5_000);
    store.getState().scheduleMessage('#root', ' ', 5_000);
    store.getState().scheduleMessage('#root', 'x'.repeat(MAX_SCHEDULED_TEXT_LENGTH + 1), 5_000);
    store.getState().scheduleMessage('#root', 'body', Number.NaN);
    store.getState().scheduleMessage('#root', 'body', 1.5);
    store.getState().scheduleMessage('#root', 'body', -1);

    expect(store.getState().scheduledMessages).toEqual([]);
    expect(localStorage.getItem('onyx:scheduled')).toBeNull();
  });

  it('caps the live queue before persisting another row', () => {
    for (let index = 0; index < MAX_SCHEDULED_MESSAGES + 1; index += 1) {
      store.getState().scheduleMessage('#root', `message ${index}`, index + 1);
    }

    expect(store.getState().scheduledMessages).toHaveLength(MAX_SCHEDULED_MESSAGES);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(
      MAX_SCHEDULED_MESSAGES,
    );
    expect(store.getState().scheduledMessages.at(-1)?.text).toBe(
      `message ${MAX_SCHEDULED_MESSAGES - 1}`,
    );
  });
});

describe('_dispatchScheduledMessages', () => {
  it('sends a past-due entry via sendRaw and removes it', () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    store.getState().scheduleMessage('#root', 'hello', 5_000); // due
    store.getState().scheduleMessage('#root', 'wait', 50_000); // future

    store.getState()._dispatchScheduledMessages();

    // Only the due entry hit the wire.
    const privmsgs = client.sendRaw.mock.calls.filter((c) => c[0] === 'PRIVMSG');
    expect(privmsgs).toHaveLength(1);
    expect(privmsgs[0]![1]).toBe('#root');
    // Future entry survives; due entry is gone.
    const q = store.getState().scheduledMessages;
    expect(q.map((m) => m.text)).toEqual(['wait']);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(1);
  });

  it('holds a past-due entry while offline (does not drop it)', () => {
    store.setState({ client: null, connectionStatus: 'disconnected' });
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    store.getState().scheduleMessage('#root', 'hello', 5_000);

    store.getState()._dispatchScheduledMessages();

    expect(store.getState().scheduledMessages).toHaveLength(1);
  });

  it('is idempotent — a second tick never re-sends', () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    store.getState().scheduleMessage('#root', 'hello', 5_000);

    store.getState()._dispatchScheduledMessages();
    store.getState()._dispatchScheduledMessages();

    const privmsgs = client.sendRaw.mock.calls.filter((c) => c[0] === 'PRIVMSG');
    expect(privmsgs).toHaveLength(1);
    expect(store.getState().scheduledMessages).toHaveLength(0);
  });

  it('re-queues a due entry whose send throws, without losing its siblings', () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    // First send throws (racing failure), second must still go out.
    let call = 0;
    client.sendRaw.mockImplementation((cmd: string) => {
      if (cmd === 'PRIVMSG') {
        call += 1;
        if (call === 1) throw new Error('socket closed');
      }
    });
    store.getState().scheduleMessage('#bad', 'boom', 4_000);
    store.getState().scheduleMessage('#ok', 'lands', 5_000);

    store.getState()._dispatchScheduledMessages();

    // The failed entry survives for a later retry; the good one is gone.
    const q = store.getState().scheduledMessages;
    expect(q).toHaveLength(1);
    expect(q[0]!.channel).toBe('#bad');
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(1);
  });

  it('leaves the queue untouched when nothing is due', () => {
    const client = connect();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    store.getState().scheduleMessage('#root', 'future', 60_000);

    store.getState()._dispatchScheduledMessages();

    expect(client.sendRaw.mock.calls.filter((c) => c[0] === 'PRIVMSG')).toHaveLength(0);
    expect(store.getState().scheduledMessages).toHaveLength(1);
  });

  it('holds Alice messages while Bob is connected, then sends them as Alice', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    store.getState().scheduleMessage('#root', 'Alice only', 5_000);

    const bobClient = connect('bob');
    store.getState()._dispatchScheduledMessages();

    expect(bobClient.sendRaw.mock.calls.filter((call) => call[0] === 'PRIVMSG')).toEqual([]);
    expect(store.getState().scheduledMessages.map((message) => message.text)).toEqual(['Alice only']);

    const aliceClient = connect('alice');
    store.getState()._dispatchScheduledMessages();

    expect(aliceClient.sendRaw).toHaveBeenCalledWith('PRIVMSG', '#root', 'Alice only');
    expect(store.getState().scheduledMessages).toEqual([]);
  });
});

describe('cancelScheduledMessage', () => {
  it('removes the entry and re-persists', () => {
    store.getState().scheduleMessage('#root', 'a', 1000);
    store.getState().scheduleMessage('#root', 'b', 2000);
    const id = store.getState().scheduledMessages[0]!.id;
    store.getState().cancelScheduledMessage(id);
    const q = store.getState().scheduledMessages;
    expect(q).toHaveLength(1);
    expect(q[0]!.text).toBe('b');
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toHaveLength(1);
  });

  it('does not let Bob cancel Alice or ownerless legacy entries', () => {
    store.getState().scheduleMessage('#root', 'Alice only', 1000);
    const alice = store.getState().scheduledMessages[0]!;
    const legacy = { ...alice, id: 'legacy-ownerless', text: 'Legacy held', owner: null };
    store.setState({ scheduledMessages: [alice, legacy] });
    localStorage.setItem('onyx:scheduled', JSON.stringify([alice, legacy]));

    store.setState({ server: server('bob'), ourNick: 'bob' });
    store.getState().cancelScheduledMessage(alice.id);
    store.getState().cancelScheduledMessage(legacy.id);

    expect(store.getState().scheduledMessages).toEqual([alice, legacy]);
    expect(JSON.parse(localStorage.getItem('onyx:scheduled') || '[]')).toEqual([alice, legacy]);

    store.setState({ server: server('alice'), ourNick: 'alice' });
    store.getState().cancelScheduledMessage(alice.id);
    expect(store.getState().scheduledMessages).toEqual([legacy]);
  });
});
