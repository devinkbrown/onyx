// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { Avatar, Button, ModalShell } from '@/primitives';
import { getState, useStore, type State } from '@/lib/store';

import './voice-overlays.css';

type VoiceActionAliases = {
  acceptIncomingCall?: () => void | Promise<void>;
  rejectCall?: (nick: string) => void;
};

function currentState() {
  return getState() as State & VoiceActionAliases;
}

function acceptCall(): void | Promise<void> {
  const state = currentState();
  if (typeof state.acceptIncomingCall === 'function') {
    return state.acceptIncomingCall();
  }
  return state.acceptDmCall();
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
  const [accepting, setAccepting] = createSignal(false);
  const [acceptError, setAcceptError] = createSignal<string | null>(null);
  let callEpoch = 0;
  let observedCall = '';
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    callEpoch += 1;
  });

  createEffect(() => {
    const nextCall = open() ? caller() : '';
    if (nextCall === observedCall) return;
    observedCall = nextCall;
    callEpoch += 1;
    setAccepting(false);
    setAcceptError(null);
  });

  const handleAccept = () => {
    if (!open() || accepting()) return;

    const acceptedCaller = caller();
    const epoch = ++callEpoch;
    setAccepting(true);
    setAcceptError(null);

    const reportFailure = () => {
      if (disposed || epoch !== callEpoch || !open() || caller() !== acceptedCaller) return;
      setAccepting(false);
      setAcceptError(`Could not accept the call from ${acceptedCaller}. Try again.`);
    };

    try {
      const result = acceptCall();
      if (result) void result.catch(reportFailure);
    } catch {
      reportFailure();
    }
  };

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
        <div class="voice-call-meta" aria-busy={accepting()}>
          <p class="voice-call-kicker">calling</p>
          <p class="voice-call-name">{caller()}</p>
          <p class="voice-call-subtext">Answer to join the voice session.</p>
          <Show when={accepting()}>
            <p class="voice-call-status" role="status">Accepting call from {caller()}…</p>
          </Show>
          <Show when={acceptError()}>
            {(error) => <p class="voice-call-error" role="alert">{error()}</p>}
          </Show>
        </div>
        <div class="voice-call-actions">
          <Button variant="danger" onClick={() => declineCall(caller())} aria-label={`Decline call from ${caller()}`}>
            <PhoneDeclineIcon />
            Decline
          </Button>
          <Button
            variant="primary"
            onClick={handleAccept}
            disabled={accepting()}
            aria-label={`Accept call from ${caller()}`}
          >
            <PhoneIncomingIcon />
            {accepting() ? 'Accepting…' : 'Accept'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export default IncomingCallOverlay;
