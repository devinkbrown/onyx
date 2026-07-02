/**
 * Connect.tsx — Onyx connect screen (Ocean dark-luxury).
 *
 * The front door to the Orochi mesh. A segmented mode switch routes between
 * three auth surfaces, all on the same Ocean atmosphere:
 *
 *   • Guest    — nick only; drifts in anonymously (or with a saved SESSION).
 *   • Sign in  — nick + account password → SASL login.
 *   • Register — desired account + optional email + password (+ confirm), with
 *                live validation and a strength meter. Flows form → verify → done.
 *
 * Two contextual recovery paths layer on top:
 *   • GHOST reclaim — when a nick is in use, offer to evict the stale session.
 *   • Session resume — a one-tap "welcome back" when a remembered identity exists.
 *
 * The network is a single mesh, so the client does NOT expose a server picker:
 * it measures latency to each node and attaches to the fastest (nearest) one
 * automatically. Which node is used is never surfaced in the UI.
 *
 * The global store is the single source of truth. We call getState() actions and
 * gate the view on connectionStatus; registration reacts to registerPending /
 * registerError / verifyRequired. Nick-in-use is detected from the store's
 * currentNickIsAlias flag (or the latest error notification) — we never mutate
 * the store to learn it.
 *
 * SOLID IDIOMS: components run once. Never destructure props. Use splitProps,
 * createSignal/createMemo/createEffect/onCleanup, For/Show, and clean up the
 * client on unmount.
 */

import './connect.css';
import {
  createSignal,
  createMemo,
  createEffect,
  For,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { parseAtParam, parseJoinParam } from '@/lib/deeplink';
import { ConnectPulse } from './ConnectPulse';
import { AppShell } from '@/shell';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Spinner } from '@/primitives/index';
import { Mascot } from '@/components/brand/Mascot';
import { loadCredentials, type SavedCredentials } from '@/lib/credentials';
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

// ── Constants ────────────────────────────────────────────────────────────────

type Mode = 'guest' | 'signin' | 'register';

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'guest',    label: 'Guest' },
  { id: 'signin',   label: 'Sign in' },
  { id: 'register', label: 'Register' },
];

/** Account passwords must be at least this long to register. */
const MIN_PASSWORD_LEN = 8;

// ── Validation helpers (pure) ────────────────────────────────────────────────

/** IRC nick rules — start with a letter / special char, no leading digit. */
export function validateNick(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Nick is required.';
  if (v.length > 64) return 'Nick must be 64 characters or fewer.';
  if (!/^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/.test(v)) {
    return 'Nick must start with a letter or IRC special char and contain only letters, numbers, or -[]\\`_^{|}.';
  }
  return undefined;
}

/** A light, forgiving email shape check (optional field — empty is valid). */
export function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined; // optional
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required.';
  if (value.length < MIN_PASSWORD_LEN) return `Use at least ${MIN_PASSWORD_LEN} characters.`;
  return undefined;
}

export function validateConfirm(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Confirm your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return undefined;
}

/** 0–4 strength score from length + character-class variety. */
export function passwordStrength(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: 'empty' };
  let score = 0;
  if (value.length >= MIN_PASSWORD_LEN) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const LABELS = ['weak', 'weak', 'fair', 'good', 'strong'] as const;
  return { score: clamped, label: LABELS[clamped] };
}

// ── Password input with show / hide toggle ───────────────────────────────────

interface PasswordInputProps {
  id: string;
  label: string;
  placeholder?: string;
  autocomplete?: string;
  value: string;
  error?: string;
  description?: string;
  disabled?: boolean;
  required?: boolean;
  onInput: (value: string) => void;
}

