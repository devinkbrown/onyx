// SPDX-License-Identifier: AGPL-3.0-or-later
// Media stream routing for the WS media plane.
//
// A relayed Cadence datagram carries a `stream_id` but no sender identity (the
// Onyx Server SFU forwards verbatim). We make `stream_id` a DETERMINISTIC public
// function of (channel, nick, kind) so a receiver can map an inbound datagram
// back to a roster participant with no server cooperation. This id is a routing
// label only — authenticity comes from the per-stream MAC, not from this value.

export type MediaStreamKind = 'audio' | 'video';

// Keep this aligned with PeerRegistry's live peer cap. The server's MEDIA
// presence feed is untrusted and may otherwise grow routing state forever.
export const MAX_MEDIA_STREAM_PARTICIPANTS = 64;
export const MAX_MEDIA_STREAM_NICK_LENGTH = 128;
export const MAX_MEDIA_STREAM_CHANNEL_LENGTH = 256;

function validRoutingToken(value: string, maxLength: number): boolean {
  return value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u0020\u007f]/u.test(value);
}

/**
 * FNV-1a (32-bit) over UTF-8 of "channel\0nick\0kind", with ASCII A-Z folded
 * after UTF-8 encoding. Onyx Server uses the identical bytewise fold: non-ASCII
 * UTF-8 bytes stay unchanged, avoiding JS Unicode-lowercasing drift.
 */
export function mediaStreamId(channel: string, nick: string, kind: MediaStreamKind): number {
  const bytes = new TextEncoder().encode(`${channel}\0${nick}\0${kind}`);
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    const folded = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
    h ^= folded;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface MediaStreamSource {
  nick: string;
  kind: MediaStreamKind;
}

/**
 * Resolves an inbound datagram's `stream_id` to its sender by precomputing the
 * id for every roster participant's audio + video streams. Rebuild via
 * `setRoster` whenever the call roster changes (MEDIA JOIN/LEAVE).
 */
export class MediaStreamRouter {
  private channel = '';
  private map = new Map<number, MediaStreamSource>();
  private participants = new Set<string>();

  setRoster(channel: string, nicks: readonly string[]): void {
    this.clear();
    if (!validRoutingToken(channel, MAX_MEDIA_STREAM_CHANNEL_LENGTH)) return;
    this.channel = channel;
    for (const nick of nicks) {
      if (this.participants.size >= MAX_MEDIA_STREAM_PARTICIPANTS) break;
      this.addParticipant(nick);
    }
  }

  /** Add a single participant's streams without rebuilding the whole map. */
  addParticipant(nick: string): void {
    if (!this.channel || !validRoutingToken(nick, MAX_MEDIA_STREAM_NICK_LENGTH)) return;
    const participantKey = nick.toLowerCase();
    if (this.participants.has(participantKey)
      || this.participants.size >= MAX_MEDIA_STREAM_PARTICIPANTS) return;

    const audioId = mediaStreamId(this.channel, nick, 'audio');
    const videoId = mediaStreamId(this.channel, nick, 'video');
    // A routing id is not an identity proof. Refuse a new participant if either
    // public 32-bit label collides instead of silently redirecting media from an
    // already admitted participant.
    if (audioId === videoId || this.map.has(audioId) || this.map.has(videoId)) return;

    this.map.set(audioId, { nick, kind: 'audio' });
    this.map.set(videoId, { nick, kind: 'video' });
    this.participants.add(participantKey);
  }

  /** Remove a departed participant and release its slot immediately. */
  removeParticipant(nick: string): void {
    if (!this.channel || !validRoutingToken(nick, MAX_MEDIA_STREAM_NICK_LENGTH)) return;
    const participantKey = nick.toLowerCase();
    if (!this.participants.delete(participantKey)) return;
    this.map.delete(mediaStreamId(this.channel, nick, 'audio'));
    this.map.delete(mediaStreamId(this.channel, nick, 'video'));
  }

  resolve(streamId: number): MediaStreamSource | null {
    return this.map.get(streamId >>> 0) ?? null;
  }

  clear(): void {
    this.channel = '';
    this.map.clear();
    this.participants.clear();
  }
}
