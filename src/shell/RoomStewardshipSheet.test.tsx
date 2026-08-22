// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser } from '@/lib/irc/types';
import { STEWARDSHIP_COPY } from '@/lib/rooms/roomStewardship';
import { store, type Server } from '@/lib/store/store';
import { HarborConfirmHost } from './HarborConfirmSheet';
import { RoomStewardshipHost } from './RoomStewardshipSheet';
import {
  closeRoomStewardship,
  openRoomStewardship,
  resetRoomStewardshipState,
} from './roomStewardshipState';

const initialState = store.getInitialState();
const server: Server = {
  id: 'care',
  name: 'Care',
  network: 'Care',
  url: 'wss://care.test/ws',
  icon: '',
  nick: 'alice',
  account: 'alice',
  connected: true,
};

function user(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function makeRoom(users: ChannelUser[]): Channel {
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
    client: { sendRaw } as never,
    channels: new Map([['#harbor', makeRoom(users)]]),
    addToast: vi.fn(),
  }, true);
  return sendRaw;
}

const five = [
  user('alice', ['Q', 'q']),
  user('bob', ['o']),
  user('cara', ['o']),
  user('drew'),
  user('erin'),
];

describe('RoomStewardshipHost', () => {
  beforeEach(() => {
    resetRoomStewardshipState();
  });

  afterEach(() => {
    cleanup();
    resetRoomStewardshipState();
    store.setState(initialState, true);
  });

  it('refuses a third helper and waits for accept before handing the room over', () => {
    const sendRaw = seed(five);
    openRoomStewardship('#harbor');
    render(() => <RoomStewardshipHost />);

    expect(screen.getByRole('heading', { name: STEWARDSHIP_COPY.title })).toBeInTheDocument();
    expect(screen.getByTestId('harbor-steward-helper-cap')).toHaveTextContent(STEWARDSHIP_COPY.thirdCoAdmin);
    expect(screen.queryByTestId('harbor-steward-add-helper')).toBeNull();

    fireEvent.change(screen.getByTestId('harbor-steward-successor'), { target: { value: 'drew' } });
    fireEvent.click(screen.getByTestId('harbor-steward-offer'));
    expect(sendRaw).not.toHaveBeenCalled();
    expect(screen.getByTestId('harbor-steward-grant')).toBeDisabled();
    expect(screen.getByTestId('harbor-steward-transfer-wait')).toHaveTextContent(/accept/i);
  });

  it('does not delete until the room name is typed', () => {
    const sendRaw = seed(five);
    openRoomStewardship('#harbor');
    render(() => <RoomStewardshipHost />);

    const remove = screen.getByTestId('harbor-steward-delete');
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(sendRaw).not.toHaveBeenCalled();

    fireEvent.input(screen.getByTestId('harbor-steward-delete-name'), {
      target: { value: '#harbor' },
    });
    expect(screen.getByTestId('harbor-steward-delete')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('harbor-steward-delete'));
    expect(sendRaw).toHaveBeenCalledWith('CHANNEL', 'DROP', '#harbor');
    expect(sendRaw).toHaveBeenCalledWith('PART', '#harbor', 'Goodbye');
    expect(screen.queryByTestId('harbor-steward')).toBeNull();
  });

  it('last-member leave opens the existing harbor confirm', () => {
    const sendRaw = seed([user('alice', ['Q'])]);
    openRoomStewardship('#harbor');
    render(() => (
      <>
        <RoomStewardshipHost />
        <HarborConfirmHost />
      </>
    ));

    expect(screen.getByTestId('harbor-steward-last-member')).toHaveTextContent(/dissolves/i);
    fireEvent.click(screen.getByTestId('harbor-steward-leave'));
    expect(sendRaw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('harbor-leave-confirm'));
    expect(sendRaw).toHaveBeenCalledWith('PART', '#harbor', 'Goodbye');
  });

  it('lets the offered person accept without sending owner rank yet', () => {
    const sendRaw = seed(five);
    openRoomStewardship('#harbor');
    render(() => <RoomStewardshipHost />);
    fireEvent.change(screen.getByTestId('harbor-steward-successor'), { target: { value: 'drew' } });
    fireEvent.click(screen.getByTestId('harbor-steward-offer'));
    closeRoomStewardship();

    store.setState({ ourNick: 'drew' });
    openRoomStewardship('#harbor');
    expect(screen.getByRole('heading', { name: 'Take #harbor?' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('harbor-steward-accept'));
    expect(sendRaw).not.toHaveBeenCalled();
  });
});
