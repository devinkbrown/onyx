// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Connect.tsx — Onyx first-run join screen.
 *
 * One primary path: join as a guest with a display name. Sign in and
 * Create account are secondary. The client still auto-selects a transport
 * endpoint; that choice is never shown or configurable here.
 *
 *   • Guest    — display name; optional room; land on Home if empty.
 *   • Sign in  — account name + password. Passkeys are not presented until
 *                server support is live end-to-end.
 *   • Register — account + optional email + password, then verify.
 *
 * Contextual recovery (reclaim a name in use, resume a remembered identity)
 * stays available without teaching identity modes on first arrival.
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
  ErrorBoundary,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
  type JSX,
} from 'solid-js';
import { lazyRouteFallback } from '@/app/StaleChunkRecovery';
import { useStore, getState } from '@/lib/store';
import { parseAtParam, parseJoinParam, parseReaderParam, parseTopicParam } from '@/lib/deeplink';
import { buildInviteCard, inviteTitle, inviteDescription } from '@/lib/invite/inviteCard';
import { setPreference } from '@/lib/prefs/preferences';
import { isPasskeySupported } from '@/lib/webauthn/passkey';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Spinner } from '@/primitives/index';
import { Mascot } from '@/components/brand/Mascot';
import {
  listRememberedIdentities,
  removeCredentials,
  removeRememberedIdentity,
  saveCredentials,
  selectRememberedIdentity,
  storeMeshToken,
  type RememberedIdentity,
  type SavedCredentials,
} from '@/lib/credentials';
import { normalizeRoomTarget } from '@/shell/roomIdentity';
import { recordFirstHourHandoff } from '@/lib/firstHour/firstHour';
import { initialNode, NODES, selectBestNode, type IrcNode } from './nodes';
import { installConnectPageLifecycle } from './connectPageLifecycle';

// The connected shell owns the transcript, roster, preferences, moderation,
// and activity surfaces. None of that is needed on the first-arrival form, so
// keep it out of the connection chunk and warm it while the socket handshakes.
const AppShell = lazy(() => import('@/shell/AppShell').then((module) => ({ default: module.AppShell })));

// Quiet dark field only — no poster glow, grid, or decorative motion.
function Atmosphere(): JSX.Element {
  return (
    <>
      <div class="conn-sea-depth" aria-hidden="true" />
      <div class="conn-sea-grain" aria-hidden="true" />
    </>
  );
}

/**
 * Passkeys exist in the client, but server WEBAUTHN is not live end-to-end.
 * Do not present them as an available sign-in method on this surface.
 */
const PRESENT_PASSKEY_SIGNIN = false;

// ── Constants ────────────────────────────────────────────────────────────────

type Mode = 'guest' | 'signin' | 'register';

const MODE_COPY: Record<Mode, { title: string; body: string }> = {
  guest: {
    title: 'Join a room',
    body: 'Join free — send a message in about a minute.',
  },
  signin: {
    title: 'Sign in',
    body: 'Use the name and password for your account.',
  },
  register: {
    title: 'Create account',
    body: 'Keep your name and rooms. Email is optional and can be added later.',
  },
};

/** Account passwords must be at least this long to register. */
const MIN_PASSWORD_LEN = 8;

/** Network name — used in the invite preview built from a `?join=` deep link. */
const NETWORK_NAME = 'Onyx';

// ── Validation helpers (pure) ────────────────────────────────────────────────

