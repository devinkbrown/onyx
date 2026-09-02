// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * VoiceStage — the in-call participant surface.
 *
 * Three layout modes:
 *
 *   1. Screenshare (highest priority): the active screenshare gets a full
 *      primary tile; everyone else shrinks to a horizontal filmstrip below it.
 *
 *   2. Grid (callLayout === 'grid'): a responsive grid that adapts to the
 *      participant count.
 *        1 participant  → full-width single tile
 *        2              → 2-column side by side
 *        3-4            → 2×2 grid
 *        5-9            → 3 columns
 *        10+            → 4 columns (data-count="large")
 *
 *   3. Spotlight (callLayout === 'spotlight'): one large tile — the pinned
 *      participant, else the active speaker, else self — with a filmstrip of
 *      the rest. Auto-promotes the active speaker when nobody is pinned.
 *
 * Self tile: sourced from store.voice.localStream / cameraStream.
 * Peer tiles: merged case-insensitively from store.voice.peers and the room's
 *   server-propagated voice roster.
 * Video streams: resolved from store.voice.videoParticipants (peer) or
 *   store.voice.cameraStream / screenshareStream (self).
 * Channel users (for role badges): from store.channels.get(callChannel).
 *
 * Renders calm over the app background — no heavyweight overlay.
 */

import { createEffect, createMemo, Index, onCleanup, Show } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import type { CallStageSize } from '@/lib/store';
import type { CadencePeerState } from '@/lib/cadence-media/types';
import { ParticipantTile } from './ParticipantTile';
import { CallStatusAnnouncer } from './CallStatusAnnouncer';
import { mergeVoiceParticipants } from './voiceParticipants';
import './voice.css';

/** A normalized participant — self or a remote peer — for layout passes. */
type Slot = {
  key: string;
  nick: string;
  peer: CadencePeerState | null;
  isSelf: boolean;
  stream: MediaStream | null;
  speaking: boolean;
  handRaised: boolean;
  muted: boolean;
};

