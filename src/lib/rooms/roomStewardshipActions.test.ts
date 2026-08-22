// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { store, type Server } from '@/lib/store/store';
import { STEWARDSHIP_COPY } from './roomStewardship';
import { resetRoomTransfers, transferFor } from './roomTransferMemory';
import {
  acceptRoomOwnership,
  addRoomCoAdmin,
  closeConsumerRoom,
  deleteConsumerRoom,
  grantRoomOwnership,
  offerRoomOwnership,
} from './roomStewardshipActions';

const initialState = store.getInitialState();
const server: Server = {
  id: 'steward',
  name: 'Steward',
  network: 'Steward',
  url: 'wss://steward.test/ws',
  icon: '',
  nick: 'alice',
  account: 'alice',
  connected: true,
};

function user(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function channel(users: ChannelUser[]): Channel {
  const roster = new Map<string, ChannelUser>();
  for (const entry of users) roster.set(entry.nick.toLowerCase(), entry);
  return {
    name: '#harbor',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: roster,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function seed(users: ChannelUser[], ourNick = 'alice'): ReturnType<typeof vi.fn> {
  const sendRaw = vi.fn(() => true);
  store.setState({
    ...initialState,
    server,
    ourNick,
    connectionStatus: 'connected',
    client: { sendRaw, isupport: { CHANTYPES: '#&' } } as never,
    channels: new Map([['#harbor', channel(users)]]),
  }, true);
  return sendRaw;
}

beforeEach(() => {
  resetRoomTransfers();
});

afterEach(() => {
  resetRoomTransfers();
  store.setState(initialState, true);
});

const five = [
  user('alice', ['Q', 'q']),
  user('bob', ['o']),
  user('cara', ['o']),
  user('drew'),
  user('erin'),
];

describe('room stewardship actions', () => {
  it('cannot add a third co-admin', () => {
    const sendRaw = seed(five);
    expect(addRoomCoAdmin('#harbor', 'drew')).toEqual({
      ok: false,
      reason: STEWARDSHIP_COPY.thirdCoAdmin,
    });
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('waits for accept before sending owner rank', () => {
    const sendRaw = seed(five);
    expect(offerRoomOwnership('#harbor', 'drew')).toEqual({ ok: true });
    expect(transferFor('#harbor')?.accepted).toBe(false);
    expect(grantRoomOwnership('#harbor')).toEqual({
      ok: false,
      reason: STEWARDSHIP_COPY.transferWait,
    });
    expect(sendRaw.mock.calls.some((args) => args[0] === 'MODE')).toBe(false);

    store.setState({ ourNick: 'drew' });
    expect(acceptRoomOwnership('#harbor')).toEqual({ ok: true });
    expect(transferFor('#harbor')?.accepted).toBe(true);
    expect(sendRaw.mock.calls.some((args) => args[0] === 'MODE')).toBe(false);

    store.setState({ ourNick: 'alice' });
    expect(grantRoomOwnership('#harbor')).toEqual({ ok: true });
    expect(sendRaw).toHaveBeenCalledWith('MODE', '#harbor', '+q', 'drew');
    expect(sendRaw).toHaveBeenCalledWith('MODE', '#harbor', '-q', 'alice');
  });

  it('refuses delete until the room name is typed', () => {
    const sendRaw = seed(five);
    expect(deleteConsumerRoom('#harbor', '')).toEqual({
      ok: false,
      reason: 'Type the room name to delete it.',
    });
    expect(deleteConsumerRoom('#harbor', '#other')).toEqual({
      ok: false,
      reason: 'Type the room name to delete it.',
    });
    expect(sendRaw).not.toHaveBeenCalled();

    expect(deleteConsumerRoom('#harbor', '#harbor')).toEqual({ ok: true });
    expect(sendRaw).toHaveBeenCalledWith('CHANNEL', 'DROP', '#harbor');
    expect(sendRaw).toHaveBeenCalledWith('PART', '#harbor', 'Goodbye');
  });

  it('closes a room with the existing secret and invite-only flags', () => {
    const sendRaw = seed(five);
    expect(closeConsumerRoom('#harbor')).toEqual({ ok: true });
    expect(sendRaw).toHaveBeenCalledWith('MODE', '#harbor', '+si');
  });

  it('last-member leave dissolves through the existing self-PART fold', () => {
    seed([user('alice', ['Q'])]);
    store.getState()._handleMessage(parseIRCMessage(':alice!u@h PART #harbor :Goodbye'));
    expect(store.getState().channels.has('#harbor')).toBe(false);
  });
});
