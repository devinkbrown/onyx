// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { cleanup, render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { AccountPanel } from './Account';
import { store, getState, type Server } from '@/lib/store';
import * as dmCipher from '@/lib/e2ee/dmCipher';
import * as clipboard from '@/lib/clipboard/writeClipboardText';

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
  vi.unstubAllGlobals();
});

describe('Account panel — guest state', () => {
  it('shows the guest empty state when not logged in', () => {
    renderPanel({ account: null });
    expect(screen.getByTestId('account-guest')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /browsing as a guest/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Account claim steps' })).toBeInTheDocument();
    expect(screen.getByText('Register the name you are using.')).toBeInTheDocument();
    expect(screen.getByText('Bind a passkey or certificate after sign-in.')).toBeInTheDocument();
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

  it('lets a guest return to Connect to claim the account', () => {
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});
    const closeSpy = vi.fn();
    store.setState({
      client: makeClient() as never,
      server: seedServer(null),
    });
    render(() => <AccountPanel open={true} onOpenChange={closeSpy} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Connect to claim' }));

    expect(disconnectSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledWith(false);
  });
});

describe('Account panel — signed in', () => {
  function seedTotpEnrollment(): void {
    store.setState({
      totp: {
        status: 'pending',
        secret: 'JBSWY3DPEHPK3PXP',
        otpauth: 'otpauth://totp/Onyx:alice?secret=JBSWY3DPEHPK3PXP',
        error: null,
        busy: false,
      },
    });
  }

  it('shows the account name and fetches ACCOUNTINFO on open', () => {
    const { client } = renderPanel({ account: 'alice' });
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(client.sendRaw).toHaveBeenCalledWith('ACCOUNTINFO');
  });

  it('reports authenticator copy success only after the shared write resolves', async () => {
    seedTotpEnrollment();
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const writeClipboardText = vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    renderPanel({ account: 'alice' });

    const copy = screen.getByRole('button', { name: 'Copy secret' });
    fireEvent.click(copy);
    fireEvent.click(copy);

    expect(writeClipboardText).toHaveBeenCalledOnce();
    expect(writeClipboardText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Authenticator secret copied to clipboard.')).not.toBeInTheDocument();
    resolveCopy(true);
    expect(await screen.findByText('Authenticator secret copied to clipboard.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Copied' })).not.toBeDisabled();
  });

  it('does not claim an authenticator value was copied when every pathway fails', async () => {
    seedTotpEnrollment();
    vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(false);
    renderPanel({ account: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy otpauth link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard copy failed');
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });

  it('ignores a secret copy completion after the account panel unmounts', async () => {
    seedTotpEnrollment();
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    const view = renderPanel({ account: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }));
    view.unmount();
    resolveCopy(true);
    await pending;
    await Promise.resolve();

    expect(screen.queryByText('Authenticator secret copied to clipboard.')).not.toBeInTheDocument();
  });

  it('exposes dense account sections as named regions', () => {
    renderPanel({ account: 'alice' });

    expect(screen.getByRole('region', { name: 'Account summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Password' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Protection' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Device encryption keys' })).toBeInTheDocument();
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

  it('lists E2EE device keys and refreshes key transparency status', () => {
    const listSpy = vi.spyOn(getState(), 'e2eeKeyList');
    const deleteSpy = vi.spyOn(getState(), 'e2eeKeyDelete');
    const statusSpy = vi.spyOn(getState(), 'keyTransparencyStatus');
    renderPanel({ account: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: 'List device keys' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove legacy browser key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transparency root' }));

    expect(listSpy).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('browser');
    expect(statusSpy).toHaveBeenCalled();
  });

  it('publishes this browser under its derived stable device id', async () => {
    vi.spyOn(dmCipher, 'deviceKeys').mockResolvedValue({
      publicB64: 'validated-public-key',
      keyPair: {} as CryptoKeyPair,
    });
    vi.spyOn(dmCipher, 'deviceRegistryId').mockResolvedValue('web-stable-device-id');
    const addSpy = vi.spyOn(getState(), 'e2eeKeyAdd');
    renderPanel({ account: 'alice' });

    fireEvent.click(screen.getByRole('button', { name: 'Publish this device key' }));

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(
        'web-stable-device-id',
        'tsumugi-p256',
        'validated-public-key',
      );
    });
  });

  it('surfaces E2EEKEY and KEYTRANS account notices', () => {
    renderPanel({ account: 'alice' });
    store.setState({
      serviceNotices: [
        { source: 'Account', text: 'E2EEKEY STATUS account=alice devices=1', time: new Date() },
        { source: 'Account', text: 'KEYTRANS STATUS enabled entries=2 root=abc', time: new Date() },
      ],
    });

    expect(screen.getByRole('list', { name: 'E2EE device key notices' })).toBeInTheDocument();
    expect(screen.getByText('E2EEKEY STATUS account=alice devices=1')).toBeInTheDocument();
    expect(screen.getByText('KEYTRANS STATUS enabled entries=2 root=abc')).toBeInTheDocument();
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
