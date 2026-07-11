// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ParticipantTile — one voice/video participant in the call stage.
 *
 * Renders a 16:9 aspect-ratio tile. When the participant has video (hasVideo)
 * and a live MediaStream is available, a <video> element is mounted and its
 * srcObject is set via a createEffect ref — never as a prop attribute — so
 * the DOM assignment happens after the element is in the tree. Tracks are
 * stopped on unmount via onCleanup.
 *
 * Fallback: Avatar (from @/primitives) when no video stream is present.
 *
 * Overlays:
 *   - Speaking ring: bioluminescent azure border + glow when speaking === true
 *   - Role badge: owner (~·q = champagne), op (@·o = azure), voice (+·v = green)
 *     resolved from the channel's ChannelUser.modes Set
 *   - Raised-hand badge: when handRaised === true (self) or peer is in raisedHands
 *   - Pin / spotlight affordance: hover button → onPin(nick) sets the store pin
 *   - Connection-quality pips: rendered only when a `quality` tier is supplied
 *   - Mute / deafen / camera-off icons
 *   - Nick label + animated speaking bars
 */

import { For, createEffect, createMemo, onCleanup, Show, splitProps, type JSX } from 'solid-js';
import { Avatar } from '@/primitives';
import { CameraOffIcon, MicOffIcon, DeafenIcon } from './icons';
import type { NetworkQualityTier, SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import type { ChannelUser } from '@/lib/irc/types';

export type ParticipantTileProps = {
  /** IRC nick of this participant */
  nick: string;
  /** Peer media state from store.voice.peers (null = local self tile) */
  peer: SuimyakuPeerState | null;
  /** Live MediaStream for video, or null if no video */
  stream: MediaStream | null;
  /** True for the local self tile */
  isSelf?: boolean;
  /**
   * Explicit speaking override. When provided it wins over the internal
   * derivation — used to reflect the shared speakingNicks state for the local
   * self tile (which otherwise has no per-peer `speaking` flag to read).
   */
  speaking?: boolean;
  /** True if this tile shows the active screenshare */
  isScreenshare?: boolean;
  /** Channel user entry, for role badge */
  channelUser: ChannelUser | undefined;
  /** Local muted override (used for self tile) */
  muted?: boolean;
  /** Local deafened override (used for self tile) */
  deafened?: boolean;
  /** Raised-hand state for this participant */
  handRaised?: boolean;
  /** True when this tile is the pinned/spotlight participant */
  pinned?: boolean;
  /** Click handler for the pin affordance; absent = no pin button rendered */
  onPin?: (nick: string) => void;
  /**
   * Optional connection-quality tier (0 best → 3 worst). Rendered as a 3-pip
   * indicator only when supplied — peer state does not always carry this.
   */
  quality?: NetworkQualityTier;
  class?: string;
};

/** Determine role badge from ChannelUser modes. Returns null if no role. */
function resolveRole(channelUser: ChannelUser | undefined): { symbol: string; kind: 'owner' | 'op' | 'voice' } | null {
  if (!channelUser) return null;
  const m = channelUser.modes;
  if (m.has('q')) return { symbol: '~', kind: 'owner' };
  if (m.has('o')) return { symbol: '@', kind: 'op' };
  if (m.has('v')) return { symbol: '+', kind: 'voice' };
  return null;
}

const QUALITY_META: Record<NetworkQualityTier, { label: string; bars: number }> = {
  0: { label: 'Excellent', bars: 3 },
  1: { label: 'Good', bars: 3 },
  2: { label: 'Fair', bars: 2 },
  3: { label: 'Poor', bars: 1 },
};

function SpeakingBars(props: { active: boolean }) {
  return (
    <span
      class={`voice-tile__speaking-bars${props.active ? ' voice-tile__speaking-bars--active' : ''}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export function ParticipantTile(props: ParticipantTileProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'nick', 'peer', 'stream', 'isSelf', 'speaking', 'isScreenshare', 'channelUser',
    'muted', 'deafened', 'handRaised', 'pinned', 'onPin', 'quality', 'class',
  ]);

  let videoRef: HTMLVideoElement | undefined;

  // Bind stream to <video>.srcObject — never via attribute.
  // Runs whenever the stream changes, and cleans up the previous assignment.
  createEffect(() => {
    const el = videoRef;
    const s = local.stream;
    if (!el) return;
    el.srcObject = s ?? null;
    onCleanup(() => {
      if (el.srcObject) el.srcObject = null;
    });
  });

  const speaking = createMemo(() =>
    local.speaking ?? (local.isSelf ? false : (local.peer?.speaking ?? false))
  );

  const isMuted = createMemo(() =>
    local.muted ?? local.peer?.muted ?? false
  );

  const isDeafened = createMemo(() => local.deafened ?? false);

  const hasVideo = createMemo(() => !!local.stream);

  // Camera-off: a peer that declared video but has no live stream, or the
  // self tile with the camera explicitly off (no stream, not screensharing).
  const cameraOff = createMemo(() =>
    !hasVideo() && !local.isScreenshare && (local.peer?.hasVideo ?? false)
  );

  const role = createMemo(() => resolveRole(local.channelUser));

  const handRaised = createMemo(() => local.handRaised ?? false);

  const tileClass = createMemo(() => [
    'voice-tile',
    speaking() ? 'voice-tile--speaking' : '',
    local.isSelf ? 'voice-tile--self' : '',
    local.isScreenshare ? 'voice-tile--screenshare' : '',
    local.pinned ? 'voice-tile--pinned' : '',
    handRaised() ? 'voice-tile--hand' : '',
    local.class ?? '',
  ].filter(Boolean).join(' '));

  const displayNick = createMemo(() => local.nick.replace(/^[~@+.%]+/, ''));

  const ariaLabel = createMemo(() => {
    const parts: string[] = [displayNick()];
    if (local.isSelf) parts.push('(you)');
    if (handRaised()) parts.push('hand raised');
    if (speaking()) parts.push('speaking');
    if (isMuted()) parts.push('muted');
    if (cameraOff()) parts.push('camera off');
    if (local.quality !== undefined) parts.push(`${QUALITY_META[local.quality].label} connection`);
    return parts.join(', ');
  });

  const handlePin = (event: MouseEvent) => {
    event.stopPropagation();
    local.onPin?.(local.nick);
  };

  return (
    <div
      {...rest}
      class={tileClass()}
      role="group"
      aria-label={ariaLabel()}
      data-testid="participant-tile"
      data-nick={local.nick}
      data-speaking={speaking() ? 'true' : undefined}
      data-pinned={local.pinned ? 'true' : undefined}
      data-hand-raised={handRaised() ? 'true' : undefined}
    >
      {/* Video feed */}
      <Show when={hasVideo()}>
        <video
          ref={videoRef}
          class="voice-tile__video"
          autoplay
          muted
          playsinline
          aria-hidden="true"
          data-testid="tile-video"
        />
      </Show>

      {/* Avatar fallback */}
      <Show when={!hasVideo()}>
        <div class="voice-tile__avatar-wrap">
          <Avatar name={displayNick()} owner={role()?.kind === 'owner'} size="md" />
          <Show when={cameraOff()}>
            <span class="voice-tile__camera-off" aria-hidden="true">camera off</span>
          </Show>
        </div>
      </Show>

      {/* Screenshare label */}
      <Show when={local.isScreenshare}>
        <span class="voice-tile__screen-label" aria-hidden="true">[SCREEN]</span>
      </Show>

      {/* Top-right cluster: raised hand + connection quality + pin */}
      <div class="voice-tile__topbar">
        <Show when={handRaised()}>
          <span
            class="voice-tile__hand-badge"
            role="img"
            aria-label="Hand raised"
            data-testid="hand-badge"
            title="Hand raised"
          >
            ✋
          </span>
        </Show>

        <Show when={local.quality !== undefined}>
          <span
            class={`voice-tile__quality voice-tile__quality--t${local.quality}`}
            role="img"
            aria-label={`${QUALITY_META[local.quality!].label} connection`}
            data-testid="tile-quality"
            title={`${QUALITY_META[local.quality!].label} connection`}
          >
            <For each={[1, 2, 3] as const}>
              {(i) => <span class={i <= QUALITY_META[local.quality!].bars ? 'on' : 'off'} />}
            </For>
          </span>
        </Show>

        <Show when={local.onPin && !local.isScreenshare}>
          <button
            type="button"
            class="voice-tile__pin"
            aria-label={local.pinned ? `Unpin ${displayNick()}` : `Pin ${displayNick()} to spotlight`}
            aria-pressed={local.pinned ?? false}
            data-testid="pin-button"
            onClick={handlePin}
            title={local.pinned ? 'Unpin' : 'Pin to spotlight'}
          >
            <span aria-hidden="true">{local.pinned ? '◉' : '◎'}</span>
          </button>
        </Show>
      </div>

      {/* Bottom info bar */}
      <div class="voice-tile__bar" aria-hidden="true">
        {/* Speaking bars */}
        <SpeakingBars active={speaking() && !isMuted()} />

        {/* Nick */}
        <span class="voice-tile__nick">
          {displayNick()}
          <Show when={local.isSelf}>
            <span class="voice-tile__you-tag"> [you]</span>
          </Show>
        </span>

        {/* Mute / deafen / camera badges */}
        <span class="voice-tile__badges">
          <Show when={cameraOff()}>
            <span class="voice-tile__badge voice-tile__badge--cam" title="Camera off" aria-label="Camera off">
              <CameraOffIcon class="voice-tile__badge-icon" />
            </span>
          </Show>
          <Show when={isMuted()}>
            <span class="voice-tile__badge voice-tile__badge--muted" title="Muted" aria-label="Muted">
              <MicOffIcon class="voice-tile__badge-icon" />
            </span>
          </Show>
          <Show when={isDeafened()}>
            <span class="voice-tile__badge voice-tile__badge--deaf" title="Deafened" aria-label="Deafened">
              <DeafenIcon class="voice-tile__badge-icon" />
            </span>
          </Show>
        </span>

        {/* Role badge */}
        <Show when={role()} keyed>
          {(r) => (
            <span
              class={`voice-tile__role voice-tile__role--${r.kind}`}
              aria-label={r.kind}
              data-testid={`role-badge-${r.kind}`}
            >
              {r.symbol}
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}
