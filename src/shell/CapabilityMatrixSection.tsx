// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CapabilityMatrixSection — user-visible product capability matrix for the session.
 */
import { createMemo, For, Show, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import {
  buildCapabilityMatrix,
  capabilitySummary,
  type CapStatus,
} from '@/lib/irc/capabilityMatrix';

function statusLabel(status: CapStatus): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'available':
      return 'available';
    case 'missing':
      return 'missing';
    default:
      return 'unknown';
  }
}

export function CapabilityMatrixSection(): JSX.Element {
  const client = useStore((s) => s.client);
  const connectionStatus = useStore((s) => s.connectionStatus);

  const rows = createMemo(() => {
    const c = client();
    if (!c) return buildCapabilityMatrix({});
    const negotiated = c.negotiatedCaps ?? new Set<string>();
    // availableCaps may not exist on all client shapes — fail soft.
    const available =
      'availableCaps' in c && c.availableCaps instanceof Set
        ? (c.availableCaps as Set<string>)
        : negotiated;
    return buildCapabilityMatrix({ negotiated, available });
  });

  const summary = createMemo(() => capabilitySummary(rows()));

  return (
    <section
      class="acct-section"
      aria-labelledby="acct-caps-title"
      aria-describedby="acct-caps-hint"
      data-testid="capability-matrix-section"
    >
      <div class="acct-section-head">
        <h3 class="acct-section-title" id="acct-caps-title">
          Session capabilities
        </h3>
        <p class="acct-section-hint" id="acct-caps-hint">
          What this connection negotiated with Onyx Server. Active means in use now.
        </p>
      </div>
      <div class="acct-section-body">
        <p class="acct-section-hint" role="status" data-testid="capability-matrix-summary">
          {connectionStatus() === 'connected' ? summary() : 'Connect to see negotiated capabilities.'}
        </p>
        <Show when={connectionStatus() === 'connected'}>
          <ul class="acct-cert-list" aria-label="Product capabilities" data-testid="capability-matrix-list">
            <For each={rows()}>
              {(row) => (
                <li
                  class="acct-cert-item"
                  data-testid="capability-matrix-row"
                  data-cap-status={row.status}
                >
                  <strong>{row.label}</strong>
                  {' · '}
                  <span class="acct-persona-src">{statusLabel(row.status)}</span>
                  <span class="acct-section-hint"> — {row.hint}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  );
}

export default CapabilityMatrixSection;
