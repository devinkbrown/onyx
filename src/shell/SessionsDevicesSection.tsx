// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SessionsDevicesSection.tsx — Account "Sessions & devices" (Era 2 B8).
 *
 * Loads `SESSION LIST` from the daemon and offers `SESSION DROP #<n>` for
 * non-current attachments. Never fabricates remote devices; empty until the
 * server answers. Passkeys stay in the Passkeys section below.
 *
 * SOLID IDIOMS: never destructure props; read props in tracked scopes.
 */
import { createEffect, For, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import {
  formatSessionAge,
  formatSessionSignon,
  otherAttachedSessions,
  sessionRowLabel,
  type AccountSessionRow,
} from '@/lib/irc/sessionList';
import { Button } from '@/primitives/index';

export interface SessionsDevicesSectionProps {
  /** Signed-in account name, or null for a guest (section stays inert). */
  account: string | null;
}

export function SessionsDevicesSection(props: SessionsDevicesSectionProps): JSX.Element {
  const sessions = useStore((s) => s.accountSessions);
  const pending = useStore((s) => s.accountSessionsPending);
  const error = useStore((s) => s.accountSessionsError);

  createEffect(() => {
    const acct = props.account;
    if (!acct) return;
    // Fresh open of Account while signed in: pull authoritative list once.
    getState().refreshAccountSessions();
  });

  function onRefresh(): void {
    getState().refreshAccountSessions();
  }

  function onDrop(row: AccountSessionRow): void {
    if (row.current) return;
    getState().dropAccountSession(row.index);
  }

  function onRevokeOthers(): void {
    for (const row of otherAttachedSessions(sessions())) {
      getState().dropAccountSession(row.index);
    }
  }

  return (
    <Show when={props.account}>
      {(account) => (
        <section
          class="acct-section acct-sessions"
          aria-labelledby="acct-sessions-title"
          aria-describedby="acct-sessions-hint"
          data-testid="sessions-devices-section"
        >
          <div class="acct-section-head">
            <h3 class="acct-section-title" id="acct-sessions-title">
              Sessions &amp; devices
            </h3>
            <p class="acct-section-hint" id="acct-sessions-hint">
              Where <strong>{account()}</strong> is signed in across the mesh.
              Revoke another connection here; manage passkeys in the section below.
            </p>
          </div>

          <div class="acct-section-body">
            <div class="acct-session-toolbar">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending()}
                onClick={onRefresh}
                data-testid="sessions-refresh"
              >
                {pending() ? 'Refreshing…' : 'Refresh list'}
              </Button>
              <Show when={otherAttachedSessions(sessions()).length > 0}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending()}
                  onClick={onRevokeOthers}
                  data-testid="sessions-revoke-others"
                >
                  Revoke other devices
                </Button>
              </Show>
            </div>

            <Show when={error()}>
              {(msg) => (
                <p class="acct-error" role="alert" data-testid="sessions-error">
                  {msg()}
                </p>
              )}
            </Show>

            <Show
              when={sessions().length > 0}
              fallback={
                <div
                  class="acct-session-placeholder"
                  data-testid="sessions-empty"
                  role="status"
                >
                  <p class="acct-session-placeholder-title">
                    {pending() ? 'Loading sessions…' : 'No sessions listed yet'}
                  </p>
                  <p class="acct-session-placeholder-body">
                    {pending()
                      ? 'Asking the server for every attachment of this account.'
                      : 'Refresh after signing in on another device, or if the list looks stale.'}
                  </p>
                </div>
              }
            >
              <ul class="acct-session-list" aria-label="Account sessions">
                <For each={sessions()}>
                  {(row) => (
                    <li
                      class="acct-session-row"
                      data-testid={row.current ? 'sessions-current-device' : `sessions-row-${row.index}`}
                      data-current={row.current ? 'true' : 'false'}
                      data-state={row.state}
                    >
                      <div class="acct-session-id">
                        <span class="acct-session-name">{sessionRowLabel(row)}</span>
                        <span
                          class="acct-session-badge"
                          data-active={row.state === 'attached' ? 'true' : 'false'}
                        >
                          {row.current ? 'This device' : row.state}
                        </span>
                      </div>
                      <p class="acct-session-meta">
                        #{row.index} · {formatSessionAge(row.signonMs)} · signed on{' '}
                        {formatSessionSignon(row.signonMs)}
                      </p>
                      <Show when={!row.current}>
                        <div class="acct-session-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending()}
                            onClick={() => onDrop(row)}
                            data-testid={`sessions-drop-${row.index}`}
                            aria-label={`Revoke session ${row.index}`}
                          >
                            Revoke
                          </Button>
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <p class="acct-section-hint" data-testid="sessions-passkeys-hint">
              Device credentials (Face ID, fingerprint, security keys) are
              managed under <strong>Passkeys</strong> below.
            </p>
          </div>
        </section>
      )}
    </Show>
  );
}
