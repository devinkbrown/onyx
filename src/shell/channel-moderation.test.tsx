// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { MemberList } from './MemberList';
import { PresenceRibbon } from './PresenceRibbon';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://channel-settings.example/ws', identity: 'me' } as const;

function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    modeToPrefix: { Y: '*', Q: '!', q: '~', a: '&', o: '@', h: '%', v: '+' } as Record<string, string>,
    prefixToMode: { '*': 'Y', '!': 'Q', '.': 'q', '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' } as Record<string, string>,
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

function seedChannel(opts: { ourNick: string; users: ChannelUser[]; modes?: string; props?: Record<string, string> }) {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general', opts.users, opts.modes ?? ''));
  const channelProps = opts.props ? new Map([['#general', opts.props]]) : new Map();
  store.setState({
    ...initialState,
    client: client as never,
    channels,
    channelProps,
    ourNick: opts.ourNick,
    server: {
      id: 'channel-settings',
      name: 'Channel settings test',
      network: 'channel-settings',
      url: MEMORY_OWNER.serverUrl,
      icon: 'C',
      nick: opts.ourNick,
      account: MEMORY_OWNER.identity,
      connected: true,
    },
    activeView: { kind: 'channel', channel: '#general' },
    connectionStatus: 'connected',
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ── MemberList moderation menu ────────────────────────────────────────────────

describe('MemberList moderation', () => {
  it('labels the member landmark, roster region, and member detail dialog by channel and nick', () => {
    seedChannel({ ourNick: 'me', users: [makeUser('me', ['o']), makeUser('bob', ['v'])] });

    render(() => <MemberList />);

    expect(screen.getByRole('complementary', { name: 'Member list for #general' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Channel members in #general' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /Voice/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open member details for bob, Voice/ }));

    expect(screen.getByRole('dialog', { name: 'Member details for bob' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'bob', description: 'Voice in #general' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send DM to bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View profile of bob' })).toBeInTheDocument();
  });

  it('groups standard channel admins, ops, halfops, and voice in the nicklist', () => {
    seedChannel({
      ourNick: 'me',
      users: [
        makeUser('me', ['o']),
        makeUser('ada', ['a']),
        makeUser('opal', ['o']),
        makeUser('hemi', ['h']),
        makeUser('vivi', ['v']),
      ],
    });

    render(() => <MemberList />);

    expect(screen.getByRole('list', { name: /Admins/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open member details for ada, Admin/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open member details for opal, Op/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open member details for hemi, Half-op/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open member details for vivi, Voice/ })).toBeInTheDocument();
  });

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

  it('keeps focus in the roster when a kicked member row is removed', () => {
    seedChannel({
      ourNick: 'me',
      users: [makeUser('me', ['o']), makeUser('bob'), makeUser('carol')],
    });

    render(() => <MemberList />);
    fireEvent.click(screen.getByRole('button', { name: /Open member details for bob/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Kick bob from #general' }));
    store.getState()._handleMessage(parseIRCMessage(':me!user@host KICK #general bob :Removed'));

    expect(screen.queryByRole('button', { name: /Open member details for bob/ })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Member list for #general' })).toHaveFocus();
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
    // A8: settings lives in the ribbon More disclosure, not the primary strip.
    const moreSurface = screen.getByTestId('ribbon-more');
    fireEvent.click(moreSurface.closest('button') ?? moreSurface);
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
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Encryption' })).toBeInTheDocument();
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

  it('keeps an offline topic draft until reconnect', () => {
    // Arrange — op with the channel settings sheet available, but transport down.
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });
    store.setState({ connectionStatus: 'disconnected' });

    // Act — draft while offline.
    openSettings();
    const textarea = screen.getByLabelText('Topic text') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'Drafted during a tunnel drop' } });

    // Assert — the draft is local and cannot silently no-op as a TOPIC command.
    expect(screen.getByText('Offline: topic changes stay drafted on this device and can be saved after reconnect.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save topic' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));
    expect(client.sendRaw).not.toHaveBeenCalledWith('TOPIC', '#general', 'Drafted during a tunnel drop');

    // Act — reopen later and reconnect.
    cleanup();
    openSettings();
    expect(screen.getByLabelText('Topic text')).toHaveValue('Drafted during a tunnel drop');
    store.setState({ connectionStatus: 'connected' });
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));

    // Assert — the same draft sends through the normal server path.
    expect(client.sendRaw).toHaveBeenCalledWith('TOPIC', '#general', 'Drafted during a tunnel drop');
  });

  it('lets an op set ephemeral history retention', () => {
    // Arrange — op, no retention currently set
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    openSettings();
    fireEvent.change(screen.getByLabelText('Ephemeral history'), { target: { value: '86400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply retention' }));

    // Assert
    expect(client.sendRaw).toHaveBeenCalledWith('PROP', '#general', 'EPHEMERAL', '86400');
    expect(store.getState().channelProps.get('#general')?.EPHEMERAL).toBe('86400');
  });

  it('shows ephemeral retention read-only to a non-op', () => {
    // Arrange — plain member, retention already set
    seedChannel({ ourNick: 'me', users: [makeUser('me', [])], props: { EPHEMERAL: '3600' } });

    // Act
    openSettings();

    // Assert
    expect(screen.queryByLabelText('Ephemeral history')).toBeNull();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('Only ops can change history retention.')).toBeInTheDocument();
  });

  it('lets an op set the channel encryption policy', () => {
    // Arrange — op, default policy off
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    openSettings();
    fireEvent.change(screen.getByLabelText('Message policy'), { target: { value: 'required' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply policy' }));

    // Assert
    expect(client.sendRaw).toHaveBeenCalledWith('PROP', '#general', 'encryption-policy', 'required');
    expect(store.getState().channelProps.get('#general')?.['encryption-policy']).toBe('required');
  });

  it('shows encryption policy read-only to a non-op', () => {
    // Arrange — plain member, encryption required
    seedChannel({ ourNick: 'me', users: [makeUser('me', [])], props: { 'encryption-policy': 'required' } });

    // Act
    openSettings();

    // Assert
    expect(screen.queryByLabelText('Message policy')).toBeNull();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Only ops can change the channel encryption policy.')).toBeInTheDocument();
  });

  it('lets an op create, list, and delete webhooks', () => {
    // Arrange — op
    const client = seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });

    // Act
    openSettings();
    // Opening settings as op auto-fetches ACCESS LIST; ignore that for webhook asserts.
    client.sendRaw.mockClear();
    fireEvent.input(screen.getByLabelText('Webhook name'), { target: { value: 'deploy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
    fireEvent.click(screen.getByRole('button', { name: 'List webhooks' }));
    fireEvent.input(screen.getByLabelText('Delete webhook id'), { target: { value: 'wh_123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete webhook' }));

    // Assert
    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'WEBHOOK', 'CREATE', '#general', 'deploy');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'WEBHOOK', 'LIST', '#general');
    expect(client.sendRaw).toHaveBeenNthCalledWith(3, 'WEBHOOK', 'DELETE', 'wh_123');
  });

  it('shows recent webhook notices in channel settings', () => {
    // Arrange — op with a previously-created webhook URL notice
    seedChannel({ ourNick: 'me', users: [makeUser('me', ['o'])] });
    store.getState().addServiceNotice('Webhook', 'WEBHOOK: created for #general - POST Discord webhook JSON to https://chat.example/api/webhooks/id/token');

    // Act
    openSettings();

    // Assert
    expect(screen.getByText(/WEBHOOK: created for #general/)).toBeInTheDocument();
  });

  it('shows webhook controls read-only to a non-op', () => {
    // Arrange — plain member
    seedChannel({ ourNick: 'me', users: [makeUser('me', [])] });

    // Act
    openSettings();

    // Assert
    expect(screen.queryByLabelText('Webhook name')).toBeNull();
    expect(screen.getByText('Discord-compatible webhook URLs can post into this channel.')).toBeInTheDocument();
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
