import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import { CaptionsOverlay } from './CaptionsOverlay';
import { IncomingCallOverlay } from './IncomingCallOverlay';
import { VoicePip } from '../VoicePip';

const initialState = store.getInitialState();

function peer(nick: string, speaking = false): SuimyakuPeerState {
  return {
    nick,
    channel: '#voice',
    kind: 'voice',
    speaking,
    muted: false,
    hasVideo: false,
    canvas: null,
  };
}

describe('voice overlays', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.setState(initialState, true);
    window.localStorage.clear();
  });

  it('shows an incoming call and accepts through the store action', () => {
    store.getState().setVoiceCallState({ callState: 'ringing_in', callWith: 'Lapis' });
    const acceptSpy = vi.spyOn(store.getState(), 'acceptDmCall');

    render(() => <IncomingCallOverlay />);

    expect(screen.getByRole('dialog', { name: 'Incoming call' })).toBeTruthy();
    expect(screen.getByText('Lapis')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /accept call from lapis/i }));

    expect(acceptSpy).toHaveBeenCalledTimes(1);
  });

  it('renders seeded live captions for the current voice channel', () => {
    const mediaTranscripts = new Map([
      [
        '#voice',
        [
          { nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') },
          { nick: 'Mina', text: 'Moving to the relay room.', time: new Date('2026-06-19T12:00:02Z') },
        ],
      ],
    ]);
    store.setState({ mediaTranscripts });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice' });

    render(() => <CaptionsOverlay />);

    expect(screen.getByRole('log', { name: 'Live captions' })).toBeTruthy();
    expect(screen.getByText('Aki')).toBeTruthy();
    expect(screen.getByText('Signal is clean.')).toBeTruthy();
    expect(screen.getByText('Moving to the relay room.')).toBeTruthy();
  });

  it('shows the PIP only while in voice and off the active channel', () => {
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'ruri',
      speakingNicks: new Set(['Mina']),
      voiceChannelParticipants: new Map([['#voice', new Set(['ruri', 'Mina'])]]),
    });
    store.getState().setVoiceCallState({
      callState: 'in_call',
      callChannel: '#voice',
      peers: new Map([['Mina', peer('Mina', true)]]),
    });

    render(() => <VoicePip />);

    expect(screen.getByTestId('voice-pip')).toBeTruthy();
    expect(screen.getByText('#voice')).toBeTruthy();

    store.setState({ activeView: { kind: 'channel', channel: '#voice' } });

    expect(screen.queryByTestId('voice-pip')).toBeNull();
  });
});
