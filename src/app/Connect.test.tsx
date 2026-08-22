// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Connect.test.tsx
 *
 * Tests for the Onyx connect screen (store-driven).
 *
 * The store is the single source of truth. We spy on store actions to assert
 * correct invocation, and we seed reactive state directly to verify that the
 * form / AppShell gate, guest join + secondary Sign in / Create account,
 * validation, the register → verify flow, and the GHOST / resume affordances
 * behave.
 *
 * There is no server picker: the client auto-selects a transport endpoint.
 * We therefore assert the connect URL is *one of* the known endpoints,
 * never a specific one. No live WebSocket is needed (probing is stubbed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@solidjs/testing-library';
import { Connect } from './Connect';
import { NODES, selectBestNode } from './nodes';
import { store, getState } from '@/lib/store';
import { preferences, resetPreferences } from '@/lib/prefs/preferences';
import { loadCredentials } from '@/lib/credentials';
import { peekFirstHourHandoff, resetFirstHourForTests } from '@/lib/firstHour/firstHour';

// Connect owns only the form/shell gate. Keep its unit suite isolated from the
// large lazy shell graph while preserving the disconnect callback contract.
vi.mock('@/shell/AppShell', () => ({
  AppShell: (props: { onDisconnect: () => void }) => (
    <div data-testid="app-shell">
      <button type="button" onClick={() => props.onDisconnect()}>Disconnect</button>
    </div>
  ),
}));

// The connect screen probes node latency through lightweight HTTPS on mount.
// In jsdom that would hit the live web tiers, so stub the probe + selector here —
// real latency routing is exercised in the browser / e2e, not in unit tests.
vi.mock('./nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nodes')>();
  return {
    ...actual,
    pingNode: vi.fn(async () => Number.POSITIVE_INFINITY),
    selectBestNode: vi.fn(async () => actual.NODES[0]),
  };
});

/** Set of every valid mesh endpoint the auto-router may pick. */
const NODE_URLS = new Set(NODES.map((n) => n.wss));

// ── Store reset ────────────────────────────────────────────────────────────────

const initialState = store.getInitialState();
let restorePasskeyEnvironment: (() => void) | undefined;

function enablePasskeys(): void {
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  const publicKeyDescriptor = Object.getOwnPropertyDescriptor(window, 'PublicKeyCredential');
  const credentialsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'credentials');

  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: class TestPublicKeyCredential {},
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create: vi.fn(), get: vi.fn() },
  });

  restorePasskeyEnvironment = () => {
    if (secureDescriptor) Object.defineProperty(window, 'isSecureContext', secureDescriptor);
    else Reflect.deleteProperty(window, 'isSecureContext');
    if (publicKeyDescriptor) Object.defineProperty(window, 'PublicKeyCredential', publicKeyDescriptor);
    else Reflect.deleteProperty(window, 'PublicKeyCredential');
    if (credentialsDescriptor) Object.defineProperty(navigator, 'credentials', credentialsDescriptor);
    else Reflect.deleteProperty(navigator, 'credentials');
  };
}

beforeEach(() => {
  store.setState(initialState, true);
  window.history.pushState({}, '', '/app');
  // Each test starts from a clean localStorage so a remembered session from one
  // test never bleeds into the next.
  try {
    window.localStorage.clear();
  } catch { /* ignore */ }
  resetPreferences();
  resetFirstHourForTests();
});

