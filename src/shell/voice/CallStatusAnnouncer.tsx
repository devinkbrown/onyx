// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CallStatusAnnouncer — a single visually-hidden polite live region that voices
 * roster changes during an active call (SC 4.1.3 Status Messages).
 *
 * A screen-reader user cannot see tiles appear or disappear in the VoiceStage
 * grid, so joins/leaves must be spoken. The hard constraint is that a large
 * roster (up to 24 tiles) must NOT re-announce the whole list on every render:
 *
 *   - The participant set is derived from voice.peers + the cross-node
 *     voiceChannelParticipants roster (the same two sources VoiceStage renders),
 *     minus self.
 *   - A per-instance baseline is captured silently on the first in-call render,
 *     so entering a call never reads the existing roster aloud.
 *   - Thereafter only the DELTA (who joined / who left) is announced; unrelated
 *     voice-state churn (mute flips, speaking flags, peer-map replacement) that
 *     leaves the set unchanged produces no announcement.
 *
 * The region is scoped to status text only — it never contains the tiles — so it
 * cannot be mistaken for the transcript/log live regions elsewhere in the call.
 */

import { createEffect, createMemo, createSignal } from 'solid-js';
import { useStore } from '@/lib/store';

/** Cap the spoken list so a burst of joins stays a short, digestible phrase. */
const MAX_NAMED = 3;

/** "alice", "alice and bob", "alice, bob and carol", "5 people". */
function nameList(names: readonly string[]): string {
  if (names.length > MAX_NAMED) return `${names.length} people`;
  if (names.length <= 1) return names[0] ?? '';
  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1];
  return `${head} and ${tail}`;
}

function verb(names: readonly string[]): string {
  return names.length === 1 ? 'has' : 'have';
}

export function CallStatusAnnouncer() {
  const voice = useStore((s) => s.voice);
  const ourNick = useStore((s) => s.ourNick);
  const voiceChannelParticipants = useStore((s) => s.voiceChannelParticipants);

  const [message, setMessage] = createSignal('');

  // Current participant set, keyed by lowercased nick → display nick. Mirrors the
  // sources VoiceStage draws tiles from so the announcement can never drift from
  // what is actually on screen.
  const roster = createMemo<Map<string, string>>(() => {
    const self = (ourNick() ?? '').toLowerCase();
    const out = new Map<string, string>();
    for (const peer of voice().peers.values()) {
      const key = peer.nick.toLowerCase();
      if (key !== self) out.set(key, peer.nick);
    }
    const channel = voice().callChannel;
    if (channel) {
      const members = voiceChannelParticipants().get(channel.toLowerCase());
      if (members) {
        for (const nick of members) {
          const key = nick.toLowerCase();
          if (key !== self && !out.has(key)) out.set(key, nick);
        }
      }
    }
    return out;
  });

  // Per-instance baseline. null until the first in-call render, so the initial
  // roster is adopted silently rather than announced.
  let previous: Map<string, string> | null = null;

  createEffect(() => {
    const active = voice().callState === 'in_call';
    const current = roster();

    if (!active) {
      // Leaving/idling resets the baseline; a subsequent call re-baselines quietly.
      previous = null;
      return;
    }
    if (previous === null) {
      previous = current;
      return;
    }

    const joined: string[] = [];
    const left: string[] = [];
    for (const [key, name] of current) if (!previous.has(key)) joined.push(name);
    for (const [key, name] of previous) if (!current.has(key)) left.push(name);
    previous = current;

    if (joined.length === 0 && left.length === 0) return;

    const parts: string[] = [];
    if (joined.length > 0) parts.push(`${nameList(joined)} ${verb(joined)} joined the call`);
    if (left.length > 0) parts.push(`${nameList(left)} ${verb(left)} left the call`);
    setMessage(parts.join('. '));
  });

  return (
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="call-status-announcer"
    >
      {message()}
    </div>
  );
}

export default CallStatusAnnouncer;
