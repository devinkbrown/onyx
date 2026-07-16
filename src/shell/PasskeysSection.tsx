// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PasskeysSection.tsx — manage WebAuthn passkeys for the signed-in account.
 *
 * The full lifecycle on top of the existing register/sign-in ceremonies:
 *   • register  — run the create ceremony (store.registerPasskey)
 *   • list      — WEBAUTHN LIST → label, sign count, created date (when sent)
 *   • rename    — WEBAUTHN RENAME (degrades to a clear notice if unsupported)
 *   • remove    — WEBAUTHN REMOVE, guarded by an inline confirm
 *
 * Fail-closed by construction: this is a thin UI over store actions that already
 * dispatch raw commands and fold the server's standard replies back into state.
 * A cancelled/failed ceremony surfaces `passkeyError`; it NEVER falls back to a
 * weaker auth path. Reads go through useStore; writes go through store actions.
 *
 * SOLID IDIOMS: the component runs once. Never destructure props; read them in
 * tracked scopes. Token-driven styling + a11y live in account.css.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import {
  deviceMemoryOwnerKey,
  normalizeDeviceMemoryOwner,
  type DeviceMemoryOwner,
} from '@/lib/deviceMemoryOwner';
import { useStore, getState } from '@/lib/store';
import { isPasskeySupported } from '@/lib/webauthn/passkey';
import { Button, FormField, Spinner } from '@/primitives/index';

export interface PasskeysSectionProps {
  /** The signed-in account name, or null for a guest (section stays inert). */
  account: string | null;
  /** Exact server + identity that owns the passkey-management session. */
  owner: DeviceMemoryOwner | null;
  /** Whether the containing panel is open — gates the initial list probe. */
  active: boolean;
}