function PasswordInput(props: PasswordInputProps): JSX.Element {
  const [shown, setShown] = createSignal(false);
  const descriptionId = () => (props.description ? `${props.id}-description` : undefined);
  const errorId = () => (props.error ? `${props.id}-error` : undefined);
  const describedBy = () =>
    [descriptionId(), errorId()].filter(Boolean).join(' ') || undefined;

  return (
    <div class="onyx-field conn-password">
      <label class="onyx-field__label" for={props.id}>{props.label}</label>
      <Show when={props.description}>
        <p class="onyx-field__description" id={descriptionId()}>{props.description}</p>
      </Show>
      <div class="conn-password-row">
        <input
          id={props.id}
          class="onyx-field__input"
          type={shown() ? 'text' : 'password'}
          placeholder={props.placeholder}
          autocomplete={props.autocomplete}
          value={props.value}
          required={props.required}
          disabled={props.disabled}
          aria-invalid={props.error ? 'true' : undefined}
          aria-describedby={describedBy()}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
        <button
          type="button"
          class="conn-password-toggle"
          aria-pressed={shown() ? 'true' : 'false'}
          aria-label={shown() ? 'Hide password' : 'Show password'}
          disabled={props.disabled}
          onClick={() => setShown((v) => !v)}
        >
          {shown() ? 'Hide' : 'Show'}
        </button>
      </div>
      <Show when={props.error}>
        <p class="onyx-field__error" id={errorId()}>{props.error}</p>
      </Show>
    </div>
  );
}

// ── Connect form ─────────────────────────────────────────────────────────────

export interface ConnectProps {
  /** Unused — kept for API compat with any existing callers. */
  onConnected?: () => void;
}

