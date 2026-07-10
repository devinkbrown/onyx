import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import { CaptionsOverlay } from './CaptionsOverlay';
import { IncomingCallOverlay } from './IncomingCallOverlay';
import { OutgoingCallOverlay } from './OutgoingCallOverlay';
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

  it('shows an outgoing call and cancels through the store action', () => {
    store.getState().setVoiceCallState({ callState: 'ringing_out', callWith: 'Mina' });
    const endSpy = vi.spyOn(store.getState(), 'endDmCall');

    render(() => <OutgoingCallOverlay />);

    expect(screen.getByRole('dialog', { name: 'Calling' })).toBeTruthy();
    expect(screen.getByText('Mina')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /cancel call to mina/i }));

    expect(endSpy).toHaveBeenCalledTimes(1);
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
    // Captions are now opt-in (VoiceBar toggle) — enable them for this render.
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    expect(screen.getByRole('log', { name: 'Live captions' })).toBeTruthy();
    expect(screen.getByLabelText(/Live captions provenance: This server/i)).toBeTruthy();
    expect(screen.getByText('Aki')).toBeTruthy();
    expect(screen.getByText('Signal is clean.')).toBeTruthy();
    expect(screen.getByText('Moving to the relay room.')).toBeTruthy();
  });

  it('scopes the live-caption log to caption text, keeping toolbar controls out of the announced region', () => {
    const mediaTranscripts = new Map([
      ['#voice', [{ nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') }]],
    ]);
    store.setState({ mediaTranscripts });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    const log = screen.getByRole('log', { name: 'Live captions' });
    // Caption text is inside the announced region.
    expect(within(log).getByText('Signal is clean.')).toBeTruthy();
    // The Copy-transcript control must live OUTSIDE the live region, so activating
    // it (or its appearance) is never announced as new caption activity.
    expect(within(log).queryByRole('button', { name: 'Copy live caption transcript' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy live caption transcript' })).toBeTruthy();
  });

  it('copies the current live caption transcript', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    });
    const mediaTranscripts = new Map([
      [
        '#voice',
        [
          { nick: 'Aki', text: 'Signal is clean.', time: new Date('2026-06-19T12:00:00Z') },
          { nick: 'Mina', text: 'Moving to the relay room.', time: new Date('2026-06-19T12:00:02Z') },
          { nick: 'Noa', text: 'I have the bridge notes.', time: new Date('2026-06-19T12:00:04Z') },
          { nick: 'Ren', text: 'Copy the whole transcript.', time: new Date('2026-06-19T12:00:06Z') },
        ],
      ],
    ]);
    store.setState({ mediaTranscripts });
    store.getState().setVoiceCallState({ callState: 'in_call', callChannel: '#voice', captionsEnabled: true });

    render(() => <CaptionsOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy live caption transcript' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain('Aki: Signal is clean.');
    expect(copied).toContain('Ren: Copy the whole transcript.');
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('shows the PIP only while in voice and off the active channel', () => {
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      ourNick: 'onyx',
      speakingNicks: new Set(['Mina']),
      voiceChannelParticipants: new Map([['#voice', new Set(['onyx', 'Mina'])]]),
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
