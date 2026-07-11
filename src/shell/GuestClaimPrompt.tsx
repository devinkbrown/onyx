// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GuestClaimPrompt.tsx — in-session "claim your nick" affordance.
 *
 * A guest (server.account === null) who is already chatting gets a low-friction,
 * dismissible entry point to CLAIM (register) their CURRENT nick — turning the
 * anonymous session into a real account WITHOUT reconnecting. It reuses the
 * existing store registerAccount()/verifyAccount() actions and the real REGISTER
 * command; nothing here re-opens the Connect screen or drops the socket.
 *
 * SOLID IDIOMS:
 *   - Component body runs ONCE. Reactivity lives in the memos + <Show>.
 *   - No props to destructure; store reactive reads go through useStore, the
 *     imperative claim dispatches through getState() in the submit handler.
 *   - The dismissed flag persists under an onyx: localStorage key so it does not
 *     nag across sessions; the reactive gate hides the prompt the instant the
 *     server confirms the account (isGuest flips false).
 */
import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { useStore, getState, selectAccount } from '@/lib/store';
import { Button } from '@/primitives/Button';
import { FormField } from '@/primitives/FormField';
import { Spinner } from '@/primitives/Spinner';
import './guest-claim.css';

/** localStorage flag: the user dismissed the claim prompt (onyx: namespace). */
export const GUEST_CLAIM_DISMISS_KEY = 'onyx:guest-claim-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(GUEST_CLAIM_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    localStorage.setItem(GUEST_CLAIM_DISMISS_KEY, '1');
  } catch {
    /* storage unavailable (private mode / quota) — degrade to session-only. */
  }
}

export function GuestClaimPrompt(): JSX.Element {
  // ── reactive store reads ──
  const account = useStore(selectAccount);
  const ourNick = useStore((s) => s.ourNick);
  const registerPending = useStore((s) => s.registerPending);
  const registerError = useStore((s) => s.registerError);
  const verifyRequired = useStore((s) => s.verifyRequired);

  // ── local UI state ──
  const [dismissed, setDismissed] = createSignal(readDismissed());
  const [expanded, setExpanded] = createSignal(false);
  // null = follow the live nick; a string = the user edited the field.
  const [nickDraft, setNickDraft] = createSignal<string | null>(null);
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [localError, setLocalError] = createSignal<string | undefined>(undefined);
  const [verifyCode, setVerifyCode] = createSignal('');

  const isGuest = createMemo(() => !account());
  const nickValue = createMemo(() => nickDraft() ?? ourNick());
  const show = createMemo(() => isGuest() && !dismissed() && ourNick().trim() !== '');
  // Prefer a local validation message; otherwise surface the server's verdict.
  const errorText = createMemo(() => localError() ?? registerError() ?? undefined);

  function dismiss(): void {
    persistDismissed();
    setDismissed(true);
  }

  function submitClaim(event: Event): void {
    event.preventDefault();
    const nick = nickValue().trim();
    const pass = password();
    if (!nick) {
      setLocalError('Enter the nick you want to claim.');
      return;
    }
    if (!pass) {
      setLocalError('Choose a password to protect the account.');
      return;
    }
    setLocalError(undefined);
    const mail = email().trim();
    getState().registerAccount(nick, mail || undefined, pass);
  }

  function submitVerify(event: Event): void {
    event.preventDefault();
    const code = verifyCode().trim();
    if (!code) {
      setLocalError('Enter the verification code from your email.');
      return;
    }
    setLocalError(undefined);
    getState().verifyAccount(nickValue().trim(), code);
  }

  return (
    <Show when={show()}>
      <section class="guest-claim" role="region" aria-label="Guest account" data-testid="guest-claim">
        <div class="guest-claim__head">
          <div class="guest-claim__lede">
            <span class="guest-claim__eyebrow" aria-hidden="true">guest</span>
            <p class="guest-claim__title">
              Claim <b class="guest-claim__nick">{nickValue()}</b> before someone else does
            </p>
            <p class="guest-claim__sub">
              Register your current name to keep it, carry your settings across the mesh, and
              protect your nick — no reconnect needed.
            </p>
          </div>
          <div class="guest-claim__head-actions">
            <Show when={!expanded()}>
              <Button type="button" variant="primary" size="sm" onClick={() => setExpanded(true)}>
                Claim your nick
              </Button>
            </Show>
            <button
              type="button"
              class="guest-claim__dismiss"
              aria-label="Dismiss claim prompt"
              onClick={dismiss}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        <Show when={expanded()}>
          <Show
            when={verifyRequired()}
            fallback={
              <form class="guest-claim__form" aria-label="Claim your nick" onSubmit={submitClaim} noValidate>
                <FormField
                  id="guest-claim-nick"
                  label="Nick to claim"
                  autocomplete="username"
                  value={nickValue()}
                  onInput={(e) => {
                    setNickDraft(e.currentTarget.value);
                    setLocalError(undefined);
                  }}
                />
                <FormField
                  id="guest-claim-password"
                  label="Password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="choose a password"
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
                  value={email()}
                  onInput={(e) => {
                    setEmail(e.currentTarget.value);
                    setLocalError(undefined);
                  }}
                />

                <Show when={errorText()}>
                  {(err) => (
                    <p class="guest-claim__error" role="alert">
                      <span aria-hidden="true">⚠</span> {err()}
                    </p>
                  )}
                </Show>

                <div class="guest-claim__form-actions">
                  <Button type="submit" variant="primary" size="sm" disabled={registerPending()}>
                    <Show when={registerPending()} fallback="Create account">
                      <Spinner size="sm" label="Registering" />
                    </Show>
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                    Not now
                  </Button>
                </div>
              </form>
            }
          >
            <form class="guest-claim__form" aria-label="Verify your nick" onSubmit={submitVerify} noValidate>
              <p class="guest-claim__sub">
                Almost there — enter the verification code we emailed you to finish claiming{' '}
                <b class="guest-claim__nick">{nickValue()}</b>.
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
                  <p class="guest-claim__error" role="alert">
                    <span aria-hidden="true">⚠</span> {err()}
                  </p>
                )}
              </Show>
              <div class="guest-claim__form-actions">
                <Button type="submit" variant="primary" size="sm" disabled={registerPending()}>
                  <Show when={registerPending()} fallback="Verify">
                    <Spinner size="sm" label="Verifying" />
                  </Show>
                </Button>
              </div>
            </form>
          </Show>
        </Show>
      </section>
    </Show>
  );
}

export default GuestClaimPrompt;
