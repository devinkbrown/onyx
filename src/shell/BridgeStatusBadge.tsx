// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, Show, type JSX } from 'solid-js';

import type { BridgePlatform, BridgeState, BridgeStatus } from '@/lib/interop/bridgeStatus';
import './BridgeStatusBadge.css';

function platformLabel(platform: BridgePlatform): string {
  if (platform === 'discord') return 'Discord';
  if (platform === 'matrix') return 'Matrix';
  if (platform === 'irc') return 'IRC';
  return 'Bridge';
}

function stateLabel(state: BridgeState): string {
  if (state === 'up') return 'Up';
  if (state === 'down') return 'Down';
  return 'Degraded';
}

function actionLabel(status: BridgeStatus): string {
  if (!status.bridged) return 'Ask a room admin to set up a bridge.';
  if (status.state === 'up') return 'Messages are syncing normally.';
  if (status.state === 'down') return 'Check the bridge connection or try again later.';
  return 'Some messages may be delayed; check again shortly.';
}

function formatLastSeen(lastSeen: string): string {
  const timestamp = Date.parse(lastSeen);
  if (!Number.isFinite(timestamp)) return lastSeen;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function BridgeStatusBadge(props: {
  status: BridgeStatus;
  class?: string;
}): JSX.Element {
  const label = createMemo(() => !props.status.bridged ? 'No bridge' : `${platformLabel(props.status.platform)} bridge: ${stateLabel(props.status.state)}`);
  const aria = createMemo(() => {
    if (!props.status.bridged) return 'No bridge is available for this room. Ask a room admin to set one up.';
    const seen = props.status.lastSeen ? `, last seen ${formatLastSeen(props.status.lastSeen)}` : '';
    return `${platformLabel(props.status.platform)} bridge is ${stateLabel(props.status.state).toLowerCase()}${seen}. ${actionLabel(props.status)}`;
  });

  return (
    <span
      class={['bridge-status-badge', props.class].filter(Boolean).join(' ')}
      data-bridged={props.status.bridged ? 'true' : 'false'}
      data-platform={props.status.platform}
      data-state={props.status.state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      tabindex="0"
      aria-label={aria()}
      title={aria()}
    >
      <span class="bridge-status-badge__dot" aria-hidden="true" />
      <span class="bridge-status-badge__copy">
        <span class="bridge-status-badge__label">{label()}</span>
        <span class="bridge-status-badge__action">{actionLabel(props.status)}</span>
      </span>
      <Show when={props.status.bridged && props.status.lastSeen}>
        {(lastSeen) => (
          <span class="bridge-status-badge__seen">
            {formatLastSeen(lastSeen())}
          </span>
        )}
      </Show>
    </span>
  );
}
