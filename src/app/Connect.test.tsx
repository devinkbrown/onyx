// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Connect.test.tsx
 *
 * Tests for the Onyx connect screen (store-driven).
 *
 * The store is the single source of truth. We spy on store actions to assert
 * correct invocation, and we seed reactive state directly to verify that the
 * form / AppShell gate, the three modes (Guest · Sign in · Register), validation,
 * the register → verify flow, and the GHOST / resume affordances behave.
 *
 * There is no server picker: the client auto-routes to the fastest reachable
 * mesh node. We therefore assert the connect URL is *one of* the known nodes,
 * never a specific one. No live WebSocket is needed (probing is stubbed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@solidjs/testing-library';
import { Connect } from './Connect';
import { NODES, selectBestNode } from './nodes';
import { store, getState } from '@/lib/store';
import { preferences, resetPreferences } from '@/lib/prefs/preferences';
import { loadCredentials } from '@/lib/credentials';

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
});

afterEach(() => {
  cleanup();
  restorePasskeyEnvironment?.();
  restorePasskeyEnvironment = undefined;
  vi.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function clickMode(name: RegExp): void {
  fireEvent.click(screen.getByRole('tab', { name }));
}

function nickField(): HTMLElement {
  // Both "Nick" (guest/sign-in) and "Desired account / nick" (register) match.
  return screen.getByLabelText(/nick/i);
}

// ── Rendering ────────────────────────────────────────────────────────────────

describe('Connect screen rendering', () => {
  it('renders the connect screen heading', () => {
    render(() => <Connect />);
    expect(screen.getByRole('heading', { name: /connect/i })).toBeInTheDocument();
  });

  it('does not expose a server picker or any node hostnames', () => {
    render(() => <Connect />);
    expect(screen.queryByRole('button', { name: /select ircx\.us/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/ircx\.us/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/eshmaki\.me/i)).not.toBeInTheDocument();
  });

  it('shows the auto-routing indicator', () => {
    render(() => <Connect />);
    expect(screen.getAllByText(/nearest node/i).length).toBeGreaterThan(0);
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

  it('renders the three-mode switch', () => {
    render(() => <Connect />);
    expect(screen.getByRole('tab', { name: /guest/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /register/i })).toBeInTheDocument();
  });

  it('surfaces the account claim path and jumps to registration', () => {
    render(() => <Connect />);
    const claim = screen.getByRole('region', { name: 'Claim path' });
    expect(within(claim).getByText('Guest nick')).toBeInTheDocument();
    expect(within(claim).getByText('Registered account')).toBeInTheDocument();
    expect(within(claim).getByText('Recovery email')).toBeInTheDocument();
    expect(within(claim).getByText('Device login')).toBeInTheDocument();

    fireEvent.click(within(claim).getByRole('button', { name: 'Register' }));
    expect(screen.getByRole('tab', { name: /register/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('defaults to Guest mode', () => {
    render(() => <Connect />);
    expect(screen.getByRole('tab', { name: /guest/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the nick field', () => {
    render(() => <Connect />);
    expect(nickField()).toBeInTheDocument();
  });

  it('hides the password field in Guest mode', () => {
    render(() => <Connect />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('renders the stay signed in toggle in Guest mode', () => {
    render(() => <Connect />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('renders the connect button', () => {
    render(() => <Connect />);
    expect(screen.getByTestId('conn-submit')).toBeInTheDocument();
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
    expect(screen.getByRole('tab', { name: /sign in/i })).toHaveAttribute('aria-selected', 'true');
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
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/dive in/i);
    clickMode(/sign in/i);
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/sign in/i);
    clickMode(/register/i);
    expect(screen.getByTestId('conn-submit')).toHaveTextContent(/create account/i);
  });
});

// ── Passkey sign-in ─────────────────────────────────────────────────────────

describe('Passkey sign-in', () => {
  function connectedServer(account: string | null = null) {
    return {
      id: 'passkey-test',
      name: 'Onyx',
      network: 'Onyx',
      url: NODES[0]!.wss,
      icon: '',
      nick: 'alice',
      account,
      connected: true,
    };
  }

  function openPasskeySignIn(): HTMLElement {
    enablePasskeys();
    render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.input(nickField(), { target: { value: 'alice' } });
    return screen.getByTestId('conn-passkey-submit');
  }

  it('opens IRC transport once before dispatching WEBAUTHN AUTH', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ status: 'connecting', connectionStatus: 'connecting' });
    });
    const signInSpy = vi.spyOn(getState(), 'signInWithPasskey').mockImplementation(() => {
      store.setState({ passkeyBusy: true, passkeyError: null });
    });
    const button = openPasskeySignIn();

    fireEvent.click(button);
    fireEvent.click(button);

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith(expect.objectContaining({ nick: 'alice' }));
    expect(signInSpy).not.toHaveBeenCalled();

    store.setState({
      status: 'connected',
      connectionStatus: 'connected',
      autoReconnect: true,
      server: connectedServer(),
    });

    await waitFor(() => expect(signInSpy).toHaveBeenCalledTimes(1));
    expect(signInSpy).toHaveBeenCalledWith('alice');
    expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
    expect(screen.getByTestId('conn-passkey-submit')).toHaveTextContent(/waiting for your device/i);
  });

  it('returns a dismissed prompt to a focused, actionable sign-in form', async () => {
    vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ status: 'connecting', connectionStatus: 'connecting' });
    });
    vi.spyOn(getState(), 'signInWithPasskey').mockImplementation(() => {
      store.setState({ passkeyBusy: true, passkeyError: null });
    });
    const disconnectSpy = vi.spyOn(getState(), 'disconnect');
    const button = openPasskeySignIn();

    fireEvent.click(button);
    store.setState({
      status: 'connected',
      connectionStatus: 'connected',
      autoReconnect: true,
      server: connectedServer(),
    });
    await waitFor(() => expect(getState().signInWithPasskey).toHaveBeenCalledWith('alice'));

    store.setState({ passkeyBusy: false, passkeyError: 'Passkey prompt was dismissed.' });

    await waitFor(() => expect(disconnectSpy).toHaveBeenCalledTimes(1));
    const restoredButton = screen.getByTestId('conn-passkey-submit');
    expect(screen.getByRole('alert')).toHaveTextContent('Passkey prompt was dismissed.');
    await waitFor(() => expect(restoredButton).toHaveFocus());
  });

  it('cancels the anonymous transport when mode changes before the challenge', async () => {
    vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ status: 'connecting', connectionStatus: 'connecting' });
    });
    const signInSpy = vi.spyOn(getState(), 'signInWithPasskey').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(getState(), 'disconnect');
    const button = openPasskeySignIn();

    fireEvent.click(button);
    const claim = screen.getByRole('region', { name: 'Claim path' });
    fireEvent.click(within(claim).getByRole('button', { name: 'Register' }));

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    store.setState({ status: 'connected', connectionStatus: 'connected' });
    await Promise.resolve();
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('does not prompt again when SESSION already restored the requested account', async () => {
    vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ status: 'connecting', connectionStatus: 'connecting' });
    });
    const signInSpy = vi.spyOn(getState(), 'signInWithPasskey').mockImplementation(() => {});
    const button = openPasskeySignIn();

    fireEvent.click(button);
    store.setState({
      status: 'connected',
      connectionStatus: 'connected',
      autoReconnect: true,
      server: connectedServer('alice'),
    });

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument());
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('destroys the anonymous transport on unmount before dispatch', async () => {
    enablePasskeys();
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ status: 'connecting', connectionStatus: 'connecting' });
    });
    const signInSpy = vi.spyOn(getState(), 'signInWithPasskey').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(getState(), 'disconnect');
    const view = render(() => <Connect />);
    clickMode(/sign in/i);
    fireEvent.input(nickField(), { target: { value: 'alice' } });
    fireEvent.click(screen.getByTestId('conn-passkey-submit'));
    expect(connectSpy).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    store.setState({ status: 'connected', connectionStatus: 'connected' });
    await Promise.resolve();
    expect(signInSpy).not.toHaveBeenCalled();
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
    await waitFor(() => expect(screen.getByText(/nick is required/i)).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText(/nick is required/i)).toBeInTheDocument());
    fireEvent.input(nickField(), { target: { value: 'kain' } });
    await waitFor(() => expect(screen.queryByText(/nick is required/i)).not.toBeInTheDocument());
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
    expect(screen.getByText(/stores your account password in this browser/i)).toBeInTheDocument();
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

  it('shows a spinner while registerPending is true', async () => {
    render(() => <Connect />);
    clickMode(/register/i);
    store.setState({ registerPending: true });
    await waitFor(() => expect(screen.getByRole('status', { name: /registering/i })).toBeInTheDocument());
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
    const switcher = screen.getByRole('region', { name: /remembered identities/i });
    expect(switcher).toHaveTextContent('kain');
    expect(switcher).toHaveTextContent('wss://ircx.us:8080');
    expect(switcher).toHaveTextContent(/session ready/i);
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
    fireEvent.click(screen.getByRole('switch'));

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
    fireEvent.click(screen.getByRole('switch'));

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

  it('offers resume for a current token-only passwordless identity', async () => {
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

    render(() => <Connect />);

    await waitFor(() => expect(screen.getByTestId('conn-resume')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: /remembered identities/i })).toHaveTextContent(/session ready/i);
    expect(screen.getByRole('region', { name: /remembered identities/i }).textContent).not.toContain('passkey-resume-token');

    fireEvent.click(screen.getByTestId('conn-resume'));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0]).toMatchObject({
      nick: 'kain',
      password: undefined,
    });
    connectSpy.mockRestore();
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

    const switcher = await screen.findByRole('region', { name: /remembered identities/i });
    expect(within(switcher).getByText('Alice')).toBeInTheDocument();
    expect(within(switcher).getByText('Bob')).toBeInTheDocument();
    expect(switcher.textContent).not.toContain('alice-secret');
    expect(switcher.textContent).not.toContain('bob-secret');
    expect(switcher.textContent).not.toContain('alice-token');

    fireEvent.click(within(switcher).getByRole('button', { name: `Select Bob on ${second.wss}` }));
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

    const switcher = await screen.findByRole('region', { name: /remembered identities/i });
    fireEvent.click(within(switcher).getByRole('button', { name: `Forget Bob on ${second.wss}` }));

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
    await waitFor(() =>
      expect(screen.queryByTestId('connect-screen')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
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
  it('renders the optional Channel field in guest mode', () => {
    render(() => <Connect />);
    expect(screen.getByLabelText(/channel/i)).toBeInTheDocument();
  });

  it('a filled room normalizes (# added) and queues the pending join on submit', () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.input(screen.getByLabelText(/nick/i), { target: { value: 'tester' } });
    fireEvent.input(screen.getByLabelText(/channel/i), { target: { value: 'lounge' } });
    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(store.getState().pendingDeepLinkJoin).toBe('#lounge');
    connectSpy.mockRestore();
  });

  it('an empty room leaves no pending join — landing on Home is the default', () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});
    render(() => <Connect />);
    fireEvent.input(screen.getByLabelText(/nick/i), { target: { value: 'tester' } });
    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(store.getState().pendingDeepLinkJoin).toBeNull();
    connectSpy.mockRestore();
  });

  it('a malformed room blocks submit with an error', () => {
    render(() => <Connect />);
    fireEvent.input(screen.getByLabelText(/nick/i), { target: { value: 'tester' } });
    fireEvent.input(screen.getByLabelText(/channel/i), { target: { value: '#bad channel' } });
    fireEvent.click(screen.getByTestId('conn-submit'));
    expect(screen.getByText(/no spaces or commas/i)).toBeInTheDocument();
  });

  it('uses invite link channel and suggested guest nick as form defaults', () => {
    window.history.pushState({}, '', '/app?join=%23general&as=yuki');

    render(() => <Connect />);

    expect(screen.getByRole('note', { name: /invite preview/i })).toHaveTextContent('Join #general');
    expect(screen.getByLabelText(/nick/i)).toHaveValue('yuki');
    expect(screen.getByLabelText(/channel/i)).toHaveValue('#general');
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

    expect(screen.getByLabelText(/nick/i)).toHaveValue('');
    expect(screen.getByLabelText(/channel/i)).toHaveValue('#general');
  });
});