afterEach(() => {
  cleanup();
  restorePasskeyEnvironment?.();
  restorePasskeyEnvironment = undefined;
  vi.restoreAllMocks();
  resetFirstHourForTests();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function clickMode(name: RegExp): void {
  if (/guest/i.test(name.source)) {
    fireEvent.click(screen.getByTestId('conn-mode-guest'));
    return;
  }
  if (/sign in/i.test(name.source)) {
    fireEvent.click(screen.getByTestId('conn-mode-signin'));
    return;
  }
  fireEvent.click(screen.getByTestId('conn-mode-register'));
}

function nickField(): HTMLElement {
  return screen.getByRole('textbox', { name: /^(display name|name|account name)$/i });
}

function visibleCopy(): string {
  const root = screen.getByTestId('connect-screen');
  const heading = root.querySelector('.conn-title')?.textContent ?? '';
  const sub = root.querySelector('.conn-sub')?.textContent ?? '';
  const fields = [...root.querySelectorAll('.onyx-field, .conn-alt, .conn-foot, .conn-status')]
    .map((node) => node.textContent ?? '')
    .join(' ');
  return `${heading} ${sub} ${fields}`;
}

// ── Rendering ────────────────────────────────────────────────────────────────

describe('Connect screen rendering', () => {
  it('renders the guest join heading', () => {
    render(() => <Connect />);
    expect(screen.getByRole('heading', { name: /join a room/i })).toBeInTheDocument();
  });

  it('does not expose a server picker or any node hostnames', () => {
    render(() => <Connect />);
    expect(screen.queryByRole('button', { name: /select ircx\.us/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/ircx\.us/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/eshmaki\.me/i)).not.toBeInTheDocument();
  });

  it('never uses infrastructure or identity-mode copy on the first screen', () => {
    render(() => <Connect />);
    expect(visibleCopy()).not.toMatch(
      /claim path|nearest node|handshake|tonight on the water|mesh is listening|auto-routed|\birc\b|\bsasl\b/i,
    );
  });

  it('has no Add to Home Screen or install CTA on first-run Connect', () => {
    render(() => <Connect />);
    expect(visibleCopy()).not.toMatch(/add to home screen|install the app|install onyx|beforeinstallprompt/i);
    expect(screen.queryByTestId('a2hs-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('a2hs-add')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add to home screen|install/i })).not.toBeInTheDocument();
  });

  it('has no notification permission ask on first-run Connect', () => {
    render(() => <Connect />);
    expect(screen.queryByTestId('first-run-notify')).not.toBeInTheDocument();
    expect(screen.queryByTestId('first-run-notify-enable')).not.toBeInTheDocument();
    expect(visibleCopy()).not.toMatch(/get a ping when you leave|closed-tab notifications|turn on alerts/i);
    expect(screen.queryByRole('button', { name: /turn on|enable desktop notifications/i })).not.toBeInTheDocument();
  });

  it('aborts its latency selection when the connect screen unmounts', async () => {
    let selectionSignal: AbortSignal | undefined;
    vi.mocked(selectBestNode).mockImplementationOnce((_nodes, options) => {
      selectionSignal = options?.signal;
      return new Promise(() => {});
    });
    const view = render(() => <Connect />);
    await waitFor(() => expect(selectionSignal).toBeDefined());

    view.unmount();

    expect(selectionSignal?.aborted).toBe(true);
  });

  it('keeps sign in and create account as secondary actions', () => {
    render(() => <Connect />);
    expect(screen.getByTestId('conn-mode-signin')).toHaveTextContent(/sign in/i);
    expect(screen.getByTestId('conn-mode-register')).toHaveTextContent(/create account/i);
    expect(screen.queryByTestId('conn-mode-guest')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('defaults to guest join', () => {
    render(() => <Connect />);
    expect(screen.getByTestId('connect-screen')).toHaveAttribute('data-mode', 'guest');
    expect(visibleCopy()).toMatch(/join free/i);
    expect(visibleCopy()).toMatch(/send a message/i);
  });

  it('renders the display name field', () => {
    render(() => <Connect />);
    expect(nickField()).toBeInTheDocument();
  });

  it('hides the password field in Guest mode', () => {
    render(() => <Connect />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('hides stay-signed-in and recovery details on the first screen', () => {
    render(() => <Connect />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/recovery email|passkey|certificate|session token/i)).not.toBeInTheDocument();
  });

  it('renders the join button', () => {
    render(() => <Connect />);
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/^join$/i);
  });

  it('renders the status region', () => {
    render(() => <Connect />);
    expect(screen.getByTestId('conn-status')).toBeInTheDocument();
  });

  it('shows the connect form when connectionStatus is disconnected', () => {
    store.setState({ ...initialState, connectionStatus: 'disconnected' }, true);
    render(() => <Connect />);
    expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
  });
});

// ── Mode switching ─────────────────────────────────────────────────────────────

describe('Mode switching', () => {
  it('reveals an account password field in Sign in mode', () => {
    render(() => <Connect />);
    clickMode(/sign in/i);
    expect(screen.getByTestId('connect-screen')).toHaveAttribute('data-mode', 'signin');
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
  });

  it('reveals email, password, confirm, and a strength meter in Register mode', () => {
    render(() => <Connect />);
    clickMode(/register/i);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it('hides the stay-signed-in toggle in Register mode', () => {
    render(() => <Connect />);
    clickMode(/register/i);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('changes the submit label per mode', () => {
    render(() => <Connect />);
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/^join$/i);
    clickMode(/sign in/i);
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/sign in/i);
    clickMode(/register/i);
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/create account/i);
  });
});

// ── Passkey sign-in ─────────────────────────────────────────────────────────

describe('Passkey sign-in', () => {
  it('does not present passkeys on Connect even when WebAuthn exists', () => {
    enablePasskeys();
    render(() => <Connect />);
    expect(screen.queryByTestId('conn-passkey-primary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conn-passkey-submit')).not.toBeInTheDocument();
    expect(visibleCopy()).not.toMatch(/passkey/i);

    clickMode(/sign in/i);
    expect(screen.queryByTestId('conn-passkey-primary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conn-passkey-submit')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/sign in/i);
    expect(screen.getByTestId('conn-status')).not.toHaveTextContent(/passkey/i);
  });

  it('keeps password as the primary path when WebAuthn is unavailable', async () => {
    render(() => <Connect />);
    clickMode(/sign in/i);

    expect(screen.queryByTestId('conn-passkey-primary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conn-passkey-submit')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/sign in/i);
    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveTextContent(
        /enter your name and password to continue/i,
      ),
    );
  });
});

// ── Password show / hide ───────────────────────────────────────────────────────

describe('Password visibility toggle', () => {
  it('toggles the account-password input between password and text', () => {
    render(() => <Connect />);
    clickMode(/sign in/i);
    const input = screen.getByLabelText(/account password/i) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input.type).toBe('password');
  });
});

// ── Nick validation ────────────────────────────────────────────────────────────

describe('Nick validation', () => {
  it('shows an error when the nick field is empty on submit', async () => {
    render(() => <Connect />);
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument());
  });

  it('shows an error when the nick starts with a digit', async () => {
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: '1bad' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/must start with/i)).toBeInTheDocument());
  });

  it('shows an error for a nick that is too long (>64 chars)', async () => {
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: 'a'.repeat(65) } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/64 characters or fewer/i)).toBeInTheDocument());
  });

  it('clears the nick error when the user types again', async () => {
    render(() => <Connect />);
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument());
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    await waitFor(() => expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument());
  });
});

