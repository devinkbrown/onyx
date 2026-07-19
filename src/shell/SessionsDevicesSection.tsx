// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SessionsDevicesSection.tsx — Account "Sessions & devices" skeleton (Era 1 A4).
 *
 * Honest product surface for the identity mental model:
 *   • This browser is the only session we can truthfully list today.
 *   • Other sessions + revoke arrive with server list support in Era 2 (B8).
 *   • Device credentials (passkeys) live in the Passkeys section below —
 *     this section points there instead of inventing a second credential UI.
 *
 * No fake revoke, no fabricated remote sessions. Fail-closed by omission.
 *
 * SOLID IDIOMS: component runs once. Never destructure props; read them in
 * tracked scopes. Token-driven styling lives in account.css.
 */
import { Show, type JSX } from 'solid-js';

export interface SessionsDevicesSectionProps {
  /** Signed-in account name, or null for a guest (section stays inert). */
  account: string | null;
}

export function SessionsDevicesSection(props: SessionsDevicesSectionProps): JSX.Element {
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
              Where <strong>{account()}</strong> is signed in. Manage passkeys
              for this account in the Passkeys section below.
            </p>
          </div>

          <div class="acct-section-body">
            <ul class="acct-session-list" aria-label="Active sessions on this device">
              <li class="acct-session-row" data-testid="sessions-current-device">
                <div class="acct-session-id">
                  <span class="acct-session-name">This browser</span>
                  <span class="acct-session-badge" data-active="true">
                    Active
                  </span>
                </div>
                <p class="acct-session-meta">
                  Current session on this device. Signing out ends it here.
                </p>
              </li>
            </ul>

            <div
              class="acct-session-placeholder"
              data-testid="sessions-remote-placeholder"
              role="note"
            >
              <p class="acct-session-placeholder-title">Other sessions</p>
              <p class="acct-session-placeholder-body">
                Session list from the server arrives in Era 2 (B8). Remote
                devices and revoke will show here when the mesh can list them —
                nothing is fabricated in the meantime.
              </p>
            </div>

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
