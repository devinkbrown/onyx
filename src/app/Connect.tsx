/**
 * Connect.tsx — Ruri IRC connect screen.
 *
 * Renders the node picker, nick/password form, session-token toggle, live
 * connection-state feedback, and (when connected) the real AppShell.
 *
 * The global store is the single source of truth for the connection.
 * On submit, we call getState().connect(...) and gate the view on
 * connectionStatus from the store.
 *
 * SOLID IDIOMS: components run once. Never destructure props. Use splitProps,
 * createSignal/createMemo/createEffect/onCleanup, For/Show, and clean up the
 * client on unmount.
 */

import './connect.css';
import {
  createSignal,
  createMemo,
  For,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { AppShell } from '@/shell';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Spinner } from '@/primitives/index';
import { NODES, DEFAULT_NODE, type IrcNode } from './nodes';

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

// ── Connect form ─────────────────────────────────────────────────────────────

export interface ConnectProps {
  /** Unused — kept for API compat with any existing callers. */
  onConnected?: () => void;
}

export function Connect(props: ConnectProps): JSX.Element {
  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = createSignal<IrcNode>(DEFAULT_NODE);
  const [nick, setNick] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [staySignedIn, setStaySignedIn] = createSignal(true);
  const [nickError, setNickError] = createSignal<string | undefined>(undefined);
  // True only once the user has actually submitted a connect — so the form
  // never flashes an "error" merely because a nick was typed while disconnected.
  const [attempted, setAttempted] = createSignal(false);

  // ── Store reads ───────────────────────────────────────────────────────────
  const connectionStatus = useStore((s) => s.connectionStatus);
  const ourNick = useStore((s) => s.ourNick);

  // ── Derived phase label for the form status bar ───────────────────────────
  // Maps store connectionStatus to a display phase for the connect form.
  const formPhase = createMemo<'idle' | 'connecting' | 'error'>(() => {
    const s = connectionStatus();
    if (s === 'connecting' || s === 'reconnecting') return 'connecting';
    if (s === 'disconnected') {
      // Only an "error" once a connect has actually been attempted — typing a
      // nick before submitting must not surface an error state.
      return attempted() ? 'error' : 'idle';
    }
    return 'idle';
  });

  const PHASE_LABEL: Record<'idle' | 'connecting' | 'error', string> = {
    idle:       'not connected',
    connecting: 'connecting',
    error:      'error',
  };

  const phaseLabel = createMemo(() => PHASE_LABEL[formPhase()]);
  // Reactive status copy — reflects the *currently selected* node (not the one
  // chosen at mount) and never blames the nick for a server-side failure.
  const statusMsg = createMemo(() => {
    switch (formPhase()) {
      case 'connecting':
        return `Opening the door to ${selectedNode().host}…`;
      case 'error':
        return `Couldn't reach ${selectedNode().host}. The node may be unavailable — try the other door, or check your nick.`;
      default:
        return 'Pick a node and enter your nick to connect.';
    }
  });

  const isFormReady = createMemo(() => {
    const s = connectionStatus();
    return s !== 'connecting' && s !== 'connected' && s !== 'reconnecting';
  });

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

  // ── Connect action ────────────────────────────────────────────────────────

  function handleConnect(event: SubmitEvent): void {
    event.preventDefault();

    const n = nickTrimmed();
    const err = validateNick(n);
    setNickError(err);
    if (err) return;

    setAttempted(true);
    const node = selectedNode();
    const pass = password().trim() || undefined;

    getState().connect({
      url:  node.wss,
      nick: n,
      password: pass,
      realname: `${n} (Ruri / Ocean)`,
    });

    // staySignedIn: the store already saves/loads session tokens via
    // loadCredentials / saveCredentials internally. The toggle is surfaced
    // here for UX intent; future work can wire it to the store's credential
    // persistence layer.
    void staySignedIn;
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  function handleDisconnect(): void {
    setAttempted(false);
    getState().disconnect();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Show
      when={connectionStatus() === 'connected'}
      fallback={
        // ── Connect form ────────────────────────────────────────────────────
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
                  data-phase={formPhase()}
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
                    when={formPhase() !== 'connecting'}
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
                      {formPhase() === 'error' ? '[retry]' : '[connect]'}
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
      {/* Connected shell — reads everything from the store */}
      <AppShell
        onDisconnect={handleDisconnect}
        selfNick={ourNick()}
      />
    </Show>
  );
}
