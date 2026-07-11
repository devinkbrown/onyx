// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo } from 'solid-js';

import { Avatar, Button, ModalShell } from '@/primitives';
import { getState, useStore, type State } from '@/lib/store';

import './voice-overlays.css';

type VoiceActionAliases = {
  acceptIncomingCall?: () => void;
  rejectCall?: (nick: string) => void;
};

function currentState() {
  return getState() as State & VoiceActionAliases;
}

function acceptCall() {
  const state = currentState();
  if (typeof state.acceptIncomingCall === 'function') {
    state.acceptIncomingCall();
    return;
  }
  state.acceptDmCall();
}

function declineCall(caller: string) {
  const state = currentState();
  if (typeof state.rejectCall === 'function') {
    state.rejectCall(caller);
    return;
  }
  state.rejectDmCall();
}

function PhoneIncomingIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19h4v-6H3v4a2 2 0 0 0 2 2Z" fill="currentColor" opacity="0.24" />
      <path d="M9 19c6 0 10-4 10-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      <path d="M15 9h4V5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

function PhoneDeclineIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6l14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      <path d="M5 17h4l1-4-3-2-3 2v2a2 2 0 0 0 1 2Z" fill="currentColor" opacity="0.24" />
      <path d="M5 17h4l1-4-3-2-3 2v2a2 2 0 0 0 1 2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
      <path d="M15 8c2 1 3 3 3 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

export function IncomingCallOverlay() {
  const voice = useStore((state) => state.voice);
  const open = createMemo(() => voice().callState === 'ringing_in');
  const caller = createMemo(() => voice().callWith.trim() || 'Unknown caller');

  return (
    <ModalShell
      open={open()}
      title="Incoming call"
      description="Voice request over the media mesh."
      closeLabel="Decline call"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) declineCall(caller());
      }}
    >
      <div class="voice-call-body" data-testid="incoming-call-overlay">
        <div class="voice-call-token" aria-hidden="true">
          <Avatar name={caller()} />
        </div>
        <div class="voice-call-meta">
          <p class="voice-call-kicker">calling</p>
          <p class="voice-call-name">{caller()}</p>
          <p class="voice-call-subtext">Answer to join the voice session.</p>
        </div>
        <div class="voice-call-actions">
          <Button variant="danger" onClick={() => declineCall(caller())} aria-label={`Decline call from ${caller()}`}>
            <PhoneDeclineIcon />
            Decline
          </Button>
          <Button variant="primary" onClick={acceptCall} aria-label={`Accept call from ${caller()}`}>
            <PhoneIncomingIcon />
            Accept
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export default IncomingCallOverlay;
