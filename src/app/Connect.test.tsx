/**
 * Connect.test.tsx
 *
 * Tests for the Ruri IRC connect screen.
 *
 * The WebSocket is mocked with a controllable fake that lets us feed server
 * lines deterministically — no live server required. We drive the full
 * CAP → SASL → registration flow through the IRCClient under test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { Connect } from './Connect';
import { NODES } from './nodes';

// ── Fake WebSocket ─────────────────────────────────────────────────────────

interface FakeSocket {
  /** Feed a raw IRC line to the client (simulates server → client). */
  send_from_server: (line: string) => void;
  /** Lines sent by the client (IRC client → server). */
  sent: string[];
  /** Force the socket closed with an optional reason. */
  close_from_server: (code?: number, reason?: string) => void;
}

let _fakeSocket: FakeSocket | null = null;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState: number = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private readonly _sent: string[] = [];

  constructor(_url: string) {
    // Expose control surface
    const self = this;
    _fakeSocket = {
      send_from_server: (line: string) => {
        self.onmessage?.({ data: line } as MessageEvent);
      },
      sent: this._sent,
      close_from_server: (code = 1000, reason = '') => {
        self.readyState = MockWebSocket.CLOSED;
        self.onclose?.({ code, reason, wasClean: true } as CloseEvent);
      },
    };

    // Fire onopen on next tick so event handlers are registered first
    Promise.resolve().then(() => {
      self.onopen?.(new Event('open'));
    });
  }

  send(data: string) {
    this._sent.push(data.replace(/\r\n$/, ''));
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// ── Minimal IRC server handshake helpers ───────────────────────────────────

/**
 * Run the full CAP LS → REQ → ACK → NICK/USER → 001 handshake
 * without SASL (anonymous connect).
 */
async function doHandshakeNoSasl(nick: string) {
  const s = _fakeSocket!;

  // Wait for client to send CAP LS 302
  await waitFor(() => expect(s.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

  // Send CAP LS (no sasl in the offered caps)
  s.send_from_server(':eshmaki.me CAP * LS :server-time message-tags echo-message multi-prefix away-notify extended-join account-notify chghost cap-notify batch');

  // Wait for CAP REQ and CAP END
  await waitFor(() => expect(s.sent.some((l) => l.startsWith('CAP REQ'))).toBe(true));

  // ACK the caps
  const capReq = s.sent.find((l) => l.startsWith('CAP REQ'))!;
  const caps = capReq.replace('CAP REQ :', '').trim();
  s.send_from_server(`:eshmaki.me CAP ${nick} ACK :${caps}`);

  // Wait for CAP END
  await waitFor(() => expect(s.sent.some((l) => l === 'CAP END')).toBe(true));

  // Send welcome burst
  s.send_from_server(`:eshmaki.me 001 ${nick} :Welcome to the IRCXNet network, ${nick}`);
  s.send_from_server(`:eshmaki.me 005 ${nick} NETWORK=IRCXNet NICKLEN=64 CHANTYPES=#& :are supported by this server`);
}

/**
 * Run the CAP LS + SASL PLAIN handshake then welcome.
 */
async function doHandshakeWithSasl(nick: string) {
  const s = _fakeSocket!;

  await waitFor(() => expect(s.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

  s.send_from_server(':eshmaki.me CAP * LS :server-time message-tags sasl=PLAIN,SCRAM-SHA-256 multi-prefix');

  await waitFor(() => expect(s.sent.some((l) => l.startsWith('CAP REQ'))).toBe(true));

  const capReq = s.sent.find((l) => l.startsWith('CAP REQ'))!;
  const caps = capReq.replace('CAP REQ :', '').trim();
  s.send_from_server(`:eshmaki.me CAP ${nick} ACK :${caps}`);

  // Wait for AUTHENTICATE <MECH> (PLAIN or SCRAM-SHA-256)
  await waitFor(() => expect(s.sent.some((l) => l.startsWith('AUTHENTICATE '))).toBe(true));

  // Server sends challenge trigger
  s.send_from_server(':eshmaki.me AUTHENTICATE +');

  // Wait for credential payload (second AUTHENTICATE line, not the mech line)
  const mechLine = s.sent.find((l) => l.startsWith('AUTHENTICATE '))!;
  await waitFor(() => {
    const authLines = s.sent.filter((l) => l.startsWith('AUTHENTICATE '));
    return authLines.length > 1 || (authLines.length === 1 && authLines[0] !== mechLine);
  });

  // Server confirms login
  s.send_from_server(`:eshmaki.me 900 ${nick} ${nick}!webchat@eshmaki.me ${nick} :You are now logged in as ${nick}`);
  s.send_from_server(`:eshmaki.me 903 ${nick} :SASL authentication successful`);

  // Wait for CAP END (fires after 903 when _saslPending = false and _capReqPending = 0)
  await waitFor(() => expect(s.sent.some((l) => l === 'CAP END')).toBe(true));

  // Welcome
  s.send_from_server(`:eshmaki.me 001 ${nick} :Welcome to the IRCXNet network, ${nick}`);
  s.send_from_server(`:eshmaki.me 005 ${nick} NETWORK=IRCXNet NICKLEN=64 :are supported by this server`);
}

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  _fakeSocket = null;
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  _fakeSocket = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Connect screen rendering', () => {
  it('renders the connect screen heading', () => {
    render(() => <Connect />);
    // The h1 text is "Connect"
    expect(screen.getByRole('heading', { name: /connect/i })).toBeInTheDocument();
  });

  it('renders both IRC nodes', () => {
    render(() => <Connect />);
    for (const node of NODES) {
      // getAllByText handles the case where host appears in multiple places (e.g. footer)
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
    fireEvent.submit(screen.getByRole('form', { hidden: true }) ?? screen.getByLabelText(/irc connection form/i));
    await waitFor(() => expect(screen.getByText(/nick is required/i)).toBeInTheDocument());
  });

  it('shows an error when the nick starts with a digit', async () => {
    render(() => <Connect />);
    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: '1bad' } });
    const form = screen.getByRole('form', { hidden: true }) ?? document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/must start with/i)).toBeInTheDocument());
  });

  it('shows an error for a nick that is too long (>64 chars)', async () => {
    render(() => <Connect />);
    const longNick = 'a'.repeat(65);
    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: longNick } });
    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/64 characters or fewer/i)).toBeInTheDocument());
  });

  it('clears the nick error when the user types again', async () => {
    render(() => <Connect />);
    const nickInput = screen.getByLabelText(/^nick$/i);
    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/nick is required/i)).toBeInTheDocument());
    fireEvent.input(nickInput, { target: { value: 'kain' } });
    await waitFor(() => expect(screen.queryByText(/nick is required/i)).not.toBeInTheDocument());
  });
});

