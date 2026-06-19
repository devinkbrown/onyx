/**
 * Connect.tsx — Ruri IRC connect screen.
 *
 * Renders the node picker, nick/password form, session-token toggle, live
 * connection-state feedback, and (when connected) a minimal shell with a
 * channel list + raw message feed.
 *
 * SOLID IDIOMS: components run once. Never destructure props. Use splitProps,
 * createSignal/createMemo/createEffect/onCleanup, For/Show, and clean up the
 * client on unmount.
 */

import './connect.css';
import {
  createSignal,
  createMemo,
  onCleanup,
  For,
  Show,
  type JSX,
} from 'solid-js';
import { IRCClient } from '@/lib/irc/client';
import type { IRCMessage } from '@/lib/irc/types';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Spinner } from '@/primitives/index';
import { NODES, DEFAULT_NODE, type IrcNode } from './nodes';

// ── Connection phase ────────────────────────────────────────────────────────

export type ConnPhase =
  | 'idle'
  | 'connecting'
  | 'cap'
  | 'sasl'
  | 'registered'
  | 'error';

const PHASE_LABEL: Record<ConnPhase, string> = {
  idle:       'not connected',
  connecting: 'connecting',
  cap:        'cap negotiation',
  sasl:       'authenticating',
  registered: 'connected',
  error:      'error',
};

// ── Atmosphere background (shared with landing) ─────────────────────────────

function Atmosphere(): JSX.Element {
  return (
    <>
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      {/* Kintsugi veins — three paths, one animated dash */}
      <svg class="r-veins" aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path d="M0,340 Q240,180 480,320 T960,280 T1440,320" opacity="0.4" />
        <path class="flow" d="M0,500 Q360,380 720,460 T1440,440" opacity="0.28" />
        <path d="M200,0 Q380,240 320,480 T400,900" opacity="0.22" />
        <circle class="node" cx="480" cy="320" r="2.2" />
        <circle class="node" cx="960" cy="280" r="2.2" />
        <circle class="node" cx="320" cy="480" r="2.2" />
      </svg>
      <div class="r-grain" aria-hidden="true" />
    </>
  );
}

// ── Raw feed entry ──────────────────────────────────────────────────────────

interface FeedLine {
  id: string;
  ts: Date;
  dir: 'in' | 'out';
  text: string;
}

// ── Connected shell ─────────────────────────────────────────────────────────

interface ShellProps {
  nick: string;
  networkName: string;
  channels: string[];
  feedLines: FeedLine[];
  onDisconnect: () => void;
}