export function VoiceStage() {
  const voice = useStore(s => s.voice);
  const channels = useStore(s => s.channels);
  const ourNick = useStore(s => s.ourNick);
  // Flat, peer-independent state from the server's MEDIA event plane — the ONLY
  // source for cross-node participants (their media never reaches this client).
  const speakingNicks = useStore(s => s.speakingNicks);
  const mutedNicks = useStore(s => s.mutedNicks);
  const voiceChannelParticipants = useStore(s => s.voiceChannelParticipants);

  const channelUsers = createMemo(() => {
    const ch = voice().callChannel;
    if (!ch) return undefined;
    return channels().get(ch.toLowerCase())?.users;
  });

  const userFor = (nick: string) => channelUsers()?.get(nick.toLowerCase());

  // Screenshare is active: self screenshare takes the primary slot
  const screenshareActive = createMemo(() => voice().screenshareActive && !!voice().screenshareStream);

  const isSpotlight = createMemo(() => voice().callLayout === 'spotlight' && !screenshareActive());

  // Resolve video stream for a peer
  const peerStream = (nick: string): MediaStream | null =>
    voice().videoParticipants.get(nick) ?? null;

  // Self stream: screenshare takes priority over camera
  const selfVideoStream = createMemo<MediaStream | null>(() => {
    const v = voice();
    if (v.screenshareActive && v.screenshareStream) return v.screenshareStream;
    if (v.cameraOn && v.cameraStream) return v.cameraStream;
    return null;
  });

  const selfNick = createMemo(() => ourNick() ?? 'you');

  const participants = createMemo(() => {
    const ch = voice().callChannel;
    const roster = ch ? voiceChannelParticipants().get(ch.toLowerCase()) : undefined;
    return mergeVoiceParticipants(selfNick(), voice().peers, roster);
  });

  // Event-plane nick sets are not guaranteed to preserve the same casing as a
  // decoded media peer. Normalize once per store update, then every slot lookup
  // uses the same case-insensitive key space as the participant union.
  const normalizedSpeakingNicks = createMemo(() =>
    new Set([...speakingNicks()].map(nick => nick.toLowerCase()))
  );
  const normalizedMutedNicks = createMemo(() =>
    new Set([...mutedNicks()].map(nick => nick.toLowerCase()))
  );
  const normalizedRaisedHands = createMemo(() =>
    new Set([...voice().raisedHands].map(nick => nick.toLowerCase()))
  );

  const hasNick = (nicks: ReadonlySet<string>, nick: string): boolean =>
    nicks.has(nick.toLowerCase());

  const selfSlot = createMemo<Slot>(() => ({
    key: '__self__',
    nick: selfNick(),
    peer: null,
    isSelf: true,
    stream: selfVideoStream(),
    speaking: hasNick(normalizedSpeakingNicks(), selfNick()),
    handRaised: voice().handRaised,
    muted: voice().muted,
  }));

  // One remote slot model powers grid, spotlight, and screenshare. Roster-only
  // members therefore remain visible even before a local media peer exists.
  const remoteSlots = createMemo<Slot[]>(() =>
    participants().filter(participant => !participant.isSelf).map(participant => ({
      key: participant.nick.toLowerCase(),
      nick: participant.nick,
      peer: participant.peer,
      isSelf: false,
      stream: participant.peer ? peerStream(participant.peer.nick) : null,
      speaking: (participant.peer?.speaking ?? false) || hasNick(normalizedSpeakingNicks(), participant.nick),
      handRaised: hasNick(normalizedRaisedHands(), participant.nick),
      muted: (participant.peer?.muted ?? false) || hasNick(normalizedMutedNicks(), participant.nick),
    }))
  );
  // Layouts use `<Index>` below because slot objects are intentionally rebuilt
  // as voice state changes. Keying `<For>` by those objects would remount every
  // tile and interrupt an unchanged video stream on mute/speaking/hand updates.
  const allSlots = createMemo<Slot[]>(() => [selfSlot(), ...remoteSlots()]);

  // Total participant count (self + media peers + roster-only members).
  const totalCount = createMemo(() => allSlots().length);

  const countAttr = createMemo(() => {
    const n = totalCount();
    if (n >= 10) return 'large';
    return String(n);
  });

  // Spotlight subject: pinned participant → active speaker → self.
  const spotlightSlot = createMemo<Slot>(() => {
    const slots = allSlots();
    const pinned = voice().pinnedParticipant;
    if (pinned) {
      const found = slots.find(s => s.nick === pinned);
      if (found) return found;
    }
    const speaker = remoteSlots().find(s => s.speaking);
    if (speaker) return speaker;
    return selfSlot();
  });

  const filmstripSlots = createMemo<Slot[]>(() =>
    allSlots().filter(s => s.key !== spotlightSlot().key)
  );

  const handlePin = (nick: string) => getState().pinParticipant(nick);

  // Video mode when self camera/screenshare is live or any peer has a decoded
  // video track. Audio-only stays a compact avatar strip — not a cut-off 16:9 tray.
  const hasLiveVideo = createMemo(() => {
    if (screenshareActive()) return true;
    if (voice().cameraOn && voice().cameraStream) return true;
    for (const stream of voice().videoParticipants.values()) {
      if (stream) return true;
    }
    return false;
  });

  const stageSize = createMemo(() => voice().stageSize ?? 'compact');

  const stageClass = createMemo(() => {
    const cls = ['voice-stage'];
    if (hasLiveVideo()) cls.push('voice-stage--video');
    else cls.push('voice-stage--audio');
    cls.push(`voice-stage--size-${stageSize()}`);
    if (screenshareActive()) cls.push('voice-stage--screenshare');
    else if (isSpotlight()) cls.push('voice-stage--spotlight');
    return cls.join(' ');
  });

  // Esc drops fullscreen so the chat chrome is reachable again.
  createEffect(() => {
    if (stageSize() !== 'fullscreen') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') getState().setCallStageSize('compact');
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const setSize = (size: CallStageSize) => getState().setCallStageSize(size);
  // Ready once the store marks the call started — stream can briefly be null
  // during a camera toggle without unmounting the whole stage.
  const callReady = createMemo(() => voice().callStartedAt !== null);

  return (
    <div
      class={stageClass()}
      aria-label={hasLiveVideo() ? 'Video call participants' : 'Voice call participants'}
      role="region"
      data-testid="voice-stage"
      data-mode={hasLiveVideo() ? 'video' : 'audio'}
      data-size={stageSize()}
      data-layout={screenshareActive() ? 'screenshare' : voice().callLayout}
    >
      {/* Size chrome — compact by default; expand / fullscreen on demand. */}
      <div class="voice-stage__chrome" role="toolbar" aria-label="Call stage size">
        <button
          type="button"
          class="voice-stage__size-btn"
          aria-label="Compact stage"
          aria-pressed={stageSize() === 'compact'}
          data-testid="stage-size-compact"
          onClick={() => setSize('compact')}
          title="Compact"
        >
          ▬
        </button>
        <button
          type="button"
          class="voice-stage__size-btn"
          aria-label="Expand stage"
          aria-pressed={stageSize() === 'expanded'}
          data-testid="stage-size-expanded"
          onClick={() => setSize('expanded')}
          title="Expand"
        >
          ▤
        </button>
        <button
          type="button"
          class="voice-stage__size-btn"
          aria-label={stageSize() === 'fullscreen' ? 'Exit fullscreen stage' : 'Fullscreen stage'}
          aria-pressed={stageSize() === 'fullscreen'}
          data-testid="stage-size-fullscreen"
          onClick={() => setSize(stageSize() === 'fullscreen' ? 'compact' : 'fullscreen')}
          title={stageSize() === 'fullscreen' ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {stageSize() === 'fullscreen' ? '↙' : '⛶'}
        </button>
      </div>
      {/* Polite roster announcements (joins/leaves) for screen-reader users — SC 4.1.3. */}
      <CallStatusAnnouncer />
      <Show
        when={callReady()}
        fallback={
          <p class="voice-stage__starting" role="status" data-testid="voice-stage-loading">
            Connecting…
          </p>
        }
      >
      <Show
        when={screenshareActive()}
        fallback={
          <Show
            when={isSpotlight()}
            fallback={
              /* ── Grid layout ── */
              <div class="voice-stage__grid" data-count={countAttr()}>
                <Index each={allSlots()}>
                  {(slot) => (
                    <ParticipantTile
                      nick={slot().nick}
                      peer={slot().peer}
                      stream={slot().stream}
                      isSelf={slot().isSelf}
                      speaking={slot().isSelf ? slot().speaking : undefined}
                      muted={slot().muted}
                      deafened={slot().isSelf ? voice().deafened : undefined}
                      handRaised={slot().handRaised}
                      pinned={voice().pinnedParticipant === slot().nick}
                      onPin={handlePin}
                      channelUser={userFor(slot().nick)}
                    />
                  )}
                </Index>
              </div>
            }
          >
            {/* ── Spotlight / active-speaker layout ── */}
            {/* Props are read through `spotlightSlot()` per attribute so the
                tile is created once and updated in place. Resolving the slot
                in a JSX expression body instead would make the whole subtree
                reactive: every speaking/mute tick rebuilds the slot object,
                which would recreate the tile and remount its <video>. */}
            <div class="voice-stage__primary" data-testid="spotlight-primary">
              <ParticipantTile
                nick={spotlightSlot().nick}
                peer={spotlightSlot().peer}
                stream={spotlightSlot().stream}
                isSelf={spotlightSlot().isSelf}
                speaking={spotlightSlot().isSelf ? spotlightSlot().speaking : undefined}
                muted={spotlightSlot().muted}
                deafened={spotlightSlot().isSelf ? voice().deafened : undefined}
                handRaised={spotlightSlot().handRaised}
                pinned={voice().pinnedParticipant === spotlightSlot().nick}
                onPin={handlePin}
                channelUser={userFor(spotlightSlot().nick)}
              />
            </div>

            <Show when={filmstripSlots().length > 0}>
              <div class="voice-stage__filmstrip" role="list" aria-label="Other participants">
                <Index each={filmstripSlots()}>
                  {(slot) => (
                    <ParticipantTile
                      nick={slot().nick}
                      peer={slot().peer}
                      stream={slot().stream}
                      isSelf={slot().isSelf}
                      speaking={slot().isSelf ? slot().speaking : undefined}
                      muted={slot().muted}
                      deafened={slot().isSelf ? voice().deafened : undefined}
                      handRaised={slot().handRaised}
                      pinned={voice().pinnedParticipant === slot().nick}
                      onPin={handlePin}
                      channelUser={userFor(slot().nick)}
                      class="voice-stage__filmstrip-tile"
                    />
                  )}
                </Index>
              </div>
            </Show>
          </Show>
        }
      >
        {/* ── Screenshare layout: large primary + filmstrip ── */}
        <div class="voice-stage__primary">
          <ParticipantTile
            nick={selfNick()}
            peer={null}
            stream={voice().screenshareStream}
            isSelf
            isScreenshare
            muted={voice().muted}
            deafened={voice().deafened}
            channelUser={userFor(selfNick())}
          />
        </div>

        <div class="voice-stage__filmstrip" role="list" aria-label="Other participants">
          {/* Self camera tile in filmstrip (if camera on) */}
          <Show when={voice().cameraOn && voice().cameraStream}>
            <ParticipantTile
              nick={selfNick()}
              peer={null}
              stream={voice().cameraStream}
              isSelf
              speaking={hasNick(normalizedSpeakingNicks(), selfNick())}
              muted={voice().muted}
              deafened={voice().deafened}
              handRaised={voice().handRaised}
              channelUser={userFor(selfNick())}
              class="voice-stage__filmstrip-tile"
            />
          </Show>

          <Index each={remoteSlots()}>
            {(slot) => (
              <ParticipantTile
                nick={slot().nick}
                peer={slot().peer}
                stream={slot().stream}
                speaking={slot().speaking}
                muted={slot().muted}
                handRaised={slot().handRaised}
                pinned={voice().pinnedParticipant === slot().nick}
                onPin={handlePin}
                channelUser={userFor(slot().nick)}
                class="voice-stage__filmstrip-tile"
              />
            )}
          </Index>
        </div>
      </Show>
      </Show>
    </div>
  );
}
