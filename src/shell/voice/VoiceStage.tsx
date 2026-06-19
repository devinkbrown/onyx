/**
 * VoiceStage — responsive grid of ParticipantTiles.
 *
 * Layout rules:
 *   1 participant  → full-width single tile
 *   2              → 2-column side by side
 *   3-4            → 2×2 grid
 *   5-6            → 3 columns
 *   7-9            → 3 columns
 *   10+            → 4 columns (data-count="large")
 *
 * Screenshare override: the screenshare stream gets a full primary tile;
 * all other participants shrink to a horizontal filmstrip below it.
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
import { useStore } from '@/lib/store';
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';
import { ParticipantTile } from './ParticipantTile';
import './voice.css';

export function VoiceStage() {
  const voice = useStore(s => s.voice);
  const channels = useStore(s => s.channels);
  const ourNick = useStore(s => s.ourNick);

  const channelUsers = createMemo(() => {
    const ch = voice().callChannel;
    if (!ch) return undefined;
    return channels().get(ch.toLowerCase())?.users;
  });

  // All peers as an array (stable iteration order)
  const peers = createMemo<SuimyakuPeerState[]>(() => [...voice().peers.values()]);

  // Total participant count (self + peers)
  const totalCount = createMemo(() => peers().length + 1);

  // Screenshare is active: self screenshare takes the primary slot
  const screenshareActive = createMemo(() => voice().screenshareActive && !!voice().screenshareStream);

  const countAttr = createMemo(() => {
    const n = totalCount();
    if (n >= 10) return 'large';
    return String(n);
  });

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

  return (
    <div
      class={`voice-stage${screenshareActive() ? ' voice-stage--screenshare' : ''}`}
      aria-label="Voice call participants"
      role="region"
      data-testid="voice-stage"
    >
      <Show
        when={screenshareActive()}
        fallback={
          /* Normal grid layout */
          <div class="voice-stage__grid" data-count={countAttr()}>
            {/* Self tile */}
            <ParticipantTile
              nick={selfNick()}
              peer={null}
              stream={selfVideoStream()}
              isSelf
              muted={voice().muted}
              deafened={voice().deafened}
              channelUser={channelUsers()?.get(selfNick().toLowerCase())}
            />

            {/* Peer tiles */}
            <For each={peers()}>
              {(peer) => (
                <ParticipantTile
                  nick={peer.nick}
                  peer={peer}
                  stream={peerStream(peer.nick)}
                  channelUser={channelUsers()?.get(peer.nick.toLowerCase())}
                />
              )}
            </For>
          </div>
        }
      >
        {/* Screenshare layout: large primary + filmstrip */}
        <div class="voice-stage__primary">
          <ParticipantTile
            nick={selfNick()}
            peer={null}
            stream={voice().screenshareStream}
            isSelf
            isScreenshare
            muted={voice().muted}
            deafened={voice().deafened}
            channelUser={channelUsers()?.get(selfNick().toLowerCase())}
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
              channelUser={channelUsers()?.get(selfNick().toLowerCase())}
              class="voice-stage__filmstrip-tile"
            />
          </Show>

          <For each={peers()}>
            {(peer) => (
              <ParticipantTile
                nick={peer.nick}
                peer={peer}
                stream={peerStream(peer.nick)}
                channelUser={channelUsers()?.get(peer.nick.toLowerCase())}
                class="voice-stage__filmstrip-tile"
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