describe('Connection state transitions (mocked WebSocket)', () => {
  it('transitions to connecting state on submit with a valid nick', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'connecting')
    );
  });

  it('transitions to cap phase when CAP LS arrives', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(_fakeSocket).not.toBeNull());
    await waitFor(() => expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

    _fakeSocket!.send_from_server(':eshmaki.me CAP * LS :server-time message-tags');

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'cap')
    );
  });

  it('transitions to sasl phase when AUTHENTICATE is sent', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'hunter2' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(_fakeSocket).not.toBeNull());
    await waitFor(() => expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

    _fakeSocket!.send_from_server(':eshmaki.me CAP * LS :server-time sasl=PLAIN,SCRAM-SHA-256');

    await waitFor(() => expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP REQ'))).toBe(true));

    const capReq = _fakeSocket!.sent.find((l) => l.startsWith('CAP REQ'))!;
    const caps = capReq.replace('CAP REQ :', '').trim();
    _fakeSocket!.send_from_server(`:eshmaki.me CAP kain ACK :${caps}`);

    // Client sends AUTHENTICATE <MECH> — match any AUTHENTICATE line (PLAIN or SCRAM)
    await waitFor(() =>
      expect(_fakeSocket!.sent.some((l) => l.startsWith('AUTHENTICATE '))).toBe(true)
    );

    // Server sends AUTHENTICATE challenge trigger; this causes the SASL phase in the UI
    _fakeSocket!.send_from_server(':eshmaki.me AUTHENTICATE +');

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'sasl')
    );
  });

  it('transitions to registered phase after RPL_WELCOME (001)', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await doHandshakeNoSasl('kain');

    // After 001, the connected shell replaces the connect form. The shell's presence
    // proves the registered phase was reached — conn-status is no longer in the DOM.
    await waitFor(() =>
      // Network name from 005 ISUPPORT confirms we processed the post-welcome burst
      expect(screen.getByText('IRCXNet')).toBeInTheDocument()
    );
    // The connect form (conn-status) is gone — we're in the shell
    expect(screen.queryByTestId('conn-status')).not.toBeInTheDocument();
  });

  it('shows the connected shell after registration', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await doHandshakeNoSasl('kain');

    await waitFor(() =>
      expect(screen.queryByTestId('connect-screen')).not.toBeInTheDocument()
    );

    // The connected shell should show network name and nick
    await waitFor(() => expect(screen.getByText('IRCXNet')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('kain')).toBeInTheDocument());
  });

  it('shows channel list entry after JOIN', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await doHandshakeNoSasl('kain');

    // Server pushes a JOIN
    _fakeSocket!.send_from_server(':kain!webchat@eshmaki.me JOIN #ocean');

    await waitFor(() =>
      expect(screen.getByText('ocean')).toBeInTheDocument()
    );
  });

  it('transitions to error phase on disconnect', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(_fakeSocket).not.toBeNull());
    await waitFor(() => expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

    // Server closes with an error
    _fakeSocket!.close_from_server(1006, 'Connection lost');

    await waitFor(() =>
      expect(screen.getByTestId('conn-status')).toHaveAttribute('data-phase', 'error')
    );
  });

  it('shows retry button after error', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(_fakeSocket).not.toBeNull());
    _fakeSocket!.close_from_server(1006, 'gone');

    await waitFor(() =>
      expect(screen.getByTestId('conn-submit')).toHaveTextContent(/retry/i)
    );
  });

  it('completes SASL PLAIN auth and reaches the connected shell', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'hunter2' } });
    fireEvent.submit(document.querySelector('form')!);

    await doHandshakeWithSasl('kain');

    // After registration, the shell replaces the connect form
    await waitFor(() =>
      expect(screen.queryByTestId('connect-screen')).not.toBeInTheDocument()
    );
    await waitFor(() => expect(screen.getByText('IRCXNet')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('kain')).toBeInTheDocument());
  });

  it('sends CAP REQ including sasl when password is provided', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'hunter2' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(_fakeSocket).not.toBeNull());
    await waitFor(() => expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

    _fakeSocket!.send_from_server(':eshmaki.me CAP * LS :server-time sasl=PLAIN,SCRAM-SHA-256');

    await waitFor(() =>
      expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP REQ') && l.includes('sasl'))).toBe(true)
    );
  });

  it('does NOT send sasl in CAP REQ when no password given', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    // No password
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(_fakeSocket).not.toBeNull());
    await waitFor(() => expect(_fakeSocket!.sent.some((l) => l.startsWith('CAP LS'))).toBe(true));

    _fakeSocket!.send_from_server(':eshmaki.me CAP * LS :server-time sasl=PLAIN message-tags');

    // Wait for any CAP REQ
    await waitFor(() => {
      const hasCapReq = _fakeSocket!.sent.some((l) => l.startsWith('CAP REQ'));
      const hasCapEnd = _fakeSocket!.sent.some((l) => l === 'CAP END');
      return hasCapReq || hasCapEnd;
    });

    const capReqs = _fakeSocket!.sent.filter((l) => l.startsWith('CAP REQ'));
    // sasl should not be in any of the CAP REQ lines
    for (const req of capReqs) {
      expect(req).not.toContain('sasl');
    }
  });

  it('disconnect button returns to the connect form', async () => {
    render(() => <Connect />);

    fireEvent.input(screen.getByLabelText(/^nick$/i), { target: { value: 'kain' } });
    fireEvent.submit(document.querySelector('form')!);

    await doHandshakeNoSasl('kain');

    // Verify we're in the shell
    await waitFor(() =>
      expect(screen.queryByTestId('connect-screen')).not.toBeInTheDocument()
    );

    // Click disconnect
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

    // Connect screen should return
    await waitFor(() =>
      expect(screen.getByTestId('connect-screen')).toBeInTheDocument()
    );
  });
});
