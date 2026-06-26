/**
 * Connect.tsx — Onyx connect screen (Ocean dark-luxury).
 *
 * Renders the nick/password form, session-token toggle, live connection-state
 * feedback, and (when connected) the real AppShell.
 *
 * The network is a single mesh, so the client does NOT expose a server picker:
 * it measures latency to each node and attaches to the fastest (nearest) one
 * automatically. Which node is used is never surfaced in the UI.
 *
 * The global store is the single source of truth for the connection. On submit,
 * we call getState().connect(...) and gate the view on connectionStatus.
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
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { AppShell } from '@/shell';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Spinner } from '@/primitives/index';
import { Mascot } from '@/components/brand/Mascot';
import { initialNode, selectBestNode, type IrcNode } from './nodes';

// ── Ocean atmosphere — deep-water depth, azure currents, bioluminescence ─────
// Self-contained to the connect screen (namespaced .conn-sea-*) so it carries
// its own ocean motifs rather than borrowing the landing layer. Every moving
// part is paused under prefers-reduced-motion (see connect.css).

/** Sparse drifting bioluminescent motes — deterministic layout, no randomness. */
const MOTES: ReadonlyArray<{ x: number; y: number; s: number; d: number; t: 'cyan' | 'gold' }> = [
  { x: 12, y: 22, s: 2.4, d: 0,    t: 'cyan' },
  { x: 28, y: 64, s: 1.6, d: 1400, t: 'cyan' },
  { x: 44, y: 14, s: 1.9, d: 600,  t: 'gold' },
  { x: 61, y: 48, s: 2.6, d: 2200, t: 'cyan' },
  { x: 73, y: 78, s: 1.5, d: 900,  t: 'cyan' },
  { x: 84, y: 30, s: 2.0, d: 1800, t: 'gold' },
  { x: 91, y: 60, s: 1.7, d: 300,  t: 'cyan' },
  { x: 18, y: 86, s: 1.4, d: 2600, t: 'cyan' },
];

function Atmosphere(): JSX.Element {
  return (
    <>
      {/* Depth gradient — abyss (bottom) → light filtering down (top) */}
      <div class="conn-sea-depth" aria-hidden="true" />
      {/* Caustics — faint light bands drifting near the surface */}
      <div class="conn-sea-caustics" aria-hidden="true" />
      {/* Currents — flowing azure paths, one with a slow dash drift */}
      <svg
        class="conn-sea-currents"
        aria-hidden="true"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <path d="M0,300 Q300,200 600,300 T1200,280 T1440,320" />
        <path class="drift" d="M0,520 Q360,400 720,490 T1440,470" />
        <path d="M-40,720 Q380,620 760,700 T1480,680" />
      </svg>
      {/* Bioluminescence — sparse pulsing motes */}
      <div class="conn-sea-motes" aria-hidden="true">
        <For each={MOTES}>
          {(m) => (
            <span
              class="conn-sea-mote"
              data-tone={m.t}
              style={{
                left: `${m.x}%`,
                top: `${m.y}%`,
                '--mote-size': `${m.s}px`,
                '--mote-delay': `${m.d}ms`,
              }}
            />
          )}
        </For>
      </div>
      {/* Film grain — faint texture over the water */}
      <div class="conn-sea-grain" aria-hidden="true" />
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
  const [nick, setNick] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [staySignedIn, setStaySignedIn] = createSignal(true);
  const [nickError, setNickError] = createSignal<string | undefined>(undefined);
  // True only once the user has actually submitted a connect — so the form
  // never flashes an "error" merely because a nick was typed while disconnected.
  const [attempted, setAttempted] = createSignal(false);

  // ── Automatic node selection (no server picker) ───────────────────────────
  // Start with a synchronous best-guess so connect always has a target, then
  // refine to the lowest-latency (nearest) reachable node once probing resolves.
  // The chosen node is never shown in the UI.
  const [chosenNode, setChosenNode] = createSignal<IrcNode>(initialNode());
  const [routing, setRouting] = createSignal(true);

  onMount(() => {
    void selectBestNode().then((node) => {
      setChosenNode(node);
      setRouting(false);
    });
  });

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
  // Reactive status copy — never names a server (the client auto-routes) and
  // never blames the nick for a server-side failure.
  const statusMsg = createMemo(() => {
    switch (formPhase()) {
      case 'connecting':
        return 'Opening an encrypted channel…';
      case 'error':
        return "The network didn't answer — it may be busy. Try again in a moment.";
      default:
        return routing()
          ? 'Finding the nearest node…'
          : 'Pick a name and slip into the water — Onyx finds the nearest node for you.';
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
    const node = chosenNode();
    const pass = password().trim() || undefined;

    getState().connect({
      url:  node.wss,
      nick: n,
      password: pass,
      realname: `${n} (Onyx)`,
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
            {/* Bioluminescent crest hairline runs across the top of the card */}
            <div class="conn-crest" aria-hidden="true" />

            <div class="conn-body">
              {/* Header */}
              <header class="conn-header">
                <span class="conn-brand" aria-hidden="true">
                  <Mascot variant="mark" class="conn-brand-mark" />
                </span>
                <span class="conn-eyebrow">IRCXNet</span>
                <h1 class="conn-title">Connect</h1>
                <p class="conn-sub">
                  Choose a name and slip into the water. Onyx finds the nearest
                  node by latency and runs the handshake — no server to choose,
                  nothing to configure.
                </p>
              </header>

              <div class="conn-seam" aria-hidden="true" />

              <form onSubmit={handleConnect} noValidate aria-label="IRC connection form">
                {/* Auto-routing indicator — never reveals which server is used */}
                <p class="conn-route" data-routing={routing() ? 'true' : 'false'}>
                  <span class="conn-route-dot" aria-hidden="true" />
                  <Show when={routing()} fallback="Routed to the nearest node">
                    Locating the nearest node…
                  </Show>
                </p>

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
                    label="Password — optional, SASL PLAIN / SCRAM"
                    type="password"
                    placeholder="leave blank to drift in anonymously"
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
                      Mints a SESSION token so you reconnect instantly — no re-login
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
                      aria-label="Connect to IRCXNet"
                      data-testid="conn-submit"
                    >
                      {formPhase() === 'error' ? 'Try again' : 'Dive in'}
                    </Button>
                  </Show>
                </div>
              </form>
            </div>

            {/* Footer */}
            <footer class="conn-foot">
              <b>IRCXNet</b> · encrypted · auto-routed
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
