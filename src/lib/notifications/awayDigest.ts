// SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
// awayDigest — "since you were away" tiered composition.
//
// Takes the flat, already-ranked catch-up list (buildCatchUp) and sorts each
// unread conversation into one of three attention tiers, honouring the calm
// preset and per-channel notification mode:
//
//   attention → DMs + channels where you were mentioned (the "needs attention"
//               tier). Mute is Discord-style hard silence: a muted room or DM
//               never lands here, even with @ or a keyword highlight.
//               Mentions-only is the middle All / @ / Mute level and still
//               badges @. Under the `power` preset, followed channels escalate
//               here too.
//   followed  → active followed channels with unread but no mention, and not
//               muted. Summarised but NEVER escalated to `attention` under
//               `calm`/`regular`.
//   quiet     → the collapsed ambient tail: unfollowed unread that is not
//               hard-silenced. Muted rooms/DMs are omitted entirely.
//
// PURITY: no clock read, no store read, no I/O. The caller injects the
// notification-level map + the active calm preset. Read state already drives the
// input (buildCatchUp only emits targets with unread/highlights), so a
// fully-caught-up conversation never reaches here.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatchUpItem } from './catchUp';
import { isCatchUpHardSilenced, type NotifyLevel } from './channelNotifyMode';
import type { CalmPreset } from './calmMode';

export type AwayTier = 'attention' | 'followed' | 'quiet';

export interface AwayDigest {
  /** DMs + mentions (and, under `power`, followed). Hard-silenced rooms/DMs never appear. */
  attention: CatchUpItem[];
  /** Active followed channels, unread, not muted, no mention. */
  followed: CatchUpItem[];
  /** Collapsed ambient tail: other unread. Hard-silenced rooms/DMs never appear. */
  quiet: CatchUpItem[];
  totalUnread: number;
  totalMentions: number;
  /** True when nothing unread survived across every tier. */
  empty: boolean;
}

export interface AwayDigestOptions {
  /** Stored per-channel notification levels (store `channelNotify`). */
  notifyLevels: ReadonlyMap<string, NotifyLevel>;
  /** Active calm preset — governs whether followed channels escalate. */
  preset: CalmPreset;
  /** Dedicated DM hard-silence set (store `mutedDMs`). */
  mutedDMs?: ReadonlySet<string>;
  /** Cap on the collapsed quiet tail. Default 6. */
  quietLimit?: number;
}

const DEFAULT_QUIET_LIMIT = 6;

function tierFor(
  item: CatchUpItem,
  _levels: ReadonlyMap<string, NotifyLevel>,
  preset: CalmPreset,
): AwayTier {
  // Hard-silenced rows are dropped before this runs. Mentions-only rooms with
  // an @ still reach attention; Mute never does.
  if (item.kind === 'dm' || item.highlights > 0) return 'attention';
  // Followed channels sit in their own tier — never escalated to attention
  // under calm/regular. A power user pulls them up top.
  if (item.followed) return preset === 'power' ? 'attention' : 'followed';
  // Everything else is ambient chatter.
  return 'quiet';
}

/** Attention rows lead with the loudest highlight, DMs, then recency. */
function compareAttention(a: CatchUpItem, b: CatchUpItem): number {
  return (
    b.highlights - a.highlights ||
    dmRank(b) - dmRank(a) ||
    b.lastActivity - a.lastActivity ||
    a.name.localeCompare(b.name)
  );
}

function dmRank(item: CatchUpItem): number {
  return item.kind === 'dm' ? 1 : 0;
}

/** Followed + quiet rows: busiest first, then most recent, then name. */
function compareByUnread(a: CatchUpItem, b: CatchUpItem): number {
  return (
    b.unread - a.unread ||
    b.lastActivity - a.lastActivity ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Compose the tiered away digest. Input is expected to already be filtered to
 * unread conversations (buildCatchUp). Ordering inside each tier is total and
 * deterministic so a re-render with the same data yields an identical shape.
 */
export function buildAwayDigest(
  items: readonly CatchUpItem[],
  options: AwayDigestOptions,
): AwayDigest {
  const { notifyLevels, preset, mutedDMs } = options;
  const quietLimit = options.quietLimit ?? DEFAULT_QUIET_LIMIT;

  const attention: CatchUpItem[] = [];
  const followed: CatchUpItem[] = [];
  const quiet: CatchUpItem[] = [];
  let totalUnread = 0;
  let totalMentions = 0;

  for (const item of items) {
    // Mute = hard silence. Mentions-only is a different level and still badges @.
    if (isCatchUpHardSilenced(item.kind, item.target, notifyLevels, mutedDMs)) continue;
    totalUnread += item.unread;
    totalMentions += item.highlights;
    switch (tierFor(item, notifyLevels, preset)) {
      case 'attention':
        attention.push(item);
        break;
      case 'followed':
        followed.push(item);
        break;
      case 'quiet':
        quiet.push(item);
        break;
    }
  }

  attention.sort(compareAttention);
  followed.sort(compareByUnread);
  quiet.sort(compareByUnread);
  // Cap the tail BEFORE deriving `empty`, so a `quietLimit` of 0 that hides
  // every surviving row still reports the digest as empty.
  const quietTail = quiet.slice(0, quietLimit);

  return {
    attention,
    followed,
    quiet: quietTail,
    totalUnread,
    totalMentions,
    empty: attention.length === 0 && followed.length === 0 && quietTail.length === 0,
  };
}
