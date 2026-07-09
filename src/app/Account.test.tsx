/**
 * Account.test.tsx
 *
 * Tests for the Onyx account panel (store-driven).
 *
 * The store is the single source of truth. We seed reactive state (logged-in vs
 * guest, accountInfo, accountActionError) and spy on store actions to assert the
 * panel dispatches the right Orochi command for each affordance — change email,
 * change password, toggle secure/enforce, recover a nick, bind a certificate,
 * sign out, and the guarded account deletion (DROP).
 *
 * No live client is needed: a mock client captures the raw command lines so the
 * effect that fetches ACCOUNTINFO on open has something to call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@solidjs/testing-library';
import { AccountPanel } from './Account';
import { store, getState, type Server } from '@/lib/store';

const initialState = store.getInitialState();

/** Minimal IRCClient stand-in — captures the raw command lines the panel sends. */
function makeClient() {
  return { sendRaw: vi.fn() };
}

function seedServer(account: string | null): Server {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'IRCXNet',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account ?? 'guest',
    account,
    connected: true,
  };
}

/** Render the panel open, with a mock client and an optional logged-in account. */
function renderPanel(opts?: { account?: string | null }) {
  const client = makeClient();
  store.setState({
    client: client as never,
    server: seedServer(opts?.account ?? null),
  });
  const result = render(() => <AccountPanel open={true} onOpenChange={() => {}} />);
  return { client, ...result };
}

beforeEach(() => {
  store.setState(initialState, true);
});

afterEach(() => {
  cleanup();
  // Restore any spies — the store is a module singleton, so an un-restored
  // vi.spyOn on a state action would leak into the next test.
  vi.restoreAllMocks();
});

describe('Account panel — guest state', () => {
  it('shows the guest empty state when not logged in', () => {
    renderPanel({ account: null });
    expect(screen.getByTestId('account-guest')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /browsing as a guest/i }),
    ).toBeInTheDocument();
  });

  it('does not render management sections for a guest', () => {
    renderPanel({ account: null });
    expect(screen.queryByTestId('account-signout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-drop-arm')).not.toBeInTheDocument();
  });

  it('does not fetch ACCOUNTINFO for a guest', () => {
    const { client } = renderPanel({ account: null });
    expect(client.sendRaw).not.toHaveBeenCalledWith('ACCOUNTINFO');
  });
});

