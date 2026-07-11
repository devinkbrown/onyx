// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { Avatar, Button, Tooltip } from '@/primitives';
import { getState, useStore } from '@/lib/store';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';

import './overlays/voice-overlays.css';

type PipPosition = {
  x: number;
  y: number;
};

type PipParticipant = {
  nick: string;
  speaking: boolean;
  muted: boolean;
  self: boolean;
};

const storageKey = 'onyx-voice-pip-position';
const margin = 12;

function viewportSize() {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function fallbackPosition() {
  const viewport = viewportSize();
  return {
    x: Math.max(margin, viewport.width - 340),
    y: Math.max(margin, viewport.height - 190),
  };
}

function readPosition(): PipPosition {
  if (typeof window === 'undefined') return fallbackPosition();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '') as Partial<PipPosition>;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    return fallbackPosition();
  }
  return fallbackPosition();
}

function savePosition(position: PipPosition) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(position));
  } catch {}
}

function participantFromPeer(peer: SuimyakuPeerState, selfNick: string, speakingNicks: Set<string>): PipParticipant {
  return {
    nick: peer.nick,
    speaking: peer.speaking || speakingNicks.has(peer.nick),
    muted: peer.muted,
    self: peer.nick.toLowerCase() === selfNick.toLowerCase(),
  };
}

function callStateIsLive(callState: string) {
  return callState !== 'idle' && callState !== 'ringing_in' && callState !== 'ringing_out';
}

function targetMatchesActive(
  target: string,
  activeView: ReturnType<typeof getState>['activeView'],
  isChannel: boolean,
) {
  if (isChannel) {
    return activeView.kind === 'channel' && activeView.channel.toLowerCase() === target.toLowerCase();
  }
  return activeView.kind === 'dm' && activeView.nick.toLowerCase() === target.toLowerCase();
}

function MicIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0V6Z" fill="currentColor" opacity="0.24" />
      <path d="M8 6a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0V6Z" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4M9 22h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-4 2.83" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M6 11a6 6 0 0 0 10 4.47M12 18v4M9 22h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg class="voice-call-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6l14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      <path d="M5 17h4l1-4-3-2-3 2v2a2 2 0 0 0 1 2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
      <path d="M15 8c2 1 3 3 3 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
    </svg>
  );
}

