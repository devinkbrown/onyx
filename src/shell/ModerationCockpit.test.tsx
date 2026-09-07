// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';
import { resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { ModerationCockpit } from './ModerationCockpit';

const initial = store.getInitialState();

function seed(op = true) {
  const client = { sendRaw: vi.fn(() => true) };
  const channel: Channel = {
    name: '#garden', topic: '', topicSetBy: '', topicSetAt: null, modes: '+t',
    users: new Map([[op ? 'me' : 'member', { nick: op ? 'me' : 'member', modes: new Set(op ? ['o'] : []) }], ['ada', { nick: 'ada', modes: new Set() }]]),
    unread: 0, highlights: 0, createdAt: null, messages: [],
  };
  store.setState({
    ...initial,
    client: client as never,
    channels: new Map([['#garden', channel]]),
    ourNick: op ? 'me' : 'member',
    connectionStatus: 'connected',
    server: {
      id: 'garden',
      name: 'Garden',
      network: 'Garden',
      url: 'wss://garden.test',
      icon: '',
      nick: op ? 'me' : 'member',
      account: op ? 'me' : 'member',
      connected: true,
    },
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initial, true);
  resetPreferences();
  setPreference('experienceMode', 'advanced');
});
afterEach(cleanup);

describe('ModerationCockpit', () => {
  it('uses existing permission-gated mode and invite actions', () => {
    const client = seed();
    render(() => <ModerationCockpit channel="#garden" />);

    fireEvent.click(screen.getByRole('button', { name: /Moderated/ }));
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#garden', '+m');
    expect(screen.getByText('Open-wire details')).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText('Invite someone'), { target: { value: 'ada' } });
    fireEvent.submit(screen.getByLabelText('Invite someone').closest('form')!);
    expect(client.sendRaw).toHaveBeenCalledWith('INVITE', 'ada', '#garden');
  });

  it('requires a confirmation before sending a server-side ban', () => {
    const client = seed();
    render(() => <ModerationCockpit channel="#garden" />);
    fireEvent.input(screen.getByLabelText('Block an address in this room'), { target: { value: 'ada!*@*' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review block' }));
    expect(client.sendRaw).not.toHaveBeenCalledWith('MODE', '#garden', '+b', 'ada!*@*');
    fireEvent.click(screen.getByTestId('moderation-review-confirm'));
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#garden', '+b', 'ada!*@*');
  });

  it('does not render change controls for members without moderation permission', () => {
    seed(false);
    render(() => <ModerationCockpit channel="#garden" />);
    expect(screen.getByText(/only room moderators can change/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Room safeguards' })).toBeNull();
  });

  it('keeps form and heading relationships unique across concurrent cockpit surfaces', () => {
    seed();
    render(() => (
      <>
        <ModerationCockpit channel="#garden" />
        <ModerationCockpit channel="#garden" />
      </>
    ));

    const cockpits = screen.getAllByTestId('moderation-cockpit');
    expect(cockpits).toHaveLength(2);
    const inviteIds = cockpits.map((cockpit) => within(cockpit).getByLabelText('Invite someone').id);
    const banIds = cockpits.map((cockpit) => within(cockpit).getByLabelText('Block an address in this room').id);
    expect(new Set(inviteIds).size).toBe(2);
    expect(new Set(banIds).size).toBe(2);
    expect(cockpits.map((cockpit) => cockpit.getAttribute('aria-labelledby'))[0]).not.toBe(
      cockpits.map((cockpit) => cockpit.getAttribute('aria-labelledby'))[1],
    );
  });

  it('keeps an offline draft and reviews member actions before sending', () => {
    const client = seed();
    render(() => <ModerationCockpit channel="#garden" />);

    expect(screen.getByLabelText('Room authority')).toBeInTheDocument();
    expect(screen.queryByText(/temporary|temp ban/i)).toBeNull();

    store.setState({ connectionStatus: 'disconnected' });
    fireEvent.input(screen.getByLabelText('Block an address in this room'), { target: { value: 'ada!*@*' } });
    fireEvent.input(screen.getByLabelText('Invite someone'), { target: { value: 'ada' } });
    expect(screen.getByText(/Drafts stay on this device/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review block' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review block' }));
    expect(client.sendRaw).not.toHaveBeenCalledWith('MODE', '#garden', '+b', 'ada!*@*');

    store.setState({ connectionStatus: 'connected' });
    expect(screen.getByLabelText('Block an address in this room')).toHaveValue('ada!*@*');
    expect(screen.getByLabelText('Invite someone')).toHaveValue('ada');

    fireEvent.change(screen.getByLabelText('Room member action'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review action' }));
    expect(client.sendRaw).not.toHaveBeenCalledWith('KICK', '#garden', 'ada');
    fireEvent.click(screen.getByTestId('moderation-review-confirm'));
    expect(client.sendRaw).toHaveBeenCalledWith('KICK', '#garden', 'ada');
  });

  it('rejects a dangerous wildcard block during review', () => {
    const client = seed();
    render(() => <ModerationCockpit channel="#garden" />);
    fireEvent.input(screen.getByLabelText('Block an address in this room'), { target: { value: '*!*@*' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review block' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/match everyone/);
    expect(screen.getByTestId('moderation-review-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('moderation-review-confirm'));
    expect(client.sendRaw).not.toHaveBeenCalledWith('MODE', '#garden', '+b', '*!*@*');
  });
});
