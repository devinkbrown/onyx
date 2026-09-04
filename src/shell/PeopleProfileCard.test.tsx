// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Channel, ChannelUser } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { PEOPLE_PROFILE_ADVANCED_TESTID, PeopleProfileCard } from './PeopleProfileCard';
import { PersonSafetyHost } from './people/PersonSafetySheet';
import { closePersonSafety } from './people/personSafetyState';

const initialState = store.getInitialState();

function makeUser(nick: string, extra: Partial<ChannelUser> = {}): ChannelUser {
  return { nick, modes: extra.modes ?? new Set(), ...extra };
}

function seedRoom(users: ChannelUser[], ourNick = 'me'): void {
  const channels = new Map<string, Channel>();
  const usersMap = new Map<string, ChannelUser>();
  for (const user of users) usersMap.set(user.nick.toLowerCase(), user);
  channels.set('#general', {
    name: '#general',
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  });
  store.setState({
    ...initialState,
    client: {
      sendRaw: vi.fn(),
      isupport: { CHANTYPES: '#&' },
      modeToPrefix: { Y: '*', Q: '!', q: '~', a: '&', o: '@', h: '%', v: '+' },
    } as never,
    channels,
    ourNick,
    activeView: { kind: 'channel', channel: '#general' },
    connectionStatus: 'connected',
  }, true);
}

afterEach(() => {
  cleanup();
  closePersonSafety();
});

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
});

