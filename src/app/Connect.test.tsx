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
import { NODES } from './nodes';
import { store, getState } from '@/lib/store';
import { preferences, resetPreferences } from '@/lib/prefs/preferences';

// The connect screen probes node latency by opening real WebSockets on mount.
// In jsdom that would hit the live servers, so stub the probe + selector here —
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
    fireEvent.input(screen.getByLabelText(/account password/i), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByTestId('conn-reclaim-submit'));

    await waitFor(() => expect(ghostSpy).toHaveBeenCalledOnce());
    expect(ghostSpy.mock.calls[0]![0]).toBe('kain');
    expect(ghostSpy.mock.calls[0]![1]).toBe('secret12');
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
    expect(screen.getByTestId('conn-resume').closest('.conn-resume')).toHaveTextContent(/resume as/i);
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

  it('does not show resume when nothing is remembered', () => {
    render(() => <Connect />);
    expect(screen.queryByTestId('conn-resume')).not.toBeInTheDocument();
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
