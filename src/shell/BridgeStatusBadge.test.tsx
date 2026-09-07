// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { BridgeStatusBadge } from './BridgeStatusBadge';

afterEach(cleanup);

describe('BridgeStatusBadge', () => {
  it('renders an advertised healthy Discord bridge', () => {
    render(() => (
      <BridgeStatusBadge
        status={{
          bridged: true,
          platform: 'discord',
          state: 'up',
          lastSeen: '2026-07-10T12:00:00Z',
        }}
      />
    ));

    const badge = screen.getByLabelText(/Discord bridge is up/);
    expect(badge).toHaveTextContent('Discord bridge: Up');
    expect(badge).toHaveTextContent('Messages are syncing normally.');
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveAttribute('aria-live', 'polite');
    expect(badge).toHaveAttribute('data-bridged', 'true');
    expect(badge).toHaveAttribute('data-platform', 'discord');
    expect(badge).toHaveAttribute('data-state', 'up');
  });

  it('renders no advertised bridge without exposing controls', () => {
    render(() => (
      <BridgeStatusBadge
        status={{
          bridged: false,
          platform: 'unknown',
          state: 'down',
        }}
      />
    ));

    const badge = screen.getByRole('status', { name: /No bridge is available for this room/ });
    expect(badge).toHaveTextContent('No bridge');
    expect(badge).toHaveTextContent('Ask a room admin to set up a bridge.');
    expect(badge).toHaveAttribute('data-bridged', 'false');
  });

  it.each([
    ['down', 'Check the bridge connection or try again later.'],
    ['degraded', 'Some messages may be delayed; check again shortly.'],
  ] as const)('gives a useful next step for a %s bridge', (state, action) => {
    render(() => <BridgeStatusBadge status={{ bridged: true, platform: 'matrix', state }} />);
    expect(screen.getByRole('status')).toHaveTextContent(action);
  });
});