// ── Register validation ────────────────────────────────────────────────────────

describe('Register validation', () => {
  it('rejects a short password', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'short' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument());
  });

  it('rejects mismatched confirm password', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'different1' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument());
  });

  it('rejects a malformed email', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'longenough1' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/valid email/i)).toBeInTheDocument());
  });
});

// ── Guest connect ──────────────────────────────────────────────────────────────

describe('Guest connect', () => {
  it('calls connect with an auto-selected mesh node url and nick on submit', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    const call = connectSpy.mock.calls[0]![0];
    expect(NODE_URLS.has(call.url)).toBe(true);
    expect(call.nick).toBe('kain');
    expect(call.password).toBeUndefined();
    connectSpy.mockRestore();
  });

  it('does not call connect when nick is invalid', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.submit(document.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 50));
    expect(connectSpy).not.toHaveBeenCalled();
    connectSpy.mockRestore();
  });
});

// ── Sign in ────────────────────────────────────────────────────────────────────

describe('Sign in connect', () => {
  it('calls connect with the account password', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: 'hunter2!' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].password).toBe('hunter2!');
    connectSpy.mockRestore();
  });

  it('blocks submit until a password is entered', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    // submit button is disabled with no password; force the submit anyway
    fireEvent.submit(document.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 30));
    expect(connectSpy).not.toHaveBeenCalled();
    connectSpy.mockRestore();
  });

  it('persists the exact password when Stay signed in is enabled', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.click(screen.getByRole('switch', { name: 'Stay signed in' }));
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: '  spaced password  ' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].password).toBe('  spaced password  ');
    expect(loadCredentials()).toMatchObject({
      nick: 'kain',
      password: '  spaced password  ',
    });
    connectSpy.mockRestore();
  });

  it('does not persist credentials when Stay signed in is disabled', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: 'hunter2!' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(loadCredentials()).toBeNull();
    connectSpy.mockRestore();
  });

  it('makes password persistence explicit and opt-in', () => {
    render(() => <Connect />);
    clickMode(/sign in/i);

    expect(screen.getByRole('switch', { name: 'Stay signed in' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/saves your account password in this browser/i)).toBeInTheDocument();
    expect(screen.getByText(/only on a private device/i)).toBeInTheDocument();
  });

  it('does not expose a stale resume token to a normal stay-off sign-in', async () => {
    const selected = NODES[0]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${selected.wss}|kain`,
        entries: {
          [`${selected.wss}|kain`]: {
            nick: 'kain',
            server: selected.wss,
            password: 'old-password',
            meshToken: 'stale-mesh-token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    let tokenSeenByConnect: string | undefined;
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation((opts) => {
      tokenSeenByConnect = loadCredentials(opts.url, opts.nick)?.meshToken;
    });
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    clickMode(/sign in/i);
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: 'new-password' } });

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(tokenSeenByConnect).toBeUndefined();
    expect(loadCredentials()).toBeNull();
    connectSpy.mockRestore();
  });
});

// ── Register → verify flow ──────────────────────────────────────────────────────

describe('Register → verify → done flow', () => {
  it('connects first, then fires registerAccount once connected', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      // Simulate the client coming up.
      store.setState({ connectionStatus: 'connected' });
    });
    // Mirror the real store action: REGISTER marks a request in flight.
    const registerSpy = vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });

    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/email/i), { target: { value: 'kain@example.com' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'longenough1' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    await waitFor(() => expect(registerSpy).toHaveBeenCalledOnce());
    const args = registerSpy.mock.calls[0]!;
    expect(args[0]).toBe('kain');
    expect(args[1]).toBe('kain@example.com');
    expect(args[2]).toBe('longenough1');

    connectSpy.mockRestore();
    registerSpy.mockRestore();
  });

  it('does not finish an Alice registration after Bob logs in', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connected' });
    });
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const disconnectSpy = vi.spyOn(getState(), 'disconnect').mockImplementation(() => {});

    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'alice' } });
    fireEvent.input(screen.getByLabelText(/email/i), { target: { value: 'alice@example.com' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'longenough1' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(getState().registerAccount).toHaveBeenCalledOnce());

    store.setState({
      server: {
        id: 'bob-session',
        name: 'Onyx',
        network: 'Onyx',
        url: NODES[0]!.wss,
        icon: '',
        nick: 'bob',
        account: 'bob',
        connected: true,
      },
      registerPending: false,
      registerError: null,
      verifyRequired: false,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledOnce();
  });

  it('shows a spinner while registerPending is true', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    store.setState({ registerPending: true });
    await waitFor(() => expect(screen.getByRole('status', { name: /creating account/i })).toBeInTheDocument());
  });

  it('surfaces registerError inline', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    store.setState({ registerError: 'Account already exists' });
    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveTextContent(/account already exists/i)
    );
  });

  it('reveals the verification step and calls verifyAccount, then connects on success', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connected' });
    });
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    const verifySpy = vi.spyOn(getState(), 'verifyAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null });
    });

    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'longenough1' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalled());

    // Server reports a verification code is required (REGISTER VERIFICATION_REQUIRED).
    store.setState({ verifyRequired: true, registerPending: false });

    // The verify form appears.
    await waitFor(() => expect(screen.getByTestId('conn-verify-form')).toBeInTheDocument());

    fireEvent.input(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.submit(screen.getByTestId('conn-verify-form'));

    await waitFor(() => expect(verifySpy).toHaveBeenCalledOnce());
    expect(verifySpy.mock.calls[0]![0]).toBe('kain');
    expect(verifySpy.mock.calls[0]![1]).toBe('123456');

    // VERIFY SUCCESS clears verifyRequired → the component connects under the
    // freshly-registered account.
    const connectCallsBefore = connectSpy.mock.calls.length;
    store.setState({ verifyRequired: false, registerPending: false, registerError: null });
    await waitFor(() => expect(connectSpy.mock.calls.length).toBeGreaterThan(connectCallsBefore));

    vi.restoreAllMocks();
  });

  it('shows an error when the verification code is empty', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'longenough1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'longenough1' } });

    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connected' });
    });
    vi.spyOn(getState(), 'registerAccount').mockImplementation(() => {
      store.setState({ registerPending: true, registerError: null, verifyRequired: false });
    });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(connectSpy).toHaveBeenCalled());

    store.setState({ verifyRequired: true, registerPending: false });
    await waitFor(() => expect(screen.getByTestId('conn-verify-form')).toBeInTheDocument());

    fireEvent.submit(screen.getByTestId('conn-verify-form'));
    await waitFor(() => expect(screen.getByText(/enter the verification code/i)).toBeInTheDocument());

    vi.restoreAllMocks();
  });
});

// ── GHOST reclaim ──────────────────────────────────────────────────────────────

describe('GHOST reclaim', () => {
  it('offers reclaim when the nick is in use after a failed connect', async () => {
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: 'kain' } });

    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
      setTimeout(() => store.setState({ connectionStatus: 'disconnected', currentNickIsAlias: true }), 0);
    });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(screen.getByTestId('conn-reclaim-open')).toBeInTheDocument());
    connectSpy.mockRestore();
  });

  it('calls ghost then reconnects with the entered password', async () => {
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: 'kain' } });

    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'disconnected', currentNickIsAlias: true });
    });
    const ghostSpy = vi.spyOn(getState(), 'ghost').mockImplementation(() => {});

    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByTestId('conn-reclaim-open')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('conn-reclaim-open'));
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: '  secret12  ' } });
    fireEvent.click(screen.getByTestId('conn-reclaim-submit'));

    await waitFor(() => expect(ghostSpy).toHaveBeenCalledOnce());
    expect(ghostSpy.mock.calls[0]![0]).toBe('kain');
    expect(ghostSpy.mock.calls[0]![1]).toBe('  secret12  ');
    // and it retries the connection
    expect(connectSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    connectSpy.mockRestore();
    ghostSpy.mockRestore();
  });
});

// ── Session resume ─────────────────────────────────────────────────────────────

describe('Session resume', () => {
  function seedSavedCredentials(): void {
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: 'wss://ircx.us:8080|kain',
        entries: {
          'wss://ircx.us:8080|kain': {
            nick: 'kain',
            server: 'wss://ircx.us:8080',
            password: 'remembered1',
            sessionToken: 'resume-token',
            savedAt: new Date().toISOString(),
          },
        },
      })
    );
  }

  it('surfaces a one-tap resume when a remembered identity exists', async () => {
    seedSavedCredentials();
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    const switcher = screen.getByRole('region', { name: /continue where you left off/i });
    expect(switcher).toHaveTextContent('kain');
    expect(switcher).not.toHaveTextContent(/wss:\/\//i);
    expect(switcher).toHaveTextContent(/ready to continue/i);
  });

  it('never stages a malformed persisted resume token for Connect', async () => {
    const selected = NODES[0]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${selected.wss}|kain`,
        entries: {
          [`${selected.wss}|kain`]: {
            nick: 'kain',
            server: selected.wss,
            password: 'remembered1',
            sessionToken: 'malformed resume token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    let tokenSeenByConnect: string | undefined;
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation((opts) => {
      tokenSeenByConnect = loadCredentials(opts.url, opts.nick)?.sessionToken;
    });

    render(() => <Connect />);

    await waitFor(() => expect(screen.getByTestId('conn-remembered-signin')).toBeInTheDocument());
    expect(screen.queryByTestId('conn-resume')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /continue where you left off/i })).not.toHaveTextContent(
      'malformed resume token',
    );
    fireEvent.click(screen.getByTestId('conn-remembered-signin'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(tokenSeenByConnect).toBeUndefined();
    connectSpy.mockRestore();
  });

  it('connects with the remembered nick + password on resume', async () => {
    seedSavedCredentials();
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conn-resume'));
    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].nick).toBe('kain');
    expect(connectSpy.mock.calls[0]![0].password).toBe('remembered1');
    connectSpy.mockRestore();
  });

  it('copies a mesh resume token to the newly selected node before connecting', async () => {
    const selected = NODES[0]!;
    const previous = NODES[1]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${previous.wss}|kain`,
        entries: {
          [`${previous.wss}|kain`]: {
            nick: 'kain',
            server: previous.wss,
            password: 'remembered1',
            meshToken: 'mesh-resume-token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    clickMode(/sign in/i);
    fireEvent.click(screen.getByRole('switch', { name: 'Stay signed in' }));

    fireEvent.click(screen.getByTestId('conn-resume'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].url).toBe(selected.wss);
    expect(loadCredentials(selected.wss, 'kain')).toMatchObject({
      password: 'remembered1',
      meshToken: 'mesh-resume-token',
    });
    connectSpy.mockRestore();
  });

  it('returns to the issuing node when only a node-local resume token exists', async () => {
    const previous = NODES[1]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${previous.wss}|kain`,
        entries: {
          [`${previous.wss}|kain`]: {
            nick: 'kain',
            server: previous.wss,
            password: 'remembered1',
            sessionToken: 'local-resume-token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    clickMode(/sign in/i);
    fireEvent.click(screen.getByRole('switch', { name: 'Stay signed in' }));

    fireEvent.click(screen.getByTestId('conn-resume'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].url).toBe(previous.wss);
    expect(loadCredentials(previous.wss, 'kain')?.sessionToken).toBe('local-resume-token');
    connectSpy.mockRestore();
  });

  it('makes a one-time token visible to connect before forgetting it when persistence is off', async () => {
    const selected = NODES[0]!;
    const previous = NODES[1]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${previous.wss}|kain`,
        entries: {
          [`${previous.wss}|kain`]: {
            nick: 'kain',
            server: previous.wss,
            password: 'remembered1',
            meshToken: 'one-time-mesh-token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    let tokenSeenByConnect: string | undefined;
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation((opts) => {
      tokenSeenByConnect = loadCredentials(opts.url, opts.nick)?.meshToken;
    });
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('conn-resume'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].url).toBe(selected.wss);
    expect(tokenSeenByConnect).toBe('one-time-mesh-token');
    expect(loadCredentials()).toBeNull();
    connectSpy.mockRestore();
  });

  it('does not show resume when nothing is remembered', () => {
    render(() => <Connect />);
    expect(screen.queryByTestId('conn-resume')).not.toBeInTheDocument();
  });

  it('does not start a passkey ceremony for a token-only remembered identity', async () => {
    enablePasskeys();
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: 'wss://ircx.us:8080|kain',
        entries: {
          'wss://ircx.us:8080|kain': {
            nick: 'kain',
            server: 'wss://ircx.us:8080',
            meshToken: 'passkey-resume-token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    const signInSpy = vi.spyOn(getState(), 'signInWithPasskey').mockImplementation(() => {});

    render(() => <Connect />);

    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: /continue where you left off/i })).toHaveTextContent(/ready to continue/i);
    expect(screen.getByRole('region', { name: /continue where you left off/i }).textContent).not.toContain('passkey-resume-token');

    fireEvent.click(screen.getByTestId('conn-resume'));

    expect(connectSpy).not.toHaveBeenCalled();
    expect(signInSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('connect-screen')).toHaveAttribute('data-mode', 'signin');
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
    expect(nickField()).toHaveValue('kain');
    connectSpy.mockRestore();
  });

  it('never opens a token-only remembered identity as a guest without passkey support', async () => {
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: 'wss://ircx.us:8080|kain',
        entries: {
          'wss://ircx.us:8080|kain': {
            nick: 'kain',
            server: 'wss://ircx.us:8080',
            sessionToken: 'local-token',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('conn-resume'));

    expect(connectSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('connect-screen')).toHaveAttribute('data-mode', 'signin');
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
    expect(nickField()).toHaveValue('kain');
  });

  it('labels a saved password without a session token as sign-in, not resume', async () => {
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: 'wss://ircx.us:8080|kain',
        entries: {
          'wss://ircx.us:8080|kain': {
            nick: 'kain',
            server: 'wss://ircx.us:8080',
            password: 'remembered1',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    await waitFor(() => expect(screen.getByTestId('conn-remembered-signin')).toBeInTheDocument());
    expect(screen.queryByTestId('conn-resume')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('conn-remembered-signin'));
    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0]).toMatchObject({
      nick: 'kain',
      password: 'remembered1',
    });
    connectSpy.mockRestore();
  });

  it('switches among multiple server identities and forgets only the chosen entry', async () => {
    const first = NODES[0]!;
    const second = NODES[1]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${first.wss}|alice`,
        entries: {
          [`${first.wss}|alice`]: {
            nick: 'Alice',
            server: first.wss,
            password: 'alice-secret',
            meshToken: 'alice-token',
            savedAt: new Date().toISOString(),
          },
          [`${second.wss}|bob`]: {
            nick: 'Bob',
            server: second.wss,
            password: 'bob-secret',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    const switcher = await screen.findByRole('region', { name: /continue where you left off/i });
    expect(within(switcher).getByText('Alice')).toBeInTheDocument();
    expect(within(switcher).getByText('Bob')).toBeInTheDocument();
    expect(switcher.textContent).not.toContain('alice-secret');
    expect(switcher.textContent).not.toContain('bob-secret');
    expect(switcher.textContent).not.toContain('alice-token');

    fireEvent.click(within(switcher).getByRole('button', { name: `Select Bob` }));
    expect(nickField()).toHaveValue('Bob');
    expect(screen.getByTestId('conn-remembered-signin')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conn-remembered-signin'));
    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0]).toMatchObject({ nick: 'Bob', password: 'bob-secret' });
    connectSpy.mockRestore();
  });

  it('forgets one remembered identity without removing the others', async () => {
    const first = NODES[0]!;
    const second = NODES[1]!;
    window.localStorage.setItem(
      'onyx:credentials',
      JSON.stringify({
        version: 2,
        activeKey: `${first.wss}|alice`,
        entries: {
          [`${first.wss}|alice`]: {
            nick: 'Alice',
            server: first.wss,
            password: 'alice-secret',
            savedAt: new Date().toISOString(),
          },
          [`${second.wss}|bob`]: {
            nick: 'Bob',
            server: second.wss,
            password: 'bob-secret',
            savedAt: new Date().toISOString(),
          },
        },
      }),
    );

    render(() => <Connect />);

    const switcher = await screen.findByRole('region', { name: /continue where you left off/i });
    fireEvent.click(within(switcher).getByRole('button', { name: `Forget Bob` }));

    expect(within(switcher).queryByText('Bob')).not.toBeInTheDocument();
    expect(within(switcher).getByText('Alice')).toBeInTheDocument();
    expect(loadCredentials(second.wss, 'Bob')).toBeNull();
    expect(loadCredentials(first.wss, 'Alice')).toMatchObject({ password: 'alice-secret' });
  });
});

// ── View gating on connectionStatus ─────────────────────────────────────────────

describe('View gating on connectionStatus', () => {
  it('shows the connect form when connectionStatus is disconnected', () => {
    store.setState({ ...initialState, connectionStatus: 'disconnected' }, true);
    render(() => <Connect />);
    expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
  });

  it('shows a spinner and no submit button while connecting', async () => {
    render(() => <Connect />);
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
    });
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'connecting')
    );
    expect(screen.queryByTestId('conn-submit')).not.toBeInTheDocument();
    connectSpy.mockRestore();
  });

  it('renders AppShell (not the connect form) when connectionStatus is connected', async () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'kain',
      networkName: 'Onyx',
      channels: new Map(),
      activeView: { kind: 'home' },
    }, true);
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument());
    expect(screen.queryByTestId('connect-screen')).not.toBeInTheDocument();
  });

  it('returns to the connect form after disconnect', async () => {
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'kain',
      networkName: 'Onyx',
      channels: new Map(),
      activeView: { kind: 'home' },
    }, true);
    render(() => <Connect />);
    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument());

    const disconnectBtn = screen.getByRole('button', { name: /disconnect/i });
    fireEvent.click(disconnectBtn);
    store.setState({ connectionStatus: 'disconnected' });

    await waitFor(() => expect(screen.getByTestId('connect-screen')).toBeInTheDocument());
  });

  it('shows error phase + "Try again" when disconnected after an attempt', async () => {
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: 'kain' } });

    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
      setTimeout(() => store.setState({ connectionStatus: 'disconnected' }), 0);
    });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'error')
    );
    await waitFor(() =>
      expect(screen.getByTestId('conn-submit')).toHaveTextContent(/try again/i)
    );
    connectSpy.mockRestore();
  });

  it('distinguishes a bad-password error in the status copy', async () => {
    render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: 'wrongpass' } });

    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
      setTimeout(() => {
        getState().addNotification({ type: 'error', text: 'Invalid account or password' });
        store.setState({ connectionStatus: 'disconnected' });
      }, 0);
    });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveTextContent(/password was not accepted/i)
    );
    connectSpy.mockRestore();
  });

  it('routes a rejected registered guest nick into sign-in without changing the nick', async () => {
    render(() => <Connect />);
    fireEvent.input(nickField(), { target: { value: 'alice' } });

    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
      setTimeout(() => {
        getState().addNotification({
          type: 'error',
          text: 'That nickname is registered. Sign in as its account before using it.',
        });
        store.setState({ connectionStatus: 'disconnected' });
      }, 0);
    });
    fireEvent.submit(document.querySelector('form')!);

    const guard = await screen.findByTestId('conn-auth-required');
    expect(screen.getByTestId('conn-status')).toHaveTextContent(/belongs to an account/i);
    fireEvent.click(within(guard).getByRole('button', { name: /sign in as alice/i }));
    expect(screen.getByTestId('connect-screen')).toHaveAttribute('data-mode', 'signin');
    expect(nickField()).toHaveValue('alice');
    connectSpy.mockRestore();
  });
});