/** Render a unix-seconds timestamp as a short local date, or null if absent. */
function formatCreated(createdAt: number | null): string | null {
  if (createdAt === null || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  try {
    return new Date(createdAt * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export function PasskeysSection(props: PasskeysSectionProps): JSX.Element {
  const [local] = splitProps(props, ['account', 'owner', 'active']);

  const busy = useStore((s) => s.passkeyBusy);
  const notice = useStore((s) => s.passkeyNotice);
  const error = useStore((s) => s.passkeyError);
  const creds = useStore((s) => s.passkeyCreds);
  const listPending = useStore((s) => s.passkeyListPending);
  const supported = useStore((s) => s.passkeySupported);
  const renameUnsupported = useStore((s) => s.passkeyRenameUnsupported);

  const [label, setLabel] = createSignal('');
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal('');
  const [confirmingId, setConfirmingId] = createSignal<string | null>(null);

  const clearLocalActionState = (): void => {
    setLabel('');
    setRenamingId(null);
    setRenameValue('');
    setConfirmingId(null);
  };

  // Typed labels and armed rename/remove controls are account authority, not
  // generic UI state. Retire them when the panel closes or the exact endpoint
  // + identity owner changes, including same-name accounts on another server.
  let actionBoundaryInitialized = false;
  let previousActionScope: string | null = null;
  createEffect(() => {
    const owner = local.owner;
    const nextScope = local.active && owner ? deviceMemoryOwnerKey(owner) : null;
    const changed = actionBoundaryInitialized && nextScope !== previousActionScope;
    previousActionScope = nextScope;
    actionBoundaryInitialized = true;
    if (changed) clearLocalActionState();
  });

  const browserSupported = createMemo(() => isPasskeySupported());
  const signedIn = createMemo(() => !!local.account);
  const hasCurrentOwner = createMemo(() => {
    const account = local.account?.trim().toLowerCase();
    const owner = normalizeDeviceMemoryOwner(local.owner);
    return Boolean(
      account
      && owner
      && deviceMemoryOwnerKey(owner)
      && owner.identity === account,
    );
  });
  // Unknown (null) is treated as "try": the section renders and probes.
  const serverUnavailable = createMemo(() => supported() === false);
  const showManager = createMemo(
    () => hasCurrentOwner() && browserSupported() && !serverUnavailable(),
  );

  // Probe the server's passkey list the first time the panel opens for a
  // signed-in user. `listPasskeys()` resolves `passkeySupported` fail-closed.
  createEffect(() => {
    const activeAccount = local.account;
    const activeOwner = normalizeDeviceMemoryOwner(local.owner);
    const activeOwnerKey = activeOwner ? deviceMemoryOwnerKey(activeOwner) : null;
    if (
      local.active
      && activeAccount
      && activeOwnerKey
      && activeOwner?.identity === activeAccount.trim().toLowerCase()
      && browserSupported()
      && !serverUnavailable()
    ) {
      // Read the account string itself: Alice → Bob remains signed-in=true, so
      // tracking only the boolean would leave Alice's list under Bob.
      getState().listPasskeys();
    }
  });

  function submitRegister(event: SubmitEvent): void {
    event.preventDefault();
    getState().registerPasskey(label());
    setLabel('');
  }

  function startRename(id: string, current: string): void {
    setConfirmingId(null);
    setRenamingId(id);
    setRenameValue(current);
  }

  function submitRename(event: SubmitEvent, id: string): void {
    event.preventDefault();
    const next = renameValue().trim();
    if (!next) return;
    getState().renamePasskey(id, next);
    setRenamingId(null);
    setRenameValue('');
  }

  function confirmRemove(id: string): void {
    getState().removePasskey(id);
    setConfirmingId(null);
  }

  const emptyResolved = createMemo(
    () => supported() !== null && !listPending() && creds().length === 0,
  );

  return (
    <section
      class="acct-section acct-passkeys"
      aria-labelledby="acct-passkeys-title"
      aria-describedby="acct-passkeys-hint"
    >
      <div class="acct-section-head">
        <h3 class="acct-section-title" id="acct-passkeys-title">Passkeys</h3>
        <p class="acct-section-hint" id="acct-passkeys-hint">
          Sign in without a password using a device passkey — Face ID, a
          fingerprint, or a security key.
        </p>
      </div>

      <div class="acct-section-body">
        {/* ── Disabled: browser can't do WebAuthn ── */}
        <Show when={signedIn() && !browserSupported()}>
          <p class="acct-passkeys-disabled" data-testid="passkeys-browser-unsupported">
            This browser does not support passkeys. Try a current version of
            Chrome, Safari, Firefox, or Edge on a device with a screen lock.
          </p>
        </Show>

        {/* ── Disabled: server doesn't offer passkeys ── */}
        <Show when={signedIn() && browserSupported() && serverUnavailable()}>
          <p class="acct-passkeys-disabled" data-testid="passkeys-server-unsupported">
            This server does not offer passkey sign-in yet. You can still protect
            your account with a password and two-factor authentication.
          </p>
        </Show>

        {/* ── The manager ── */}
        <Show when={showManager()}>
          {/* Register */}
          <form
            class="acct-passkey"
            noValidate
            onSubmit={submitRegister}
            aria-label="Add a passkey"
          >
            <FormField
              id="acct-passkey-label"
              label="Passkey name (optional)"
              placeholder="e.g. My laptop"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy()}>
              {busy() ? 'Waiting for your device…' : 'Add a passkey'}
            </Button>
          </form>

          {/* Live status / error — one region each, announced politely. */}
          <Show when={notice()}>
            {(m) => (
              <p class="acct-passkey-msg is-ok" role="status">{m()}</p>
            )}
          </Show>
          <Show when={error()}>
            {(m) => (
              <p class="acct-passkey-msg is-err" role="alert">{m()}</p>
            )}
          </Show>

          {/* List */}
          <div class="acct-passkey-list-wrap">
            <div class="acct-passkey-list-head">
              <h4 class="acct-passkey-list-title" id="acct-passkey-list-title">
                Your passkeys
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => getState().listPasskeys()}
                disabled={listPending()}
              >
                {listPending() ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>

            <Show when={listPending() && creds().length === 0}>
              <p class="acct-passkey-loading" data-testid="passkeys-loading">
                <Spinner size="sm" label="Loading your passkeys" />
                <span>Loading your passkeys…</span>
              </p>
            </Show>

            <Show when={emptyResolved()}>
              <p class="acct-passkey-empty" data-testid="passkeys-empty">
                No passkeys yet. Add one above to sign in without a password.
              </p>
            </Show>

            <Show when={creds().length > 0}>
              <ul class="acct-passkey-list" aria-labelledby="acct-passkey-list-title">
                <For each={creds()}>
                  {(cred) => {
                    const created = () => formatCreated(cred.createdAt);
                    return (
                      <li class="acct-passkey-row" data-testid="passkey-row">
                        <Show
                          when={renamingId() === cred.id}
                          fallback={
                            <>
                              <div class="acct-passkey-id">
                                <strong class="acct-passkey-name">
                                  {cred.label || 'Unnamed passkey'}
                                </strong>
                                <span class="acct-passkey-meta">
                                  <Show when={created()}>
                                    {(d) => <span>Added {d()}</span>}
                                  </Show>
                                  <span>Used {cred.signCount}×</span>
                                </span>
                              </div>
                              <div class="acct-passkey-actions">
                                <Show when={!renameUnsupported()}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Rename ${cred.label || 'passkey'}`}
                                    onClick={() => startRename(cred.id, cred.label)}
                                  >
                                    Rename
                                  </Button>
                                </Show>
                                <Show
                                  when={confirmingId() === cred.id}
                                  fallback={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Remove ${cred.label || 'passkey'}`}
                                      onClick={() => setConfirmingId(cred.id)}
                                    >
                                      Remove
                                    </Button>
                                  }
                                >
                                  <span class="acct-passkey-confirm" role="group" aria-label="Confirm removal">
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      disabled={busy()}
                                      onClick={() => confirmRemove(cred.id)}
                                    >
                                      Remove?
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setConfirmingId(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </span>
                                </Show>
                              </div>
                            </>
                          }
                        >
                          <form
                            class="acct-passkey-rename"
                            noValidate
                            onSubmit={(e) => submitRename(e, cred.id)}
                            aria-label={`Rename ${cred.label || 'passkey'}`}
                          >
                            <FormField
                              id={`acct-passkey-rename-${cred.id}`}
                              label="New name"
                              value={renameValue()}
                              onInput={(e) => setRenameValue(e.currentTarget.value)}
                            />
                            <div class="acct-passkey-actions">
                              <Button
                                type="submit"
                                variant="primary"
                                size="sm"
                                disabled={busy() || !renameValue().trim()}
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setRenamingId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </form>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}

export default PasskeysSection;