export function VoicePip() {
  const state = useStore((storeState) => ({
    activeView: storeState.activeView,
    voice: storeState.voice,
    ourNick: storeState.ourNick,
    speakingNicks: storeState.speakingNicks,
    voiceChannelParticipants: storeState.voiceChannelParticipants,
  }));

  const [position, setPosition] = createSignal<PipPosition>(readPosition());
  const [dragging, setDragging] = createSignal(false);
  let pipRef: HTMLElement | undefined;
  let dragOffset = { x: 0, y: 0 };
  let visibleLastFrame = false;

  const target = createMemo(() => state().voice.callChannel ?? state().voice.callWith.trim());
  const isChannel = createMemo(() => Boolean(state().voice.callChannel));
  const isVisible = createMemo(() => {
    const callState = state().voice.callState as string;
    const callTarget = target();
    if (!callTarget || !callStateIsLive(callState)) return false;
    return !targetMatchesActive(callTarget, state().activeView, isChannel());
  });

  const clamp = (next: PipPosition) => {
    const viewport = viewportSize();
    const rect = pipRef?.getBoundingClientRect();
    const width = rect?.width || 320;
    const height = rect?.height || 168;
    return {
      x: Math.min(Math.max(margin, next.x), Math.max(margin, viewport.width - width - margin)),
      y: Math.min(Math.max(margin, next.y), Math.max(margin, viewport.height - height - margin)),
    };
  };

  const moveTo = (next: PipPosition, persist = false) => {
    const clamped = clamp(next);
    setPosition(clamped);
    if (persist) savePosition(clamped);
  };

  const participants = createMemo<PipParticipant[]>(() => {
    const current = state();
    const voice = current.voice;
    const selfNick = current.ourNick || 'You';
    const seen = new Set<string>();
    const collected: PipParticipant[] = [];

    const add = (participant: PipParticipant) => {
      const key = participant.nick.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      collected.push(participant);
    };

    add({
      nick: selfNick,
      speaking: current.speakingNicks.has(selfNick),
      muted: voice.muted,
      self: true,
    });

    for (const peer of voice.peers.values()) {
      add(participantFromPeer(peer, selfNick, current.speakingNicks));
    }

    if (voice.callChannel) {
      const inRoom = current.voiceChannelParticipants.get(voice.callChannel.toLowerCase());
      for (const nick of inRoom ?? []) {
        add({
          nick,
          speaking: current.speakingNicks.has(nick),
          muted: false,
          self: nick.toLowerCase() === selfNick.toLowerCase(),
        });
      }
    } else if (voice.callWith) {
      add({
        nick: voice.callWith,
        speaking: current.speakingNicks.has(voice.callWith),
        muted: false,
        self: false,
      });
    }

    return collected.sort((a, b) => Number(b.speaking) - Number(a.speaking)).slice(0, 8);
  });

  const hiddenParticipantCount = createMemo(() => Math.max(0, participants().length - 5));
  const visibleParticipants = createMemo(() => participants().slice(0, 5));
  const speakingCount = createMemo(() => participants().filter((participant) => participant.speaking).length);

  createEffect(() => {
    const nextVisible = isVisible();
    if (nextVisible && !visibleLastFrame) {
      moveTo(position(), true);
    }
    visibleLastFrame = nextVisible;
  });

  createEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => moveTo(position(), true);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !pipRef) return;
    const rect = pipRef.getBoundingClientRect();
    dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging()) return;
    moveTo({
      x: event.clientX - dragOffset.x,
      y: event.clientY - dragOffset.y,
    });
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging()) return;
    setDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {}
    savePosition(position());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    const current = position();
    let next: PipPosition | null = null;
    if (event.key === 'ArrowLeft') next = { ...current, x: current.x - step };
    if (event.key === 'ArrowRight') next = { ...current, x: current.x + step };
    if (event.key === 'ArrowUp') next = { ...current, y: current.y - step };
    if (event.key === 'ArrowDown') next = { ...current, y: current.y + step };
    if (!next) return;
    event.preventDefault();
    moveTo(next, true);
  };

  const leave = () => {
    const current = getState();
    if (current.voice.callChannel) {
      current.leaveVoiceChannel();
      return;
    }
    current.endDmCall();
  };

  return (
    <Show when={isVisible()}>
      <section
        ref={pipRef}
        class="voice-pip"
        data-dragging={dragging() ? 'true' : 'false'}
        role="region"
        aria-label={`Mini voice view for ${target()}`}
        tabindex="0"
        style={{ '--voice-pip-x': `${position().x}px`, '--voice-pip-y': `${position().y}px` }}
        onKeyDown={onKeyDown}
        data-testid="voice-pip"
      >
        <div
          class="voice-pip__handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div class="voice-pip__title">
            <span class="voice-pip__kicker">{isChannel() ? 'voice room' : 'voice call'}</span>
            <span class="voice-pip__target">{target()}</span>
          </div>
          <span class="voice-pip__status" aria-label={`${speakingCount()} speaking`}>
            {speakingCount() > 0 ? `${speakingCount()} live` : 'live'}
          </span>
        </div>

        <div class="voice-pip__body">
          <div class="voice-pip__participants" aria-label={`${participants().length} voice participants`}>
            <For each={visibleParticipants()}>
              {(participant) => (
                <Tooltip
                  content={`${participant.nick}${participant.speaking ? ' is speaking' : ''}${participant.muted ? ' is muted' : ''}`}
                >
                  <span
                    class="voice-pip__participant"
                    data-speaking={participant.speaking ? 'true' : 'false'}
                    data-muted={participant.muted ? 'true' : 'false'}
                  >
                    <Avatar name={participant.self ? 'You' : participant.nick} size="sm" owner={participant.self} />
                  </span>
                </Tooltip>
              )}
            </For>
            <Show when={hiddenParticipantCount() > 0}>
              <span class="voice-pip__more">+{hiddenParticipantCount()}</span>
            </Show>
          </div>

          <div class="voice-pip__actions">
            <Button
              variant={state().voice.muted ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => getState().toggleMute()}
              aria-pressed={state().voice.muted ? 'true' : 'false'}
            >
              <Show when={state().voice.muted} fallback={<MicIcon />}>
                <MutedIcon />
              </Show>
              {state().voice.muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button variant="danger" size="sm" onClick={leave}>
              <LeaveIcon />
              Leave
            </Button>
          </div>
        </div>
      </section>
    </Show>
  );
}

export default VoicePip;
