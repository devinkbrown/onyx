// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, Show, type JSX } from 'solid-js';

import type { BridgePlatform, BridgeState, BridgeStatus } from '@/lib/interop/bridgeStatus';

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

function stateColor(status: BridgeStatus): string {
  if (!status.bridged) return '#64748b';
  if (status.state === 'up') return '#15803d';
  if (status.state === 'down') return '#b91c1c';
  return '#b45309';
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
  const label = createMemo(() => {
    if (!props.status.bridged) return 'No bridge';
    return `${platformLabel(props.status.platform)} ${stateLabel(props.status.state)}`;
  });
  const color = createMemo(() => stateColor(props.status));
  const aria = createMemo(() => {
    if (!props.status.bridged) return 'No bridge advertised for this room';
    const seen = props.status.lastSeen ? `, last seen ${formatLastSeen(props.status.lastSeen)}` : '';
    return `${platformLabel(props.status.platform)} bridge ${stateLabel(props.status.state).toLowerCase()}${seen}`;
  });

  return (
    <span
      class={['bridge-status-badge', props.class].filter(Boolean).join(' ')}
      data-bridged={props.status.bridged ? 'true' : 'false'}
      data-platform={props.status.platform}
      data-state={props.status.state}
      aria-label={aria()}
      title={aria()}
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        gap: '0.45rem',
        width: 'fit-content',
        'max-width': '100%',
        padding: '0.25rem 0.55rem',
        'border-radius': '999px',
        border: `1px solid ${color()}`,
        color: color(),
        'font-size': '0.82rem',
        'font-weight': '700',
        'line-height': '1.2',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '0.45rem',
          height: '0.45rem',
          'border-radius': '999px',
          background: color(),
          'flex-shrink': 0,
        }}
      />
      <span>{label()}</span>
      <Show when={props.status.bridged && props.status.lastSeen}>
        {(lastSeen) => (
          <span
            style={{
              color: 'currentColor',
              opacity: 0.78,
              'font-weight': 500,
              'white-space': 'nowrap',
            }}
          >
            {formatLastSeen(lastSeen())}
          </span>
        )}
      </Show>
    </span>
  );
}
