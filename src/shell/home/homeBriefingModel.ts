// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * composeHomeBriefing — pure Home inbox ordering and leftover briefing caps.
 *
 * Classifiers stay authoritative: this module never re-derives unread, live
 * occupancy, encryption, or membership. Time is injected. Vault rows are
 * accepted only when the owner key matches the current account.
 */
import type { CatchUpItem } from '@/lib/notifications/catchUp';
import { catchUpSummary } from '@/lib/notifications/catchUp';
import type { AwayDigest } from '@/lib/notifications/awayDigest';
import type { ResumePoint } from '@/lib/catchup/resumePoints';
import {
  composeHomeInbox,
  type HomeInbox,
  type HomeInboxInvite,
} from '@/lib/catchup/homeInbox';
import type { ScheduledEventItem } from '@/lib/notifications/scheduledEvents';
import type { HomeMemoryItem } from '@/lib/notifications/homeMemory';
import type { StatsChannel } from '@/lib/stats/networkIndex';

export const HOME_BRIEFING_CAPS = {
  attention: 6,
  continue: 4,
  live: 3,
  explore: 6,
} as const;

export type HomeBriefingPhase =
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'cold'
  | 'caught-up';

export type HomeOverflowAction = 'search-messages' | 'browse-rooms' | 'expand';

export type HomeOverflow = {
  count: number;
  label: string;
  action: HomeOverflowAction;
};

export type HomeLiveCallBrief = {
  present: boolean;
  label: string;
};

export type HomeLiveSlot =
  | { kind: 'call'; label: string }
  | { kind: 'event'; event: ScheduledEventItem };

export type HomeCatchUpSource = {
  items: readonly CatchUpItem[];
  fromMemory: boolean;
  sourceLabel: 'saved on this device' | 'live' | 'on this device';
};

type CatchUpTotals = ReturnType<typeof catchUpSummary>;

export type HomeBriefingInput = {
  nowMs: number;
  connectionStatus: string;
  localHistory: boolean;
  currentOwnerKey: string | null;
  vaultOwnerKey: string | null;
  hasRooms: boolean;
  hasLiveTranscript: boolean;
  liveCatchUp: readonly CatchUpItem[];
  memoryCatchUp: readonly CatchUpItem[];
  awayDigest: AwayDigest;
  resumePoints: readonly ResumePoint[];
  scheduledEvents: readonly ScheduledEventItem[];
  liveCall: HomeLiveCallBrief | null;
  directory: readonly StatsChannel[];
  recentRooms: readonly string[];
  coldVaultRooms: readonly HomeMemoryItem[];
  firstUnreadId?: ReadonlyMap<string, string | null>;
  invites?: readonly HomeInboxInvite[];
};

export type HomeBriefing = {
  phase: HomeBriefingPhase;
  nowMs: number;
  catchUpFromMemory: boolean;
  catchUpSourceLabel: HomeCatchUpSource['sourceLabel'];
  catchUpTotals: CatchUpTotals;
  showCatchUp: boolean;
  digestEmpty: boolean;
  showCaughtUpEmpty: boolean;
  continueVisible: boolean;
  liveNowVisible: boolean;
  showColdVault: boolean;
  coldVaultRooms: readonly HomeMemoryItem[];
  attention: readonly CatchUpItem[];
  attentionRest: readonly CatchUpItem[];
  attentionOverflow: HomeOverflow | null;
  quiet: readonly CatchUpItem[];
  resume: readonly ResumePoint[];
  followed: readonly CatchUpItem[];
  resumeRest: readonly ResumePoint[];
  followedRest: readonly CatchUpItem[];
  continueOverflow: HomeOverflow | null;
  liveSlots: readonly HomeLiveSlot[];
  liveRest: readonly HomeLiveSlot[];
  liveOverflow: HomeOverflow | null;
  directory: readonly StatsChannel[];
  directoryRest: readonly StatsChannel[];
  recentRooms: readonly string[];
  exploreOverflow: HomeOverflow | null;
  inbox: HomeInbox;
  showQuietEmpty: boolean;
};

export type HomeCatchUpSourceInput = {
  connectionStatus: string;
  localHistory: boolean;
  hasRooms: boolean;
  hasLiveTranscript: boolean;
  liveCatchUp: readonly CatchUpItem[];
  memoryCatchUp: readonly CatchUpItem[];
};

function connected(status: string): boolean {
  return status === 'connected';
}

function overflowOf(
  count: number,
  label: string,
  action: HomeOverflowAction,
): HomeOverflow | null {
  if (count <= 0) return null;
  return { count, label, action };
}

function moreLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} more ${count === 1 ? singular : plural}`;
}

/** Live unreads win; device memory is only a cold / reconnecting fallback. */
export function selectHomeCatchUpSource(input: HomeCatchUpSourceInput): HomeCatchUpSource {
  const live = input.liveCatchUp;
  const memory = input.localHistory ? input.memoryCatchUp : [];
  if (live.length > 0) {
    return {
      items: live,
      fromMemory: false,
      sourceLabel: connected(input.connectionStatus) ? 'live' : 'on this device',
    };
  }
  if (
    memory.length > 0
    && !(input.hasRooms && connected(input.connectionStatus) && input.hasLiveTranscript)
  ) {
    return {
      items: memory,
      fromMemory: true,
      sourceLabel: 'saved on this device',
    };
  }
  return {
    items: live,
    fromMemory: false,
    sourceLabel: connected(input.connectionStatus) ? 'live' : 'on this device',
  };
}

export function vaultOwnerAccepted(
  currentOwnerKey: string | null,
  vaultOwnerKey: string | null,
): boolean {
  return Boolean(currentOwnerKey && vaultOwnerKey && currentOwnerKey === vaultOwnerKey);
}

/**
 * Compose the Current Ledger. Input lists are already classified; this only
 * orders, caps, and computes overflow. Classifier rank is preserved.
 */
export function composeHomeBriefing(input: HomeBriefingInput): HomeBriefing {
  const source = selectHomeCatchUpSource(input);
  const ownerOk = vaultOwnerAccepted(input.currentOwnerKey, input.vaultOwnerKey);
  const coldVaultRooms = input.localHistory && ownerOk ? input.coldVaultRooms : [];
  const liveWins = input.liveCatchUp.length > 0
    || (connected(input.connectionStatus) && input.hasLiveTranscript);
  const showColdVault = coldVaultRooms.length > 0
    && !connected(input.connectionStatus)
    && !liveWins;

  const attentionAll = input.awayDigest.attention;
  const attention = attentionAll.slice(0, HOME_BRIEFING_CAPS.attention);
  const attentionRest = attentionAll.slice(HOME_BRIEFING_CAPS.attention);
  const attentionOverflow = overflowOf(
    attentionRest.length,
    moreLabel(attentionRest.length, 'item that needs you', 'items that need you'),
    'expand',
  );

  const continueAll: Array<{ kind: 'resume'; item: ResumePoint } | { kind: 'followed'; item: CatchUpItem }> = [
    ...input.resumePoints.map((item) => ({ kind: 'resume' as const, item })),
    ...input.awayDigest.followed.map((item) => ({ kind: 'followed' as const, item })),
  ];
  const continueVisibleAll = continueAll.slice(0, HOME_BRIEFING_CAPS.continue);
  const continueRestAll = continueAll.slice(HOME_BRIEFING_CAPS.continue);
  const resume: ResumePoint[] = [];
  const followed: CatchUpItem[] = [];
  for (const row of continueVisibleAll) {
    if (row.kind === 'resume') resume.push(row.item);
    else followed.push(row.item);
  }
  const resumeRest: ResumePoint[] = [];
  const followedRest: CatchUpItem[] = [];
  for (const row of continueRestAll) {
    if (row.kind === 'resume') resumeRest.push(row.item);
    else followedRest.push(row.item);
  }
  const continueOverflow = overflowOf(
    continueRestAll.length,
    moreLabel(continueRestAll.length, 'place to continue', 'places to continue'),
    'expand',
  );

  const events = connected(input.connectionStatus) ? input.scheduledEvents : [];
  const liveAll: HomeLiveSlot[] = [];
  if (input.liveCall?.present) {
    liveAll.push({ kind: 'call', label: input.liveCall.label });
  }
  for (const event of events) {
    liveAll.push({ kind: 'event', event });
  }
  const liveSlots = liveAll.slice(0, HOME_BRIEFING_CAPS.live);
  const liveRest = liveAll.slice(HOME_BRIEFING_CAPS.live);
  const liveOverflow = overflowOf(
    liveRest.length,
    moreLabel(liveRest.length, 'live item'),
    'expand',
  );

  const directory = input.directory.slice(0, HOME_BRIEFING_CAPS.explore);
  const directoryRest = input.directory.slice(HOME_BRIEFING_CAPS.explore);
  const recentRooms = input.recentRooms.slice(0, HOME_BRIEFING_CAPS.explore);
  const exploreOverflow = overflowOf(
    directoryRest.length,
    moreLabel(directoryRest.length, 'room'),
    'browse-rooms',
  );

  const inbox = composeHomeInbox({
    items: source.items,
    firstUnreadId: input.firstUnreadId,
    invites: input.invites,
  });
  const showCatchUp = input.hasRooms || source.fromMemory || inbox.invites.length > 0;
  const continueVisible = resume.length > 0 || followed.length > 0 || continueOverflow !== null;
  const liveNowVisible = liveAll.length > 0;
  const showCaughtUpEmpty = showCatchUp
    && inbox.empty
    && input.awayDigest.empty
    && input.resumePoints.length === 0
    && !liveNowVisible
    && !showColdVault
    && input.awayDigest.followed.length === 0;
  const showQuietEmpty = inbox.empty && !showColdVault;

  let phase: HomeBriefingPhase;
  if (source.fromMemory || (showColdVault && !connected(input.connectionStatus))) {
    phase = 'cold';
  } else if (input.connectionStatus === 'reconnecting') {
    phase = 'reconnecting';
  } else if (!connected(input.connectionStatus)) {
    phase = 'offline';
  } else if (showCaughtUpEmpty) {
    phase = 'caught-up';
  } else {
    phase = 'connected';
  }

  return {
    phase,
    nowMs: input.nowMs,
    catchUpFromMemory: source.fromMemory,
    catchUpSourceLabel: source.sourceLabel,
    catchUpTotals: catchUpSummary(source.items),
    showCatchUp,
    digestEmpty: input.awayDigest.empty,
    showCaughtUpEmpty,
    continueVisible,
    liveNowVisible,
    showColdVault,
    coldVaultRooms,
    attention,
    attentionRest,
    attentionOverflow,
    quiet: input.awayDigest.quiet,
    resume,
    followed,
    resumeRest,
    followedRest,
    continueOverflow,
    liveSlots,
    liveRest,
    liveOverflow,
    directory,
    directoryRest,
    recentRooms,
    exploreOverflow,
    inbox,
    showQuietEmpty,
  };
}

function inboxRowsEqual(
  a: HomeInbox['mentions'],
  b: HomeInbox['mentions'],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return Boolean(
      other
      && row.key === other.key
      && row.unread === other.unread
      && row.highlights === other.highlights
      && row.lastActivity === other.lastActivity
      && row.boundaryId === other.boundaryId,
    );
  });
}

function inboxInvitesEqual(a: HomeInbox['invites'], b: HomeInbox['invites']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return Boolean(
      other
      && row.key === other.key
      && row.inviter === other.inviter
      && row.channel === other.channel
      && row.at === other.at,
    );
  });
}

export function homeBriefingEqual(a: HomeBriefing, b: HomeBriefing): boolean {
  return a === b
    || (
      a.phase === b.phase
      && a.nowMs === b.nowMs
      && a.catchUpFromMemory === b.catchUpFromMemory
      && a.catchUpSourceLabel === b.catchUpSourceLabel
      && a.catchUpTotals.unread === b.catchUpTotals.unread
      && a.catchUpTotals.mentions === b.catchUpTotals.mentions
      && a.catchUpTotals.followed === b.catchUpTotals.followed
      && a.showCatchUp === b.showCatchUp
      && a.digestEmpty === b.digestEmpty
      && a.showCaughtUpEmpty === b.showCaughtUpEmpty
      && a.continueVisible === b.continueVisible
      && a.liveNowVisible === b.liveNowVisible
      && a.showColdVault === b.showColdVault
      && a.attention === b.attention
      && a.attentionRest === b.attentionRest
      && a.attentionOverflow?.count === b.attentionOverflow?.count
      && a.quiet === b.quiet
      && a.resume === b.resume
      && a.followed === b.followed
      && a.resumeRest === b.resumeRest
      && a.followedRest === b.followedRest
      && a.continueOverflow?.count === b.continueOverflow?.count
      && a.liveSlots === b.liveSlots
      && a.liveRest === b.liveRest
      && a.liveOverflow?.count === b.liveOverflow?.count
      && a.directory === b.directory
      && a.directoryRest === b.directoryRest
      && a.recentRooms === b.recentRooms
      && a.exploreOverflow?.count === b.exploreOverflow?.count
      && a.coldVaultRooms === b.coldVaultRooms
      && inboxRowsEqual(a.inbox.mentions, b.inbox.mentions)
      && inboxRowsEqual(a.inbox.missed, b.inbox.missed)
      && inboxInvitesEqual(a.inbox.invites, b.inbox.invites)
      && a.showQuietEmpty === b.showQuietEmpty
    );
}
