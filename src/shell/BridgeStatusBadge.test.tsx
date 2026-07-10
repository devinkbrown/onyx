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

    const badge = screen.getByLabelText(/Discord bridge up/);
    expect(badge).toHaveTextContent('Discord Up');
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

    const badge = screen.getByLabelText('No bridge advertised for this channel');
    expect(badge).toHaveTextContent('No bridge');
    expect(badge).toHaveAttribute('data-bridged', 'false');
  });
});