function ConnectedShell(props: ShellProps): JSX.Element {
  return (
    <div class="conn-shell">
      <Atmosphere />
      <header class="conn-shell-bar">
        <div class="conn-shell-network">
          <span class="conn-shell-network-dot" aria-hidden="true" />
          <span>{props.networkName}</span>
          <span aria-hidden="true"> / </span>
          <span class="conn-shell-nick">{props.nick}</span>
        </div>
        <button
          class="conn-shell-disconnect"
          type="button"
          onClick={props.onDisconnect}
          aria-label="Disconnect from network"
        >
          [disconnect]
        </button>
      </header>

      <div class="conn-shell-body">
        {/* Sidebar: channel list */}
        <nav class="conn-shell-sidebar" aria-label="Joined channels">
          <div class="conn-shell-sidebar-head">channels</div>
          <ul class="conn-shell-channel-list" role="list">
            <Show
              when={props.channels.length > 0}
              fallback={
                <li class="conn-shell-empty-channels">no channels yet</li>
              }
            >
              <For each={props.channels}>
                {(ch) => (
                  <li class="conn-shell-channel-item">{ch.replace(/^#/, '')}</li>
                )}
              </For>
            </Show>
          </ul>
        </nav>

        {/* Main area: raw message feed */}
        <main class="conn-shell-main" aria-label="Raw IRC message feed">
          <div class="conn-shell-main-head">raw message stream</div>
          <div
            class="conn-shell-feed"
            role="log"
            aria-live="polite"
            aria-label="Incoming messages"
          >
            <For each={props.feedLines}>
              {(line) => {
                const ts = line.ts.toTimeString().slice(0, 8);
                return (
                  <div class="conn-shell-feed-line">
                    <span class="conn-shell-feed-ts" aria-hidden="true">{ts}</span>
                    <span
                      class={line.dir === 'in' ? 'conn-shell-feed-dir-in' : 'conn-shell-feed-dir-out'}
                      aria-label={line.dir === 'in' ? 'received' : 'sent'}
                    >
                      {line.dir === 'in' ? '»' : '«'}
                    </span>
                    <span class="conn-shell-feed-text">{line.text}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Connect form ────────────────────────────────────────────────────────────

export interface ConnectProps {
  /** Called when the client reaches the 'registered' phase. */
  onConnected?: (client: IRCClient) => void;
}

export function Connect(props: ConnectProps): JSX.Element {
  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = createSignal<IrcNode>(DEFAULT_NODE);
  const [nick, setNick] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [staySignedIn, setStaySignedIn] = createSignal(true);
  const [nickError, setNickError] = createSignal<string | undefined>(undefined);

  // ── Connection state ──────────────────────────────────────────────────────
  const [phase, setPhase] = createSignal<ConnPhase>('idle');
  const [statusMsg, setStatusMsg] = createSignal('Pick a node and enter your nick to connect.');
  const [client, setClient] = createSignal<IRCClient | null>(null);
  const [isConnected, setIsConnected] = createSignal(false);

  // ── Post-connection data ──────────────────────────────────────────────────
  const [networkName, setNetworkName] = createSignal('IRCXNet');
  const [ourNick, setOurNick] = createSignal('');
  const [channels, setChannels] = createSignal<string[]>([]);
  const [feedLines, setFeedLines] = createSignal<FeedLine[]>([]);

  let lineCounter = 0;
  function pushFeedLine(dir: 'in' | 'out', text: string): void {
    lineCounter++;
    setFeedLines((prev) => {
      const next = [...prev, { id: `l${lineCounter}`, ts: new Date(), dir, text }];
      // Keep only last 200 lines for the raw feed
      return next.length > 200 ? next.slice(-200) : next;
    });
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const nickTrimmed = createMemo(() => nick().trim());

  function validateNick(value: string): string | undefined {
    const v = value.trim();
    if (!v) return 'Nick is required.';
    if (v.length > 64) return 'Nick must be 64 characters or fewer.';
    if (!/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\[\]\\`_^{|}\-]*$/.test(v)) {
      return 'Nick must start with a letter or IRC special char and contain only letters, numbers, or -[]\\`_^{|}.';
    }
    return undefined;
  }

  const isFormReady = createMemo(() => {
    const p = phase();
    return p === 'idle' || p === 'error';
  });

  // ── Client teardown ───────────────────────────────────────────────────────
  function destroyClient(): void {
    const c = client();
    if (c) {
      c.destroy();
      setClient(null);
    }
  }

  onCleanup(() => {
    destroyClient();
  });

  // ── Handle IRC messages once registered ─────────────────────────────────

  function handleMessage(msg: IRCMessage): void {
    // Track phase transitions from server data
    switch (msg.command) {
      case 'CAP': {
        const sub = (msg.params[1] ?? '').toUpperCase();
        if (sub === 'LS' || sub === 'REQ' || sub === 'ACK' || sub === 'NAK') {
          if (phase() === 'connecting') {
            setPhase('cap');
            setStatusMsg('Negotiating capabilities...');
          }
        }
        break;
      }

      case 'AUTHENTICATE': {
        if (phase() !== 'sasl') {
          setPhase('sasl');
          setStatusMsg('SASL authentication in progress...');
        }
        break;
      }

      case '900': {
        // RPL_LOGGEDIN
        const account = msg.params[2] ?? '';
        setStatusMsg(`Logged in${account ? ` as ${account}` : ''}.`);
        break;
      }

      case '903': {
        // RPL_SASLSUCCESS
        setStatusMsg('Authentication successful. Awaiting welcome...');
        break;
      }

      case '904':
      case '905': {
        // ERR_SASLFAIL / ERR_SASLABORTED (during sasl only)
        setStatusMsg('Authentication failed — connecting anonymously.');
        break;
      }

      case '001': {
        // RPL_WELCOME — registration complete
        const welcomeNick = msg.params[0] ?? nickTrimmed();
        setOurNick(welcomeNick);
        setPhase('registered');
        setStatusMsg(`Connected to ${networkName()} as ${welcomeNick}.`);
        setIsConnected(true);

        const c = client();
        if (c) {
          props.onConnected?.(c);
          // Request SESSION TOKEN for reconnect reclaim (if logged in)
          // The client itself sends SESSION TOKEN after 001 when _loggedIn.
        }
        break;
      }

      case '005': {
        // RPL_ISUPPORT — extract NETWORK name
        for (const token of msg.params.slice(1, -1)) {
          if (token.startsWith('NETWORK=')) {
            setNetworkName(token.slice(8));
          }
        }
        break;
      }

      case '433':
      case '432':
      case '437': {
        // Nick collision — client retries internally, just show feedback
        const newNick = msg.params[1] ?? '';
        if (newNick) {
          setStatusMsg(`Nick taken — trying ${newNick}...`);
        }
        break;
      }

      case 'JOIN': {
        // Track joined channels
        const ch = msg.params[0] ?? '';
        if (ch && msg.nick === ourNick()) {
          setChannels((prev) =>
            prev.includes(ch) ? prev : [...prev, ch]
          );
        }
        break;
      }

      case 'PART':
      case 'KICK': {
        const ch = msg.params[0] ?? '';
        const kicked = msg.command === 'KICK' ? msg.params[1] : msg.nick;
        if (ch && kicked === ourNick()) {
          setChannels((prev) => prev.filter((c) => c !== ch));
        }
        break;
      }

      case 'ERROR': {
        setPhase('error');
        setStatusMsg(`Server error: ${msg.params[0] ?? 'unknown'}`);
        break;
      }
    }
  }

  // ── Connect action ────────────────────────────────────────────────────────

  function handleConnect(event: SubmitEvent): void {
    event.preventDefault();

    const n = nickTrimmed();
    const err = validateNick(n);
    setNickError(err);
    if (err) return;

    const node = selectedNode();
    const pass = password().trim() || undefined;
    const wantSession = staySignedIn();

    // Tear down any prior client
    destroyClient();

    // Reset channel/feed state
    setChannels([]);
    setFeedLines([]);
    setNetworkName('IRCXNet');
    setOurNick(n);

    setPhase('connecting');
    setStatusMsg(`Opening door to ${node.host}...`);

    const newClient = new IRCClient({
      url: node.wss,
      nick: n,
      realname: `${n} (Ruri / Ocean)`,
      username: 'webchat',
      password: pass,
      // SESSION TOKEN is requested automatically post-001 by the client when logged in.

      onMessage(msg: IRCMessage) {
        // Raw feed — only log significant lines to avoid noise
        handleMessage(msg);
      },

      onRaw(line: string, dir: 'in' | 'out') {
        pushFeedLine(dir, line);
      },

      onConnected() {
        // 001 handler above sets phase to registered
      },

      onDisconnected(reason: string) {
        if (phase() !== 'error') {
          setPhase('error');
          setStatusMsg(`Disconnected: ${reason}`);
          setIsConnected(false);
        }
      },

      onError(err: string) {
        setPhase('error');
        setStatusMsg(friendlyError(err));
        setIsConnected(false);
      },

      onNickChanged(newNick: string) {
        setOurNick(newNick);
      },
    });

    setClient(newClient);

    // If the user wants a session token, we set that up via the SESSION TOKEN
    // command the client sends post-001 automatically when logged in.
    // The staySignedIn toggle controls whether we'll store the token for
    // future reconnects — stored in sessionStorage once received.
    if (wantSession) {
      newClient.extraMessageHandlers.add((msg: IRCMessage) => {
        // NOTE SESSION TOKEN <token> — local reclaim token
        if (
          msg.command === 'NOTE' &&
          msg.params[0] === 'SESSION' &&
          msg.params[1] === 'TOKEN'
        ) {
          const token = msg.params[2] ?? '';
          if (token) {
            try { sessionStorage.setItem('ruri-session-token', token); } catch { /* storage unavailable */ }
          }
        }
        // NOTE SESSION MTOKEN <token> — mesh token (preferred for cross-node reclaim)
        if (
          msg.command === 'NOTE' &&
          msg.params[0] === 'SESSION' &&
          msg.params[1] === 'MTOKEN'
        ) {
          const token = msg.params[2] ?? '';
          if (token) {
            try { sessionStorage.setItem('ruri-mesh-token', token); } catch { /* storage unavailable */ }
          }
        }
      });
    }

    newClient.connect();
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  function handleDisconnect(): void {
    destroyClient();
    setPhase('idle');
    setIsConnected(false);
    setStatusMsg('Disconnected. Pick a node to reconnect.');
    setChannels([]);
    setFeedLines([]);
  }

  // ── Friendly error messages ───────────────────────────────────────────────

  function friendlyError(raw: string): string {
    if (raw.includes('ECONNREFUSED') || raw.includes('refused')) {
      return 'Connection refused — the server may be down or unreachable.';
    }
    if (raw.includes('WebSocket error')) {
      return 'WebSocket failed to open. Check your network or try the other node.';
    }
    if (raw.includes('SASL')) return 'Authentication failed. Check your password.';
    if (raw.includes('Ping timeout')) return 'Connection timed out (ping).';
    if (raw.includes('Excess Flood')) return 'Disconnected: flood protection triggered.';
    return raw;
  }

  // ── Status phase label ────────────────────────────────────────────────────

  const phaseLabel = createMemo(() => PHASE_LABEL[phase()]);

  // ── Render: connected shell ───────────────────────────────────────────────

  return (
    <Show
      when={isConnected()}
      fallback={
        // ── Connect form ──────────────────────────────────────────────────
        <div class="conn" data-testid="connect-screen">
          <Atmosphere />

          <div class="conn-card" role="main">
            {/* Window chrome */}
            <div class="conn-bar" aria-hidden="true">
              <span class="conn-bar-lights">
                <i style={{ background: 'var(--shu-bright)' }} />
                <i style={{ background: 'var(--gold-bright)' }} />
                <i style={{ background: 'var(--ok)' }} />
              </span>
              <span class="conn-bar-title">ruri — orochi mesh connection</span>
            </div>

            <div class="conn-body">
              {/* Header */}
              <header class="conn-header">
                <span class="conn-eyebrow">IRCXNet</span>
                <h1 class="conn-title">Connect</h1>
                <p class="conn-sub">
                  Choose a door into the mesh. The Suimyaku grid binds all nodes —
                  either entrance reaches the whole network.
                </p>
              </header>

              <div class="conn-seam" aria-hidden="true" />

              {/* Node picker */}
              <form onSubmit={handleConnect} noValidate aria-label="IRC connection form">
                <div class="conn-nodes" role="group" aria-labelledby="conn-nodes-lbl">
                  <p id="conn-nodes-lbl" class="conn-nodes-label">Select node</p>
                  <For each={NODES as IrcNode[]}>
                    {(node) => {
                      const isSelected = createMemo(() => selectedNode().id === node.id);
                      return (
                        <button
                          class="conn-node-btn"
                          type="button"
                          role="button"
                          aria-pressed={isSelected() ? 'true' : 'false'}
                          aria-label={`Select ${node.host}`}
                          data-node-id={node.id}
                          disabled={!isFormReady()}
                          onClick={() => setSelectedNode(node)}
                        >
                          <span
                            class={`conn-node-dot conn-node-dot--${node.id}`}
                            aria-hidden="true"
                          />
                          <span class="conn-node-body">
                            <span class="conn-node-host">{node.host}</span>
                            <span class="conn-node-label">{node.label}</span>
                          </span>
                          <Show when={isSelected()}>
                            <span class="conn-node-check" aria-hidden="true">[selected]</span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                  <p class="conn-mesh-note">
                    // Suimyaku mesh: connecting to either node reaches the full IRCXNet network
                  </p>
                </div>

                <div class="conn-seam" style={{ margin: '20px 0' }} aria-hidden="true" />

                <div class="conn-fields">
                  <FormField
                    id="conn-nick"
                    label="Nick"
                    type="text"
                    placeholder="your-nick"
                    autocomplete="username"
                    maxlength={64}
                    required
                    disabled={!isFormReady()}
                    value={nick()}
                    onInput={(e) => {
                      setNick(e.currentTarget.value);
                      setNickError(undefined);
                    }}
                    error={nickError()}
                    aria-required="true"
                  />

                  <FormField
                    id="conn-password"
                    label="Password (optional — SASL PLAIN / SCRAM)"
                    type="password"
                    placeholder="leave blank to connect anonymously"
                    autocomplete="current-password"
                    disabled={!isFormReady()}
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                  />
                </div>

                <div class="conn-seam" style={{ margin: '20px 0' }} aria-hidden="true" />

                {/* Stay signed in toggle */}
                <div class="conn-toggle">
                  <div class="conn-toggle-body">
                    <label class="conn-toggle-label" for="conn-stay-signed-in">
                      Stay signed in
                    </label>
                    <p class="conn-toggle-description" id="conn-session-desc">
                      Requests a SESSION TOKEN for instant reconnect reclaim
                    </p>
                  </div>
                  <label class="conn-toggle-switch">
                    <input
                      id="conn-stay-signed-in"
                      type="checkbox"
                      role="switch"
                      aria-checked={staySignedIn() ? 'true' : 'false'}
                      aria-describedby="conn-session-desc"
                      checked={staySignedIn()}
                      disabled={!isFormReady()}
                      onChange={(e) => setStaySignedIn(e.currentTarget.checked)}
                    />
                    <span class="conn-toggle-track" />
                    <span class="conn-toggle-thumb" aria-hidden="true" />
                  </label>
                </div>

                <div class="conn-seam" style={{ margin: '20px 0' }} aria-hidden="true" />

                {/* Status feedback */}
                <div
                  class="conn-status"
                  data-phase={phase()}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  data-testid="conn-status"
                >
                  <span class="conn-status-dot" aria-hidden="true" />
                  <div class="conn-status-body">
                    <span class="conn-status-phase">{phaseLabel()}</span>
                    <span class="conn-status-msg">{statusMsg()}</span>
                  </div>
                </div>

                {/* Actions */}
                <div class="conn-actions" style={{ 'margin-top': '20px' }}>
                  <Show
                    when={phase() !== 'connecting' && phase() !== 'cap' && phase() !== 'sasl'}
                    fallback={
                      <div class="conn-submit" style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                        <Spinner size="sm" label={phaseLabel()} />
                      </div>
                    }
                  >
                    <Button
                      class="conn-submit"
                      type="submit"
                      variant="primary"
                      disabled={!isFormReady() || !nickTrimmed()}
                      aria-label={`Connect to ${selectedNode().host}`}
                      data-testid="conn-submit"
                    >
                      {phase() === 'error' ? '[retry]' : '[connect]'}
                    </Button>
                  </Show>
                </div>
              </form>
            </div>

            {/* Footer */}
            <footer class="conn-foot">
              <b>IRCXNet</b> · Orochi Mesh · <b>{selectedNode().host}</b> · wss :8080
            </footer>
          </div>
        </div>
      }
    >
      {/* Connected shell */}
      <ConnectedShell
        nick={ourNick()}
        networkName={networkName()}
        channels={channels()}
        feedLines={feedLines()}
        onDisconnect={handleDisconnect}
      />
    </Show>
  );
}