export function Connect(props: ConnectProps): JSX.Element {
  void props;

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = createSignal<Mode>('guest');

  // Website → app handoff: /app?join=%23channel (+ optional &at=<moment> for
  // time travel). Validated before it goes anywhere near a JOIN; a bad link is
  // simply ignored.
  const deepLinkJoin = parseJoinParam(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('join')
      : null,
  );
  const deepLinkAt = parseAtParam(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('at')
      : null,
  );
  if (deepLinkJoin) getState().setPendingDeepLinkJoin(deepLinkJoin, deepLinkAt);

  // Optional room to join after connect (there is NO automatic join). The
  // field prefills from the ?join= deep link; on submit it becomes the
  // pending join. Empty = land on Home and choose from the directory.
  const [room, setRoom] = createSignal(deepLinkJoin ?? '');
  const [roomError, setRoomError] = createSignal<string | undefined>(undefined);

  /** '#chan' | 'chan' → validated '#chan'; empty → null; garbage → undefined. */
  function normalizeRoom(raw: string): string | null | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    return parseJoinParam(withHash) ?? undefined;
  }

  // ── Shared form state ──────────────────────────────────────────────────────
  const [nick, setNick] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [staySignedIn, setStaySignedIn] = createSignal(true);

  // Register-only fields
  const [email, setEmail] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [verifyCode, setVerifyCode] = createSignal('');

  // Per-field errors (only shown after a submit attempt for that field)
  const [nickError, setNickError] = createSignal<string | undefined>(undefined);
  const [passwordError, setPasswordError] = createSignal<string | undefined>(undefined);
  const [emailError, setEmailError] = createSignal<string | undefined>(undefined);
  const [confirmError, setConfirmError] = createSignal<string | undefined>(undefined);
  const [verifyError, setVerifyError] = createSignal<string | undefined>(undefined);

  // True only once a connect has actually been submitted — so the form never
  // flashes "error" merely because a nick was typed while disconnected.
  const [attempted, setAttempted] = createSignal(false);

  // Registration is a small state machine, tracked explicitly so the multi-step
  // gating never depends on signal-update ordering:
  //   idle       → not registering
  //   submitting → REGISTER sent; awaiting the server's verdict
  //   verifying  → server asked for a code; the verify form is showing
  //   completing → code accepted; chaining into a real authed connect
  type RegisterPhase = 'idle' | 'submitting' | 'verifying' | 'completing';
  const [registerPhase, setRegisterPhase] = createSignal<RegisterPhase>('idle');
  const registerSubmitted = createMemo(() => registerPhase() !== 'idle');

  // ── GHOST reclaim ──────────────────────────────────────────────────────────
  const [reclaimOpen, setReclaimOpen] = createSignal(false);
  const [reclaimPassword, setReclaimPassword] = createSignal('');

  // ── Remembered identity (one-tap resume) ───────────────────────────────────
  const [saved, setSaved] = createSignal<SavedCredentials | null>(null);
  const [resumeDismissed, setResumeDismissed] = createSignal(false);

  // ── Automatic node selection (no server picker) ────────────────────────────
  const [chosenNode, setChosenNode] = createSignal<IrcNode>(initialNode());
  const [routing, setRouting] = createSignal(true);

  onMount(() => {
    void selectBestNode().then((node) => {
      setChosenNode(node);
      setRouting(false);
    });
    // Surface a remembered identity if one exists. Pre-fill the nick so guest /
    // sign-in start from a familiar place.
    const creds = loadCredentials();
    if (creds) {
      setSaved(creds);
      if (!nick()) setNick(creds.nick);
    }
  });

  // ── Store reads ─────────────────────────────────────────────────────────────
  const connectionStatus = useStore((s) => s.connectionStatus);
  const autoReconnect = useStore((s) => s.autoReconnect);
  const ourNick = useStore((s) => s.ourNick);
  const registerPending = useStore((s) => s.registerPending);
  const registerError = useStore((s) => s.registerError);
  const verifyRequired = useStore((s) => s.verifyRequired);
  const currentNickIsAlias = useStore((s) => s.currentNickIsAlias);
  const notifications = useStore((s) => s.notifications);

  // Latest error notification text — used to distinguish failure types and to
  // detect a nick-in-use without modifying the store.
  const lastErrorText = createMemo<string>(() => {
    const list = notifications();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.type === 'error') return list[i]!.text;
    }
    return '';
  });

  const nickInUse = createMemo<boolean>(() => {
    if (currentNickIsAlias()) return true;
    return /nick(?:name)?\s+in\s+use/i.test(lastErrorText());
  });

  // ── Derived phase for the form status bar ───────────────────────────────────
  const formPhase = createMemo<'idle' | 'connecting' | 'error'>(() => {
    const s = connectionStatus();
    if (s === 'connecting' || s === 'reconnecting') return 'connecting';
    if (s === 'disconnected') {
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

  // Reactive status copy — distinguishes failure types, never names a server,
  // never blames the nick for a server-side failure.
  const statusMsg = createMemo(() => {
    if (registerPending()) return 'Registering your account…';
    if (registerError()) return registerError() ?? 'Registration failed — please try again.';
    if (verifyRequired() && registerSubmitted()) {
      return 'Almost there — enter the verification code we sent you.';
    }
    switch (formPhase()) {
      case 'connecting':
        return 'Opening an encrypted channel…';
      case 'error':
        if (nickInUse()) {
          return 'That name is already in the water — reclaim it, or pick another.';
        }
        if (/password|auth|login|incorrect|credential|464/i.test(lastErrorText())) {
          return 'That password was not accepted. Check it and sign in again.';
        }
        return "The network didn't answer — it may be busy. Try again in a moment.";
      default:
        return routing()
          ? 'Finding the nearest node…'
          : modeHint(mode());
    }
  });

  function modeHint(m: Mode): string {
    switch (m) {
      case 'signin':
        return 'Sign in to your account — Onyx finds the nearest node for you.';
      case 'register':
        return 'Claim a name that is yours — registration takes a moment.';
      default:
        return 'Pick a name and slip into the water — Onyx finds the nearest node for you.';
    }
  }

  // The status phase reflects registration first, then connection.
  const statusPhase = createMemo<'idle' | 'connecting' | 'error'>(() => {
    if (registerError()) return 'error';
    if (registerPending()) return 'connecting';
    return formPhase();
  });

  const isFormReady = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connecting' || s === 'connected' || s === 'reconnecting') return false;
    return !registerPending();
  });

  // ── Live validity (drives submit-button enablement, no error text yet) ──────
  const nickTrimmed = createMemo(() => nick().trim());

  const canSubmit = createMemo<boolean>(() => {
    if (!isFormReady()) return false;
    const m = mode();
    if (m === 'guest') return !!nickTrimmed();
    if (m === 'signin') return !!nickTrimmed() && !!password();
    // register
    return (
      !validateNick(nick()) &&
      !validateEmail(email()) &&
      !validatePassword(password()) &&
      !validateConfirm(password(), confirm())
    );
  });

  // ── Registration phase transitions (deterministic, store-reactive) ──────────
  // REGISTER / VERIFY are dispatched only after the round-trip is observed, so a
  // dedicated flag marks "a request is in flight" — transitions then key off the
  // server's verdict (registerPending falling edge), never on signal ordering.
  const [registerInFlight, setRegisterInFlight] = createSignal(false);

  // submitting → verifying: the server asked for a verification code.
  createEffect(() => {
    if (registerPhase() === 'submitting' && verifyRequired()) {
      setRegisterInFlight(false);
      setRegisterPhase('verifying');
    }
  });

  // Resolution of a REGISTER / VERIFY round-trip is signalled by registerPending
  // falling to false. The server reports VERIFICATION_REQUIRED and SUCCESS as
  // separate store writes whose individual keys may surface to our selectors in
  // any order, so we defer the success decision to a microtask: by then every
  // key in the batch has settled and a pending verifyRequired wins cleanly.
  createEffect(() => {
    const phase = registerPhase();
    const inFlight = registerInFlight();
    const pending = registerPending();
    if ((phase === 'submitting' || phase === 'verifying') && inFlight && !pending) {
      // Deliberately untracked: the microtask samples the LATEST signal values
      // once, after the store batch settles — tracking here would re-arm the
      // effect on every read and defeat the settle-then-decide design above.
      // eslint-disable-next-line solid/reactivity
      queueMicrotask(() => {
        if (!registerInFlight()) return;
        if (registerError()) {
          setRegisterInFlight(false);
          return; // surfaced inline; user can retry
        }
        if (registerPhase() === 'submitting' && verifyRequired()) {
          return; // the verifying transition handles this
        }
        if (!verifyRequired()) {
          setRegisterInFlight(false);
          finishRegistration();
        }
      });
    }
  });

  // When the verify step appears, focus the code field.
  let verifyInputRef: HTMLInputElement | undefined;
  createEffect(() => {
    if (registerPhase() === 'verifying' && verifyInputRef) {
      verifyInputRef.focus();
    }
  });

  function finishRegistration(): void {
    setRegisterPhase('completing');
    if (connectionStatus() === 'connected') {
      // Drop the anonymous connection used to run REGISTER so the next connect
      // re-runs SASL and logs the new account in.
      getState().disconnect();
    }
    doConnect(nickTrimmed(), password());
    setRegisterPhase('idle');
  }

  // ── Mode switching ──────────────────────────────────────────────────────────
  function switchMode(next: Mode): void {
    if (next === mode()) return;
    setMode(next);
    // Clear transient errors so a stale message from another mode never lingers.
    setNickError(undefined);
    setPasswordError(undefined);
    setEmailError(undefined);
    setConfirmError(undefined);
    setVerifyError(undefined);
  }

  // ── Connect action (shared by guest / sign-in / post-register) ──────────────
  function doConnect(n: string, pass: string): void {
    setAttempted(true);
    setReclaimOpen(false);
    const node = chosenNode();
    getState().connect({
      url:  node.wss,
      nick: n,
      password: pass.trim() || undefined,
      realname: `${n} (Onyx)`,
    });
    // staySignedIn: the store persists session tokens via saveCredentials /
    // loadCredentials internally. The toggle communicates intent in the UI.
    void staySignedIn;
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const m = mode();

    if (m === 'register') {
      handleRegisterSubmit();
      return;
    }

    // guest / sign-in share nick validation.
    const n = nickTrimmed();
    const err = validateNick(n);
    setNickError(err);
    if (err) return;

    // Optional room: validated, normalized, then queued for the post-connect
    // join (same path as the website's ?join= deep link).
    const normalizedRoom = normalizeRoom(room());
    if (normalizedRoom === undefined) {
      setRoomError('Channel names are like #lounge — no spaces or commas.');
      return;
    }
    setRoomError(undefined);
    // Preserve the ?at= moment when the room came from the deep link; a
    // manually retyped different room shouldn't inherit someone else's moment.
    getState().setPendingDeepLinkJoin(
      normalizedRoom,
      normalizedRoom === deepLinkJoin ? deepLinkAt : null,
    );

    if (m === 'signin') {
      const pErr = password() ? undefined : 'Password is required to sign in.';
      setPasswordError(pErr);
      if (pErr) return;
      doConnect(n, password());
    } else {
      doConnect(n, '');
    }
  }

  function handleRegisterSubmit(): void {
    const nErr = validateNick(nick());
    const eErr = validateEmail(email());
    const pErr = validatePassword(password());
    const cErr = validateConfirm(password(), confirm());
    setNickError(nErr);
    setEmailError(eErr);
    setPasswordError(pErr);
    setConfirmError(cErr);
    if (nErr || eErr || pErr || cErr) return;

    const n = nickTrimmed();
    setRegisterPhase('submitting');
    setAttempted(true);

    // REGISTER is a post-connection server command, so the connection must exist
    // first. Connect under the desired nick (anonymously); the store reacts and
    // the verify step / success drives the rest. registerInFlight flips true the
    // moment REGISTER is actually dispatched (here or via the pending effect).
    if (connectionStatus() === 'disconnected') {
      // Stage the deferred REGISTER *before* connecting: the connect may flip
      // status to 'connected' synchronously, firing the pending effect, so the
      // payload must already be in place.
      _pendingRegister = { account: n, email: email().trim() || undefined, password: password() };
      doConnect(n, '');
    } else {
      setRegisterInFlight(true);
      getState().registerAccount(n, email().trim() || undefined, password());
    }
  }

  // When a Register submit had to connect first, fire REGISTER once connected.
  let _pendingRegister: { account: string; email: string | undefined; password: string } | null = null;
  createEffect(() => {
    if (connectionStatus() === 'connected' && _pendingRegister && registerPhase() === 'submitting') {
      const reg = _pendingRegister;
      _pendingRegister = null;
      setRegisterInFlight(true);
      getState().registerAccount(reg.account, reg.email, reg.password);
    }
  });

  function handleVerifySubmit(event: SubmitEvent): void {
    event.preventDefault();
    const code = verifyCode().trim();
    if (!code) {
      setVerifyError('Enter the verification code.');
      return;
    }
    setVerifyError(undefined);
    setRegisterInFlight(true);
    getState().verifyAccount(nickTrimmed(), code);
  }

  // ── GHOST reclaim ───────────────────────────────────────────────────────────
  function handleReclaim(event: SubmitEvent): void {
    event.preventDefault();
    const pass = reclaimPassword().trim();
    if (!pass) return;
    // Evict the stale session, then retry the connection under the desired nick.
    getState().ghost(nickTrimmed(), pass);
    setReclaimOpen(false);
    setReclaimPassword('');
    doConnect(nickTrimmed(), password());
  }

  // ── Session resume (one-tap) ────────────────────────────────────────────────
  function handleResume(): void {
    const creds = saved();
    if (!creds) return;
    setNick(creds.nick);
    doConnect(creds.nick, creds.password ?? '');
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────
  function handleDisconnect(): void {
    setAttempted(false);
    setRegisterPhase('idle');
    setRegisterInFlight(false);
    _pendingRegister = null;
    getState().disconnect();
  }

  const showResume = createMemo(() =>
    !resumeDismissed() && !!saved() && !attempted() && mode() !== 'register'
  );
  const showReclaim = createMemo(() => formPhase() === 'error' && nickInUse());
  const inVerifyStep = createMemo(() => registerPhase() === 'verifying');

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Show
      // The shell stays mounted through a DROP: autoReconnect is true only
      // after a successful connect (and false again on deliberate disconnect
      // or when retries give up), so a network blip shows the reconnect
      // banner + offline composer instead of bouncing to this form.
      when={(connectionStatus() === 'connected' || autoReconnect()) && registerPhase() === 'idle'}
      fallback={
        <div class="conn" data-testid="connect-screen" data-mode={mode()}>
          <Atmosphere />

          <div class="conn-stage">
          <div class="conn-card" role="main">
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
                  Choose how you arrive. Onyx finds the nearest node by latency
                  and runs the handshake — no server to choose, nothing to
                  configure.
                </p>
              </header>

              {/* Session resume — one-tap welcome back */}
              <Show when={showResume()}>
                <div class="conn-resume" role="region" aria-label="Resume session">
                  <div class="conn-resume-body">
                    <span class="conn-resume-eyebrow">Welcome back</span>
                    <span class="conn-resume-nick">
                      Resume as <b>{saved()!.nick}</b>
                    </span>
                  </div>
                  <div class="conn-resume-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!isFormReady()}
                      onClick={handleResume}
                      data-testid="conn-resume"
                    >
                      Resume
                    </Button>
                    <button
                      type="button"
                      class="conn-resume-dismiss"
                      aria-label="Dismiss resume"
                      onClick={() => setResumeDismissed(true)}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              </Show>

              {/* Mode switch */}
              <div
                class="conn-modes"
                role="tablist"
                aria-label="Connection mode"
                data-testid="conn-modes"
              >
                <For each={MODES}>
                  {(m) => (
                    <button
                      type="button"
                      role="tab"
                      class="conn-mode"
                      data-active={mode() === m.id ? 'true' : 'false'}
                      aria-selected={mode() === m.id ? 'true' : 'false'}
                      disabled={!isFormReady()}
                      onClick={() => switchMode(m.id)}
                    >
                      {m.label}
                    </button>
                  )}
                </For>
              </div>

              <div class="conn-seam" aria-hidden="true" />

              {/* Auto-routing indicator — never reveals which server is used */}
              <p class="conn-route" data-routing={routing() ? 'true' : 'false'}>
                <span class="conn-route-dot" aria-hidden="true" />
                <Show when={routing()} fallback="Routed to the nearest node">
                  Locating the nearest node…
                </Show>
              </p>

              {/* ── Verify step (register only) ── */}
              <Show when={inVerifyStep()}>
                <form
                  class="conn-verify"
                  onSubmit={handleVerifySubmit}
                  noValidate
                  aria-label="Account verification form"
                  data-testid="conn-verify-form"
                >
                  <div class="conn-step" aria-hidden="true">
                    <span class="conn-step-dot" data-done="true" />
                    <span class="conn-step-line" />
                    <span class="conn-step-dot" data-active="true" />
                    <span class="conn-step-line" />
                    <span class="conn-step-dot" />
                  </div>
                  <p class="conn-verify-lead">
                    We sent a verification code for <b>{nickTrimmed()}</b>. Enter it
                    to finish creating your account.
                  </p>
                  <FormField
                    id="conn-verify-code"
                    label="Verification code"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    placeholder="000000"
                    disabled={registerPending()}
                    value={verifyCode()}
                    error={verifyError()}
                    ref={(el: HTMLInputElement) => (verifyInputRef = el)}
                    onInput={(e) => {
                      setVerifyCode(e.currentTarget.value);
                      setVerifyError(undefined);
                    }}
                  />
                  <Show
                    when={!registerPending()}
                    fallback={
                      <div class="conn-submit" style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                        <Spinner size="sm" label="Verifying" />
                      </div>
                    }
                  >
                    <Button
                      class="conn-submit"
                      type="submit"
                      variant="primary"
                      disabled={!verifyCode().trim()}
                      data-testid="conn-verify-submit"
                    >
                      Verify &amp; enter
                    </Button>
                  </Show>
                </form>
              </Show>

              {/* ── Main auth form (hidden during the verify step) ── */}
              <Show when={!inVerifyStep()}>
                <form
                  onSubmit={handleSubmit}
                  noValidate
                  aria-label="IRC connection form"
                >
                  <div class="conn-fields">
                    <FormField
                      id="conn-nick"
                      label={mode() === 'register' ? 'Desired account / nick' : 'Nick'}
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

                    {/* Optional room — nothing joins automatically */}
                    <Show when={mode() !== 'register'}>
                      <FormField
                        id="conn-room"
                        label="Channel"
                        description="Optional — join a room right away, or browse from Home"
                        type="text"
                        placeholder="#root"
                        maxlength={64}
                        disabled={!isFormReady()}
                        value={room()}
                        onInput={(e) => {
                          setRoom(e.currentTarget.value);
                          setRoomError(undefined);
                        }}
                        error={roomError()}
                      />
                    </Show>

                    {/* Email — register only, optional */}
                    <Show when={mode() === 'register'}>
                      <FormField
                        id="conn-email"
                        label="Email"
                        description="Optional — for account recovery"
                        type="email"
                        placeholder="you@example.com"
                        autocomplete="email"
                        disabled={!isFormReady()}
                        value={email()}
                        onInput={(e) => {
                          setEmail(e.currentTarget.value);
                          setEmailError(undefined);
                        }}
                        error={emailError()}
                      />
                    </Show>

                    {/* Password — guest hides it; sign-in & register show it */}
                    <Show when={mode() !== 'guest'}>
                      <PasswordInput
                        id="conn-password"
                        label={mode() === 'register' ? 'Password' : 'Account password'}
                        placeholder={mode() === 'register' ? 'at least 8 characters' : 'your account password'}
                        autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
                        required
                        disabled={!isFormReady()}
                        value={password()}
                        error={passwordError()}
                        onInput={(value) => {
                          setPassword(value);
                          setPasswordError(undefined);
                        }}
                      />
                    </Show>

                    {/* Strength meter + confirm — register only */}
                    <Show when={mode() === 'register'}>
                      <div
                        class="conn-strength"
                        data-score={passwordStrength(password()).score}
                        aria-hidden={password() ? undefined : 'true'}
                      >
                        <div class="conn-strength-track">
                          <For each={[0, 1, 2, 3]}>
                            {(i) => (
                              <span
                                class="conn-strength-seg"
                                data-on={passwordStrength(password()).score > i ? 'true' : 'false'}
                              />
                            )}
                          </For>
                        </div>
                        <span class="conn-strength-label">
                          {password() ? passwordStrength(password()).label : ''}
                        </span>
                      </div>

                      <PasswordInput
                        id="conn-confirm"
                        label="Confirm password"
                        placeholder="re-enter your password"
                        autocomplete="new-password"
                        required
                        disabled={!isFormReady()}
                        value={confirm()}
                        error={confirmError()}
                        onInput={(value) => {
                          setConfirm(value);
                          setConfirmError(undefined);
                        }}
                      />
                    </Show>
                  </div>

                  {/* Stay signed in — guest & sign-in only (register chains in) */}
                  <Show when={mode() !== 'register'}>
                    <div class="conn-seam" style={{ margin: '20px 0' }} aria-hidden="true" />
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
                  </Show>

                  <div class="conn-seam" style={{ margin: '20px 0' }} aria-hidden="true" />

                  {/* Status feedback */}
                  <div
                    class="conn-status"
                    data-phase={statusPhase()}
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

                  {/* GHOST reclaim — appears when the nick is in use */}
                  <Show when={showReclaim()}>
                    <div class="conn-reclaim" data-testid="conn-reclaim">
                      <Show
                        when={reclaimOpen()}
                        fallback={
                          <button
                            type="button"
                            class="conn-reclaim-open"
                            data-testid="conn-reclaim-open"
                            onClick={() => setReclaimOpen(true)}
                          >
                            That name is taken — reclaim it?
                          </button>
                        }
                      >
                        <div class="conn-reclaim-form">
                          <p class="conn-reclaim-lead">
                            Enter the account password for <b>{nickTrimmed()}</b> to
                            evict the stale session.
                          </p>
                          <PasswordInput
                            id="conn-reclaim-password"
                            label="Account password"
                            placeholder="account password"
                            autocomplete="current-password"
                            value={reclaimPassword()}
                            onInput={(value) => setReclaimPassword(value)}
                          />
                          <div class="conn-reclaim-actions">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={!reclaimPassword().trim()}
                              onClick={(e: MouseEvent) => handleReclaim(e as unknown as SubmitEvent)}
                              data-testid="conn-reclaim-submit"
                            >
                              Reclaim &amp; connect
                            </Button>
                            <button
                              type="button"
                              class="conn-reclaim-cancel"
                              onClick={() => setReclaimOpen(false)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* Submit */}
                  <div class="conn-actions" style={{ 'margin-top': '20px' }}>
                    <Show
                      when={statusPhase() !== 'connecting'}
                      fallback={
                        <div class="conn-submit" style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                          <Spinner size="sm" label={registerPending() ? 'Registering' : phaseLabel()} />
                        </div>
                      }
                    >
                      <Button
                        class="conn-submit"
                        type="submit"
                        variant="primary"
                        disabled={!canSubmit()}
                        aria-label={SUBMIT_ARIA[mode()]}
                        data-testid="conn-submit"
                      >
                        {submitLabel(mode(), formPhase())}
                      </Button>
                    </Show>
                  </div>
                </form>
              </Show>
            </div>

            {/* Footer */}
            <footer class="conn-foot">
              <b>IRCXNet</b> · encrypted · auto-routed
            </footer>
          </div>

          <ConnectPulse deepLink={deepLinkJoin} />
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

// ── Submit copy ───────────────────────────────────────────────────────────────

const SUBMIT_ARIA: Record<Mode, string> = {
  guest:    'Connect to IRCXNet as a guest',
  signin:   'Sign in to IRCXNet',
  register: 'Register a new account',
};

function submitLabel(mode: Mode, phase: 'idle' | 'connecting' | 'error'): string {
  if (phase === 'error') return 'Try again';
  switch (mode) {
    case 'signin':   return 'Sign in';
    case 'register': return 'Create account';
    default:         return 'Dive in';
  }
}
