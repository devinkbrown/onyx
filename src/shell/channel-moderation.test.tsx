/**
 * channel-moderation.test.tsx — MemberList moderation menu + ChannelSettings.
 *
 * Asserts the op-gating: moderation controls and the mode editor only appear
 * for ops (or higher), and that clicking them dispatches the right raw command
 * through the store actions. AAA pattern throughout.
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { MemberList } from './MemberList';
import { PresenceRibbon } from './PresenceRibbon';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    modeToPrefix: { Q: '!', q: '.', o: '@', v: '+' } as Record<string, string>,
    prefixToMode: { '!': 'Q', '.': 'q', '@': 'o', '+': 'v' } as Record<string, string>,
  };
}

function makeUser(nick: string, modes: string[] = []): ChannelUser {
  return { nick, modes: new Set(modes) };
}

function makeChannel(name: string, users: ChannelUser[], modes = ''): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) usersMap.set(u.nick.toLowerCase(), u);
  return {
    name,
    topic: 'Welcome',
    topicSetBy: 'server',
    topicSetAt: null,
    modes,
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function seedChannel(opts: { ourNick: string; users: ChannelUser[]; modes?: string }) {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general', opts.users, opts.modes ?? ''));
  store.setState({
    ...initialState,
    client: client as never,
    channels,
    ourNick: opts.ourNick,
    activeView: { kind: 'channel', channel: '#general' },
    connectionStatus: 'connected',
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initialState, true);
});

afterEach(() => {
  cleanup();
});

// ── MemberList moderation menu ────────────────────────────────────────────────

describe('MemberList moderation', () => {
  it('shows Kick/Ban controls to an op when targeting another member', () => {
    // Arrange — we are op, bob is a plain member
    seedChannel({ ourNick: 'me', users: [makeUser('me', ['o']), makeUser('bob')] });

    // Act — open bob's popover card
    const { getAllByRole } = render(() => <MemberList />);
    const trigger = getAllByRole('button').find((b) => b.textContent?.includes('bob'));
    expect(trigger).toBeDefined();
    fireEvent.click(trigger!);

    // Assert — moderation group present
    expect(screen.getByRole('group', { name: 'Moderate bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kick bob from #general' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ban bob from #general' })).toBeInTheDocument();
  });

  it('hides moderation controls from a non-op', () => {
    // Arrange — we are a plain member
    seedChannel({ ourNick: 'me', users: [makeUser('me', []), makeUser('bob')] });

    // Act
    const { getAllByRole } = render(() => <MemberList />);
    const trigger = getAllByRole('button').find((b) => b.textContent?.includes('bob'));
    fireEvent.click(trigger!);

    // Assert — no moderation group at all
    expect(screen.queryByRole('group', { name: 'Moderate bob' })).toBeNull();
  });

  it('does not show moderation controls against yourself', () => {
    // Arrange — we are op; open our own card
    seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    const { getAllByRole } = render(() => <MemberList />);
    const trigger = getAllByRole('button').find((b) => b.textContent?.includes('me'));
    fireEvent.click(trigger!);

    // Assert
    expect(screen.queryByRole('group', { name: 'Moderate me' })).toBeNull();
  });

  it('clicking Kick dispatches KICK through the client', () => {
    // Arrange
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o']), makeUser('bob')] });

    // Act
    const { getAllByRole } = render(() => <MemberList />);
    fireEvent.click(getAllByRole('button').find((b) => b.textContent?.includes('bob'))!);
    fireEvent.click(screen.getByRole('button', { name: 'Kick bob from #general' }));

    // Assert
    expect(client.sendRaw).toHaveBeenCalledWith('KICK', '#general', 'bob');
  });

  it('clicking Op dispatches MODE +o through the client', () => {
    // Arrange
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o']), makeUser('bob')] });

    // Act
    const { getAllByRole } = render(() => <MemberList />);
    fireEvent.click(getAllByRole('button').find((b) => b.textContent?.includes('bob'))!);
    fireEvent.click(screen.getByRole('button', { name: 'Give op to bob' }));

    // Assert
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#general', '+o', 'bob');
  });
});

// ── ChannelSettings panel ─────────────────────────────────────────────────────

describe('ChannelSettings panel', () => {
  function openSettings() {
    const result = render(() => <PresenceRibbon selfNick="me" />);
    const gear = screen.getByTestId('ribbon-settings-gear');
    fireEvent.click(gear);
    return result;
  }

  it('opens from the ribbon gear and shows the Topic + Modes sections to an op', () => {
    // Arrange
    seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    openSettings();

    // Assert — both sections render; op sees mode toggles
    expect(screen.getByRole('dialog', { name: 'Channel settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Topic' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Channel mode flags' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Moderated/ })).toBeInTheDocument();
  });

  it('shows a read-only modes view to a non-op', () => {
    // Arrange — plain member
    seedChannel({ ourNick: 'me', users: [makeUser('me', [])] });

    // Act
    openSettings();

    // Assert — no toggle group; read-only notice present
    expect(screen.queryByRole('group', { name: 'Channel mode flags' })).toBeNull();
    expect(screen.getByText('Only ops can change channel modes.')).toBeInTheDocument();
  });

  it('toggling a flag dispatches the MODE command', () => {
    // Arrange — op, channel currently has no modes
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    openSettings();
    fireEvent.click(screen.getByRole('switch', { name: /Moderated/ }));

    // Assert — +m sent (flag was off)
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#general', '+m');
  });

  it('reflects current modes: an already-set +m flag renders as checked', () => {
    // Arrange — op, channel is +m
    seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])], modes: '+m' });

    // Act
    openSettings();

    // Assert — the Moderated switch is on
    expect(screen.getByRole('switch', { name: /Moderated/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('saving the topic dispatches TOPIC', () => {
    // Arrange — op
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    openSettings();
    const textarea = screen.getByLabelText('Topic text') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'A brand new topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));

    // Assert
    expect(client.sendRaw).toHaveBeenCalledWith('TOPIC', '#general', 'A brand new topic');
  });

  it('makes the topic read-only for a non-op in a +t channel', () => {
    // Arrange — plain member, topic-locked channel
    seedChannel({ ourNick: 'me', users: [makeUser('me', [])], modes: '+t' });

    // Act
    openSettings();

    // Assert — no editable textarea, lock notice shown
    expect(screen.queryByLabelText('Topic text')).toBeNull();
    expect(
      screen.getByText('This channel is topic-locked (+t). Only ops can change the topic.'),
    ).toBeInTheDocument();
  });
});
