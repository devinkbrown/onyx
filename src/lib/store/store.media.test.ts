// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.media.test.ts
 *
 * MEDIA (voice/video) presence and targeted media replies arrive on the IRCX
 * EVENT plane (`:server EVENT <me> MEDIA <verb> <#chan> [detail...]`). On
 * registration the client subscribes via `EVENT ADD MEDIA *`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_LIVE_MEDIA_CHANNELS,
  MAX_LIVE_MEDIA_PARTICIPANTS,
  MAX_MEDIA_TRANSCRIPT_ENTRIES,
  MAX_MEDIA_TRANSCRIPT_TEXT_LENGTH,
  store,
} from './store';
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

  it('matches participant state case-insensitively when peers change casing', () => {
    seedChannel('#root');
    feed(':eshmaki.me EVENT me MEDIA JOIN #root Alice voice');
    feed(':eshmaki.me EVENT me MEDIA SPEAKING #root aLiCe voice');
    feed(':eshmaki.me EVENT me MEDIA MUTE #root ALICE voice');
    feed(':eshmaki.me EVENT me MEDIA HAND #root alice up');

    expect(store.getState().speakingNicks.has('alice')).toBe(true);
    expect(store.getState().mutedNicks.has('alice')).toBe(true);
    expect(store.getState().voice.raisedHands.has('alice')).toBe(true);

    feed(':eshmaki.me EVENT me MEDIA LEAVE #root aLiCe');
    expect(callRoster('#root')).toBeUndefined();
    expect(store.getState().speakingNicks.has('alice')).toBe(false);
    expect(store.getState().mutedNicks.has('alice')).toBe(false);
    expect(store.getState().voice.raisedHands.has('alice')).toBe(false);
  });

  it('bounds server-controlled media rosters and their channel map', () => {
    seedChannel('#root');
    for (let index = 0; index < MAX_LIVE_MEDIA_PARTICIPANTS + 8; index += 1) {
      feed(`:eshmaki.me EVENT me MEDIA JOIN #root peer-${index} voice`);
    }
    expect(callRoster('#root')?.size).toBe(MAX_LIVE_MEDIA_PARTICIPANTS);
    expect(callRoster('#root')?.has(`peer-${MAX_LIVE_MEDIA_PARTICIPANTS}`)).toBe(false);

    for (let index = 1; index < MAX_LIVE_MEDIA_CHANNELS + 8; index += 1) {
      feed(`:eshmaki.me EVENT me MEDIA JOIN #room-${index} alice voice`);
    }
    expect(store.getState().voiceChannelParticipants.size).toBe(MAX_LIVE_MEDIA_CHANNELS);
    expect(store.getState().voiceChannelParticipants.has(`#room-${MAX_LIVE_MEDIA_CHANNELS}`)).toBe(false);
  });

  it('requires roster membership before accepting transient presence or reactions', () => {
    seedChannel('#root');
    const got: Array<{ emoji: string; nick: string }> = [];
    const handler = (event: Event) => got.push((event as CustomEvent).detail);
    window.addEventListener('ocean:voice-reaction', handler);

    feed(':eshmaki.me EVENT me MEDIA SPEAKING #root stranger voice');
    feed(':eshmaki.me EVENT me MEDIA MUTE #root stranger voice');
    feed(':eshmaki.me EVENT me MEDIA HAND #root stranger up');
    feed(':eshmaki.me EVENT me MEDIA REACT #root stranger wave');

    window.removeEventListener('ocean:voice-reaction', handler);
    expect(store.getState().speakingNicks).toEqual(new Set());
    expect(store.getState().mutedNicks).toEqual(new Set());
    expect(store.getState().voice.raisedHands).toEqual(new Set());
    expect(got).toEqual([]);
  });

  it('bounds transcript channels, entries, and text', () => {
    seedChannel('#root');
    for (let index = 0; index < MAX_MEDIA_TRANSCRIPT_ENTRIES + 8; index += 1) {
      feed(`:eshmaki.me EVENT me MEDIA CAPTION #root alice :caption ${index}`);
    }
    expect(store.getState().mediaTranscripts.get('#root')).toHaveLength(MAX_MEDIA_TRANSCRIPT_ENTRIES);

    feed(`:eshmaki.me EVENT me MEDIA CAPTION #root alice :${'x'.repeat(MAX_MEDIA_TRANSCRIPT_TEXT_LENGTH + 1)}`);
    expect(store.getState().mediaTranscripts.get('#root')).toHaveLength(MAX_MEDIA_TRANSCRIPT_ENTRIES);
    expect(store.getState().mediaTranscripts.get('#root')?.at(-1)?.text).toBe('caption 207');

    for (let index = 1; index < MAX_LIVE_MEDIA_CHANNELS + 8; index += 1) {
      feed(`:eshmaki.me EVENT me MEDIA TRANSCRIPT #room-${index} alice :saved`);
    }
    expect(store.getState().mediaTranscripts.size).toBe(MAX_LIVE_MEDIA_CHANNELS);
    expect(store.getState().mediaTranscripts.has(`#room-${MAX_LIVE_MEDIA_CHANNELS}`)).toBe(false);
  });
});
