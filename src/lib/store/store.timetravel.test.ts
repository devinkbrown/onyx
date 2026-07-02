/**
 * store.timetravel.test.ts — the ?at= deep-link path (Roadmap Phase 1.2).
 *
 * travelTo() issues CHATHISTORY AROUND; when the answering chathistory batch
 * closes, the buffer must merge TIME-SORTED (AROUND windows land out of order
 * with the join replay), the message nearest the requested moment becomes
 * timeTravelLandingId, and the short batch must NOT mark history exhausted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from './store';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

const live = (id: string, time: string, text: string): ChatMessage => ({
  id,
  time: new Date(time),
  from: 'kain',
  text,
  type: 'msg',
  target: '#root',
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

function mockClient(sendRaw = vi.fn(), join = vi.fn()) {
  return {
    negotiatedCaps: new Set(['draft/chathistory']),
    capValues: new Map<string, string>(),
    isupport: {},
    prefixToMode: {},
    sendRaw,
    join,
    send: () => {},
  } as never;
}

beforeEach(() => {
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

  it('opens a vault hit in an unjoined channel by joining it', () => {
    const join = vi.fn();
    store.setState({ client: mockClient(vi.fn(), join) });
    store.getState().openVaultResult('#elsewhere', 'old-9');
    expect(join).toHaveBeenCalledWith('#elsewhere', undefined);
    expect(store.getState().timeTravelLandingId).toBe('old-9');
  });

  it('opens a vault DM hit, creating the conversation when missing', () => {
    store.getState().openVaultResult('trev', 'dm-1');
    expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'trev' });
    expect(store.getState().dms.has('trev')).toBe(true);
    expect(store.getState().timeTravelLandingId).toBe('dm-1');
  });

  it('does nothing without the chathistory cap', () => {
    const sendRaw = vi.fn();
    store.setState({
      client: {
        negotiatedCaps: new Set<string>(),
        capValues: new Map<string, string>(),
        isupport: {},
        prefixToMode: {},
        sendRaw,
        send: () => {},
      } as never,
    });

    store.getState().travelTo('#root', new Date('2026-06-30T12:00:00.000Z'));
    expect(sendRaw).not.toHaveBeenCalled();
  });
});
