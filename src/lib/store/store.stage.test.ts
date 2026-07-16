// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import { MAX_STAGE_RAISED_HANDS, store } from './store';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn((..._args: string[]) => true),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function stageRoom(): Channel {
  return {
    name: '#stage',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: 'm',
    users: new Map([
      ['alice', { nick: 'alice', modes: new Set<string>(), away: false }],
      ['host', { nick: 'host', modes: new Set(['o']), away: false }],
      ['mallory', { nick: 'mallory', modes: new Set<string>(), away: false }],
    ]),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

beforeEach(() => {
  store.setState(initialState, true);
  store.setState({
    client: makeClient() as never,
    ourNick: 'me',
    stageChannel: '#stage',
    channels: new Map([['#stage', stageRoom()]]),
  });
});

describe('STAGE CTCP ownership', () => {
  it('accepts stage state only from the exact active channel', () => {
    feed(':mallory!u@h PRIVMSG #other :\x01STAGE RAISE_HAND\x01');
    feed(':mallory!u@h PRIVMSG me :\x01STAGE RAISE_HAND\x01');
    feed(':outsider!u@h PRIVMSG #stage :\x01STAGE RAISE_HAND\x01');
    feed(':mallory!u@h PRIVMSG #other :\x01STAGE INVITE_SPEAK me\x01');
    feed(':mallory!u@h PRIVMSG #stage :\x01STAGE INVITE_SPEAK me\x01');

    expect(store.getState().stageRaisedHands).toEqual([]);
    expect(store.getState().pendingSpeakInvite).toBeNull();

    feed(':alice!u@h PRIVMSG #stage :\x01STAGE RAISE_HAND\x01');
    feed(':host!u@h PRIVMSG #stage :\x01STAGE INVITE_SPEAK me\x01');

    expect(store.getState().stageRaisedHands).toEqual(['alice']);
    expect(store.getState().pendingSpeakInvite).toBe('host');
  });

  it('never spends host authority for an acceptance from another room', () => {
    const client = store.getState().client as unknown as ReturnType<typeof makeClient>;
    store.setState({ isStageHost: true, stageRaisedHands: ['alice'] });

    feed(':alice!u@h PRIVMSG #other :\x01STAGE ACCEPT_SPEAK\x01');
    feed(':mallory!u@h PRIVMSG #stage :\x01STAGE ACCEPT_SPEAK\x01');
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().stageRaisedHands).toEqual(['alice']);

    feed(':alice!u@h PRIVMSG #stage :\x01STAGE ACCEPT_SPEAK\x01');
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#stage', '+v', 'alice');
    expect(store.getState().stageRaisedHands).toEqual([]);
  });
});

describe('stage transient-state bounds and lifecycle', () => {
  it('bounds raised hands and deduplicates nicks case-insensitively', () => {
    for (let index = 0; index < MAX_STAGE_RAISED_HANDS + 8; index += 1) {
      store.getState().addRaisedHand(`nick${index.toString().padStart(4, '0')}`);
    }
    store.getState().addRaisedHand('NICK0000');
    store.getState().addRaisedHand('bad nick');
    store.getState().addRaisedHand('x'.repeat(129));

    const hands = store.getState().stageRaisedHands;
    expect(hands).toHaveLength(MAX_STAGE_RAISED_HANDS);
    expect(new Set(hands.map(nick => nick.toLowerCase()))).toHaveProperty(
      'size',
      MAX_STAGE_RAISED_HANDS,
    );
    expect(hands.at(-1)).toBe('NICK0000');
  });

  it('resets the previous stage before joining or starting another one', () => {
    const client = store.getState().client as unknown as ReturnType<typeof makeClient>;
    store.setState({
      stageRaisedHands: ['alice'],
      isStageHost: true,
      isStageSpeaker: true,
      stageHandRaised: true,
      pendingSpeakInvite: 'host',
    });

    store.getState().joinStage(' #Next ');
    expect(client.sendRaw).toHaveBeenCalledWith('JOIN', '#Next');
    expect(store.getState()).toMatchObject({
      stageChannel: '#Next',
      stageRaisedHands: [],
      isStageHost: false,
      isStageSpeaker: false,
      stageHandRaised: false,
      pendingSpeakInvite: null,
    });

    store.setState({ stageRaisedHands: ['bob'], pendingSpeakInvite: 'host' });
    store.getState().startStage('#Hosted');
    expect(store.getState()).toMatchObject({
      stageChannel: '#Hosted',
      stageRaisedHands: [],
      isStageHost: true,
      isStageSpeaker: true,
      stageHandRaised: false,
      pendingSpeakInvite: null,
    });
  });

  it('clears stage authority and transient rows on leave or self-PART', () => {
    store.setState({
      stageRaisedHands: ['alice'],
      isStageHost: true,
      isStageSpeaker: true,
      stageHandRaised: true,
      pendingSpeakInvite: 'host',
    });
    store.getState().leaveStage();
    expect(store.getState()).toMatchObject({
      stageChannel: null,
      stageRaisedHands: [],
      isStageHost: false,
      isStageSpeaker: false,
      stageHandRaised: false,
      pendingSpeakInvite: null,
    });

    store.setState({
      stageChannel: '#stage',
      stageRaisedHands: ['alice'],
      isStageHost: true,
      pendingSpeakInvite: 'host',
    });
    feed(':me!u@h PART #stage :leaving');
    expect(store.getState()).toMatchObject({
      stageChannel: null,
      stageRaisedHands: [],
      isStageHost: false,
      pendingSpeakInvite: null,
    });
  });

  it('tracks raised-hand and invite identities across a nick change', () => {
    store.setState({ stageRaisedHands: ['alice'], pendingSpeakInvite: 'alice' });
    feed(':alice!u@h NICK Alicia');

    expect(store.getState().stageRaisedHands).toEqual(['Alicia']);
    expect(store.getState().pendingSpeakInvite).toBe('Alicia');
  });
});
