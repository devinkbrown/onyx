// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.timetravel.test.ts — the ?at= deep-link path (Roadmap Phase 1.2).
 *
 * travelTo() issues CHATHISTORY AROUND; when the answering chathistory batch
 * closes, the buffer must merge TIME-SORTED (AROUND windows land out of order
 * with the join replay), the message nearest the requested moment becomes
 * timeTravelLandingId, and the short batch must NOT mark history exhausted.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from './store';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';
import { resetPreferences } from '@/lib/prefs/preferences';
import { _resetVaultForTests, saveMessages } from '@/lib/vault/historyVault';

const initialState = store.getInitialState();

const live = (id: string, time: string, text: string, target = '#root'): ChatMessage => ({
  id,
  time: new Date(time),
  from: 'kain',
  text,
  type: 'msg',
  target,
});

const channel = (name: string, messages: ChatMessage[]): Channel => ({
  name,
  topic: '',
  topicSetBy: '',
  topicSetAt: null,
  modes: '',
  users: new Map(),
  unread: 0,
  highlights: 0,
  createdAt: null,
  messages,
});

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));

async function waitForExpect(assertion: () => void, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  let lastError: unknown;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      if (Date.now() > deadline) throw lastError;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

function mockClient(sendRaw = vi.fn(), join = vi.fn(), caps: readonly string[] = ['draft/chathistory']) {
  return {
    negotiatedCaps: new Set(caps),
    capValues: new Map<string, string>(),
    isupport: {},
    prefixToMode: {},
    sendRaw,
    join,
    send: () => {},
  } as never;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetVaultForTests();
  resetPreferences();
  store.setState(
    {
      ...initialState,
      client: mockClient(),
      ourNick: 'me',
      channels: new Map([
        ['#root', channel('#root', [
          live('live-1', '2026-07-02T10:00:00.000Z', 'today one'),
          live('live-2', '2026-07-02T10:05:00.000Z', 'today two'),
        ])],
      ]),
    },
    true,
  );
});

describe('travelTo', () => {
  it('sends CHATHISTORY AROUND with an ISO timestamp', () => {
    const sendRaw = vi.fn();
    store.setState({ client: mockClient(sendRaw) });
    const at = new Date('2026-06-30T12:00:00.000Z');

    store.getState().travelTo('#root', at);

    expect(sendRaw).toHaveBeenCalledWith(
      'CHATHISTORY', 'AROUND', '#root', 'timestamp=2026-06-30T12:00:00.000Z', '50',
    );
    // Consume the pending travel so it can't leak into other tests.
    feed('BATCH +tt chathistory #root');
    feed('BATCH -tt');
  });

  it('merges the AROUND batch time-sorted and lands on the nearest message', () => {
    const at = new Date('2026-06-30T12:00:00.000Z');
    store.getState().travelTo('#root', at);

    feed('BATCH +t1 chathistory #root');
    // Deliberately fed newest-first: the merge must restore chronology.
    feed('@time=2026-06-30T12:03:00.000Z;msgid=old-3 :kain!k@h PRIVMSG #root :past three');
    feed('@time=2026-06-30T11:57:00.000Z;msgid=old-1 :kain!k@h PRIVMSG #root :past one');
    feed('@time=2026-06-30T12:01:00.000Z;msgid=old-2 :kain!k@h PRIVMSG #root :past two');
    feed('BATCH -t1');

    const buf = store.getState().channels.get('#root')!.messages;
    expect(buf.map((m) => m.id)).toEqual(['old-1', 'old-2', 'old-3', 'live-1', 'live-2']);
    // 12:01 is 1 min from the requested moment; 11:57 is 3 min; 12:03 is 3 min.
    expect(store.getState().timeTravelLandingId).toBe('old-2');
    // A 3-message AROUND answer says nothing about the top of history.
    expect(store.getState().historyExhausted.get('#root')).not.toBe(true);

    store.getState().clearTimeTravelLanding();
    expect(store.getState().timeTravelLandingId).toBeNull();
  });

  it('preserves an explicitly selected archived message through AROUND hydration', () => {
    const at = new Date('2026-06-30T12:00:00.000Z');
    store.getState().travelTo('#root', at, 'old-same-time-b');

    feed('BATCH +selected chathistory #root');
    feed('@time=2026-06-30T12:00:00.000Z;msgid=old-same-time-a :kain!k@h PRIVMSG #root :first at moment');
    feed('@time=2026-06-30T12:00:00.000Z;msgid=old-same-time-b :mira!m@h PRIVMSG #root :selected at moment');
    feed('BATCH -selected');

    expect(store.getState().timeTravelLandingId).toBe('old-same-time-b');
  });

  it('ignores chathistory batches for other targets', () => {
    store.setState({
      channels: new Map([
        ...store.getState().channels,
        ['#other', channel('#other', [])],
      ]),
    });
    store.getState().travelTo('#root', new Date('2026-06-30T12:00:00.000Z'));

    feed('BATCH +t2 chathistory #other');
    feed('@time=2026-06-30T12:00:30.000Z;msgid=other-1 :kain!k@h PRIVMSG #other :elsewhere');
    feed('BATCH -t2');

    expect(store.getState().timeTravelLandingId).toBeNull();
    // #other's short batch keeps its normal exhausted bookkeeping.
    expect(store.getState().historyExhausted.get('#other')).toBe(true);

    // Consume the still-pending travel for test isolation.
    feed('BATCH +t3 chathistory #root');
    feed('BATCH -t3');
  });

  it('opens a vault hit in a joined channel: navigate + landing id', () => {
    store.getState().openVaultResult('#root', 'live-1');
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
    expect(store.getState().timeTravelLandingId).toBe('live-1');
  });

  it('opens a vault hit in an unjoined channel immediately and hydrates it', async () => {
    const join = vi.fn();
    await saveMessages('#elsewhere', [
      live('old-9', '2026-06-30T12:00:00.000Z', 'saved elsewhere', '#elsewhere'),
    ]);
    store.setState({ client: mockClient(vi.fn(), join) });
    store.getState().openVaultResult('#elsewhere', 'old-9');
    expect(join).toHaveBeenCalledWith('#elsewhere', undefined);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#elsewhere' });
    expect(store.getState().timeTravelLandingId).toBe('old-9');
    await waitForExpect(() => {
      expect(store.getState().channels.get('#elsewhere')?.messages.map((m) => m.id)).toContain('old-9');
    });
  });

  it('opens a vault DM hit, creating the conversation when missing', () => {
    store.getState().openVaultResult('trev', 'dm-1');
    expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'trev' });
    expect(store.getState().dms.has('trev')).toBe(true);
    expect(store.getState().timeTravelLandingId).toBe('dm-1');
  });

  it('hydrates from the local vault without the chathistory cap', async () => {
    const sendRaw = vi.fn();
    await saveMessages('#root', [
      live('old-1', '2026-06-30T11:50:00.000Z', 'past one'),
      live('old-2', '2026-06-30T12:01:00.000Z', 'past two'),
      live('old-3', '2026-06-30T12:08:00.000Z', 'past three'),
    ]);
    store.setState({ client: mockClient(sendRaw, vi.fn(), []) });

    store.getState().travelTo('#root', new Date('2026-06-30T12:00:00.000Z'));
    expect(sendRaw).not.toHaveBeenCalled();
    await waitForExpect(() => {
      expect(store.getState().channels.get('#root')!.messages.map((m) => m.id)).toEqual([
        'old-1',
        'old-2',
        'old-3',
        'live-1',
        'live-2',
      ]);
      expect(store.getState().timeTravelLandingId).toBe('old-2');
    });
  });
});
