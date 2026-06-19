import { createMemo } from 'solid-js';

import { Avatar, Button, ModalShell } from '@/primitives';
import { getState, useStore, type State } from '@/lib/store';

import './voice-overlays.css';

type VoiceActionAliases = {
  hangup?: (nick?: string) => void;
};

function cancelCall(callee: string) {
  const state = getState() as State & VoiceActionAliases;
  if (typeof state.hangup === 'function') {
    state.hangup(callee);
    return;
  }
  state.endDmCall();
}

function PhoneOutgoingIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19h4v-6H3v4a2 2 0 0 0 2 2Z" fill="currentColor" opacity="0.24" />
      <path d="M9 19c6 0 10-4 10-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      <path d="M15 5h4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

function PhoneCancelIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6l14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      <path d="M5 17h4l1-4-3-2-3 2v2a2 2 0 0 0 1 2Z" fill="currentColor" opacity="0.24" />
      <path d="M5 17h4l1-4-3-2-3 2v2a2 2 0 0 0 1 2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
      <path d="M15 8c2 1 3 3 3 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

export function OutgoingCallOverlay() {
  const voice = useStore((state) => state.voice);
  const open = createMemo(() => voice().callState === 'ringing_out');
  const callee = createMemo(() => voice().callWith.trim() || 'Unknown recipient');

  return (
    <ModalShell
      open={open()}
      title="Calling"
      description="Waiting for a voice response."
      closeLabel="Cancel call"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) cancelCall(callee());
      }}
    >
      <div class="voice-call-body" data-testid="outgoing-call-overlay">
        <div class="voice-call-token voice-call-token--outgoing" aria-hidden="true">
          <Avatar name={callee()} />
        </div>
        <div class="voice-call-meta" aria-live="polite">
          <p class="voice-call-kicker">dialing</p>
          <p class="voice-call-name">{callee()}</p>
          <p class="voice-call-subtext">
            <PhoneOutgoingIcon />
            Waiting for them to answer.
          </p>
        </div>
        <div class="voice-call-actions">
          <Button variant="danger" onClick={() => cancelCall(callee())} aria-label={`Cancel call to ${callee()}`}>
            <PhoneCancelIcon />
            Cancel
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export default OutgoingCallOverlay;
