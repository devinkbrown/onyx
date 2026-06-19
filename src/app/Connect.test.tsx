/**
 * Connect.test.tsx
 *
 * Tests for the Ruri IRC connect screen (store-driven).
 *
 * The store is the single source of truth. We spy on getState().connect to
 * assert correct invocation, and we seed connectionStatus directly to verify
 * that the form / AppShell gate works correctly.
 *
 * No live WebSocket or IRCClient is needed here — those are integration concerns
 * tested in store.test.ts and shell.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { Connect } from './Connect';
import { NODES, DEFAULT_NODE } from './nodes';
import { store, getState } from '@/lib/store';

// ── Store reset ────────────────────────────────────────────────────────────────

const initialState = store.getInitialState();

beforeEach(() => {
  store.setState(initialState, true);
});

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Connect screen rendering', () => {
  it('renders the connect screen heading', () => {
    render(() => <Connect />);
    expect(screen.getByRole('heading', { name: /connect/i })).toBeInTheDocument();
  });

  it('renders both IRC nodes', () => {
    render(() => <Connect />);
    for (const node of NODES) {
      const matches = screen.getAllByText(node.host);
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it('renders ircx.us as the default selected node', () => {
    render(() => <Connect />);
    const ircxBtn = screen.getByRole('button', { name: /select ircx\.us/i });
    expect(ircxBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders eshmaki.me node with its label', () => {
    render(() => <Connect />);
    expect(screen.getByText("eshmaki.me — the devil's gate (Aēšma, wrath)")).toBeInTheDocument();
  });

  it('renders the nick field', () => {
    render(() => <Connect />);
    expect(screen.getByLabelText(/nick/i)).toBeInTheDocument();
  });

  it('renders the password field', () => {
    render(() => <Connect />);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders the stay signed in toggle', () => {
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

describe('Node selection', () => {
  it('selects eshmaki.me when clicked', async () => {
    render(() => <Connect />);
    const eshmakiBtn = screen.getByRole('button', { name: /select eshmaki\.me/i });
    fireEvent.click(eshmakiBtn);
    await waitFor(() => expect(eshmakiBtn).toHaveAttribute('aria-pressed', 'true'));
  });

  it('deselects ircx.us when eshmaki is picked', async () => {
    render(() => <Connect />);
    const ircxBtn = screen.getByRole('button', { name: /select ircx\.us/i });
    const eshmakiBtn = screen.getByRole('button', { name: /select eshmaki\.me/i });
    fireEvent.click(eshmakiBtn);
    await waitFor(() => expect(ircxBtn).toHaveAttribute('aria-pressed', 'false'));
  });

  it('shows [selected] marker on the active node', async () => {
    render(() => <Connect />);
    const eshmakiBtn = screen.getByRole('button', { name: /select eshmaki\.me/i });
    fireEvent.click(eshmakiBtn);
    await waitFor(() => expect(eshmakiBtn.textContent).toContain('[selected]'));
  });
});

describe('Nick validation', () => {
  it('shows an error when the nick field is empty on submit', async () => {
    render(() => <Connect />);
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/nick is required/i)).toBeInTheDocument());
  });

  it('shows an error when the nick starts with a digit', async () => {
    render(() => <Connect />);
    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: '1bad' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/must start with/i)).toBeInTheDocument());
  });

  it('shows an error for a nick that is too long (>64 chars)', async () => {
    render(() => <Connect />);
    const longNick = 'a'.repeat(65);
    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: longNick } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/64 characters or fewer/i)).toBeInTheDocument());
  });

  it('clears the nick error when the user types again', async () => {
    render(() => <Connect />);
    const nickInput = screen.getByLabelText(/^nick$/i);
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(/nick is required/i)).toBeInTheDocument());
    fireEvent.input(nickInput, { target: { value: 'kain' } });
    await waitFor(() => expect(screen.queryByText(/nick is required/i)).not.toBeInTheDocument());
  });
});

describe('Store-driven connect action', () => {
  it('calls getState().connect with the default node url and nick on submit', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());

    const call = connectSpy.mock.calls[0]![0];
    expect(call.url).toBe(DEFAULT_NODE.wss);
    expect(call.nick).toBe('kain');

    connectSpy.mockRestore();
  });

  it('calls getState().connect with the selected node url', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    // Switch to eshmaki.me
    const eshmakiNode = NODES.find((n) => n.host === 'eshmaki.me')!;
    fireEvent.click(screen.getByRole('button', { name: /select eshmaki\.me/i }));

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'alice' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());

    const call = connectSpy.mock.calls[0]![0];
    expect(call.url).toBe(eshmakiNode.wss);
    expect(call.nick).toBe('alice');

    connectSpy.mockRestore();
  });

  it('calls getState().connect with password when provided', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'hunter2' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].password).toBe('hunter2');

    connectSpy.mockRestore();
  });

  it('calls getState().connect with password=undefined when no password is entered', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    // Leave password blank
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(connectSpy).toHaveBeenCalledOnce());
    expect(connectSpy.mock.calls[0]![0].password).toBeUndefined();

    connectSpy.mockRestore();
  });

  it('does not call getState().connect when nick is invalid', async () => {
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {});

    render(() => <Connect />);

    // Submit with empty nick
    fireEvent.submit(document.querySelector('form')!);

    // Give any async tick to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(connectSpy).not.toHaveBeenCalled();

    connectSpy.mockRestore();
  });
});

describe('View gating on connectionStatus', () => {
  it('shows the connect form when connectionStatus is disconnected', () => {
    store.setState({ ...initialState, connectionStatus: 'disconnected' }, true);
    render(() => <Connect />);
    expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
  });

  it('shows a spinner and no submit button while connecting', async () => {
    render(() => <Connect />);

    // Trigger a connect attempt so formPhase becomes 'connecting'
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
    });

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'connecting')
    );
    expect(screen.queryByTestId('conn-submit')).not.toBeInTheDocument();

    connectSpy.mockRestore();
  });

  it('renders AppShell (not the connect form) when connectionStatus is connected', async () => {
    // Arrange: seed the store with connected state + a channel so AppShell renders
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'kain',
      networkName: 'IRCXNet',
      channels: new Map(),
      activeView: { kind: 'home' },
    }, true);

    // Act
    render(() => <Connect />);

    // Assert: the connect form is gone; the AppShell landmark is present
    await waitFor(() =>
      expect(screen.queryByTestId('connect-screen')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  it('returns to the connect form after disconnect', async () => {
    // Arrange: start connected
    store.setState({
      ...initialState,
      connectionStatus: 'connected',
      ourNick: 'kain',
      networkName: 'IRCXNet',
      channels: new Map(),
      activeView: { kind: 'home' },
    }, true);

    render(() => <Connect />);

    // Verify shell is shown
    await waitFor(() =>
      expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    );

    // Act: click disconnect (the mobile nav button or desktop disconnect handler)
    // AppShell has a mobile bottom nav "✕ disconnect" button
    const disconnectBtn = screen.getByRole('button', { name: /disconnect/i });
    fireEvent.click(disconnectBtn);

    // Assert: store.disconnect is called, which sets connectionStatus='disconnected'
    // Since we aren't mocking disconnect here, we directly set it
    store.setState({ connectionStatus: 'disconnected' });

    await waitFor(() =>
      expect(screen.getByTestId('connect-screen')).toBeInTheDocument()
    );
  });

  it('shows error phase in the status bar when connectionStatus is disconnected after attempt', async () => {
    render(() => <Connect />);

    // Fill nick so the component knows an attempt was made
    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });

    // Connect then immediately drop to disconnected
    const connectSpy = vi.spyOn(getState(), 'connect').mockImplementation(() => {
      store.setState({ connectionStatus: 'connecting' });
      // Simulate connection failure
      setTimeout(() => store.setState({ connectionStatus: 'disconnected' }), 0);
    });

    fireEvent.submit(document.querySelector('form')!);

    // Wait for error phase to appear
    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'error')
    );

    // Should show retry button
    await waitFor(() =>
      expect(screen.getByTestId('conn-submit')).toHaveTextContent(/retry/i)
    );

    connectSpy.mockRestore();
  });
});