/** IRC nick rules — start with a letter / special char, no leading digit. */
export function validateNick(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Name is required.';
  if (v.length > 64) return 'Name must be 64 characters or fewer.';
  if (!/^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/.test(v)) {
    return 'Name must start with a letter or allowed special character and contain only letters, numbers, or -[]\\`_^{|}.';
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
  /** When passkeys are primary, password fields stay collapsed until the user asks. */
  const [passwordPathOpen, setPasswordPathOpen] = createSignal(false);
  /** Offline recovery-code path under sign-in (RECOVERYCODES LOGIN after 001). */
  const [recoveryPathOpen, setRecoveryPathOpen] = createSignal(false);
  const [recoveryCode, setRecoveryCode] = createSignal('');

  // Website → app handoff: /app/?join=%23channel (+ optional &at=<moment> for
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
  const deepLinkTopic = parseTopicParam(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('topic')
      : null,
  );
  const deepLinkReader = parseReaderParam(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('reader')
      : null,
  );
  if (deepLinkReader) setPreference('readerMode', true);
  if (deepLinkJoin) getState().setPendingDeepLinkJoin(deepLinkJoin, deepLinkAt, deepLinkTopic);

  // A welcoming preview of what the invite opens onto — built from the SAME deep
  // link the component already parsed. Only present when a join is pending; a
  // plain visit (no ?join=) leaves this null and renders no card. SSR-safe: the
  // search params and origin come from window, guarded above via deepLinkJoin.
  const inviteCard =
    deepLinkJoin && typeof window !== 'undefined'
      ? buildInviteCard(new URLSearchParams(window.location.search), {
          network: NETWORK_NAME,
          origin: window.location.origin,
        })
      : null;
  const suggestedGuestNick =
    inviteCard?.guestName && !validateNick(inviteCard.guestName)
      ? inviteCard.guestName
      : '';

  // Optional room to join after connect (there is NO automatic join). The
  // field prefills from the ?join= deep link; on submit it becomes the
  // pending join. Empty = land on Home and choose from the directory.
  const [room, setRoom] = createSignal(deepLinkJoin ?? '');
  const [roomError, setRoomError] = createSignal<string | undefined>(undefined);

  /** '#chan' | 'chan' → validated '#chan'; empty → null; garbage → undefined. */
  function normalizeRoom(raw: string): string | null | undefined {
    const normalized = normalizeRoomTarget(raw);
    if (!normalized) return null;
    return parseJoinParam(normalized) ?? undefined;
  }

  // ── Shared form state ──────────────────────────────────────────────────────
  const [nick, setNick] = createSignal(suggestedGuestNick);
  const [password, setPassword] = createSignal('');
  // Persisting an account password is an explicit private-device choice.
  const [staySignedIn, setStaySignedIn] = createSignal(false);

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
  const [rememberedIdentities, setRememberedIdentities] = createSignal<RememberedIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = createSignal<string | null>(null);
  const [resumeDismissed, setResumeDismissed] = createSignal(false);

  // ── Automatic node selection (no server picker) ────────────────────────────
  const [chosenNode, setChosenNode] = createSignal<IrcNode>(initialNode());
  const [routing, setRouting] = createSignal(true);

  type PasskeySignInAttempt = {
    account: string;
    transportStarted: boolean;
    dispatched: boolean;
  };
  const [passkeySignInAttempt, setPasskeySignInAttempt] =
    createSignal<PasskeySignInAttempt | null>(null);
  let passkeyButtonRef: HTMLButtonElement | undefined;

  onMount(() => {
    onCleanup(installConnectPageLifecycle(getState));
    const nodeSelectionController = typeof AbortController === 'undefined'
      ? null
      : new AbortController();
    let selectionActive = true;
    onCleanup(() => {
      selectionActive = false;
      nodeSelectionController?.abort();
    });
    void selectBestNode(NODES, { signal: nodeSelectionController?.signal }).then((node) => {
      if (!selectionActive) return;
      setChosenNode(node);
      setRouting(false);
    }).catch(() => {
      // Probe failures already fall back inside selectBestNode; an unexpected
      // rejection must still unblock the form with the initial node rather
      // than leave routing=true forever.
      if (!selectionActive) return;
      setRouting(false);
    });
    // Surface the bounded remembered-identity catalogue (active + 11 newest).
    // It contains only sanitized metadata; selecting an entry is the narrow
    // seam that loads its private authentication material.
    refreshRememberedIdentities(undefined, true);
  });

  function refreshRememberedIdentities(preferredId?: string, prefillNick = false): void {
    const available = listRememberedIdentities();
    const selected = available.find((identity) => identity.id === preferredId)
      ?? available.find((identity) => identity.active)
      ?? available[0];

    if (!selected) {
      setRememberedIdentities([]);
      setSelectedIdentityId(null);
      setSaved(null);
      return;
    }

    const credentials = selectRememberedIdentity(selected.id);
    const refreshed = credentials ? listRememberedIdentities() : available;
    setRememberedIdentities(refreshed);
    setSelectedIdentityId(credentials ? selected.id : null);
    setSaved(credentials);
    if (prefillNick && credentials && !nick()) setNick(credentials.nick);
  }

  // ── Store reads ─────────────────────────────────────────────────────────────
  const connectionStatus = useStore((s) => s.connectionStatus);
  const autoReconnect = useStore((s) => s.autoReconnect);
  const ourNick = useStore((s) => s.ourNick);
  const registerPending = useStore((s) => s.registerPending);
  const registerError = useStore((s) => s.registerError);
  const verifyRequired = useStore((s) => s.verifyRequired);
  const passkeyBusy = useStore((s) => s.passkeyBusy);
  const passkeyError = useStore((s) => s.passkeyError);
  const passkeyServerIdentity = useStore(
    (s) => ({ connected: s.server?.connected ?? false, account: s.server?.account ?? null }),
    (previous, next) =>
      previous.connected === next.connected && previous.account === next.account,
  );
  const currentNickIsAlias = useStore((s) => s.currentNickIsAlias);
  const notifications = useStore((s) => s.notifications);

  createEffect(() => {
    const status = connectionStatus();
    if (
      autoReconnect()
      || status === 'connecting'
      || status === 'reconnecting'
      || status === 'connected'
    ) {
      void AppShell.preload();
    }
  });

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
  const registeredNickNeedsSignIn = createMemo<boolean>(() =>
    /nickname is registered|registered nickname requires authentication/i.test(lastErrorText()),
  );

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
    idle:       'Ready',
    connecting: 'Connecting',
    error:      'Couldn’t join',
  };
  const phaseLabel = createMemo(() => PHASE_LABEL[formPhase()]);

  // ── Live validity helpers (declared early so status copy can read them) ─────
  const nickTrimmed = createMemo(() => nick().trim());
  const passkeySupported = createMemo(
    () => PRESENT_PASSKEY_SIGNIN && isPasskeySupported(),
  );

  /** Sign-in password fields + SASL submit — open by default only without passkeys. */
  const showSignInPasswordPath = createMemo(
    () => mode() === 'signin' && (!passkeySupported() || passwordPathOpen()),
  );
  /** Stay-signed-in stores a password — sign-in only, never the first-run guest screen. */
  const showStaySignedIn = createMemo(
    () => showSignInPasswordPath(),
  );
  /** Password/guest/register primary submit; hidden when passkey is the only CTA. */
  const showPasswordSubmit = createMemo(
    () => mode() !== 'signin' || showSignInPasswordPath(),
  );

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
        return 'Connecting securely.';
      case 'error':
        if (registeredNickNeedsSignIn()) {
          return 'That name belongs to an account. Sign in to use it.';
        }
        if (nickInUse()) {
          return 'That name is already in use. Reclaim it, or pick another.';
        }
        if (/password|auth|login|incorrect|credential|464/i.test(lastErrorText())) {
          return 'That password was not accepted. Check it and sign in again.';
        }
        return 'Couldn’t reach Onyx just now. Try again in a moment.';
      default:
        return routing()
          ? 'Connecting securely.'
          : modeHint(mode());
    }
  });

  function modeHint(m: Mode): string {
    switch (m) {
      case 'signin':
        return passkeySupported()
          ? 'Sign in with a passkey — or use your account password.'
          : 'Enter your name and password to continue.';
      case 'register':
        return 'Choose a name and password to create your account.';
      default:
        return inviteCard
          ? 'Choose a display name, then join.'
          : 'Choose a display name to join.';
    }
  }

  // The status phase reflects registration first, then connection.
  const statusPhase = createMemo<'idle' | 'connecting' | 'error'>(() => {
    if (registerError()) return 'error';
    if (registerPending()) return 'connecting';
    return formPhase();
  });

  const isFormReady = createMemo(() => {
    if (passkeySignInAttempt()) return false;
    const s = connectionStatus();
    if (s === 'connecting' || s === 'connected' || s === 'reconnecting') return false;
    return !registerPending();
  });

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
  let registrationDisposed = false;
  onCleanup(() => {
    registrationDisposed = true;
  });

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
    const authenticatedAccount = passkeyServerIdentity().account;
    if ((phase === 'submitting' || phase === 'verifying') && inFlight && authenticatedAccount) {
      setRegisterInFlight(false);
      setRegisterPhase('idle');
      return;
    }
    if ((phase === 'submitting' || phase === 'verifying') && inFlight && !pending) {
      // Deliberately untracked: the microtask samples the LATEST signal values
      // once, after the store batch settles — tracking here would re-arm the
      // effect on every read and defeat the settle-then-decide design above.
      // eslint-disable-next-line solid/reactivity
      queueMicrotask(() => {
        if (registrationDisposed || !registerInFlight()) return;
        if (getState().server?.account) {
          setRegisterInFlight(false);
          setRegisterPhase('idle');
          return;
        }
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
    if (getState().server?.account) {
      setRegisterInFlight(false);
      setRegisterPhase('idle');
      return;
    }
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
    // Once the native device prompt owns the ceremony, fields/modes stay fixed
    // until it settles. This prevents a credential for account A completing in
    // a form that now claims to be signing in account B.
    if (passkeySignInAttempt()?.dispatched) return;
    cancelPasskeySignIn();
    setMode(next);
    // Password path starts collapsed again when passkeys are primary.
    setPasswordPathOpen(false);
    // Clear transient errors so a stale message from another mode never lingers.
    setNickError(undefined);
    setPasswordError(undefined);
    setEmailError(undefined);
    setConfirmError(undefined);
    setVerifyError(undefined);
  }

  // ── Connect action (shared by guest / sign-in / post-register) ──────────────
  function doConnect(n: string, pass: string, resumeCredentials?: SavedCredentials): void {
    setAttempted(true);
    setReclaimOpen(false);
    const node = chosenNode();
    // A mesh token is portable, so keep today's latency-selected node. A lone
    // local token is bound to its issuing node and must return there to resume.
    const url = resumeCredentials?.sessionToken && !resumeCredentials.meshToken
      ? resumeCredentials.server
      : node.wss;
    const password = pass || undefined;
    const remember = staySignedIn();
    const remembered = saved();
    const forgetIdentity = (): void => {
      removeCredentials(url, n);
      if (remembered?.nick.trim().toLowerCase() === n.trim().toLowerCase()) {
        removeCredentials(remembered.server, remembered.nick);
      }
      refreshRememberedIdentities();
    };

    // A one-time resume with persistence disabled still needs a temporary entry
    // because store.connect synchronously loads resume tokens by exact url+nick.
    // Stage it, let connect capture it into IRCClient options, then remove it.
    if (remember || resumeCredentials) {
      saveCredentials({
        nick: n,
        server: url,
        password,
      });
      // When the fastest node changed, saveCredentials created a fresh entry.
      // Carry the mesh-sealed token into it before store.connect performs its
      // exact (url,nick) lookup; never copy the node-local token across nodes.
      if (resumeCredentials?.meshToken) {
        const expiryMs = resumeCredentials.meshTokenExpiry
          ? new Date(resumeCredentials.meshTokenExpiry).getTime()
          : Number.NaN;
        storeMeshToken(
          resumeCredentials.meshToken,
          Number.isFinite(expiryMs) ? Math.floor(expiryMs / 1000) : undefined,
        );
      }
      if (remember) refreshRememberedIdentities();
    }

    // A normal manual sign-in with persistence off must not inherit a stale
    // token from a previous saved session. Only the explicit Resume action gets
    // the stage-connect-forget ordering above.
    if (!remember && !resumeCredentials) forgetIdentity();

    try {
      getState().connect({
        url,
        nick: n,
        // Passwords are opaque credentials. Trimming changes the SASL secret and
        // makes valid leading/trailing whitespace impossible to authenticate.
        password,
        realname: `${n} (Onyx)`,
      });
    } finally {
      if (!remember && resumeCredentials) {
        // Turning the switch off means this identity should no longer remain on
        // the device. Removal happens after connect's synchronous token lookup.
        forgetIdentity();
      }
    }
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
      setRoomError('Room names look like #lounge — no spaces or commas.');
      return;
    }
    setRoomError(undefined);
    // Preserve the ?at= moment when the room came from the deep link; a
    // manually retyped different room shouldn't inherit someone else's moment.
    getState().setPendingDeepLinkJoin(
      normalizedRoom,
      normalizedRoom === deepLinkJoin ? deepLinkAt : null,
      normalizedRoom === deepLinkJoin ? deepLinkTopic : null,
    );
    recordFirstHourHandoff({
      landing: normalizedRoom ? 'room' : 'home',
      channel: normalizedRoom,
      guest: m === 'guest',
    });

    if (m === 'signin') {
      if (recoveryPathOpen()) {
        const code = recoveryCode().replace(/[-\s]/g, '');
        if (code.length < 8) {
          setPasswordError('Enter a recovery code from your saved list.');
          return;
        }
        setPasswordError(undefined);
        // Queue RECOVERYCODES LOGIN for after 001, then open a plain socket.
        getState().recoveryCodesLogin(n, recoveryCode());
        doConnect(n, '');
        return;
      }
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

  function cancelPasskeySignIn(restoreFocus = false): void {
    if (!passkeySignInAttempt()) return;
    const state = getState();
    // A passkey prompt may settle after this component changes mode/unmounts.
    // Destroying the anonymous client makes its captured AUTH-FINISH send inert.
    if (state.connectionStatus !== 'disconnected') state.disconnect();
    setPasskeySignInAttempt(null);
    if (restoreFocus) queueMicrotask(() => passkeyButtonRef?.focus());
  }

  function startPasskeySignIn(resumeCredentials?: SavedCredentials): void {
    if (!isFormReady() || passkeySignInAttempt()) return;
    const account = nickTrimmed();
    const err = validateNick(account);
    setNickError(err);
    setPasswordError(undefined);
    if (err) return;

    getState().dismissPasskeyMessage();
    setAttempted(true);
    setReclaimOpen(false);
    setPasskeySignInAttempt({ account, transportStarted: false, dispatched: false });

    // WEBAUTHN AUTH is an IRC command, so Connect must establish the anonymous
    // transport first. This deliberately bypasses doConnect: passkey sign-in
    // must not delete or rewrite a remembered identity just to open transport.
    // A local SESSION token is bound to its issuing node. Keep the passkey
    // re-authentication on that remembered transport so the client can replay
    // the token only after 900 proves the account; mesh tokens are valid there
    // too and can rotate normally after attachment.
    const url = resumeCredentials?.server ?? chosenNode().wss;
    getState().connect({
      url,
      nick: account,
      realname: `${account} (Onyx)`,
    });
    setPasskeySignInAttempt((current) =>
      current?.account === account ? { ...current, transportStarted: true } : current,
    );
  }

  function handlePasskeySignIn(): void {
    startPasskeySignIn();
  }

  createEffect(() => {
    const attempt = passkeySignInAttempt();
    if (!attempt) return;

    if (mode() !== 'signin' || nickTrimmed().toLowerCase() !== attempt.account.toLowerCase()) {
      cancelPasskeySignIn();
      return;
    }

    const status = connectionStatus();
    if (status === 'disconnected' && attempt.transportStarted) {
      // WebSocket construction can fail synchronously. Release the local guard
      // so the form remains actionable instead of becoming permanently inert.
      setPasskeySignInAttempt(null);
      return;
    }
    // onConnected publishes the connection status immediately before the
    // store constructs its Server record. Wait for that record so a resumed
    // account can suppress a redundant device ceremony without a race.
    const serverIdentity = passkeyServerIdentity();
    if (status !== 'connected' || !serverIdentity.connected) return;

    // A remembered SESSION may already have restored this account during the
    // transport handshake. Do not stack a redundant WebAuthn ceremony on it.
    if (serverIdentity.account?.toLowerCase() === attempt.account.toLowerCase()) {
      setPasskeySignInAttempt(null);
      return;
    }
    if (attempt.dispatched) return;

    setPasskeySignInAttempt({ ...attempt, dispatched: true });
    getState().signInWithPasskey(attempt.account);
  });

  createEffect(() => {
    const attempt = passkeySignInAttempt();
    if (!attempt?.dispatched || passkeyBusy() || !passkeyError()) return;
    // Return from the anonymous transport to the sign-in form, keep the
    // store-provided cancellation/error text visible, and restore keyboard
    // focus to the action that launched the device prompt.
    cancelPasskeySignIn(true);
  });

  onCleanup(() => cancelPasskeySignIn());

  // ── GHOST reclaim ───────────────────────────────────────────────────────────
  function handleReclaim(event: SubmitEvent): void {
    event.preventDefault();
    const pass = reclaimPassword();
    if (!pass) return;
    // Evict the stale session, then retry the connection under the desired nick.
    getState().ghost(nickTrimmed(), pass);
    setReclaimOpen(false);
    setReclaimPassword('');
    doConnect(nickTrimmed(), password());
  }

  // ── Remembered identity switcher ───────────────────────────────────────────
  const selectedIdentity = createMemo(() => {
    const id = selectedIdentityId();
    return rememberedIdentities().find((identity) => identity.id === id) ?? null;
  });

  function handleIdentitySelect(identity: RememberedIdentity): void {
    const credentials = selectRememberedIdentity(identity.id);
    if (!credentials) {
      refreshRememberedIdentities();
      return;
    }
    setRememberedIdentities(listRememberedIdentities());
    setSelectedIdentityId(identity.id);
    setSaved(credentials);
    setNick(credentials.nick);
    setPassword('');
    switchMode('signin');
  }

  function handleRememberedAction(): void {
    const identity = selectedIdentity();
    if (!identity) return;
    const credentials = selectRememberedIdentity(identity.id);
    if (!credentials) {
      refreshRememberedIdentities();
      return;
    }

    const current = listRememberedIdentities().find((item) => item.id === identity.id);
    if (!current || current.access !== identity.access) {
      // Storage can be edited in another tab. Never execute an action under a
      // stale capability label (especially "Resume").
      refreshRememberedIdentities(identity.id);
      return;
    }

    setRememberedIdentities(listRememberedIdentities());
    setSelectedIdentityId(identity.id);
    setSaved(credentials);
    setNick(credentials.nick);

    if (identity.access === 'identity-only') {
      setPassword('');
      switchMode('signin');
      return;
    }

    if (
      identity.access === 'resume'
      && (typeof credentials.password !== 'string' || credentials.password.length === 0)
    ) {
      // SESSION tokens select a remembered logical session but Onyx Server still
      // requires fresh account proof. Never connect this identity as a guest
      // and hope RESUME authenticates it: that is rejected server-side and was
      // the top-bar “Guest” regression. A supported passkey keeps this a
      // one-click flow; otherwise leave the populated sign-in form actionable.
      setPassword('');
      switchMode('signin');
      if (passkeySupported()) startPasskeySignIn(credentials);
      return;
    }

    if (
      identity.access === 'sign-in'
      && (typeof credentials.password !== 'string' || credentials.password.length === 0)
    ) {
      refreshRememberedIdentities(identity.id);
      return;
    }
    doConnect(credentials.nick, credentials.password ?? '', credentials);
  }

  function handleForgetRemembered(identity: RememberedIdentity): void {
    if (!removeRememberedIdentity(identity.id)) return;
    const wasSelected = selectedIdentityId() === identity.id;
    if (wasSelected && nick().trim().toLowerCase() === identity.nick.trim().toLowerCase()) {
      setNick('');
      setPassword('');
    }
    refreshRememberedIdentities(wasSelected ? undefined : selectedIdentityId() ?? undefined, wasSelected);
  }

  function rememberedActionLabel(identity: RememberedIdentity): string {
    if (identity.access === 'resume') return 'Resume';
    if (identity.access === 'sign-in') return 'Sign in';
    return 'Use identity';
  }

  function rememberedStatus(identity: RememberedIdentity): string {
    if (identity.access === 'resume') return 'Ready to continue';
    if (identity.access === 'sign-in') return 'Saved sign-in';
    return 'Saved name';
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────
  function handleDisconnect(): void {
    setAttempted(false);
    setRegisterPhase('idle');
    setRegisterInFlight(false);
    _pendingRegister = null;
    getState().disconnect();
  }

  const showRememberedIdentities = createMemo(() =>
    !resumeDismissed()
      && rememberedIdentities().length > 0
      && !attempted()
      && mode() !== 'register'
  );
  const showReclaim = createMemo(() => formPhase() === 'error' && nickInUse());
  const inVerifyStep = createMemo(() => registerPhase() === 'verifying');
  const headingCopy = createMemo(() => {
    if (mode() === 'guest' && inviteCard?.channel) {
      return {
        title: `Join ${inviteCard.channel}`,
        body: 'Choose a display name to enter this room.',
      };
    }
    return MODE_COPY[mode()];
  });
  const inviteOnlyName = createMemo(() => mode() === 'guest' && !!inviteCard?.channel);
  const nickFieldLabel = createMemo(() => {
    if (mode() === 'register') return 'Account name';
    if (mode() === 'guest') return 'Display name';
    return 'Name';
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Show
      // The shell stays mounted through a DROP: autoReconnect is true only
      // after a successful connect (and false again on deliberate disconnect
      // or when retries give up), so a network blip shows the reconnect
      // banner + offline composer instead of bouncing to this form.
      when={(connectionStatus() === 'connected' || autoReconnect())
        && registerPhase() === 'idle'
        && !passkeySignInAttempt()}
      fallback={
        <div class="conn" data-testid="connect-screen" data-mode={mode()}>
          <Atmosphere />

          <div class="conn-stage">
          <div class="conn-card" role="main">
            <div class="conn-crest" aria-hidden="true" />

            <div class="conn-body">
              <header class="conn-header">
                <span class="conn-brand" aria-hidden="true">
                  <Mascot variant="mark" class="conn-brand-mark" />
                </span>
                <span class="conn-eyebrow">Onyx</span>
                <h1 class="conn-title">{headingCopy().title}</h1>
                <p class="conn-sub">{headingCopy().body}</p>
              </header>

              <Show when={inviteCard} keyed>
                {(card) => (
                  <div class="conn-invite" role="note" aria-label="Invite preview">
                    <span class="conn-invite-eyebrow">Invite</span>
                    <h2 class="conn-invite-title">{inviteTitle(card)}</h2>
                    <p class="conn-invite-desc">{inviteDescription(card)}</p>
                    <Show when={card.topic}>
                      {(topic) => (
                        <ul class="conn-invite-meta">
                          <li>
                            Topic: <span class="mono">{topic()}</span>
                          </li>
                        </ul>
                      )}
                    </Show>
                  </div>
                )}
              </Show>

              {/* Remembered identities — secret-free metadata + guarded actions */}
              <Show when={showRememberedIdentities()}>
                <section class="conn-identities" aria-labelledby="conn-identities-title">
                  <div class="conn-identities-head">
                    <div>
                      <span class="conn-resume-eyebrow">Welcome back</span>
                      <h2 id="conn-identities-title" class="conn-identities-title">
                        Continue where you left off
                      </h2>
                    </div>
                    <span class="conn-identities-count" aria-label={`${rememberedIdentities().length} remembered identities`}>
                      {rememberedIdentities().length}
                    </span>
                  </div>

                  <div class="conn-identities-list" role="list">
                    <For each={rememberedIdentities()}>
                      {(identity) => (
                        <div
                          class="conn-identity"
                          role="listitem"
                          data-selected={selectedIdentityId() === identity.id ? 'true' : 'false'}
                          data-access={identity.access}
                        >
                          <button
                            type="button"
                            class="conn-identity-select"
                            aria-label={`Select ${identity.nick}`}
                            aria-pressed={selectedIdentityId() === identity.id ? 'true' : 'false'}
                            onClick={() => handleIdentitySelect(identity)}
                          >
                            <span class="conn-identity-nick">{identity.nick}</span>
                            <span class="conn-identity-status">{rememberedStatus(identity)}</span>
                          </button>
                          <button
                            type="button"
                            class="conn-identity-forget"
                            aria-label={`Forget ${identity.nick}`}
                            onClick={() => handleForgetRemembered(identity)}
                          >
                            Forget
                          </button>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class="conn-resume-actions">
                    <Show when={selectedIdentity()} keyed>
                      {(identity) => (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!isFormReady()}
                          onClick={handleRememberedAction}
                          data-testid={identity.access === 'resume'
                            ? 'conn-resume'
                            : identity.access === 'sign-in'
                              ? 'conn-remembered-signin'
                              : 'conn-identity-use'}
                        >
                          {rememberedActionLabel(identity)}
                        </Button>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="conn-resume-dismiss"
                      aria-label="Dismiss remembered identities"
                      onClick={() => setResumeDismissed(true)}
                    >
                      Not now
                    </button>
                  </div>
                </section>
              </Show>

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
                  aria-label="Connect form"
                >
                  <div class="conn-fields">
                    <FormField
                      id="conn-nick"
                      label={nickFieldLabel()}
                      type="text"
                      placeholder="your-name"
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

                    {/* Optional room — hidden on invite (destination is already known). */}
                    <Show when={mode() !== 'register' && !inviteOnlyName()}>
                      <FormField
                        id="conn-room"
                        label="Room"
                        description="Optional — skip this to choose a room after you join"
                        type="text"
                        placeholder="#lounge"
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

                    {/* Register password always; sign-in password only when demoted path is open
                        (or when the browser has no passkey support). */}
                    <Show when={mode() === 'register' || showSignInPasswordPath()}>
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

                    {/* Passkey PRIMARY on sign-in when WebAuthn is available (A4).
                        Password is demoted under "Use password instead" — never
                        silently fall back from a failed passkey to plaintext. */}
                    <Show when={mode() === 'signin' && passkeySupported()}>
                      <div class="conn-passkey" data-testid="conn-passkey-primary">
                        <Show when={passwordPathOpen()}>
                          <div class="conn-passkey-divider" aria-hidden="true">
                            <span>or use a passkey</span>
                          </div>
                        </Show>
                        <Button
                          class="conn-passkey-button"
                          type="button"
                          variant={passwordPathOpen() ? 'ghost' : 'primary'}
                          disabled={!isFormReady() || passkeyBusy()}
                          onClick={handlePasskeySignIn}
                          ref={(element: HTMLButtonElement) => (passkeyButtonRef = element)}
                          data-testid="conn-passkey-submit"
                        >
                          {passkeyBusy()
                            ? 'Waiting for your device…'
                            : passkeySignInAttempt()
                              ? 'Connecting securely…'
                              : 'Sign in with a passkey'}
                        </Button>
                        <Show when={passkeyError()}>
                          {(message) => (
                            <p class="conn-passkey-error" role="alert">
                              {message()}
                            </p>
                          )}
                        </Show>
                        <Show when={!passwordPathOpen()}>
                          <button
                            type="button"
                            class="conn-password-path-toggle"
                            data-testid="conn-password-path-open"
                            disabled={!isFormReady()}
                            onClick={() => {
                              setRecoveryPathOpen(false);
                              setPasswordPathOpen(true);
                            }}
                          >
                            Use password instead
                          </button>
                        </Show>
                        <Show when={!recoveryPathOpen()}>
                          <button
                            type="button"
                            class="conn-password-path-toggle"
                            data-testid="conn-recovery-path-open"
                            disabled={!isFormReady()}
                            onClick={() => {
                              setPasswordPathOpen(true);
                              setRecoveryPathOpen(true);
                            }}
                          >
                            Use a recovery code
                          </button>
                        </Show>
                      </div>
                    </Show>

                    <Show when={mode() === 'signin' && !passkeySupported() && !recoveryPathOpen()}>
                      <button
                        type="button"
                        class="conn-password-path-toggle"
                        data-testid="conn-recovery-path-open"
                        disabled={!isFormReady()}
                        onClick={() => setRecoveryPathOpen(true)}
                      >
                        Use a recovery code
                      </button>
                    </Show>

                    <Show when={mode() === 'signin' && recoveryPathOpen()}>
                      <label class="onyx-field" for="conn-recovery-code">
                        <span class="onyx-field__label">Recovery code</span>
                        <input
                          id="conn-recovery-code"
                          class="onyx-field__input"
                          type="text"
                          autocomplete="one-time-code"
                          spellcheck={false}
                          placeholder="ABCDE-FGHJK"
                          value={recoveryCode()}
                          data-testid="conn-recovery-code"
                          onInput={(e) => setRecoveryCode(e.currentTarget.value)}
                        />
                      </label>
                      <p class="conn-mode-hint">
                        Enter one recovery code from your saved list. Each code can be used once.
                      </p>
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

                  {/* Explicit continuity choice for guest or password sign-in. */}
                  <Show when={showStaySignedIn()}>
                    <div class="conn-seam" style={{ margin: '20px 0' }} aria-hidden="true" />
                    <div class="conn-toggle">
                      <div class="conn-toggle-body">
                        <label class="conn-toggle-label" for="conn-stay-signed-in">
                          Stay signed in
                        </label>
                        <p class="conn-toggle-description" id="conn-session-desc">
                          Off by default. Saves your account password in this browser. Use only on a private device.
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

                  <Show when={registeredNickNeedsSignIn() && mode() === 'guest'}>
                    <div class="conn-auth-required" role="alert" data-testid="conn-auth-required">
                      <div>
                        <strong>This name is protected</strong>
                        <span>Sign in to use this account name.</span>
                      </div>
                      <button type="button" onClick={() => switchMode('signin')}>
                        Sign in as {nickTrimmed() || 'this account'}
                      </button>
                    </div>
                  </Show>

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
                            take this name back.
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

                  <Show when={showPasswordSubmit()}>
                    <div class="conn-actions">
                      <Show
                        when={statusPhase() !== 'connecting'}
                        fallback={
                          <div class="conn-submit conn-submit--busy">
                            <Spinner size="sm" label={registerPending() ? 'Creating account' : phaseLabel()} />
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
                  </Show>
                </form>
              </Show>

              <nav class="conn-alt" aria-label="Other ways to join" data-testid="conn-modes">
                <Show when={mode() !== 'guest'}>
                  <button
                    type="button"
                    class="conn-alt-link"
                    data-testid="conn-mode-guest"
                    disabled={!isFormReady()}
                    onClick={() => switchMode('guest')}
                  >
                    Join as guest
                  </button>
                </Show>
                <Show when={mode() !== 'signin'}>
                  <button
                    type="button"
                    class="conn-alt-link"
                    data-testid="conn-mode-signin"
                    disabled={!isFormReady()}
                    onClick={() => switchMode('signin')}
                  >
                    Sign in
                  </button>
                </Show>
                <Show when={mode() !== 'register'}>
                  <button
                    type="button"
                    class="conn-alt-link"
                    data-testid="conn-mode-register"
                    disabled={!isFormReady()}
                    onClick={() => switchMode('register')}
                  >
                    Create account
                  </button>
                </Show>
              </nav>
            </div>

            <footer class="conn-foot">
              <span>Rooms, calls, and private messages — no ads.</span>
            </footer>
          </div>
          </div>
        </div>
      }
    >
      {/* Connected shell — reads everything from the store.
          ErrorBoundary: a stale post-deploy AppShell chunk 404 must not leave
          wallpaper-only blank output; offer reload / home, never auto-loop. */}
      <ErrorBoundary fallback={lazyRouteFallback}>
        <Suspense
          fallback={
            <div class="conn" data-testid="shell-loading">
              <Atmosphere />
              <div class="conn-stage">
                <Spinner label="Opening Onyx" />
              </div>
            </div>
          }
        >
          <AppShell
            onDisconnect={handleDisconnect}
            selfNick={ourNick()}
          />
        </Suspense>
      </ErrorBoundary>
    </Show>
  );
}

// ── Submit copy ───────────────────────────────────────────────────────────────

const SUBMIT_ARIA: Record<Mode, string> = {
  guest:    'Join Onyx as a guest',
  signin:   'Sign in to Onyx',
  register: 'Create a new account',
};

function submitLabel(mode: Mode, phase: 'idle' | 'connecting' | 'error'): string {
  if (phase === 'error') return 'Try again';
  switch (mode) {
    case 'signin':   return 'Sign in';
    case 'register': return 'Create account';
    default:         return 'Join';
  }
}
