/**
 * store.media.test.ts
 *
 * MEDIA (voice/video) presence and targeted media replies arrive on the IRCX
 * EVENT plane (`:server EVENT <me> MEDIA <verb> <#chan> [detail...]`). On
 * registration the client subscribes via `EVENT ADD MEDIA *`.
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

describe('MEDIA live state (speaking / mute / hand / react) — drives the call UI for cross-node peers', () => {
  it('SPEAKING / SILENT toggles speakingNicks', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA SPEAKING #root alice voice');
    expect(store.getState().speakingNicks.has('alice')).toBe(true);
    feed(':eshmaki.me EVENT me MEDIA SILENT #root alice voice');
    expect(store.getState().speakingNicks.has('alice')).toBe(false);
  });

  it('MUTE / UNMUTE toggles mutedNicks (flat set works for peers with no media)', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA MUTE #root alice voice');
    expect(store.getState().mutedNicks.has('alice')).toBe(true);
    feed(':eshmaki.me EVENT me MEDIA UNMUTE #root alice voice');
    expect(store.getState().mutedNicks.has('alice')).toBe(false);
  });

  it('HAND up / down toggles voice.raisedHands', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA HAND #root alice up');
    expect(store.getState().voice.raisedHands.has('alice')).toBe(true);
    feed(':eshmaki.me EVENT me MEDIA HAND #root alice down');
    expect(store.getState().voice.raisedHands.has('alice')).toBe(false);
  });

  it('REACT dispatches an ocean:voice-reaction event', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    const got: Array<{ emoji: string; nick: string }> = [];
    const h = (e: Event) => got.push((e as CustomEvent).detail);
    window.addEventListener('ocean:voice-reaction', h);
    feed(':eshmaki.me EVENT me MEDIA REACT #root alice tada');
    window.removeEventListener('ocean:voice-reaction', h);
    expect(got).toEqual([{ emoji: 'tada', nick: 'alice' }]);
  });

  it('LEAVE clears the participant from speaking / muted / hand', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA SPEAKING #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA MUTE #root alice voice');
    feed(':eshmaki.me EVENT me MEDIA HAND #root alice up');
    feed(':eshmaki.me EVENT me MEDIA LEAVE #root alice');
    const st = store.getState();
    expect(st.speakingNicks.has('alice')).toBe(false);
    expect(st.mutedNicks.has('alice')).toBe(false);
    expect(st.voice.raisedHands.has('alice')).toBe(false);
    expect(callRoster('#root')?.has('alice') ?? false).toBe(false);
  });
});
