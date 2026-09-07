// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RecoveryCodesSection — Account offline recovery codes (Era 2 B8).
 *
 * Wire: RECOVERYCODES STATUS | GENERATE [password] | CLEAR [password]
 * Fresh codes are shown once after GENERATE; LOGIN is offered on Connect.
 */
import { createEffect, createSignal, For, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { Button } from '@/primitives/index';

export interface RecoveryCodesSectionProps {
  account: string | null;
}

export function RecoveryCodesSection(props: RecoveryCodesSectionProps): JSX.Element {
  const state = useStore((s) => s.recoveryCodes);
  const [password, setPassword] = createSignal('');
  const [confirmGenerate, setConfirmGenerate] = createSignal(false);

  createEffect(() => {
    if (!props.account) return;
    getState().recoveryCodesStatus();
  });

  function onGenerate(): void {
    if (!confirmGenerate()) {
      setConfirmGenerate(true);
      return;
    }
    setConfirmGenerate(false);
    getState().recoveryCodesGenerate(password() || undefined);
    setPassword('');
  }

  function onClear(): void {
    getState().recoveryCodesClear(password() || undefined);
    setPassword('');
    setConfirmGenerate(false);
  }

  function onCopyAll(): void {
    const codes = state().freshCodes;
    if (codes.length === 0) return;
    void navigator.clipboard?.writeText(codes.join('\n')).catch(() => {
      /* clipboard may be blocked; user can still select */
    });
  }

  return (
    <Show when={props.account}>
      {(account) => (
        <section
          class="acct-section acct-recovery"
          aria-labelledby="acct-recovery-title"
          aria-describedby="acct-recovery-hint"
          data-testid="recovery-codes-section"
        >
          <div class="acct-section-head">
            <h3 class="acct-section-title" id="acct-recovery-title">
              Recovery codes
            </h3>
            <p class="acct-section-hint" id="acct-recovery-hint">
              Single-use offline codes for <strong>{account()}</strong> when you
              lose your password and passkeys. Each code works once; store them
              somewhere safe offline.
            </p>
          </div>

          <div class="acct-section-body">
            <p class="acct-section-hint" role="status" aria-live="polite" data-testid="recovery-remaining">
              <Show
                when={state().remaining !== null}
                fallback="Ask the server how many codes remain…"
              >
                {state().remaining === 0
                  ? 'No unused recovery codes on this account.'
                  : `${state().remaining} unused recovery code${state().remaining === 1 ? '' : 's'} remaining.`}
              </Show>
            </p>

            <label class="acct-field">
              <span class="acct-field-label">Password (optional re-check)</span>
              <input
                type="password"
                class="acct-input"
                autocomplete="current-password"
                value={password()}
                disabled={state().busy}
                onInput={(e) => setPassword(e.currentTarget.value)}
                data-testid="recovery-password"
              />
            </label>

            <div class="acct-cert-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={state().busy}
                onClick={onGenerate}
                data-testid="recovery-generate"
              >
                {confirmGenerate()
                  ? 'Confirm: replace all codes'
                  : state().busy
                    ? 'Working…'
                    : 'Generate new codes'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={state().busy}
                onClick={() => getState().recoveryCodesStatus()}
                data-testid="recovery-refresh"
              >
                Refresh count
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={state().busy || state().remaining === 0}
                onClick={onClear}
                data-testid="recovery-clear"
              >
                Clear all codes
              </Button>
            </div>

            <Show when={confirmGenerate()}>
              <p class="acct-section-hint" role="status">
                Generating replaces every existing code. Click again to confirm.
              </p>
            </Show>

            <Show when={state().error}>
              {(msg) => (
                <p class="acct-error" role="alert" data-testid="recovery-error">
                  {msg()}
                </p>
              )}
            </Show>

            <Show when={state().info}>
              {(msg) => (
                <p class="acct-section-hint" role="status" data-testid="recovery-info">
                  {msg()}
                </p>
              )}
            </Show>

            <Show when={state().freshCodes.length > 0}>
              <div class="acct-recovery-fresh" data-testid="recovery-fresh-codes">
                <p class="acct-section-hint">
                  <strong>Save these now</strong> — they will not be shown again.
                </p>
                <ul class="acct-cert-list" aria-label="Fresh recovery codes">
                  <For each={state().freshCodes}>
                    {(code, i) => (
                      <li class="acct-cert-item">
                        <code>
                          {i() + 1}. {code}
                        </code>
                      </li>
                    )}
                  </For>
                </ul>
                <div class="acct-cert-actions">
                  <Button type="button" variant="ghost" size="sm" onClick={onCopyAll}>
                    Copy all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => getState().recoveryCodesDismissFresh()}
                    data-testid="recovery-dismiss-fresh"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}
