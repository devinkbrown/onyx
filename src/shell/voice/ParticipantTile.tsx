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
 *   - Speaking ring: gold border + box-shadow when speaking === true
 *   - Role badge: owner (~·q = gold), op (@·o = lapis), voice (+·v = green)
 *     resolved from the channel's ChannelUser.modes Set
 *   - Mute / deafen icons
 *   - Nick label + animated speaking bars
 */

import { createEffect, createMemo, onCleanup, Show, splitProps, type JSX } from 'solid-js';
import { Avatar } from '@/primitives';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
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
  /** True if this tile shows the active screenshare */
  isScreenshare?: boolean;
  /** Channel user entry, for role badge */
  channelUser: ChannelUser | undefined;
  /** Local muted override (used for self tile) */
  muted?: boolean;
  /** Local deafened override (used for self tile) */
  deafened?: boolean;
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
    'nick', 'peer', 'stream', 'isSelf', 'isScreenshare', 'channelUser', 'muted', 'deafened', 'class',
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
    local.isSelf ? false : (local.peer?.speaking ?? false)
  );

  const isMuted = createMemo(() =>
    local.muted ?? local.peer?.muted ?? false
  );

  const isDeafened = createMemo(() => local.deafened ?? false);

  const hasVideo = createMemo(() => !!local.stream);

  const role = createMemo(() => resolveRole(local.channelUser));

  const tileClass = createMemo(() => [
    'voice-tile',
    speaking() ? 'voice-tile--speaking' : '',
    local.isSelf ? 'voice-tile--self' : '',
    local.isScreenshare ? 'voice-tile--screenshare' : '',
    local.class ?? '',
  ].filter(Boolean).join(' '));

  const displayNick = createMemo(() => local.nick.replace(/^[~@+.%]+/, ''));

  const ariaLabel = createMemo(() => {
    const parts: string[] = [displayNick()];
    if (local.isSelf) parts.push('(you)');
    if (speaking()) parts.push('speaking');
    if (isMuted()) parts.push('muted');
    return parts.join(', ');
  });

  return (
    <div
      {...rest}
      class={tileClass()}
      role="group"
      aria-label={ariaLabel()}
      data-testid="participant-tile"
      data-nick={local.nick}
      data-speaking={speaking() ? 'true' : undefined}
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
        </div>
      </Show>

      {/* Screenshare label */}
      <Show when={local.isScreenshare}>
        <span class="voice-tile__screen-label" aria-hidden="true">[SCREEN]</span>
      </Show>

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

        {/* Mute / deafen badges */}
        <span class="voice-tile__badges">
          <Show when={isMuted()}>
            <span class="voice-tile__badge voice-tile__badge--muted" title="Muted">[M]</span>
          </Show>
          <Show when={isDeafened()}>
            <span class="voice-tile__badge voice-tile__badge--deaf" title="Deafened">[D]</span>
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
