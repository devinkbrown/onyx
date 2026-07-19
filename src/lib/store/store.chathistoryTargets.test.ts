// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CHATHISTORY TARGETS reconnect discovery.
 *
 * TARGETS is the only IRCv3 path that can reveal a DM conversation which saw
 * activity while this client was offline but does not yet exist in the local
 * store. The discovered target must become a bounded DM shell, fetch its latest
 * history, and project the recovered incoming rows into Home unread state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { ChatMessage } from '@/lib/irc/types';
import { buildCatchUp } from '@/lib/notifications/catchUp';
import {
  HISTORY_TARGET_DISCOVERY_MAX,
  MAX_LIVE_DM_CONVERSATIONS,
  OPEN_BATCH_COLLECTOR_MAX,
  _resetBatchCollectorsForTests,
  store,
  type DMConversation,
} from './store';

const initialState = store.getInitialState();

function message(id: string, time: string, from: string, text: string): ChatMessage {
  return {
    id,
    time: new Date(time),
    from,
    text,
    type: 'msg',
    target: 'mika',
  };
}

function mockClient() {
  return {
    negotiatedCaps: new Set(['batch', 'draft/chathistory', 'draft/read-marker']),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    sendRaw: vi.fn(() => true),
    send: vi.fn(() => true),
    updateResumeTokens: vi.fn(),
  } as never;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function targetBatch(ref: string, rows: readonly string[]): void {
  feed(`BATCH +${ref} draft/chathistory-targets`);
  for (const row of rows) feed(`:example.test CHATHISTORY TARGETS ${row}`);
  feed(`BATCH -${ref}`);
}

describe('CHATHISTORY TARGETS reconnect discovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'));
    _resetBatchCollectorsForTests();
    store.setState({
      ...initialState,
      client: mockClient(),
      ourNick: 'kain',
      activeView: { kind: 'home' },
    }, true);
  });

  afterEach(() => {
    _resetBatchCollectorsForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('requests a full Home discovery on first registration and a fuzzed gap on reconnect', () => {
    const client = store.getState().client!;

    feed(':example.test 001 kain :Welcome to Onyx');
    expect(client.sendRaw).toHaveBeenCalledWith(
      'CHATHISTORY',
      'TARGETS',
      'timestamp=1970-01-01T00:00:00.000Z',
      'timestamp=2026-07-19T12:00:10.000Z',
      String(HISTORY_TARGET_DISCOVERY_MAX),
    );

    targetBatch('first-targets', []);
    vi.setSystemTime(new Date('2026-07-19T12:05:00.000Z'));
    feed(':example.test 001 kain :Welcome back');

    expect(client.sendRaw).toHaveBeenCalledWith(
      'CHATHISTORY',
      'TARGETS',
      'timestamp=2026-07-19T11:59:50.000Z',
      'timestamp=2026-07-19T12:05:10.000Z',
      String(HISTORY_TARGET_DISCOVERY_MAX),
    );
  });

  it('does not advance the sweep boundary when the TARGETS batch cannot be admitted', () => {
    const client = store.getState().client!;
    for (let index = 0; index < OPEN_BATCH_COLLECTOR_MAX; index += 1) {
      feed(`BATCH +busy-${index} draft/multiline #room`);
    }

    feed(':example.test 001 kain :Welcome to Onyx');
    feed('BATCH +rejected draft/chathistory-targets');
    for (let index = 0; index < OPEN_BATCH_COLLECTOR_MAX; index += 1) {
      feed(`BATCH -busy-${index}`);
    }

    vi.setSystemTime(new Date('2026-07-19T12:05:00.000Z'));
    vi.mocked(client.sendRaw).mockClear();
    feed(':example.test 001 kain :Retry discovery');

    expect(client.sendRaw).toHaveBeenCalledWith(
      'CHATHISTORY',
      'TARGETS',
      'timestamp=1970-01-01T00:00:00.000Z',
      'timestamp=2026-07-19T12:05:10.000Z',
      String(HISTORY_TARGET_DISCOVERY_MAX),
    );
  });

  it('discovers a missed DM, fetches its history, and exposes unread state to Home', () => {
    const client = store.getState().client!;
    feed(':example.test 001 kain :Welcome to Onyx');
    vi.mocked(client.sendRaw).mockClear();

    targetBatch('targets', [
      'mika timestamp=2026-07-19T11:58:00.000Z',
      'MIKA timestamp=2026-07-19T11:59:00.000Z',
      '#not-joined timestamp=2026-07-19T11:59:30.000Z',
      'kain timestamp=2026-07-19T11:59:40.000Z',
      'bad,target timestamp=2026-07-19T11:59:50.000Z',
      'mallory timestamp=not-a-time',
    ]);

    const discovered = store.getState().dms.get('mika');
    expect(discovered).toMatchObject({
      nick: 'MIKA',
      unread: 0,
      highlights: 0,
      messages: [],
    });
    expect(discovered?.lastSeen?.toISOString()).toBe('2026-07-19T11:59:00.000Z');
    expect(store.getState().channels.has('#not-joined')).toBe(false);
    expect(store.getState().dms.has('kain')).toBe(false);
    expect(store.getState().dms.has('bad,target')).toBe(false);
    expect(store.getState().dms.has('mallory')).toBe(false);
    expect(client.sendRaw).toHaveBeenCalledWith('MARKREAD', 'MIKA');
    expect(client.sendRaw).toHaveBeenCalledWith('CHATHISTORY', 'LATEST', 'MIKA', '*', '50');

    feed('BATCH +mika-history chathistory MIKA');
    feed('@time=2026-07-19T11:58:30.000Z;msgid=missed-1 :mika!u@host PRIVMSG kain :while you were away');
    feed('@time=2026-07-19T11:58:45.000Z;msgid=own-1 :kain!u@host PRIVMSG MIKA :my prior reply');
    feed('BATCH -mika-history');

    const dm = store.getState().dms.get('mika')!;
    expect(dm.messages.map((row) => row.id)).toEqual(['missed-1', 'own-1']);
    expect(dm.unread).toBe(1);
    expect(dm.highlights).toBe(1);
    expect(store.getState().firstUnreadId.get('mika')).toBe('missed-1');
    expect(store.getState().historyLoading.get('mika')).toBe(false);
    expect(buildCatchUp([], store.getState().dms.values(), new Map()).map((item) => item.target))
      .toEqual(['MIKA']);
  });

  it('uses the known buffer tail, dedupes its fuzz overlap, and counts only new incoming rows', () => {
    const client = store.getState().client!;
    const old = message('old-1', '2026-07-19T11:50:00.000Z', 'mika', 'already here');
    store.setState({
      dms: new Map([['mika', {
        nick: 'mika',
        account: null,
        unread: 0,
        highlights: 0,
        messages: [old],
      }]]),
    });
    feed(':example.test 001 kain :Welcome to Onyx');
    vi.mocked(client.sendRaw).mockClear();

    targetBatch('targets', ['mika timestamp=2026-07-19T11:55:00.000Z']);
    expect(client.sendRaw).toHaveBeenCalledWith(
      'CHATHISTORY',
      'LATEST',
      'mika',
      'timestamp=2026-07-19T11:49:50.000Z',
      '50',
    );

    feed('BATCH +mika-history chathistory mika');
    feed('@time=2026-07-19T11:50:00.000Z;msgid=old-1 :mika!u@host PRIVMSG kain :already here');
    feed('@time=2026-07-19T11:55:00.000Z;msgid=new-1 :mika!u@host PRIVMSG kain :new missed row');
    feed('BATCH -mika-history');

    const dm = store.getState().dms.get('mika')!;
    expect(dm.messages.map((row) => row.id)).toEqual(['old-1', 'new-1']);
    expect(dm.unread).toBe(1);
    expect(store.getState().firstUnreadId.get('mika')).toBe('new-1');
  });

  it('lets a server read marker override provisional discovery unread state', () => {
    feed(':example.test 001 kain :Welcome to Onyx');
    targetBatch('targets', ['mika timestamp=2026-07-19T11:59:00.000Z']);
    feed(':example.test MARKREAD mika timestamp=2026-07-19T11:58:30.000Z');

    feed('BATCH +mika-history chathistory mika');
    feed('@time=2026-07-19T11:58:00.000Z;msgid=read-1 :mika!u@host PRIVMSG kain :already read');
    feed('@time=2026-07-19T11:59:00.000Z;msgid=unread-1 :mika!u@host PRIVMSG kain :still unread');
    feed('BATCH -mika-history');

    const dm = store.getState().dms.get('mika')!;
    expect(dm.unread).toBe(1);
    expect(dm.highlights).toBe(1);
    expect(store.getState().firstUnreadId.get('mika')).toBe('unread-1');
  });

  it('ignores unsolicited TARGETS batches and bounds an accepted reply', () => {
    targetBatch('unsolicited', ['mallory timestamp=2026-07-19T11:59:00.000Z']);
    expect(store.getState().dms.size).toBe(0);

    feed(':example.test 001 kain :Welcome to Onyx');
    const rows = Array.from(
      { length: HISTORY_TARGET_DISCOVERY_MAX + 8 },
      (_, index) => `peer-${index} timestamp=2026-07-19T11:59:${String(index % 60).padStart(2, '0')}.000Z`,
    );
    targetBatch('bounded', rows);

    expect(store.getState().dms.size).toBe(HISTORY_TARGET_DISCOVERY_MAX);
  });

  it('admits an offline first-contact DM by evicting the oldest read inactive shell', () => {
    const dms = new Map<string, DMConversation>();
    for (let index = 0; index < MAX_LIVE_DM_CONVERSATIONS; index += 1) {
      dms.set(`peer-${index}`, {
        nick: `peer-${index}`,
        account: null,
        unread: 0,
        highlights: 0,
        messages: [],
      });
    }
    store.setState({
      dms,
      firstUnreadId: new Map([['peer-0', 'stale-id']]),
    });
    feed(':example.test 001 kain :Welcome to Onyx');

    targetBatch('targets-at-capacity', [
      'mika timestamp=2026-07-19T11:59:00.000Z',
    ]);

    expect(store.getState().dms.size).toBe(MAX_LIVE_DM_CONVERSATIONS);
    expect(store.getState().dms.has('mika')).toBe(true);
    expect(store.getState().dms.has('peer-0')).toBe(false);
    expect(store.getState().firstUnreadId.has('peer-0')).toBe(false);
  });

  it('releases in-flight history loading ownership when the transport disconnects', () => {
    class FakeWebSocket {
      static readonly OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      binaryType = '';
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      send(): void {}
      close(): void {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);

    try {
      store.setState({ client: null });
      store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
      store.setState({
        autoReconnect: false,
        historyLoading: new Map([['mika', true]]),
      });
      const live = store.getState().client as unknown as {
        opts: { onDisconnected?: (reason: string) => void };
      };
      live.opts.onDisconnected?.('socket closed');

      expect(store.getState().historyLoading.size).toBe(0);
    } finally {
      store.getState().disconnect();
      vi.unstubAllGlobals();
    }
  });
});