// ── Node-name guarantee ─────────────────────────────────────────────────────────

describe('Node name is never shown', () => {
  it('never renders a node hostname in any mode', () => {
    render(() => <Connect />);
    for (const mode of [/sign in/i, /register/i, /guest/i]) {
      clickMode(mode);
      expect(screen.queryByText(/ircx\.us/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/eshmaki\.me/i)).not.toBeInTheDocument();
    }
  });
});

describe('optional room to join (no autojoin)', () => {
  function roomField() {
    return screen.getByRole('textbox', { name: 'Room' });
  }

  it('renders the optional Room field in guest mode', () => {
    render(() => <Connect />);
    expect(roomField()).toBeInTheDocument();
  });

  it('a filled room normalizes (# added) and queues the pending join on submit', () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.input(screen.getByRole('textbox', { name: /^(display name|name|account name)$/i }), { target: { value: 'tester' } });
    fireEvent.input(roomField(), { target: { value: 'lounge' } });
    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(store.getState().pendingDeepLinkJoin).toBe('#lounge');
    expect(peekFirstHourHandoff()).toEqual({
      landing: 'room',
      channel: '#lounge',
      guest: true,
    });
    connectSpy.mockRestore();
  });

  it.each([
    { entered: '&ops', expected: '&ops' },
    { entered: '#ops', expected: '#ops' },
    { entered: 'ops', expected: '#ops' },
  ])('normalizes room "$entered" to "$expected" in destination and pending join', ({ entered, expected }) => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.input(screen.getByRole('textbox', { name: /^(display name|name|account name)$/i }), { target: { value: 'tester' } });
    fireEvent.input(roomField(), { target: { value: entered } });

    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(store.getState().pendingDeepLinkJoin).toBe(expected);
    connectSpy.mockRestore();
  });

  it('an empty room leaves no pending join — landing on Home is the default', () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.input(screen.getByRole('textbox', { name: /^(display name|name|account name)$/i }), { target: { value: 'tester' } });
    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(store.getState().pendingDeepLinkJoin).toBeNull();
    expect(peekFirstHourHandoff()).toEqual({
      landing: 'home',
      channel: null,
      guest: true,
    });
    connectSpy.mockRestore();
  });

  it('a malformed room blocks submit with an error', () => {
    render(() => <Connect />);
    fireEvent.input(screen.getByRole('textbox', { name: /^(display name|name|account name)$/i }), { target: { value: 'tester' } });
    fireEvent.input(roomField(), { target: { value: '#bad channel' } });
    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(screen.getByText(/no spaces or commas/i)).toBeInTheDocument();
  });

  it('uses invite link channel and suggested guest nick as form defaults', () => {
    window.history.pushState({}, '', '/app?join=%23general&as=yuki');

    render(() => <Connect />);

    expect(screen.getByRole('note', { name: /invite preview/i })).toHaveTextContent('Join #general');
    expect(screen.getByRole('textbox', { name: /^(display name|name|account name)$/i })).toHaveValue('yuki');
    expect(screen.queryByRole('textbox', { name: 'Room' })).not.toBeInTheDocument();
  });

  it('queues the invite room when connecting with the suggested guest nick', async () => {
    window.history.pushState({}, '', '/app?join=%23general&as=yuki');
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);
    fireEvent.click(screen.getByTestId('conn-submit'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].nick).toBe('yuki');
    expect(store.getState().pendingDeepLinkJoin).toBe('#general');

    connectSpy.mockRestore();
  });

  it('retains local-channel deep links with the & prefix', async () => {
    window.history.pushState({}, '', '/app?join=%26ops&as=yuki');
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);
    expect(screen.getByRole('note', { name: /invite preview/i })).toHaveTextContent('Join &ops');
    expect(screen.queryByRole('textbox', { name: 'Room' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('conn-submit'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(store.getState().pendingDeepLinkJoin).toBe('&ops');

    connectSpy.mockRestore();
  });

  it('preserves invite topic and reader projection for the post-connect room', async () => {
    window.history.pushState({}, '', '/app?join=%23general&topic=release%20train&reader=1&as=yuki');
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);
    fireEvent.click(screen.getByTestId('conn-submit'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(store.getState().pendingDeepLinkJoin).toBe('#general');
    expect(store.getState().pendingDeepLinkTopic).toBe('release train');
    expect(preferences().readerMode).toBe(true);

    connectSpy.mockRestore();
  });

  it('does not prefill an invalid invite guest nick', () => {
    window.history.pushState({}, '', '/app?join=%23general&as=bad%20nick');

    render(() => <Connect />);

    expect(screen.getByRole('textbox', { name: /^(display name|name|account name)$/i })).toHaveValue('');
    expect(screen.getByRole('note', { name: /invite preview/i })).toHaveTextContent('Join #general');
    expect(screen.queryByRole('textbox', { name: 'Room' })).not.toBeInTheDocument();
  });
});