describe('Account panel — signed in', () => {
  it('shows the account name and fetches ACCOUNTINFO on open', () => {
    const { client } = renderPanel({ account: 'alice' });
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(client.sendRaw).toHaveBeenCalledWith('ACCOUNTINFO');
  });

  it('exposes dense account sections as named regions', () => {
    renderPanel({ account: 'alice' });

    expect(screen.getByRole('region', { name: 'Account summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Password' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Protection' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('renders structured account facts from accountInfo', () => {
    store.setState({
      accountInfo: {
        account: 'alice',
        flags: 8,
        email: 'alice@example.net',
        secure: true,
        enforce: false,
        fetchedAt: new Date(),
      },
    });
    renderPanel({ account: 'alice' });
    expect(screen.getByText('alice@example.net')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('change email dispatches ACCOUNTSET email', () => {
    const spy = vi.spyOn(getState(), 'accountSet');
    renderPanel({ account: 'alice' });

    fireEvent.input(screen.getByLabelText('Email address'), {
      target: { value: 'new@example.net' },
    });
    fireEvent.input(screen.getByLabelText(/confirm email change/i), {
      target: { value: 'hunter2' },
    });
    fireEvent.submit(screen.getByLabelText('Change email'));

    expect(spy).toHaveBeenCalledWith('email', 'new@example.net', 'hunter2');
  });

  it('change password dispatches ACCOUNTSET password and validates match', () => {
    const spy = vi.spyOn(getState(), 'accountSet');
    renderPanel({ account: 'alice' });

    fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'brand-new-pass' },
    });
    fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'mismatch' },
    });
    fireEvent.input(screen.getByLabelText(/authorize change/i), {
      target: { value: 'old-pass' },
    });
    fireEvent.submit(screen.getByLabelText('Change password'));
    // Mismatch — must not dispatch.
    expect(spy).not.toHaveBeenCalled();

    fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'brand-new-pass' },
    });
    fireEvent.submit(screen.getByLabelText('Change password'));
    expect(spy).toHaveBeenCalledWith('password', 'brand-new-pass', 'old-pass');
  });

  it('toggling secure requires a password, then dispatches ACCOUNTSET secure', () => {
    const setSpy = vi.spyOn(getState(), 'accountSet');
    const noteSpy = vi.spyOn(getState(), 'addNotification');
    renderPanel({ account: 'alice' });

    const secureSwitch = screen.getByLabelText('Toggle secure');
    // No password yet — flips, but we expect a guidance notification, not a send.
    fireEvent.change(secureSwitch, { target: { checked: true } });
    expect(setSpy).not.toHaveBeenCalled();
    expect(noteSpy).toHaveBeenCalled();

    fireEvent.input(screen.getByLabelText(/account password/i), {
      target: { value: 'hunter2' },
    });
    fireEvent.change(secureSwitch, { target: { checked: true } });
    expect(setSpy).toHaveBeenCalledWith('secure', 'on', 'hunter2');
  });

  it('recover dispatches RECOVER with the nick', () => {
    const spy = vi.spyOn(getState(), 'recover');
    renderPanel({ account: 'alice' });

    fireEvent.input(screen.getByLabelText('Nick'), { target: { value: 'alice' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Recover a nick' }));
    expect(spy).toHaveBeenCalledWith('alice', undefined);
  });

  it('bind-certificate calls certAdd + certList', () => {
    const addSpy = vi.spyOn(getState(), 'certAdd');
    const listSpy = vi.spyOn(getState(), 'certList');
    renderPanel({ account: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: /bind this connection's certificate/i }));
    expect(addSpy).toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalled();
  });

  it('sign out dispatches LOGOUT', () => {
    const spy = vi.spyOn(getState(), 'logout');
    renderPanel({ account: 'alice' });
    fireEvent.click(screen.getByTestId('account-signout'));
    expect(spy).toHaveBeenCalled();
  });

  it('labels persona actions with the persona name', () => {
    renderPanel({ account: 'alice' });
    store.setState({
      personas: [{ name: 'poet', host: 'poets.society/alice', source: 'grant' }],
    });

    expect(screen.getByRole('button', { name: 'Wear persona poet' })).toBeInTheDocument();
  });

  it('surfaces the last action error', () => {
    renderPanel({ account: 'alice' });
    // Set the error AFTER mount: opening the panel fetches ACCOUNTINFO, which
    // clears any stale error first. A subsequent FAIL reply repopulates it.
    store.setState({
      accountActionError: { command: 'ACCOUNTSET', code: 'INVALID_VALUE', description: 'Bad value' },
    });
    const err = screen.getByTestId('account-error');
    expect(err).toHaveTextContent(/ACCOUNTSET/);
    expect(err).toHaveTextContent(/Bad value/);
  });
});

describe('Account panel — guarded deletion (DROP)', () => {
  it('requires arming + typed confirmation + password before DROP', () => {
    const spy = vi.spyOn(getState(), 'dropAccount');
    renderPanel({ account: 'alice' });

    // Arm the danger zone.
    fireEvent.click(screen.getByTestId('account-drop-arm'));

    // Confirm button is present but disabled until inputs match.
    const confirmBtn = screen.getByTestId('account-drop-confirm') as HTMLButtonElement;
    expect(confirmBtn).toBeDisabled();

    // Wrong confirmation text — stays disabled.
    fireEvent.input(screen.getByLabelText(/type "alice" to confirm/i), {
      target: { value: 'bob' },
    });
    fireEvent.input(screen.getByLabelText('Account password'), {
      target: { value: 'hunter2' },
    });
    expect(confirmBtn).toBeDisabled();

    // Correct confirmation — enables and dispatches DROP.
    fireEvent.input(screen.getByLabelText(/type "alice" to confirm/i), {
      target: { value: 'alice' },
    });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.submit(screen.getByLabelText('Confirm account deletion'));
    expect(spy).toHaveBeenCalledWith('alice', 'hunter2');
  });
});
