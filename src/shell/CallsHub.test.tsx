// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CallsHub — focused product-frame tests.
 * Opening the hub never joins a call; presentations stay truthful.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import {
  CallsHub,
  classifyCallsHubPresentation,
  type CallsHubProps,
} from './CallsHub';
import type { CallState } from '@/lib/cadence-media/types';

function renderHub(overrides: Partial<CallsHubProps> = {}) {
  const onOpenRooms = overrides.onOpenRooms ?? vi.fn();
  const onReturnToCall = overrides.onReturnToCall ?? vi.fn();
  const props: CallsHubProps = {
    callState: 'idle',
    callChannel: null,
    callWith: '',
    callStartedAt: null,
    onOpenRooms,
    onReturnToCall,
    ...overrides,
  };
  const result = render(() => <CallsHub {...props} />);
  return { ...result, onOpenRooms, onReturnToCall, props };
}

describe('classifyCallsHubPresentation', () => {
  it('maps every lifecycle edge truthfully', () => {
    expect(classifyCallsHubPresentation('idle', null)).toBe('idle');
    expect(classifyCallsHubPresentation('ringing_in', null)).toBe('ringing_in');
    expect(classifyCallsHubPresentation('ringing_out', null)).toBe('ringing_out');
    expect(classifyCallsHubPresentation('in_call', null)).toBe('provisional');
    expect(classifyCallsHubPresentation('in_call', 1_700_000_000_000)).toBe('established');
    // Ringing must never look established even if a stale timestamp leaks in.
    expect(classifyCallsHubPresentation('ringing_in', 1_700_000_000_000)).toBe('ringing_in');
    expect(classifyCallsHubPresentation('ringing_out', 1_700_000_000_000)).toBe('ringing_out');
  });
});

describe('CallsHub', () => {
  it('shows the idle discovery copy without auto-joining', () => {
    const { onOpenRooms, onReturnToCall } = renderHub();

    expect(
      screen.getByRole('heading', { name: 'Talk where the conversation already lives.' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent(/Idle.*Pre-join/i);
    expect(screen.getByRole('button', { name: 'Choose a room' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to call' })).toBeNull();
    expect(document.querySelector('[data-call-presentation="idle"]')).not.toBeNull();
    expect(onOpenRooms).not.toHaveBeenCalled();
    expect(onReturnToCall).not.toHaveBeenCalled();
  });

  it('Choose a room only opens rooms collection (no join)', () => {
    const { onOpenRooms, onReturnToCall } = renderHub();

    fireEvent.click(screen.getByRole('button', { name: 'Choose a room' }));
    expect(onOpenRooms).toHaveBeenCalledTimes(1);
    expect(onReturnToCall).not.toHaveBeenCalled();
  });

  it('renders incoming ringing without Accept / established copy', () => {
    const { onOpenRooms, onReturnToCall } = renderHub({
      callState: 'ringing_in',
      callWith: 'alice',
      callChannel: null,
      callStartedAt: null,
    });

    expect(screen.getByRole('heading', { name: 'Incoming call' })).toBeInTheDocument();
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent(/Incoming/i);
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent('alice');
    expect(screen.getByText(/never answers for you/i)).toBeInTheDocument();
    expect(screen.queryByText(/established/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return to call' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose a room' })).toBeInTheDocument();
    expect(document.querySelector('[data-call-presentation="ringing_in"]')).not.toBeNull();
    expect(onOpenRooms).not.toHaveBeenCalled();
    expect(onReturnToCall).not.toHaveBeenCalled();
  });

  it('renders outgoing ringing without established copy', () => {
    renderHub({
      callState: 'ringing_out',
      callWith: 'bob',
      callChannel: null,
      callStartedAt: null,
    });

    expect(screen.getByRole('heading', { name: 'Calling…' })).toBeInTheDocument();
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent(/Outgoing/i);
    expect(screen.getByText(/will not pretend the call is established/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to call' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose a room' })).toBeInTheDocument();
    expect(document.querySelector('[data-call-presentation="ringing_out"]')).not.toBeNull();
  });

  it('renders provisional in_call (callStartedAt null) without established label', () => {
    const { onReturnToCall } = renderHub({
      callState: 'in_call',
      callChannel: '#lounge',
      callWith: '',
      callStartedAt: null,
    });

    expect(screen.getByRole('heading', { name: 'Connecting to the call…' })).toBeInTheDocument();
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent(/Connecting/i);
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent('#lounge');
    expect(screen.getByText(/not established yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your call is still here.' })).toBeNull();
    expect(document.querySelector('[data-call-presentation="provisional"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Return to call' }));
    expect(onReturnToCall).toHaveBeenCalledWith('#lounge');
  });

  it('when a call is established, offers return without starting a new call', () => {
    const onOpenRooms = vi.fn();
    const onReturnToCall = vi.fn();

    renderHub({
      callState: 'in_call',
      callChannel: '#lounge',
      callWith: '',
      callStartedAt: Date.now(),
      onOpenRooms,
      onReturnToCall,
    });

    expect(
      screen.getByRole('heading', { name: 'Your call is still here.' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('calls-hub-status')).toHaveTextContent(/In call/i);
    expect(document.querySelector('[data-call-presentation="established"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to call' }));
    expect(onReturnToCall).toHaveBeenCalledWith('#lounge');
    expect(onOpenRooms).not.toHaveBeenCalled();
  });

  it('provisional without a channel falls back to Choose a room (no invent join)', () => {
    const { onOpenRooms, onReturnToCall } = renderHub({
      callState: 'in_call',
      callChannel: null,
      callWith: '',
      callStartedAt: null,
    });

    expect(screen.getByRole('heading', { name: 'Connecting to the call…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to call' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a room' }));
    expect(onOpenRooms).toHaveBeenCalledTimes(1);
    expect(onReturnToCall).not.toHaveBeenCalled();
  });

  it('never exposes join/accept/start controls for any presentation', () => {
    const states: Array<{ callState: CallState; callStartedAt: number | null; channel: string | null }> = [
      { callState: 'idle', callStartedAt: null, channel: null },
      { callState: 'ringing_in', callStartedAt: null, channel: '#x' },
      { callState: 'ringing_out', callStartedAt: null, channel: '#x' },
      { callState: 'in_call', callStartedAt: null, channel: '#x' },
      { callState: 'in_call', callStartedAt: 99, channel: '#x' },
    ];

    for (const row of states) {
      const { unmount } = renderHub({
        callState: row.callState,
        callChannel: row.channel,
        callStartedAt: row.callStartedAt,
        callWith: row.callState.startsWith('ringing') ? 'peer' : '',
      });
      expect(screen.queryByRole('button', { name: /accept|join|start/i })).toBeNull();
      unmount();
    }
  });

  it('explains that the hub is not a media surface', () => {
    renderHub();
    expect(screen.getByRole('note')).toHaveTextContent(/does not join or start a call/i);
    expect(screen.getByText(/Controls belong to the room/i)).toBeInTheDocument();
  });
});
