// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GuestClaimPrompt.test.tsx
 *
 * The in-session "claim your nick" affordance. A guest (server.account === null)
 * who is already chatting can register their CURRENT nick without reconnecting,
 * dispatching the existing store registerAccount() action with the live nick.
 *
 * The store is the single source of truth: we seed reactive state (guest vs
 * signed-in, ourNick) and spy on registerAccount to assert the dispatched nick.
 * The dismissed flag persists under an onyx: localStorage key so it does not nag.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@solidjs/testing-library';
import { GuestClaimPrompt, GUEST_CLAIM_DISMISS_KEY } from './GuestClaimPrompt';
import { store, getState, type Server } from '@/lib/store';

const initialState = store.getInitialState();

function seedServer(account: string | null): Server {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'Onyx',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account ?? 'Nova',
    account,
    connected: true,
  };
}

/** Seed a guest (or signed-in) session with a live nick, then render the prompt. */
function seed(opts?: { account?: string | null; nick?: string }) {
  store.setState({
    server: seedServer(opts?.account ?? null),
    ourNick: opts?.nick ?? 'Nova',
  });
  return render(() => <GuestClaimPrompt />);
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('GuestClaimPrompt', () => {
  it('renders for a guest with a live nick', () => {
    seed({ account: null, nick: 'Nova' });
    expect(screen.getByTestId('guest-claim')).toBeInTheDocument();
    // The live nick is surfaced so the user knows what they are claiming.
    expect(screen.getByTestId('guest-claim')).toHaveTextContent('Nova');
  });

  it('is absent when signed in', () => {
    seed({ account: 'Nova', nick: 'Nova' });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });

  it('is absent when there is no nick yet', () => {
    seed({ account: null, nick: '' });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });

  it('is absent after dismiss and persists the dismissal', () => {
    seed({ account: null, nick: 'Nova' });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
    expect(localStorage.getItem(GUEST_CLAIM_DISMISS_KEY)).toBe('1');
  });

  it('stays absent on mount when previously dismissed', () => {
    localStorage.setItem(GUEST_CLAIM_DISMISS_KEY, '1');
    seed({ account: null, nick: 'Nova' });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });

  it('dispatches registerAccount with the current nick when claimed', () => {
    const spy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {});
    seed({ account: null, nick: 'Nova' });

    // Expand the compact form.
    fireEvent.click(screen.getByRole('button', { name: 'Claim your nick' }));

    const password = screen.getByLabelText(/password/i) as HTMLInputElement;
    fireEvent.input(password, { target: { value: 'hunter2hunter2' } });

    fireEvent.submit(screen.getByRole('form', { name: /claim your nick/i }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Nova', undefined, 'hunter2hunter2');
  });

  it('passes a trimmed email through when provided', () => {
    const spy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {});
    seed({ account: null, nick: 'Nova' });

    fireEvent.click(screen.getByRole('button', { name: 'Claim your nick' }));
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'hunter2hunter2' } });
    fireEvent.input(screen.getByLabelText(/email/i), { target: { value: '  me@example.com  ' } });
    fireEvent.submit(screen.getByRole('form', { name: /claim your nick/i }));

    expect(spy).toHaveBeenCalledWith('Nova', 'me@example.com', 'hunter2hunter2');
  });

  it('does not dispatch without a password', () => {
    const spy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {});
    seed({ account: null, nick: 'Nova' });

    fireEvent.click(screen.getByRole('button', { name: 'Claim your nick' }));
    fireEvent.submit(screen.getByRole('form', { name: /claim your nick/i }));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('surfaces a register error from the store', () => {
    seed({ account: null, nick: 'Nova' });
    fireEvent.click(screen.getByRole('button', { name: 'Claim your nick' }));
    store.setState({ registerError: 'nick already registered' });
    expect(screen.getByRole('alert')).toHaveTextContent(/already registered/i);
  });

  it('auto-hides once the guest becomes signed in', () => {
    seed({ account: null, nick: 'Nova' });
    expect(screen.getByTestId('guest-claim')).toBeInTheDocument();
    // Server confirms the account — the reactive gate flips it off.
    store.setState({ server: seedServer('Nova') });
    expect(screen.queryByTestId('guest-claim')).not.toBeInTheDocument();
  });
});
