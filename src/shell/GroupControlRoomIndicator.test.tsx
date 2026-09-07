// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import type { GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';

import {
  GroupControlRoomIndicator,
  groupControlIndicatorPresentation,
} from './GroupControlRoomIndicator';

const state = (overrides: Partial<GroupControlRuntimeState> = {}): GroupControlRuntimeState => ({
  generation: 1,
  lifecycle: 'ready',
  activation: 'hold',
  identity: { clientId: 'private-client', endpoint: 'wss://private.example/ws', account: 'alice', deviceId: 'phone' },
  rooms: [],
  counters: { accepted: 0, processed: 0, queued: 0, applied: 0, locked: 0, rejected: 0, ignored: 0, coalesced: 0, evicted: 0, expired: 0 },
  queueDepth: 17,
  sessionCount: 9,
  ...overrides,
});

afterEach(cleanup);

describe('GroupControlRoomIndicator', () => {
  it('is a passive, channel-only held-state projection', () => {
    render(() => <GroupControlRoomIndicator room="#lobby" authenticated projection={state()} />);

    const indicator = screen.getByTestId('group-control-room-indicator');
    expect(indicator).toHaveTextContent('Message protection: not active');
    expect(indicator).toHaveTextContent('Room controls unavailable');
    expect(indicator.querySelector('button, a, input, select, textarea')).toBeNull();
    expect(indicator).not.toHaveAttribute('tabindex');
    expect(indicator).toHaveAccessibleName(
      'Message protection: not active. Room controls unavailable.',
    );
    expect(screen.queryByTestId('group-control-room-indicator')).toBeInTheDocument();
  });

  it('keeps the inactive message-protection invariant after a control is applied', () => {
    render(() => <GroupControlRoomIndicator
      room="#lobby"
      authenticated
      projection={state({ rooms: [{ room: '#lobby', status: 'control-applied', provisioned: true }] })}
    />);

    const indicator = screen.getByTestId('group-control-room-indicator');
    expect(indicator).toHaveAttribute('data-state', 'applied');
    expect(indicator).toHaveTextContent('Message protection: not active');
    expect(indicator).toHaveTextContent('Room controls applied; message protection remains inactive');
    expect(indicator).toHaveAccessibleName(
      'Message protection: not active. Room controls applied; message protection remains inactive.',
    );
    expect(indicator.textContent?.toLowerCase()).not.toContain('encrypted');
    expect(indicator.textContent?.toLowerCase()).not.toContain('ready');
  });

  it('reports active protection only from the explicit active projection', () => {
    render(() => <GroupControlRoomIndicator
      room="#lobby"
      authenticated
      projection={state({
        activation: 'active',
        rooms: [{ room: '#lobby', status: 'control-applied', provisioned: true }],
      })}
    />);
    const indicator = screen.getByTestId('group-control-room-indicator');
    expect(indicator).toHaveAttribute('data-state', 'active');
    expect(indicator).toHaveTextContent('Message protection: available');
    expect(indicator).toHaveTextContent('Protection session ready on this device; room policy is reported separately');
    expect(indicator).not.toHaveTextContent('Room messages are protected');
  });

  it('fails closed while signed out and never renders for non-channel views', () => {
    render(() => <GroupControlRoomIndicator
      room="#lobby"
      authenticated={false}
      projection={state({ rooms: [{ room: '#lobby', status: 'control-applied', provisioned: true }] })}
    />);
    expect(screen.getByTestId('group-control-room-indicator')).toHaveTextContent('Sign in to inspect room controls');
    cleanup();

    render(() => <GroupControlRoomIndicator room="alice" authenticated projection={state()} />);
    expect(screen.queryByTestId('group-control-room-indicator')).toBeNull();
  });

  it('maps safe lifecycle and room status without exposing snapshot internals', () => {
    expect(groupControlIndicatorPresentation('#lobby', true, state({ lifecycle: 'identity-pending' })))
      .toMatchObject({ state: 'identity-pending', detail: 'Checking account identity…' });
    expect(groupControlIndicatorPresentation('#lobby', true, state({ rooms: [{ room: '#lobby', status: 'locked', provisioned: false }] })))
      .toMatchObject({ state: 'locked', detail: 'Room controls locked' });
    expect(groupControlIndicatorPresentation('#lobby', true, state({ rooms: [{ room: '#lobby', status: 'directory-pending', provisioned: false }] })))
      .toMatchObject({ state: 'pending', detail: 'Room controls pending' });
    expect(groupControlIndicatorPresentation('#lobby', true, state({ rooms: [{ room: '#lobby', status: 'rejected', provisioned: false }] })))
      .toMatchObject({ state: 'recovery-required', detail: 'Room controls need recovery' });

    render(() => <GroupControlRoomIndicator
      room="#lobby"
      authenticated
      projection={state({ rooms: [{ room: '#lobby', status: 'locked', provisioned: false }] })}
    />);
    const text = screen.getByTestId('group-control-room-indicator').textContent ?? '';
    for (const secret of ['private-client', 'private.example', 'alice', 'phone', '17', '9']) {
      expect(text).not.toContain(secret);
    }
  });
});
