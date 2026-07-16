// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SuimyakuPeerState } from '@/lib/suimyaku-media/types';

/**
 * A participant identity shared by every in-call layout.
 *
 * `peer` is null for a roster-only participant whose media has not reached this
 * client (for example, a participant connected through another mesh node).
 */
export type VoiceParticipant = {
  nick: string;
  peer: SuimyakuPeerState | null;
  isSelf: boolean;
};

/**
 * Merge local identity, decoded media peers, and the server-propagated room
 * roster into one stable, case-insensitive participant list.
 *
 * Media peers are inserted before roster-only identities so their richer state
 * and display casing win when the roster contains the same nick with different
 * case. The local identity always remains first.
 */
export function mergeVoiceParticipants(
  selfNick: string,
  peers: ReadonlyMap<string, SuimyakuPeerState>,
  roster?: ReadonlySet<string> | null,
): VoiceParticipant[] {
  const participants = new Map<string, VoiceParticipant>();
  const self = selfNick.trim();
  const selfKey = self.toLowerCase();

  if (self) {
    participants.set(selfKey, { nick: self, peer: null, isSelf: true });
  }

  for (const peer of peers.values()) {
    const nick = peer.nick.trim();
    if (!nick) continue;
    const key = nick.toLowerCase();
    if (key === selfKey && self) continue;
    participants.set(key, { nick, peer, isSelf: false });
  }

  for (const rosterNick of roster ?? []) {
    const nick = rosterNick.trim();
    if (!nick) continue;
    const key = nick.toLowerCase();
    if (participants.has(key)) continue;
    participants.set(key, { nick, peer: null, isSelf: false });
  }

  return [...participants.values()];
}
