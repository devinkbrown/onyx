// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store, type Server } from '@/lib/store/store';

import { IgnoredUsersControl, sortedIgnoredUsersForTest } from './IgnoredUsersControl';

const initialState = store.getInitialState();
const owner = { serverUrl: 'wss://ignore-pref.test/ws', identity: 'self' } as const;
const server: Server = {
  id: 'ignore-pref-test',
  name: 'IgnorePref',
  network: 'IgnorePref',
  url: owner.serverUrl,
  icon: '',
  nick: owner.identity,
  account: owner.identity,
  connected: true,
};

function seed(ignored: string[] = []): void {
  localStorage.clear();
  store.setState({
    ...initialState,
    server,
    ourNick: owner.identity,
    ignoredUsers: new Set(ignored),
  }, true);
}

describe('sortedIgnoredUsersForTest', () => {
  it('sorts for stable UI order', () => {
    expect(sortedIgnoredUsersForTest(new Set(['zoe', 'alice', 'bob']))).toEqual([
      'alice',
      'bob',
      'zoe',
    ]);
  });
});

describe('IgnoredUsersControl', () => {
  beforeEach(() => {
    seed();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('shows empty state when nobody is ignored', () => {
    render(() => <IgnoredUsersControl />);
    expect(screen.getByTestId('pref-ignored-users-empty')).toHaveTextContent('Your list is clear');
    expect(screen.getByTestId('pref-ignored-users-count')).toHaveTextContent('None');
  });

  it('lists ignored nicks and unignores on click', () => {
    seed(['troublemaker', 'noisebot']);
    render(() => <IgnoredUsersControl />);
    expect(screen.getByTestId('pref-ignored-users-list')).toBeInTheDocument();
    expect(screen.getByText('noisebot')).toBeInTheDocument();
    expect(screen.getByText('troublemaker')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pref-unignore-noisebot'));
    expect(store.getState().ignoredUsers.has('noisebot')).toBe(false);
    expect(store.getState().ignoredUsers.has('troublemaker')).toBe(true);
  });

  it('adds a nick from the input', () => {
    const ignoreSpy = vi.spyOn(store.getState(), 'ignoreUser');
    render(() => <IgnoredUsersControl />);
    fireEvent.input(screen.getByTestId('pref-ignore-nick-input'), {
      target: { value: 'Eve' },
    });
    fireEvent.click(screen.getByTestId('pref-ignore-add'));
    expect(ignoreSpy).toHaveBeenCalledWith('Eve');
    ignoreSpy.mockRestore();
  });

  it('refuses empty and self nicks', () => {
    render(() => <IgnoredUsersControl />);
    fireEvent.click(screen.getByTestId('pref-ignore-add'));
    expect(screen.getByTestId('pref-ignore-error')).toHaveTextContent(/Enter a name to block/i);

    fireEvent.input(screen.getByTestId('pref-ignore-nick-input'), {
      target: { value: 'Self' },
    });
    fireEvent.click(screen.getByTestId('pref-ignore-add'));
    expect(screen.getByTestId('pref-ignore-error')).toHaveTextContent(/yourself/i);
    expect(store.getState().ignoredUsers.size).toBe(0);
  });

  it('communicates device-only scope and refuses duplicates', () => {
    seed(['noisebot']);
    render(() => <IgnoredUsersControl />);
    expect(screen.getByText('This device only')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /muted names on this device/i })).toBeInTheDocument();

    fireEvent.input(screen.getByTestId('pref-ignore-nick-input'), {
      target: { value: 'NoiseBot' },
    });
    fireEvent.click(screen.getByTestId('pref-ignore-add'));
    expect(screen.getByTestId('pref-ignore-error')).toHaveTextContent(/already muted on this device/i);
  });

  it('marks invalid input for assistive technology', () => {
    render(() => <IgnoredUsersControl />);
    const input = screen.getByTestId('pref-ignore-nick-input');
    fireEvent.click(screen.getByTestId('pref-ignore-add'));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'pref-ignore-help');
  });
});
