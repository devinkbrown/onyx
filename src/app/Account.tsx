// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Account.tsx — Onyx account panel (deep-water dark-luxury).
 *
 * The in-app home for a signed-in identity. Where Connect is the front door,
 * this is the room you manage your account from once inside:
 *
 *   • Identity card — account name, email, flags, secure / enforce, registration.
 *   • Email         — ACCOUNTSET email (password-verified).
 *   • Password      — ACCOUNTSET password (password-verified).  [if supported]
 *   • Protection    — secure / enforce toggles (ACCOUNTSET secure|enforce).
 *   • Certificates  — CERTADD / CERTLIST / CERTDEL fingerprint bindings.
 *   • Sessions      — this browser (active) + Era 2 remote-list skeleton.
 *   • Passkeys      — WebAuthn passwordless credentials for this account.
 *   • Recover nick  — RECOVER a registered nick held by a stale session.
 *   • Sign out      — LOGOUT.
 *   • Danger zone   — DROP (guarded behind a typed confirmation).
 *
 * Guests (no account) see a gentle "you're browsing as a guest" state that
 * opens the shared in-session claim Sheet (REGISTER → IDENTIFY on the live
 * socket) — never disconnecting back to Connect. This panel manages an
 * *existing* session for signed-in users; Connect remains the front door.
 *
 * The global store is the single source of truth. Actions dispatch raw Onyx Server
 * commands; the store folds the replies (FAIL/WARN/NOTE/NOTICE/numerics) into
 * `accountInfo` / `accountActionError`. We render those, never parse wire text.
 *
 * SOLID IDIOMS: components run once. Never destructure props. Use splitProps,
 * createSignal/createMemo/createEffect, Show/For. Token-driven, a11y, reduced
 * motion (all handled in account.css).
 */

import './account.css';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import {
  useStore,
  getState,
  MAX_PERSONA_HOST_LENGTH,
  selectAccount,
  selectDeviceMemoryOwner,
} from '@/lib/store';
import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import { deviceKeys, deviceRegistryId } from '@/lib/e2ee/dmCipher';
import { PasskeysSection } from '@/shell/PasskeysSection';
import { SessionsDevicesSection } from '@/shell/SessionsDevicesSection';
import { RecoveryCodesSection } from '@/shell/RecoveryCodesSection';
import { OperEventConsole } from '@/shell/OperEventConsole';
import { PortableIdentitySection } from '@/shell/PortableIdentitySection';
import { CapabilityMatrixSection } from '@/shell/CapabilityMatrixSection';
import { ChannelOrganizationSection } from '@/shell/ChannelOrganizationSection';
import { SmartMuteSection } from '@/shell/SmartMuteSection';
import { ModalShell } from '@/primitives/index';
import { Button } from '@/primitives/index';
import { FormField } from '@/primitives/index';
import { Spinner } from '@/primitives/index';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { openGuestClaimSheet } from '@/shell/guestClaimState';
import { openPreferences } from '@/lib/prefs/preferences';

export interface AccountPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Minimum length we accept for a new password (mirrors Connect). */
const MIN_PASSWORD_LEN = 8;
const TOTP_CODE_LENGTH = 6;
const TOTP_CODE_RE = /^[0-9]{6}$/u;
const RECOVER_NICK_MAX_LENGTH = 64;

function boundedTotpCode(value: string): string {
  return value.replace(/[^0-9]/gu, '').slice(0, TOTP_CODE_LENGTH);
}

