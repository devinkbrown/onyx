// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MemberList.a11y.test.tsx — accessibility semantics of the channel roster.
 *
 * These assert the load-bearing a11y contract, not markup shape:
 *  - the member count is NOT a live region (no bare-integer join/leave spam)
 *    but still carries an accessible name for on-demand reading (SC 4.1.3);
 *  - a member's role/prefix is exposed to assistive tech in text — announced
 *    exactly once, never doubled, and never by glyph/colour alone (SC 1.4.1,
 *    4.1.2);
 *  - each row is a real keyboard-operable control that opens a dialog and
 *    closes on Escape (SC 2.1.1, 2.1.2).
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseIRCMessage } from '@/lib/irc/parser';
import { _beginNamesBurstForTests, _resetNamesBurstsForTests, store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { MemberList } from './MemberList';

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    modeToPrefix: { Y: '*', Q: '!', q: '~', a: '&', o: '@', h: '%', v: '+' } as Record<string, string>,
    prefixToMode: { '*': 'Y', '!': 'Q', '.': 'q', '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' } as Record<string, string>,
  };
}

function makeUser(nick: string, modes: string[] = [], extra: Partial<ChannelUser> = {}): ChannelUser {
  return { nick, modes: new Set(modes), ...extra };
}

function makeChannel(name: string, users: ChannelUser[]): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) usersMap.set(u.nick.toLowerCase(), u);
  return {
    name,
    topic: 'Welcome',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function seedChannel(users: ChannelUser[], ourNick = 'me') {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general', users));
  store.setState({
    ...initialState,
    client: client as never,
    channels,
    ourNick,
    activeView: { kind: 'channel', channel: '#general' },
    connectionStatus: 'connected',
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initialState, true);
  _resetNamesBurstsForTests();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('MemberList accessibility', () => {
  it('exposes the member count with an accessible name but NOT as a live region', () => {
    // A polite live region here re-announces a bare integer on every join/leave,
    // history replay, and ?at= time-travel — spam. It must be readable on demand
    // without shouting on each membership change.
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    render(() => <MemberList />);

    const count = screen.getByLabelText('2 members');
    expect(count).toHaveTextContent('2');
    expect(count).not.toHaveAttribute('aria-live');
    expect(count).not.toHaveAttribute('aria-atomic');
  });

  it('singularises the accessible count name', () => {
    seedChannel([makeUser('me', ['o'])]);

    render(() => <MemberList />);

    expect(screen.getByLabelText('1 member')).toBeInTheDocument();
  });

  it('announces a member role in text exactly once, not doubled by the badge glyph', () => {
    // The row already states the role in its sr-only summary; the coloured glyph
    // badge must be decorative so screen readers do not read the role twice.
    seedChannel([makeUser('me', ['o']), makeUser('opal', ['o'])]);

    render(() => <MemberList />);

    const trigger = screen.getByRole('button', { name: /Open member details for opal, Op/ });

    // The visible role badge is present but marked decorative (glyph only).
    const badge = trigger.querySelector('.shell-role-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).not.toHaveAttribute('aria-label');

    // "Op" appears once in the accessible name, not twice.
    const occurrences = (trigger.getAttribute('aria-label') ?? trigger.textContent ?? '')
      .match(/\bOp\b/g)?.length ?? 0;
    // textContent-derived name (jsdom) counts the visible glyph-free summary once.
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it('conveys away status in text, not colour/opacity alone', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', [], { away: true })]);

    render(() => <MemberList />);

    expect(screen.getByRole('button', { name: /Open member details for bob, Member, away/ })).toBeInTheDocument();
  });

  it('keeps an away member visibly away when NAMES refreshes their role', () => {
    seedChannel([
      makeUser('me'),
      makeUser('bob', ['v'], { away: true, account: 'bob-account' }),
      makeUser('ghost'),
    ]);
    render(() => <MemberList />);

    _beginNamesBurstForTests('#general');
    store.getState()._handleMessage(parseIRCMessage(':irc 353 me = #general :me @bob alice'));
    store.getState()._handleMessage(parseIRCMessage(':irc 366 me #general :End of /NAMES list.'));

    expect(screen.getByLabelText('3 members')).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: /Open member details for ghost/ })).toBeNull();
    const bob = screen.getByRole('button', { name: /Open member details for bob, Op, away/ });
    expect(bob.querySelector('.shell-member-row')).toHaveClass('shell-member-row--away');

    fireEvent.click(bob);
    expect(screen.getByText('~bob-account')).toBeInTheDocument();
  });

  it('opens a member dialog from a keyboard-operable button and closes on Escape', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    render(() => <MemberList />);

    const trigger = screen.getByRole('button', { name: /Open member details for bob, Voice/ });
    // A real button — reachable and activatable by keyboard (SC 2.1.1).
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Member details for bob' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Escape dismisses the overlay (SC 2.1.2 — no keyboard trap).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Member details for bob' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
