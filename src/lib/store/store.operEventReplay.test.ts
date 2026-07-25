// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseIRCMessage } from '@/lib/irc/parser';
import { emptyEventReplayFeed } from '@/lib/irc/eventReplayJson';
import { store } from './store';

const initial = store.getInitialState();

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  store.setState(initial, true);
});

describe('store oper EVENT REPLAY JSON', () => {
  it('requestOperEventReplay sends structured params when oper+connected', () => {
    const sendRaw = vi.fn();
    store.setState({
      isOper: true,
      connectionStatus: 'connected',
      client: { sendRaw } as never,
      operEventReplay: emptyEventReplayFeed(),
    });
    store.getState().requestOperEventReplay(25);
    expect(sendRaw).toHaveBeenCalledWith('EVENT', 'REPLAY', 'JSON', 'ALL', '25');
    expect(store.getState().operEventReplay.pending).toBe(true);
  });

  it('refuses to send when not oper', () => {
    const sendRaw = vi.fn();
    store.setState({
      isOper: false,
      connectionStatus: 'connected',
      client: { sendRaw } as never,
    });
    store.getState().requestOperEventReplay(50);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('folds server NOTICE JSON stream into operEventReplay and does not announce', () => {
    store.setState({ isOper: true, announcements: [] });
    const ts = 1_720_000_000_000;
    feed(':onyx.example NOTICE alice :{"type":"event-replay","count":1,"severity_floor":"info"}');
    feed(
      `:onyx.example NOTICE alice :{"type":"event","ts":${ts},"category":"flood","category_code":"FLOOD","severity":"warn","origin":"edge","message":"burst"}`,
    );
    feed(':onyx.example NOTICE alice :{"type":"event-replay-end","count":1}');

    const feedState = store.getState().operEventReplay;
    expect(feedState.complete).toBe(true);
    expect(feedState.pending).toBe(false);
    expect(feedState.severityFloor).toBe('info');
    expect(feedState.events).toHaveLength(1);
    expect(feedState.events[0]).toMatchObject({
      categoryCode: 'FLOOD',
      severity: 'warn',
      origin: 'edge',
      message: 'burst',
    });
    // Structured notices must not pollute global announcements.
    expect(store.getState().announcements).toEqual([]);
  });

  it('ignores hostile JSON that is not event-replay', () => {
    store.setState({ isOper: true, operEventReplay: emptyEventReplayFeed() });
    feed(':onyx.example NOTICE alice :{"type":"event-stats","total":9}');
    expect(store.getState().operEventReplay.events).toEqual([]);
  });
});