function boundedAccountInput(value: string, maxLength: number): string {
  let bounded = value.slice(0, maxLength);
  const finalCodeUnit = bounded.charCodeAt(bounded.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

// ── Password input with show / hide toggle (local; mirrors Connect's feel) ───

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  autocomplete?: string;
  description?: string;
  disabled?: boolean;
  error?: string;
  onInput: (value: string) => void;
}

function PasswordField(props: PasswordFieldProps): JSX.Element {
  const [local] = splitProps(props, [
    'id', 'label', 'value', 'placeholder', 'autocomplete', 'description', 'disabled', 'error', 'onInput',
  ]);
  const [shown, setShown] = createSignal(false);
  const descriptionId = () => (local.description ? `${local.id}-description` : undefined);
  const errorId = () => (local.error ? `${local.id}-error` : undefined);
  const describedBy = () => [descriptionId(), errorId()].filter(Boolean).join(' ') || undefined;

  return (
    <div class="onyx-field acct-password">
      <label class="onyx-field__label" for={local.id}>{local.label}</label>
      <Show when={local.description}>
        <p class="onyx-field__description" id={descriptionId()}>{local.description}</p>
      </Show>
      <div class="acct-password-row">
        <input
          id={local.id}
          class="onyx-field__input"
          type={shown() ? 'text' : 'password'}
          placeholder={local.placeholder}
          autocomplete={local.autocomplete}
          value={local.value}
          disabled={local.disabled}
          aria-invalid={local.error ? 'true' : undefined}
          aria-describedby={describedBy()}
          onInput={(e) => local.onInput(e.currentTarget.value)}
        />
        <button
          type="button"
          class="acct-password-toggle"
          aria-pressed={shown() ? 'true' : 'false'}
          aria-label={shown() ? 'Hide password' : 'Show password'}
          disabled={local.disabled}
          onClick={() => setShown((v) => !v)}
        >
          {shown() ? 'Hide' : 'Show'}
        </button>
      </div>
      <Show when={local.error}>
        <p class="onyx-field__error" id={errorId()}>{local.error}</p>
      </Show>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  hint?: string;
  children: JSX.Element;
}

function sectionId(title: string, suffix: string): string {
  return `acct-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${suffix}`;
}

function Section(props: SectionProps): JSX.Element {
  const [local] = splitProps(props, ['title', 'hint', 'children']);
  const titleId = () => sectionId(local.title, 'title');
  const hintId = () => (local.hint ? sectionId(local.title, 'hint') : undefined);
  return (
    <section class="acct-section" aria-labelledby={titleId()} aria-describedby={hintId()}>
      <div class="acct-section-head">
        <h3 class="acct-section-title" id={titleId()}>{local.title}</h3>
        <Show when={local.hint}>
          <p class="acct-section-hint" id={hintId()}>{local.hint}</p>
        </Show>
      </div>
      <div class="acct-section-body">{local.children}</div>
    </section>
  );
}

// ── Account panel ────────────────────────────────────────────────────────────

export function AccountPanel(props: AccountPanelProps): JSX.Element {
  const [local] = splitProps(props, ['open', 'onOpenChange']);

  // ── store reads ──
  const account = useStore(selectAccount);
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );
  const info = useStore((s) => s.accountInfo);
  const networkName = useStore((s) => s.networkName);
  const infoPending = useStore((s) => s.accountInfoPending);
  const actionError = useStore((s) => s.accountActionError);
  const serviceNotices = useStore((s) => s.serviceNotices);
  const totp = useStore((s) => s.totp);
  const [e2eeDeviceBusy, setE2eeDeviceBusy] = createSignal(false);
  let e2eePublishEpoch = 0;
  const personas = useStore((s) => s.personas);
  const personaOffers = useStore((s) => s.personaOffers);

  const isGuest = createMemo(() => !account());

  // ── local form state ──
  const [emailValue, setEmailValue] = createSignal('');
  const [emailPassword, setEmailPassword] = createSignal('');
  const [emailError, setEmailError] = createSignal<string | undefined>(undefined);

  const [newPassword, setNewPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [currentPassword, setCurrentPassword] = createSignal('');
  const [passwordError, setPasswordError] = createSignal<string | undefined>(undefined);

  const [protectPassword, setProtectPassword] = createSignal('');

  const [recoverNick, setRecoverNick] = createSignal('');
  const [recoverPassword, setRecoverPassword] = createSignal('');

  const [certFingerprint, setCertFingerprint] = createSignal('');

  const [totpCode, setTotpCode] = createSignal('');
  const [claimHost, setClaimHost] = createSignal('');
  const [copiedField, setCopiedField] = createSignal<string | null>(null);
  const [copyingField, setCopyingField] = createSignal<string | null>(null);
  const [copyFeedback, setCopyFeedback] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  let copyEpoch = 0;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearCopyTimer = (): void => {
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = undefined;
  };

  const copyField = async (field: 'secret' | 'otpauth', value: string): Promise<void> => {
    if (copyingField()) return;
    const epoch = ++copyEpoch;
    clearCopyTimer();
    setCopiedField(null);
    setCopyFeedback(null);
    setCopyingField(field);
    let copied: boolean;
    try {
      copied = await writeClipboardText(value);
    } catch {
      copied = false;
    }
    if (disposed || epoch !== copyEpoch) return;
    setCopyingField(null);
    if (!copied) {
      setCopyFeedback({
        message: 'Clipboard copy failed. Select the authenticator value manually.',
        failure: true,
      });
      return;
    }

    setCopiedField(field);
    setCopyFeedback({
      message: field === 'secret'
        ? 'Authenticator secret copied to clipboard.'
        : 'Authenticator link copied to clipboard.',
      failure: false,
    });
    copyTimer = setTimeout(() => {
      if (disposed || epoch !== copyEpoch) return;
      setCopiedField((current) => (current === field ? null : current));
      setCopyFeedback(null);
      copyTimer = undefined;
    }, 1400);
  };

  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
    e2eePublishEpoch += 1;
    clearCopyTimer();
  });

  // Danger zone — drop requires typing the account name + password.
  const [dropConfirm, setDropConfirm] = createSignal('');
  const [dropPassword, setDropPassword] = createSignal('');
  const [dropArmed, setDropArmed] = createSignal(false);

  const clearLocalAccountState = (): void => {
    setEmailValue('');
    setEmailPassword('');
    setEmailError(undefined);
    setNewPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
    setPasswordError(undefined);
    setProtectPassword('');
    setRecoverNick('');
    setRecoverPassword('');
    setCertFingerprint('');
    setTotpCode('');
    setClaimHost('');
    e2eePublishEpoch += 1;
    setE2eeDeviceBusy(false);
    setDropConfirm('');
    setDropPassword('');
    setDropArmed(false);
    copyEpoch += 1;
    clearCopyTimer();
    setCopiedField(null);
    setCopyingField(null);
    setCopyFeedback(null);
  };

  let accountBoundaryInitialized = false;
  let previousOwnerKey: string | null = null;
  createEffect(() => {
    const open = local.open;
    const owner = memoryOwner();
    const currentOwnerKey = owner ? deviceMemoryOwnerKey(owner) : null;
    const ownerChanged = accountBoundaryInitialized && currentOwnerKey !== previousOwnerKey;
    previousOwnerKey = currentOwnerKey;
    accountBoundaryInitialized = true;
    if (!open || ownerChanged) clearLocalAccountState();
  });

  // ── derived ──
  const flagBits = createMemo(() => {
    const f = info()?.flags;
    return typeof f === 'number' ? f : null;
  });

  // The latest cert-list notice (CERTADD/CERTLIST/CERTDEL replies land in the
  // flat serviceNotices list under the "Account" source — surface the most
  // recent fingerprint-shaped lines so the user gets feedback).
  const certNotices = createMemo(() =>
    serviceNotices()
      .filter((n) => n.source === 'Account' && /CERT|fingerprint|SHA256/i.test(n.text))
      .slice(-4),
  );

  const e2eeNotices = createMemo(() =>
    serviceNotices()
      .filter((n) => n.source === 'Account' && /\b(E2EEKEY|KEYTRANS)\b/i.test(n.text))
      .slice(-6),
  );

  // ── fetch fresh ACCOUNTINFO whenever the panel opens for a signed-in user ──
  createEffect(() => {
    const owner = memoryOwner();
    if (local.open && account() && owner) {
      getState().accountInfo_fetch();
      getState().totpStatus();
      getState().e2eeKeyStatus();
      getState().keyTransparencyStatus();
      getState().vhostList();
    }
  });

  // Seed the email field from the latest info (only when empty, so we never
  // clobber an in-progress edit).
  createEffect(() => {
    if (!local.open) return;
    const e = info()?.email;
    if (e && !emailValue()) setEmailValue(e);
  });

  // ── handlers ──
  function submitEmail(event: SubmitEvent): void {
    event.preventDefault();
    const value = emailValue().trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    if (!emailPassword()) {
      setEmailError('Your account password is required to change email.');
      return;
    }
    setEmailError(undefined);
    getState().accountSet('email', value, emailPassword());
    setEmailPassword('');
  }

  async function publishThisDeviceKey(): Promise<void> {
    if (e2eeDeviceBusy()) return;
    const stateAtStart = getState();
    const accountAtStart = stateAtStart.server?.account?.trim().toLowerCase() || null;
    const clientAtStart = stateAtStart.client;
    if (!accountAtStart || !clientAtStart) return;
    const epoch = ++e2eePublishEpoch;
    setE2eeDeviceBusy(true);
    try {
      const keys = await deviceKeys();
      if (!keys?.publicB64) return;
      const deviceId = await deviceRegistryId(keys.publicB64);
      if (!deviceId) return;
      const current = getState();
      const currentAccount = current.server?.account?.trim().toLowerCase() || null;
      if (
        disposed
        || epoch !== e2eePublishEpoch
        || !local.open
        || current.client !== clientAtStart
        || currentAccount !== accountAtStart
      ) return;
      current.e2eeKeyAdd(deviceId, 'onyx-p256', keys.publicB64);
    } finally {
      if (!disposed && epoch === e2eePublishEpoch) setE2eeDeviceBusy(false);
    }
  }

  function submitPassword(event: SubmitEvent): void {
    event.preventDefault();
    if (newPassword().length < MIN_PASSWORD_LEN) {
      setPasswordError(`Use at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (newPassword() !== confirmPassword()) {
      setPasswordError('Passwords do not match.');
      return;
    }
    if (!currentPassword()) {
      setPasswordError('Your current password is required.');
      return;
    }
    setPasswordError(undefined);
    // Onyx Server ACCOUNTSET accepts a password change via the `password` field when
    // supported; the value is the NEW password and the verifying arg is current.
    getState().accountSet('password', newPassword(), currentPassword());
    setNewPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
  }

  function toggleProtection(field: 'secure' | 'enforce', next: boolean): void {
    const pw = protectPassword().trim();
    if (!pw) {
      // Surface a transient hint via the store's notification channel so the
      // user knows a password is needed (no inline field per-toggle).
      getState().addNotification({
        type: 'error',
        text: 'Enter your account password to change protection settings.',
      });
      return;
    }
    getState().accountSet(field, next ? 'on' : 'off', pw);
  }

  function submitRecover(event: SubmitEvent): void {
    event.preventDefault();
    const nick = recoverNick().trim();
    if (!nick) return;
    getState().recover(nick, recoverPassword().trim() || undefined);
    setRecoverNick('');
    setRecoverPassword('');
  }

  function bindThisCert(): void {
    getState().certAdd();
    getState().certList();
  }

  function removeCert(event: SubmitEvent): void {
    event.preventDefault();
    const fp = certFingerprint().trim();
    if (!fp) return;
    getState().certDel(fp);
    setCertFingerprint('');
    getState().certList();
  }

  function submitTotpCode(event: SubmitEvent): void {
    event.preventDefault();
    const code = totpCode();
    if (!TOTP_CODE_RE.test(code)) return;
    getState().totpConfirm(code);
    setTotpCode('');
  }

  function signOut(): void {
    getState().logout();
    local.onOpenChange(false);
  }

  const dropReady = createMemo(() =>
    dropArmed() && dropConfirm().trim() === account() && !!dropPassword(),
  );

  function submitDrop(event: SubmitEvent): void {
    event.preventDefault();
    const acct = account();
    if (!acct || !dropReady()) return;
    getState().dropAccount(acct, dropPassword());
    setDropConfirm('');
    setDropPassword('');
    setDropArmed(false);
    local.onOpenChange(false);
  }

  function openClaimWithoutDisconnect(): void {
    // Close Account (ModalShell focus trap) first, then open the shared claim
    // Sheet on a microtask so the two traps never stack.
    local.onOpenChange(false);
    queueMicrotask(() => {
      openGuestClaimSheet();
    });
  }

  return (
    <ModalShell
      open={local.open}
      onOpenChange={local.onOpenChange}
      title="You"
      description={isGuest() ? 'You are browsing as a guest.' : `Signed in as ${account()}`}
      closeLabel="Close account panel"
    >
      <div class="acct" data-testid="account-panel" data-guest={isGuest() ? 'true' : 'false'}>
        <nav class="acct-hub" aria-label="You workspace">
          <button
            type="button"
            class="acct-hub-link acct-hub-link--current"
            aria-current="page"
          >
            Account
          </button>
          <button
            type="button"
            class="acct-hub-link"
            data-testid="you-open-appearance"
            onClick={() => {
              local.onOpenChange(false);
              queueMicrotask(() => getState().openAppearance());
            }}
          >
            Appearance
          </button>
          <button
            type="button"
            class="acct-hub-link"
            data-testid="you-open-preferences"
            onClick={() => {
              local.onOpenChange(false);
              queueMicrotask(() => openPreferences());
            }}
          >
            Preferences
          </button>
        </nav>
        <p class="acct-context-cue" role="note">
          <span>Next</span>
          <Show
            when={isGuest()}
            fallback="Review account protection and recovery on this device. Device keys remain separate from sign-in safeguards."
          >
            Keep this name if you want to protect it without disconnecting.
          </Show>
        </p>
        {/* ── Guest state ── */}
        <Show when={isGuest()}>
          <div class="acct-guest" data-testid="account-guest">
            <svg class="acct-guest-glyph" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="8.2" r="3.6" stroke-dasharray="3.2 2.2" />
              <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" stroke-dasharray="3.2 2.2" />
            </svg>
            <h3 class="acct-guest-title">You're browsing as a guest</h3>
            <p class="acct-guest-body">
              Register the name you are using on this connection to protect it with a
              password. You stay connected. Passkeys, recovery codes, certificates,
              and multi-device encryption tools are available after the account exists.
            </p>
            <ol class="acct-guest-steps" aria-label="Account claim steps">
              <li>Keep the name you are using — register it without reconnecting.</li>
              <li>Add an optional recovery email if the server asks for verification.</li>
              <li>After sign-in, bind a passkey or client certificate from this panel.</li>
              <li>After sign-in, publish an E2EE device key if you use more than one browser.</li>
            </ol>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="guest-open-claim"
              onClick={openClaimWithoutDisconnect}
            >
              Keep this name
            </Button>
          </div>
        </Show>

        {/* ── Signed-in state ── */}
        <Show when={!isGuest()}>
          {/* Identity card */}
          <section class="acct-identity" aria-label="Account summary">
            <div class="acct-identity-avatar" aria-hidden="true">
              {(account() ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div class="acct-identity-meta">
              <span class="acct-identity-eyebrow">signed in</span>
              <span class="acct-identity-name">{account()}</span>
              <Show when={infoPending()}>
                <span class="acct-identity-loading">
                  <Spinner size="sm" label="Loading account details" />
                </span>
              </Show>
              <Show when={info()}>
                {(detail) => (
                  <dl class="acct-facts">
                    <Show when={detail().email}>
                      <div class="acct-fact">
                        <dt>email</dt>
                        <dd>{detail().email}</dd>
                      </div>
                    </Show>
                    <Show when={flagBits() !== null}>
                      <div class="acct-fact">
                        <dt>flags</dt>
                        <dd>{flagBits()}</dd>
                      </div>
                    </Show>
                    <Show when={detail().secure !== undefined}>
                      <div class="acct-fact">
                        <dt>secure</dt>
                        <dd>{detail().secure ? 'on' : 'off'}</dd>
                      </div>
                    </Show>
                    <Show when={detail().enforce !== undefined}>
                      <div class="acct-fact">
                        <dt>enforce</dt>
                        <dd>{detail().enforce ? 'on' : 'off'}</dd>
                      </div>
                    </Show>
                    <Show when={detail().registered}>
                      <div class="acct-fact">
                        <dt>registered</dt>
                        <dd>{detail().registered}</dd>
                      </div>
                    </Show>
                  </dl>
                )}
              </Show>
            </div>
          </section>

          {/* Last action error */}
          <Show when={actionError()}>
            {(err) => (
              <div class="acct-error" role="alert" data-testid="account-error">
                <span aria-hidden="true">⚠</span>
                <span>
                  {err().command}: {err().description}
                </span>
              </div>
            )}
          </Show>

          {/* Email */}
          <Section title="Email" hint="Used for account recovery. Changing it requires your password.">
            <form onSubmit={submitEmail} noValidate aria-label="Change email">
              <FormField
                id="acct-email"
                label="Email address"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                value={emailValue()}
                error={emailError()}
                onInput={(e) => {
                  setEmailValue(e.currentTarget.value);
                  setEmailError(undefined);
                }}
              />
              <PasswordField
                id="acct-email-password"
                label="Current password (to confirm email change)"
                autocomplete="current-password"
                placeholder="account password"
                value={emailPassword()}
                onInput={(v) => {
                  setEmailPassword(v);
                  setEmailError(undefined);
                }}
              />
              <Button type="submit" variant="primary" size="sm" disabled={!emailValue().trim() || !emailPassword()}>
                Save email
              </Button>
            </form>
          </Section>

          {/* Password */}
          <Section title="Password" hint="Choose a new password. You'll need your current one to confirm.">
            <form onSubmit={submitPassword} noValidate aria-label="Change password">
              <PasswordField
                id="acct-new-password"
                label="New password"
                autocomplete="new-password"
                placeholder="at least 8 characters"
                value={newPassword()}
                error={passwordError()}
                onInput={(v) => {
                  setNewPassword(v);
                  setPasswordError(undefined);
                }}
              />
              <PasswordField
                id="acct-confirm-password"
                label="Confirm new password"
                autocomplete="new-password"
                placeholder="re-enter new password"
                value={confirmPassword()}
                onInput={(v) => {
                  setConfirmPassword(v);
                  setPasswordError(undefined);
                }}
              />
              <PasswordField
                id="acct-current-password"
                label="Current password (to authorize change)"
                autocomplete="current-password"
                placeholder="current password"
                value={currentPassword()}
                onInput={(v) => {
                  setCurrentPassword(v);
                  setPasswordError(undefined);
                }}
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!newPassword() || !confirmPassword() || !currentPassword()}
              >
                Change password
              </Button>
            </form>
          </Section>

          {/* Protection */}
          <Section title="Protection" hint="Name + login protection. Toggling these requires your password.">
            <PasswordField
              id="acct-protect-password"
              label="Account password (to change protection)"
              autocomplete="current-password"
              placeholder="needed to toggle below"
              value={protectPassword()}
              onInput={setProtectPassword}
            />
            <div class="acct-toggle-row">
              <div class="acct-toggle-body">
                <span class="acct-toggle-label">Secure</span>
                <p class="acct-toggle-desc">Recognise this account only via login, never an access-list match.</p>
              </div>
              <label class="acct-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Toggle secure"
                  aria-checked={info()?.secure ? 'true' : 'false'}
                  checked={!!info()?.secure}
                  onChange={(e) => toggleProtection('secure', e.currentTarget.checked)}
                />
                <span class="acct-switch-track" aria-hidden="true" />
                <span class="acct-switch-thumb" aria-hidden="true" />
              </label>
            </div>
            <div class="acct-toggle-row">
              <div class="acct-toggle-body">
                <span class="acct-toggle-label">Enforce</span>
                <p class="acct-toggle-desc">Protect your registered name — unauthenticated holders get force-renamed.</p>
              </div>
              <label class="acct-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Toggle enforce"
                  aria-checked={info()?.enforce ? 'true' : 'false'}
                  checked={!!info()?.enforce}
                  onChange={(e) => toggleProtection('enforce', e.currentTarget.checked)}
                />
                <span class="acct-switch-track" aria-hidden="true" />
                <span class="acct-switch-thumb" aria-hidden="true" />
              </label>
            </div>
          </Section>

          {/* Certificates */}
          <Section title="Certificates" hint="Bind a TLS client-certificate fingerprint for password-less login (certificate auth).">
            <div class="acct-cert-actions">
              <Button type="button" variant="ghost" size="sm" onClick={bindThisCert}>
                Bind this connection's certificate
              </Button>
            </div>
            <Show when={certNotices().length > 0}>
              <ul class="acct-cert-list" aria-label="Certificate notices">
                <For each={certNotices()}>
                  {(n) => <li class="acct-cert-item">{n.text}</li>}
                </For>
              </ul>
            </Show>
            <form onSubmit={removeCert} noValidate aria-label="Remove certificate fingerprint">
              <FormField
                id="acct-cert-fp"
                label="Remove a fingerprint"
                type="text"
                placeholder="SHA256:…"
                value={certFingerprint()}
                onInput={(e) => setCertFingerprint(e.currentTarget.value)}
              />
              <Button type="submit" variant="ghost" size="sm" disabled={!certFingerprint().trim()}>
                Remove fingerprint
              </Button>
            </form>
          </Section>

          {/* Two-factor authentication */}
          <Section title="Two-factor authentication" hint="A six-digit code from your authenticator app, required at every login.">
            <div class="acct-totp">
              <p class="acct-totp-status" data-status={totp().status}>
                <span class="acct-totp-dot" aria-hidden="true" />
                {totp().status === 'active' && 'Two-factor is active on this account.'}
                {totp().status === 'pending' && 'Enrollment pending — confirm with a code to activate.'}
                {totp().status === 'disabled' && 'Two-factor is off.'}
                {totp().status === 'unknown' && 'Checking status…'}
              </p>

              <Show when={totp().status === 'disabled' || totp().status === 'unknown'}>
                <Button type="button" variant="ghost" size="sm" disabled={totp().busy} onClick={() => getState().totpEnroll()}>
                  {totp().busy ? 'Working…' : 'Enable two-factor'}
                </Button>
              </Show>

              <Show when={totp().secret}>
                {(secret) => (
                  <div class="acct-totp-enroll">
                    <p class="acct-totp-note">
                      Add this secret to your authenticator (or use the otpauth link), then confirm with the current code.
                    </p>
                    <div class="acct-totp-row">
                      <code class="acct-totp-secret">{secret()}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={copyingField() !== null}
                        aria-busy={copyingField() === 'secret'}
                        onClick={() => void copyField('secret', secret())}
                      >
                        {copyingField() === 'secret' ? 'Copying…' : copiedField() === 'secret' ? 'Copied' : 'Copy secret'}
                      </Button>
                      <Show when={totp().otpauth}>
                        {(uri) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={copyingField() !== null}
                            aria-busy={copyingField() === 'otpauth'}
                            onClick={() => void copyField('otpauth', uri())}
                          >
                            {copyingField() === 'otpauth' ? 'Copying…' : copiedField() === 'otpauth' ? 'Copied' : 'Copy otpauth link'}
                          </Button>
                        )}
                      </Show>
                    </div>
                    <Show when={copyFeedback()}>
                      {(feedback) => (
                        <p
                          class="acct-totp-note"
                          role={feedback().failure ? 'alert' : 'status'}
                        >
                          {feedback().message}
                        </p>
                      )}
                    </Show>
                  </div>
                )}
              </Show>

              <Show when={totp().status === 'pending'}>
                <form
                  class="acct-totp-confirm"
                  noValidate
                  onSubmit={submitTotpCode}
                  aria-label="Confirm two-factor enrollment"
                >
                  <FormField
                    id="acct-totp-code"
                    label="Six-digit code"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength={TOTP_CODE_LENGTH}
                    pattern="[0-9]{6}"
                    placeholder="123456"
                    value={totpCode()}
                    onInput={(e) => setTotpCode(boundedTotpCode(e.currentTarget.value))}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={totp().busy || totpCode().length !== TOTP_CODE_LENGTH}
                  >
                    Confirm &amp; activate
                  </Button>
                </form>
              </Show>

              <Show when={totp().status === 'active'}>
                <Button type="button" variant="ghost" size="sm" disabled={totp().busy} onClick={() => getState().totpDisable()}>
                  Disable two-factor
                </Button>
              </Show>

              <Show when={totp().error}>
                <p class="acct-error" role="alert">{totp().error}</p>
              </Show>
            </div>
          </Section>

          {/* Sessions & devices — current browser + Era 2 (B8) remote list skeleton */}
          <SessionsDevicesSection account={account()} />

          {/* Offline recovery codes — B8 remainder */}
          <RecoveryCodesSection account={account()} />

          {/* Passkeys — WebAuthn passwordless login: register, list, rename, remove */}
          <PasskeysSection account={account()} owner={memoryOwner()} active={local.open} />

          <details class="acct-advanced" data-testid="you-advanced">
            <summary class="acct-advanced-summary">
              <span class="acct-advanced-title">Advanced</span>
              <span class="acct-advanced-hint">Ops tools, room organization, device keys, and personas</span>
            </summary>
            <div class="acct-advanced-body">
              <OperEventConsole />
              <CapabilityMatrixSection />
              <ChannelOrganizationSection owner={memoryOwner()} />
              <SmartMuteSection owner={memoryOwner()} />
              <PortableIdentitySection
                owner={memoryOwner()}
                networkHint={networkName() || undefined}
              />

          <Section
            title="Device encryption keys"
            hint="Multi-device DM E2EE (Era 3 C2): publish this browser's public key so other devices on your account can encrypt to you. List KEYTRANS entries from every device you use. Group E2EE is a later slice."
          >
            <div class="acct-cert-actions">
              <Button type="button" variant="ghost" size="sm" disabled={e2eeDeviceBusy()} onClick={() => void publishThisDeviceKey()}>
                {e2eeDeviceBusy() ? 'Publishing…' : 'Publish this device key'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => getState().e2eeKeyList()}>
                List device keys
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => getState().e2eeKeyDelete('browser')}
              >
                Remove legacy browser key
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => getState().keyTransparencyStatus()}>
                Refresh transparency root
              </Button>
            </div>
            <p class="acct-section-hint">
              Older Onyx versions published every browser under the shared id “browser”. After
              publishing this device’s stable key, remove that legacy entry if it is still listed.
            </p>
            <Show when={e2eeNotices().length > 0}>
              <ul class="acct-cert-list" aria-label="E2EE device key notices">
                <For each={e2eeNotices()}>
                  {(n) => <li class="acct-cert-item">{n.text}</li>}
                </For>
              </ul>
            </Show>
          </Section>

          <Section title="Personas" hint="Your Guise wardrobe — change the host others see, instantly and mid-session.">
            <div class="acct-personas">
              <Show
                when={personas().length > 0}
                fallback={<p class="acct-personas-empty">No personas yet — claim one below, or ask staff for a grant.</p>}
              >
                <ul class="acct-persona-list" aria-label="Your personas">
                  <For each={personas()}>
                    {(p) => (
                      <li class="acct-persona-row">
                        <div class="acct-persona-id">
                          <strong>{p.name}</strong>
                          <code>{p.host}</code>
                          <span class="acct-persona-src">{p.source}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Wear persona ${p.name}`}
                          onClick={() => getState().vhostUse(p.name)}
                        >
                          Wear
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
                <Button type="button" variant="ghost" size="sm" onClick={() => getState().vhostOff()}>
                  Take persona off
                </Button>
              </Show>

              <Show when={personaOffers().length > 0}>
                <div class="acct-persona-offers">
                  <p class="acct-persona-offers-label">Open offers</p>
                  <ul aria-label="Claimable persona templates">
                    <For each={personaOffers()}>
                      {(o) => (
                        <li class="acct-persona-offer">
                          <code>{o.template}</code>
                          <Show when={o.label}><span>{o.label}</span></Show>
                        </li>
                      )}
                    </For>
                  </ul>
                  <form
                    class="acct-persona-claim"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      getState().vhostClaim(claimHost());
                      setClaimHost('');
                    }}
                    aria-label="Claim a persona host"
                  >
                    <FormField
                      id="acct-persona-host"
                      label="Claim a host"
                      type="text"
                      placeholder="poets.society/you"
                      maxlength={MAX_PERSONA_HOST_LENGTH}
                      value={claimHost()}
                      onInput={(e) => setClaimHost(boundedAccountInput(
                        e.currentTarget.value,
                        MAX_PERSONA_HOST_LENGTH,
                      ))}
                    />
                    <Button type="submit" variant="ghost" size="sm" disabled={!claimHost().trim()}>
                      Claim
                    </Button>
                  </form>
                </div>
              </Show>
            </div>
          </Section>
            </div>
          </details>

          {/* Recover name */}
          <Section title="Recover a name" hint="Force an unauthenticated holder off your registered name.">
            <form onSubmit={submitRecover} noValidate aria-label="Recover a name">
              <FormField
                id="acct-recover-nick"
                label="Name"
                type="text"
                placeholder="your-registered-name"
                maxlength={RECOVER_NICK_MAX_LENGTH}
                value={recoverNick()}
                onInput={(e) => setRecoverNick(boundedAccountInput(
                  e.currentTarget.value,
                  RECOVER_NICK_MAX_LENGTH,
                ))}
              />
              <PasswordField
                id="acct-recover-password"
                label="Password"
                description="Optional — only if not already identified to this account."
                autocomplete="current-password"
                placeholder="account password (optional)"
                value={recoverPassword()}
                onInput={setRecoverPassword}
              />
              <Button type="submit" variant="ghost" size="sm" disabled={!recoverNick().trim()}>
                Recover name
              </Button>
            </form>
          </Section>

          {/* Sign out */}
          <Section title="Session" hint="Log out of this account on this connection.">
            <Button type="button" variant="ghost" size="md" onClick={signOut} data-testid="account-signout">
              Sign out
            </Button>
          </Section>

          {/* Danger zone — DROP */}
          <section class="acct-section acct-danger" aria-labelledby="acct-delete-account-title" aria-describedby="acct-delete-account-hint">
            <div class="acct-section-head">
              <h3 class="acct-section-title acct-danger-title" id="acct-delete-account-title">Delete account</h3>
              <p class="acct-section-hint" id="acct-delete-account-hint">
                Permanently deletes <b>{account()}</b>. This cannot be undone.
              </p>
            </div>
            <div class="acct-section-body">
              <Show
                when={dropArmed()}
                fallback={
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => setDropArmed(true)}
                    data-testid="account-drop-arm"
                  >
                    Delete account…
                  </Button>
                }
              >
                <form onSubmit={submitDrop} noValidate aria-label="Confirm account deletion">
                  <FormField
                    id="acct-drop-confirm"
                    label={`Type "${account()}" to confirm`}
                    type="text"
                    autocomplete="off"
                    placeholder={account() ?? ''}
                    value={dropConfirm()}
                    onInput={(e) => setDropConfirm(e.currentTarget.value)}
                  />
                  <PasswordField
                    id="acct-drop-password"
                    label="Account password"
                    autocomplete="current-password"
                    placeholder="account password"
                    value={dropPassword()}
                    onInput={setDropPassword}
                  />
                  <div class="acct-danger-actions">
                    <Button
                      type="submit"
                      variant="danger"
                      size="sm"
                      disabled={!dropReady()}
                      data-testid="account-drop-confirm"
                    >
                      Permanently delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDropArmed(false);
                        setDropConfirm('');
                        setDropPassword('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Show>
            </div>
          </section>
        </Show>
      </div>
    </ModalShell>
  );
}

export default AccountPanel;
