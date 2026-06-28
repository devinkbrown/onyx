/**
 * store.media.test.ts
 *
 * MEDIA (voice/video) presence now arrives on the IRCX EVENT plane
 * (`:server EVENT <me> MEDIA <verb> <#chan> <nick> [detail]`) instead of the old
 * local-only NOTE MEDIA broadcast. The store re-shapes EVENT MEDIA into the
 * NOTE MEDIA param order and routes it through the single media handler, so the
 * call roster updates identically. The legacy NOTE form still works (per-client
 * replies — MACKEY/ROSTER — stay NOTE). On registration the client subscribes
 * via `EVENT ADD MEDIA *`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    sessionSyncActive: false,
    currentNick: 'me',
  };
}

function seedChannel(name: string, ourNick = 'me') {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set(name.toLowerCase(), {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map<string, ChannelUser>(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  });
  store.setState({
    ...initialState,
    client: client as never,
    channels,
    ourNick,
    activeView: { kind: 'channel', channel: name.toLowerCase() },
  }, true);
  return client;
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function callRoster(channel: string): Set<string> | undefined {
  return store.getState().voiceChannelParticipants.get(channel.toLowerCase());
}

beforeEach(() => {
  store.setState(initialState, true);
});

describe('MEDIA presence via the IRCX EVENT plane', () => {
  it('an EVENT MEDIA JOIN adds the actor to the channel call roster', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    expect(callRoster('#root')?.has('alice')).toBe(true);
  });

  it('an EVENT MEDIA LEAVE removes the actor', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA LEAVE #root alice');
    expect(callRoster('#root')?.has('alice') ?? false).toBe(false);
  });

  it('still accepts the legacy NOTE MEDIA presence form (backward compatible)', () => {
    seedChannel('#root');
    feed(':eshmaki.me NOTE MEDIA #root JOIN bob voice');
    expect(callRoster('#root')?.has('bob')).toBe(true);
  });

  it('ignores a non-MEDIA EVENT (e.g. a CHANNEL/MEMBER oper feed)', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me CHANNEL MODE #root +nt');
    expect(callRoster('#root') ?? new Set()).toEqual(new Set());
  });

  it('subscribes to the MEDIA event plane on registration (001)', () => {
    const client = seedChannel('#root');
    feed(':eshmaki.me 001 me :Welcome to IRCXNet');
    const sub = client.sendRaw.mock.calls.find(
      (c: unknown[]) => c[0] === 'EVENT' && c[1] === 'ADD' && c[2] === 'MEDIA',
    );
    expect(sub).toBeTruthy();
  });
});
