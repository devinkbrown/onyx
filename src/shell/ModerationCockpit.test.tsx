// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';
import { ModerationCockpit } from './ModerationCockpit';

const initial = store.getInitialState();

function seed(op = true) {
  const client = { sendRaw: vi.fn() };
  const channel: Channel = {
    name: '#garden', topic: '', topicSetBy: '', topicSetAt: null, modes: '+t',
    users: new Map([[op ? 'me' : 'member', { nick: op ? 'me' : 'member', modes: new Set(op ? ['o'] : []) }], ['ada', { nick: 'ada', modes: new Set() }]]),
    unread: 0, highlights: 0, createdAt: null, messages: [],
  };
  store.setState({ ...initial, client: client as never, channels: new Map([['#garden', channel]]), ourNick: op ? 'me' : 'member', connectionStatus: 'connected' }, true);
  return client;
}

beforeEach(() => store.setState(initial, true));
afterEach(cleanup);

describe('ModerationCockpit', () => {
  it('uses existing permission-gated mode and invite actions', () => {
    const client = seed();
    render(() => <ModerationCockpit channel="#garden" />);

    fireEvent.click(screen.getByRole('button', { name: /Moderated/ }));
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#garden', '+m');
    expect(screen.getByText('IRC details')).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText('Invite someone'), { target: { value: 'ada' } });
    fireEvent.submit(screen.getByLabelText('Invite someone').closest('form')!);
    expect(client.sendRaw).toHaveBeenCalledWith('INVITE', 'ada', '#garden');
  });

  it('requires a confirmation before sending a server-side ban', () => {
    const client = seed();
    render(() => <ModerationCockpit channel="#garden" />);
    fireEvent.input(screen.getByLabelText('Block a matching address'), { target: { value: 'ada!*@*' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review block' }));
    expect(client.sendRaw).not.toHaveBeenCalledWith('MODE', '#garden', '+b', 'ada!*@*');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block' }));
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
    const banIds = cockpits.map((cockpit) => within(cockpit).getByLabelText('Block a matching address').id);
    expect(new Set(inviteIds).size).toBe(2);
    expect(new Set(banIds).size).toBe(2);
    expect(cockpits.map((cockpit) => cockpit.getAttribute('aria-labelledby'))[0]).not.toBe(
      cockpits.map((cockpit) => cockpit.getAttribute('aria-labelledby'))[1],
    );
  });
});
