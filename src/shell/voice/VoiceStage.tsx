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
 * Peer tiles: iterated from store.voice.peers Map.
 * Video streams: resolved from store.voice.videoParticipants (peer) or
 *   store.voice.cameraStream / screenshareStream (self).
 * Channel users (for role badges): from store.channels.get(callChannel).
 *
 * Renders calm over the app background — no heavyweight overlay.
 */

import { createMemo, For, Show } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import { ParticipantTile } from './ParticipantTile';
import './voice.css';

/** A normalized participant — self or a remote peer — for layout passes. */
type Slot = {
  key: string;
  nick: string;
  peer: SuimyakuPeerState | null;
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

  // All peers as an array (stable iteration order)
  const peers = createMemo<SuimyakuPeerState[]>(() => [...voice().peers.values()]);

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

  const selfSlot = createMemo<Slot>(() => ({
    key: '__self__',
    nick: selfNick(),
    peer: null,
    isSelf: true,
    stream: selfVideoStream(),
    speaking: speakingNicks().has(selfNick()),
    handRaised: voice().handRaised,
    muted: voice().muted,
  }));

  const peerSlots = createMemo<Slot[]>(() =>
    peers().map(p => ({
      key: p.nick,
      nick: p.nick,
      peer: p,
      isSelf: false,
      stream: peerStream(p.nick),
      speaking: p.speaking || speakingNicks().has(p.nick),
      handRaised: voice().raisedHands.has(p.nick),
      muted: p.muted || mutedNicks().has(p.nick),
    }))
  );

  // Cross-node (and any not-yet-decoding) call members: present in the mesh-
  // propagated roster but with no local media peer. Render them as audio-only
  // tiles driven entirely by the server's MEDIA event-plane state, so a call
  // spanning two servers actually shows everyone in it.
  const rosterSlots = createMemo<Slot[]>(() => {
    const ch = voice().callChannel;
    if (!ch) return [];
    const roster = voiceChannelParticipants().get(ch.toLowerCase());
    if (!roster) return [];
    const known = new Set<string>([selfNick().toLowerCase(), ...peers().map(p => p.nick.toLowerCase())]);
    const out: Slot[] = [];
    for (const nick of roster) {
      if (known.has(nick.toLowerCase())) continue;
      out.push({
        key: nick,
        nick,
        peer: null,
        isSelf: false,
        stream: null,
        speaking: speakingNicks().has(nick),
        handRaised: voice().raisedHands.has(nick),
        muted: mutedNicks().has(nick),
      });
    }
    return out;
  });

  const remoteSlots = createMemo<Slot[]>(() => [...peerSlots(), ...rosterSlots()]);
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

  const stageClass = createMemo(() => {
    const cls = ['voice-stage'];
    if (screenshareActive()) cls.push('voice-stage--screenshare');
    else if (isSpotlight()) cls.push('voice-stage--spotlight');
    return cls.join(' ');
  });

  return (
    <div
      class={stageClass()}
      aria-label="Voice call participants"
      role="region"
      data-testid="voice-stage"
      data-layout={screenshareActive() ? 'screenshare' : voice().callLayout}
    >
      <Show
        when={screenshareActive()}
        fallback={
          <Show
            when={isSpotlight()}
            fallback={
              /* ── Grid layout ── */
              <div class="voice-stage__grid" data-count={countAttr()}>
                <For each={allSlots()}>
                  {(slot) => (
                    <ParticipantTile
                      nick={slot.nick}
                      peer={slot.peer}
                      stream={slot.stream}
                      isSelf={slot.isSelf}
                      muted={slot.muted}
                      deafened={slot.isSelf ? voice().deafened : undefined}
                      handRaised={slot.handRaised}
                      pinned={voice().pinnedParticipant === slot.nick}
                      onPin={handlePin}
                      channelUser={userFor(slot.nick)}
                    />
                  )}
                </For>
              </div>
            }
          >
            {/* ── Spotlight / active-speaker layout ── */}
            <div class="voice-stage__primary" data-testid="spotlight-primary">
              {(() => {
                const slot = spotlightSlot();
                return (
                  <ParticipantTile
                    nick={slot.nick}
                    peer={slot.peer}
                    stream={slot.stream}
                    isSelf={slot.isSelf}
                    muted={slot.muted}
                    deafened={slot.isSelf ? voice().deafened : undefined}
                    handRaised={slot.handRaised}
                    pinned={voice().pinnedParticipant === slot.nick}
                    onPin={handlePin}
                    channelUser={userFor(slot.nick)}
                  />
                );
              })()}
            </div>

            <Show when={filmstripSlots().length > 0}>
              <div class="voice-stage__filmstrip" role="list" aria-label="Other participants">
                <For each={filmstripSlots()}>
                  {(slot) => (
                    <ParticipantTile
                      nick={slot.nick}
                      peer={slot.peer}
                      stream={slot.stream}
                      isSelf={slot.isSelf}
                      muted={slot.muted}
                      deafened={slot.isSelf ? voice().deafened : undefined}
                      handRaised={slot.handRaised}
                      pinned={voice().pinnedParticipant === slot.nick}
                      onPin={handlePin}
                      channelUser={userFor(slot.nick)}
                      class="voice-stage__filmstrip-tile"
                    />
                  )}
                </For>
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
              muted={voice().muted}
              deafened={voice().deafened}
              handRaised={voice().handRaised}
              channelUser={userFor(selfNick())}
              class="voice-stage__filmstrip-tile"
            />
          </Show>

          <For each={peers()}>
            {(peer) => (
              <ParticipantTile
                nick={peer.nick}
                peer={peer}
                stream={peerStream(peer.nick)}
                handRaised={voice().raisedHands.has(peer.nick)}
                pinned={voice().pinnedParticipant === peer.nick}
                onPin={handlePin}
                channelUser={userFor(peer.nick)}
                class="voice-stage__filmstrip-tile"
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