describe('PeopleProfileCard', () => {
  it('shows a consumer card with display name, about, and Message / Mention / Block / Report', () => {
    seedRoom([makeUser('me', { modes: new Set(['o']) }), makeUser('bob')]);
    store.setState({
      userProfiles: new Map([['bob', {
        nick: 'bob',
        displayName: 'Bob Example',
        bio: 'Builds rooms on this device.',
      }]]),
    });

    render(() => <PeopleProfileCard nick="bob" channel="#general" />);

    const card = screen.getByRole('region', { name: 'Bob Example' });
    expect(card).toHaveAccessibleDescription('Builds rooms on this device.');
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send DM to bob' })).toBeInTheDocument();
    expect(screen.getByTestId('member-card-mention')).toBeInTheDocument();
    expect(screen.getByTestId('member-card-block')).toBeInTheDocument();
    expect(screen.getByTestId('member-card-report')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mute room|Leave room|Hide room/i })).toBeNull();
    expect(card.querySelector('.shell-people-card-identity')).not.toHaveTextContent('Voice');
    expect(card.querySelector('.shell-role-badge')).toBeNull();
    expect(card.querySelector('.shell-people-card-advanced')).toBeTruthy();
  });

  it('does not invent an about line when the server has no bio', () => {
    seedRoom([makeUser('me'), makeUser('quiet')]);

    render(() => <PeopleProfileCard nick="quiet" channel="#general" />);

    expect(screen.getByRole('region', { name: 'quiet' })).toBeInTheDocument();
    expect(screen.queryByText(/about/i)).toBeNull();
    expect(document.querySelector('.shell-people-card-about')).toBeNull();
  });

  it('keeps WHOIS, ledger, hostmasks, and room roles under Advanced', () => {
    seedRoom([makeUser('me', { modes: new Set(['o']) }), makeUser('bob', { modes: new Set(['v']), account: 'bob-account' })]);
    store.setState({
      whoisData: new Map([['bob', {
        nick: 'bob',
        username: 'bobu',
        host: 'user.example.net',
        loading: false,
      }]]),
    });
    setPreference('experienceMode', 'network-ops');

    render(() => <PeopleProfileCard nick="bob" channel="#general" />);

    const advanced = screen.getByTestId(PEOPLE_PROFILE_ADVANCED_TESTID);
    expect(advanced).toHaveTextContent('Advanced');
    expect(screen.getByRole('button', { name: 'View profile of bob' })).toBeInTheDocument();
    expect(screen.getByTestId('people-profile-ledger')).toHaveAttribute('href', '/stats/?room=%23general');
    expect(screen.getByTestId('people-profile-hostmask')).toHaveTextContent('bobu@user.example.net');
    expect(screen.getByText('Voice in #general')).toBeInTheDocument();
    expect(screen.getByText('Account bob-account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give op to bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kick bob from #general' })).toBeInTheDocument();
  });

  it('surfaces the WHOIS operator role under Advanced when 313 named one', () => {
    seedRoom([makeUser('me', { modes: new Set(['o']) }), makeUser('root')]);
    store.setState({
      whoisData: new Map([['root', {
        nick: 'root', isOper: true, operRole: 'Network administrator', loading: false,
      }]]),
    });

    render(() => <PeopleProfileCard nick="root" channel="#general" />);
    expect(screen.getByTestId('people-profile-oper-role'))
      .toHaveTextContent('Network administrator on this network');
  });

  it('falls back to the generic operator label when 313 carried no detail', () => {
    seedRoom([makeUser('me', { modes: new Set(['o']) }), makeUser('root')]);
    store.setState({
      whoisData: new Map([['root', { nick: 'root', isOper: true, loading: false }]]),
    });

    render(() => <PeopleProfileCard nick="root" channel="#general" />);
    expect(screen.getByTestId('people-profile-oper-role'))
      .toHaveTextContent('IRC operator on this network');
  });

  it('shows no network role for a member WHOIS never marked as an operator', () => {
    seedRoom([makeUser('me', { modes: new Set(['o']) }), makeUser('bob')]);
    store.setState({
      whoisData: new Map([['bob', { nick: 'bob', loading: false }]]),
    });

    render(() => <PeopleProfileCard nick="bob" channel="#general" />);
    expect(screen.queryByTestId('people-profile-oper-role')).toBeNull();
  });

  it('hides Message, Block, and Report on your own card', () => {
    seedRoom([makeUser('me', { modes: new Set(['o']) })]);

    render(() => <PeopleProfileCard nick="me" channel="#general" />);

    expect(screen.getByRole('region', { name: 'me' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send DM to me' })).toBeNull();
    expect(screen.queryByTestId('member-card-block')).toBeNull();
    expect(screen.queryByTestId('member-card-report')).toBeNull();
    fireEvent.click(screen.getByTestId(PEOPLE_PROFILE_ADVANCED_TESTID));
    expect(screen.getByRole('button', { name: 'View profile of me' })).toBeInTheDocument();
  });

  it('marks a nameless account as Guest and still offers Block', () => {
    seedRoom([makeUser('me'), makeUser('wanderer')]);

    render(() => <PeopleProfileCard nick="wanderer" channel="#general" />);

    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByTestId('member-card-block')).toBeInTheDocument();
  });

  it('asks before blocking, then hides their messages via ignore', () => {
    seedRoom([makeUser('me'), makeUser('bob')], 'me');
    store.setState({
      server: {
        id: 'people-card',
        name: 'People',
        network: 'People',
        url: 'wss://people-card.test/ws',
        icon: '',
        nick: 'me',
        account: 'me',
        connected: true,
      },
    });

    render(() => (
      <>
        <PeopleProfileCard nick="bob" channel="#general" />
        <PersonSafetyHost />
      </>
    ));

    fireEvent.click(screen.getByTestId('member-card-block'));
    expect(store.getState().ignoredUsers.has('bob')).toBe(false);
    fireEvent.click(screen.getByTestId('person-block-confirm'));
    expect(store.getState().ignoredUsers.has('bob')).toBe(true);
  });

  it('unblocks from the same card and refuses a new DM while blocked', () => {
    seedRoom([makeUser('me'), makeUser('bob')]);
    store.setState({
      server: {
        id: 'people-card',
        name: 'People',
        network: 'People',
        url: 'wss://people-card.test/ws',
        icon: '',
        nick: 'me',
        account: 'me',
        connected: true,
      },
    });
    store.getState().ignoreUser('bob');
    const navigate = vi.fn();
    const addToast = vi.fn();
    store.setState({ navigate, addToast });

    render(() => <PeopleProfileCard nick="bob" channel="#general" />);

    fireEvent.click(screen.getByRole('button', { name: 'Send DM to bob' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'You blocked bob',
    }));

    fireEvent.click(screen.getByTestId('member-card-block'));
    expect(store.getState().ignoredUsers.has('bob')).toBe(false);
  });
});
