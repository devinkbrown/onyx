// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GuestClaimPrompt.tsx — in-session "keep this nick" affordance.
 *
 * Guests (server.account === null) already chatting get a compact, dismissible
 * chip that never expands into the composer column. Claiming opens a real Sheet
 * (focus trap + Escape) and runs REGISTER → (optional VERIFY) → IDENTIFY on the
 * live socket — no disconnect, no Connect re-entry.
 *
 * Store actions reused: registerAccount / verifyAccount / identify, plus
 * registerPending / registerError / verifyRequired / accountActionError / account.
 * Sheet open is a small module signal (guestClaimState) so Account can open the
 * same surface without store changes.
 *
 * SOLID IDIOMS:
 *   - Component body runs once; reactivity in memos, effects, and <Show>.
 *   - No props. Store reads via useStore; submit dispatches via getState().
 */
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState, selectAccount } from '@/lib/store';
import {
  deviceMemoryOwnerKey,
  deviceMemoryStorageKey,
  normalizeDeviceMemoryOwner,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';
import { Button } from '@/primitives/Button';
import { FormField } from '@/primitives/FormField';
import { Sheet } from '@/primitives/Sheet';
import { Spinner } from '@/primitives/Spinner';
import {
  closeGuestClaimSheet,
  isGuestClaimSheetOpen,
  openGuestClaimSheet,
  setGuestClaimSheetOpenState,
} from './guestClaimState';
import './guest-claim.css';

/** localStorage flag base: durable chip dismissal (onyx: + per-owner suffix). */
export const GUEST_CLAIM_DISMISS_KEY = 'onyx:guest-claim-dismissed';

/** Minimum password length (matches Connect / Account). */
export const GUEST_CLAIM_MIN_PASSWORD = 8;

type ClaimPhase = 'idle' | 'registering' | 'verifying' | 'identifying';

function guestClaimDismissKey(owner: DeviceMemoryOwner | null): string | null {
  return owner ? deviceMemoryStorageKey(GUEST_CLAIM_DISMISS_KEY, owner) : null;
}

function readDismissed(owner: DeviceMemoryOwner | null): boolean {
  try {
    localStorage.removeItem(GUEST_CLAIM_DISMISS_KEY);
    const key = guestClaimDismissKey(owner);
    return key ? localStorage.getItem(key) === '1' : false;
  } catch {
    return false;
  }
}

function persistDismissed(owner: DeviceMemoryOwner | null): void {
  try {
    localStorage.removeItem(GUEST_CLAIM_DISMISS_KEY);
    const key = guestClaimDismissKey(owner);
    if (key) localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable — session-only dismiss. */
  }
}

export function GuestClaimPrompt(): JSX.Element {
  let chipKeepButton: HTMLButtonElement | undefined;

  // ── reactive store reads ──
  const account = useStore(selectAccount);
  const ourNick = useStore((s) => s.ourNick);
  const serverUrl = useStore((s) => s.server?.url ?? '');
  const registerPending = useStore((s) => s.registerPending);
  const registerError = useStore((s) => s.registerError);
  const verifyRequired = useStore((s) => s.verifyRequired);
  const actionError = useStore((s) => s.accountActionError);

  // ── local UI state ──
  const initialState = getState();
  const initialOwner = initialState.server?.account
    ? null
    : normalizeDeviceMemoryOwner({
        serverUrl: initialState.server?.url ?? '',
        identity: initialState.ourNick,
      });
  const [dismissed, setDismissed] = createSignal(readDismissed(initialOwner));
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [localError, setLocalError] = createSignal<string | undefined>(undefined);
  const [verifyCode, setVerifyCode] = createSignal('');
  const [phase, setPhase] = createSignal<ClaimPhase>('idle');
  /** True only after we issued REGISTER or VERIFY and before that round-trip settles. */
  const [requestInFlight, setRequestInFlight] = createSignal(false);
  /** Password captured at submit for the post-register IDENTIFY (never re-read live). */
  const [claimPassword, setClaimPassword] = createSignal('');
  const [claimNick, setClaimNick] = createSignal('');
  /** Guards against double IDENTIFY for one successful REGISTER/VERIFY. */
  const [identifyIssued, setIdentifyIssued] = createSignal(false);

  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const isGuest = createMemo(() => !account());
  const guestOwner = createMemo<DeviceMemoryOwner | null>(() => (
    isGuest()
      ? normalizeDeviceMemoryOwner({ serverUrl: serverUrl(), identity: ourNick() })
      : null
  ));
  const liveNick = createMemo(() => ourNick().trim());
  const showChip = createMemo(
    () => isGuest() && !dismissed() && liveNick() !== '',
  );
  const sheetOpen = createMemo(
    () => isGuest() && liveNick() !== '' && isGuestClaimSheetOpen(),
  );
  const busy = createMemo(
    () => registerPending() || requestInFlight() || phase() === 'identifying',
  );
  const identifyErrorText = createMemo(() => {
    const err = actionError();
    if (!err || err.command !== 'IDENTIFY') return undefined;
    return err.description || err.code;
  });
  const errorText = createMemo(
    () => localError() ?? registerError() ?? identifyErrorText() ?? undefined,
  );

  function resetClaimDrafts(): void {
    setEmail('');
    setPassword('');
    setLocalError(undefined);
    setVerifyCode('');
    setPhase('idle');
    setRequestInFlight(false);
    setClaimPassword('');
    setClaimNick('');
    setIdentifyIssued(false);
  }

  function closeSheet(): void {
    setGuestClaimSheetOpenState(false);
  }

  // Rehydrate dismissal + wipe credentials when guest owner boundary changes.
  let activeOwnerKey = initialOwner ? deviceMemoryOwnerKey(initialOwner) : null;
  createEffect(() => {
    const owner = guestOwner();
    const nextOwnerKey = owner ? deviceMemoryOwnerKey(owner) : null;
    if (nextOwnerKey === activeOwnerKey) return;
    activeOwnerKey = nextOwnerKey;
    setDismissed(readDismissed(owner));
    resetClaimDrafts();
    if (!isGuest()) closeGuestClaimSheet();
  });

  // Hide + close when signed in (900 sets server.account).
  createEffect(() => {
    if (!isGuest()) {
      closeGuestClaimSheet();
      resetClaimDrafts();
    }
  });

  // registering → verifying when the server requires email verification.
  createEffect(() => {
    if (phase() === 'registering' && verifyRequired()) {
      setRequestInFlight(false);
      setPhase('verifying');
      setIdentifyIssued(false);
    }
  });

  // REGISTER / VERIFY settle on registerPending falling edge. Only then may we
  // IDENTIFY — never on submit, never twice for the same success path.
  createEffect(() => {
    const currentPhase = phase();
    const inFlight = requestInFlight();
    const pending = registerPending();
    if (
      (currentPhase !== 'registering' && currentPhase !== 'verifying')
      || !inFlight
      || pending
    ) {
      return;
    }

    // Untracked sample after the store batch settles (same pattern as Connect).
    // eslint-disable-next-line solid/reactivity
    queueMicrotask(() => {
      if (disposed || !requestInFlight()) return;
      // Live re-check: pending may still be true if the effect scheduled before
      // the zustand→Solid subscriber update for registerPending landed.
      if (getState().registerPending) return;
      if (getState().server?.account) {
        setRequestInFlight(false);
        setPhase('idle');
        closeGuestClaimSheet();
        return;
      }
      if (getState().registerError) {
        setRequestInFlight(false);
        return;
      }
      if (phase() === 'registering' && getState().verifyRequired) {
        // verifying transition effect owns this.
        return;
      }
      if (phase() === 'verifying' && getState().verifyRequired) {
        // VERIFY not yet successful.
        setRequestInFlight(false);
        return;
      }
      // Success path: REGISTER SUCCESS or VERIFY SUCCESS → IDENTIFY once.
      if (identifyIssued()) {
        setRequestInFlight(false);
        return;
      }
      const nick = claimNick() || liveNick();
      const pass = claimPassword();
      if (!nick || !pass) {
        setRequestInFlight(false);
        setLocalError('Missing credentials for sign-in after registration.');
        setPhase('idle');
        return;
      }
      setRequestInFlight(false);
      setIdentifyIssued(true);
      setPhase('identifying');
      getState().identify(nick, pass);
    });
  });

  // IDENTIFY completion: 900 flips account; FAIL IDENTIFY fills accountActionError.
  createEffect(() => {
    if (phase() !== 'identifying') return;
    if (account()) {
      setPhase('idle');
      closeGuestClaimSheet();
      return;
    }
    if (identifyErrorText()) {
      setPhase('idle');
      setIdentifyIssued(false);
    }
  });

  function dismissChip(): void {
    persistDismissed(guestOwner());
    setDismissed(true);
  }

  function openSheetFromChip(): void {
    setLocalError(undefined);
    openGuestClaimSheet();
  }

  function submitClaim(event: Event): void {
    event.preventDefault();
    if (busy()) return;
    const nick = liveNick();
    const pass = password();
    if (!nick) {
      setLocalError('You need a nick on this connection before claiming.');
      return;
    }
    if (!pass) {
      setLocalError('Choose a password to protect the account.');
      return;
    }
    if (pass.length < GUEST_CLAIM_MIN_PASSWORD) {
      setLocalError(`Use at least ${GUEST_CLAIM_MIN_PASSWORD} characters.`);
      return;
    }
    setLocalError(undefined);
    setClaimNick(nick);
    setClaimPassword(pass);
    setIdentifyIssued(false);
    const mail = email().trim();
    // Issue REGISTER first so registerPending is true before requestInFlight
    // arms the settle effect (avoids a Solid/zustand batch race that would
    // IDENTIFY before the round-trip starts).
    getState().registerAccount(nick, mail || undefined, pass);
    // Store no-ops when the live client is gone (disconnect race). Do not arm
    // the settle path or IDENTIFY — stay on this room and ask for reconnect.
    if (!getState().registerPending) {
      setLocalError('Reconnect required — the connection was lost before registration could start.');
      return;
    }
    setPhase('registering');
    setRequestInFlight(true);
  }

  function submitVerify(event: Event): void {
    event.preventDefault();
    if (busy()) return;
    const code = verifyCode().trim();
    const nick = claimNick() || liveNick();
    if (!code) {
      setLocalError('Enter the verification code from your email.');
      return;
    }
    if (!nick) {
      setLocalError('Missing nick for verification.');
      return;
    }
    setLocalError(undefined);
    setIdentifyIssued(false);
    getState().verifyAccount(nick, code);
    // Same client-gone no-op as REGISTER: no phase arm, no IDENTIFY.
    if (!getState().registerPending) {
      setLocalError('Reconnect required — the connection was lost before verification could start.');
      return;
    }
    setPhase('verifying');
    setRequestInFlight(true);
  }

  return (
    <>
      <Show when={showChip()}>
        <div
          class="guest-claim-chip"
          role="region"
          aria-label="Keep this nick"
          data-testid="guest-claim"
        >
          <p class="guest-claim-chip__text">
            Keep <b class="guest-claim-chip__nick">{liveNick()}</b>?
          </p>
          <div class="guest-claim-chip__actions">
            <Button
              ref={chipKeepButton}
              type="button"
              variant="primary"
              size="sm"
              data-testid="guest-claim-open"
              aria-label="Keep this nick"
              onClick={openSheetFromChip}
            >
              Keep
            </Button>
            <button
              type="button"
              class="guest-claim-chip__dismiss"
              aria-label="Dismiss keep-nick prompt"
              data-testid="guest-claim-dismiss"
              onClick={dismissChip}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </Show>

      <Sheet
        open={sheetOpen()}
        onOpenChange={(open) => {
          // Wire REGISTER/VERIFY/IDENTIFY cannot be canceled — refuse backdrop,
          // Escape, and close-button dismiss while any claim request is busy.
          // Idle Escape still reaches here with busy() false and restores focus.
          if (!open && busy()) return;
          setGuestClaimSheetOpenState(open);
          if (!open) {
            // Closing the sheet aborts local phase UI; in-flight wire replies still
            // settle into the store and will no longer drive this UI until reopened.
            if (phase() !== 'identifying' && !registerPending()) {
              setPhase('idle');
              setRequestInFlight(false);
            }
          }
        }}
        title="Keep this nick"
        description="Register the name you are using on this connection. You stay connected — passkeys and multi-device tools are available after the account exists."
        closeLabel="Close claim panel"
        returnFocus={chipKeepButton}
      >
        <div class="guest-claim-sheet" data-testid="guest-claim-sheet">
          <Show
            when={phase() === 'verifying' || verifyRequired()}
            fallback={
              <form
                class="guest-claim-sheet__form"
                aria-label="Keep this nick"
                onSubmit={submitClaim}
                noValidate
                data-testid="guest-claim-form"
              >
                <FormField
                  id="guest-claim-nick"
                  label="Nick"
                  description="Your current nick on this connection (not editable here)."
                  autocomplete="username"
                  value={liveNick()}
                  readOnly
                  data-testid="guest-claim-nick"
                />
                <FormField
                  id="guest-claim-password"
                  label="Password"
                  type="password"
                  autocomplete="new-password"
                  placeholder={`at least ${GUEST_CLAIM_MIN_PASSWORD} characters`}
                  value={password()}
                  onInput={(e) => {
                    setPassword(e.currentTarget.value);
                    setLocalError(undefined);
                  }}
                />
                <FormField
                  id="guest-claim-email"
                  label="Recovery email (optional)"
                  type="email"
                  autocomplete="email"
                  placeholder="you@example.com"
                  description="Optional. Used if the server requires verification or later recovery."
                  value={email()}
                  onInput={(e) => {
                    setEmail(e.currentTarget.value);
                    setLocalError(undefined);
                  }}
                />

                <Show when={errorText()}>
                  {(err) => (
                    <p class="guest-claim-sheet__error" role="alert">
                      <span aria-hidden="true">⚠</span> {err()}
                    </p>
                  )}
                </Show>

                <div class="guest-claim-sheet__actions">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={busy()}
                    data-testid="guest-claim-submit"
                  >
                    <Show when={busy()} fallback="Create account">
                      <Spinner size="sm" label={phase() === 'identifying' ? 'Signing in' : 'Registering'} />
                    </Show>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => closeSheet()}
                    disabled={busy()}
                    data-testid="guest-claim-not-now"
                  >
                    Not now
                  </Button>
                </div>
              </form>
            }
          >
            <form
              class="guest-claim-sheet__form"
              aria-label="Verify your nick"
              onSubmit={submitVerify}
              noValidate
              data-testid="guest-claim-verify-form"
            >
              <p class="guest-claim-sheet__lede">
                Enter the verification code sent for{' '}
                <b class="guest-claim-chip__nick">{claimNick() || liveNick()}</b>.
              </p>
              <FormField
                id="guest-claim-verify"
                label="Verification code"
                inputmode="numeric"
                autocomplete="one-time-code"
                value={verifyCode()}
                onInput={(e) => {
                  setVerifyCode(e.currentTarget.value);
                  setLocalError(undefined);
                }}
              />
              <Show when={errorText()}>
                {(err) => (
                  <p class="guest-claim-sheet__error" role="alert">
                    <span aria-hidden="true">⚠</span> {err()}
                  </p>
                )}
              </Show>
              <div class="guest-claim-sheet__actions">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busy()}
                  data-testid="guest-claim-verify-submit"
                >
                  <Show when={busy()} fallback="Verify">
                    <Spinner size="sm" label={phase() === 'identifying' ? 'Signing in' : 'Verifying'} />
                  </Show>
                </Button>
              </div>
            </form>
          </Show>
        </div>
      </Sheet>
    </>
  );
}

export default GuestClaimPrompt;
