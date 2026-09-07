// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CallsHub — public product-frame surface for voice/video discovery.
 *
 * Opening this hub must NEVER join, accept, start, or otherwise mutate a call.
 * Live call surfaces still begin only from explicit Join / accept controls
 * elsewhere (room ribbon, ring overlays). This hub only navigates:
 *   - Choose a room → parent opens the Rooms collection
 *   - Return to call → parent navigates to the call channel (in_call only)
 *
 * Presentation is truthful about voice lifecycle:
 *   idle | ringing_in | ringing_out | provisional in_call | established in_call
 * Ringing and provisional states are never labeled "established".
 *
 * SOLID IDIOMS: never destructure props; read props inside JSX/handlers.
 */

import './calls-hub.css';

import { Show, createMemo, type JSX } from 'solid-js';
import type { CallState } from '@/lib/cadence-media/types';

export type CallsHubProps = {
  /** Live voice call lifecycle from the store (read-only). */
  callState: CallState;
  /** Channel for an active channel call, when known. */
  callChannel: string | null;
  /** Peer nick for DM / 1:1 ring surfaces, when known. */
  callWith: string;
  /**
   * Epoch ms the call became established, or null while idle / ringing /
   * provisional in_call (media path not yet started).
   */
  callStartedAt: number | null;
  onOpenRooms: () => void;
  /** Navigate back to the call channel — never joins or mutates voice state. */
  onReturnToCall: (channel: string) => void;
};

export type CallsHubPresentation =
  | 'idle'
  | 'ringing_in'
  | 'ringing_out'
  | 'provisional'
  | 'established';

/** Pure classifier — tests and UI share the same truth table. */
export function classifyCallsHubPresentation(
  callState: CallState,
  callStartedAt: number | null,
): CallsHubPresentation {
  if (callState === 'ringing_in') return 'ringing_in';
  if (callState === 'ringing_out') return 'ringing_out';
  if (callState === 'in_call') {
    return callStartedAt == null ? 'provisional' : 'established';
  }
  return 'idle';
}

export function CallsHub(props: CallsHubProps): JSX.Element {
  const presentation = createMemo(() =>
    classifyCallsHubPresentation(props.callState, props.callStartedAt),
  );

  const roomLabel = createMemo(() => {
    const channel = props.callChannel?.trim();
    if (channel) return channel;
    const peer = props.callWith.trim();
    if (peer) return peer;
    return null;
  });

  const title = createMemo(() => {
    switch (presentation()) {
      case 'ringing_in':
        return 'Incoming call';
      case 'ringing_out':
        return 'Calling…';
      case 'provisional':
        return 'Connecting to the call…';
      case 'established':
        return 'Your call is still here.';
      default:
        return 'Talk where the conversation already lives.';
    }
  });

  const intro = createMemo(() => {
    const where = roomLabel();
    switch (presentation()) {
      case 'ringing_in':
        return where
          ? `Someone is calling you${where.startsWith('#') ? ` in ${where}` : ` — ${where}`}. Accept or decline from the call controls; this screen never answers for you.`
          : 'Someone is calling you. Accept or decline from the call controls; this screen never answers for you.';
      case 'ringing_out':
        return where
          ? `Ringing ${where}. Stay here or keep browsing — Onyx will not pretend the call is established until it connects.`
          : 'Your outgoing call is still ringing. Onyx will not pretend the call is established until it connects.';
      case 'provisional':
        return where
          ? `Joining ${where}. Media is not established yet — connection status stays honest while the session starts.`
          : 'Joining the call. Media is not established yet — connection status stays honest while the session starts.';
      case 'established':
        return where
          ? `Return to ${where} without losing your place in the room.`
          : 'Return to your live call without losing your place in the room.';
      default:
        return 'Voice and video begin inside a room, so people arrive with the same context before, during, and after the call.';
    }
  });

  const statusLabel = createMemo(() => {
    switch (presentation()) {
      case 'ringing_in':
        return 'Incoming';
      case 'ringing_out':
        return 'Outgoing';
      case 'provisional':
        return 'Connecting';
      case 'established':
        return 'In call';
      default:
        return 'Idle · Pre-join';
    }
  });

  const canReturn = createMemo(() => {
    const p = presentation();
    return (p === 'provisional' || p === 'established') && Boolean(props.callChannel?.trim());
  });

  return (
    <main
      class="shell-calls-hub"
      data-call-presentation={presentation()}
      aria-labelledby="shell-calls-title"
    >
      <div class="shell-calls-kicker">Calls</div>
      <p class="shell-calls-status" data-testid="calls-hub-status" aria-live="polite">
        <span class="shell-calls-status-pip" data-state={presentation()} aria-hidden="true" />
        <span>{statusLabel()}</span>
        <Show when={roomLabel()}>
          {(label) => <span class="shell-calls-status-where">{label()}</span>}
        </Show>
      </p>
      <h1 id="shell-calls-title">{title()}</h1>
      <p class="shell-calls-intro">{intro()}</p>

      <p class="shell-calls-truth" role="note">
        <strong>What happens next</strong>
        <span>
          {presentation() === 'established'
            ? ' Your call is active; use the room controls for microphone, camera, and captions.'
            : presentation() === 'provisional'
              ? ' The session is connecting. Media controls appear when the room confirms a connection.'
              : ' This page is a starting point. Choosing a room does not join or start a call.'}
        </span>
      </p>

      <Show
        when={canReturn()}
        fallback={(
          <button
            type="button"
            class="shell-calls-primary"
            onClick={() => props.onOpenRooms()}
          >
            Choose a room
          </button>
        )}
      >
        <button
          type="button"
          class="shell-calls-primary"
          onClick={() => {
            const channel = props.callChannel?.trim();
            if (channel) props.onReturnToCall(channel);
          }}
        >
          Return to call
        </button>
      </Show>

      <div class="shell-calls-proof" aria-label="Call details">
        <article>
          <span aria-hidden="true">Media</span>
          <h2>Voice and video</h2>
          <p>Controls belong to the room, where joining is explicit.</p>
        </article>
        <article>
          <span aria-hidden="true">Access</span>
          <h2>Live captions</h2>
          <p>Use captions when the live room makes them available.</p>
        </article>
        <article>
          <span aria-hidden="true">Status</span>
          <h2>Honest state</h2>
          <p>Onyx shows connection and protection status instead of hiding uncertainty.</p>
        </article>
      </div>
    </main>
  );
}
